import OpenAI from "openai";
import {
  EXTRACTION_PROMPT,
  isListing,
  sanitizeExtraction,
  toAnnonceDetails,
  toTags,
  type AnnonceDetails,
  type Extraction,
} from "./extraction";

// ============================================================
// Fournisseur IA : OpenRouter (modèle z.ai GLM) si OPENROUTER_API_KEY est défini,
// sinon Kimi/Moonshot comme auparavant. Le modèle se change sans redéployer le code
// via OPENROUTER_MODEL.
// ============================================================
const OPENROUTER_DEFAULT_MODEL = "z-ai/glm-5.3-flash";
const KIMI_MODEL = "kimi-k2-0711-preview";

interface AIProvider {
  client: OpenAI;
  model: string;
  jsonMode: boolean;
  /** Marge de tokens pour le raisonnement interne du modèle, qui compte dans max_tokens. */
  reasoningBudget: number;
  /** Paramètres propres au fournisseur, ajoutés au corps de la requête. */
  extraBody: Record<string, unknown>;
}

/**
 * @param legacyKey clé Kimi propre à un utilisateur (profiles.kimi_api_key).
 *                  Ignorée quand OpenRouter est configuré : ce n'est pas une clé OpenRouter.
 */
function getAIProvider(legacyKey?: string | null): AIProvider {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    return {
      client: new OpenAI({
        apiKey: openRouterKey,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: { "X-Title": "Mi Casa Alerte" },
      }),
      model: process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL,
      jsonMode: true,
      reasoningBudget: 3000,
      // WHY: sans borne, le modèle épuisait parfois tout son quota à raisonner et ne
      // rédigeait rien (arrêt « length »). Un effort faible suffit pour remplir une fiche.
      extraBody: { reasoning: { effort: "low" } },
    };
  }

  return {
    client: new OpenAI({
      apiKey: legacyKey || process.env.KIMI_API_KEY,
      baseURL: "https://api.moonshot.ai/v1",
    }),
    model: KIMI_MODEL,
    jsonMode: false,
    reasoningBudget: 0,
    extraBody: {},
  };
}

/** Indique si un fournisseur IA est utilisable (clé OpenRouter, ou clé Kimi en repli). */
export function isAIConfigured(legacyKey?: string | null): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || legacyKey || process.env.KIMI_API_KEY);
}

// Les modèles entourent parfois le JSON de balises markdown ou de texte :
// on garde ce qui se trouve entre la première accolade et la dernière.
function extractJson(content: string): string {
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

/** Résultat d'une analyse, au format des colonnes de la table `annonces`. */
export interface AIExtractionResult {
  is_real_estate: boolean;
  type_offre: string | null;
  type_bien: string | null;
  prix: number | null;
  devise: string | null;
  nb_pieces: number | null;
  nb_chambres: number | null;
  nb_salles_bain: number | null;
  superficie: number | null;
  meuble: boolean | null;
  quartier: string | null;
  ville: string | null;
  adresse_complete: string | null;
  telephone: string | null;
  whatsapp: string | null;
  email: string | null;
  summary: string;
  confidence: number;
  tags: string[];
  /** Fiche détaillée : charges, caution, confiance par champ, extraits source, champs à vérifier. */
  details: AnnonceDetails;
}

// La colonne `type_offre` garde son vocabulaire historique ; la transaction fine reste dans `details`.
function toTypeOffre(transaction: Extraction["transaction"]): string | null {
  if (transaction === "location_meublee") return "location";
  if (transaction === "inconnu") return null;
  return transaction;
}

function globalConfidence(e: Extraction): number {
  const values = ["transaction", "type", "prix"].map((k) => e.confiance[k]).filter((v) => typeof v === "number");
  if (!values.length) return e.a_verifier.length ? 0.4 : 0.7;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(Math.max(0, mean - 0.1 * e.rejets.length) * 100) / 100;
}

/**
 * Analyse le texte d'une publication et renvoie la fiche normalisée de l'annonce.
 * Les contacts viennent d'expressions régulières, jamais du modèle ; tout champ
 * important non justifié par un extrait de la source est remis à null.
 *
 * Un bien situé hors du Gabon est écarté (`is_real_estate` à false, `details.hors_gabon` à true),
 * tout comme une publication où l'auteur cherche un bien (`details.transaction` à "recherche").
 * @example
 * const fiche = await analyzePost("Studio meublé 150k à Okala, 077 12 34 56");
 */
export async function analyzePost(text: string, apiKey?: string | null): Promise<AIExtractionResult> {
  const { client, model, jsonMode, reasoningBudget, extraBody } = getAIProvider(apiKey);

  const response = await client.chat.completions.create({
    model,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    ...extraBody,
    max_tokens: 1400 + reasoningBudget,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      // WHY: seul le texte est transmis. Le nom du groupe a été retiré : le modèle le prenait
      // pour le titre de la publication et classait tout en « maison à louer ».
      { role: "user", content: `Texte de la publication :\n\n${text}` },
    ],
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    // La raison d'arrêt distingue une réponse coupée (length) d'un refus du modèle (content_filter).
    const reason = response.choices[0]?.finish_reason ?? "aucun choix renvoyé";
    throw new Error(`Pas de réponse de l'IA (${reason})`);
  }

  const e = sanitizeExtraction(JSON.parse(extractJson(content)), text);

  return {
    // Périmètre actuel : offres situées au Gabon ; les recherches de biens sont exclues.
    is_real_estate: isListing(e),
    type_offre: toTypeOffre(e.transaction),
    type_bien: e.type,
    prix: e.prix,
    devise: e.devise === "XAF" ? "FCFA" : e.devise,
    nb_pieces: e.nb_pieces,
    nb_chambres: e.nb_chambres,
    nb_salles_bain: e.nb_salles_bain,
    superficie: e.surface_m2,
    meuble: e.meuble,
    quartier: e.quartier,
    ville: e.ville,
    adresse_complete: e.adresse,
    telephone: e.telephones[0] ?? null,
    whatsapp: e.whatsapp,
    email: e.emails[0] ?? null,
    summary: e.description || "",
    confidence: globalConfidence(e),
    tags: toTags(e),
    details: toAnnonceDetails(e),
  };
}

// Chatbot intent interpretation
const CHATBOT_SYSTEM_PROMPT = `Tu es un assistant immobilier au Gabon. Un client t'envoie un message WhatsApp.
Analyse son intention et réponds UNIQUEMENT avec un JSON strict (sans markdown) :

{
  "type": "search_more" | "modify_criteria" | "help" | "greeting" | "unknown",
  "changes": {
    "quartiers": ["string"] | null,
    "prix_min": number | null,
    "prix_max": number | null,
    "type_offre": "location" | "vente" | "colocation" | null,
    "type_bien": "appartement" | "maison" | "studio" | "villa" | "chambre" | "terrain" | null,
    "nb_chambres_min": number | null
  }
}

Règles :
- "montre-moi des annonces", "encore", "plus", "autres annonces" → type: "search_more"
- Mention de quartier, budget, chambres, type de bien → type: "modify_criteria" avec les changes
- "aide", "help", "commandes" → type: "help"
- "bonjour", "salut" → type: "greeting"
- Sinon → type: "unknown"
- "150k" = 150000, "1M" = 1000000
- Ne mets dans changes QUE les champs mentionnés par le client`;

export interface ChatbotIntent {
  type: "search_more" | "modify_criteria" | "help" | "greeting" | "unknown";
  changes: {
    quartiers?: string[];
    prix_min?: number;
    prix_max?: number;
    type_offre?: string;
    type_bien?: string;
    nb_chambres_min?: number;
  };
}

export async function interpretClientMessage(
  messageText: string,
  currentDemand: unknown,
  apiKey?: string
): Promise<ChatbotIntent> {
  const { client, model, jsonMode, reasoningBudget, extraBody } = getAIProvider(apiKey);

  const context = currentDemand
    ? `\nCritères actuels du client : ${JSON.stringify(currentDemand)}`
    : "";

  const response = await client.chat.completions.create({
    model,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    ...extraBody,
    max_tokens: 256 + reasoningBudget,
    messages: [
      { role: "system", content: CHATBOT_SYSTEM_PROMPT },
      { role: "user", content: `Message du client : "${messageText}"${context}` },
    ],
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return { type: "unknown", changes: {} };

  return JSON.parse(extractJson(content)) as ChatbotIntent;
}

/**
 * Avis du modèle sur une annonce signalée par des abonnés (arnaque, bien déjà loué ou vendu).
 * Renvoie le texte brut de la réponse, à lire avec `parseReportAnalysis` ; null si le modèle
 * n'a rien rédigé. Le modèle conseille l'agent : il ne retire jamais une annonce lui-même.
 *
 * @example const raw = await analyzeReportedAnnonce(reportAnalysisPrompt({ ... }))
 */
export async function analyzeReportedAnnonce(prompt: string, apiKey?: string | null): Promise<string | null> {
  const { client, model, jsonMode, reasoningBudget, extraBody } = getAIProvider(apiKey);
  const response = await client.chat.completions.create(
    {
      model,
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      ...extraBody,
      max_tokens: 500 + reasoningBudget,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    },
    { timeout: 30_000 }
  );
  return response.choices[0]?.message?.content || null;
}

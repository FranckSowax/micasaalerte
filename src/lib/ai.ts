import OpenAI from "openai";

const SYSTEM_PROMPT = `Tu es un assistant spécialisé dans l'analyse d'annonces immobilières au Gabon.
Analyse le post Facebook suivant et extrais les informations en JSON strict.

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans commentaires) avec ces champs :
- is_real_estate (boolean) : est-ce une annonce immobilière ?
- type_offre: "location" | "vente" | "colocation" | "sous-location" | "recherche" | null
- type_bien: "appartement" | "maison" | "studio" | "chambre" | "terrain" | "bureau" | "villa" | null
- prix (number en FCFA, "150k" = 150000, "1M" = 1000000, null si non spécifié)
- nb_pieces (number | null)
- nb_chambres (number | null)
- nb_salles_bain (number | null)
- superficie (number en m² | null)
- meuble (boolean | null)
- quartier (string | null)
- ville (string, défaut "Libreville")
- adresse_complete (string | null)
- telephone (string | null)
- whatsapp (string | null)
- email (string | null)
- summary (string, 1-2 phrases de résumé)
- confidence (number 0-1)
- tags (string[], ex: "climatisé", "parking", "gardien", "neuf", "eau chaude", etc.)`;

export interface AIExtractionResult {
  is_real_estate: boolean;
  type_offre: string | null;
  type_bien: string | null;
  prix: number | null;
  nb_pieces: number | null;
  nb_chambres: number | null;
  nb_salles_bain: number | null;
  superficie: number | null;
  meuble: boolean | null;
  quartier: string | null;
  ville: string;
  adresse_complete: string | null;
  telephone: string | null;
  whatsapp: string | null;
  email: string | null;
  summary: string;
  confidence: number;
  tags: string[];
}

export async function analyzePost(
  text: string,
  apiKey?: string
): Promise<AIExtractionResult> {
  const client = new OpenAI({
    apiKey: apiKey || process.env.KIMI_API_KEY,
    baseURL: "https://api.moonshot.ai/v1",
  });

  const response = await client.chat.completions.create({
    model: "kimi-k2-0711-preview",
    max_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Analyse ce post Facebook :\n\n${text}` },
    ],
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Pas de réponse de l'IA");
  }

  // Nettoyer la réponse si elle contient des blocs markdown
  const cleaned = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  return JSON.parse(cleaned) as AIExtractionResult;
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
  const client = new OpenAI({
    apiKey: apiKey || process.env.KIMI_API_KEY,
    baseURL: "https://api.moonshot.ai/v1",
  });

  const context = currentDemand
    ? `\nCritères actuels du client : ${JSON.stringify(currentDemand)}`
    : "";

  const response = await client.chat.completions.create({
    model: "kimi-k2-0711-preview",
    max_tokens: 256,
    messages: [
      { role: "system", content: CHATBOT_SYSTEM_PROMPT },
      { role: "user", content: `Message du client : "${messageText}"${context}` },
    ],
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return { type: "unknown", changes: {} };

  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned) as ChatbotIntent;
}

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
    baseURL: "https://api.moonshot.cn/v1",
  });

  const response = await client.chat.completions.create({
    model: "kimi-k2-0711",
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

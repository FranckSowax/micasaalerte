// Interrupteurs de fonctionnalités, lisibles côté serveur comme côté navigateur.

/**
 * Collecte manuelle par RapidAPI (boutons « Collecter » et routes /api/scrape*).
 * Désactivée par défaut : la collecte passe par les flux RSS (/api/cron/rss).
 * Pour la réactiver, définir NEXT_PUBLIC_RAPIDAPI_COLLECT=true et redéployer.
 */
export const RAPIDAPI_COLLECT_ENABLED = process.env.NEXT_PUBLIC_RAPIDAPI_COLLECT === "true";

export const RAPIDAPI_DISABLED_MESSAGE = "Collecte RapidAPI désactivée : les annonces sont collectées par les flux RSS.";

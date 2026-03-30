# PROMPT CLAUDE CODE — ImmoTracker SaaS

## Tu vas coder un SaaS complet de suivi intelligent d'annonces immobilières.

### Résumé du projet

ImmoTracker est un SaaS qui :
1. Scrape automatiquement les annonces immobilières de groupes Facebook (via RapidAPI)
2. Les analyse avec Claude IA pour extraire des données structurées (prix, quartier, type de bien, etc.)
3. Les stocke dans Supabase
4. Envoie les annonces pertinentes par WhatsApp (vers un client ou une chaîne/groupe)
5. Offre un dashboard web pour visualiser, filtrer et gérer les annonces

---

## Stack technique

- **Frontend** : Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend** : Next.js API Routes + Supabase Edge Functions
- **Base de données** : Supabase (PostgreSQL)
- **Auth** : Supabase Auth (email + Google OAuth)
- **IA** : Anthropic Claude API (claude-sonnet-4-20250514)
- **Scraping Facebook** : RapidAPI (facebook-scraper3)
- **WhatsApp** : WhatsApp Business Cloud API (via Meta)
- **Cron / Scheduling** : Vercel Cron Jobs ou Supabase pg_cron
- **Déploiement** : Vercel

---

## Architecture des données (Supabase)

### Tables principales

```sql
-- Utilisateurs/Tenants (extends Supabase auth.users)
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    full_name TEXT,
    email TEXT,
    avatar_url TEXT,
    plan TEXT DEFAULT 'free',  -- free, pro, enterprise
    whatsapp_phone TEXT,       -- Numéro WhatsApp principal
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Groupes Facebook surveillés (par utilisateur)
CREATE TABLE facebook_groups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    group_url TEXT NOT NULL,
    group_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, group_id)
);

-- Annonces immobilières
CREATE TABLE annonces (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

    -- Facebook
    fb_post_id TEXT NOT NULL,
    fb_post_url TEXT,
    fb_group_id UUID REFERENCES facebook_groups(id),
    fb_author_name TEXT,
    fb_author_id TEXT,
    fb_posted_at TIMESTAMPTZ,

    -- Contenu brut
    raw_text TEXT NOT NULL,
    raw_images TEXT[],

    -- Données extraites par IA
    type_bien TEXT,         -- appartement, maison, studio, terrain, villa, etc.
    type_offre TEXT,        -- location, vente, colocation, recherche
    prix NUMERIC,
    devise TEXT DEFAULT 'FCFA',
    nb_pieces INTEGER,
    nb_chambres INTEGER,
    nb_salles_bain INTEGER,
    superficie NUMERIC,
    meuble BOOLEAN,

    -- Localisation
    quartier TEXT,
    ville TEXT DEFAULT 'Libreville',
    adresse_complete TEXT,

    -- Contact
    telephone TEXT,
    whatsapp TEXT,
    email TEXT,

    -- IA
    ai_confidence NUMERIC,
    ai_summary TEXT,
    ai_is_real_estate BOOLEAN DEFAULT true,
    ai_tags TEXT[],

    -- Statut
    status TEXT DEFAULT 'new',  -- new, sent, archived, favorite
    is_sent_whatsapp BOOLEAN DEFAULT false,
    sent_whatsapp_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, fb_post_id)
);

-- Canaux WhatsApp de diffusion
CREATE TABLE whatsapp_channels (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,              -- Nom du canal (ex: "Clients VIP", "Appartements Libreville")
    phone_number TEXT NOT NULL,      -- Numéro ou ID du groupe WhatsApp
    channel_type TEXT DEFAULT 'individual', -- individual, group
    is_active BOOLEAN DEFAULT true,
    -- Filtres automatiques : quelles annonces envoyer sur ce canal
    filter_type_offre TEXT[],        -- ex: ['location', 'vente']
    filter_type_bien TEXT[],         -- ex: ['appartement', 'maison']
    filter_prix_min NUMERIC,
    filter_prix_max NUMERIC,
    filter_quartiers TEXT[],         -- ex: ['Angondjé', 'Okala']
    filter_ville TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Logs des envois WhatsApp
CREATE TABLE whatsapp_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    annonce_id UUID REFERENCES annonces(id),
    channel_id UUID REFERENCES whatsapp_channels(id),
    phone_number TEXT,
    message_id TEXT,        -- ID du message WhatsApp envoyé
    status TEXT DEFAULT 'pending', -- pending, sent, delivered, read, failed
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT now()
);

-- Logs des collectes
CREATE TABLE scrape_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    fb_group_id UUID REFERENCES facebook_groups(id),
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ,
    posts_found INTEGER DEFAULT 0,
    posts_new INTEGER DEFAULT 0,
    posts_duplicate INTEGER DEFAULT 0,
    posts_not_immo INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    error_message TEXT
);
```

### Row Level Security (RLS)
Chaque table doit avoir une politique RLS pour que chaque utilisateur ne voie QUE ses propres données :
```sql
ALTER TABLE facebook_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own groups" ON facebook_groups
    FOR ALL USING (auth.uid() = user_id);
-- Idem pour annonces, whatsapp_channels, whatsapp_logs, scrape_logs
```

---

## API Routes (Next.js App Router)

### Authentification
- `POST /api/auth/signup` — Inscription
- `POST /api/auth/login` — Connexion
- `POST /api/auth/logout` — Déconnexion
(Géré par Supabase Auth côté client)

### Groupes Facebook
- `GET /api/groups` — Liste des groupes de l'utilisateur
- `POST /api/groups` — Ajouter un groupe (valider l'URL Facebook, extraire le group_id)
- `DELETE /api/groups/[id]` — Supprimer un groupe
- `PATCH /api/groups/[id]` — Activer/désactiver un groupe

### Annonces
- `GET /api/annonces` — Liste avec filtres (type_bien, type_offre, prix_min, prix_max, quartier, ville, status)
- `GET /api/annonces/[id]` — Détail d'une annonce
- `PATCH /api/annonces/[id]` — Changer le statut (favorite, archived)
- `GET /api/annonces/stats` — Statistiques (nombre par type, prix moyen, etc.)

### Scraping
- `POST /api/scrape` — Lancer une collecte manuelle (pour un groupe ou tous)
- `GET /api/scrape/logs` — Historique des collectes
- `POST /api/cron/scrape` — Endpoint appelé par le cron (clé secrète)

### WhatsApp
- `GET /api/whatsapp/channels` — Liste des canaux
- `POST /api/whatsapp/channels` — Créer un canal avec filtres
- `PATCH /api/whatsapp/channels/[id]` — Modifier un canal
- `DELETE /api/whatsapp/channels/[id]` — Supprimer un canal
- `POST /api/whatsapp/send/[annonceId]` — Envoyer une annonce manuellement
- `POST /api/whatsapp/broadcast` — Envoyer aux canaux selon leurs filtres
- `POST /api/cron/whatsapp` — Envoi automatique des nouvelles annonces

---

## Pipeline de collecte (POST /api/scrape)

```
1. Récupérer les groupes actifs de l'utilisateur
2. Pour chaque groupe :
   a. Appeler RapidAPI GET /group/posts?group_id=XXX&sorting_order=CHRONOLOGICAL
   b. Paginer avec cursor (max 10 pages)
   c. Pour chaque post :
      - Vérifier si fb_post_id existe déjà → skip si doublon
      - Extraire le texte (message + attached_post.message si partage)
      - Si pas de texte → skip
      - Envoyer à Claude API pour extraction structurée
      - Si is_real_estate == false → skip
      - Insérer dans table annonces
   d. Mettre à jour last_scraped_at du groupe
3. Logger le résultat dans scrape_logs
```

### Appel RapidAPI — Facebook Scraper3

```typescript
const response = await fetch(
  `https://facebook-scraper3.p.rapidapi.com/group/posts?group_id=${groupId}&sorting_order=CHRONOLOGICAL`,
  {
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY!,
      'x-rapidapi-host': 'facebook-scraper3.p.rapidapi.com',
    },
  }
);
const data = await response.json();
// data.posts = [{ post_id, message, photo_url, author: { id, name, url }, timestamp, ... }]
// data.cursor = "..." pour la page suivante
```

### Prompt Claude pour extraction IA

```
Tu es un assistant spécialisé dans l'analyse d'annonces immobilières au Gabon.
Analyse le post Facebook suivant et extrais les informations en JSON :
- is_real_estate (bool)
- type_offre: location | vente | colocation | sous-location | recherche | null
- type_bien: appartement | maison | studio | chambre | terrain | bureau | villa | null
- prix (nombre en FCFA, "150k" = 150000, "1M" = 1000000)
- nb_pieces, nb_chambres, nb_salles_bain, superficie
- meuble (bool)
- quartier, ville, adresse_complete
- telephone, whatsapp, email
- summary (1-2 phrases)
- confidence (0-1)
- tags (ex: "climatisé", "parking", "gardien", "neuf")
```

---

## Intégration WhatsApp Business Cloud API

### Configuration
L'utilisateur configure son compte WhatsApp Business dans les settings :
1. Entrer le Phone Number ID (de Meta Business)
2. Entrer le WhatsApp Business Access Token
3. Tester l'envoi avec un message de test

### Envoi d'un message WhatsApp

```typescript
// POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
const sendWhatsAppMessage = async (
  phoneNumberId: string,
  accessToken: string,
  recipientPhone: string,
  annonce: Annonce
) => {
  const message = formatAnnonceMessage(annonce);

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'text',
        text: { body: message },
      }),
    }
  );
  return response.json();
};

// Ou envoyer avec image
const sendWhatsAppWithImage = async (..., imageUrl: string) => {
  // type: 'image', image: { link: imageUrl, caption: message }
};
```

### Format du message WhatsApp

```
🏠 *Nouvelle annonce immobilière*

📍 *{type_offre}* — {type_bien}
💰 Prix : {prix} FCFA
📌 Quartier : {quartier}, {ville}
🛏 {nb_chambres} chambre(s) | {nb_pieces} pièce(s)
{meuble ? "✅ Meublé" : ""}

📝 {ai_summary}

📞 Contact : {telephone}
💬 WhatsApp : {whatsapp}

🔗 Voir sur Facebook : {fb_post_url}

Tags : {ai_tags.join(', ')}
```

### Envoi automatique aux canaux
Quand une nouvelle annonce est insérée, vérifier chaque canal WhatsApp actif :
- L'annonce correspond-elle aux filtres du canal (type_offre, type_bien, prix, quartier) ?
- Si oui → envoyer le message formaté
- Logger dans whatsapp_logs

---

## Pages Frontend (Next.js App Router)

### Layout
- Sidebar avec navigation (Dashboard, Annonces, Groupes, WhatsApp, Paramètres)
- Header avec profil utilisateur
- Design sombre moderne (comme le dashboard Supabase)

### Pages

#### `/` — Landing page (public)
- Hero section avec titre accrocheur
- Features (scraping auto, IA, WhatsApp)
- Pricing (Free / Pro)
- CTA vers inscription

#### `/login` et `/signup` — Auth
- Formulaire email/password
- Bouton Google OAuth
- Lien vers l'autre page

#### `/dashboard` — Dashboard principal (protégé)
- Cartes KPI : Total annonces, Nouvelles aujourd'hui, Prix moyen, Envoyées WhatsApp
- Graphique des annonces par jour (7 derniers jours)
- Dernières annonces (5 plus récentes)
- Statut des groupes surveillés

#### `/annonces` — Liste des annonces (protégé)
- Barre de filtres : type_offre, type_bien, prix min/max, quartier, ville, statut
- Grille de cartes avec : photo, prix, type, quartier, résumé, tags
- Clic → modal ou page détail
- Actions : Favori, Archiver, Envoyer WhatsApp

#### `/annonces/[id]` — Détail annonce
- Photo grande
- Toutes les infos extraites
- Texte brut original
- Bouton "Envoyer par WhatsApp" (choisir le canal)
- Lien vers le post Facebook

#### `/groupes` — Gestion des groupes Facebook
- Liste des groupes avec statut (actif/inactif, dernière collecte)
- Formulaire d'ajout : coller l'URL du groupe, extraction auto du group_id
- Bouton "Lancer une collecte maintenant"
- Bouton supprimer

#### `/whatsapp` — Gestion des canaux WhatsApp
- Liste des canaux avec filtres actifs
- Formulaire de création de canal :
  - Nom, numéro de téléphone/groupe
  - Filtres : type d'offre, type de bien, fourchette de prix, quartiers
- Historique des envois récents
- Bouton "Diffuser les nouvelles annonces"

#### `/settings` — Paramètres
- Profil (nom, email, avatar)
- Clés API (RapidAPI, Anthropic — stockées chiffrées)
- Configuration WhatsApp Business (Phone Number ID, Access Token)
- Plan et facturation

---

## Variables d'environnement (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# RapidAPI
RAPIDAPI_KEY=71062435d0msh...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# WhatsApp Business
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_ACCESS_TOKEN=EAAx...

# Cron secret
CRON_SECRET=un-secret-aleatoire-long

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Instructions de développement

1. **Commence par** : `npx create-next-app@latest immo-tracker --typescript --tailwind --eslint --app --src-dir`
2. **Installe** : `npx shadcn@latest init` puis les composants nécessaires
3. **Installe les deps** : `npm install @supabase/supabase-js @supabase/ssr anthropic`
4. **Crée le schéma Supabase** en exécutant le SQL dans `supabase_schema.sql`
5. **Développe dans cet ordre** :
   - Auth (login/signup avec Supabase)
   - Layout + sidebar
   - Page groupes (CRUD)
   - API scraping + pipeline IA
   - Page annonces (liste + détail + filtres)
   - Dashboard avec stats
   - Intégration WhatsApp (canaux + envoi)
   - Cron jobs
   - Landing page
6. **Déploie sur Vercel** : `vercel deploy`

---

## Règles de code

- TypeScript strict partout
- Server Components par défaut, Client Components seulement quand nécessaire
- Utiliser les Server Actions pour les mutations
- Supabase côté serveur avec `createServerClient` (cookies)
- Supabase côté client avec `createBrowserClient`
- Validation des inputs avec Zod
- Gestion d'erreurs avec try/catch et messages utilisateur clairs
- Pas de `any` TypeScript
- Composants réutilisables dans `/src/components`
- Types dans `/src/types`
- Lib utilitaires dans `/src/lib`

# ImmoTracker SaaS

SaaS de suivi intelligent d'annonces immobilieres au Gabon.

## Fonctionnalites

- Scraping automatique des groupes Facebook (RapidAPI)
- Analyse IA des annonces avec Claude (extraction structuree)
- Stockage multi-tenant dans Supabase avec RLS
- Envoi automatique par WhatsApp (via WAHA)
- Dashboard web avec filtres et statistiques

## Demarrage rapide

### 1. Creer le projet Next.js

```bash
npx create-next-app@latest immo-tracker --typescript --tailwind --eslint --app --src-dir
cd immo-tracker
```

### 2. Copier les fichiers de ce dossier

- Copier `package.json` (ou fusionner les dependances)
- Copier `.env.example` en `.env.local` et remplir les cles

### 3. Installer les dependances

```bash
npm install
npx shadcn@latest init
```

### 4. Configurer Supabase

1. Creer un projet sur https://supabase.com
2. Aller dans SQL Editor
3. Coller et executer `supabase_schema.sql`
4. Recuperer URL + cles dans Settings > API

### 5. Developper avec Claude Code

Ouvrir le projet dans Claude Code et lui donner le contenu de `CLAUDE_CODE_PROMPT.md` comme prompt. Il contient toutes les specs pour coder le SaaS complet.

## Structure cible

```
immo-tracker/
├── src/
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/signup/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── annonces/page.tsx
│   │   │   ├── annonces/[id]/page.tsx
│   │   │   ├── groupes/page.tsx
│   │   │   ├── whatsapp/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   └── layout.tsx (sidebar + header)
│   │   ├── page.tsx (landing)
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/ (shadcn)
│   │   ├── sidebar.tsx
│   │   ├── annonce-card.tsx
│   │   ├── filter-bar.tsx
│   │   └── ...
│   ├── lib/
│   │   ├── supabase/client.ts
│   │   ├── supabase/server.ts
│   │   ├── supabase/middleware.ts
│   │   ├── ai/extract.ts
│   │   ├── scraper/facebook.ts
│   │   ├── whatsapp/send.ts
│   │   └── utils.ts
│   └── types/
│       └── index.ts
├── supabase_schema.sql
├── .env.local
└── package.json
```

## Stack

- Next.js 14+ (App Router) / TypeScript / Tailwind CSS / shadcn/ui
- Supabase (PostgreSQL + Auth + RLS)
- Claude API (analyse IA)
- RapidAPI Facebook Scraper3
- WhatsApp via WAHA (auto-heberge)
- Railway (deploiement)

## Collecte des groupes Facebook par flux RSS

La route `/api/cron/rss` lit les flux rss.app declares dans `RSS_FEED_URLS` (format JSON) et
enregistre les publications des groupes connus de l'application. Un flux ne contient que les
50 dernieres publications, sans historique : il faut donc le lire souvent (toutes les 15 minutes).
La reponse de la route signale `possibleGap` quand la plus ancienne publication du flux etait
encore inconnue, signe que des publications ont pu etre manquees, et `unknownGroups` pour les
groupes presents dans le flux mais absents de l'application. Le flux ne fournit qu'une image par
publication.

## Extraction et matching

- **Fiche normalisee** (`src/lib/extraction.ts`) : l'IA remplit un schema JSON ; tout champ important
  (prix, charges, caution, ville, quartier, adresse) doit etre justifie par un extrait present mot pour mot
  dans la publication, sinon il est remis a `null`. Aucune ville par defaut.
- **Contacts** (`src/lib/contacts.ts`) : telephones, liens WhatsApp et e-mails releves par expressions
  regulieres et normalises au format international ; l'IA ne fournit jamais de contact.
- **Matching** (`src/lib/matching.ts`) : deterministe, sans IA. Criteres bloquants (ville, transaction,
  budget, type, chambres), puis score 0-100 sur les preferences (quartiers, meuble, climatisation,
  parking, surface, mots-cles). Envoi si le score atteint le seuil de l'abonne (50 par defaut) ;
  doute sur le prix, la ville ou la transaction = annonce retenue pour verification.
- **Alertes** : plafond par jour (5), plage silencieuse (21h-7h, heure de Libreville), mode immediat ou
  resume quotidien, jamais deux fois la meme annonce au meme abonne.
- Non couvert pour l'instant : OCR des photos, transcription audio des videos, distance geographique.

Tests : `npm test` (Vitest).

## Deploiement sur Railway

Deux services dans le meme projet Railway, tous deux branches sur ce depot.

### 1. Service web

- Configuration lue automatiquement dans `railway.json` (build, demarrage, sonde `/api/health`).
- Variables : toutes celles de `.env.example`, avec `NEXT_PUBLIC_APP_URL` = domaine public du service.
- Les variables `NEXT_PUBLIC_*` sont figees au build : redeployer apres les avoir modifiees.

### 2. Service cron

Railway ne declenche pas d'URL : il relance la commande de demarrage d'un service selon un horaire.
Ce service execute `scripts/run-cron.mjs`, qui appelle dans l'ordre `/api/cron/scrape`,
`/api/cron/whatsapp` puis `/api/cron/demands` sur le service web, et se termine.

- Settings → Config-as-code : chemin `/railway.cron.json` (horaire `0 */4 * * *`, en UTC).
- Variables : `CRON_SECRET` (identique au service web) et `CRON_TARGET_URL`
  (domaine public du service web, ou son adresse privee `http://<service>.railway.internal:<port>`).

Test manuel depuis un poste :

```bash
CRON_TARGET_URL=https://votre-app.up.railway.app CRON_SECRET=... node scripts/run-cron.mjs
```

### 3. Base de donnees

Executer `supabase_schema.sql` en entier dans Supabase → SQL Editor (la partie « extension » est rejouable).

### 4. WhatsApp via WAHA

L envoi et la reception passent par [WAHA](https://waha.devlike.pro), un serveur WhatsApp auto-heberge
(image Docker `devlikeapro/waha`) relie a un numero en scannant un QR code.

Cote application (service web) :

- `WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_SESSION` : serveur, cle et session a utiliser.
- `WAHA_WEBHOOK_HMAC_KEY` : cle de signature des messages entrants (obligatoire pour le chatbot).
- `WAHA_OWNER_USER_ID` : compte destinataire des messages entrants, s il y a plusieurs comptes.

Cote serveur WAHA :

- `WAHA_API_KEY` : meme valeur que dans l application.
- `WHATSAPP_HOOK_URL=https://votre-app.up.railway.app/api/webhook/waha`
- `WHATSAPP_HOOK_EVENTS=message`
- `WHATSAPP_HOOK_HMAC_KEY` : meme valeur que `WAHA_WEBHOOK_HMAC_KEY`.
- Un volume persistant pour les sessions, sinon le QR code est a rescanner a chaque redemarrage.

Destinataires des canaux : un numero (`+24177123456`) ou un identifiant WAHA complet
(`1203...@g.us` pour un groupe, `...@newsletter` pour une chaine).

L etat de la connexion s affiche dans Parametres. WAHA pilote WhatsApp Web, ce n est pas l API
officielle : des envois en masse peuvent faire bloquer le numero
(voir https://waha.devlike.pro/docs/overview/how-to-avoid-blocking/).

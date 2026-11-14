# ImmoTracker SaaS

SaaS de suivi intelligent d'annonces immobilieres au Gabon.

## Fonctionnalites

- Scraping automatique des groupes Facebook (RapidAPI)
- Analyse IA des annonces avec Claude (extraction structuree)
- Stockage multi-tenant dans Supabase avec RLS
- Envoi automatique par WhatsApp (Business Cloud API)
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
- WhatsApp Business Cloud API
- Railway (deploiement)

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

### 4. Webhook WhatsApp (chatbot)

Chez Meta : URL `https://votre-app.up.railway.app/api/webhook/whatsapp`, jeton = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
`WHATSAPP_APP_SECRET` est obligatoire : sans lui le webhook refuse tous les messages.

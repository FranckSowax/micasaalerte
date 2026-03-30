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
- Vercel (deploiement)

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
- **Alertes** : plafond par jour (30), plage silencieuse (21h-7h, heure de Libreville), mode immediat ou
  resume quotidien, jamais deux fois la meme annonce au meme abonne.
- Non couvert pour l'instant : OCR des photos, transcription audio des videos.

- **Carte** (`/carte`, administration) : annonces localisees regroupees par lieu et secteurs des demandes
  clients, sur fond OpenStreetMap (Leaflet).
- **Demande client** (`/demande/[userId]`) : le client choisit un quartier ou touche la carte, puis regle
  un rayon de 1 a 5 km (1 km par defaut) ; les quartiers compris dans le rayon sont affiches.
- **Espace client** (`/c/[jeton]`) : `/api/cron/demands` envoie par WhatsApp un seul message par client et
  par passage, avec son lien personnel. La page liste les annonces deja filtrees selon ses criteres, avec
  les boutons WhatsApp, Appeler, Voir sur Facebook/TikTok, puis Conserver (vert) et Supprimer (rouge).
  Le lien est lie au premier appareil qui l'ouvre (cookie) : ouvert ailleurs, il est refuse, et le client
  peut demander un nouveau lien, envoye uniquement sur son numero WhatsApp (l'ancien est alors invalide).
  Elle est appelee toutes les heures par le service Railway `cron-alertes`.
- **Connexion de l'agent** (`src/lib/login-otp.ts`, `/api/auth/otp/*`) : code a 6 chiffres envoye sur le
  numero WhatsApp enregistre dans Parametres (valable 5 minutes, 5 essais, usage unique). Le code n'est
  pas stocke en base : le defi est un cookie signe. L'email et le mot de passe restent disponibles en
  secours (« Se connecter par email »), indispensables si la session WhatsApp est deconnectee.
- **Abonnement** (`src/lib/subscription.ts`) : 24 h d'essai gratuit a la premiere inscription, puis
  trois formules : 1 jour a 1 000 FCFA (48 h pendant la promo de lancement, constante `LAUNCH_PROMO`),
  7 jours a 5 000 FCFA, 30 jours a 15 000 FCFA. A l'expiration, le client ne recoit plus d'annonces et un seul message WhatsApp
  l'invite a renouveler. Dans son espace, il lit les consignes de paiement (`SUBSCRIPTION_PAYMENT_INFO`),
  choisit sa formule, paie par Mobile Money et saisit la reference de la transaction. L'agent verifie
  puis valide dans Clients (« Valider le paiement », ou « Activer » avec la formule de son choix) : les jours s'ajoutent a ce qui reste et le
  client est prevenu sur WhatsApp. Aucun paiement en ligne automatique pour l'instant.
- **Modification des criteres** : depuis son espace, le client modifie type, budget, chambres, secteur et
  exigences ; les nouveaux criteres s'appliquent aux envois suivants.

- **Perimetre** : seules les offres situees au Gabon deviennent des annonces. Les recherches de biens
  (« je cherche un studio ») et les biens a l'etranger sont ecartes.
- **Anti-doublons** (`src/lib/dedupe.ts`), par regles et sans IA : un texte quasi identique a une annonce
  des 30 derniers jours est rattache a celle-ci comme diffusion supplementaire, quel que soit le diffuseur
  (aucune analyse IA n'est alors consommee) ; meme fiche (transaction, type, prix, quartier) avec telephone
  commun ou texte proche = meme annonce ; meme texte avec un autre prix = mise a jour du prix et nouvelle
  version. Les doublons deja en base sont archives, jamais supprimes.
- **RapidAPI** : la collecte manuelle est desactivee et ses boutons masques. Pour la reactiver, definir
  `NEXT_PUBLIC_RAPIDAPI_COLLECT=true` et redeployer.

- **Localisation** (`src/lib/geo.ts`) : chaque annonce est placee sur un referentiel de lieux du Gabon
  (`src/data/gabon-places.json` : 109 quartiers et 29 localites de la zone de Libreville, 53 villes),
  tolerant aux variantes d'ecriture et aux fautes de frappe. Le quartier reconnu prend son nom officiel.
  Donnees © les contributeurs d'OpenStreetMap, licence ODbL.
- **Matching par rayon** : la preference de quartier compare une distance, pas un nom. Par defaut, 5 km
  autour du centre de chaque quartier prefere ; reglable par abonne (`geo_radius_km`), ou autour d'un
  point precis (`geo_lat`, `geo_lon`). Une annonce non localisable est comparee par son nom, comme avant.

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

# Prompt — Onglet « Diffusion » de Mi Casa Gabon (campagnes WhatsApp / Facebook / Instagram)

> Adaptation à Mi Casa Gabon du prompt générique « Diffusion multicanal » (Twinsk).
> Toutes les règles marquées **PIÈGE** du prompt d'origine restent valables : elles
> viennent de bugs réels. Ce document ne décrit que **ce qui change** pour Mi Casa Gabon
> et les valeurs du §0 ; pour le reste (verrou atomique, cadences, bilan par canal,
> journal, interface), le prompt d'origine fait foi.

---

## §0 — Adaptation (rempli)

| # | Point | Valeur Mi Casa Gabon |
|---|---|---|
| 1 | **Source des « produits »** | Les **annonces immobilières** (table `annonces`) des agents autorisés (`lib/agent-access`). Une « catégorie » = **un quartier**. Une annonce est publiable si : immobilière, non archivée, **moins de 60 h** (`lib/annonce-lifetime`), **prix connu**, **photo copiée dans le stockage Supabase** (lien permanent et public, `lib/photos.isStoredPhoto`). Ordre des quartiers : nombre d'annonces publiables décroissant, puis nom. |
| 2 | **WhatsApp non officiel** | **WAHA** (pas Whapi) : `POST /api/sendText`, `/api/sendImage`, `/api/sendVideo` (groupe `…@g.us`, chaîne `…@newsletter`), `POST /api/{session}/status/image|video` (statut), `GET /api/{session}/groups`, `GET /api/{session}/channels`, santé `GET /api/sessions/{session}` → **connecté = `status === "WORKING"`**. **Pas de boutons ni de fiche catalogue native** : l'échelle de repli du §5.1 se réduit à « image + légende avec le lien en clair ». |
| 3 | **Comptes Meta** | Page **Mi Casa Gabon** (portefeuille `micasagabon`). Variables Railway : `META_PAGE_ID`, `META_PAGE_TOKEN` (jeton de Page longue durée), `META_IG_USER_ID` (Instagram pro relié), `META_GRAPH_VERSION` (facultatif). Sans elles, Facebook / Instagram s'affichent « non configurés ». |
| 4 | **Stockage** | Nouvelles tables `wa_settings` (clé/valeur JSON) et `playbook_log` (journal), dans `supabase_schema.sql`. Clés : `diffusion:1` … `diffusion:12`, `diffusion_media`. |
| 5 | **Authentification admin** | Session Supabase + agent autorisé (`middleware` + `lib/agent-access`). Routes sous `/api/diffusion/…`. |
| 6 | **Fuseau et devise** | `Africa/Libreville` (`ALERT_TIMEZONE`), prix en **FCFA** (`formatPrice`). Rien en dur ailleurs. |
| 7 | **Canal d'alerte** | **WhatsApp de l'agent** (`profiles.whatsapp_phone`, comme l'alerte « paiement à vérifier »). Si WhatsApp est lui-même tombé : bandeau rouge dans l'onglet Diffusion + ligne au journal. |

## Ce qui change par rapport au prompt d'origine

- **Catalogue → quartiers.** `offer_id` est remplacé par `quartiers: string[]` (vide = tous
  les quartiers). Changer la liste remet le curseur produits à zéro.
- **Lien profond → inscription.** Il n'existe pas de fiche publique d'annonce : chaque
  publication renvoie vers `<site>/signup` avec `utm_source=<canal>` et
  `utm_campaign=diffusion-<n>`. Le but de la diffusion est de **faire inscrire** des abonnés.
- **Pas de numéro d'annonceur** dans les publications : l'abonné l'obtient dans son espace.
- **En-tête de créneau** : « 🏠 *Nouvelles annonces à {Quartier}* » + nombre + rappel du service.
- **Cron** : service Railway dédié `cron-diffusion` (`10 * * * *`, décalé du passage d'alertes
  de hh:04), protégé par `CRON_SECRET` comme les autres crons. Pas de planificateur interne
  (Railway cron suffit ; un passage manqué est rattrapé au créneau suivant).
- **Volume WhatsApp** : chaque message part par WAHA et est compté dans `whatsapp_logs`
  (compteur du tableau de bord). Le bloc de totaux de l'onglet rappelle les repères
  (500 / 1 000 messages par jour).
- **Cadences** : 1 500 ms entre deux messages WhatsApp, 4 000 ms entre deux annonces de la
  médiathèque, campagnes en série — inchangé.

## Critères d'acceptation (adaptés)

1. Je crée une campagne, je choisis un groupe WhatsApp, je laisse « tous les quartiers »,
   j'active les annonces à 9 h et 18 h : à 9 h 10 le groupe reçoit l'en-tête d'un quartier
   puis 3 annonces avec photo, prix et lien d'inscription.
2. Au créneau suivant, c'est le quartier suivant ; la boucle revient au début.
3. Une annonce de plus de 60 h, sans prix ou sans photo copiée ne part jamais.
4. Trois déclenchements dans la même heure : rien ne part deux fois.
5. WhatsApp déconnecté : alerte, Facebook / Instagram continuent s'ils sont configurés,
   bandeau rouge dans l'onglet.
6. Un groupe déjà pris par une campagne est refusé avec le nom de cette campagne.

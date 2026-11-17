# Prompt — Refonte de la carte d'annonce de l'espace client (`/c/[token]`)

> Version adaptée au code réel de Mi Casa Alerte (Next.js 15, Tailwind, Nunito Sans, lucide-react).
> À donner tel quel à Claude Code.

## CONTEXTE

L'espace client est la page que l'abonné ouvre depuis le lien WhatsApp :
`src/app/c/[token]/page.tsx`. La route est `/c/[token]` ; il n'existe pas de route `/c/demo`.

Le lien est lié à un appareil : un autre téléphone reçoit une erreur `403`. Pour tester sans
vrai abonné, on intercepte `GET /api/client/<token>` dans le navigateur avec des données
fictives. On ne crée pas de route de démo.

La page contient déjà, dans l'ordre :
- l'en-tête et le bloc abonnement ;
- les onglets « Pour vous / À vérifier / Intéressantes / Écartées » ;
- le bandeau des nouvelles annonces ;
- le bouton « Voir sur la carte », qui ouvre la carte Leaflet (`@/components/map`) ;
- la liste des cartes d'annonce ;
- la mention « Ce lien est personnel… ».

La carte d'annonce n'est pas un composant séparé. Elle est écrite en ligne dans
`visible.map(...)`, vers les lignes 836 à 971. Les photos passent par `PhotoGallery`
(lignes 24 à 70). Cette carte n'est utilisée nulle part ailleurs.

Les fenêtres de la carte Leaflet pointent vers `#annonce-<id>`. La carte doit donc garder son
`id` et sa classe `scroll-mt-4`.

## OBJECTIF UNIQUE

Refondre la présentation de la carte d'annonce : photo d'abord, carte plus compacte, une seule
action principale.

Ne changent pas :
- la stack et le modèle de données ;
- les routes et l'API `/api/client/[token]` ;
- le fonctionnement métier.

## CE QUI EXISTE ET DOIT ÊTRE RÉUTILISÉ (NE RIEN RECRÉER)

**Données (`ClientAnnonce`).** Champs disponibles :
- `images[]` / `image`, `typeOffre`, `typeBien`, `chambres`, `meuble`, `quartier`, `ville`, `resume` ;
- `prix` / `devise`, `doubts[]`, `withdrawn`, `publishedAt`, `sentAt` ;
- `postUrl`, `source` (`facebook` | `tiktok`), `whatsapp`, `telephone`, `status`, `feedback`.

Il n'y a **pas de champ titre** : il se construit à partir de ces données.

**Fonctions et états existants :**
- `act(id, "keep" | "remove" | "reset", feedback?)` met à jour l'écran tout de suite, puis annule
  si l'API échoue.
- `isNew(a)` décide du badge « Nouvelle annonce ».
- `tabOf(a)` place dans « À vérifier » une annonce `new` qui a des `doubts`.
- `REFUSAL_REASONS` : « Pas pour moi » ouvre le choix des raisons et ne retire pas l'annonce
  directement. Ce comportement reste.
- Suivi après contact : `contacts`, `followupsDone`, `markContacted`, `closeFollowup`. Il affiche
  le bloc « Vous avez contacté l'annonceur. Où en êtes-vous ? » avec trois choix : Visite prévue,
  Pas de réponse, Déjà loué ou vendu.
- `contactMessage(a)` prépare le message WhatsApp pré-rempli.
- `hint` / `hintOnce` affichent une bulle temporaire de 8 secondes. C'est le seul système de
  notification : on s'appuie dessus, sans bibliothèque de toasts.

**Utilitaires, composants et police :**
- `formatPrice`, `formatDate`, `getTypeBienLabel` et `getTypeOffreLabel` (`@/lib/utils`) ;
- les composants `Button`, `Badge` et `Card`, et les icônes lucide-react ;
- la police Nunito Sans (`font`), partagée avec l'inscription. **On ne passe pas à DM Sans.**

## ÉTAPE OBLIGATOIRE AVANT TOUT CODE

1. Relire en entier `src/app/c/[token]/page.tsx`, `src/components/client-onboarding.tsx` et
   `src/lib/utils.ts`.
2. Lister les fichiers qui seront modifiés, puis implémenter.
3. N'ajouter aucune dépendance.

## 1. PÉRIMÈTRE

**On ne touche pas** aux onglets, au bandeau des nouvelles annonces, à « Voir sur la carte », à la
carte Leaflet, à l'abonnement, aux critères ni au lien personnel.

**On modifie** uniquement l'intérieur de la carte et `PhotoGallery` :
- aucune photo générique, aucun prix, numéro ou lien inventé ;
- suppression des étapes numérotées 1, 2, 3 (`step(...)`) et du grand bandeau ambre des `doubts`.

**Visite guidée (`client-onboarding.tsx`) :** son titre « À chaque annonce, 3 étapes » et ses
puces décrivent l'ancienne carte. Il faut les mettre à jour pour la nouvelle.

## 2. STRUCTURE DE LA CARTE (dans l'ordre)

### A. Média (`PhotoGallery` modifiée)

**Photo :**
- Ratio `aspect-[16/10]` au lieu de `h-56`, avec `object-cover` et `object-position: 50% 54%`.
- **On garde la galerie à glisser**, le compteur « 2 / 5 », les points et le retrait des photos
  cassées.
- Léger dégradé sombre, seulement dans le bas de la photo.
- Texte alternatif construit avec le titre : « Photo 1 sur 3 : Maison à Angondjé, Akanda ».

**Éléments posés sur la photo :**
- En haut à gauche, le badge « Nouvelle annonce », seulement si `isNew(a)`.
- En haut à droite, le compteur.
- En bas au centre, les points, qui ne doivent pas passer sous le bouton source.
- En bas à droite, le bouton source.

**Bouton source :** il ouvre `postUrl` dans un nouvel onglet, comme aujourd'hui. Il n'existe pas
de modale vidéo et on n'en crée pas.
- `tiktok` : « Voir la vidéo », icône Play, fond noir translucide avec un léger flou.
- `facebook` : « Voir l'annonce », icône ExternalLink, fond bleu Facebook `#1877F2`. C'est la
  couleur de plateforme demandée précédemment. On n'imite pas le logo.

**Annonce sans photo :** pas de zone média. Le bouton source descend dans le contenu, en bouton
secondaire pleine largeur.

### B. Bandeau « retirée »

Si `a.withdrawn` existe, on garde la mention rouge actuelle en tête du contenu. Elle est
indispensable.

### C. Contenu principal

- **Métadonnées en capitales :** `LOCATION · MAISON · MEUBLÉ`, à partir de `typeOffre`,
  `typeBien` et `meuble`. On omet ce qui manque.
- **Titre :** `getTypeBienLabel(typeBien)`, suivi de « N chambres » si `chambres` existe
  (exemple : « Maison 3 chambres »). Rien qui ne soit pas dans les données : pas de « avec
  jardin » inventé.
- **Lieu**, avec l'icône MapPin : « Angondjé, Akanda · 3 ch. ». S'il manque : « Lieu non
  précisé ».
- **Description :** `resume` sur 2 lignes au plus (`line-clamp-2`), sauf s'il répète le titre.

Le titre et les métadonnées sont construits par des fonctions pures, dans un petit fichier
`src/lib/client-card.ts`, couvert par des tests.

### D. Prix et informations à vérifier

**Prix connu :** le prix formaté, grand et en gras, sans avertissement.

**Prix absent :**
- « Prix à confirmer », avec à droite une pastille ambre « À vérifier » ;
- en dessous, une seule ligne : « Le prix n'a pas été indiqué par l'annonceur. »

**Autres `doubts` :** « Prix non indiqué » est déjà couvert par le bloc prix. Les autres doutes
tiennent sur une seule ligne ambre discrète sous le prix, par exemple « À vérifier : lieu
imprécis ». « Prix non indiqué » ne doit jamais apparaître deux fois.

### E. Action principale

Bouton vert pleine largeur, `min-h-[54px]`, `rounded-full`. Le comportement de chaque bouton est
celui d'aujourd'hui. Seuls les libellés changent :

| Données | Bouton principal | Lien secondaire (petit, sous le bouton) |
|---|---|---|
| `whatsapp`, prix connu | « Demander une visite » (WhatsApp pré-rempli) | « Ou appeler » si `telephone` |
| `whatsapp`, prix absent | « Demander le prix sur WhatsApp » | « Ou appeler » si `telephone` |
| `telephone` seul, prix connu | « Appeler l'annonceur » | — |
| `telephone` seul, prix absent | « Appeler pour confirmer le prix » | — |
| ni l'un ni l'autre | Bouton source (Facebook ou TikTok), libellé « Contacter via l'annonce » | — |
| déjà contacté | « Relancer sur WhatsApp » | inchangé |

Ce qui reste comme aujourd'hui :
- `markContacted(a.id)` sur chaque clic ;
- la phrase « Le message est déjà écrit : vous n'avez qu'à l'envoyer. » ;
- le bloc de suivi « Où en êtes-vous ? » au-dessus de l'action principale quand il s'applique, sans
  changement de fonctionnement.

### F. Date, puis choix

**Date :** centrée, « Publiée le 17 nov. 2026 · 11:18 », à partir de `publishedAt`. Rien si elle
est absente. On ajoute un formateur dédié dans `client-card.ts` sans toucher à `formatDate`, qui
sert ailleurs.

**Choix :** un filet fin, le libellé « Votre choix », puis deux boutons sur une ligne
(`min-h-[48px]`, `rounded-full`, avec `aria-pressed`). Sous 360 px, ils passent en colonne.

« Ça m'intéresse » :
- appuyé (vert plein) quand `status === "kept"` ;
- un appui lance `act(id, "keep", "pertinente")` ;
- un nouvel appui quand il est déjà appuyé lance `act(id, "reset")`, et l'annonce revient dans
  « Pour vous ».

« Pas pour moi » :
- appuyé (neutre foncé) quand `status === "removed"` ;
- un appui ouvre le choix des raisons, comme aujourd'hui ;
- un nouvel appui quand il est déjà appuyé lance `act(id, "reset")`, ce qui restaure l'annonce.

Ces deux boutons remplacent « Remettre dans Pour vous » et « Restaurer ». Dans « Écartées », la
ligne « Votre avis : … » reste.

**Bulle après un écart :** « Annonce écartée », avec un bouton « Annuler » branché sur
`act(id, "reset")`. Elle s'appuie sur l'état `hint` existant, auquel on ajoute une action
facultative. Elle remplace `hintOnce("mca-astuce-ecart")` seulement pour cet écart.

## 3. SYSTÈME VISUEL : charte Mi Casa, pas la palette beige de l'aperçu

On garde les couleurs de la marque déjà présentes sur la page. Correspondance avec le prompt
d'origine :

| Rôle | Prompt d'origine | À utiliser |
|---|---|---|
| Fond de page | `#F0EFED` | fond actuel `theme-light` (inchangé) |
| Surface carte | `#FAF8F5` | blanc (`Card`) |
| Texte principal | `#2D2420` | encre `#14241B` |
| Texte secondaire | brun-gris | `text-muted-foreground` |
| Vert principal | `#4A6741` | `#137638`, survol `#0F5F2D` |
| Vert clair (choix) | — | `#F5F8F6` / `#EEF2EF` |
| WhatsApp | — | `#22C55E` avec texte encre `#14241B` (règle déjà en place) |
| Ambre « À vérifier » | `#995C00` | `text-amber-800` sur fond `bg-amber-50` |
| Bordures | `#E1DCD5` | `border-border` |

Dimensions, reprises du prompt d'origine :

| Élément | Valeur |
|---|---|
| Carte | rayon 24 px, bordure 1 px, `max-w-[446px] mx-auto` |
| Ombre de la carte | `0 18px 55px rgba(20,36,27,.09), 0 2px 8px rgba(20,36,27,.04)` |
| Padding du contenu | 22 px (18 px sous 375 px) |
| Titre | 23 à 26 px, `font-semibold`, interligne 1.18, `tracking-[-0.03em]` |
| Hauteurs de boutons | principal 54 px, choix 48 px, bouton sur la photo 44 px |

Pas d'emoji dans la carte : uniquement des icônes lucide-react, avec `aria-hidden="true"`.

## 4. INTERACTIONS ET ACCESSIBILITÉ

- **États :** survol, `active:scale-[.98]`, `focus-visible:ring-2` vert, et `disabled` quand
  `busy === a.id`.
- **Transitions :** 160 à 240 ms, uniquement sur l'opacité, la transformation et la couleur de
  fond. Elles sont désactivées avec `motion-reduce:transition-none`.
- **Pas d'action factice :** aucun `href="#"` et aucun bouton sans action.
- **Taille des cibles :** au moins 44 px.
- **Largeur :** aucun défilement horizontal de la page à 375 px. La galerie défile à l'intérieur
  de son cadre.

## TESTS ET CRITÈRES D'ACCEPTATION

**Tests unitaires (Vitest) sur `src/lib/client-card.ts` :**
- titre, métadonnées et date ;
- choix du bouton principal pour chaque ligne du tableau E ;
- une annonce sans prix ne mentionne le prix qu'une seule fois.

**Contrôles de compilation :**
- `npx vitest run` doit être vert.
- `npx tsc --noEmit` ne doit montrer aucune nouvelle erreur. Les erreurs de `ad-quality.ts` et
  `diffusion-runner.ts` existent déjà et sont connues.
- `next lint` et `next dev` peuvent réécrire `tsconfig.json` en y ajoutant `"target"`. Dans ce
  cas, remettre le fichier d'origine.

**Vérification dans le navigateur, avec des données interceptées.** Quatre types d'annonce :
- une annonce TikTok sans prix, avec un téléphone seul (Angondjé, Akanda) ;
- une annonce Facebook avec prix, WhatsApp, téléphone et plusieurs photos ;
- une annonce sans photo et sans contact ;
- une annonce gardée et une annonce écartée.

À contrôler sur ces annonces :
- largeurs 375, 390, 768, 1024 et 1440 px ;
- navigation au clavier et `aria-pressed` ;
- la bulle « Annuler » ;
- le lien `#annonce-<id>` depuis la carte Leaflet ;
- aucune erreur dans la console.

**Pour finir :** une capture mobile et la liste des fichiers modifiés.

**Ne pas commiter ni déployer sans accord.** Le déploiement se fait par rsync vers le dépôt
séparé.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { Nunito_Sans } from "next/font/google";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Copy, ExternalLink, Flag, ThumbsDown, ThumbsUp, Home, Loader2, LogOut, MapPin, MessageCircle, Phone, RotateCcw, SlidersHorizontal, Sparkles, Wallet, X } from "lucide-react";
import { criteriaError, CriteriaFields, criteriaPayload, EMPTY_CRITERIA, exigencesAreStrict, MAX_RADIUS_KM, MIN_RADIUS_KM, parseExigences, type CriteriaValue } from "@/components/criteria-form";
import { Map, type MapMarker } from "@/components/map";
import { ZONE_COLOR } from "@/lib/map-format";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/lib/geo";
import { formatDate, formatPrice, getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";

// Même police et même thème clair que l'inscription : l'abonné ne change pas d'univers.
const font = Nunito_Sans({ subsets: ["latin"], display: "swap", adjustFontFallback: false });

/**
 * Photos d'une annonce. Plusieurs photos : galerie à faire glisser horizontalement, avec un
 * compteur. Une photo qui ne charge plus (lien expiré) est retirée sans laisser de trou.
 */
function PhotoGallery({ photos }: { photos: string[] }) {
  const [broken, setBroken] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const shown = photos.filter((p) => !broken.includes(p));
  if (!shown.length) return null;

  return (
    <div className="relative bg-muted">
      <div
        className="flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={shown.length > 1 ? `${shown.length} photos de l'annonce, faites glisser pour les voir` : "Photo de l'annonce"}
        tabIndex={shown.length > 1 ? 0 : -1}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {shown.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={`Photo ${i + 1} sur ${shown.length}`}
            className="w-full h-56 shrink-0 snap-center object-cover"
            loading="lazy"
            onError={() => setBroken((list) => (list.includes(src) ? list : [...list, src]))}
          />
        ))}
      </div>
      {shown.length > 1 && (
        <>
          <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2.5 py-1 text-xs font-bold text-white" aria-hidden="true">
            {Math.min(index, shown.length - 1) + 1} / {shown.length}
          </span>
          <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5" aria-hidden="true">
            {shown.map((src, i) => (
              <span key={src} className={`h-2 w-2 rounded-full ${i === index ? "bg-white" : "bg-white/50"} shadow`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Temps restant avant la fin de l'essai gratuit ou de l'abonnement, mis à jour chaque seconde.
 * À zéro, `onEnd` recharge l'espace pour afficher « Accès terminé ».
 *
 * @example remainingParts(90_061_000) // { days: 1, hours: 1, minutes: 1, seconds: 1 }
 */
function remainingParts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { days: Math.floor(total / 86400), hours: Math.floor((total % 86400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

function Countdown({ endsAt, label, onEnd }: { endsAt: string; label: string; onEnd: () => void }) {
  const end = Date.parse(endsAt);
  // Null au premier rendu : le serveur et le navigateur n'ont pas la même heure à la seconde près.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = now === null ? null : end - now;
  useEffect(() => {
    if (left !== null && left <= 0) onEnd();
    // onEnd change d'identité à chaque rendu : seul le passage à zéro doit le déclencher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left !== null && left <= 0]);

  if (left === null || Number.isNaN(end) || left <= 0) return null;
  const { days, hours, minutes, seconds } = remainingParts(left);
  const pad = (n: number) => String(n).padStart(2, "0");
  const cells = days > 0
    ? [{ v: String(days), u: days > 1 ? "jours" : "jour" }, { v: pad(hours), u: "h" }, { v: pad(minutes), u: "min" }]
    : [{ v: pad(hours), u: "h" }, { v: pad(minutes), u: "min" }, { v: pad(seconds), u: "s" }];
  const urgent = left < 3 * 3600 * 1000;
  const spoken = days > 0 ? `${days} jour${days > 1 ? "s" : ""} ${hours} heures` : `${hours} heures ${minutes} minutes`;

  return (
    <div className={`rounded-xl border-2 px-4 py-3 ${urgent ? "border-destructive bg-destructive/10" : "border-primary bg-primary/10"}`} role="timer" aria-label={`${label} : ${spoken}`}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 flex items-baseline gap-3" aria-hidden="true">
        {cells.map((cell) => (
          <span key={cell.u} className="flex items-baseline gap-1">
            <span className={`text-3xl font-extrabold tabular-nums ${urgent ? "text-destructive" : "text-primary"}`}>{cell.v}</span>
            <span className="text-sm font-semibold text-muted-foreground">{cell.u}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

type ClientStatus = "new" | "kept" | "removed";

/** Onglets : « check » regroupe les annonces à trier auxquelles il manque une information. */
type Tab = ClientStatus | "check";

interface ClientAnnonce {
  id: string;
  status: ClientStatus;
  /** Informations manquantes, en clair (ex. « Prix non indiqué »). */
  doubts?: string[];
  /** Avis donné par l'abonné (pertinente, ou la raison du refus). */
  feedback?: string | null;
  /** Mention affichée quand l'annonce a été retirée pour tous les abonnés. */
  withdrawn?: string | null;
  sentAt: string | null;
  typeOffre: string | null;
  typeBien: string | null;
  prix: number | null;
  devise: string | null;
  quartier: string | null;
  ville: string | null;
  chambres: number | null;
  meuble: boolean | null;
  resume: string | null;
  image: string | null;
  images?: string[];
  postUrl: string | null;
  source: "facebook" | "tiktok";
  telephone: string | null;
  whatsapp: string | null;
  publishedAt: string | null;
  geo: { lat: number; lon: number; lieu: string } | null;
}

interface Subscription {
  status: "trial" | "active" | "expired";
  endsAt: string | null;
  price: number;
  days: number;
  plans?: { id: string; label: string; price: number; days: number; note?: string }[];
  trialHours: number;
  payment?: { reference: string; operator: string; ussd: string; code: string; name: string; contact: string } | null;
  pendingPayment: boolean;
}

interface Criteria {
  typeOffre: string[];
  typeBien: string[];
  prixMin: number | null;
  prixMax: number | null;
  chambresMin: number | null;
  quartiers?: string[];
  exigences: string;
  geoLat: number | null;
  geoLon: number | null;
  radiusKm: number | null;
}

/** Critères enregistrés → valeurs du formulaire de modification. */
function toCriteriaValue(c: Criteria | undefined): CriteriaValue {
  if (!c) return EMPTY_CRITERIA;
  const hasZone = typeof c.geoLat === "number" && typeof c.geoLon === "number";
  return {
    type_offre: c.typeOffre || [],
    type_bien: c.typeBien || [],
    prix_min: c.prixMin ? String(c.prixMin) : "",
    prix_max: c.prixMax ? String(c.prixMax) : "",
    nb_chambres_min: c.chambresMin ? String(c.chambresMin) : "",
    exigences: parseExigences(c.exigences),
    exigencesStrict: exigencesAreStrict(c.exigences),
    // Avec un point sur la carte, les quartiers enregistrés en sont déduits : on ne les réaffiche pas.
    quartiers: hasZone ? [] : c.quartiers || [],
    zone: hasZone ? { lat: c.geoLat as number, lon: c.geoLon as number, label: "Votre secteur" } : null,
    radius: Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Math.round(c.radiusKm || EMPTY_CRITERIA.radius))),
  };
}

interface ClientSpace {
  clientName: string | null;
  subscription?: Subscription;
  criteria?: Criteria;
  zones: { lat: number; lon: number; radiusKm: number; label: string }[];
  annonces: ClientAnnonce[];
}

/** Clé de la mémoire locale où l'appareil garde la date de la dernière visite. */
const LAST_VISIT_KEY = "mca-derniere-visite";

/** Raisons proposées après « Pas pertinente ». */
const REFUSAL_REASONS = [
  { id: "prix", label: "Le prix" },
  { id: "quartier", label: "Le quartier" },
  { id: "type", label: "Le type de bien" },
  { id: "equipement", label: "Les équipements" },
];
const FEEDBACK_LABELS: Record<string, string> = {
  prix: "le prix ne convient pas",
  quartier: "le quartier ne convient pas",
  type: "le type de bien ne convient pas",
  equipement: "les équipements ne conviennent pas",
  indisponible: "bien déjà loué ou vendu",
  arnaque: "annonce signalée comme arnaque",
};

/** Onglet d'une annonce : une annonce non triée avec un doute va dans « À vérifier ». */
const tabOf = (a: ClientAnnonce): Tab => (a.status === "new" && a.doubts?.length ? "check" : a.status);

const TABS: { key: Tab; label: string }[] = [
  { key: "new", label: "Pour vous" },
  { key: "check", label: "À vérifier" },
  { key: "kept", label: "Pertinentes" },
  { key: "removed", label: "Écartées" },
];

/** Espace personnel d'un client : ses annonces, à contacter et à trier. */
export default function ClientSpacePage({ params }: { params: { token: string } }) {
  const [space, setSpace] = useState<ClientSpace | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "other_device" | "error">("loading");
  const [tab, setTab] = useState<Tab>("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [relink, setRelink] = useState<"idle" | "sending" | "sent" | "limited">("idle");
  const [panel, setPanel] = useState<"none" | "criteria" | "payment">("none");
  const [criteria, setCriteria] = useState<CriteriaValue>(EMPTY_CRITERIA);
  const [plan, setPlan] = useState("day");
  const [copied, setCopied] = useState(false);
  const [showMap, setShowMap] = useState(false);

  /** Copie la référence de commande, à coller dans le menu Airtel Money. */
  const copyReference = async (reference: string) => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Presse-papiers refusé : la référence reste affichée en grand, à recopier.
    }
  };
  const [leaving, setLeaving] = useState(false);
  // Annonce pour laquelle l'abonné choisit la raison de « Pas pertinente ».
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  // Déconnexion : l'appareil n'est plus lié à l'espace ; retour par le lien WhatsApp ou par un code.
  const logout = async () => {
    setLeaving(true);
    try {
      const res = await fetch(`/api/client/${params.token}/logout`, { method: "POST" });
      if (res.ok) {
        window.location.assign("/login");
        return;
      }
      setNotice({ ok: false, text: "Déconnexion impossible. Réessayez." });
    } catch {
      setNotice({ ok: false, text: "Connexion impossible. Réessayez." });
    }
    setLeaving(false);
  };
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/${params.token}`, { cache: "no-store" });
      if (res.ok) {
        setSpace(await res.json());
        setState("ready");
      } else if (res.status === 403) setState("other_device");
      else if (res.status === 404) setState("invalid");
      else setState("error");
    } catch {
      setState("error");
    }
  }, [params.token]);

  useEffect(() => {
    load();
  }, [load]);

  // Dernière visite, gardée sur l'appareil : ce qui est arrivé depuis porte le badge « Nouvelle
  // annonce ». Lue une seule fois par ouverture de la page, pour que les badges restent affichés
  // pendant toute la visite ; undefined tant qu'elle n'est pas lue.
  const [lastVisit, setLastVisit] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (state !== "ready" || lastVisit !== undefined) return;
    let previous: number | null = null;
    try {
      const stored = Number(localStorage.getItem(LAST_VISIT_KEY));
      previous = Number.isFinite(stored) && stored > 0 ? stored : null;
      localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    } catch {
      // Mémoire locale indisponible (navigation privée) : tout ce qui est à trier compte comme nouveau.
    }
    setLastVisit(previous);
  }, [state, lastVisit]);

  /** Annonce encore à trier, arrivée depuis la dernière visite (ou première visite). */
  const isNew = (a: ClientAnnonce) => {
    if (a.status !== "new" || lastVisit === undefined) return false;
    if (lastVisit === null) return true;
    const sent = a.sentAt ? Date.parse(a.sentAt) : NaN;
    return !Number.isNaN(sent) && sent > lastVisit;
  };
  // Nouvelles annonces réparties par onglet : sûres (« Pour vous ») ou à une information près (« À vérifier »).
  const newOnes = (space?.annonces || []).filter(isNew);
  const newForYou = newOnes.filter((a) => tabOf(a) === "new").length;
  const newToCheck = newOnes.filter((a) => tabOf(a) === "check").length;
  const newCount = newForYou + newToCheck;

  const act = async (annonceId: string, action: "keep" | "remove" | "reset", feedback?: string) => {
    if (!space) return;
    setBusy(annonceId);
    setReasonFor(null);
    const next: ClientStatus = action === "keep" ? "kept" : action === "remove" ? "removed" : "new";
    const previous = space;
    // Mise à jour immédiate à l'écran, annulée si l'enregistrement échoue.
    setSpace({ ...space, annonces: space.annonces.map((a) => (a.id === annonceId ? { ...a, status: next, feedback: action === "reset" ? null : feedback ?? null } : a)) });
    try {
      const res = await fetch(`/api/client/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annonceId, action, ...(feedback ? { feedback } : {}) }),
      });
      if (!res.ok) setSpace(previous);
    } catch {
      setSpace(previous);
    }
    setBusy(null);
  };

  const openCriteria = () => {
    setCriteria(toCriteriaValue(space?.criteria));
    setNotice(null);
    setPanel(panel === "criteria" ? "none" : "criteria");
  };

  const saveCriteria = async () => {
    const problem = criteriaError(criteria);
    if (problem) {
      setNotice({ ok: false, text: problem });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/client/${params.token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(criteriaPayload(criteria)),
      });
      if (res.ok) {
        setPanel("none");
        const data = await res.json().catch(() => ({}));
        const added = typeof data.added === "number" ? data.added : 0;
        setNotice({
          ok: true,
          text: added > 0
            ? `Critères enregistrés. ${added} annonce${added > 1 ? "s correspondent" : " correspond"} déjà à votre nouvelle recherche.`
            : "Critères enregistrés. Aucune annonce récente ne correspond pour l'instant : les prochaines arriveront sur WhatsApp.",
        });
        setTab("new");
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        setNotice({ ok: false, text: data.error || "Enregistrement impossible" });
      }
    } catch {
      setNotice({ ok: false, text: "Connexion impossible. Réessayez." });
    }
    setSaving(false);
  };

  const declarePayment = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/client/${params.token}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (res.ok) {
        setPanel("none");
        setNotice({ ok: true, text: "Paiement déclaré. Dès qu'il est vérifié, vous recevez un message WhatsApp et votre abonnement démarre." });
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        setNotice({ ok: false, text: data.error || "Enregistrement impossible" });
      }
    } catch {
      setNotice({ ok: false, text: "Connexion impossible. Réessayez." });
    }
    setSaving(false);
  };

  const askNewLink = async () => {
    setRelink("sending");
    try {
      const res = await fetch(`/api/client/${params.token}/relink`, { method: "POST" });
      setRelink(res.status === 429 ? "limited" : "sent");
    } catch {
      setRelink("idle");
    }
  };

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { new: 0, check: 0, kept: 0, removed: 0 };
    for (const a of space?.annonces || []) c[tabOf(a)]++;
    return c;
  }, [space]);

  const visible = useMemo(() => (space?.annonces || []).filter((a) => tabOf(a) === tab), [space, tab]);

  // Zones de recherche : mêmes objets d'un rendu à l'autre, pour ne pas recadrer la carte sans raison.
  const zoneCircles = useMemo(
    () => (space?.zones || []).map((z, i) => ({ id: `zone-${i}`, lat: z.lat, lon: z.lon, radiusKm: z.radiusKm, color: ZONE_COLOR, label: z.label })),
    [space]
  );
  const mappedCount = useMemo(() => visible.filter((a) => a.geo).length, [visible]);

  const markers = useMemo<MapMarker[]>(() => {
    const groups: Record<string, { lat: number; lon: number; lieu: string; items: ClientAnnonce[] }> = {};
    for (const a of visible) {
      if (!a.geo) continue;
      const key = `${a.geo.lat},${a.geo.lon}`;
      (groups[key] = groups[key] || { ...a.geo, items: [] }).items.push(a);
    }
    return Object.entries(groups).map(([id, g]) => ({
      id,
      lat: g.lat,
      lon: g.lon,
      count: g.items.length,
      // Annonces écartées : marqueurs estompés ; sinon couleur de la transaction.
      muted: tab === "removed",
      title: `${g.lieu} — ${g.items.length} annonce${g.items.length > 1 ? "s" : ""}`,
      items: g.items.map((a) => ({
        id: a.id,
        title: [getTypeBienLabel(a.typeBien), a.chambres ? `${a.chambres} ch.` : null, a.meuble ? "meublé" : null].filter(Boolean).join(" · "),
        prix: a.prix,
        devise: a.devise,
        typeOffre: a.typeOffre,
        photo: a.images?.[0] || a.image,
        href: `#annonce-${a.id}`,
        isNew: isNew(a),
      })),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tab, lastVisit]);

  if (state === "loading") {
    return (
      <div className={`theme-light ${font.className} min-h-screen flex items-center justify-center`}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state !== "ready" || !space) {
    return (
      <div className={`theme-light ${font.className} min-h-screen flex items-center justify-center px-4`}>
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8 space-y-4">
            <Home className="h-10 w-10 text-primary mx-auto" />
            {state === "other_device" ? (
              <>
                <h1 className="text-xl font-bold">Ce lien est déjà utilisé sur un autre appareil</h1>
                <p className="text-muted-foreground text-sm">
                  Votre lien est personnel et ne fonctionne que sur l&apos;appareil qui l&apos;a ouvert en premier. Si c&apos;est bien le vôtre, recevez un
                  nouveau lien sur votre numéro WhatsApp.
                </p>
                {relink === "sent" ? (
                  <p className="text-sm text-primary">Si ce lien est valide, un nouveau lien vient d&apos;être envoyé sur WhatsApp.</p>
                ) : relink === "limited" ? (
                  <p className="text-sm text-destructive">Trop de demandes. Réessayez dans une heure.</p>
                ) : (
                  <Button onClick={askNewLink} disabled={relink === "sending"} className="w-full">
                    {relink === "sending" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                    Recevoir un nouveau lien sur WhatsApp
                  </Button>
                )}
              </>
            ) : state === "invalid" ? (
              <>
                <h1 className="text-xl font-bold">Lien invalide ou expiré</h1>
                <p className="text-muted-foreground text-sm">Utilisez le dernier lien reçu sur WhatsApp, ou reconnectez-vous avec un code.</p>
                <a href="/login" className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium w-full">
                  Me connecter
                </a>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold">Chargement impossible</h1>
                <Button onClick={() => { setState("loading"); load(); }} variant="outline">Réessayer</Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`theme-light ${font.className} min-h-screen px-4 py-6`}>
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <BrandLogo variant="green" className="h-11 w-auto" priority />
            <p className="text-sm text-muted-foreground truncate">{space.clientName ? `Les annonces de ${space.clientName}` : "Vos annonces"}</p>
          </div>
          <Button variant="outline" size="sm" onClick={logout} disabled={leaving}>
            {leaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <LogOut className="h-4 w-4 mr-1" />} Déconnexion
          </Button>
        </header>

        {space.subscription && (() => {
          const sub = space.subscription;
          const plans = sub.plans?.length ? sub.plans : [{ id: "day", label: `${sub.days} jours`, price: sub.price, days: sub.days }];
          const chosen = plans.find((p) => p.id === plan) || plans[0];
          const price = `abonnement à partir de ${plans[0].price.toLocaleString("fr-FR")} FCFA`;
          const until = sub.endsAt ? formatDate(sub.endsAt) : null;
          return (
            <Card className={sub.status === "expired" ? "border-red-500/50" : ""}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={sub.status === "expired" ? "bg-red-600 text-white" : sub.status === "trial" ? "bg-amber-500 text-black" : ""}>
                    {sub.status === "trial" ? "Essai gratuit" : sub.status === "active" ? "Abonnement actif" : "Accès terminé"}
                  </Badge>
                  <p className="text-sm">
                    {sub.status === "trial" && until && `Jusqu'au ${until}. Ensuite : ${price}.`}
                    {sub.status === "active" && (until ? `Vous recevez les annonces jusqu'au ${until}.` : "Vous recevez les annonces.")}
                    {sub.status === "expired" && `Vous ne recevez plus de nouvelles annonces. Renouvelez : ${price}.`}
                  </p>
                </div>

                {sub.status !== "expired" && sub.endsAt && (
                  <Countdown
                    endsAt={sub.endsAt}
                    label={sub.status === "trial" ? "Essai gratuit : temps restant" : "Abonnement : temps restant"}
                    onEnd={load}
                  />
                )}

                {sub.pendingPayment && (
                  <p className="text-sm text-primary">Paiement déclaré, en attente de validation. Vous serez prévenu sur WhatsApp.</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={sub.status === "expired" ? "default" : "outline"} onClick={() => { setNotice(null); setPanel(panel === "payment" ? "none" : "payment"); }}>
                    <Wallet className="h-4 w-4 mr-1" /> {sub.status === "active" ? "Prolonger" : "S'abonner"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={openCriteria}>
                    <SlidersHorizontal className="h-4 w-4 mr-1" /> Modifier mes critères
                  </Button>
                </div>

                {panel === "payment" && (
                  <div className="space-y-3 pt-3 border-t border-border">
                    <p className="text-sm font-medium">Choisissez votre formule :</p>
                    <div className="grid gap-2">
                      {plans.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={p.id === chosen.id}
                          onClick={() => setPlan(p.id)}
                          className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm text-left transition-colors ${p.id === chosen.id ? "border-primary bg-primary/10" : "border-input hover:bg-accent"}`}
                        >
                          <span>
                            <span className="font-medium">{p.label}</span>
                            {p.note && <span className="block text-xs text-muted-foreground">{p.note}</span>}
                          </span>
                          <span className="font-bold whitespace-nowrap">{p.price.toLocaleString("fr-FR")} FCFA</span>
                        </button>
                      ))}
                    </div>
                    {sub.payment ? (
                      <>
                        <div className="rounded-xl border-2 border-primary bg-primary/10 px-4 py-3 text-center">
                          <p className="text-sm font-semibold">Votre référence de commande</p>
                          <p className="text-3xl font-extrabold tracking-wider text-primary" translate="no">{sub.payment.reference}</p>
                          <Button variant="outline" size="sm" className="mt-2" onClick={() => copyReference(sub.payment!.reference)}>
                            <Copy className="h-4 w-4 mr-1" /> {copied ? "Copiée" : "Copier la référence"}
                          </Button>
                        </div>

                        <div>
                          <p className="text-sm font-semibold mb-2">Payez par {sub.payment.operator} :</p>
                          <ol className="space-y-2 text-sm list-decimal pl-5">
                            <li>Composez <span className="font-bold" translate="no">{sub.payment.ussd}</span> sur votre téléphone.</li>
                            <li>Tapez <span className="font-bold">3</span> : Paiement.</li>
                            <li>Tapez <span className="font-bold">10</span> : Autres.</li>
                            <li>Entrez le code marchand <span className="font-bold" translate="no">{sub.payment.code}</span> ({sub.payment.name}).</li>
                            <li>Entrez le montant : <span className="font-bold">{chosen.price.toLocaleString("fr-FR")}</span> FCFA.</li>
                            <li>Entrez en référence : <span className="font-bold" translate="no">{sub.payment.reference}</span>.</li>
                            <li>Validez avec votre code secret Airtel Money.</li>
                          </ol>
                        </div>

                        <p className="text-sm text-muted-foreground">
                          La référence est indispensable : sans elle, votre paiement ne peut pas être rattaché à votre abonnement. Un souci ? Appelez {sub.payment.name} au {sub.payment.contact}.
                        </p>
                        <Button className="w-full min-h-[48px] bg-green-600 hover:bg-green-700 text-white" onClick={declarePayment} disabled={saving}>
                          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} J&apos;ai payé avec cette référence
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Le paiement est indisponible pour le moment. Réessayez dans quelques minutes.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {notice && (
          <div className={`p-3 rounded-md text-sm ${notice.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{notice.text}</div>
        )}

        {panel === "criteria" && (
          <div className="space-y-4">
            <CriteriaFields value={criteria} onChange={setCriteria} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setPanel("none")} disabled={saving}>
                <X className="h-4 w-4 mr-1" /> Annuler
              </Button>
              <Button onClick={saveCriteria} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Enregistrer
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((t) => (
            <Button key={t.key} role="tab" aria-selected={tab === t.key} variant={tab === t.key ? "default" : "outline"} size="sm" onClick={() => setTab(t.key)}>
              {t.label} ({counts[t.key]})
            </Button>
          ))}
        </div>

        {newCount > 0 && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            <p className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
              {newCount} nouvelle{newCount > 1 ? "s" : ""} annonce{newCount > 1 ? "s" : ""} depuis votre dernière visite :
            </p>
            <ul className="mt-1 pl-6 space-y-0.5">
              {newForYou > 0 && (
                <li>
                  <button type="button" className="underline underline-offset-2" onClick={() => setTab("new")}>
                    {newForYou} correspond{newForYou > 1 ? "ent" : ""} à votre recherche
                  </button>{" "}
                  (Pour vous)
                </li>
              )}
              {newToCheck > 0 && (
                <li>
                  <button type="button" className="underline underline-offset-2" onClick={() => setTab("check")}>
                    {newToCheck} à vérifier
                  </button>{" "}
                  (une information manque)
                </li>
              )}
            </ul>
          </div>
        )}

        {/* La carte n'est chargée que sur demande : la liste des annonces arrive tout de suite. */}
        <Button variant="outline" className="w-full min-h-[48px]" aria-expanded={showMap} onClick={() => setShowMap(!showMap)}>
          <MapPin className="h-4 w-4 mr-1" /> {showMap ? "Masquer la carte" : "Voir sur la carte"}
        </Button>
        {showMap && (
          <p className="text-xs text-muted-foreground -mb-2" role="status" aria-live="polite">
            Carte : {mappedCount} annonce{mappedCount > 1 ? "s" : ""} « {TABS.find((t) => t.key === tab)?.label} »
            {visible.length > mappedCount ? ` · ${visible.length - mappedCount} sans lieu précis` : ""}
          </p>
        )}
        {showMap && (
          <Map
            center={space.zones[0] ? [space.zones[0].lat, space.zones[0].lon] : DEFAULT_MAP_CENTER}
            zoom={DEFAULT_MAP_ZOOM}
            markers={markers}
            circles={zoneCircles}
            fitContent={markers.length > 0 || space.zones.length > 0}
            emptyLabel={`Aucune annonce à placer sur la carte dans « ${TABS.find((t) => t.key === tab)?.label ?? ""} »`}
            className="h-80 w-full rounded-xl overflow-hidden shadow-sm ring-1 ring-black/5"
          />
        )}

        {!visible.length ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              {tab === "new"
                ? "Aucune annonce pour vous pour le moment. Vous recevrez un message WhatsApp dès qu'une annonce correspondra à votre recherche."
                : tab === "check"
                  ? "Aucune annonce à vérifier. Ici arrivent les annonces qui correspondent à votre recherche mais à qui il manque une information, comme le prix."
                : tab === "kept"
                  ? "Vous n'avez encore marqué aucune annonce comme pertinente."
                  : "Aucune annonce écartée."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {visible.map((a) => (
              <Card key={a.id} id={`annonce-${a.id}`} className="overflow-hidden scroll-mt-4">
                <PhotoGallery photos={a.images?.length ? a.images : a.image ? [a.image] : []} />
                <CardContent className="p-4 space-y-3">
                  {a.withdrawn && (
                    <p className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{a.withdrawn}</span>
                    </p>
                  )}
                  {!!a.doubts?.length && (
                    <p className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{a.doubts.join(" · ")} — à vérifier auprès de l&apos;annonceur.</span>
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {isNew(a) && <Badge className="bg-amber-400 text-black border-amber-500"><Sparkles className="h-3 w-3 mr-1" aria-hidden="true" />Nouvelle annonce</Badge>}
                    {a.typeOffre && <Badge>{getTypeOffreLabel(a.typeOffre)}</Badge>}
                    {a.typeBien && <Badge variant="outline">{getTypeBienLabel(a.typeBien)}</Badge>}
                    {a.meuble && <Badge variant="outline">Meublé</Badge>}
                  </div>

                  {a.prix ? <p className="text-2xl font-bold text-primary">{formatPrice(a.prix, a.devise || "FCFA")}</p> : <p className="text-sm text-muted-foreground">Prix non indiqué</p>}

                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-4 w-4 shrink-0" />
                    {[a.quartier, a.ville].filter(Boolean).join(", ") || "Lieu non précisé"}
                    {a.chambres ? ` · ${a.chambres} ch.` : ""}
                  </p>

                  {a.resume && <p className="text-sm">{a.resume}</p>}
                  {a.publishedAt && <p className="text-xs text-muted-foreground">Publiée le {formatDate(a.publishedAt)}</p>}

                  <div className="flex flex-wrap gap-2">
                    {a.whatsapp && (
                      <a href={`https://wa.me/${a.whatsapp}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                        <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
                      </a>
                    )}
                    {a.telephone && (
                      <a href={`tel:+${a.telephone}`} className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                        <Phone className="h-4 w-4 mr-1" /> Appeler
                      </a>
                    )}
                    {a.postUrl && (
                      <a href={a.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-9 px-3 rounded-md border border-input text-sm hover:bg-accent">
                        <ExternalLink className="h-4 w-4 mr-1" /> Voir sur {a.source === "tiktok" ? "TikTok" : "Facebook"}
                      </a>
                    )}
                  </div>

                  <div className="pt-3 border-t border-border space-y-3">
                    {a.status === "removed" && a.feedback && FEEDBACK_LABELS[a.feedback] && (
                      <p className="text-sm text-muted-foreground">Votre avis : {FEEDBACK_LABELS[a.feedback]}</p>
                    )}

                    {a.status !== "new" ? (
                      <Button variant="outline" className="w-full min-h-[48px]" onClick={() => act(a.id, "reset")} disabled={busy === a.id}>
                        <RotateCcw className="h-4 w-4 mr-1" /> {a.status === "kept" ? "Remettre dans Pour vous" : "Restaurer"}
                      </Button>
                    ) : reasonFor === a.id ? (
                      <div className="space-y-2" role="group" aria-label="Pourquoi cette annonce ne convient pas">
                        <p className="text-sm font-semibold">Qu&apos;est-ce qui ne convient pas ?</p>
                        <div className="grid grid-cols-2 gap-2">
                          {REFUSAL_REASONS.map((reason) => (
                            <Button key={reason.id} variant="outline" className="min-h-[48px] h-auto whitespace-normal" onClick={() => act(a.id, "remove", reason.id)} disabled={busy === a.id}>
                              {reason.label}
                            </Button>
                          ))}
                        </div>
                        <Button variant="ghost" className="w-full min-h-[44px]" onClick={() => setReasonFor(null)}>Annuler</Button>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Button className="min-h-[48px] bg-green-600 hover:bg-green-700 text-white" onClick={() => act(a.id, "keep", "pertinente")} disabled={busy === a.id}>
                            <ThumbsUp className="h-4 w-4 mr-1" /> Pertinente
                          </Button>
                          <Button className="min-h-[48px] bg-red-600 hover:bg-red-700 text-white" onClick={() => setReasonFor(a.id)} disabled={busy === a.id}>
                            <ThumbsDown className="h-4 w-4 mr-1" /> Pas pertinente
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button variant="outline" className="min-h-[48px] h-auto whitespace-normal" onClick={() => act(a.id, "remove", "indisponible")} disabled={busy === a.id}>
                            Déjà loué ou vendu
                          </Button>
                          <Button variant="outline" className="min-h-[48px] h-auto whitespace-normal" onClick={() => act(a.id, "remove", "arnaque")} disabled={busy === a.id}>
                            <Flag className="h-4 w-4 mr-1" /> Signaler une arnaque
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center pb-6">Ce lien est personnel : il ne fonctionne que sur cet appareil.</p>
      </div>
    </div>
  );
}

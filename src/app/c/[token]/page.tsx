"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ExternalLink, Home, Loader2, MapPin, MessageCircle, Phone, RotateCcw, SlidersHorizontal, Trash2, Wallet, X } from "lucide-react";
import { CriteriaFields, criteriaPayload, EMPTY_CRITERIA, MAX_RADIUS_KM, MIN_RADIUS_KM, type CriteriaValue } from "@/components/criteria-form";
import { Input } from "@/components/ui/input";
import { Map, type MapMarker } from "@/components/map";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/lib/geo";
import { formatDate, formatPrice, getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";

type ClientStatus = "new" | "kept" | "removed";

interface ClientAnnonce {
  id: string;
  status: ClientStatus;
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
  trialHours: number;
  paymentInfo: string | null;
  pendingPayment: boolean;
}

interface Criteria {
  typeOffre: string[];
  typeBien: string[];
  prixMin: number | null;
  prixMax: number | null;
  chambresMin: number | null;
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
    exigences: c.exigences || "",
    zone: hasZone ? { lat: c.geoLat as number, lon: c.geoLon as number, label: "Votre secteur" } : null,
    radius: Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Math.round(c.radiusKm || MIN_RADIUS_KM))),
  };
}

interface ClientSpace {
  clientName: string | null;
  subscription?: Subscription;
  criteria?: Criteria;
  zones: { lat: number; lon: number; radiusKm: number; label: string }[];
  annonces: ClientAnnonce[];
}

const TABS: { key: ClientStatus; label: string }[] = [
  { key: "new", label: "À trier" },
  { key: "kept", label: "Retenues" },
  { key: "removed", label: "Supprimées" },
];

/** Espace personnel d'un client : ses annonces, à contacter et à trier. */
export default function ClientSpacePage({ params }: { params: { token: string } }) {
  const [space, setSpace] = useState<ClientSpace | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "other_device" | "error">("loading");
  const [tab, setTab] = useState<ClientStatus>("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [relink, setRelink] = useState<"idle" | "sending" | "sent" | "limited">("idle");
  const [panel, setPanel] = useState<"none" | "criteria" | "payment">("none");
  const [criteria, setCriteria] = useState<CriteriaValue>(EMPTY_CRITERIA);
  const [reference, setReference] = useState("");
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

  const act = async (annonceId: string, action: "keep" | "remove" | "reset") => {
    if (!space) return;
    setBusy(annonceId);
    const next: ClientStatus = action === "keep" ? "kept" : action === "remove" ? "removed" : "new";
    const previous = space;
    // Mise à jour immédiate à l'écran, annulée si l'enregistrement échoue.
    setSpace({ ...space, annonces: space.annonces.map((a) => (a.id === annonceId ? { ...a, status: next } : a)) });
    try {
      const res = await fetch(`/api/client/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annonceId, action }),
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
        setNotice({ ok: true, text: "Critères enregistrés. Ils s'appliquent aux prochaines annonces." });
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
        body: JSON.stringify({ reference }),
      });
      if (res.ok) {
        setPanel("none");
        setReference("");
        setNotice({ ok: true, text: "Paiement déclaré. Vous recevrez un message WhatsApp dès sa validation." });
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
    const c: Record<ClientStatus, number> = { new: 0, kept: 0, removed: 0 };
    for (const a of space?.annonces || []) c[a.status]++;
    return c;
  }, [space]);

  const visible = useMemo(() => (space?.annonces || []).filter((a) => a.status === tab), [space, tab]);

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
      color: tab === "kept" ? "#22c55e" : tab === "removed" ? "#9ca3af" : "#f59e0b",
      title: `${g.lieu} — ${g.items.length} annonce${g.items.length > 1 ? "s" : ""}`,
      lines: g.items.slice(0, 5).map((a) => [getTypeBienLabel(a.typeBien), a.prix ? formatPrice(a.prix, a.devise || "FCFA") : null].filter(Boolean).join(" · ")),
    }));
  }, [visible, tab]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state !== "ready" || !space) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
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
                <p className="text-muted-foreground text-sm">Utilisez le dernier lien reçu sur WhatsApp.</p>
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
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center gap-2">
          <Home className="h-7 w-7 text-primary" />
          <div>
            <p className="text-lg font-bold text-primary leading-tight">Mi Casa Alerte</p>
            <p className="text-sm text-muted-foreground">{space.clientName ? `Les annonces de ${space.clientName}` : "Vos annonces"}</p>
          </div>
        </header>

        {space.subscription && (() => {
          const sub = space.subscription;
          const price = `${sub.price.toLocaleString("fr-FR")} FCFA pour ${sub.days} jours`;
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
                    <p className="text-sm font-medium">{price}</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {sub.paymentInfo
                        ? `1. Envoyez ${sub.price.toLocaleString("fr-FR")} FCFA par Mobile Money :\n${sub.paymentInfo}\n2. Saisissez ci-dessous la référence de la transaction reçue par SMS.`
                        : "Contactez votre agent pour régler l'abonnement, puis saisissez ci-dessous la référence de la transaction."}
                    </p>
                    <Input placeholder="Référence de la transaction" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
                    <Button className="w-full bg-green-600 hover:bg-green-700 text-white" onClick={declarePayment} disabled={saving || reference.trim().length < 4}>
                      {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} J&apos;ai payé
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {notice && (
          <div className={`p-3 rounded-md text-sm ${notice.ok ? "bg-green-500/10 text-green-500" : "bg-destructive/10 text-destructive"}`}>{notice.text}</div>
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

        <div className="flex gap-2" role="tablist">
          {TABS.map((t) => (
            <Button key={t.key} role="tab" aria-selected={tab === t.key} variant={tab === t.key ? "default" : "outline"} size="sm" onClick={() => setTab(t.key)}>
              {t.label} ({counts[t.key]})
            </Button>
          ))}
        </div>

        <Map
          center={space.zones[0] ? [space.zones[0].lat, space.zones[0].lon] : DEFAULT_MAP_CENTER}
          zoom={DEFAULT_MAP_ZOOM}
          markers={markers}
          circles={space.zones.map((z, i) => ({ id: `zone-${i}`, lat: z.lat, lon: z.lon, radiusKm: z.radiusKm, color: "#3b82f6", label: z.label }))}
          fitContent={markers.length > 0 || space.zones.length > 0}
          className="h-64 w-full rounded-lg overflow-hidden"
        />

        {!visible.length ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              {tab === "new"
                ? "Aucune annonce à trier pour le moment. Vous recevrez un message WhatsApp dès qu'une annonce correspondra à votre recherche."
                : tab === "kept"
                  ? "Vous n'avez encore retenu aucune annonce."
                  : "Aucune annonce supprimée."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {visible.map((a) => (
              <Card key={a.id} className="overflow-hidden">
                {a.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image} alt="" className="w-full h-48 object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
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

                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border">
                    {a.status === "kept" ? (
                      <Button variant="outline" onClick={() => act(a.id, "reset")} disabled={busy === a.id}>
                        <RotateCcw className="h-4 w-4 mr-1" /> Remettre à trier
                      </Button>
                    ) : (
                      <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => act(a.id, "keep")} disabled={busy === a.id}>
                        <Check className="h-4 w-4 mr-1" /> Conserver
                      </Button>
                    )}
                    {a.status === "removed" ? (
                      <Button variant="outline" onClick={() => act(a.id, "reset")} disabled={busy === a.id}>
                        <RotateCcw className="h-4 w-4 mr-1" /> Restaurer
                      </Button>
                    ) : (
                      <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => act(a.id, "remove")} disabled={busy === a.id}>
                        <Trash2 className="h-4 w-4 mr-1" /> Supprimer
                      </Button>
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

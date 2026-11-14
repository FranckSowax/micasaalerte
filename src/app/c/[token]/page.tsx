"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ExternalLink, Home, Loader2, MapPin, MessageCircle, Phone, RotateCcw, Trash2 } from "lucide-react";
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

interface ClientSpace {
  clientName: string | null;
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { Map, type MapCircle, type MapMarker } from "@/components/map";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, DEFAULT_RADIUS_KM, locateAnnonce, locatePlace } from "@/lib/geo";
import { getTypeBienLabel, getTypeOffreLabel } from "@/lib/utils";
import { ZONE_COLOR } from "@/lib/map-format";
import type { Annonce, ClientDemand } from "@/types/database";

const TYPE_OFFRE = ["location", "vente", "colocation"];
const MAX_LINES = 6;

/** Carte admin : annonces regroupées par lieu, et zones de recherche des clients. */
export default function CartePage() {
  const [annonces, setAnnonces] = useState<Annonce[]>([]);
  const [demands, setDemands] = useState<ClientDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeOffre, setTypeOffre] = useState("");
  const [showDemands, setShowDemands] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [a, d] = await Promise.all([
        supabase
          .from("annonces")
          .select("*")
          .eq("ai_is_real_estate", true)
          .neq("status", "archived")
          .order("fb_posted_at", { ascending: false, nullsFirst: false })
          .limit(500),
        supabase.from("client_demands").select("*").eq("is_active", true),
      ]);
      setAnnonces((a.data || []) as unknown as Annonce[]);
      setDemands((d.data || []) as unknown as ClientDemand[]);
      setLoading(false);
    })();
  }, []);

  const { markers, located, unlocated, coarse } = useMemo(() => {
    const groups: Record<string, { lat: number; lon: number; lieu: string; items: Annonce[] }> = {};
    let unlocatedCount = 0;
    let coarseCount = 0;
    for (const annonce of annonces) {
      if (typeOffre && annonce.type_offre !== typeOffre) continue;
      const point = locateAnnonce(annonce);
      if (!point) {
        unlocatedCount++;
        continue;
      }
      // Une annonce connue seulement par sa ville est placée au centre de la ville.
      if (point.precision === "ville") coarseCount++;
      const key = `${point.lat},${point.lon}`;
      (groups[key] = groups[key] || { lat: point.lat, lon: point.lon, lieu: point.lieu, items: [] }).items.push(annonce);
    }

    const list: MapMarker[] = Object.entries(groups).map(([id, g]) => ({
      id,
      lat: g.lat,
      lon: g.lon,
      count: g.items.length,
      title: `${g.lieu} — ${g.items.length} annonce${g.items.length > 1 ? "s" : ""}`,
      items: g.items.map((a) => ({
        id: a.id,
        title: [getTypeOffreLabel(a.type_offre), getTypeBienLabel(a.type_bien), a.nb_chambres ? `${a.nb_chambres} ch.` : null].filter(Boolean).join(" · "),
        prix: a.prix,
        devise: a.devise,
        typeOffre: a.type_offre,
        photo: a.raw_images?.[0] ?? null,
        href: `/annonces/${a.id}`,
        // Repère « nouveau » : collectée dans les dernières 24 heures.
        isNew: !!a.created_at && Date.now() - new Date(a.created_at).getTime() < 86_400_000,
      })),
      links:
        g.items.length > MAX_LINES
          ? [{ label: `Voir les ${g.items.length} annonces du quartier`, href: `/annonces?quartier=${encodeURIComponent(g.lieu)}` }]
          : [],
    }));
    const total = Object.values(groups).reduce((n, g) => n + g.items.length, 0);
    return { markers: list, located: total, unlocated: unlocatedCount, coarse: coarseCount };
  }, [annonces, typeOffre]);

  const circles = useMemo<MapCircle[]>(() => {
    if (!showDemands) return [];
    const list: MapCircle[] = [];
    for (const d of demands) {
      const radiusKm = d.geo_radius_km && d.geo_radius_km > 0 ? Number(d.geo_radius_km) : DEFAULT_RADIUS_KM;
      const label = `${d.client_name || "Client"} — rayon ${radiusKm} km`;
      if (typeof d.geo_lat === "number" && typeof d.geo_lon === "number") {
        list.push({ id: d.id, lat: d.geo_lat, lon: d.geo_lon, radiusKm, color: ZONE_COLOR, label });
        continue;
      }
      (d.filter_quartiers || []).forEach((q, i) => {
        const p = locatePlace(q, ["quartier", "localite"]);
        if (p) list.push({ id: `${d.id}-${i}`, lat: p.lat, lon: p.lon, radiusKm, color: ZONE_COLOR, label: `${label} (${p.lieu})` });
      });
    }
    return list;
  }, [demands, showDemands]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Carte</h1>
        <p className="text-muted-foreground mt-1">Annonces par quartier et zones de recherche des clients</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={typeOffre}
              onChange={(e) => setTypeOffre(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Type d'offre"
            >
              <option value="">Toutes les offres</option>
              {TYPE_OFFRE.map((t) => (
                <option key={t} value={t}>{getTypeOffreLabel(t)}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showDemands} onChange={(e) => setShowDemands(e.target.checked)} />
              Zones de recherche des clients ({demands.length})
            </label>
            <div className="flex flex-wrap gap-2 ml-auto">
              <Badge variant="outline">{located} annonces placées</Badge>
              {coarse > 0 && <Badge variant="outline">dont {coarse} au centre de leur ville</Badge>}
              <Badge variant="outline">{unlocated} sans lieu reconnu</Badge>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Map center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} markers={markers} circles={circles} className="h-[70vh] w-full rounded-lg overflow-hidden" />
          )}

          <p className="text-xs text-muted-foreground">
            Chaque pastille regroupe les annonces d&apos;un même quartier, placées en son centre : la position est celle du quartier, pas
            de l&apos;adresse exacte. Les cercles bleus sont les zones de recherche des clients actifs.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

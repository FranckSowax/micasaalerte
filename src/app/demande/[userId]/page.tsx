"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Home, Loader2, CheckCircle2, MapPin, X } from "lucide-react";
import { Map } from "@/components/map";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, listPlaces, locatePlace, placesWithin } from "@/lib/geo";

const TYPE_OFFRE = ["location", "vente", "colocation"];
const TYPE_BIEN = ["appartement", "maison", "studio", "villa", "chambre", "terrain"];
const MAX_ZONE_QUARTIERS = 12;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 5;
// Quartiers et localités proposés à la saisie.
const PLACES = listPlaces();

interface Zone {
  lat: number;
  lon: number;
  label: string;
}

export default function DemandePage({ params }: { params: { userId: string } }) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [zone, setZone] = useState<Zone | null>(null);
  const [zoneQuery, setZoneQuery] = useState("");
  const [radius, setRadius] = useState(MIN_RADIUS_KM);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    client_name: "",
    client_phone: "",
    type_offre: [] as string[],
    type_bien: [] as string[],
    prix_min: "",
    prix_max: "",
    nb_chambres_min: "",
    ville: "Libreville",
    exigences: "",
  });

  // Quartiers dont le centre tombe dans la zone choisie, du plus proche au plus éloigné.
  const nearby = useMemo(() => (zone ? placesWithin(zone, radius) : []), [zone, radius]);

  const pickQuartier = (value: string) => {
    setZoneQuery(value);
    const place = locatePlace(value, ["quartier", "localite"]);
    // On ne retient le lieu que si le nom saisi est complet, pas à chaque frappe.
    if (place && PLACES.some((pl) => pl.name.toLowerCase() === value.trim().toLowerCase())) {
      setZone({ lat: place.lat, lon: place.lon, label: place.lieu });
    }
  };

  const toggleArray = (key: "type_offre" | "type_bien", value: string) => {
    setForm(prev => {
      const current = prev[key];
      if (current.includes(value)) {
        return { ...prev, [key]: current.filter(v => v !== value) };
      }
      return { ...prev, [key]: [...current, value] };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);

    if (!form.client_phone.match(/^\+?\d{8,15}$/)) {
      setError("Numéro WhatsApp invalide. Format : +24177123456");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/demands/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.userId,
        client_name: form.client_name,
        client_phone: form.client_phone.replace(/\s/g, ""),
        filter_type_offre: form.type_offre,
        filter_type_bien: form.type_bien,
        filter_prix_min: form.prix_min ? Number(form.prix_min) : null,
        filter_prix_max: form.prix_max ? Number(form.prix_max) : null,
        filter_nb_chambres_min: form.nb_chambres_min ? Number(form.nb_chambres_min) : null,
        filter_quartiers: nearby.slice(0, MAX_ZONE_QUARTIERS).map((q) => q.name),
        geo_lat: zone ? zone.lat : null,
        geo_lon: zone ? zone.lon : null,
        geo_radius_km: zone ? radius : null,
        filter_ville: form.ville,
        exigences: form.exigences || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Erreur lors de l'envoi");
    } else {
      setSubmitted(true);
    }
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8">
            <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Demande enregistrée !</h2>
            <p className="text-muted-foreground">
              Vous recevrez les annonces correspondantes directement sur WhatsApp au numéro {form.client_phone}.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Home className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-primary">Mi Casa Alerte</span>
          </div>
          <h1 className="text-xl font-bold">Trouvez votre bien idéal</h1>
          <p className="text-muted-foreground mt-1">Remplissez vos critères et recevez les annonces sur WhatsApp</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          {/* Infos personnelles */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Vos informations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nom *</label>
                <Input placeholder="Votre nom" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} required />
              </div>
              <div>
                <label className="text-sm font-medium">Numéro WhatsApp *</label>
                <Input placeholder="+24177123456" value={form.client_phone} onChange={e => setForm({ ...form, client_phone: e.target.value })} required />
              </div>
            </CardContent>
          </Card>

          {/* Type offre */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Type de recherche</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Vous cherchez à :</label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_OFFRE.map(o => (
                    <Badge key={o} variant={form.type_offre.includes(o) ? "default" : "outline"}
                      className="cursor-pointer capitalize text-sm py-1.5 px-3" onClick={() => toggleArray("type_offre", o)}>
                      {o}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Type de bien :</label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_BIEN.map(b => (
                    <Badge key={b} variant={form.type_bien.includes(b) ? "default" : "outline"}
                      className="cursor-pointer capitalize text-sm py-1.5 px-3" onClick={() => toggleArray("type_bien", b)}>
                      {b}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Budget + chambres */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Budget et taille</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Budget min (FCFA)</label>
                  <Input type="number" placeholder="50000" value={form.prix_min} onChange={e => setForm({ ...form, prix_min: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Budget max (FCFA)</label>
                  <Input type="number" placeholder="300000" value={form.prix_max} onChange={e => setForm({ ...form, prix_max: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Chambres minimum</label>
                <select value={form.nb_chambres_min} onChange={e => setForm({ ...form, nb_chambres_min: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Pas de minimum</option>
                  <option value="1">1+</option>
                  <option value="2">2+</option>
                  <option value="3">3+</option>
                  <option value="4">4+</option>
                  <option value="5">5+</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Secteur recherché */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Secteur recherché</CardTitle>
              </div>
              <CardDescription>
                Choisissez un quartier ou touchez la carte, puis réglez la distance. Laissez vide pour chercher partout.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium" htmlFor="zone-quartier">Quartier</label>
                <Input
                  id="zone-quartier"
                  list="quartiers-connus"
                  placeholder="Ex. Angondjé, Nzeng Ayong, Okala…"
                  value={zoneQuery}
                  onChange={(e) => pickQuartier(e.target.value)}
                />
                <datalist id="quartiers-connus">
                  {PLACES.map((pl) => <option key={pl.name} value={pl.name} />)}
                </datalist>
              </div>

              <Map
                center={zone ? [zone.lat, zone.lon] : DEFAULT_MAP_CENTER}
                zoom={zone ? 13 : DEFAULT_MAP_ZOOM}
                circles={zone ? [{ id: "zone", lat: zone.lat, lon: zone.lon, radiusKm: radius }] : []}
                markers={zone ? [{ id: "centre", lat: zone.lat, lon: zone.lon, title: zone.label }] : []}
                onPick={(lat, lon) => {
                  setZone({ lat, lon, label: "Point choisi sur la carte" });
                  setZoneQuery("");
                }}
                fitContent={!!zone}
                className="h-72 w-full rounded-lg overflow-hidden"
              />

              <div>
                <label className="text-sm font-medium flex justify-between" htmlFor="zone-rayon">
                  <span>Distance autour de ce point</span>
                  <span className="text-primary">{radius} km</span>
                </label>
                <input
                  id="zone-rayon"
                  type="range"
                  min={MIN_RADIUS_KM}
                  max={MAX_RADIUS_KM}
                  step={1}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="w-full accent-primary"
                  disabled={!zone}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{MIN_RADIUS_KM} km</span>
                  <span>{MAX_RADIUS_KM} km</span>
                </div>
              </div>

              {zone ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {nearby.length
                      ? `Quartiers compris dans cette zone (${nearby.length}) :`
                      : "Aucun quartier connu dans cette zone : élargissez la distance."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {nearby.map((q) => (
                      <Badge key={q.name} variant="outline" className="text-sm py-1 px-2">
                        {q.name}
                        <span className="ml-1 text-[10px] opacity-60">{q.km < 0.1 ? "centre" : `${q.km.toFixed(1)} km`}</span>
                      </Badge>
                    ))}
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => { setZone(null); setZoneQuery(""); }}>
                    <X className="h-4 w-4 mr-1" /> Chercher partout
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Aucun secteur choisi : vous recevrez les annonces de tous les quartiers.</p>
              )}
            </CardContent>
          </Card>

          {/* Exigences */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Exigences particulières</CardTitle></CardHeader>
            <CardContent>
              <textarea
                placeholder="Meublé, climatisé, parking, gardien, eau chaude..."
                value={form.exigences}
                onChange={e => setForm({ ...form, exigences: e.target.value })}
                className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </CardContent>
          </Card>

          <Button type="submit" className="w-full text-lg h-12" disabled={loading}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Recevoir les annonces sur WhatsApp
          </Button>
        </form>
      </div>
    </div>
  );
}

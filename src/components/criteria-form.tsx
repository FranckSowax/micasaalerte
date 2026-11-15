"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, MapPin, X } from "lucide-react";
import { Map } from "@/components/map";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, listPlaces, locatePlace, placesWithin } from "@/lib/geo";

// Champs des critères de recherche, partagés entre le formulaire d'inscription
// (/demande/[userId]) et la modification des critères dans l'espace client (/c/[token]).

const TYPE_OFFRE = ["location", "vente"];
// Du plus petit au plus grand.
const TYPE_BIEN = ["chambre", "studio", "appartement", "maison", "villa", "commerce", "terrain"];
const MAX_ZONE_QUARTIERS = 12;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 5;
// Quartiers et localités proposés à la saisie.
const PLACES = listPlaces();

/** Exigences proposées au client, à cocher. */
export const EXIGENCE_OPTIONS = [
  "Meublé",
  "Climatisé",
  "Parking",
  "Gardien",
  "Eau chaude",
  "Groupe électrogène",
  "Forage",
  "Barrière",
  "Douche interne",
  "Cuisine équipée",
  "Bord de route",
];

const simplify = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Exigences enregistrées (texte séparé par des virgules) → options cochées.
 * Un ancien texte libre qui ne correspond à aucune option est ignoré.
 *
 * @example parseExigences("meublé, climatisé") // ["Meublé", "Climatisé"]
 */
export function parseExigences(text: string | null | undefined): string[] {
  const parts = (text || "").split(/[,;\n]/).map(simplify).filter(Boolean);
  return EXIGENCE_OPTIONS.filter((option) => parts.some((part) => part === simplify(option) || part.startsWith(simplify(option))));
}

export interface CriteriaZone {
  lat: number;
  lon: number;
  label: string;
}

export interface CriteriaValue {
  type_offre: string[];
  type_bien: string[];
  prix_min: string;
  prix_max: string;
  nb_chambres_min: string;
  /** Options cochées parmi EXIGENCE_OPTIONS. */
  exigences: string[];
  zone: CriteriaZone | null;
  radius: number;
}

export const EMPTY_CRITERIA: CriteriaValue = {
  type_offre: [],
  type_bien: [],
  prix_min: "",
  prix_max: "",
  nb_chambres_min: "",
  exigences: [],
  zone: null,
  radius: MIN_RADIUS_KM,
};

/**
 * Corps de requête attendu par les routes qui enregistrent des critères.
 *
 * @example body: JSON.stringify({ userId, client_name, client_phone, ...criteriaPayload(value) })
 */
export function criteriaPayload(value: CriteriaValue) {
  const nearby = value.zone ? placesWithin(value.zone, value.radius) : [];
  return {
    // Seuls les choix encore proposés sont enregistrés (une ancienne « colocation » disparaît).
    filter_type_offre: value.type_offre.filter((o) => TYPE_OFFRE.includes(o)),
    filter_type_bien: value.type_bien.filter((b) => TYPE_BIEN.includes(b)),
    filter_prix_min: value.prix_min ? Number(value.prix_min) : null,
    filter_prix_max: value.prix_max ? Number(value.prix_max) : null,
    filter_nb_chambres_min: value.nb_chambres_min ? Number(value.nb_chambres_min) : null,
    filter_quartiers: nearby.slice(0, MAX_ZONE_QUARTIERS).map((q) => q.name),
    geo_lat: value.zone ? value.zone.lat : null,
    geo_lon: value.zone ? value.zone.lon : null,
    geo_radius_km: value.zone ? value.radius : null,
    filter_ville: "Libreville",
    // Enregistré en texte (« Meublé, Climatisé ») : le matching y lit meublé, climatisé et parking.
    exigences: value.exigences.length ? value.exigences.join(", ") : null,
  };
}

/** Cartes « type de recherche », « budget », « secteur » et « exigences ». */
export function CriteriaFields({ value, onChange }: { value: CriteriaValue; onChange: (next: CriteriaValue) => void }) {
  const [zoneQuery, setZoneQuery] = useState("");
  const { zone, radius } = value;

  // Quartiers dont le centre tombe dans la zone choisie, du plus proche au plus éloigné.
  const nearby = useMemo(() => (zone ? placesWithin(zone, radius) : []), [zone, radius]);

  const pickQuartier = (text: string) => {
    setZoneQuery(text);
    const place = locatePlace(text, ["quartier", "localite"]);
    // On ne retient le lieu que si le nom saisi est complet, pas à chaque frappe.
    if (place && PLACES.some((pl) => pl.name.toLowerCase() === text.trim().toLowerCase())) {
      onChange({ ...value, zone: { lat: place.lat, lon: place.lon, label: place.lieu } });
    }
  };

  const toggle = (key: "type_offre" | "type_bien", item: string) => {
    const current = value[key];
    onChange({ ...value, [key]: current.includes(item) ? current.filter((v) => v !== item) : [...current, item] });
  };

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-lg">Type de recherche</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Vous cherchez à :</label>
            <div className="flex flex-wrap gap-2">
              {TYPE_OFFRE.map((o) => (
                <Badge key={o} variant={value.type_offre.includes(o) ? "default" : "outline"}
                  className="cursor-pointer capitalize text-sm py-1.5 px-3" onClick={() => toggle("type_offre", o)}>
                  {o}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Type de bien :</label>
            <div className="flex flex-wrap gap-2">
              {TYPE_BIEN.map((b) => (
                <Badge key={b} variant={value.type_bien.includes(b) ? "default" : "outline"}
                  className="cursor-pointer capitalize text-sm py-1.5 px-3" onClick={() => toggle("type_bien", b)}>
                  {b}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Budget et taille</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Budget min (FCFA)</label>
              <Input type="number" placeholder="50000" value={value.prix_min} onChange={(e) => onChange({ ...value, prix_min: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Budget max (FCFA)</label>
              <Input type="number" placeholder="300000" value={value.prix_max} onChange={(e) => onChange({ ...value, prix_max: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Chambres minimum</label>
            <select value={value.nb_chambres_min} onChange={(e) => onChange({ ...value, nb_chambres_min: e.target.value })}
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
              onChange({ ...value, zone: { lat, lon, label: "Point choisi sur la carte" } });
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
              onChange={(e) => onChange({ ...value, radius: Number(e.target.value) })}
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
              <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => { onChange({ ...value, zone: null }); setZoneQuery(""); }}>
                <X className="h-4 w-4 mr-1" /> Chercher partout
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Aucun secteur choisi : vous recevrez les annonces de tous les quartiers.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Exigences particulières</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Touchez ce qui compte pour vous. Vous pouvez en choisir plusieurs.</p>
          <div className="flex flex-wrap gap-2">
            {EXIGENCE_OPTIONS.map((option) => {
              const selected = value.exigences.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange({ ...value, exigences: selected ? value.exigences.filter((x) => x !== option) : [...value.exigences, option] })}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors ${selected ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-accent"}`}
                >
                  {selected && <Check className="h-3.5 w-3.5" />}
                  {option}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

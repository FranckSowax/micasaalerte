"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BedSingle, Building2, Car, Castle, Check, CookingPot, DoorOpen, Droplets, Fence, Flame, Home, KeyRound,
  LandPlot, MapPin, Minus, Plus, Route, ShieldCheck, ShowerHead, Snowflake, Sofa, Store, Wallet, X, Zap,
} from "lucide-react";
import { Map } from "@/components/map";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, listPlaces, placesWithin } from "@/lib/geo";

// Critères de recherche d'un abonné, partagés entre l'inscription (/signup, /demande/[userId]) et
// la modification des critères dans l'espace client (/c/[token]). Chaque bloc pose une question.

const TYPE_OFFRE: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "location", label: "Louer un bien", icon: KeyRound },
  { id: "vente", label: "Acheter un bien", icon: Home },
];
// Du plus petit au plus grand.
const TYPE_BIEN: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "chambre", label: "Chambre", icon: BedSingle },
  { id: "studio", label: "Studio", icon: DoorOpen },
  { id: "appartement", label: "Appartement", icon: Building2 },
  { id: "maison", label: "Maison", icon: Home },
  { id: "villa", label: "Villa", icon: Castle },
  { id: "commerce", label: "Commerce", icon: Store },
  { id: "terrain", label: "Terrain", icon: LandPlot },
];

const MAX_QUARTIERS = 12;
const MAX_CHAMBRES = 6;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 15;
const DEFAULT_RADIUS = 5;
const RADIUS_CHOICES = [1, 3, 5, 10, 15];
// Quartiers et localités proposés à la saisie.
const PLACES = listPlaces();

const EQUIPMENTS: { label: string; icon: LucideIcon }[] = [
  { label: "Meublé", icon: Sofa },
  { label: "Climatisé", icon: Snowflake },
  { label: "Parking", icon: Car },
  { label: "Gardien", icon: ShieldCheck },
  { label: "Eau chaude", icon: Flame },
  { label: "Groupe électrogène", icon: Zap },
  { label: "Forage", icon: Droplets },
  { label: "Douche interne", icon: ShowerHead },
  { label: "Barrière", icon: Fence },
  { label: "Cuisine équipée", icon: CookingPot },
  { label: "Bord de route", icon: Route },
];
const FIRST_EQUIPMENTS = 6;

/** Équipements proposés à l'abonné, à cocher. */
export const EXIGENCE_OPTIONS = EQUIPMENTS.map((e) => e.label);
/** Marque enregistrée à la fin du texte des exigences quand elles sont indispensables. */
const STRICT_MARK = "(indispensables)";

const simplify = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const formatFcfa = (digits: string) => `${Number(digits).toLocaleString("fr-FR")} FCFA`;

/**
 * Exigences enregistrées (texte séparé par des virgules) → options cochées.
 * Un ancien texte libre qui ne correspond à aucune option est ignoré.
 *
 * @example parseExigences("meublé, climatisé (indispensables)") // ["Meublé", "Climatisé"]
 */
export function parseExigences(text: string | null | undefined): string[] {
  const parts = (text || "").split(/[,;\n]/).map(simplify).filter(Boolean);
  return EXIGENCE_OPTIONS.filter((option) => parts.some((part) => part === simplify(option) || part.startsWith(simplify(option))));
}

/** Les équipements enregistrés sont-ils indispensables (et non de simples préférences) ? */
export function exigencesAreStrict(text: string | null | undefined): boolean {
  return simplify(text || "").includes("indispensable");
}

export interface CriteriaZone {
  lat: number;
  lon: number;
  label: string;
}

export interface CriteriaValue {
  /** Louer ou acheter : un seul choix par alerte. */
  type_offre: string[];
  type_bien: string[];
  prix_min: string;
  prix_max: string;
  nb_chambres_min: string;
  /** Options cochées parmi EXIGENCE_OPTIONS. */
  exigences: string[];
  /** true : l'annonce doit mentionner chaque équipement ; false : ce sont des préférences. */
  exigencesStrict: boolean;
  /** Quartiers choisis par leur nom. Vide avec `zone` vide : partout. */
  quartiers: string[];
  /** Point choisi sur la carte, à la place des quartiers. */
  zone: CriteriaZone | null;
  /** Distance acceptée autour du point ou de chaque quartier, en km. */
  radius: number;
}

export const EMPTY_CRITERIA: CriteriaValue = {
  type_offre: [],
  type_bien: [],
  prix_min: "",
  prix_max: "",
  nb_chambres_min: "",
  exigences: [],
  exigencesStrict: false,
  quartiers: [],
  zone: null,
  radius: DEFAULT_RADIUS,
};

/**
 * Première incohérence des critères, en clair, ou null si tout est correct.
 *
 * @example const problem = criteriaError(value); if (problem) afficher(problem)
 */
export function criteriaError(value: CriteriaValue): string | null {
  const min = value.prix_min ? Number(value.prix_min) : 0;
  const max = value.prix_max ? Number(value.prix_max) : 0;
  if (min && max && min > max) return "Le budget minimum dépasse le budget maximum.";
  return null;
}

/**
 * Corps de requête attendu par les routes qui enregistrent des critères.
 *
 * @example body: JSON.stringify({ userId, client_phone, code, ...criteriaPayload(value) })
 */
export function criteriaPayload(value: CriteriaValue) {
  const nearby = value.zone ? placesWithin(value.zone, value.radius) : [];
  const quartiers = value.zone ? nearby.map((q) => q.name) : value.quartiers;
  const hasSector = !!value.zone || quartiers.length > 0;
  return {
    // Seuls les choix encore proposés sont enregistrés (une ancienne « colocation » disparaît).
    filter_type_offre: value.type_offre.filter((o) => TYPE_OFFRE.some((t) => t.id === o)),
    filter_type_bien: value.type_bien.filter((b) => TYPE_BIEN.some((t) => t.id === b)),
    filter_prix_min: value.prix_min ? Number(value.prix_min) : null,
    filter_prix_max: value.prix_max ? Number(value.prix_max) : null,
    filter_nb_chambres_min: value.nb_chambres_min ? Number(value.nb_chambres_min) : null,
    filter_quartiers: quartiers.slice(0, MAX_QUARTIERS),
    geo_lat: value.zone ? value.zone.lat : null,
    geo_lon: value.zone ? value.zone.lon : null,
    geo_radius_km: hasSector ? value.radius : null,
    filter_ville: "Libreville",
    // Enregistré en texte (« Meublé, Parking (indispensables) ») : le matching y lit chaque équipement.
    exigences: value.exigences.length ? `${value.exigences.join(", ")}${value.exigencesStrict ? ` ${STRICT_MARK}` : ""}` : null,
  };
}

/**
 * Résumé des critères, une ligne par sujet, pour le récapitulatif avant validation.
 *
 * @example criteriaSummary(value) // ["Appartement à louer", "Jusqu'à 300 000 FCFA", "Angondjé, Okala (5 km autour)"]
 */
export function criteriaSummary(value: CriteriaValue): { icon: LucideIcon; text: string }[] {
  const offre = value.type_offre.includes("location") && value.type_offre.includes("vente")
    ? "à louer ou à acheter"
    : value.type_offre.includes("vente") ? "à acheter" : value.type_offre.includes("location") ? "à louer" : "";
  const biens = TYPE_BIEN.filter((t) => value.type_bien.includes(t.id)).map((t) => t.label);
  const what = `${biens.length ? biens.join(", ") : "Tous les types de biens"}${offre ? ` ${offre}` : ""}`;

  const budget = value.prix_min && value.prix_max
    ? `De ${formatFcfa(value.prix_min)} à ${formatFcfa(value.prix_max)}`
    : value.prix_max ? `Jusqu'à ${formatFcfa(value.prix_max)}` : value.prix_min ? `À partir de ${formatFcfa(value.prix_min)}` : "Tous les budgets";

  const where = value.zone
    ? `À moins de ${value.radius} km du point choisi sur la carte`
    : value.quartiers.length ? `${value.quartiers.join(", ")} (jusqu'à ${value.radius} km autour)` : "Tous les quartiers";

  const lines = [
    { icon: Home, text: what },
    { icon: Wallet, text: budget },
    { icon: MapPin, text: where },
  ];
  if (value.nb_chambres_min) lines.push({ icon: BedSingle, text: `Au moins ${value.nb_chambres_min} chambre${Number(value.nb_chambres_min) > 1 ? "s" : ""}` });
  if (value.exigences.length) {
    lines.push({ icon: Check, text: `${value.exigences.join(", ")} : ${value.exigencesStrict ? "indispensable" : "souhaité"}` });
  }
  return lines;
}

/** Grande carte à toucher, avec icône ; l'état sélectionné ne repose pas que sur la couleur (coche). */
function ChoiceCard({ selected, onClick, icon: Icon, label, role = "checkbox" }: {
  selected: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  role?: "checkbox" | "radio";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onClick}
      className={`relative flex items-center gap-2 min-h-[60px] w-full rounded-2xl border-2 px-2.5 py-3 text-left text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        selected ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:border-primary/50"
      }`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
      <span className="flex-1 min-w-0 leading-tight">{label}</span>
      {/* Coche en pastille sur le coin : elle signale la sélection sans prendre la place du libellé. */}
      {selected && (
        <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
          <Check className="h-4 w-4" />
        </span>
      )}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-xl font-bold leading-tight">{title}</h2>
        {hint && <p className="text-base text-muted-foreground mt-1">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const FIELD = "h-14 w-full rounded-xl border-2 border-input bg-background px-4 text-lg text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary";

export type CriteriaSection = "recherche" | "budget" | "lieu" | "equipements";
const ALL_SECTIONS: CriteriaSection[] = ["recherche", "budget", "lieu", "equipements"];

/**
 * Blocs de critères. `sections` choisit ceux à afficher (toutes par défaut) : l'inscription les
 * répartit sur plusieurs étapes, l'espace client les montre ensemble.
 *
 * @example <CriteriaFields value={criteria} onChange={setCriteria} sections={["recherche"]} />
 */
export function CriteriaFields({ value, onChange, sections = ALL_SECTIONS }: {
  value: CriteriaValue;
  onChange: (next: CriteriaValue) => void;
  sections?: CriteriaSection[];
}) {
  const [quartierQuery, setQuartierQuery] = useState("");
  const [quartierError, setQuartierError] = useState("");
  const [showMap, setShowMap] = useState(!!value.zone);
  const [showMinBudget, setShowMinBudget] = useState(!!value.prix_min);
  const [allEquipments, setAllEquipments] = useState(value.exigences.some((e) => EXIGENCE_OPTIONS.indexOf(e) >= FIRST_EQUIPMENTS));

  const { zone, radius, quartiers } = value;
  const everywhere = !zone && quartiers.length === 0;
  const chambres = value.nb_chambres_min ? Number(value.nb_chambres_min) : 0;
  const budgetError = criteriaError(value);

  const toggleBien = (id: string) =>
    onChange({ ...value, type_bien: value.type_bien.includes(id) ? value.type_bien.filter((v) => v !== id) : [...value.type_bien, id] });

  const digitsOnly = (text: string) => text.replace(/\D/g, "").replace(/^0+/, "").slice(0, 12);

  const addQuartier = (text: string) => {
    setQuartierQuery(text);
    setQuartierError("");
    const place = PLACES.find((pl) => simplify(pl.name) === simplify(text));
    // On n'ajoute que sur un nom complet de la liste, pas à chaque frappe.
    if (!place) return;
    if (quartiers.includes(place.name)) {
      setQuartierQuery("");
      return;
    }
    if (quartiers.length >= MAX_QUARTIERS) {
      setQuartierError(`${MAX_QUARTIERS} quartiers au maximum. Retirez-en un pour en ajouter un autre.`);
      return;
    }
    onChange({ ...value, zone: null, quartiers: [...quartiers, place.name] });
    setQuartierQuery("");
  };

  const toggleEquipment = (label: string) =>
    onChange({ ...value, exigences: value.exigences.includes(label) ? value.exigences.filter((x) => x !== label) : [...value.exigences, label] });

  const shownEquipments = allEquipments ? EQUIPMENTS : EQUIPMENTS.slice(0, FIRST_EQUIPMENTS);

  return (
    <>
      {sections.includes("recherche") && (
        <>
          <Section title="Que souhaitez-vous faire ?">
            <div role="radiogroup" aria-label="Louer ou acheter" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TYPE_OFFRE.map((o) => (
                <ChoiceCard
                  key={o.id}
                  role="radio"
                  icon={o.icon}
                  label={o.label}
                  selected={value.type_offre.length === 1 && value.type_offre[0] === o.id}
                  onClick={() => onChange({ ...value, type_offre: [o.id] })}
                />
              ))}
            </div>
          </Section>

          <Section title="Quel type de bien cherchez-vous ?" hint="Plusieurs choix possibles. Laissez vide pour tout recevoir.">
            <div className="grid grid-cols-2 gap-3">
              {TYPE_BIEN.map((b) => (
                <ChoiceCard key={b.id} icon={b.icon} label={b.label} selected={value.type_bien.includes(b.id)} onClick={() => toggleBien(b.id)} />
              ))}
            </div>
          </Section>
        </>
      )}

      {sections.includes("budget") && (
        <Section title="Quel est votre budget maximum ?">
          <div>
            <label className="sr-only" htmlFor="budget-max">Budget maximum en FCFA</label>
            <div className="relative">
              <input
                id="budget-max"
                inputMode="numeric"
                autoComplete="off"
                placeholder="300000"
                value={value.prix_max}
                onChange={(e) => onChange({ ...value, prix_max: digitsOnly(e.target.value) })}
                aria-invalid={!!budgetError}
                aria-describedby="budget-aide"
                className={`${FIELD} pr-20`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground" aria-hidden="true">FCFA</span>
            </div>
            <p id="budget-aide" className="text-base text-muted-foreground mt-2">
              {value.prix_max ? `Jusqu'à ${formatFcfa(value.prix_max)}. ` : ""}
              Vous recevrez uniquement les annonces qui respectent ce budget. Laissez vide si le prix n&apos;a pas d&apos;importance.
            </p>
          </div>

          {showMinBudget ? (
            <div>
              <label className="text-base font-semibold block mb-2" htmlFor="budget-min">Budget minimum (facultatif)</label>
              <div className="relative">
                <input
                  id="budget-min"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="50000"
                  value={value.prix_min}
                  onChange={(e) => onChange({ ...value, prix_min: digitsOnly(e.target.value) })}
                  aria-invalid={!!budgetError}
                  className={`${FIELD} pr-20`}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground" aria-hidden="true">FCFA</span>
              </div>
            </div>
          ) : (
            <button type="button" className="min-h-[48px] text-base font-semibold text-primary underline underline-offset-4" onClick={() => setShowMinBudget(true)}>
              Ajouter un budget minimum
            </button>
          )}
          {budgetError && <p className="text-base font-semibold text-destructive" role="alert">{budgetError}</p>}

          <div>
            <p className="text-base font-semibold mb-2" id="chambres-label">Nombre de chambres</p>
            <div className="flex items-center gap-3" role="group" aria-labelledby="chambres-label">
              <button
                type="button"
                aria-label="Moins de chambres"
                disabled={chambres === 0}
                onClick={() => onChange({ ...value, nb_chambres_min: chambres > 1 ? String(chambres - 1) : "" })}
                className="h-14 w-14 shrink-0 rounded-xl border-2 border-border bg-card flex items-center justify-center disabled:opacity-40"
              >
                <Minus className="h-6 w-6" aria-hidden="true" />
              </button>
              <p className="flex-1 text-center text-lg font-bold" aria-live="polite">
                {chambres === 0 ? "Peu importe" : `${chambres} ou plus`}
              </p>
              <button
                type="button"
                aria-label="Plus de chambres"
                disabled={chambres >= MAX_CHAMBRES}
                onClick={() => onChange({ ...value, nb_chambres_min: String(chambres + 1) })}
                className="h-14 w-14 shrink-0 rounded-xl border-2 border-border bg-card flex items-center justify-center disabled:opacity-40"
              >
                <Plus className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
          </div>
        </Section>
      )}

      {sections.includes("lieu") && (
        <Section title="Où souhaitez-vous habiter ?" hint="Ajoutez un ou plusieurs quartiers, ou cherchez partout.">
          <div>
            <label className="sr-only" htmlFor="quartier-recherche">Rechercher un quartier</label>
            <input
              id="quartier-recherche"
              list="quartiers-connus"
              autoComplete="off"
              placeholder="Rechercher un quartier"
              value={quartierQuery}
              onChange={(e) => addQuartier(e.target.value)}
              className={FIELD}
            />
            <datalist id="quartiers-connus">
              {PLACES.map((pl) => <option key={pl.name} value={pl.name} />)}
            </datalist>
            {quartierError && <p className="text-base font-semibold text-destructive mt-2" role="alert">{quartierError}</p>}
          </div>

          {(quartiers.length > 0 || zone) && (
            <ul className="flex flex-wrap gap-2" aria-label="Secteurs choisis">
              {zone && (
                <li>
                  <button type="button" onClick={() => onChange({ ...value, zone: null })} className="inline-flex items-center gap-2 min-h-[48px] rounded-full border-2 border-primary bg-primary/10 px-4 text-base font-semibold">
                    <MapPin className="h-4 w-4 text-primary" aria-hidden="true" /> Point choisi sur la carte
                    <X className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Retirer</span>
                  </button>
                </li>
              )}
              {quartiers.map((q) => (
                <li key={q}>
                  <button type="button" onClick={() => onChange({ ...value, quartiers: quartiers.filter((x) => x !== q) })} className="inline-flex items-center gap-2 min-h-[48px] rounded-full border-2 border-primary bg-primary/10 px-4 text-base font-semibold">
                    {q} <X className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Retirer {q}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <ChoiceCard
            icon={MapPin}
            label="Partout, peu importe le quartier"
            selected={everywhere}
            onClick={() => { onChange({ ...value, quartiers: [], zone: null }); setQuartierQuery(""); }}
          />

          {!everywhere && (
            <div>
              <p className="text-base font-semibold mb-2" id="rayon-label">Jusqu&apos;à quelle distance autour ?</p>
              <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-labelledby="rayon-label">
                {RADIUS_CHOICES.map((km) => (
                  <button
                    key={km}
                    type="button"
                    role="radio"
                    aria-checked={radius === km}
                    onClick={() => onChange({ ...value, radius: km })}
                    className={`min-h-[52px] rounded-xl border-2 text-base font-bold ${radius === km ? "border-primary bg-primary/10" : "border-border bg-card"}`}
                  >
                    {km} km
                  </button>
                ))}
              </div>
            </div>
          )}

          {showMap ? (
            <div className="space-y-2">
              <p className="text-base text-muted-foreground">Touchez la carte pour choisir un point précis. Il remplace les quartiers ci-dessus.</p>
              <Map
                center={zone ? [zone.lat, zone.lon] : DEFAULT_MAP_CENTER}
                zoom={zone ? 13 : DEFAULT_MAP_ZOOM}
                circles={zone ? [{ id: "zone", lat: zone.lat, lon: zone.lon, radiusKm: radius }] : []}
                markers={zone ? [{ id: "centre", lat: zone.lat, lon: zone.lon, title: zone.label }] : []}
                onPick={(lat, lon) => onChange({ ...value, quartiers: [], zone: { lat, lon, label: "Point choisi sur la carte" } })}
                fitContent={!!zone}
                className="h-64 w-full rounded-xl overflow-hidden"
              />
              <p className="text-sm text-muted-foreground">Si la carte ne s&apos;affiche pas, choisissez simplement vos quartiers dans le champ ci-dessus.</p>
            </div>
          ) : (
            <button type="button" className="min-h-[48px] text-base font-semibold text-primary underline underline-offset-4" onClick={() => setShowMap(true)}>
              Choisir précisément sur la carte
            </button>
          )}
        </Section>
      )}

      {sections.includes("equipements") && (
        <Section title="Qu'est-ce qui est important pour vous ?" hint="Facultatif. Touchez ce qui compte.">
          <div className="grid grid-cols-2 gap-3">
            {shownEquipments.map((e) => (
              <ChoiceCard key={e.label} icon={e.icon} label={e.label} selected={value.exigences.includes(e.label)} onClick={() => toggleEquipment(e.label)} />
            ))}
          </div>
          {!allEquipments && (
            <button type="button" className="min-h-[48px] text-base font-semibold text-primary underline underline-offset-4" onClick={() => setAllEquipments(true)}>
              Voir plus d&apos;options
            </button>
          )}

          {value.exigences.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-base font-semibold mb-2">Ces éléments sont :</legend>
              {[
                { strict: false, title: "Souhaités, mais je peux m'en passer", note: "Vous recevez aussi les annonces qui n'en parlent pas." },
                { strict: true, title: "Indispensables", note: "Moins d'annonces : beaucoup ne précisent pas ces détails." },
              ].map((option) => (
                <label
                  key={String(option.strict)}
                  className={`flex items-start gap-3 min-h-[56px] rounded-xl border-2 px-4 py-3 cursor-pointer ${value.exigencesStrict === option.strict ? "border-primary bg-primary/10" : "border-border bg-card"}`}
                >
                  <input
                    type="radio"
                    name="exigences-mode"
                    className="mt-1 h-5 w-5 accent-[hsl(var(--primary))]"
                    checked={value.exigencesStrict === option.strict}
                    onChange={() => onChange({ ...value, exigencesStrict: option.strict })}
                  />
                  <span>
                    <span className="block text-base font-semibold">{option.title}</span>
                    <span className="block text-sm text-muted-foreground">{option.note}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </Section>
      )}
    </>
  );
}

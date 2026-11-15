"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Layers, Maximize2, Minimize2 } from "lucide-react";
import { clusterByDistance, MIXED_COLOR, safeImageUrl, shortPrice, TRANSACTION_COLORS, transactionColor, ZONE_COLOR } from "@/lib/map-format";

/** Annonce affichée dans la fiche d'un marqueur. */
export interface MapItem {
  id: string;
  /** Ligne descriptive, ex. « Appartement · 3 ch. ». */
  title: string;
  prix?: number | null;
  devise?: string | null;
  typeOffre?: string | null;
  photo?: string | null;
  /** Lien de la fiche ; « #ancre » fait défiler la page jusqu'à l'annonce. */
  href?: string;
  external?: boolean;
  isNew?: boolean;
}

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  /** Nombre d'annonces à cet endroit (déduit de `items` s'il est fourni). */
  count?: number;
  color?: string;
  /** Marqueur estompé (annonces écartées). */
  muted?: boolean;
  title: string;
  /** Annonces de cet endroit : étiquette de prix sur la carte et fiche détaillée au clic. */
  items?: MapItem[];
  /** Lignes de l'infobulle, sans fiche détaillée. Insérées comme texte, jamais comme HTML. */
  lines?: string[];
  links?: { label: string; href: string; external?: boolean }[];
}

export interface MapCircle {
  id: string;
  lat: number;
  lon: number;
  radiusKm: number;
  color?: string;
  label?: string;
}

export interface LeafletMapProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  circles?: MapCircle[];
  /** Appelé quand l'utilisateur touche la carte (choix d'un point), ou se localise. */
  onPick?: (lat: number, lon: number) => void;
  /** Recadre la carte sur son contenu à chaque changement. */
  fitContent?: boolean;
  /** Taille et forme de la carte (hors plein écran). */
  className?: string;
  /** Bouton « Me localiser » (par défaut affiché). */
  locate?: boolean;
  /** Bouton plein écran (par défaut affiché). */
  fullscreen?: boolean;
}

// Fond « plan » : style humanitaire d'OpenStreetMap (HOT, hébergé par OpenStreetMap France), plus doux
// que le style standard et riche en noms de quartiers ; gratuit et sans clé. Vue satellite : Esri.
// WHY: les fonds CARTO exigent désormais une clé (filigrane « API KEY REQUIRED »).
const PLAN_URL = "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png";
const PLAN_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.hotosm.org/">HOT</a> · <a href="https://openstreetmap.fr/">OSM France</a>';
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION = "&copy; Esri, Maxar, Earthstar Geographics";

/** Distance à l'écran en dessous de laquelle deux marqueurs sont regroupés. */
const CLUSTER_PX = 46;
const MAX_POPUP_ITEMS = 6;

const LEGEND = [
  { label: "Location", color: TRANSACTION_COLORS.location },
  { label: "Vente", color: TRANSACTION_COLORS.vente },
  { label: "Colocation", color: TRANSACTION_COLORS.colocation },
  { label: "Plusieurs", color: MIXED_COLOR },
];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function countOf(m: MapMarker): number {
  return m.items?.length || m.count || 1;
}

function colorOf(markers: MapMarker[]): string {
  if (markers.length === 1 && markers[0].color) return markers[0].color;
  const types = markers.flatMap((m) => (m.items || []).map((i) => i.typeOffre));
  return types.length ? transactionColor(types) : markers[0].color || TRANSACTION_COLORS.location;
}

function formatFullPrice(prix: number, devise?: string | null): string {
  return `${new Intl.NumberFormat("fr-FR").format(prix)} ${devise === "EUR" ? "€" : "FCFA"}`;
}

/** Étiquette d'un endroit : prix pour une annonce, nombre et prix plancher pour plusieurs. */
function placeIcon(markers: MapMarker[]): L.DivIcon {
  const items = markers.flatMap((m) => m.items || []);
  const count = markers.reduce((n, m) => n + countOf(m), 0);
  const color = colorOf(markers);
  const muted = markers.every((m) => m.muted);
  const isNew = items.some((i) => i.isNew);
  const prices = items.map((i) => i.prix).filter((p): p is number => !!p && p > 0);
  const floor = prices.length ? shortPrice(Math.min(...prices)) : "";

  let label: string;
  if (count === 1) label = escapeHtml(floor || "Prix ?");
  else label = `<b class="mca-n">${count}</b>${floor ? `<span>dès ${escapeHtml(floor)}</span>` : "<span>annonces</span>"}`;

  return L.divIcon({
    className: "mca-place",
    html: `<div class="mca-pill${muted ? " mca-muted" : ""}" style="--c:${color}">${label}${isNew ? '<i class="mca-new"></i>' : ""}</div>`,
    iconAnchor: [0, 0],
    iconSize: [0, 0],
    popupAnchor: [0, -34],
  });
}

/** Épingle simple (point choisi, ou marqueur sans annonce). */
function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "mca-place",
    html: `<svg class="mca-pin" viewBox="0 0 24 32" width="30" height="40" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z" fill="${color}"/><circle cx="12" cy="12" r="4.6" fill="#fff"/></svg>`,
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -36],
  });
}

// WHY: l'infobulle est construite nœud par nœud avec textContent. Les textes viennent de
// publications Facebook et TikTok : les insérer comme HTML permettrait d'injecter du code.
function popupContent(markers: MapMarker[], onAnchor: (hash: string) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "mca-popup";
  const items = markers.flatMap((m) => m.items || []);
  const title = document.createElement("div");
  title.className = "mca-popup-title";
  title.textContent = markers[0].title;
  root.appendChild(title);

  if (items.length) {
    const list = document.createElement("div");
    list.className = "mca-list";
    for (const item of items.slice(0, MAX_POPUP_ITEMS)) {
      const row = document.createElement(item.href ? "a" : "div");
      row.className = "mca-row";
      if (item.href && row instanceof HTMLAnchorElement) {
        row.href = item.href;
        if (item.external) {
          row.target = "_blank";
          row.rel = "noopener noreferrer";
        } else if (item.href.startsWith("#")) {
          row.addEventListener("click", (e) => {
            e.preventDefault();
            onAnchor(item.href as string);
          });
        }
      }
      const photo = safeImageUrl(item.photo);
      const thumb = document.createElement("div");
      thumb.className = "mca-thumb";
      if (photo) {
        const img = document.createElement("img");
        img.src = photo;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => img.remove();
        thumb.appendChild(img);
      }
      row.appendChild(thumb);

      const body = document.createElement("div");
      body.className = "mca-body";
      const price = document.createElement("div");
      price.className = "mca-price";
      price.textContent = item.prix ? formatFullPrice(item.prix, item.devise) : "Prix non indiqué";
      if (item.isNew) {
        const chip = document.createElement("span");
        chip.className = "mca-chip";
        chip.textContent = "Nouveau";
        price.appendChild(chip);
      }
      body.appendChild(price);
      const line = document.createElement("div");
      line.className = "mca-line";
      line.textContent = item.title;
      body.appendChild(line);
      if (item.href) {
        const more = document.createElement("div");
        more.className = "mca-more";
        more.textContent = item.external ? "Voir la publication →" : "Voir l'annonce →";
        body.appendChild(more);
      }
      row.appendChild(body);
      list.appendChild(row);
    }
    root.appendChild(list);
    if (items.length > MAX_POPUP_ITEMS) {
      const rest = document.createElement("div");
      rest.className = "mca-line";
      rest.textContent = `+ ${items.length - MAX_POPUP_ITEMS} autre${items.length - MAX_POPUP_ITEMS > 1 ? "s" : ""}`;
      root.appendChild(rest);
    }
  } else {
    for (const line of markers.flatMap((m) => m.lines || [])) {
      const p = document.createElement("div");
      p.className = "mca-line";
      p.textContent = line;
      root.appendChild(p);
    }
  }

  for (const link of markers.flatMap((m) => m.links || [])) {
    const a = document.createElement("a");
    a.className = "mca-link";
    a.textContent = link.label;
    a.href = link.href;
    if (link.external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    root.appendChild(a);
  }
  return root;
}

const STYLES = `
.leaflet-container{font:inherit;background:#eef1f4}
.mca-plan-tiles{filter:saturate(.7) brightness(1.03)}
.mca-place{background:transparent;border:0}
.mca-pill{position:absolute;transform:translate(-50%,-100%);margin-top:-6px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;
  background:var(--c);color:#fff;font-weight:700;font-size:12px;line-height:1;padding:6px 9px;border-radius:999px;
  box-shadow:0 2px 6px rgba(15,23,42,.35);border:2px solid #fff;cursor:pointer;transition:transform .15s}
.mca-pill::after{content:"";position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);border:6px solid transparent;border-top-color:#fff;border-bottom:0}
.mca-pill:hover{transform:translate(-50%,-100%) scale(1.08)}
.mca-pill .mca-n{background:#fff;color:var(--c);border-radius:999px;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;padding:0 4px}
.mca-pill span{font-weight:600;opacity:.95}
.mca-muted{background:#9ca3af!important}
.mca-new{position:absolute;top:-5px;right:-5px;width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px solid #fff}
.mca-pin{filter:drop-shadow(0 2px 3px rgba(15,23,42,.35))}
.mca-cluster{position:absolute;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:var(--c);color:#fff;font-weight:800;font-size:15px;line-height:1;border:3px solid #fff;box-shadow:0 0 0 6px rgba(15,23,42,.12),0 3px 8px rgba(15,23,42,.35);cursor:pointer}
.mca-cluster small{font-size:8px;font-weight:600;opacity:.9;margin-top:2px}
.mca-popup{min-width:230px;max-width:270px}
.mca-popup-title{font-weight:700;font-size:13px;margin-bottom:6px}
.mca-list{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto}
.mca-row{display:flex;gap:8px;align-items:center;padding:4px;border-radius:8px;color:inherit!important;text-decoration:none}
a.mca-row:hover{background:#f1f5f9}
.mca-thumb{flex:0 0 52px;height:52px;border-radius:6px;overflow:hidden;background:#e2e8f0}
.mca-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.mca-body{min-width:0}
.mca-price{font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px}
.mca-chip{font-size:9px;font-weight:700;background:#f59e0b;color:#111;border-radius:999px;padding:2px 6px}
.mca-line{font-size:12px;color:#475569;margin-top:2px}
.mca-more{font-size:11px;font-weight:600;color:#15803d;margin-top:3px}
.mca-link{display:block;margin-top:8px;font-size:12px;font-weight:600}
.leaflet-popup-content{margin:10px 12px}
.leaflet-popup-content-wrapper{border-radius:12px}
.mca-me{width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)}
`;

/**
 * Carte des annonces : fond épuré ou satellite, étiquettes de prix colorées par transaction,
 * regroupement des annonces proches, fiche avec photo au clic, zones de recherche, localisation
 * et plein écran. À charger via `components/map` : Leaflet a besoin du navigateur.
 */
export default function LeafletMap({
  center,
  zoom = 12,
  markers = [],
  circles = [],
  onPick,
  fitContent,
  className,
  locate = true,
  fullscreen = true,
}: LeafletMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const placesLayer = useRef<L.LayerGroup | null>(null);
  const zonesLayer = useRef<L.LayerGroup | null>(null);
  const meLayer = useRef<L.LayerGroup | null>(null);
  const bases = useRef<{ plan: L.TileLayer; satellite: L.LayerGroup } | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const pick = useRef(onPick);
  pick.current = onPick;

  const [base, setBase] = useState<"plan" | "satellite">("plan");
  const [full, setFull] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  // Fiche ouverte : boutons et légende s'effacent pour ne pas la recouvrir.
  const [popupOpen, setPopupOpen] = useState(false);

  // Lien « #annonce-… » d'une fiche : on quitte le plein écran puis on fait défiler jusqu'à l'annonce.
  const goToAnchor = useCallback((hash: string) => {
    map.current?.closePopup();
    setFull(false);
    window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, []);

  const renderPlaces = useCallback(() => {
    const instance = map.current;
    const layer = placesLayer.current;
    if (!instance || !layer) return;
    layer.clearLayers();
    const list = markersRef.current;
    // Annonces (étiquettes de prix, regroupables) et simples épingles (point choisi).
    const places = list.filter((m) => m.items?.length || m.count);
    const pins = list.filter((m) => !(m.items?.length || m.count));

    // Regroupement selon la distance à l'écran, recalculé à chaque niveau de zoom.
    const points = places.map((m) => instance.latLngToLayerPoint([m.lat, m.lon]));
    const clusters = instance.getZoom() >= 16 ? places.map((_, i) => [i]) : clusterByDistance(points, CLUSTER_PX);

    for (const members of clusters) {
      const group = members.map((i) => places[i]);
      if (group.length === 1) {
        const m = group[0];
        L.marker([m.lat, m.lon], { icon: placeIcon([m]), riseOnHover: true, keyboard: true, title: m.title })
          .bindPopup(() => popupContent([m], goToAnchor), { maxWidth: 290 })
          .addTo(layer);
        continue;
      }
      const lat = group.reduce((s, m) => s + m.lat, 0) / group.length;
      const lon = group.reduce((s, m) => s + m.lon, 0) / group.length;
      const count = group.reduce((n, m) => n + countOf(m), 0);
      const icon = L.divIcon({
        className: "mca-place",
        html: `<div class="mca-cluster" style="--c:${colorOf(group)}">${count}<small>annonces</small></div>`,
        iconAnchor: [0, 0],
        iconSize: [0, 0],
      });
      L.marker([lat, lon], { icon, keyboard: true, title: `${count} annonces : toucher pour zoomer` })
        .on("click", () => {
          const bounds = L.latLngBounds(group.map((m) => [m.lat, m.lon] as [number, number]));
          instance.fitBounds(bounds.pad(0.4), { maxZoom: 16 });
        })
        .addTo(layer);
    }

    for (const m of pins) {
      const marker = L.marker([m.lat, m.lon], { icon: pinIcon(m.color || ZONE_COLOR), keyboard: true, title: m.title }).addTo(layer);
      if (m.lines?.length || m.links?.length) marker.bindPopup(() => popupContent([m], goToAnchor));
      else if (m.title) marker.bindTooltip(m.title);
    }
  }, [goToAnchor]);

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = L.map(container.current, { center, zoom, scrollWheelZoom: true });
    const plan = L.tileLayer(PLAN_URL, { attribution: PLAN_ATTRIBUTION, maxZoom: 19, subdomains: "abc", className: "mca-plan-tiles" });
    const satellite = L.layerGroup([
      L.tileLayer(SATELLITE_URL, { attribution: SATELLITE_ATTRIBUTION, maxZoom: 19 }),
      L.tileLayer(LABELS_URL, { maxZoom: 19 }),
    ]);
    plan.addTo(instance);
    // Mention de la source sur une seule ligne, sous la légende.
    instance.attributionControl.setPrefix(false);
    bases.current = { plan, satellite };
    zonesLayer.current = L.layerGroup().addTo(instance);
    placesLayer.current = L.layerGroup().addTo(instance);
    meLayer.current = L.layerGroup().addTo(instance);
    instance.on("click", (e: L.LeafletMouseEvent) => pick.current?.(e.latlng.lat, e.latlng.lng));
    instance.on("zoomend", () => renderPlaces());
    instance.on("popupopen", () => setPopupOpen(true));
    instance.on("popupclose", () => setPopupOpen(false));
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      placesLayer.current = null;
      zonesLayer.current = null;
      meLayer.current = null;
      bases.current = null;
    };
    // La carte n'est créée qu'une fois ; centre et contenu sont mis à jour par les effets suivants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    const zones = zonesLayer.current;
    if (!instance || !zones) return;
    zones.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    for (const c of circles) {
      const color = c.color || ZONE_COLOR;
      const circle = L.circle([c.lat, c.lon], { radius: c.radiusKm * 1000, color, weight: 2, dashArray: "6 6", fillColor: color, fillOpacity: 0.07 }).addTo(zones);
      if (c.label) circle.bindTooltip(c.label, { sticky: true });
      const b = circle.getBounds();
      bounds.push(b.getNorthEast(), b.getSouthWest());
    }
    for (const m of markers) bounds.push([m.lat, m.lon]);

    if (fitContent && bounds.length) instance.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 15 });
    renderPlaces();
  }, [markers, circles, fitContent, renderPlaces]);

  useEffect(() => {
    if (!fitContent) map.current?.setView(center, map.current.getZoom());
  }, [center, fitContent]);

  useEffect(() => {
    const instance = map.current;
    const layers = bases.current;
    if (!instance || !layers) return;
    const [on, off] = base === "plan" ? [layers.plan, layers.satellite] : [layers.satellite, layers.plan];
    if (instance.hasLayer(off)) instance.removeLayer(off);
    if (!instance.hasLayer(on)) on.addTo(instance);
  }, [base]);

  // Plein écran : la carte occupe la fenêtre ; Échap la referme. Leaflet doit recalculer sa taille.
  useEffect(() => {
    const timer = window.setTimeout(() => map.current?.invalidateSize(), 60);
    if (!full) return () => window.clearTimeout(timer);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [full]);

  const locateMe = () => {
    if (!navigator.geolocation) {
      setLocateError("Localisation non disponible sur cet appareil");
      return;
    }
    setLocating(true);
    setLocateError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        const layer = meLayer.current;
        if (layer) {
          layer.clearLayers();
          L.circle([lat, lon], { radius: Math.min(accuracy, 2000), color: "#2563eb", weight: 1, fillOpacity: 0.1, interactive: false }).addTo(layer);
          L.marker([lat, lon], {
            icon: L.divIcon({ className: "mca-place", html: '<div class="mca-me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
            title: "Vous êtes ici",
          }).addTo(layer);
        }
        map.current?.setView([lat, lon], 14);
        pick.current?.(lat, lon);
      },
      () => {
        setLocating(false);
        setLocateError("Position introuvable : autorisez la localisation");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  };

  const hasItems = markers.some((m) => m.items?.length);
  const buttonClass =
    "flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 h-9 text-xs font-semibold text-slate-800 shadow-md ring-1 ring-black/10 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

  return (
    <>
      <style>{STYLES}</style>
      <div className={full ? "fixed inset-0 z-[9999] bg-white" : `relative isolate ${className || "h-[420px] w-full rounded-lg overflow-hidden"}`}>
        <div ref={container} className="absolute inset-0" />

        <div className={`absolute right-2 top-2 z-[1000] flex flex-col items-end gap-2 transition-opacity ${popupOpen ? "pointer-events-none opacity-0" : ""}`}>
          <div className="flex rounded-lg bg-white/95 p-0.5 shadow-md ring-1 ring-black/10" role="group" aria-label="Fond de carte">
            {(["plan", "satellite"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBase(b)}
                aria-pressed={base === b}
                className={`flex items-center gap-1 rounded-md px-2.5 h-8 text-xs font-semibold ${base === b ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
              >
                {b === "plan" && <Layers className="h-3.5 w-3.5" aria-hidden="true" />}
                {b === "plan" ? "Plan" : "Satellite"}
              </button>
            ))}
          </div>
          {fullscreen && (
            <button type="button" className={buttonClass} onClick={() => setFull(!full)} aria-label={full ? "Quitter le plein écran" : "Plein écran"}>
              {full ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
              <span className="hidden sm:inline">{full ? "Réduire" : "Plein écran"}</span>
            </button>
          )}
          {locate && (
            <button type="button" className={buttonClass} onClick={locateMe} disabled={locating} aria-label="Me localiser">
              <Crosshair className={`h-4 w-4 ${locating ? "animate-pulse text-blue-600" : ""}`} aria-hidden="true" />
              <span className="hidden sm:inline">Me localiser</span>
            </button>
          )}
        </div>

        {locateError && (
          <div className="absolute left-1/2 top-2 z-[1000] -translate-x-1/2 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-md" role="status">
            {locateError}
          </div>
        )}

        {(hasItems || circles.length > 0) && (
          <div className={`absolute bottom-6 left-2 z-[1000] transition-opacity ${popupOpen ? "pointer-events-none opacity-0" : ""} flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-md ring-1 ring-black/10 max-w-[calc(100%-1rem)]`}>
            {hasItems &&
              LEGEND.map((l) => (
                <span key={l.label} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} aria-hidden="true" />
                  {l.label}
                </span>
              ))}
            {circles.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-4 rounded-sm border-2 border-dashed" style={{ borderColor: ZONE_COLOR }} aria-hidden="true" />
                Zone de recherche
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

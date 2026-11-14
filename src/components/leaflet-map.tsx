"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  /** Nombre affiché dans la pastille (annonces à cet endroit). */
  count?: number;
  color?: string;
  title: string;
  /** Lignes de l'infobulle. Insérées comme texte, jamais comme HTML. */
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
  /** Appelé quand l'utilisateur touche la carte (choix d'un point). */
  onPick?: (lat: number, lon: number) => void;
  /** Recadre la carte sur son contenu à chaque changement. */
  fitContent?: boolean;
  className?: string;
}

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// WHY: l'infobulle est construite nœud par nœud avec textContent. Les textes viennent de
// publications Facebook et TikTok : les insérer comme HTML permettrait d'injecter du code.
function popupContent(marker: MapMarker): HTMLElement {
  const root = document.createElement("div");
  root.style.minWidth = "180px";
  const title = document.createElement("strong");
  title.textContent = marker.title;
  root.appendChild(title);
  for (const line of marker.lines || []) {
    const p = document.createElement("div");
    p.textContent = line;
    p.style.marginTop = "4px";
    root.appendChild(p);
  }
  for (const link of marker.links || []) {
    const a = document.createElement("a");
    a.textContent = link.label;
    a.href = link.href;
    a.style.display = "block";
    a.style.marginTop = "6px";
    if (link.external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    root.appendChild(a);
  }
  return root;
}

/**
 * Carte OpenStreetMap : pastilles (annonces) et cercles (zones de recherche).
 * À charger via `components/map` : Leaflet a besoin du navigateur.
 */
export default function LeafletMap({ center, zoom = 12, markers = [], circles = [], onPick, fitContent, className }: LeafletMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = L.map(container.current, { center, zoom, scrollWheelZoom: true });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    instance.on("click", (e: L.LeafletMouseEvent) => pick.current?.(e.latlng.lat, e.latlng.lng));
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      layer.current = null;
    };
    // La carte n'est créée qu'une fois ; centre et contenu sont mis à jour par les effets suivants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const group = layer.current;
    const instance = map.current;
    if (!group || !instance) return;
    group.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    for (const c of circles) {
      const circle = L.circle([c.lat, c.lon], {
        radius: c.radiusKm * 1000,
        color: c.color || "#22c55e",
        weight: 2,
        fillOpacity: 0.08,
      }).addTo(group);
      if (c.label) circle.bindTooltip(c.label);
      const b = circle.getBounds();
      bounds.push(b.getNorthEast(), b.getSouthWest());
    }

    for (const m of markers) {
      const radius = m.count && m.count > 1 ? Math.min(22, 9 + Math.sqrt(m.count) * 3) : 8;
      const dot = L.circleMarker([m.lat, m.lon], {
        radius,
        color: "#ffffff",
        weight: 2,
        fillColor: m.color || "#22c55e",
        fillOpacity: 0.9,
      }).addTo(group);
      if (m.count && m.count > 1) {
        dot.bindTooltip(String(m.count), { permanent: true, direction: "center", className: "mca-count" });
      }
      dot.bindPopup(() => popupContent(m));
      bounds.push([m.lat, m.lon]);
    }

    if (fitContent && bounds.length) instance.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 15 });
  }, [markers, circles, fitContent]);

  useEffect(() => {
    if (!fitContent) map.current?.setView(center, map.current.getZoom());
  }, [center, fitContent]);

  return (
    <>
      <style>{`.mca-count{background:transparent;border:0;box-shadow:none;color:#fff;font-weight:700;font-size:11px}.mca-count::before{display:none}.leaflet-container{font:inherit;background:#e5e7eb}`}</style>
      <div ref={container} className={className || "h-[420px] w-full rounded-lg overflow-hidden"} />
    </>
  );
}

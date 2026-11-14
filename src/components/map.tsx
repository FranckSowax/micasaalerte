"use client";

import dynamic from "next/dynamic";
import type { LeafletMapProps } from "./leaflet-map";

export type { MapCircle, MapMarker } from "./leaflet-map";

/**
 * Carte prête à l'emploi. Leaflet manipule `window` : il n'est chargé que dans le navigateur.
 * @example <Map center={[0.43, 9.45]} markers={markers} circles={circles} fitContent />
 */
export const Map = dynamic<LeafletMapProps>(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="h-[420px] w-full rounded-lg bg-muted animate-pulse" />,
});

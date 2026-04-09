"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

export const GROUP_COLORS = [
  "#6366f1", // indigo  — You
  "#f59e0b", // amber   — Friend 1
  "#10b981", // emerald — Friend 2
  "#ec4899", // pink    — Friend 3
  "#8b5cf6", // violet  — Friend 4
  "#f97316", // orange  — Friend 5
];

export type GroupUser = {
  id: string;
  label: string;
  location: { latitude: number; longitude: number } | null;
};

type Props = {
  places: any[];
  userLocation: { latitude: number; longitude: number } | null;
  selectedPlace: any;
  onSelectPlace: (place: any) => void;
  groupUsers?: GroupUser[];
  groupMode?: boolean;
};

// ── DOM element builders ──────────────────────────────────────────────────────

function makePlaceEl(isSelected: boolean): HTMLElement {
  const el = document.createElement("div");
  const size = isSelected ? 18 : 13;
  el.style.cssText = `
    width:${size}px;height:${size}px;
    border-radius:50% 50% 50% 0;
    background:${isSelected ? "#facc15" : "#ef4444"};
    transform:rotate(-45deg);
    border:${isSelected ? "2.5px solid #fff" : "1.5px solid rgba(255,255,255,0.35)"};
    box-shadow:0 2px 6px rgba(0,0,0,0.55)${isSelected ? ",0 0 0 4px rgba(250,204,21,0.25)" : ""};
    cursor:pointer;transition:all 0.15s;
  `;
  return el;
}

function makeUserEl(color: string, label: string, isYou: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    display:flex;flex-direction:column;align-items:center;gap:3px;
    filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));
    z-index:9999;position:relative;
  `;

  const circle = document.createElement("div");
  circle.style.cssText = `
    width:42px;height:42px;border-radius:50%;
    background:${color};border:3px solid #fff;
    box-shadow:0 0 0 2.5px ${color},0 4px 12px rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;
    font-size:20px;line-height:1;
  `;
  circle.textContent = isYou ? "🧭" : "👤";

  const pill = document.createElement("div");
  pill.style.cssText = `
    background:${color};color:#fff;
    font-size:10px;font-weight:700;
    font-family:system-ui,-apple-system,sans-serif;
    padding:2px 8px;border-radius:20px;white-space:nowrap;
    border:1.5px solid rgba(255,255,255,0.35);letter-spacing:0.02em;
    box-shadow:0 2px 6px rgba(0,0,0,0.4);
  `;
  pill.textContent = label;

  wrap.appendChild(circle);
  wrap.appendChild(pill);
  return wrap;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MapView({
  places,
  userLocation,
  selectedPlace,
  onSelectPlace,
  groupUsers = [],
  groupMode = false,
}: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<mapboxgl.Map | null>(null);
  const placeMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const userMarkersRef  = useRef<mapboxgl.Marker[]>([]);
  const initDoneRef     = useRef(false);
  const hasFlewRef      = useRef(false);

  // ── Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (initDoneRef.current || !containerRef.current || !userLocation) return;
    initDoneRef.current = true;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 13,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      initDoneRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!userLocation]);

  // ── Fly when userLocation changes ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !userLocation) return;
    if (!hasFlewRef.current) { hasFlewRef.current = true; return; }
    mapRef.current.flyTo({ center: [userLocation.longitude, userLocation.latitude], zoom: 13, essential: true });
  }, [userLocation]);

  // ── Place markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;

    const render = () => {
      placeMarkersRef.current.forEach(m => m.remove());
      placeMarkersRef.current = [];

      places.forEach(place => {
        const isSel = !!(
          selectedPlace &&
          selectedPlace.tags?.name === place.tags?.name &&
          Math.abs((selectedPlace.lat ?? 0) - place.lat) < 0.0001
        );
        const el = makePlaceEl(isSel);

        const popup = new mapboxgl.Popup({ offset: 12, closeButton: false, maxWidth: "220px" })
          .setHTML(`
            <div style="font-family:system-ui,sans-serif;padding:4px 2px">
              <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:2px">${place.tags.name}</div>
              ${place.tags.cuisine ? `<div style="font-size:10px;color:#666;margin-bottom:4px;text-transform:capitalize">${(place.tags.cuisine ?? "").replace(/food and drink,?\s*/gi,"").replace(/food,?\s*/gi,"").trim()}</div>` : ""}
              <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:12px;font-weight:600;color:${place.estimatedCostForTwo<=400?"#16a34a":place.estimatedCostForTwo<=900?"#d97706":"#dc2626"}">≈ ₹${place.estimatedCostForTwo}</span>
                <span style="font-size:10px;color:#888">${(place.distance??0).toFixed(2)} km</span>
              </div>
              ${place.tags.address ? `<div style="font-size:9px;color:#aaa;margin-top:3px;line-height:1.4">${place.tags.address}</div>` : ""}
            </div>
          `);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([place.lon, place.lat])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener("click", () => { onSelectPlace(place); popup.addTo(map); });
        if (isSel) marker.togglePopup();
        placeMarkersRef.current.push(marker);
      });
    };

    if (map.isStyleLoaded()) render();
    else map.once("style.load", render);
  }, [places, selectedPlace, userLocation, onSelectPlace]);

  // ── User / group markers — always re-run when groupUsers changes ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      // Remove old user markers
      userMarkersRef.current.forEach(m => m.remove());
      userMarkersRef.current = [];

      // Remove old group line
      try { if (map.getLayer("gl")) map.removeLayer("gl"); } catch {}
      try { if (map.getSource("gs")) map.removeSource("gs"); } catch {}

      if (groupMode && groupUsers.length > 0) {
        const active = groupUsers.filter(u => u.location != null);

        active.forEach((user, idx) => {
          const color = GROUP_COLORS[idx % GROUP_COLORS.length];
          const el = makeUserEl(color, user.label, user.id === "you");
          // Higher z-index via className on the marker wrapper
          const m = new mapboxgl.Marker({ element: el, anchor: "bottom" })
            .setLngLat([user.location!.longitude, user.location!.latitude])
            .addTo(map);
          // Force z-index on the mapboxgl marker container
          const markerEl = m.getElement();
          markerEl.style.zIndex = "9999";
          userMarkersRef.current.push(m);
        });

        // Dashed line between users
        if (active.length >= 2) {
          const coords = active.map(u => [u.location!.longitude, u.location!.latitude]);
          try {
            map.addSource("gs", {
              type: "geojson",
              data: { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} },
            });
            map.addLayer({
              id: "gl", type: "line", source: "gs",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": "#6366f1", "line-width": 2, "line-dasharray": [2, 3], "line-opacity": 0.55 },
            });
          } catch { /* already exists, ignore */ }
        }

      } else if (userLocation) {
        // Solo — just "You"
        const el = makeUserEl(GROUP_COLORS[0], "You", true);
        const m = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([userLocation.longitude, userLocation.latitude])
          .addTo(map);
        m.getElement().style.zIndex = "9999";
        userMarkersRef.current.push(m);
      }
    };

    if (map.isStyleLoaded()) render();
    else map.once("style.load", render);

  // Stringify locations so React detects deep changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupMode, userLocation, JSON.stringify(groupUsers.map(u => ({ id: u.id, label: u.label, loc: u.location })))]);

  // ── Fly to selected place ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !selectedPlace) return;
    mapRef.current.flyTo({ center: [selectedPlace.lon, selectedPlace.lat], zoom: 15, essential: true });
  }, [selectedPlace]);

  return <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />;
}
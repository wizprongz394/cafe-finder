"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

export const GROUP_COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#f97316",
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

function makePlaceEl(isSelected: boolean): HTMLElement {
  const el = document.createElement("div");
  const size = isSelected ? 20 : 14;
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    `border-radius:50% 50% 50% 0`,
    `background:${isSelected ? "#facc15" : "#ef4444"}`,
    `transform:rotate(-45deg)`,
    `border:${isSelected ? "2.5px solid #fff" : "1.5px solid rgba(255,255,255,0.4)"}`,
    `box-shadow:0 2px 8px rgba(0,0,0,0.6)${isSelected ? ",0 0 0 5px rgba(250,204,21,0.2)" : ""}`,
    `cursor:pointer`,
    `transition:transform 0.12s`,
    `pointer-events:all`,
    `position:relative`,
    `z-index:${isSelected ? 200 : 100}`,
  ].join(";");
  return el;
}

function makeUserEl(color: string, label: string, isYou: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = [
    `display:flex`,
    `flex-direction:column`,
    `align-items:center`,
    `gap:3px`,
    `pointer-events:none`,
    `position:relative`,
    `z-index:9999`,
  ].join(";");

  const circle = document.createElement("div");
  circle.style.cssText = [
    `width:40px`,
    `height:40px`,
    `border-radius:50%`,
    `background:${color}`,
    `border:3px solid #fff`,
    `box-shadow:0 0 0 2.5px ${color},0 4px 12px rgba(0,0,0,0.55)`,
    `display:flex`,
    `align-items:center`,
    `justify-content:center`,
    `font-size:18px`,
    `line-height:1`,
    `pointer-events:none`,
  ].join(";");
  circle.textContent = isYou ? "🧭" : "👤";

  const pill = document.createElement("div");
  pill.style.cssText = [
    `background:${color}`,
    `color:#fff`,
    `font-size:10px`,
    `font-weight:700`,
    `font-family:system-ui,-apple-system,sans-serif`,
    `padding:2px 7px`,
    `border-radius:20px`,
    `white-space:nowrap`,
    `border:1.5px solid rgba(255,255,255,0.3)`,
    `box-shadow:0 2px 6px rgba(0,0,0,0.4)`,
    `pointer-events:none`,
  ].join(";");
  pill.textContent = label;

  wrap.appendChild(circle);
  wrap.appendChild(pill);
  return wrap;
}

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
  // Keep latest callbacks in refs so effects don't go stale
  const onSelectRef     = useRef(onSelectPlace);
  useEffect(() => { onSelectRef.current = onSelectPlace; }, [onSelectPlace]);

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
      hasFlewRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!userLocation]);

  // ── Fly when center changes (location search / group centroid) ────────────
  useEffect(() => {
    if (!mapRef.current || !userLocation) return;
    if (!hasFlewRef.current) { hasFlewRef.current = true; return; }
    mapRef.current.flyTo({
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 13,
      essential: true,
    });
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

        const popup = new mapboxgl.Popup({
          offset: 14,
          closeButton: false,
          maxWidth: "230px",
        }).setHTML(`
          <div style="font-family:system-ui,sans-serif;padding:5px 3px;min-width:150px">
            <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:3px;line-height:1.3">${place.tags.name}</div>
            ${place.tags.cuisine
              ? `<div style="font-size:10px;color:#777;margin-bottom:4px;text-transform:capitalize">
                  ${(place.tags.cuisine ?? "").replace(/food and drink,?\s*/gi, "").replace(/food,?\s*/gi, "").trim()}
                </div>`
              : ""}
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
              <span style="font-size:13px;font-weight:700;color:${
                place.estimatedCostForTwo <= 400 ? "#16a34a"
                : place.estimatedCostForTwo <= 900 ? "#d97706" : "#dc2626"
              }">≈ ₹${place.estimatedCostForTwo}</span>
              <span style="font-size:10px;color:#999">${(place.distance ?? 0).toFixed(2)} km</span>
            </div>
            ${place.tags.address
              ? `<div style="font-size:9px;color:#bbb;line-height:1.4">${place.tags.address}</div>`
              : ""}
          </div>
        `);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([place.lon, place.lat])
          .setPopup(popup)
          .addTo(map);

        // Use click on el for immediate response
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current(place);
          // Open popup after short delay to let React re-render first
          setTimeout(() => popup.addTo(map), 30);
        });

        if (isSel) {
          setTimeout(() => {
            try { marker.togglePopup(); } catch {}
          }, 50);
        }

        placeMarkersRef.current.push(marker);
      });
    };

    if (map.isStyleLoaded()) render();
    else map.once("style.load", render);

  }, [places, selectedPlace, userLocation]); // onSelectPlace intentionally omitted — using ref

  // ── User / group markers ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      userMarkersRef.current.forEach(m => m.remove());
      userMarkersRef.current = [];
      try { if (map.getLayer("gl")) map.removeLayer("gl"); } catch {}
      try { if (map.getSource("gs")) map.removeSource("gs"); } catch {}

      if (groupMode && groupUsers.length > 0) {
        const active = groupUsers.filter(u => u.location != null);
        active.forEach((user, idx) => {
          const color = GROUP_COLORS[idx % GROUP_COLORS.length];
          const el = makeUserEl(color, user.label, user.id === "you");
          const m = new mapboxgl.Marker({ element: el, anchor: "bottom" })
            .setLngLat([user.location!.longitude, user.location!.latitude])
            .addTo(map);
          const wrapper = m.getElement();
          wrapper.style.zIndex = "9999";
          wrapper.style.pointerEvents = "none";
          userMarkersRef.current.push(m);
        });

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
              paint: { "line-color": "#6366f1", "line-width": 2, "line-dasharray": [2, 3], "line-opacity": 0.5 },
            });
          } catch {}
        }
      } else if (userLocation) {
        const el = makeUserEl(GROUP_COLORS[0], "You", true);
        const m = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([userLocation.longitude, userLocation.latitude])
          .addTo(map);
        const wrapper = m.getElement();
        wrapper.style.zIndex = "9999";
        wrapper.style.pointerEvents = "none";
        userMarkersRef.current.push(m);
      }
    };

    if (map.isStyleLoaded()) render();
    else map.once("style.load", render);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupMode, userLocation, JSON.stringify(groupUsers.map(u => ({ id: u.id, label: u.label, loc: u.location })))]);

  // ── Fly to selected place ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !selectedPlace) return;
    mapRef.current.flyTo({
      center: [selectedPlace.lon, selectedPlace.lat],
      zoom: 15,
      essential: true,
      duration: 600,
    });
  }, [selectedPlace]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ cursor: "grab" }}
    />
  );
}
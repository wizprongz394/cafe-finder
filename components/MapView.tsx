"use client";

import { useEffect, useRef, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

export const GROUP_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#f97316",
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

const getPlaceId = (place: any) =>
  `${place.lat?.toFixed(6) ?? "0"}-${place.lon?.toFixed(6) ?? "0"}-${place.tags?.name?.slice(0, 20) ?? "x"}`;

const esc = (s: string) =>
  (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

const popupHTML = (place: any) => {
  const cost = place.estimatedCostForTwo || 600;
  const col = cost <= 400 ? "#10b981" : cost <= 900 ? "#f59e0b" : "#ef4444";
  const sym = cost <= 400 ? "₹" : cost <= 700 ? "₹₹" : cost <= 1200 ? "₹₹₹" : "₹₹₹₹";
  const cuisine = (place.tags?.cuisine || "").replace(/food and drink,?\s*/gi,"").replace(/food,?\s*/gi,"").trim();
  return `<div style="font-family:system-ui,sans-serif;padding:10px 8px;min-width:180px">
    <div style="font-weight:700;font-size:14px;color:#111;margin-bottom:4px">${esc(place.tags?.name||"Unnamed")}</div>
    ${cuisine?`<div style="font-size:11px;color:#666;margin-bottom:4px">${esc(cuisine)}</div>`:""}
    <div style="font-size:14px;font-weight:700;color:${col}">${sym} ≈ ₹${cost} <span style="font-size:11px;color:#888;font-weight:400">· ${(place.distance||0).toFixed(2)} km</span></div>
    ${place.tags?.address?`<div style="font-size:10px;color:#999;margin-top:5px;border-top:1px solid #eee;padding-top:5px">${esc(place.tags.address)}</div>`:""}
  </div>`;
};

export default function MapView({
  places, userLocation, selectedPlace, onSelectPlace,
  groupUsers = [], groupMode = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  // overlay div that sits on top of the map canvas — we position user markers inside it
  const overlayRef   = useRef<HTMLDivElement | null>(null);

  const mapLoadedRef    = useRef(false);
  const sourcesReadyRef = useRef(false);
  const firstFlyRef     = useRef(false);

  // Always-current refs — updated during render (before effects)
  const onSelectRef     = useRef(onSelectPlace);
  const userLocRef      = useRef(userLocation);
  const groupUsersRef   = useRef(groupUsers);
  const groupModeRef    = useRef(groupMode);

  onSelectRef.current   = onSelectPlace;
  userLocRef.current    = userLocation;
  groupUsersRef.current = groupUsers;
  groupModeRef.current  = groupMode;

  const placeIds = useMemo(() => new Map(places.map(p => [getPlaceId(p), p])), [places]);

  // ── Build one user-pin DOM node ────────────────────────────────────────
  const makePin = (color: string, label: string, isYou: boolean) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      position:absolute;
      display:flex;flex-direction:column;align-items:center;gap:4px;
      transform:translate(-50%,-100%);
      pointer-events:none;
      z-index:9999;
    `;

    const circle = document.createElement("div");
    circle.style.cssText = `
      width:44px;height:44px;border-radius:50%;
      background:${color};border:3px solid #fff;
      box-shadow:0 0 0 3px ${color}55, 0 4px 14px rgba(0,0,0,0.55);
      display:flex;align-items:center;justify-content:center;
      font-size:22px;line-height:1;
    `;
    circle.textContent = isYou ? "🧭" : "👤";

    const pill = document.createElement("div");
    pill.style.cssText = `
      background:${color};color:#fff;
      font-size:11px;font-weight:700;font-family:system-ui,sans-serif;
      padding:3px 10px;border-radius:20px;
      border:1.5px solid rgba(255,255,255,0.35);
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      white-space:nowrap;
    `;
    pill.textContent = label;

    wrap.appendChild(circle);
    wrap.appendChild(pill);
    return wrap;
  };

  // ── Position all user pins using map.project() ─────────────────────────
  const renderUserOverlay = () => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay || !mapLoadedRef.current) return;

    // wipe previous pins
    overlay.innerHTML = "";

    const loc     = userLocRef.current;
    const grpMode = groupModeRef.current;
    const grpUsers = groupUsersRef.current;

    const toPlace = (latitude: number, longitude: number, color: string, label: string, isYou: boolean) => {
      // project geographic coords → pixel coords relative to map container
      const { x, y } = map.project([longitude, latitude]);
      const pin = makePin(color, label, isYou);
      pin.style.left = `${x}px`;
      pin.style.top  = `${y}px`;
      overlay.appendChild(pin);
    };

    if (grpMode && grpUsers.length > 0) {
      grpUsers.filter(u => u.location).forEach((u, i) => {
        toPlace(u.location!.latitude, u.location!.longitude,
          GROUP_COLORS[i % GROUP_COLORS.length], u.label, u.id === "you");
      });
    } else if (loc) {
      toPlace(loc.latitude, loc.longitude, GROUP_COLORS[0], "You", true);
    }
  };

  // ── Init map ONCE ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !userLocation || mapRef.current) return;

    // Create the transparent overlay div that lives above the canvas
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:absolute;inset:0;
      pointer-events:none;
      z-index:10;
      overflow:visible;
    `;
    containerRef.current.appendChild(overlay);
    overlayRef.current = overlay;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 14,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(
      new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      "top-right"
    );

    map.on("load", () => {
      mapLoadedRef.current = true;

      map.addSource("places", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true, clusterMaxZoom: 14, clusterRadius: 50,
      });

      map.addLayer({
        id: "clusters", type: "circle", source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step",["get","point_count"],"#6366f1",10,"#8b5cf6",30,"#a855f7"],
          "circle-radius": ["step",["get","point_count"],20,10,30,30,40],
          "circle-stroke-width": 3, "circle-stroke-color": "#fff",
        },
      });
      map.addLayer({
        id: "cluster-count", type: "symbol", source: "places",
        filter: ["has","point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 13 },
        paint: { "text-color": "#fff" },
      });
      map.addLayer({
        id: "unclustered-point", type: "circle", source: "places",
        filter: ["!",["has","point_count"]],
        paint: {
          "circle-color": ["case",["<="  ,["get","cost"],400],"#10b981",["<=",["get","cost"],900],"#f59e0b","#ef4444"],
          "circle-radius": 7,
          "circle-stroke-width": 2, "circle-stroke-color": "#fff",
        },
      });

      map.on("click","clusters",(e)=>{
        const f = map.queryRenderedFeatures(e.point,{layers:["clusters"]});
        const cid = f[0]?.properties?.cluster_id; if(!cid) return;
        (map.getSource("places") as mapboxgl.GeoJSONSource)
          .getClusterExpansionZoom(cid,(err,zoom)=>{
            if(err||zoom==null) return;
            map.easeTo({center:(f[0].geometry as any).coordinates, zoom:zoom+1});
          });
      });
      map.on("click","unclustered-point",(e)=>{
        const feat = e.features?.[0]; if(!feat) return;
        const place = placeIds.get(feat.properties?.placeId); if(!place) return;
        onSelectRef.current(place);
        new mapboxgl.Popup({offset:20})
          .setLngLat((feat.geometry as GeoJSON.Point).coordinates as [number,number])
          .setHTML(popupHTML(place)).addTo(map);
      });
      ["clusters","unclustered-point"].forEach(l=>{
        map.on("mouseenter",l,()=>{ map.getCanvas().style.cursor="pointer"; });
        map.on("mouseleave",l,()=>{ map.getCanvas().style.cursor=""; });
      });

      sourcesReadyRef.current = true;
    });

    // Re-project pins whenever the map moves / zooms / rotates
    const reproject = () => renderUserOverlay();
    map.on("move",   reproject);
    map.on("zoom",   reproject);
    map.on("rotate", reproject);
    map.on("pitch",  reproject);

    // Initial render — fire after first idle so project() is accurate
    map.once("idle", () => renderUserOverlay());

    return () => {
      overlay.remove();
      overlayRef.current = null;
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
      sourcesReadyRef.current = false;
      firstFlyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!userLocation]);

  // ── Update place dots ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sourcesReadyRef.current) return;
    const src = map.getSource("places") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: places.map(p => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { placeId: getPlaceId(p), name: p.tags?.name||"Unnamed", cost: p.estimatedCostForTwo||600 },
      })),
    });
  }, [places]);

  // ── Re-render user pins when location / group changes ─────────────────
  useEffect(() => {
    renderUserOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userLocation?.latitude, userLocation?.longitude,
    groupMode,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(groupUsers.map(u=>({ id:u.id, lat:u.location?.latitude, lon:u.location?.longitude }))),
  ]);

  // ── Fly to selected place ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPlace || !mapLoadedRef.current) return;
    map.flyTo({ center: [selectedPlace.lon, selectedPlace.lat], zoom: 16, duration: 800 });
    new mapboxgl.Popup({ offset: 20 })
      .setLngLat([selectedPlace.lon, selectedPlace.lat])
      .setHTML(popupHTML(selectedPlace))
      .addTo(map);
  }, [selectedPlace]);

  // ── Fly when userLocation changes ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation || !mapLoadedRef.current) return;
    if (!firstFlyRef.current) { firstFlyRef.current = true; return; }
    map.flyTo({ center: [userLocation.longitude, userLocation.latitude], zoom: 14, duration: 900 });
  }, [userLocation]);

  return (
    <div ref={containerRef} style={{ width:"100%", height:"100%", cursor:"grab", position:"relative" }} />
  );
}
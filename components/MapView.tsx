"use client";

import { useEffect, useRef, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

// 🎨 Cafe Theme Colors
export const GROUP_COLORS = [
  "#C08552", // caramel
  "#5E3023", // brownie
  "#895737", // coffee
  "#3E000C", // chocolate
  "#8B5E3C", // warm brown
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

// 🎨 Themed popup HTML
const popupHTML = (place: any) => {
  const cost = place.estimatedCostForTwo || 600;
  const col = cost <= 400 ? "#4a7c59" : cost <= 900 ? "#C08552" : "#9e3a3a";
  const sym = cost <= 300 ? "₹" : cost <= 700 ? "₹₹" : cost <= 1200 ? "₹₹₹" : "₹₹₹₹";
  const cuisine = (place.tags?.cuisine || "").replace(/food and drink,?\s*/gi,"").replace(/food,?\s*/gi,"").trim();
  
  // Get emoji based on place
  const name = (place.tags?.name || "").toLowerCase();
  let emoji = "🍽️";
  if (/momo/.test(name)) emoji = "🥟";
  else if (/biryani/.test(name)) emoji = "🍚";
  else if (/pizza/.test(name)) emoji = "🍕";
  else if (/burger/.test(name)) emoji = "🍔";
  else if (/cake|bakery/.test(name)) emoji = "🥐";
  else if (/tea|chai/.test(name)) emoji = "🍵";
  else if (/coffee|cafe/.test(name)) emoji = "☕";
  else if (/chinese|noodle/.test(name)) emoji = "🍜";
  else if (place.tags?.amenity === "cafe") emoji = "☕";
  else if (place.tags?.amenity === "fast_food") emoji = "🍔";
  
  return `<div style="font-family:'DM Sans',system-ui,sans-serif;padding:12px 10px;min-width:200px;background:#FFECD1;border-radius:12px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="font-size:20px;">${emoji}</span>
      <span style="font-weight:600;font-size:14px;color:#3E000C;">${esc(place.tags?.name||"Unnamed")}</span>
    </div>
    ${cuisine?`<div style="font-size:11px;color:#895737;margin-bottom:6px;text-transform:capitalize;">${esc(cuisine)}</div>`:""}
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:14px;font-weight:600;color:${col};">${sym} ≈ ₹${cost}</span>
      <span style="font-size:11px;color:#895737;">📍 ${(place.distance||0).toFixed(2)} km</span>
    </div>
    ${place.tags?.address?`<div style="font-size:10px;color:#895737;margin-top:8px;padding-top:8px;border-top:1px solid rgba(192,133,82,0.25);">${esc(place.tags.address)}</div>`:""}
  </div>`;
};

export default function MapView({
  places, userLocation, selectedPlace, onSelectPlace,
  groupUsers = [], groupMode = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const overlayRef   = useRef<HTMLDivElement | null>(null);

  const mapLoadedRef    = useRef(false);
  const sourcesReadyRef = useRef(false);
  const firstFlyRef     = useRef(false);

  const onSelectRef     = useRef(onSelectPlace);
  const userLocRef      = useRef(userLocation);
  const groupUsersRef   = useRef(groupUsers);
  const groupModeRef    = useRef(groupMode);

  onSelectRef.current   = onSelectPlace;
  userLocRef.current    = userLocation;
  groupUsersRef.current = groupUsers;
  groupModeRef.current  = groupMode;

  const placeIds = useMemo(() => new Map(places.map(p => [getPlaceId(p), p])), [places]);

  // 🎨 Themed user pin with cafe colors
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
      background:${color};
      border:3px solid #FFECD1;
      box-shadow:0 0 0 3px ${color}40, 0 4px 16px rgba(62,0,12,0.4);
      display:flex;align-items:center;justify-content:center;
      font-size:22px;line-height:1;
    `;
    circle.textContent = isYou ? "🧭" : "👤";

    const pill = document.createElement("div");
    pill.style.cssText = `
      background:${color};
      color:#FFECD1;
      font-size:11px;font-weight:600;font-family:'DM Sans',system-ui,sans-serif;
      padding:4px 10px;border-radius:20px;
      border:1.5px solid rgba(255,236,209,0.35);
      box-shadow:0 2px 8px rgba(62,0,12,0.3);
      white-space:nowrap;
      letter-spacing:0.03em;
    `;
    pill.textContent = label;

    wrap.appendChild(circle);
    wrap.appendChild(pill);
    return wrap;
  };

  const renderUserOverlay = () => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay || !mapLoadedRef.current) return;

    overlay.innerHTML = "";

    const loc     = userLocRef.current;
    const grpMode = groupModeRef.current;
    const grpUsers = groupUsersRef.current;

    const toPlace = (latitude: number, longitude: number, color: string, label: string, isYou: boolean) => {
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

  useEffect(() => {
    if (!containerRef.current || !userLocation || mapRef.current) return;

    // ✅ FIX: Create map first (container must be empty)
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 14,
    });
    mapRef.current = map;

    // ✅ FIX: Add overlay AFTER map canvas is created
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:absolute;inset:0;
      pointer-events:none;
      z-index:10;
      overflow:visible;
    `;
    containerRef.current.appendChild(overlay);
    overlayRef.current = overlay;

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

      // 🎨 Themed cluster colors
      map.addLayer({
        id: "clusters", type: "circle", source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step",["get","point_count"],"#C08552",10,"#895737",30,"#5E3023"],
          "circle-radius": ["step",["get","point_count"],20,10,30,30,40],
          "circle-stroke-width": 3, 
          "circle-stroke-color": "#FFECD1",
        },
      });
      map.addLayer({
        id: "cluster-count", type: "symbol", source: "places",
        filter: ["has","point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 13 },
        paint: { "text-color": "#FFECD1" },
      });
      
      // 🎨 Themed point colors (green/caramel/red)
      map.addLayer({
        id: "unclustered-point", type: "circle", source: "places",
        filter: ["!",["has","point_count"]],
        paint: {
          "circle-color": ["case",
            ["<=",["get","cost"],400],"#4a7c59",
            ["<=",["get","cost"],900],"#C08552",
            "#9e3a3a"
          ],
          "circle-radius": 7,
          "circle-stroke-width": 2, 
          "circle-stroke-color": "#FFECD1",
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
      
      // ✅ FIX: Render user overlay after map is fully loaded
      setTimeout(() => renderUserOverlay(), 50);
    });

    const reproject = () => renderUserOverlay();
    map.on("move",   reproject);
    map.on("zoom",   reproject);
    map.on("rotate", reproject);
    map.on("pitch",  reproject);

    map.once("idle", () => renderUserOverlay());

    return () => {
      // ✅ FIX: Clean up overlay properly
      if (overlayRef.current) {
        overlayRef.current.remove();
        overlayRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      mapLoadedRef.current = false;
      sourcesReadyRef.current = false;
      firstFlyRef.current = false;
    };
  }, [!!userLocation]);

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

  useEffect(() => {
    renderUserOverlay();
  }, [
    userLocation?.latitude, userLocation?.longitude,
    groupMode,
    JSON.stringify(groupUsers.map(u=>({ id:u.id, lat:u.location?.latitude, lon:u.location?.longitude }))),
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPlace || !mapLoadedRef.current) return;
    map.flyTo({ center: [selectedPlace.lon, selectedPlace.lat], zoom: 16, duration: 800 });
    new mapboxgl.Popup({ offset: 20 })
      .setLngLat([selectedPlace.lon, selectedPlace.lat])
      .setHTML(popupHTML(selectedPlace))
      .addTo(map);
  }, [selectedPlace]);

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
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

// ─── Helpers ─────────────────────────────────────────────────────────────

const getPlaceId = (place: any): string => {
  return `${place.lat?.toFixed(6) ?? '0'}-${place.lon?.toFixed(6) ?? '0'}-${place.tags?.name?.slice(0, 20) ?? 'unnamed'}`;
};

const escapeHtml = (str: string): string => {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const createPopupHTML = (place: any): string => {
  const name = place.tags?.name || "Unnamed Place";
  const cuisine = (place.tags?.cuisine || "")
    .replace(/food and drink,?\s*/gi, "")
    .replace(/food,?\s*/gi, "")
    .trim();
  const address = place.tags?.address || "";
  const cost = place.estimatedCostForTwo || 600;
  const distance = place.distance || 0;
  
  const costColor = cost <= 400 ? "#10b981" : cost <= 900 ? "#f59e0b" : "#ef4444";
  const priceSymbol = cost <= 400 ? "₹" : cost <= 700 ? "₹₹" : cost <= 1200 ? "₹₹₹" : "₹₹₹₹";
  
  return `
    <div style="font-family: system-ui, sans-serif; padding: 10px 8px; min-width: 180px;">
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
        <span style="font-size: 18px;">🍽️</span>
        <span style="font-weight: 700; font-size: 14px; color: #111;">${escapeHtml(name)}</span>
      </div>
      ${cuisine ? `<div style="font-size: 11px; color: #666; margin-bottom: 6px;">${escapeHtml(cuisine)}</div>` : ""}
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
        <span style="font-size: 15px; font-weight: 700; color: ${costColor};">${priceSymbol} ≈ ₹${cost}</span>
        <span style="font-size: 11px; color: #888;">📏 ${distance.toFixed(2)} km</span>
      </div>
      ${address ? `<div style="font-size: 10px; color: #999; padding-top: 6px; border-top: 1px solid #eee;">${escapeHtml(address)}</div>` : ""}
    </div>
  `;
};

const createUserMarker = (color: string, label: string, isYou: boolean): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;`;
  
  const circle = document.createElement("div");
  circle.style.cssText = `width:44px;height:44px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 3px ${color}40,0 4px 16px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:22px;`;
  circle.textContent = isYou ? "🧭" : "👤";
  
  const pill = document.createElement("div");
  pill.style.cssText = `background:${color};color:white;font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1.5px solid rgba(255,255,255,0.3);box-shadow:0 3px 10px rgba(0,0,0,0.3);`;
  pill.textContent = label;
  
  wrap.appendChild(circle);
  wrap.appendChild(pill);
  return wrap;
};

// ─── Main Component ───────────────────────────────────────────────────────

export default function MapView({
  places,
  userLocation,
  selectedPlace,
  onSelectPlace,
  groupUsers = [],
  groupMode = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const mapLoadedRef = useRef(false);
  const sourcesReadyRef = useRef(false);
  const initialCenterDoneRef = useRef(false);
  
  const onSelectRef = useRef(onSelectPlace);
  useEffect(() => { onSelectRef.current = onSelectPlace; }, [onSelectPlace]);
  
  const placeIds = useMemo(() => new Map(places.map(p => [getPlaceId(p), p])), [places]);
  
  // 🎯 Initialize map ONCE
  useEffect(() => {
    if (!containerRef.current || !userLocation || mapRef.current) return;
    
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 14,
    });
    
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    }), "top-right");
    
    map.on("load", () => {
      mapLoadedRef.current = true;
      
      // Add source - ONLY ONCE
      map.addSource("places", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });
      
      // Cluster layer
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#6366f1", 10, "#8b5cf6", 30, "#a855f7"],
          "circle-radius": ["step", ["get", "point_count"], 20, 10, 30, 30, 40],
          "circle-stroke-width": 3,
          "circle-stroke-color": "#fff",
        },
      });
      
      // Cluster count
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "places",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 13 },
        paint: { "text-color": "#fff" },
      });
      
      // Unclustered points
      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["case", ["<=", ["get", "cost"], 400], "#10b981", ["<=", ["get", "cost"], 900], "#f59e0b", "#ef4444"],
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
      
      // Cluster click
      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (!clusterId) return;
        
        const source = map.getSource("places") as mapboxgl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          const coords = (features[0].geometry as any).coordinates;
          map.easeTo({ center: coords, zoom: zoom + 1 });
        });
      });
      
      // Point click
      map.on("click", "unclustered-point", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const place = placeIds.get(feature.properties?.placeId);
        if (place) {
          onSelectRef.current(place);
          new mapboxgl.Popup({ offset: 20 })
            .setLngLat((feature.geometry as GeoJSON.Point).coordinates as [number, number])
            .setHTML(createPopupHTML(place))
            .addTo(map);
        }
      });
      
      // Hover
      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "unclustered-point", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "unclustered-point", () => { map.getCanvas().style.cursor = ""; });
      
      sourcesReadyRef.current = true;
      
      // 🎯 FIX: Force initial user marker render after map load
      setTimeout(() => {
        renderUserMarkers();
      }, 100);
    });
    
    return () => {
      userMarkersRef.current.forEach(m => m.remove());
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
      sourcesReadyRef.current = false;
      initialCenterDoneRef.current = false;
    };
  }, [userLocation]);
  
  // 🎯 FIX: Separate function for user markers to avoid dependency issues
  const renderUserMarkers = () => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    
    // Clear existing
    userMarkersRef.current.forEach(m => m.remove());
    userMarkersRef.current = [];
    
    // Remove group line
    try { if (map.getLayer("group-line")) map.removeLayer("group-line"); } catch {}
    try { if (map.getSource("group-line")) map.removeSource("group-line"); } catch {}
    
    // Determine who to show
    let activeUsers: Array<{ id: string; label: string; location: { latitude: number; longitude: number } }> = [];
    
    if (groupMode) {
      activeUsers = groupUsers.filter(u => u.location != null).map(u => ({
        id: u.id,
        label: u.label,
        location: u.location!,
      }));
    } else {
      // Always show You marker in solo mode
      if (userLocation) {
        activeUsers = [{ id: "you", label: "You", location: userLocation }];
      }
    }
    
    console.log("🎯 Rendering user markers:", activeUsers.length, "users");
    
    // Add markers
    activeUsers.forEach((user, idx) => {
      const color = GROUP_COLORS[idx % GROUP_COLORS.length];
      const el = createUserMarker(color, user.label, user.id === "you");
      
      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([user.location.longitude, user.location.latitude])
        .addTo(map);
      
      // Ensure high z-index
      const wrapper = marker.getElement();
      wrapper.style.zIndex = "9999";
      
      userMarkersRef.current.push(marker);
    });
    
    // Group connection line
    if (groupMode && activeUsers.length >= 2) {
      const coords = activeUsers.map(u => [u.location.longitude, u.location.latitude]);
      map.addSource("group-line", { 
        type: "geojson", 
        data: { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} } 
      });
      map.addLayer({ 
        id: "group-line", 
        type: "line", 
        source: "group-line", 
        paint: { "line-color": "#6366f1", "line-width": 3, "line-dasharray": [1, 6], "line-opacity": 0.6 } 
      });
    }
  };
  
  // 🎯 Update places data - DOES NOT recreate source, only updates data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !sourcesReadyRef.current) return;
    
    const source = map.getSource("places") as mapboxgl.GeoJSONSource;
    if (!source) return;
    
    const features = places.map(place => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
      properties: {
        placeId: getPlaceId(place),
        name: place.tags?.name || "Unnamed",
        cost: place.estimatedCostForTwo || 600,
      },
    }));
    
    // 🎯 FIX: Update data without removing markers
    source.setData({ type: "FeatureCollection", features });
    
    console.log("📍 Updated places:", features.length, "markers");
  }, [places]);
  
  // 🎯 FIX: User markers effect with stable dependencies
  useEffect(() => {
    renderUserMarkers();
  }, [groupMode, userLocation, JSON.stringify(groupUsers)]);
  
  // 🎯 Fly to selected place
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPlace || !mapLoadedRef.current) return;
    
    map.flyTo({ 
      center: [selectedPlace.lon, selectedPlace.lat], 
      zoom: 16, 
      duration: 800 
    });
    
    new mapboxgl.Popup({ offset: 20 })
      .setLngLat([selectedPlace.lon, selectedPlace.lat])
      .setHTML(createPopupHTML(selectedPlace))
      .addTo(map);
  }, [selectedPlace]);
  
  // 🎯 Center on user location when it changes (only once after initial)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation || !mapLoadedRef.current) return;
    
    if (!initialCenterDoneRef.current) {
      initialCenterDoneRef.current = true;
      return;
    }
    
    map.flyTo({ 
      center: [userLocation.longitude, userLocation.latitude], 
      zoom: 14, 
      duration: 1000 
    });
  }, [userLocation]);
  
  return <div ref={containerRef} className="w-full h-full" style={{ cursor: "grab" }} />;
}
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapView from "@/components/MapView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLon { latitude: number; longitude: number; }
interface PlaceTag { name: string; amenity: string; [key: string]: string | undefined; }
interface RawPlace { lat: number; lon: number; tags: PlaceTag; }
interface EnrichedPlace extends RawPlace { distance: number; estimatedCostForTwo: number; score: number; }
interface MapboxFeature { center: [number, number]; place_name: string; text: string; }

// ─── Pure helpers (stable — defined outside component) ────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function estimateCost(place: RawPlace): number {
  const t = place.tags?.amenity;
  if (t === "fast_food") return 300;
  if (t === "cafe") return 700;
  if (t === "restaurant") return 1000;
  return 800;
}

function computeScore(p: EnrichedPlace): number {
  let score = 0;

  // 📍 Distance (stronger decay)
  score += Math.max(0, 15 - p.distance * 3);

  // 🍽️ Type preference
  if (p.tags?.amenity === "cafe") score += 4;
  if (p.tags?.amenity === "restaurant") score += 3;

  // 💰 Budget sweet spot (your 700–900 logic)
  if (p.estimatedCostForTwo >= 600 && p.estimatedCostForTwo <= 900) {
    score += 4;
  }

  // ⭐ Name quality (real places > random)
  if (p.tags.name && p.tags.name.length > 3) score += 2;

  // 🔥 Penalize far cheap junk
  if (p.distance > 3 && p.estimatedCostForTwo < 400) {
    score -= 3;
  }

  return score;
}
function priceColor(cost: number) {
  if (cost < 700) return "text-emerald-400";
  if (cost <= 900) return "text-amber-400";
  return "text-rose-400";
}

function priceLabel(cost: number) {
  if (cost < 700) return "₹";
  if (cost <= 900) return "₹₹";
  return "₹₹₹";
}


const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [userLocation, setUserLocation]   = useState<LatLon | null>(null);
  const [searchLocation, setSearchLocation] = useState<LatLon | null>(null);

  const [locationQuery, setLocationQuery] = useState("");
  const [suggestions, setSuggestions]     = useState<MapboxFeature[]>([]);
  const [activeIndex, setActiveIndex]     = useState(-1);
  const [searching, setSearching]         = useState(false);
  const suggestionsRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLInputElement>(null);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localCache = useRef<Map<string, EnrichedPlace[]>>(new Map());

  const [radius, setRadius]   = useState(2000);
  const [sortBy, setSortBy]   = useState<"score" | "distance" | "price">("score");

  const [places, setPlaces]       = useState<EnrichedPlace[]>([]);
  const [loading, setLoading]     = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedPlace, setSelectedPlace] = useState<EnrichedPlace | null>(null);
  const [shortlist, setShortlist]         = useState<EnrichedPlace[]>([]);
  const [activeTab, setActiveTab]         = useState<"all" | "shortlist">("all");

  // ── OSM via server-side proxy (no CORS, no 504 leaking to browser) ──────────

  const fetchOsmPlaces = useCallback(async (lat: number, lon: number): Promise<RawPlace[]> => {
  const query = `
[out:json][timeout:15];
  (
    node["amenity"="cafe"](around:${radius},${lat},${lon});
    node["amenity"="restaurant"](around:${radius},${lat},${lon});
    node["amenity"="fast_food"](around:${radius},${lat},${lon});

    way["amenity"="cafe"](around:${radius},${lat},${lon});
    way["amenity"="restaurant"](around:${radius},${lat},${lon});
    way["amenity"="fast_food"](around:${radius},${lat},${lon});
  );
out center 80;
`;

  try {
    const res = await fetch("/api/osm", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
    });

    if (!res.ok) {
      console.warn("[OSM] proxy returned", res.status);
      return [];
    }

    const data = await res.json();

    // ✅ Normalize nodes + ways into same format
    return (data.elements ?? [])
      .map((p: any) => ({
        lat: p.lat ?? p.center?.lat,
        lon: p.lon ?? p.center?.lon,
        tags: p.tags,
      }))
      .filter((p: RawPlace) => p.lat && p.lon && p.tags);

  } catch (err) {
    console.warn("[OSM] proxy fetch failed:", err);
    return [];
  }
}, [radius]);

  // ── Mapbox places (optional enrichment) ─────────────────────────────────────

  const fetchMapboxPlaces = useCallback(async (lat: number, lon: number): Promise<RawPlace[]> => {
    if (!MAPBOX_TOKEN) return [];
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/restaurant.json` +
        `?proximity=${lon},${lat}` +
        `&types=poi` +
        `&limit=25` +
        `&access_token=${MAPBOX_TOKEN}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.features ?? []).map((f: MapboxFeature) => ({
        lat: f.center[1],
        lon: f.center[0],
        tags: { name: f.text, amenity: "restaurant" },
      }));
    } catch {
      return [];
    }
  }, []);

  // ── Merge, dedupe, enrich, sort ──────────────────────────────────────────────
  

const loadPlaces = useCallback(async (lat: number, lon: number) => {

  const cacheKey = `${lat}-${lon}-${radius}-${sortBy}`;

  // ⚡ CACHE HIT
  if (localCache.current.has(cacheKey)) {
    setPlaces(localCache.current.get(cacheKey)!);
    setLoading(false);
    return;
  }

  setLoading(true);
  setFetchError(null);

  try {
    const [osm, mapbox] = await Promise.all([
      fetchOsmPlaces(lat, lon),
      fetchMapboxPlaces(lat, lon),
    ]);

    // ⚠️ Better error logic
    if (osm.length === 0 && mapbox.length === 0) {
      setFetchError("⚠️ No places found. Try increasing radius.");
    } else {
      setFetchError(null);
    }

    const raw = [...osm, ...mapbox].filter((p) => p.tags?.amenity);

    // 🧹 Dedup
    const seen = new Map<string, RawPlace>();
    for (const p of raw) {
      const key = `${p.tags.name ?? "?"}-${p.lat.toFixed(4)}-${p.lon.toFixed(4)}`;
      if (!seen.has(key)) seen.set(key, p);
    }

    let enriched: EnrichedPlace[] = Array.from(seen.values()).map((p) => {
      const distance = haversineKm(lat, lon, p.lat, p.lon);
      const estimatedCostForTwo = estimateCost(p);

      const base = {
        ...p,
        distance,
        estimatedCostForTwo,
        score: 0,
        tags: {
          ...p.tags,
          name: p.tags?.name || "Unnamed Place",
        },
      };

      return {
        ...base,
        score: computeScore(base),
      };
    });

    // 🧠 Sorting
    if (sortBy === "distance") {
      enriched.sort((a, b) => a.distance - b.distance);
    } else if (sortBy === "price") {
      enriched.sort((a, b) => a.estimatedCostForTwo - b.estimatedCostForTwo);
    } else {
      enriched.sort((a, b) => b.score - a.score);
    }

    // 🌍 Spread fix (radius feels real)
    const spread = enriched
      .sort((a, b) => a.distance - b.distance)
      .filter((_, i) => i % 2 === 0);

    const finalResults = spread.slice(0, 50);

    // ⚡ Cache store
    localCache.current.set(cacheKey, finalResults);

    setPlaces(finalResults);

  } catch (err) {
    console.error(err);
    setFetchError("Failed to load places. Please try again.");
  } finally {
    setLoading(false);
  }

}, [fetchOsmPlaces, fetchMapboxPlaces, sortBy, radius]);

  // ── Load on location / filter change ─────────────────────────────────────────

  useEffect(() => {
    if (searchLocation) {
      loadPlaces(searchLocation.latitude, searchLocation.longitude);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserLocation(loc);
        setSearchLocation(loc);
      },
      () => setFetchError("Location access denied. Search for a place above.")
    );
  }, [searchLocation, loadPlaces]);

  // ── Close suggestions on outside click ───────────────────────────────────────

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) { setSuggestions([]); setActiveIndex(-1); }
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  // ── Location search helpers ───────────────────────────────────────────────────

  function fetchSuggestions(q: string) {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestDebounce.current = setTimeout(async () => {
      try {
        const res  = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5`);
        const data = await res.json();
        setSuggestions(data.features ?? []);
        setActiveIndex(-1);
      } catch { setSuggestions([]); }
    }, 300);
  }

  function selectSuggestion(s: MapboxFeature) {
    const [lon, lat] = s.center;
    const loc = { latitude: lat, longitude: lon };
    setUserLocation(loc);
    setSearchLocation(loc);
    setLocationQuery(s.place_name);
    setSuggestions([]);
    setActiveIndex(-1);
  }

  async function handleSearch() {
    const q = locationQuery.trim();
    if (!q) return;
    setSearching(true);
    setSuggestions([]);

    if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q)) {
      const [lat, lon] = q.split(",").map(Number);
      setUserLocation({ latitude: lat, longitude: lon });
      setSearchLocation({ latitude: lat, longitude: lon });
      setSearching(false);
      return;
    }

    if (activeIndex >= 0 && suggestions[activeIndex]) {
      selectSuggestion(suggestions[activeIndex]);
      setSearching(false);
      return;
    }

    try {
      const res  = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
      const data = await res.json();
      if (data.features?.length > 0) selectSuggestion(data.features[0]);
      else setFetchError("Location not found. Try a different search.");
    } catch {
      setFetchError("Geocoding failed. Check your connection.");
    }
    setSearching(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) { if (e.key === "Enter") handleSearch(); return; }
    if (e.key === "ArrowDown")  { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter")     { e.preventDefault(); if (activeIndex >= 0) selectSuggestion(suggestions[activeIndex]); else handleSearch(); }
    else if (e.key === "Escape")    { setSuggestions([]); setActiveIndex(-1); }
  }

  function useCurrentLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserLocation(loc);
        setSearchLocation(loc);
        setLocationQuery(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
      },
      () => setFetchError("Could not access your location.")
    );
  }

  // ── Shortlist helpers ─────────────────────────────────────────────────────────

  function placeKey(p: EnrichedPlace) { return `${p.lat.toFixed(6)}-${p.lon.toFixed(6)}`; }

  function toggleShortlist(place: EnrichedPlace) {
    const key = placeKey(place);
    setShortlist(prev => prev.some(p => placeKey(p) === key) ? prev.filter(p => placeKey(p) !== key) : [...prev, place]);
  }

  function isShortlisted(place: EnrichedPlace) { return shortlist.some(p => placeKey(p) === placeKey(place)); }

  // ── Render ────────────────────────────────────────────────────────────────────

  const displayedPlaces = activeTab === "shortlist" ? shortlist : places;

  return (
    <main className="h-screen bg-[#0a0a0f] text-white font-sans flex flex-col overflow-hidden">

      {/* ── Compact header ── */}
      <header className="flex-none z-20 bg-[#0a0a0f]/95 backdrop-blur border-b border-white/5 px-4 py-2">
        <div className="max-w-screen-xl mx-auto flex flex-col gap-2">

          {/* Row 1: title + search + filters */}
          <div className="flex items-center gap-3">
            <span className="text-lg select-none">🍽️</span>
            <h1 className="text-sm font-bold tracking-tight whitespace-nowrap">Cafe Finder</h1>

            {/* Search */}
            <div className="relative flex-1 flex gap-1.5">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search place or lat,lng…"
                  value={locationQuery}
                  onChange={e => { setLocationQuery(e.target.value); fetchSuggestions(e.target.value); }}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
                />
                {suggestions.length > 0 && (
                  <div ref={suggestionsRef} className="absolute top-full mt-1 left-0 right-0 z-30 bg-[#141420] border border-white/10 rounded-lg overflow-hidden shadow-xl">
                    {suggestions.map((s, i) => (
                      <button
                        key={s.place_name}
                        onMouseDown={e => { e.preventDefault(); selectSuggestion(s); }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${i === activeIndex ? "bg-indigo-600/50 text-white" : "hover:bg-white/5 text-white/70"}`}
                      >{s.place_name}</button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={handleSearch} disabled={searching} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 rounded-lg text-xs font-medium transition-colors">
                {searching ? "…" : "Search"}
              </button>
              <button onClick={useCurrentLocation} title="Use my location" className="bg-white/10 hover:bg-white/15 px-2 rounded-lg text-sm transition-colors">🧭</button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-none">
              <label className="text-xs text-white/40">Sort</label>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25">
                <option value="score">Best Match</option>
                <option value="distance">Nearest</option>
                <option value="price">Cheapest</option>
              </select>
              <label className="text-xs text-white/40">Radius</label>
              <select value={radius} onChange={e => setRadius(Number(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25">
                <option value={1000}>1 km</option>
                <option value={2000}>2 km</option>
                <option value={4000}>4 km</option>
              </select>
            </div>
          </div>

          {/* Error banner */}
          {fetchError && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-lg px-3 py-1.5 flex items-center justify-between">
              <span>{fetchError}</span>
              <button onClick={() => setFetchError(null)} className="ml-3 text-rose-400/60 hover:text-rose-400">✕</button>
            </div>
          )}
        </div>
      </header>

      {/* ── Body: map left | list right ── */}
      <div className="flex-1 flex overflow-hidden px-3 py-3 gap-3 max-w-screen-xl mx-auto w-full">

        {/* Map */}
        <div className="flex-1 rounded-xl overflow-hidden border border-white/10 min-w-0">
          {userLocation ? (
            <MapView places={places} userLocation={userLocation} selectedPlace={selectedPlace} onSelectPlace={setSelectedPlace} />
          ) : (
            <div className="h-full flex items-center justify-center text-white/20 text-sm">Waiting for location…</div>
          )}
        </div>

        {/* List panel */}
        <div className="w-72 flex flex-col gap-2 min-w-0">

          {/* Tabs */}
          <div className="flex gap-1 bg-white/5 rounded-lg p-1 flex-none">
            {(["all", "shortlist"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1 text-xs rounded-md font-medium transition-colors ${activeTab === tab ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}
              >
                {tab === "all"
                  ? <>All {!loading && <span className="text-white/30">({places.length})</span>}</>
                  : <>⭐ Shortlist {shortlist.length > 0 && <span className="text-indigo-400">({shortlist.length})</span>}</>}
              </button>
            ))}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {loading ? (
              [...Array(8)].map((_, i) => (
                <div key={i} className="bg-white/5 rounded-xl h-14 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              ))
            ) : displayedPlaces.length === 0 ? (
              <div className="text-center py-12 text-white/30 text-xs">
                {activeTab === "shortlist" ? "No places shortlisted yet — tap ☆ on any result." : "No places found. Try increasing the radius."}
              </div>
            ) : (
              displayedPlaces.map(place => {
                const added      = isShortlisted(place);
                const isSelected = selectedPlace && placeKey(selectedPlace) === placeKey(place);
                return (
                  <div
                    key={placeKey(place)}
                    onClick={() => setSelectedPlace(place)}
                    className={`group relative bg-white/[0.03] hover:bg-white/[0.06] border rounded-xl p-3 cursor-pointer transition-all ${isSelected ? "border-indigo-500/60 bg-indigo-500/5" : "border-white/[0.06]"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-xs font-semibold truncate">{place.tags.name}</h2>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-white/40 flex-wrap">
                          <span>📏 {place.distance.toFixed(2)} km</span>
                          <span className={priceColor(place.estimatedCostForTwo)}>
                            {priceLabel(place.estimatedCostForTwo)} ₹{place.estimatedCostForTwo}
                          </span>
                          <span className="capitalize text-white/25">{place.tags.amenity}</span>
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); toggleShortlist(place); }}
                        className={`flex-shrink-0 text-base leading-none transition-transform active:scale-90 ${added ? "text-amber-400" : "text-white/20 hover:text-white/50"}`}
                      >{added ? "⭐" : "☆"}</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "@/components/MapView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLon { latitude: number; longitude: number; }
interface PlaceTag {
  name: string; amenity: string; cuisine?: string;
  opening_hours?: string; phone?: string; brand?: string;
  address?: string; mapbox_cats?: string;
  [key: string]: string | undefined;
}
interface RawPlace { lat: number; lon: number; tags: PlaceTag; }
interface EnrichedPlace extends RawPlace {
  distance: number;
  estimatedCostForTwo: number;
  priceSource: "known-chain" | "cuisine" | "name-hint" | "amenity-type" | "default";
  score: number;
}
interface MapboxFeature { center: [number, number]; place_name: string; text: string; }

// ─── Price database ───────────────────────────────────────────────────────────

const KNOWN_CHAINS: Record<string, number> = {
  "mcdonald": 400, "mcdonalds": 400, "kfc": 450, "burger king": 500,
  "subway": 450, "domino": 500, "dominos": 500, "pizza hut": 600,
  "wow momo": 350, "faasos": 350, "behrouz": 700, "biryani by kilo": 600,
  "starbucks": 900, "cafe coffee day": 500, "ccd": 500, "barista": 500,
  "tim horton": 600, "costa coffee": 700, "blue tokai": 600,
  "haldiram": 300, "bikanervala": 350, "sagar ratna": 400, "saravana bhavan": 450,
  "barbeque nation": 1800, "punjab grill": 1400, "mainland china": 1400,
  "paradise biryani": 500, "arsalan": 600, "peter cat": 1200,
  "mocambo": 1200, "flurys": 700, "kookie jar": 500,
  "monginis": 200, "theobroma": 600, "cookie man": 400,
  "chili": 1200, "chilis": 1200, "tgif": 1400, "hard rock": 1600,
  "wendy": 500, "wendys": 500, "popeyes": 500, "nando": 800,
  "social": 1200, "brewhouse": 1400, "hoppipola": 1000,
  "naturals": 300, "baskin": 400, "amul": 200,
  "zomato kitchen": 400, "rebel foods": 500,
};

const CUISINE_PRICES: Record<string, number> = {
  "fine_dining": 2000, "french": 1800, "italian": 1400, "continental": 1200,
  "chinese": 800, "thai": 900, "japanese": 1400, "korean": 1000,
  "mughlai": 800, "north_indian": 700, "south_indian": 400, "udupi": 350,
  "kebab": 700, "biryani": 500, "seafood": 1000, "fish": 700,
  "pizza": 600, "burger": 400, "sandwich": 350, "rolls": 250,
  "ice_cream": 200, "dessert": 300, "bakery": 300, "sweets": 200,
  "tea": 150, "coffee": 400, "juice": 200, "mexican": 1000,
  "american": 900, "mediterranean": 1200, "middle_eastern": 800,
  "bengali": 500, "gujarati": 400, "punjabi": 700, "rajasthani": 600,
};

// Mapbox returns category strings like "Food and Drink", "Mexican Restaurant" etc.
// Map these to price estimates
const MAPBOX_CAT_PRICES: Record<string, number> = {
  "mexican restaurant": 1000,
  "italian restaurant": 1400,
  "chinese restaurant": 800,
  "japanese restaurant": 1400,
  "thai restaurant": 900,
  "indian restaurant": 700,
  "fast food restaurant": 350,
  "coffee shop": 500,
  "cafe": 500,
  "bakery": 300,
  "bar": 1000,
  "lounge": 1500,
  "fine dining": 2000,
  "seafood restaurant": 1000,
  "pizza": 600,
  "burger": 400,
  "sandwich": 350,
};

function estimateCost(place: RawPlace): { cost: number; source: EnrichedPlace["priceSource"] } {
  const name     = (place.tags?.name        ?? "").toLowerCase();
  const brand    = (place.tags?.brand       ?? "").toLowerCase();
  const cuisine  = (place.tags?.cuisine     ?? "").toLowerCase();
  const mbCats   = (place.tags?.mapbox_cats ?? "").toLowerCase();
  const amenity  = place.tags?.amenity ?? "";

  // 1. Known chain
  for (const [chain, price] of Object.entries(KNOWN_CHAINS)) {
    if (name.includes(chain) || brand.includes(chain)) return { cost: price, source: "known-chain" };
  }

  // 2. Mapbox category strings (e.g. "Mexican Restaurant")
  for (const [cat, price] of Object.entries(MAPBOX_CAT_PRICES)) {
    if (mbCats.includes(cat)) return { cost: price, source: "cuisine" };
  }

  // 3. OSM cuisine tag
  if (cuisine) {
    for (const [cuis, price] of Object.entries(CUISINE_PRICES)) {
      if (cuisine.includes(cuis)) return { cost: price, source: "cuisine" };
    }
  }

  // 4. Name-based hints
  if (/dhaba|highway|roadside|thela|stall/.test(name))      return { cost: 200,  source: "name-hint" };
  if (/rooftop|lounge|sky|terrace|fine|manor|palace/.test(name)) return { cost: 1800, source: "name-hint" };
  if (/bar|pub|brewery|taproom|liquor/.test(name))          return { cost: 1200, source: "name-hint" };
  if (/\btea\b|chai|chaa|lassi|\bjuice\b/.test(name))       return { cost: 150,  source: "name-hint" };
  if (/sweet|mithai|mishti|confection|halwa/.test(name))    return { cost: 250,  source: "name-hint" };
  if (/bakery|cake|pastry|\bbread\b|patisserie/.test(name)) return { cost: 350,  source: "name-hint" };
  if (/biryani|\bdum\b/.test(name))                         return { cost: 500,  source: "name-hint" };
  if (/south indian|udupi|idli|dosa|tiffin/.test(name))     return { cost: 400,  source: "name-hint" };
  if (/roll|wrap|kathi|frankie/.test(name))                 return { cost: 250,  source: "name-hint" };
  if (/pizza/.test(name))                                   return { cost: 600,  source: "name-hint" };
  if (/burger/.test(name))                                  return { cost: 400,  source: "name-hint" };
  if (/\bmomo\b/.test(name))                                return { cost: 250,  source: "name-hint" };
  if (/chinese|chowmein|noodle|wonton/.test(name))          return { cost: 600,  source: "name-hint" };
  if (/mughlai|awadhi|kebab|tandoor/.test(name))            return { cost: 800,  source: "name-hint" };
  if (/seafood|fish|prawn|crab|lobster/.test(name))         return { cost: 900,  source: "name-hint" };
  if (/\bcafe\b|coffee|espresso/.test(name))                return { cost: 500,  source: "name-hint" };
  if (/ice.?cream|gelato|frozen/.test(name))                return { cost: 300,  source: "name-hint" };

  // 5. Amenity fallback
  if (amenity === "fast_food")  return { cost: 350,  source: "amenity-type" };
  if (amenity === "cafe")       return { cost: 500,  source: "amenity-type" };
  if (amenity === "restaurant") return { cost: 700,  source: "amenity-type" };
  if (amenity === "bar")        return { cost: 1000, source: "amenity-type" };

  return { cost: 600, source: "default" };
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Compute a bbox string for Mapbox from lat/lon + radius in metres
function radiusToBbox(lat: number, lon: number, radiusM: number): string {
  const deg = radiusM / 111_000;
  return [lon - deg, lat - deg, lon + deg, lat + deg].join(",");
}

function computeScore(p: EnrichedPlace): number {
  let s = 0;
  s += Math.max(0, 20 - p.distance * 5);
  if (p.tags.amenity === "restaurant") s += 4;
  if (p.tags.amenity === "cafe")       s += 3;
  if (p.estimatedCostForTwo >= 250 && p.estimatedCostForTwo <= 900) s += 4;
  if (p.tags.name && p.tags.name.length > 3) s += 2;
  if (p.tags.cuisine)  s += 2;
  if (p.priceSource === "known-chain") s += 2;
  if (p.priceSource === "cuisine")     s += 1;
  if (p.distance > 3 && p.estimatedCostForTwo < 250) s -= 3;
  return s;
}

function priceColor(cost: number) {
  if (cost <= 400)  return "text-emerald-400";
  if (cost <= 900)  return "text-amber-400";
  return "text-rose-400";
}
function priceLabel(cost: number) {
  if (cost <= 300)  return "₹";
  if (cost <= 700)  return "₹₹";
  if (cost <= 1200) return "₹₹₹";
  return "₹₹₹₹";
}
function categoryEmoji(amenity: string) {
  if (amenity === "cafe")      return "☕";
  if (amenity === "fast_food") return "🍔";
  if (amenity === "bar")       return "🍺";
  return "🍽️";
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Mapbox Search Box categories — covers the full food landscape
const MAPBOX_CATEGORIES = [
  "restaurant", "cafe", "fast_food", "food",
  "coffee_shop", "bar", "bakery", "dessert",
  "ice_cream", "tea_house",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [userLocation,   setUserLocation]   = useState<LatLon | null>(null);
  const [searchLocation, setSearchLocation] = useState<LatLon | null>(null);

  const [locationQuery, setLocationQuery] = useState("");
  const [suggestions,   setSuggestions]   = useState<MapboxFeature[]>([]);
  const [activeIndex,   setActiveIndex]   = useState(-1);
  const [searching,     setSearching]     = useState(false);

  const suggestionsRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLInputElement>(null);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [radius, setRadius] = useState(2000);
  const [sortBy, setSortBy] = useState<"score" | "distance" | "price">("score");

  // Results search query (filters the panel only, no re-fetch)
  const [resultsQuery, setResultsQuery] = useState("");

  const [allPlaces,   setAllPlaces]   = useState<EnrichedPlace[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [fetchError,  setFetchError]  = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string>("");

  const [selectedPlace, setSelectedPlace] = useState<EnrichedPlace | null>(null);
  const [shortlist,     setShortlist]     = useState<EnrichedPlace[]>([]);
  const [activeTab,     setActiveTab]     = useState<"all" | "shortlist">("all");

  const localCache = useRef<Map<string, EnrichedPlace[]>>(new Map());

  // ── Sort + filter — zero latency, client-side only ────────────────────────

  const places = useMemo(() => {
    let list = [...allPlaces];
    if (sortBy === "distance") list.sort((a, b) => a.distance - b.distance);
    else if (sortBy === "price") list.sort((a, b) => a.estimatedCostForTwo - b.estimatedCostForTwo);
    else list.sort((a, b) => b.score - a.score);
    return list;
  }, [allPlaces, sortBy]);

  const filteredPlaces = useMemo(() => {
    if (!resultsQuery.trim()) return places;
    const q = resultsQuery.toLowerCase();
    return places.filter(p =>
      p.tags.name.toLowerCase().includes(q) ||
      (p.tags.cuisine ?? "").toLowerCase().includes(q) ||
      p.tags.amenity.toLowerCase().includes(q) ||
      (p.tags.mapbox_cats ?? "").toLowerCase().includes(q)
    );
  }, [places, resultsQuery]);

  // ── Fetch OSM ─────────────────────────────────────────────────────────────

  const fetchOsmPlaces = useCallback(async (lat: number, lon: number): Promise<RawPlace[]> => {
    const query = `
[out:json][timeout:15];
(
  node["amenity"="cafe"](around:${radius},${lat},${lon});
  node["amenity"="restaurant"](around:${radius},${lat},${lon});
  node["amenity"="fast_food"](around:${radius},${lat},${lon});
  node["amenity"="bar"](around:${radius},${lat},${lon});
  way["amenity"="cafe"](around:${radius},${lat},${lon});
  way["amenity"="restaurant"](around:${radius},${lat},${lon});
  way["amenity"="fast_food"](around:${radius},${lat},${lon});
);
out center 150;
`;
    try {
      const res = await fetch("/api/osm", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
      });
      const xCache = res.headers.get("X-Cache") ?? "";
      setCacheStatus(xCache);
      if (!res.ok) return [];
      const data = await res.json();
      if (data.error) return [];
      return (data.elements ?? [])
        .map((p: any) => ({
          lat:  p.lat  ?? p.center?.lat,
          lon:  p.lon  ?? p.center?.lon,
          tags: p.tags ?? {},
        }))
        .filter((p: RawPlace) => p.lat && p.lon && p.tags?.amenity);
    } catch { return []; }
  }, [radius]);

  // ── Fetch Mapbox Search Box /category — respects radius via bbox ──────────

  const fetchMapboxPlaces = useCallback(async (lat: number, lon: number): Promise<RawPlace[]> => {
    if (!MAPBOX_TOKEN) return [];
    const bbox = radiusToBbox(lat, lon, radius);

    try {
      const results = await Promise.allSettled(
        MAPBOX_CATEGORIES.map(cat =>
          fetch(
            `https://api.mapbox.com/search/searchbox/v1/category/${cat}` +
            `?proximity=${lon},${lat}` +
            `&bbox=${bbox}` +
            `&limit=25` +
            `&language=en` +
            `&access_token=${MAPBOX_TOKEN}`
          ).then(r => r.ok ? r.json() : Promise.reject(r.status))
        )
      );

      const places: RawPlace[] = [];
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const f of result.value.features ?? []) {
          const [fLon, fLat] = f.geometry?.coordinates ?? [];
          if (!fLon || !fLat) continue;

          // Mapbox gives us a rich categories array — use it for price lookup
          const poiCats: string[] = f.properties?.poi_category ?? [];
          const catString = poiCats.join(", ").toLowerCase();

          // Map Mapbox category to our amenity type
          let amenity = "restaurant";
          if (catString.includes("cafe") || catString.includes("coffee")) amenity = "cafe";
          else if (catString.includes("fast food") || catString.includes("fast_food")) amenity = "fast_food";
          else if (catString.includes("bar") || catString.includes("pub")) amenity = "bar";

          places.push({
            lat: fLat,
            lon: fLon,
            tags: {
              name:        f.properties?.name ?? "Unnamed",
              amenity,
              mapbox_cats: catString,  // preserve raw for price lookup
              cuisine:     poiCats.filter(c => !["food", "food and drink", "restaurant", "cafe"].includes(c.toLowerCase())).join(", "),
              phone:       f.properties?.phone ?? "",
              address:     f.properties?.full_address ?? f.properties?.address ?? "",
            },
          });
        }
      }
      return places;
    } catch { return []; }
  }, [radius, MAPBOX_TOKEN]);

  // ── Load places ───────────────────────────────────────────────────────────

  const loadPlaces = useCallback(async (lat: number, lon: number) => {
    const cacheKey = `${lat.toFixed(4)}-${lon.toFixed(4)}-${radius}`;

    if (localCache.current.has(cacheKey)) {
      setAllPlaces(localCache.current.get(cacheKey)!);
      setLoading(false);
      setCacheStatus("LOCAL");
      return;
    }

    setLoading(true);
    setFetchError(null);

    try {
      const [osm, mapbox] = await Promise.all([
        fetchOsmPlaces(lat, lon),
        fetchMapboxPlaces(lat, lon),
      ]);

      if (osm.length === 0 && mapbox.length === 0) {
        setFetchError("⚠️ No places found. Try increasing the radius.");
        setAllPlaces([]);
        setLoading(false);
        return;
      }

      // Merge — OSM wins on duplicates (better data quality)
      const seen = new Map<string, RawPlace>();
      // Add Mapbox first, then OSM overwrites on collision
      for (const p of [...mapbox, ...osm]) {
        if (!p.tags?.amenity) continue;
        const key = `${(p.tags.name ?? "?").toLowerCase().trim()}-${p.lat.toFixed(3)}-${p.lon.toFixed(3)}`;
        seen.set(key, p);
      }

      const enriched: EnrichedPlace[] = Array.from(seen.values()).map(p => {
        const distance = haversineKm(lat, lon, p.lat, p.lon);
        const { cost, source } = estimateCost(p);
        const base: EnrichedPlace = {
          ...p,
          distance,
          estimatedCostForTwo: cost,
          priceSource: source,
          score: 0,
          tags: { ...p.tags, name: p.tags?.name || "Unnamed Place" },
        };
        return { ...base, score: computeScore(base) };
      });

      // Strict radius filter
      const inRadius = enriched.filter(p => p.distance <= radius / 1000);

      // No hard cap — show everything in radius, up to 150
      const finalResults = inRadius.slice(0, 150);

      localCache.current.set(cacheKey, finalResults);
      setAllPlaces(finalResults);
      setFetchError(null);

    } catch (err) {
      console.error(err);
      setFetchError("Failed to load places. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [fetchOsmPlaces, fetchMapboxPlaces, radius]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchLocation) {
      loadPlaces(searchLocation.latitude, searchLocation.longitude);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserLocation(loc);
        setSearchLocation(loc);
      },
      () => setFetchError("Location access denied. Search for a place above.")
    );
  }, [searchLocation, loadPlaces]);

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

  // ── Geocoding helpers ─────────────────────────────────────────────────────

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
    setUserLocation({ latitude: lat, longitude: lon });
    setSearchLocation({ latitude: lat, longitude: lon });
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
    if (activeIndex >= 0 && suggestions[activeIndex]) { selectSuggestion(suggestions[activeIndex]); setSearching(false); return; }
    try {
      const res  = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
      const data = await res.json();
      if (data.features?.length > 0) selectSuggestion(data.features[0]);
      else setFetchError("Location not found.");
    } catch { setFetchError("Geocoding failed."); }
    setSearching(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) { if (e.key === "Enter") handleSearch(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp")  { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter")    { e.preventDefault(); if (activeIndex >= 0) selectSuggestion(suggestions[activeIndex]); else handleSearch(); }
    else if (e.key === "Escape")   { setSuggestions([]); setActiveIndex(-1); }
  }

  function useCurrentLocation() {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserLocation(loc);
        setSearchLocation(loc);
        setLocationQuery(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
      },
      () => setFetchError("Could not access your location.")
    );
  }

  // ── Shortlist ─────────────────────────────────────────────────────────────

  function placeKey(p: EnrichedPlace) { return `${p.lat.toFixed(6)}-${p.lon.toFixed(6)}`; }
  function toggleShortlist(place: EnrichedPlace) {
    const key = placeKey(place);
    setShortlist(prev => prev.some(p => placeKey(p) === key) ? prev.filter(p => placeKey(p) !== key) : [...prev, place]);
  }
  function isShortlisted(place: EnrichedPlace) { return shortlist.some(p => placeKey(p) === placeKey(place)); }

  // ── Render ────────────────────────────────────────────────────────────────

  const displayedPlaces = activeTab === "shortlist" ? shortlist : filteredPlaces;

  return (
    <main className="h-screen bg-[#0a0a0f] text-white font-sans flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="flex-none z-20 bg-[#0a0a0f]/95 backdrop-blur border-b border-white/5 px-4 py-2">
        <div className="max-w-screen-xl mx-auto flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="text-lg select-none">🍽️</span>
            <h1 className="text-sm font-bold tracking-tight whitespace-nowrap">Cafe Finder</h1>

            <div className="relative flex-1 flex gap-1.5">
              <div className="relative flex-1">
                <input ref={inputRef} type="text" placeholder="Search place or lat,lng…"
                  value={locationQuery}
                  onChange={e => { setLocationQuery(e.target.value); fetchSuggestions(e.target.value); }}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors" />
                {suggestions.length > 0 && (
                  <div ref={suggestionsRef} className="absolute top-full mt-1 left-0 right-0 z-30 bg-[#141420] border border-white/10 rounded-lg overflow-hidden shadow-xl">
                    {suggestions.map((s, i) => (
                      <button key={s.place_name} onMouseDown={e => { e.preventDefault(); selectSuggestion(s); }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${i === activeIndex ? "bg-indigo-600/50 text-white" : "hover:bg-white/5 text-white/70"}`}>
                        {s.place_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={handleSearch} disabled={searching}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 rounded-lg text-xs font-medium transition-colors">
                {searching ? "…" : "Search"}
              </button>
              <button onClick={useCurrentLocation} title="Use my location"
                className="bg-white/10 hover:bg-white/15 px-2 rounded-lg text-sm transition-colors">🧭</button>
            </div>

            <div className="flex items-center gap-2 flex-none">
              <label className="text-xs text-white/40">Sort</label>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25">
                <option value="score">Best Match</option>
                <option value="distance">Nearest</option>
                <option value="price">Cheapest</option>
              </select>
              <label className="text-xs text-white/40">Radius</label>
              <select value={radius} onChange={e => setRadius(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25">
                <option value={1000}>1 km</option>
                <option value={2000}>2 km</option>
                <option value={4000}>4 km</option>
                <option value={6000}>6 km</option>
                <option value={10000}>10 km</option>
              </select>
            </div>
          </div>

          {fetchError && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-lg px-3 py-1.5 flex items-center justify-between">
              <span>{fetchError}</span>
              <button onClick={() => setFetchError(null)} className="ml-3 text-rose-400/60 hover:text-rose-400">✕</button>
            </div>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden px-3 py-3 gap-3 max-w-screen-xl mx-auto w-full">

        {/* Map */}
        <div className="flex-1 rounded-xl overflow-hidden border border-white/10 min-w-0">
          {userLocation ? (
            <MapView places={filteredPlaces} userLocation={userLocation} selectedPlace={selectedPlace} onSelectPlace={setSelectedPlace} />
          ) : (
            <div className="h-full flex items-center justify-center text-white/20 text-sm">Waiting for location…</div>
          )}
        </div>

        {/* List panel */}
        <div className="w-72 flex flex-col gap-2 min-w-0">

          {/* Tabs + cache badge */}
          <div className="flex gap-1 bg-white/5 rounded-lg p-1 flex-none items-center">
            {(["all", "shortlist"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1 text-xs rounded-md font-medium transition-colors ${activeTab === tab ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}>
                {tab === "all"
                  ? <>All {!loading && <span className="text-white/30">({filteredPlaces.length}{resultsQuery ? `/${places.length}` : ""})</span>}</>
                  : <>⭐ Shortlist {shortlist.length > 0 && <span className="text-indigo-400">({shortlist.length})</span>}</>}
              </button>
            ))}
            {cacheStatus && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono flex-none ${
                ["FRESH","LOCAL"].includes(cacheStatus) ? "text-emerald-400/60 bg-emerald-400/10" :
                cacheStatus === "WARM" ? "text-amber-400/60 bg-amber-400/10" : "text-white/20 bg-white/5"
              }`}>{cacheStatus}</span>
            )}
          </div>

          {/* Results search box */}
          {activeTab === "all" && (
            <div className="relative flex-none">
              <input
                type="text"
                placeholder="Filter results… (e.g. biryani, cafe)"
                value={resultsQuery}
                onChange={e => setResultsQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-white/20 focus:outline-none focus:border-white/25 transition-colors"
              />
              {resultsQuery && (
                <button onClick={() => setResultsQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 text-xs">✕</button>
              )}
            </div>
          )}

          {/* Results list */}
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {loading ? (
              [...Array(8)].map((_, i) => (
                <div key={i} className="bg-white/5 rounded-xl h-16 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              ))
            ) : displayedPlaces.length === 0 ? (
              <div className="text-center py-12 text-white/30 text-xs">
                {activeTab === "shortlist"
                  ? "No places shortlisted yet — tap ☆ on any result."
                  : resultsQuery
                  ? `No results for "${resultsQuery}"`
                  : "No places found. Try increasing the radius."}
              </div>
            ) : (
              displayedPlaces.map(place => {
                const added      = isShortlisted(place);
                const isSelected = selectedPlace && placeKey(selectedPlace) === placeKey(place);
                // Clean up cuisine display — remove generic mapbox noise
                const cuisineDisplay = (place.tags.cuisine ?? "")
                  .replace(/food and drink,?\s*/gi, "")
                  .replace(/food,?\s*/gi, "")
                  .replace(/^,\s*/, "")
                  .trim();

                return (
                  <div key={placeKey(place)} onClick={() => setSelectedPlace(place)}
                    className={`group relative bg-white/[0.03] hover:bg-white/[0.06] border rounded-xl p-3 cursor-pointer transition-all ${isSelected ? "border-indigo-500/60 bg-indigo-500/5" : "border-white/[0.06]"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-sm leading-none flex-shrink-0">{categoryEmoji(place.tags.amenity)}</span>
                          <h2 className="text-xs font-semibold truncate">{place.tags.name}</h2>
                        </div>
                        {cuisineDisplay && (
                          <p className="text-[10px] text-white/30 mt-0.5 truncate capitalize">{cuisineDisplay}</p>
                        )}
                        {place.tags.address && (
                          <p className="text-[10px] text-white/20 mt-0.5 truncate">{place.tags.address}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-white/40 flex-wrap">
                          <span>📏 {place.distance.toFixed(2)} km</span>
                          <span className={priceColor(place.estimatedCostForTwo)}>
                            {priceLabel(place.estimatedCostForTwo)} ≈ ₹{place.estimatedCostForTwo}
                            {place.priceSource === "default" && <span className="text-white/20 text-[9px] ml-0.5">est</span>}
                          </span>
                          <span className="capitalize text-white/20">{place.tags.amenity.replace(/_/g, " ")}</span>
                        </div>
                        {place.tags.opening_hours && (
                          <p className="text-[10px] text-white/20 mt-0.5 truncate">🕐 {place.tags.opening_hours}</p>
                        )}
                        {place.tags.phone && (
                          <p className="text-[10px] text-white/20 mt-0.5">📞 {place.tags.phone}</p>
                        )}
                      </div>
                      <button onClick={e => { e.stopPropagation(); toggleShortlist(place); }}
                        className={`flex-shrink-0 text-base leading-none transition-transform active:scale-90 ${added ? "text-amber-400" : "text-white/20 hover:text-white/50"}`}>
                        {added ? "⭐" : "☆"}
                      </button>
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
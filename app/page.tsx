"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapView from "@/components/MapView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLon {
  latitude: number;
  longitude: number;
}

interface PlaceTag {
  name: string;
  amenity: string;
  [key: string]: string | undefined;
}

interface RawPlace {
  lat: number;
  lon: number;
  tags: PlaceTag;
}

interface EnrichedPlace extends RawPlace {
  distance: number;
  estimatedCostForTwo: number;
  score: number;
}

interface MapboxFeature {
  center: [number, number];
  place_name: string;
  text: string;
}

// ─── Helpers (defined outside component — stable references) ─────────────────

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function estimateCost(place: RawPlace): number {
  const type = place.tags?.amenity;
  if (type === "fast_food") return 300;
  if (type === "cafe") return 700;
  if (type === "restaurant") return 1000;
  return 800;
}

function computeScore(place: EnrichedPlace): number {
  let score = Math.max(0, 5 - place.distance);
  if (place.tags?.amenity === "cafe") score += 2;
  return score;
}

function getPriceColor(cost: number): string {
  if (cost < 700) return "text-emerald-400";
  if (cost <= 900) return "text-amber-400";
  return "text-rose-400";
}

function getPriceLabel(cost: number): string {
  if (cost < 700) return "₹";
  if (cost <= 900) return "₹₹";
  return "₹₹₹";
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  // location
  const [userLocation, setUserLocation] = useState<LatLon | null>(null);
  const [searchLocation, setSearchLocation] = useState<LatLon | null>(null);

  // search input
  const [locationQuery, setLocationQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MapboxFeature[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // filters
  const [radius, setRadius] = useState(2000);
  const [sortBy, setSortBy] = useState<"score" | "distance" | "price">("score");

  // results
  const [places, setPlaces] = useState<EnrichedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // UI
  const [selectedPlace, setSelectedPlace] = useState<EnrichedPlace | null>(null);
  const [shortlist, setShortlist] = useState<EnrichedPlace[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "shortlist">("all");

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchOsmPlaces = useCallback(
    async (lat: number, lon: number): Promise<RawPlace[]> => {
      const query = `
        [out:json][timeout:25];
        node["amenity"~"cafe|restaurant|fast_food"](around:${radius},${lat},${lon});
        out body;
      `;

      // Try primary mirror, then fallback mirror — never throw, just return []
      const endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
      ];

      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: "POST",
            body: query,
            signal: AbortSignal.timeout(10_000), // 10 s hard timeout
          });
          if (!res.ok) continue; // try next mirror
          const data = await res.json();
          return (data.elements ?? []) as RawPlace[];
        } catch {
          // network error or timeout — try next mirror
        }
      }

      // All mirrors failed — return empty so Mapbox results still show
      console.warn("OSM: all endpoints failed, continuing with Mapbox only");
      return [];
    },
    [radius]
  );

  const fetchMapboxPlaces = useCallback(
    async (lat: number, lon: number): Promise<RawPlace[]> => {
      if (!MAPBOX_TOKEN) return [];
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/cafe,restaurant,food.json` +
          `?proximity=${lon},${lat}` +
          `&access_token=${MAPBOX_TOKEN}` +
          `&limit=25`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.features ?? []).map((f: MapboxFeature) => ({
        lat: f.center[1],
        lon: f.center[0],
        tags: { name: f.text, amenity: "restaurant" },
      }));
    },
    []
  );

  const loadPlaces = useCallback(
    async (lat: number, lon: number) => {
      setLoading(true);
      setFetchError(null);
      try {
        const [osm, mapbox] = await Promise.all([
          fetchOsmPlaces(lat, lon),
          fetchMapboxPlaces(lat, lon),
        ]);

        if (osm.length === 0 && mapbox.length > 0) {
          setFetchError("⚠️ OpenStreetMap unavailable — showing Mapbox results only.");
        }

        const raw = [...osm, ...mapbox].filter((p) => p.tags?.amenity);

        // deduplicate by name+coords
        const seen = new Map<string, RawPlace>();
        for (const p of raw) {
          const key = `${p.tags.name ?? "?"}-${p.lat.toFixed(5)}-${p.lon.toFixed(5)}`;
          if (!seen.has(key)) seen.set(key, p);
        }

        let enriched: EnrichedPlace[] = Array.from(seen.values()).map((p) => {
          const distance = haversineKm(lat, lon, p.lat, p.lon);
          const estimatedCostForTwo = estimateCost(p);
          const partial = {
            ...p,
            distance,
            estimatedCostForTwo,
            score: 0,
            tags: { ...p.tags, name: p.tags?.name || "Unnamed Place" },
          };
          return { ...partial, score: computeScore(partial) };
        });

        // sort
        if (sortBy === "distance") {
          enriched.sort((a, b) => a.distance - b.distance);
        } else if (sortBy === "price") {
          enriched.sort((a, b) => a.estimatedCostForTwo - b.estimatedCostForTwo);
        } else {
          enriched.sort((a, b) => b.score - a.score);
        }

        setPlaces(enriched.slice(0, 50));
      } catch (err) {
        console.error(err);
        setFetchError("Failed to load places. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [fetchOsmPlaces, fetchMapboxPlaces, sortBy]
  );

  // ── Effect: load on location / filter change ─────────────────────────────────

  useEffect(() => {
    if (searchLocation) {
      loadPlaces(searchLocation.latitude, searchLocation.longitude);
      return;
    }
    // auto-detect on first mount
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
    function handleClickOutside(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setSuggestions([]);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Suggestions ───────────────────────────────────────────────────────────────

  function fetchSuggestions(query: string) {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    suggestDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
            `?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5`
        );
        const data = await res.json();
        setSuggestions(data.features ?? []);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
      }
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

  // ── Search ────────────────────────────────────────────────────────────────────

  async function handleSearch() {
    const trimmed = locationQuery.trim();
    if (!trimmed) return;
    setSearching(true);
    setSuggestions([]);

    // lat,lon shortcut
    if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(trimmed)) {
      const [lat, lon] = trimmed.split(",").map(Number);
      const loc = { latitude: lat, longitude: lon };
      setUserLocation(loc);
      setSearchLocation(loc);
      setSearching(false);
      return;
    }

    // use active suggestion if selected
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      selectSuggestion(suggestions[activeIndex]);
      setSearching(false);
      return;
    }

    // geocode the query
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json` +
          `?access_token=${MAPBOX_TOKEN}&limit=1`
      );
      const data = await res.json();
      if (data.features?.length > 0) {
        selectSuggestion(data.features[0]);
      } else {
        setFetchError("Location not found. Try a different search.");
      }
    } catch {
      setFetchError("Geocoding failed. Check your connection.");
    }
    setSearching(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) {
      if (e.key === "Enter") handleSearch();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) selectSuggestion(suggestions[activeIndex]);
      else handleSearch();
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setActiveIndex(-1);
    }
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

  // ── Shortlist ─────────────────────────────────────────────────────────────────

  function placeKey(p: EnrichedPlace) {
    return `${p.lat.toFixed(6)}-${p.lon.toFixed(6)}`;
  }

  function toggleShortlist(place: EnrichedPlace) {
    const key = placeKey(place);
    setShortlist((prev) =>
      prev.some((p) => placeKey(p) === key)
        ? prev.filter((p) => placeKey(p) !== key)
        : [...prev, place]
    );
  }

  function isShortlisted(place: EnrichedPlace) {
    return shortlist.some((p) => placeKey(p) === placeKey(place));
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const displayedPlaces = activeTab === "shortlist" ? shortlist : places;

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white font-sans">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0a0a0f]/90 backdrop-blur border-b border-white/5 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍽️</span>
            <h1 className="text-xl font-bold tracking-tight">Cafe Finder</h1>
          </div>

          {/* Search row */}
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search place or lat,lng (22.57,88.36)…"
                value={locationQuery}
                onChange={(e) => {
                  setLocationQuery(e.target.value);
                  fetchSuggestions(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
              />

              {/* Suggestions dropdown */}
              {suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute top-full mt-1 left-0 right-0 z-30 bg-[#141420] border border-white/10 rounded-lg overflow-hidden shadow-xl"
                >
                  {suggestions.map((s, i) => (
                    <button
                      key={s.place_name}
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent input blur
                        selectSuggestion(s);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        i === activeIndex
                          ? "bg-indigo-600/50 text-white"
                          : "hover:bg-white/5 text-white/70"
                      }`}
                    >
                      {s.place_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleSearch}
              disabled={searching}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              {searching ? "…" : "Search"}
            </button>

            <button
              onClick={useCurrentLocation}
              title="Use my location"
              className="bg-white/10 hover:bg-white/15 px-3 rounded-lg text-lg transition-colors"
            >
              🧭
            </button>
          </div>

          {/* Filter row */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-white/40">Sort</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-white/25"
              >
                <option value="score">Best Match</option>
                <option value="distance">Nearest</option>
                <option value="price">Cheapest</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label className="text-xs text-white/40">Radius</label>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-white/25"
              >
                <option value={1000}>1 km</option>
                <option value={2000}>2 km</option>
                <option value={4000}>4 km</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Error banner */}
        {fetchError && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
            <span>{fetchError}</span>
            <button onClick={() => setFetchError(null)} className="ml-4 text-rose-400/60 hover:text-rose-400">
              ✕
            </button>
          </div>
        )}

        {/* Map */}
        {userLocation && (
          <div className="rounded-xl overflow-hidden border border-white/10">
            <MapView
              places={places}
              userLocation={userLocation}
              selectedPlace={selectedPlace}
              onSelectPlace={setSelectedPlace}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("all")}
            className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${
              activeTab === "all"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            All Places{" "}
            {!loading && (
              <span className="text-xs text-white/30">({places.length})</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("shortlist")}
            className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${
              activeTab === "shortlist"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            ⭐ Shortlist{" "}
            {shortlist.length > 0 && (
              <span className="text-xs text-indigo-400">({shortlist.length})</span>
            )}
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="bg-white/5 rounded-xl h-24 animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : displayedPlaces.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">
            {activeTab === "shortlist"
              ? "No places shortlisted yet — tap ☆ on any result."
              : "No places found. Try increasing the radius."}
          </div>
        ) : (
          <div className="space-y-2">
            {displayedPlaces.map((place, i) => {
              const added = isShortlisted(place);
              const isSelected =
                selectedPlace && placeKey(selectedPlace) === placeKey(place);

              return (
                <div
                  key={placeKey(place)}
                  onClick={() => setSelectedPlace(place)}
                  className={`group relative bg-white/[0.03] hover:bg-white/[0.06] border rounded-xl p-4 cursor-pointer transition-all ${
                    isSelected
                      ? "border-indigo-500/60 bg-indigo-500/5"
                      : "border-white/[0.06]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold truncate">{place.tags.name}</h2>
                      <div className="flex items-center gap-3 mt-1 text-sm text-white/40">
                        <span>📏 {place.distance.toFixed(2)} km</span>
                        <span className={getPriceColor(place.estimatedCostForTwo)}>
                          {getPriceLabel(place.estimatedCostForTwo)} ₹{place.estimatedCostForTwo}
                        </span>
                        <span className="capitalize text-white/25">
                          {place.tags.amenity}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleShortlist(place);
                      }}
                      title={added ? "Remove from shortlist" : "Add to shortlist"}
                      className={`flex-shrink-0 text-xl leading-none transition-transform active:scale-90 ${
                        added ? "text-amber-400" : "text-white/20 hover:text-white/50"
                      }`}
                    >
                      {added ? "⭐" : "☆"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
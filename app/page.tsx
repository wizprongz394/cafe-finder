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
interface GroupUser {
  id: string; label: string;
  location: LatLon | null; locationLabel: string;
  maxBudget: number; preferences: string[];
}
interface GroupEnrichedPlace extends EnrichedPlace {
  groupScore: number; maxDistanceKm: number; avgDistanceKm: number;
  budgetOk: boolean[]; prefMatches: string[];
}
interface SplitMatch {
  placeA: EnrichedPlace;
  placeB: EnrichedPlace;
  distanceBetween: number;
  score: number;
  assignment: Record<string, "A" | "B" | "either">;
  reasons: string[];
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
const MAPBOX_CAT_PRICES: Record<string, number> = {
  "mexican restaurant": 1000, "italian restaurant": 1400, "chinese restaurant": 800,
  "japanese restaurant": 1400, "thai restaurant": 900, "indian restaurant": 700,
  "fast food restaurant": 350, "coffee shop": 500, "cafe": 500, "bakery": 300,
  "bar": 1000, "lounge": 1500, "fine dining": 2000, "seafood restaurant": 1000,
  "pizza": 600, "burger": 400, "sandwich": 350,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function estimateCost(place: RawPlace): { cost: number; source: EnrichedPlace["priceSource"] } {
  const name = (place.tags?.name ?? "").toLowerCase();
  const brand = (place.tags?.brand ?? "").toLowerCase();
  const cuisine = (place.tags?.cuisine ?? "").toLowerCase();
  const mbCats = (place.tags?.mapbox_cats ?? "").toLowerCase();
  const amenity = place.tags?.amenity ?? "";
  for (const [chain, price] of Object.entries(KNOWN_CHAINS))
    if (name.includes(chain) || brand.includes(chain)) return { cost: price, source: "known-chain" };
  for (const [cat, price] of Object.entries(MAPBOX_CAT_PRICES))
    if (mbCats.includes(cat)) return { cost: price, source: "cuisine" };
  if (cuisine) for (const [cuis, price] of Object.entries(CUISINE_PRICES))
    if (cuisine.includes(cuis)) return { cost: price, source: "cuisine" };
  if (/dhaba|highway|roadside|thela|stall/.test(name))           return { cost: 200,  source: "name-hint" };
  if (/rooftop|lounge|sky|terrace|fine|manor|palace/.test(name)) return { cost: 1800, source: "name-hint" };
  if (/\bbar\b|pub|brewery|taproom/.test(name))                  return { cost: 1200, source: "name-hint" };
  if (/\btea\b|chai|chaa|lassi|\bjuice\b/.test(name))            return { cost: 150,  source: "name-hint" };
  if (/sweet|mithai|mishti|confection|halwa/.test(name))         return { cost: 250,  source: "name-hint" };
  if (/bakery|cake|pastry|\bbread\b|patisserie/.test(name))      return { cost: 350,  source: "name-hint" };
  if (/biryani|\bdum\b/.test(name))                              return { cost: 500,  source: "name-hint" };
  if (/south.?indian|udupi|idli|dosa|tiffin/.test(name))         return { cost: 400,  source: "name-hint" };
  if (/roll|wrap|kathi|frankie/.test(name))                      return { cost: 250,  source: "name-hint" };
  if (/pizza/.test(name))                                        return { cost: 600,  source: "name-hint" };
  if (/burger/.test(name))                                       return { cost: 400,  source: "name-hint" };
  if (/\bmomo\b/.test(name))                                     return { cost: 250,  source: "name-hint" };
  if (/chinese|chowmein|noodle|wonton/.test(name))               return { cost: 600,  source: "name-hint" };
  if (/mughlai|awadhi|kebab|tandoor/.test(name))                 return { cost: 800,  source: "name-hint" };
  if (/seafood|fish|prawn|crab|lobster/.test(name))              return { cost: 900,  source: "name-hint" };
  if (/\bcafe\b|coffee|espresso/.test(name))                     return { cost: 500,  source: "name-hint" };
  if (/ice.?cream|gelato|frozen/.test(name))                     return { cost: 300,  source: "name-hint" };
  if (amenity === "fast_food")  return { cost: 350,  source: "amenity-type" };
  if (amenity === "cafe")       return { cost: 500,  source: "amenity-type" };
  if (amenity === "restaurant") return { cost: 700,  source: "amenity-type" };
  if (amenity === "bar")        return { cost: 1000, source: "amenity-type" };
  return { cost: 600, source: "default" };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function radiusToBbox(lat: number, lon: number, r: number) {
  const d = r / 111_000;
  return [lon - d, lat - d, lon + d, lat + d].join(",");
}
function centroid(locs: LatLon[]): LatLon {
  const n = locs.length;
  return { latitude: locs.reduce((s, l) => s + l.latitude, 0) / n, longitude: locs.reduce((s, l) => s + l.longitude, 0) / n };
}
function computeScore(p: EnrichedPlace): number {
  let s = 0;
  s += Math.max(0, 20 - p.distance * 5);
  if (p.tags.amenity === "restaurant") s += 4;
  if (p.tags.amenity === "cafe") s += 3;
  if (p.estimatedCostForTwo >= 250 && p.estimatedCostForTwo <= 900) s += 4;
  if (p.tags.name && p.tags.name.length > 3) s += 2;
  if (p.tags.cuisine) s += 2;
  if (p.priceSource === "known-chain") s += 2;
  if (p.priceSource === "cuisine") s += 1;
  if (p.distance > 3 && p.estimatedCostForTwo < 250) s -= 3;
  return s;
}
function scoreForGroup(place: EnrichedPlace, users: GroupUser[]): Omit<GroupEnrichedPlace, keyof EnrichedPlace> {
  const active = users.filter(u => u.location !== null);
  if (!active.length) return { groupScore: 0, maxDistanceKm: 0, avgDistanceKm: 0, budgetOk: [], prefMatches: [] };
  const dists = active.map(u => haversineKm(u.location!.latitude, u.location!.longitude, place.lat, place.lon));
  const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
  const max = Math.max(...dists);
  const variance = dists.reduce((s, d) => s + (d - avg) ** 2, 0) / dists.length;
  const budgetOk = active.map(u => place.estimatedCostForTwo <= u.maxBudget);
  const budgetScore = budgetOk.filter(Boolean).length / active.length;
  const txt = (place.tags.name + " " + (place.tags.cuisine ?? "") + " " + (place.tags.mapbox_cats ?? "")).toLowerCase();
  const prefMatches: string[] = [];
  for (const u of active) for (const pref of u.preferences)
    if (txt.includes(pref.toLowerCase()) && !prefMatches.includes(pref)) prefMatches.push(pref);
  const groupScore = -avg * 4 - max * 2 - variance * 3 + budgetScore * 15 + prefMatches.length * 10 + (place.estimatedCostForTwo >= 200 && place.estimatedCostForTwo <= 1000 ? 5 : 0);
  return { groupScore, maxDistanceKm: max, avgDistanceKm: avg, budgetOk, prefMatches };
}

// ─── Split match engine ───────────────────────────────────────────────────────

function findSplitMatches(places: EnrichedPlace[], users: GroupUser[]): SplitMatch[] {
  const active = users.filter(u => u.location);
  if (active.length < 2) return [];

  const allPrefs = active.flatMap(u => u.preferences);
  const uniquePrefs = new Set(allPrefs);
  const hasConflict = uniquePrefs.size > 1;

  const results: SplitMatch[] = [];
  const limit = Math.min(places.length, 80);

  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      const A = places[i];
      const B = places[j];

      const dist = haversineKm(A.lat, A.lon, B.lat, B.lon);
      if (dist > 0.5) continue; // 500m max between places

      let score = 0;
      let satisfiedUsers = 0;
      const reasons: string[] = [];
      const assignment: Record<string, "A" | "B" | "either"> = {};

      for (const user of active) {
        const txtA = ((A.tags.name ?? "") + " " + (A.tags.cuisine ?? "") + " " + (A.tags.mapbox_cats ?? "")).toLowerCase();
        const txtB = ((B.tags.name ?? "") + " " + (B.tags.cuisine ?? "") + " " + (B.tags.mapbox_cats ?? "")).toLowerCase();
        const prefA = user.preferences.some(p => txtA.includes(p.toLowerCase()));
        const prefB = user.preferences.some(p => txtB.includes(p.toLowerCase()));
        const budgetA = A.estimatedCostForTwo <= user.maxBudget;
        const budgetB = B.estimatedCostForTwo <= user.maxBudget;

        if (prefA && budgetA && prefB && budgetB) {
          assignment[user.id] = "either";
          satisfiedUsers++;
          score += 8;
        } else if (prefA && budgetA) {
          assignment[user.id] = "A";
          satisfiedUsers++;
          score += 10;
        } else if (prefB && budgetB) {
          assignment[user.id] = "B";
          satisfiedUsers++;
          score += 10;
        } else if (budgetA || budgetB) {
          assignment[user.id] = budgetA ? "A" : "B";
          score += 3;
        } else {
          score -= 5;
        }
      }

      // Reward closeness
      score += Math.max(0, 8 - dist * 15);

      // Boost if preferences actually conflict (this is where split shines)
      if (hasConflict) score += 12;

      // Bonus if A and B are different categories (complementary)
      if (A.tags.amenity !== B.tags.amenity) score += 4;

      // Must satisfy most of the group
      if (satisfiedUsers < Math.ceil(active.length * 0.6)) continue;

      // Build reasons
      const aName = A.tags.name;
      const bName = B.tags.name;
      if (dist < 0.15) reasons.push(`Just ${Math.round(dist * 1000)}m apart — easy to split up and meet after`);
      if (A.tags.amenity !== B.tags.amenity) reasons.push(`Different vibes: ${A.tags.amenity.replace("_"," ")} + ${B.tags.amenity.replace("_"," ")}`);
      if (hasConflict) reasons.push("Everyone gets their preference");

      results.push({ placeA: A, placeB: B, distanceBetween: dist, score, assignment, reasons });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 8);
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function priceColor(cost: number) {
  if (cost <= 400) return "text-emerald-400";
  if (cost <= 900) return "text-amber-400";
  return "text-rose-400";
}
function priceLabel(cost: number) {
  if (cost <= 300) return "₹"; if (cost <= 700) return "₹₹";
  if (cost <= 1200) return "₹₹₹"; return "₹₹₹₹";
}
function categoryEmoji(amenity: string) {
  if (amenity === "cafe") return "☕"; if (amenity === "fast_food") return "🍔";
  if (amenity === "bar") return "🍺"; return "🍽️";
}
function placeEmoji(place: EnrichedPlace): string {
  const n = place.tags.name.toLowerCase();
  if (/momo|dumpling/.test(n)) return "🥟";
  if (/biryani|rice/.test(n)) return "🍚";
  if (/pizza/.test(n)) return "🍕";
  if (/burger/.test(n)) return "🍔";
  if (/cake|pastry|bakery/.test(n)) return "🥐";
  if (/sweet|mithai|ice.?cream/.test(n)) return "🍰";
  if (/tea|chai/.test(n)) return "🍵";
  if (/coffee|cafe/.test(n)) return "☕";
  if (/chinese|noodle/.test(n)) return "🍜";
  return categoryEmoji(place.tags.amenity);
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const MAPBOX_CATEGORIES = ["restaurant","cafe","fast_food","food","coffee_shop","bar","bakery","dessert","ice_cream","tea_house"];
const BUDGET_OPTIONS = [200, 300, 500, 700, 1000, 1500, 2000];
const PREF_SUGGESTIONS = ["biryani","cafe","momo","pizza","chinese","south indian","kebab","sweets","seafood","coffee","fast food","rolls","sandwich"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [userLocation,   setUserLocation]   = useState<LatLon | null>(null);
  const [searchLocation, setSearchLocation] = useState<LatLon | null>(null);
  const [locationQuery,  setLocationQuery]  = useState("");
  const [suggestions,    setSuggestions]    = useState<MapboxFeature[]>([]);
  const [activeIndex,    setActiveIndex]    = useState(-1);
  const [searching,      setSearching]      = useState(false);
  const suggestionsRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLInputElement>(null);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [radius,       setRadius]       = useState(2000);
  const [sortBy,       setSortBy]       = useState<"score"|"distance"|"price">("score");
  const [resultsQuery, setResultsQuery] = useState("");
  const [allPlaces,    setAllPlaces]    = useState<EnrichedPlace[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [cacheStatus,  setCacheStatus]  = useState<string>("");
  const [selectedPlace, setSelectedPlace] = useState<EnrichedPlace | null>(null);
  const [shortlist,     setShortlist]     = useState<EnrichedPlace[]>([]);
  const [activeTab,     setActiveTab]     = useState<"all"|"shortlist">("all");

  const [groupMode,      setGroupMode]      = useState(false);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [users,          setUsers]          = useState<GroupUser[]>([]);
  const [userGeoQuery,   setUserGeoQuery]   = useState<Record<string, string>>({});
  const [userGeoSugg,    setUserGeoSugg]    = useState<Record<string, MapboxFeature[]>>({});
  const userGeoDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [prefInput,      setPrefInput]      = useState<Record<string, string>>({});

  // Split plan state
  const [planExplanation, setPlanExplanation] = useState<string>("");
  const [planLoading,     setPlanLoading]     = useState(false);

  const localCache = useRef<Map<string, EnrichedPlace[]>>(new Map());

  // Init "You" user
  useEffect(() => {
    if (!userLocation) return;
    setUsers(prev => {
      if (prev.find(u => u.id === "you"))
        return prev.map(u => u.id === "you" ? { ...u, location: userLocation } : u);
      return [{ id: "you", label: "You", location: userLocation, locationLabel: "Your location", maxBudget: 700, preferences: [] }, ...prev];
    });
  }, [userLocation]); // eslint-disable-line

  // ── Derived ───────────────────────────────────────────────────────────────
  const places = useMemo(() => {
    const list = [...allPlaces];
    if (sortBy === "distance") return list.sort((a, b) => a.distance - b.distance);
    if (sortBy === "price")    return list.sort((a, b) => a.estimatedCostForTwo - b.estimatedCostForTwo);
    return list.sort((a, b) => b.score - a.score);
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

  const groupResults = useMemo((): GroupEnrichedPlace[] => {
    if (!groupMode) return [];
    const active = users.filter(u => u.location !== null);
    if (!active.length) return [];
    return allPlaces.map(p => ({ ...p, ...scoreForGroup(p, active) }))
      .sort((a, b) => b.groupScore - a.groupScore).slice(0, 50);
  }, [groupMode, users, allPlaces]);

  const splitResults = useMemo((): SplitMatch[] => {
    if (!groupMode) return [];
    return findSplitMatches(allPlaces, users);
  }, [groupMode, allPlaces, users]);

  // Auto-decide: split mode wins if it scores higher than the top group result
  const shouldUseSplit = useMemo(() => {
    if (!groupMode || !splitResults.length || !groupResults.length) return false;
    // Also require that users have genuinely different preferences
    const allPrefs = users.filter(u => u.location).flatMap(u => u.preferences);
    const uniquePrefs = new Set(allPrefs);
    return uniquePrefs.size > 1 && splitResults[0].score > (groupResults[0]?.groupScore ?? 0);
  }, [groupMode, splitResults, groupResults, users]);

  const groupCenter = useMemo((): LatLon | null => {
    const active = users.filter(u => u.location !== null);
    return active.length ? centroid(active.map(u => u.location!)) : null;
  }, [users]);

  const mapGroupUsers = useMemo(() =>
    users.map(u => ({ id: u.id, label: u.label, location: u.location })),
  [users]);

  // ── LLM plan explanation ──────────────────────────────────────────────────
  async function explainPlan(match: SplitMatch) {
  console.log("🔥 BUTTON CLICKED");

  if (planLoading) {
    console.log("⛔ Skipped: already loading");
    return;
  }

  setPlanLoading(true);
  setPlanExplanation("");

  try {
    const activeUsers = users.filter(u => u.location);

    const prompt = `You are a friendly local food guide. A group of ${activeUsers.length} people (${activeUsers.map(u => u.label).join(", ")}) can't agree on one restaurant.

The app found a Smart Plan:
- Person A goes to: ${match.placeA.tags.name} (${match.placeA.tags.amenity}, ≈₹${match.placeA.estimatedCostForTwo} for two)
- Person B goes to: ${match.placeB.tags.name} (${match.placeB.tags.amenity}, ≈₹${match.placeB.estimatedCostForTwo} for two)
- They are only ${Math.round(match.distanceBetween * 1000)}m apart.

Group preferences: ${activeUsers.map(u => `${u.label} likes ${u.preferences.join(", ") || "anything"} (budget ₹${u.maxBudget})`).join("; ")}.

Write a warm, 2-sentence explanation of why this is a great plan. Be conversational and fun. No bullet points.`;

    console.log("📤 Sending prompt:", prompt);

    const res = await fetch("/api/explain", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    console.log("📡 Response status:", res.status);

    const data = await res.json();

    console.log("🧠 FULL RESPONSE:", data);

    // 🔥 OPENROUTER RESPONSE FORMAT
    // Your backend already returns: { text: "..." }
    let text =
      data?.text ||                // ✅ expected
      data?.error ||               // ❌ backend error
      "Couldn't generate explanation.";

    text = text.trim();

    console.log("🧠 FINAL TEXT:", text);

    // 🛡️ prevent empty UI
    if (!text) {
      text = "A smart way for everyone to enjoy their own favorites while staying close together.";
    }

    setPlanExplanation(text);

  } catch (err) {
    console.error("💥 explainPlan failed:", err);

    setPlanExplanation(
      "A great way to keep everyone happy — different tastes, same hangout."
    );
  } finally {
    setPlanLoading(false);
  }
}
  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchOsmPlaces = useCallback(async (lat: number, lon: number): Promise<RawPlace[]> => {
    const query = `[out:json][timeout:15];\n(\n  node["amenity"="cafe"](around:${radius},${lat},${lon});\n  node["amenity"="restaurant"](around:${radius},${lat},${lon});\n  node["amenity"="fast_food"](around:${radius},${lat},${lon});\n  node["amenity"="bar"](around:${radius},${lat},${lon});\n  way["amenity"="cafe"](around:${radius},${lat},${lon});\n  way["amenity"="restaurant"](around:${radius},${lat},${lon});\n  way["amenity"="fast_food"](around:${radius},${lat},${lon});\n);\nout center 150;\n`;
    try {
      const res = await fetch("/api/osm", { method: "POST", headers: { "Content-Type": "text/plain" }, body: query });
      setCacheStatus(res.headers.get("X-Cache") ?? "");
      if (!res.ok) return [];
      const data = await res.json();
      if (data.error) return [];
      return (data.elements ?? []).map((p: any) => ({ lat: p.lat ?? p.center?.lat, lon: p.lon ?? p.center?.lon, tags: p.tags ?? {} })).filter((p: RawPlace) => p.lat && p.lon && p.tags?.amenity);
    } catch { return []; }
  }, [radius]);

  const fetchMapboxPlaces = useCallback(async (lat: number, lon: number): Promise<RawPlace[]> => {
    if (!MAPBOX_TOKEN) return [];
    const bbox = radiusToBbox(lat, lon, radius);
    try {
      const results = await Promise.allSettled(
        MAPBOX_CATEGORIES.map(cat =>
          fetch(`https://api.mapbox.com/search/searchbox/v1/category/${cat}?proximity=${lon},${lat}&bbox=${bbox}&limit=25&language=en&access_token=${MAPBOX_TOKEN}`)
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
        )
      );
      const out: RawPlace[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const f of r.value.features ?? []) {
          const [fLon, fLat] = f.geometry?.coordinates ?? [];
          if (!fLon || !fLat) continue;
          const cats: string[] = f.properties?.poi_category ?? [];
          const cat = cats.join(", ").toLowerCase();
          let amenity = "restaurant";
          if (cat.includes("cafe") || cat.includes("coffee")) amenity = "cafe";
          else if (cat.includes("fast food")) amenity = "fast_food";
          else if (cat.includes("bar") || cat.includes("pub")) amenity = "bar";
          out.push({ lat: fLat, lon: fLon, tags: { name: f.properties?.name ?? "Unnamed", amenity, mapbox_cats: cat, cuisine: cats.filter(c => !["food","food and drink","restaurant","cafe"].includes(c.toLowerCase())).join(", "), phone: f.properties?.phone ?? "", address: f.properties?.full_address ?? f.properties?.address ?? "" } });
        }
      }
      return out;
    } catch { return []; }
  }, [radius]);

  const loadPlaces = useCallback(async (lat: number, lon: number) => {
    const key = `${lat.toFixed(4)}-${lon.toFixed(4)}-${radius}`;
    if (localCache.current.has(key)) { setAllPlaces(localCache.current.get(key)!); setLoading(false); setCacheStatus("LOCAL"); return; }
    setLoading(true); setFetchError(null);
    try {
      const [osm, mapbox] = await Promise.all([fetchOsmPlaces(lat, lon), fetchMapboxPlaces(lat, lon)]);
      if (!osm.length && !mapbox.length) { setFetchError("⚠️ No places found. Try increasing the radius."); setAllPlaces([]); setLoading(false); return; }
      const seen = new Map<string, RawPlace>();
      for (const p of [...mapbox, ...osm]) {
        if (!p.tags?.amenity) continue;
        seen.set(`${(p.tags.name ?? "?").toLowerCase().trim()}-${p.lat.toFixed(3)}-${p.lon.toFixed(3)}`, p);
      }
      const enriched = Array.from(seen.values()).map(p => {
        const distance = haversineKm(lat, lon, p.lat, p.lon);
        const { cost, source } = estimateCost(p);
        const base: EnrichedPlace = { ...p, distance, estimatedCostForTwo: cost, priceSource: source, score: 0, tags: { ...p.tags, name: p.tags?.name || "Unnamed Place" } };
        return { ...base, score: computeScore(base) };
      }).filter(p => p.distance <= radius / 1000).slice(0, 150);
      localCache.current.set(key, enriched);
      setAllPlaces(enriched); setFetchError(null);
    } catch { setFetchError("Failed to load places. Please try again."); }
    finally { setLoading(false); }
  }, [fetchOsmPlaces, fetchMapboxPlaces, radius]);

  useEffect(() => {
    const target = groupMode && groupCenter ? groupCenter : searchLocation;
    if (target) { loadPlaces(target.latitude, target.longitude); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }; setUserLocation(loc); setSearchLocation(loc); },
      () => setFetchError("Location access denied. Search for a place above.")
    );
  }, [searchLocation, loadPlaces, groupMode, groupCenter]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) && !inputRef.current?.contains(e.target as Node))
        { setSuggestions([]); setActiveIndex(-1); }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  // ── Geocoding ─────────────────────────────────────────────────────────────
  function fetchSuggestions(q: string) {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestDebounce.current = setTimeout(async () => {
      try { const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5`); const d = await r.json(); setSuggestions(d.features ?? []); setActiveIndex(-1); } catch { setSuggestions([]); }
    }, 300);
  }
  function fetchUserGeoSuggestions(uid: string, q: string) {
    if (userGeoDebounce.current[uid]) clearTimeout(userGeoDebounce.current[uid]);
    if (!q.trim()) { setUserGeoSugg(p => ({ ...p, [uid]: [] })); return; }
    userGeoDebounce.current[uid] = setTimeout(async () => {
      try { const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=4`); const d = await r.json(); setUserGeoSugg(p => ({ ...p, [uid]: d.features ?? [] })); } catch { setUserGeoSugg(p => ({ ...p, [uid]: [] })); }
    }, 300);
  }
  function selectSuggestion(s: MapboxFeature) {
    const [lon, lat] = s.center;
    setUserLocation({ latitude: lat, longitude: lon }); setSearchLocation({ latitude: lat, longitude: lon });
    setLocationQuery(s.place_name); setSuggestions([]); setActiveIndex(-1);
  }
  function selectUserLocation(uid: string, s: MapboxFeature) {
    const [lon, lat] = s.center;
    setUsers(p => p.map(u => u.id === uid ? { ...u, location: { latitude: lat, longitude: lon }, locationLabel: s.place_name } : u));
    setUserGeoQuery(p => ({ ...p, [uid]: s.place_name }));
    setUserGeoSugg(p => ({ ...p, [uid]: [] }));
  }
  async function handleSearch() {
    const q = locationQuery.trim(); if (!q) return;
    setSearching(true); setSuggestions([]);
    if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q)) { const [lat, lon] = q.split(",").map(Number); setUserLocation({ latitude: lat, longitude: lon }); setSearchLocation({ latitude: lat, longitude: lon }); setSearching(false); return; }
    if (activeIndex >= 0 && suggestions[activeIndex]) { selectSuggestion(suggestions[activeIndex]); setSearching(false); return; }
    try { const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=1`); const d = await r.json(); if (d.features?.length > 0) selectSuggestion(d.features[0]); else setFetchError("Location not found."); } catch { setFetchError("Geocoding failed."); }
    setSearching(false);
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) { if (e.key === "Enter") handleSearch(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeIndex >= 0) selectSuggestion(suggestions[activeIndex]); else handleSearch(); }
    else if (e.key === "Escape") { setSuggestions([]); setActiveIndex(-1); }
  }
  function useCurrentLocation() {
    navigator.geolocation.getCurrentPosition(
      pos => { const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }; setUserLocation(loc); setSearchLocation(loc); setLocationQuery(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`); },
      () => setFetchError("Could not access your location.")
    );
  }

  // ── Group helpers ─────────────────────────────────────────────────────────
  function addGroupUser() { const id = `u${Date.now()}`; setUsers(p => [...p, { id, label: `Friend ${p.length}`, location: null, locationLabel: "", maxBudget: 700, preferences: [] }]); }
  function removeGroupUser(id: string) { if (id !== "you") setUsers(p => p.filter(u => u.id !== id)); }
  function updateUser(id: string, patch: Partial<GroupUser>) { setUsers(p => p.map(u => u.id === id ? { ...u, ...patch } : u)); }
  function addPref(uid: string, pref: string) {
    const p = pref.trim().toLowerCase(); if (!p) return;
    setUsers(prev => prev.map(u => u.id === uid && !u.preferences.includes(p) ? { ...u, preferences: [...u.preferences, p] } : u));
    setPrefInput(prev => ({ ...prev, [uid]: "" }));
  }
  function removePref(uid: string, pref: string) { setUsers(p => p.map(u => u.id === uid ? { ...u, preferences: u.preferences.filter(x => x !== pref) } : u)); }

  // ── Shortlist ─────────────────────────────────────────────────────────────
  function placeKey(p: EnrichedPlace) { return `${(p.tags.name||"").toLowerCase().trim()}-${p.tags.amenity}-${p.lat.toFixed(5)}-${p.lon.toFixed(5)}`; }
  function toggleShortlist(place: EnrichedPlace) { const k = placeKey(place); setShortlist(p => p.some(x => placeKey(x) === k) ? p.filter(x => placeKey(x) !== k) : [...p, place]); }
  function isShortlisted(place: EnrichedPlace) { return shortlist.some(p => placeKey(p) === placeKey(place)); }

  // ── Display ───────────────────────────────────────────────────────────────
  const activeGroupList = groupMode
    ? (shouldUseSplit ? splitResults : groupResults)
    : filteredPlaces;

  const displayedItems =
    activeTab === "shortlist" ? shortlist :
    groupMode ? (shouldUseSplit ? splitResults : groupResults) :
    filteredPlaces;

  const mapPlaces = groupMode ? (shouldUseSplit ? [] : groupResults) : filteredPlaces;
  const mapCenter = groupMode && groupCenter ? groupCenter : userLocation;

  const activeUserCount = users.filter(u => u.location).length;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <main className="h-screen bg-[#0a0a0f] text-white font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-none z-20 bg-[#0a0a0f]/95 backdrop-blur border-b border-white/5 px-4 py-2">
        <div className="max-w-screen-xl mx-auto flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="text-lg select-none">🍽️</span>
            <h1 className="text-sm font-bold tracking-tight whitespace-nowrap">Cafe Finder</h1>
            <div className="relative flex-1 flex gap-1.5">
              <div className="relative flex-1">
                <input ref={inputRef} type="text" placeholder="Search place or lat,lng…" value={locationQuery}
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
              <button onClick={handleSearch} disabled={searching} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 rounded-lg text-xs font-medium transition-colors">{searching ? "…" : "Search"}</button>
              <button onClick={useCurrentLocation} className="bg-white/10 hover:bg-white/15 px-2 rounded-lg text-sm transition-colors">🧭</button>
            </div>
            <div className="flex items-center gap-2 flex-none">
              <button onClick={() => { setGroupMode(g => !g); if (!groupMode) setShowGroupPanel(true); setPlanExplanation(""); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${groupMode ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300" : "bg-white/5 border-white/10 text-white/50 hover:text-white/70"}`}>
                {groupMode ? "👥 Group" : "👤 Solo"}
              </button>
              <label className="text-xs text-white/40">Sort</label>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25">
                <option value="score">Best Match</option><option value="distance">Nearest</option><option value="price">Cheapest</option>
              </select>
              <label className="text-xs text-white/40">Radius</label>
              <select value={radius} onChange={e => setRadius(Number(e.target.value))} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25">
                <option value={1000}>1 km</option><option value={2000}>2 km</option><option value={4000}>4 km</option><option value={6000}>6 km</option><option value={10000}>10 km</option>
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

      <div className="flex-1 flex overflow-hidden px-3 py-3 gap-3 max-w-screen-xl mx-auto w-full">
        {/* Map */}
        <div className="flex-1 rounded-xl overflow-hidden border border-white/10 min-w-0">
          {mapCenter ? (
            <MapView places={mapPlaces} userLocation={mapCenter} selectedPlace={selectedPlace} onSelectPlace={setSelectedPlace} groupMode={groupMode} groupUsers={mapGroupUsers} />
          ) : (
            <div className="h-full flex items-center justify-center text-white/20 text-sm">Waiting for location…</div>
          )}
        </div>

        <div className="flex gap-2 min-w-0">
          {/* Group setup panel */}
          {groupMode && showGroupPanel && (
            <div className="w-64 flex flex-col gap-2 bg-[#0f0f1a] border border-white/8 rounded-xl p-3 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/70">👥 Group Setup</span>
                <button onClick={() => setShowGroupPanel(false)} className="text-white/30 hover:text-white/60 text-xs">✕</button>
              </div>
              {users.map(user => (
                <div key={user.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-2.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <input value={user.label} onChange={e => updateUser(user.id, { label: e.target.value })}
                      className="bg-transparent text-xs font-semibold text-white/80 w-24 focus:outline-none border-b border-white/10 focus:border-white/30" />
                    {user.id !== "you" && <button onClick={() => removeGroupUser(user.id)} className="text-rose-400/50 hover:text-rose-400 text-xs">✕</button>}
                  </div>
                  <div className="relative">
                    <input type="text" placeholder={user.id === "you" ? "Your location" : "Their location…"}
                      value={userGeoQuery[user.id] ?? user.locationLabel}
                      onChange={e => { setUserGeoQuery(p => ({ ...p, [user.id]: e.target.value })); fetchUserGeoSuggestions(user.id, e.target.value); }}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] placeholder:text-white/20 focus:outline-none focus:border-white/25" />
                    {(userGeoSugg[user.id] ?? []).length > 0 && (
                      <div className="absolute top-full mt-0.5 left-0 right-0 z-40 bg-[#141420] border border-white/10 rounded-lg overflow-hidden shadow-xl">
                        {(userGeoSugg[user.id] ?? []).map(s => (
                          <button key={s.place_name} onMouseDown={e => { e.preventDefault(); selectUserLocation(user.id, s); }}
                            className="w-full text-left px-2 py-1.5 text-[10px] hover:bg-white/5 text-white/60 truncate">{s.place_name}</button>
                        ))}
                      </div>
                    )}
                    {user.location && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-400 text-[10px]">✓</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/30 flex-none">Budget</span>
                    <select value={user.maxBudget} onChange={e => updateUser(user.id, { maxBudget: Number(e.target.value) })}
                      className="flex-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] focus:outline-none">
                      {BUDGET_OPTIONS.map(b => <option key={b} value={b}>₹{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {user.preferences.map(p => (
                        <span key={p} className="flex items-center gap-0.5 bg-indigo-600/20 text-indigo-300 text-[9px] px-1.5 py-0.5 rounded-full">
                          {p}<button onClick={() => removePref(user.id, p)} className="text-indigo-400/60 hover:text-indigo-300 ml-0.5">×</button>
                        </span>
                      ))}
                    </div>
                    <input type="text" placeholder="Add pref…" value={prefInput[user.id] ?? ""}
                      onChange={e => setPrefInput(p => ({ ...p, [user.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPref(user.id, prefInput[user.id] ?? ""); }}}
                      className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] placeholder:text-white/20 focus:outline-none mb-1" />
                    <div className="flex flex-wrap gap-0.5">
                      {PREF_SUGGESTIONS.filter(s => !user.preferences.includes(s)).slice(0, 6).map(s => (
                        <button key={s} onClick={() => addPref(user.id, s)} className="text-[9px] text-white/30 hover:text-white/60 bg-white/5 px-1.5 py-0.5 rounded-full">+{s}</button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addGroupUser} className="w-full py-1.5 border border-dashed border-white/10 rounded-xl text-xs text-white/30 hover:text-white/60 hover:border-white/20 transition-colors">+ Add person</button>
              {groupCenter && <div className="text-[9px] text-white/20 text-center">📍 Searching from group centroid</div>}
            </div>
          )}
          {groupMode && !showGroupPanel && (
            <button onClick={() => setShowGroupPanel(true)} className="w-8 flex items-center justify-center bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-indigo-400 text-xs hover:bg-indigo-600/20 transition-colors">👥</button>
          )}

          {/* Results list */}
          <div className="w-72 flex flex-col gap-2 min-w-0">
            {/* Tabs */}
            <div className="flex gap-1 bg-white/5 rounded-lg p-1 flex-none items-center">
              {(["all","shortlist"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1 text-xs rounded-md font-medium transition-colors ${activeTab === tab ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}>
                  {tab === "all"
                    ? <>All {!loading && <span className="text-white/30">({(groupMode ? activeGroupList : filteredPlaces).length}{!groupMode && resultsQuery ? `/${places.length}` : ""})</span>}</>
                    : <>⭐ Shortlist {shortlist.length > 0 && <span className="text-indigo-400">({shortlist.length})</span>}</>}
                </button>
              ))}
              {cacheStatus && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono flex-none ${["FRESH","LOCAL"].includes(cacheStatus) ? "text-emerald-400/60 bg-emerald-400/10" : cacheStatus === "WARM" ? "text-amber-400/60 bg-amber-400/10" : "text-white/20 bg-white/5"}`}>{cacheStatus}</span>
              )}
            </div>

            {/* Solo filter */}
            {activeTab === "all" && !groupMode && (
              <div className="relative flex-none">
                <input type="text" placeholder="Filter results… (e.g. biryani, cafe)" value={resultsQuery} onChange={e => setResultsQuery(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-white/20 focus:outline-none focus:border-white/25 transition-colors" />
                {resultsQuery && <button onClick={() => setResultsQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 text-xs">✕</button>}
              </div>
            )}

            {/* Group mode status bar */}
            {groupMode && activeTab === "all" && (
              <div className={`text-[10px] rounded-lg px-3 py-1.5 flex items-center justify-between ${shouldUseSplit ? "bg-violet-600/10 border border-violet-500/20 text-violet-300/70" : "bg-indigo-600/5 border border-indigo-500/10 text-indigo-300/60"}`}>
                <span>
                  {shouldUseSplit
                    ? `🤝 Smart Plan — ${activeUserCount} people, different tastes`
                    : `👥 ${activeUserCount} people · fair distance · shared budget`}
                </span>
              </div>
            )}

            {/* Results */}
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {loading ? (
                [...Array(8)].map((_, i) => <div key={i} className="bg-white/5 rounded-xl h-16 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />)
              ) : displayedItems.length === 0 ? (
                <div className="text-center py-12 text-white/30 text-xs">
                  {activeTab === "shortlist" ? "No places shortlisted yet." : groupMode ? "Set locations for at least one person." : resultsQuery ? `No results for "${resultsQuery}"` : "No places found. Try increasing the radius."}
                </div>
              ) : (
                (displayedItems as any[]).map((item, idx) => {
                  // ── Split match card ──────────────────────────────────────
                  if ("placeA" in item) {
                    const s = item as SplitMatch;
                    const isFirst = idx === 0;
                    return (
                      <div key={`split-${idx}`} className="bg-violet-500/5 border border-violet-500/25 rounded-xl p-3">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs">🤝</span>
                            <span className="text-xs font-semibold text-violet-300">Smart Plan</span>
                            {isFirst && <span className="text-[9px] bg-violet-600/30 text-violet-200 px-1.5 py-0.5 rounded-full">Best match</span>}
                          </div>
                          <span className="text-[9px] text-white/30">{Math.round(s.distanceBetween * 1000)}m apart</span>
                        </div>

                        {/* Two places */}
                        <div className="space-y-1.5 mb-2">
                          {[s.placeA, s.placeB].map((place, pi) => (
                            <div key={pi} className="flex items-center gap-2 bg-white/[0.03] rounded-lg px-2 py-1.5">
                              <span className="text-base flex-shrink-0">{placeEmoji(place)}</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium truncate">{place.tags.name}</div>
                                <div className={`text-[10px] ${priceColor(place.estimatedCostForTwo)}`}>≈ ₹{place.estimatedCostForTwo}</div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Who goes where */}
                        <div className="flex gap-1 flex-wrap mb-2">
                          {users.filter(u => u.location).map(u => {
                            const assignment = s.assignment[u.id];
                            const emoji = assignment === "A" ? placeEmoji(s.placeA) : assignment === "B" ? placeEmoji(s.placeB) : "🔀";
                            return (
                              <span key={u.id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/50 flex items-center gap-0.5">
                                {u.label} → {emoji}
                              </span>
                            );
                          })}
                        </div>

                        {/* Reasons */}
                        {s.reasons.length > 0 && (
                          <p className="text-[9px] text-white/30 mb-2 leading-relaxed">{s.reasons[0]}</p>
                        )}

                        {/* LLM explanation */}
                        {isFirst && (
                          <div>
                            {planExplanation ? (
                              <p className="text-[10px] text-violet-200/60 leading-relaxed italic">"{planExplanation}"</p>
                            ) : (
                              <button onClick={() => explainPlan(s)} disabled={planLoading}
                                className="w-full text-[10px] py-1 bg-violet-600/15 hover:bg-violet-600/25 text-violet-300/70 rounded-lg transition-colors disabled:opacity-50">
                                {planLoading ? "✨ Thinking…" : "✨ Explain this plan"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // ── Regular place card ────────────────────────────────────
                  const place = item as EnrichedPlace | GroupEnrichedPlace;
                  const gp = place as GroupEnrichedPlace;
                  const isGroup = groupMode && "groupScore" in place;
                  const added = isShortlisted(place);
                  const isSel = selectedPlace && placeKey(selectedPlace) === placeKey(place);
                  const cuisineDisplay = (place.tags.cuisine ?? "").replace(/food and drink,?\s*/gi,"").replace(/food,?\s*/gi,"").replace(/^,\s*/,"").trim();

                  return (
                    <div key={placeKey(place)} onClick={() => setSelectedPlace(place)}
                      className={`group relative bg-white/[0.03] hover:bg-white/[0.06] border rounded-xl p-3 cursor-pointer transition-all ${isSel ? "border-indigo-500/60 bg-indigo-500/5" : "border-white/[0.06]"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="text-sm leading-none flex-shrink-0">{placeEmoji(place)}</span>
                            <h2 className="text-xs font-semibold truncate">{place.tags.name}</h2>
                          </div>
                          {cuisineDisplay && <p className="text-[10px] text-white/30 mt-0.5 truncate capitalize">{cuisineDisplay}</p>}
                          {place.tags.address && <p className="text-[10px] text-white/20 mt-0.5 truncate">{place.tags.address}</p>}
                          <div className="flex items-center gap-2 mt-1 text-xs text-white/40 flex-wrap">
                            {isGroup ? <><span>📏 avg {gp.avgDistanceKm.toFixed(2)} km</span><span className="text-white/20">max {gp.maxDistanceKm.toFixed(2)}</span></> : <span>📏 {place.distance.toFixed(2)} km</span>}
                            <span className={priceColor(place.estimatedCostForTwo)}>{priceLabel(place.estimatedCostForTwo)} ≈ ₹{place.estimatedCostForTwo}{place.priceSource === "default" && <span className="text-white/20 text-[9px] ml-0.5">est</span>}</span>
                          </div>
                          {isGroup && gp.budgetOk.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {users.filter(u => u.location).map((u, i) => (
                                <span key={u.id} className={`text-[9px] px-1.5 py-0.5 rounded-full ${gp.budgetOk[i] ? "bg-emerald-400/10 text-emerald-400/70" : "bg-rose-400/10 text-rose-400/70"}`}>{u.label} {gp.budgetOk[i] ? "✓" : "✗"}</span>
                              ))}
                            </div>
                          )}
                          {isGroup && gp.prefMatches.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {gp.prefMatches.map(m => <span key={m} className="text-[9px] bg-indigo-600/15 text-indigo-300/70 px-1.5 py-0.5 rounded-full">{m}</span>)}
                            </div>
                          )}
                          {place.tags.opening_hours && <p className="text-[10px] text-white/20 mt-0.5 truncate">🕐 {place.tags.opening_hours}</p>}
                          {place.tags.phone && <p className="text-[10px] text-white/20 mt-0.5">📞 {place.tags.phone}</p>}
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
      </div>
    </main>
  );
}
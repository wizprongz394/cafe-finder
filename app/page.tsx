"use client";

import { useEffect, useState } from "react";
import MapView from "@/components/MapView";

export default function Home() {
  const [places, setPlaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  const [userLocation, setUserLocation] = useState<any>(null);
  const [searchLocation, setSearchLocation] = useState<any>(null);

  const [locationQuery, setLocationQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const [radius, setRadius] = useState(2000);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);

  // ⭐ NEW: shortlist
  const [shortlist, setShortlist] = useState<any[]>([]);

  // 🌍 Fetch places
  async function fetchCafes(lat: number, lon: number) {
    const query = `
      [out:json];
      node["amenity"~"cafe|restaurant|fast_food"](around:${radius},${lat},${lon});
      out;
    `;

    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
    });

    const data = await res.json();
    return data.elements;
  }

  // 📏 Distance
  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
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

  // 💸 Cost estimation
  function estimateCost(place: any) {
    const type = place.tags?.amenity;

    if (type === "fast_food") return 300;
    if (type === "cafe") return 700;
    if (type === "restaurant") return 1000;

    return 800;
  }

  function getPriceColor(cost: number) {
    if (cost < 700) return "text-green-400";
    if (cost <= 900) return "text-yellow-400";
    return "text-red-400";
  }

  function getScore(place: any) {
    let score = 0;
    score += Math.max(0, 5 - place.distance);
    if (place.tags.amenity === "cafe") score += 2;
    return score;
  }

  // ⭐ TOGGLE SHORTLIST
  function toggleShortlist(place: any) {
    setShortlist((prev) => {
      const exists = prev.find(
        (p) => p.tags.name === place.tags.name
      );

      if (exists) {
        return prev.filter(
          (p) => p.tags.name !== place.tags.name
        );
      }

      return [...prev, place];
    });
  }

  function isShortlisted(place: any) {
    return shortlist.some(
      (p) => p.tags.name === place.tags.name
    );
  }

  // 🔍 AUTOCOMPLETE
  async function fetchSuggestions(query: string) {
    if (!query) return setSuggestions([]);

    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&autocomplete=true&limit=5`
    );

    const data = await res.json();
    setSuggestions(data.features || []);
  }

  function selectSuggestion(s: any) {
    const [lon, lat] = s.center;

    setUserLocation({ latitude: lat, longitude: lon });
    setSearchLocation({ latitude: lat, longitude: lon });
    setLocationQuery(s.place_name);
    setSuggestions([]);
    setActiveIndex(-1);
  }

  async function handleSearch() {
    if (!locationQuery) return;

    setSearching(true);

    const isLatLng = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(locationQuery);

    if (isLatLng) {
      const [lat, lon] = locationQuery.split(",").map(Number);

      setUserLocation({ latitude: lat, longitude: lon });
      setSearchLocation({ latitude: lat, longitude: lon });
      setSuggestions([]);
      setActiveIndex(-1);
      setSearching(false);
      return;
    }

    if (suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
    }

    setSearching(false);
  }

  function useCurrentLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;

      setUserLocation({ latitude, longitude });
      setSearchLocation({ latitude, longitude });
      setSuggestions([]);
    });
  }

  // 🔁 LOAD DATA
  useEffect(() => {
    const loadPlaces = async (lat: number, lon: number) => {
      setLoading(true);

      const rawPlaces = await fetchCafes(lat, lon);

      const filtered = rawPlaces.filter(
        (p: any) => p.tags && p.tags.name && p.tags.name.length > 2
      );

      const unique = Array.from(
        new Map(filtered.map((p: any) => [p.tags.name, p])).values()
      );

      const enriched = unique.map((place: any) => {
        const cost = estimateCost(place);

        return {
          ...place,
          distance: getDistance(lat, lon, place.lat, place.lon),
          estimatedCostForTwo: cost,
        };
      });

      enriched.sort((a: any, b: any) => getScore(b) - getScore(a));

      setPlaces(enriched.slice(0, 20));
      setLoading(false);
    };

    if (searchLocation) {
      loadPlaces(searchLocation.latitude, searchLocation.longitude);
    } else {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ latitude, longitude });
        loadPlaces(latitude, longitude);
      });
    }
  }, [searchLocation, radius]);

  const isLatLng = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(locationQuery);

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-6">🍽️ Cafe Finder</h1>

      {/* 🔍 SEARCH */}
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="Search place OR lat,lng (22.57,88.36)"
          value={locationQuery}
          onChange={(e) => {
            const value = e.target.value;
            setLocationQuery(value);

            if (!/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value)) {
              fetchSuggestions(value);
            } else {
              setSuggestions([]);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (activeIndex >= 0) {
                selectSuggestion(suggestions[activeIndex]);
              } else {
                handleSearch();
              }
            }

            if (e.key === "ArrowDown") {
              setActiveIndex((prev) =>
                prev < suggestions.length - 1 ? prev + 1 : prev
              );
            }

            if (e.key === "ArrowUp") {
              setActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
            }
          }}
          className="bg-gray-800 p-2 rounded w-full"
        />

        <button
          onClick={handleSearch}
          className="bg-blue-600 px-4 rounded flex items-center justify-center"
        >
          {searching ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            "🔍"
          )}
        </button>

        <button
          onClick={useCurrentLocation}
          className="bg-green-600 px-4 rounded"
        >
          🧭
        </button>
      </div>

      {/* 🔽 AUTOCOMPLETE */}
      {!isLatLng && suggestions.length > 0 && (
        <div className="bg-gray-900 rounded mb-4">
          {suggestions.map((s, i) => (
            <div
              key={i}
              onClick={() => selectSuggestion(s)}
              className={`p-2 cursor-pointer ${
                i === activeIndex ? "bg-gray-700" : "hover:bg-gray-700"
              }`}
            >
              {s.place_name}
            </div>
          ))}
        </div>
      )}

      {/* 📏 RADIUS */}
      <select
        value={radius}
        onChange={(e) => setRadius(Number(e.target.value))}
        className="bg-gray-800 p-2 rounded mb-4"
      >
        <option value={1000}>1 km</option>
        <option value={2000}>2 km</option>
        <option value={4000}>4 km</option>
      </select>

      {/* 🗺️ MAP */}
      {userLocation && (
        <MapView
          places={places}
          userLocation={userLocation}
          selectedPlace={selectedPlace}
          onSelectPlace={setSelectedPlace}
        />
      )}

      {/* ⭐ SHORTLIST DEBUG (LOGIC VIEW) */}
      <div className="mb-4 text-sm text-gray-400">
        Shortlisted: {shortlist.length}
      </div>

      {/* 📋 LIST */}
      <div className="grid gap-4">
        {loading ? (
          <p>Loading...</p>
        ) : (
          places.map((place, i) => {
            const cost = place.estimatedCostForTwo;
            const added = isShortlisted(place);

            return (
              <div
                key={i}
                onClick={() => setSelectedPlace(place)}
                className="bg-gray-900 p-4 rounded cursor-pointer"
              >
                <h2 className="text-lg font-semibold">
                  {place.tags.name}
                </h2>

                <p className="text-gray-400 text-sm">
                  📏 {place.distance.toFixed(2)} km away
                </p>

                <p className={`${getPriceColor(cost)} text-sm`}>
                  💰 ₹{cost} for two
                </p>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleShortlist(place);
                  }}
                  className="mt-2 text-sm"
                >
                  {added ? "⭐ Added" : "☆ Add"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
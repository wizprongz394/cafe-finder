"use client";

import { useEffect, useState } from "react";
import MapView from "@/components/MapView";

export default function Home() {
  const [places, setPlaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState("medium");

  const [userLocation, setUserLocation] = useState<any>(null);
  const [searchLocation, setSearchLocation] = useState<any>(null);

  const [locationQuery, setLocationQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);

  const [radius, setRadius] = useState(2000);

  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [shortlisted, setShortlisted] = useState<any[]>([]);

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
    const name = place.tags?.name?.toLowerCase() || "";

    let base = 800;

    if (type === "fast_food") base = 300;
    else if (type === "cafe") base = 700;
    else if (type === "restaurant") base = 1000;

    if (name.includes("dhaba") || name.includes("mess")) base -= 200;
    if (name.includes("bar") || name.includes("lounge")) base += 300;
    if (name.includes("hotel") || name.includes("fine")) base += 400;

    const variation = Math.floor(Math.random() * 300) - 150;

    return Math.max(200, base + variation);
  }

  function getPriceCategory(cost: number) {
    if (cost < 700) return "low";
    if (cost <= 900) return "medium";
    return "high";
  }

  function getScore(place: any) {
    let score = 0;
    score += Math.max(0, 5 - place.distance);
    if (place.price === "medium") score += 3;
    if (place.tags.amenity === "cafe") score += 2;
    return score;
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

  // 🔍 SELECT SUGGESTION
  function selectSuggestion(s: any) {
    const [lon, lat] = s.center;

    setUserLocation({ latitude: lat, longitude: lon });
    setSearchLocation({ latitude: lat, longitude: lon });
    setLocationQuery(s.place_name);
    setSuggestions([]);
  }

  // 📍 LAT LNG INPUT
  function handleLatLngInput() {
    try {
      const [lat, lon] = locationQuery.split(",").map(Number);

      if (!lat || !lon) return;

      setUserLocation({ latitude: lat, longitude: lon });
      setSearchLocation({ latitude: lat, longitude: lon });
    } catch {
      console.log("Invalid coords");
    }
  }

  // 🧭 CURRENT LOCATION
  function useCurrentLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;

      setUserLocation({ latitude, longitude });
      setSearchLocation({ latitude, longitude });
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
        const distance = getDistance(lat, lon, place.lat, place.lon);
        const cost = estimateCost(place);
        const price = getPriceCategory(cost);

        return {
          ...place,
          distance,
          estimatedCostForTwo: cost,
          price,
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

  const filteredPlaces = places;

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-6">🍽️ Cafe Finder</h1>

      {/* 🔍 SEARCH INPUT */}
      <input
        type="text"
        placeholder="Search location or lat,lng"
        value={locationQuery}
        onChange={(e) => {
          setLocationQuery(e.target.value);
          fetchSuggestions(e.target.value);
        }}
        className="bg-gray-800 p-2 rounded w-full mb-2"
      />

      {/* 🔽 AUTOCOMPLETE */}
      {suggestions.length > 0 && (
        <div className="bg-gray-900 rounded mb-4">
          {suggestions.map((s, i) => (
            <div
              key={i}
              onClick={() => selectSuggestion(s)}
              className="p-2 hover:bg-gray-700 cursor-pointer"
            >
              {s.place_name}
            </div>
          ))}
        </div>
      )}

      {/* 🎛️ CONTROLS */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={handleLatLngInput}
          className="bg-purple-600 px-4 py-2 rounded"
        >
          📍 Lat/Lng
        </button>

        <button
          onClick={useCurrentLocation}
          className="bg-green-600 px-4 py-2 rounded"
        >
          🧭 My Location
        </button>
      </div>

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
          places={filteredPlaces}
          userLocation={userLocation}
          selectedPlace={selectedPlace}
          onSelectPlace={setSelectedPlace}
        />
      )}

      {/* 📋 LIST */}
      <div className="grid gap-4">
        {loading ? (
          <p>Loading...</p>
        ) : (
          filteredPlaces.map((place, i) => (
            <div
              key={i}
              onClick={() => setSelectedPlace(place)}
              className="bg-gray-900 p-4 rounded cursor-pointer"
            >
              <h2>{place.tags.name}</h2>
              <p>📏 {place.distance.toFixed(2)} km</p>
              <p>💰 ₹{place.estimatedCostForTwo}</p>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShortlisted((prev) => {
                    if (prev.find(p => p.tags.name === place.tags.name)) return prev;
                    return [...prev, place];
                  });
                }}
                className="mt-2 bg-yellow-600 px-3 py-1 rounded"
              >
                ⭐ Add
              </button>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
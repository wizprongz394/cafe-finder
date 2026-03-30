"use client";

import { useEffect, useState } from "react";
import MapView from "@/components/MapView";

export default function Home() {
  const [places, setPlaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState("medium");
  const [userLocation, setUserLocation] = useState<any>(null);

  const groupPreferences = [
    { name: "You", budget: "medium" },
    { name: "Friend1", budget: "low" },
    { name: "Friend2", budget: "medium" },
  ];

  async function fetchCafes(lat: number, lon: number) {
    const query = `
      [out:json];
      node["amenity"~"cafe|restaurant|fast_food"](around:4000,${lat},${lon});
      out;
    `;

    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
    });

    const data = await res.json();
    return data.elements;
  }

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

  function matchesGroup(place: any) {
    let score = 0;

    groupPreferences.forEach((user) => {
      if (user.budget === "low" && place.price === "low") score++;
      else if (user.budget === "medium" && place.price !== "high") score++;
      else if (user.budget === "high") score++;
    });

    return score >= Math.ceil(groupPreferences.length / 2);
  }

  useEffect(() => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;

      setUserLocation({ latitude, longitude });

      const rawPlaces = await fetchCafes(latitude, longitude);

      // 🧹 Filter
      const filtered = rawPlaces.filter(
        (place: any) =>
          place.tags &&
          place.tags.name &&
          place.tags.name.length > 2
      );

      // 🧹 Remove duplicates (FIXED)
      const unique = Array.from(
        new Map(filtered.map((p: any) => [p.tags.name, p])).values()
      );

      // 🧠 Enrich
      const enriched = unique.map((place: any) => {
        const distance = getDistance(
          latitude,
          longitude,
          place.lat,
          place.lon
        );

        const cost = estimateCost(place);
        const price = getPriceCategory(cost);

        return {
          ...place,
          distance,
          estimatedCostForTwo: cost,
          price,
        };
      });

      enriched.sort((a: any, b: any) => a.distance - b.distance);

      setPlaces(enriched.slice(0, 20));
      setLoading(false);
    });
  }, []);

  const filteredPlaces = places.filter((place: any) => {
    const individualMatch =
      budget === "low"
        ? place.price === "low"
        : budget === "medium"
        ? place.price !== "high"
        : true;

    return individualMatch && matchesGroup(place);
  });

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-6">🍽️ Cafe Finder</h1>

      <select
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        className="bg-gray-800 p-2 rounded mb-4"
      >
        <option value="low">₹ (&lt;700)</option>
        <option value="medium">₹₹ (700–900)</option>
        <option value="high">₹₹₹ (900+)</option>
      </select>

      {/* 🗺️ MAP FIXED */}
      {userLocation && (
        <MapView places={filteredPlaces} userLocation={userLocation} />
      )}

      <div className="grid gap-4">
        {loading ? (
          <p>🔍 Scanning nearby food spots...</p>
        ) : filteredPlaces.length === 0 ? (
          <p>No places match your group's vibe 😢</p>
        ) : (
          filteredPlaces.map((place, index) => (
            <div key={index} className="bg-gray-900 p-4 rounded-xl">
              <h2 className="text-xl font-semibold">
                {place.tags.name}
              </h2>

              <p className="text-gray-400 text-sm">
                🍽️ {place.tags.amenity}
              </p>

              <p className="text-gray-400 text-sm">
                📏 {place.distance.toFixed(2)} km away
              </p>

              <p className="text-blue-400 text-sm">
                💰 ₹{place.estimatedCostForTwo} for two
              </p>

              <p className="text-green-400 text-sm">
                💸 {place.price.toUpperCase()}
              </p>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
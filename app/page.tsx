"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [places, setPlaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<any>(null);

  // 🧠 Fetch cafes from OpenStreetMap (Overpass API)
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

  // 📏 Distance calculation (Haversine)
  function getDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
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

      // 🧹 STEP 1: Filter valid places
      const filtered = rawPlaces.filter(
        (place: any) =>
          place.tags &&
          place.tags.name &&
          place.tags.name.length > 2
      );

      // 🧹 STEP 2: Remove duplicates (by name)
      const unique = Array.from(
        new Map(
          filtered.map((place: any) => [place.tags.name, place])
        ).values()
      );

      // 🧠 STEP 3: Enrich with distance
      const enriched = unique.map((place: any) => ({
        ...place,
        distance: getDistance(
          latitude,
          longitude,
          place.lat,
          place.lon
        ),
      }));

      // 🧠 STEP 4: Sort by nearest
      enriched.sort((a: any, b: any) => a.distance - b.distance);

      setPlaces(enriched);
      setLoading(false);
    });
  }, []);

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <h1 className="text-3xl font-bold mb-6">🍽️ Cafe Finder</h1>

      <div className="grid gap-4">
        {loading ? (
          <p>🔍 Scanning nearby food spots...</p>
        ) : places.length === 0 ? (
          <p>No places found 😢</p>
        ) : (
          places.map((place, index) => (
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
            </div>
          ))
        )}
      </div>
    </main>
  );
}
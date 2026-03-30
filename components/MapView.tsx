"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

export default function Map({ places, userLocation }: any) {
  const mapContainer = useRef(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!userLocation) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current!,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 13,
    });

    // 👤 User marker
    new mapboxgl.Marker({ color: "blue" })
      .setLngLat([userLocation.longitude, userLocation.latitude])
      .addTo(map);

    // 📍 Places
    places.forEach((place: any) => {
      new mapboxgl.Marker({ color: "red" })
        .setLngLat([place.lon, place.lat])
        .setPopup(
          new mapboxgl.Popup().setHTML(
            `<h3>${place.tags.name}</h3>
             <p>₹${place.estimatedCostForTwo}</p>`
          )
        )
        .addTo(map);
    });

    mapRef.current = map;

    return () => map.remove();
  }, [places, userLocation]);

  return (
    <div
      ref={mapContainer}
      className="w-full h-[400px] rounded-xl mb-6"
    />
  );
}
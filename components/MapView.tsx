"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

type Props = {
  places: any[];
  userLocation: { latitude: number; longitude: number } | null;
  selectedPlace: any;
  onSelectPlace: (place: any) => void;
};

export default function MapView({
  places,
  userLocation,
  selectedPlace,
  onSelectPlace,
}: Props) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const hasCenteredInitially = useRef(false);

  // 🧠 Initialize map ONCE
  useEffect(() => {
    if (!mapContainer.current || mapRef.current || !userLocation) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 13,
    });

    // 🎛️ Add controls (zoom + rotation)
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    mapRef.current = map;
  }, [userLocation]);

  // 🧭 Smart recenter (only when location truly changes)
  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    if (!hasCenteredInitially.current) {
      hasCenteredInitially.current = true;
      return;
    }

    mapRef.current.flyTo({
      center: [userLocation.longitude, userLocation.latitude],
      zoom: 13,
      essential: true,
    });
  }, [userLocation]);

  // 📍 Handle markers
  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    const map = mapRef.current;

    // 🧹 Remove old markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // 👤 User marker
    const userMarker = new mapboxgl.Marker({ color: "#3b82f6" })
      .setLngLat([userLocation.longitude, userLocation.latitude])
      .addTo(map);

    markersRef.current.push(userMarker);

    // 📍 Place markers
    places.forEach((place) => {
      const isSelected =
        selectedPlace?.tags?.name === place.tags.name;

      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="color:black">
          <h3 style="font-weight:bold">${place.tags.name}</h3>
          <p>₹${place.estimatedCostForTwo}</p>
        </div>
      `);

      const marker = new mapboxgl.Marker({
        color: isSelected ? "#facc15" : "#ef4444",
      })
        .setLngLat([place.lon, place.lat])
        .setPopup(popup)
        .addTo(map);

      // 🔁 Click sync
      marker.getElement().addEventListener("click", () => {
        onSelectPlace(place);
      });

      // ⭐ Auto-open popup if selected
      if (isSelected) {
        popup.addTo(map);
      }

      markersRef.current.push(marker);
    });
  }, [places, selectedPlace, userLocation, onSelectPlace]);

  // 🎯 Focus selected place
  useEffect(() => {
    if (!mapRef.current || !selectedPlace) return;

    mapRef.current.flyTo({
      center: [selectedPlace.lon, selectedPlace.lat],
      zoom: 15,
      essential: true,
    });
  }, [selectedPlace]);

  return (
    <div
      ref={mapContainer}
      className="w-full h-[400px] rounded-xl mb-6 cursor-grab active:cursor-grabbing"
    />
  );
}
"use client"

import { useEffect, useState } from "react"
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"

// Fix Leaflet's default icon path issues
const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
})

function LocationMarker({ position, setPosition }: { position: { lat: number, lng: number } | null, setPosition: (pos: { lat: number, lng: number }) => void }) {
  useMapEvents({
    click(e) {
      setPosition({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })

  return position === null ? null : (
    <Marker position={position} icon={icon} />
  )
}

interface MapComponentProps {
  initialPosition: { lat: number, lng: number } | null
  onLocationSelect: (location: { lat: number, lng: number }) => void
}

export default function MapComponent({ initialPosition, onLocationSelect }: MapComponentProps) {
  const [position, setPosition] = useState<{ lat: number, lng: number } | null>(initialPosition)
  
  // Riyadh center coordinates as default fallback
  const center = initialPosition || { lat: 24.7136, lng: 46.6753 }

  useEffect(() => {
    if (position) {
      onLocationSelect(position)
    }
  }, [position, onLocationSelect])

  return (
    <MapContainer 
      center={center} 
      zoom={11} 
      style={{ height: "100%", width: "100%", zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <LocationMarker position={position} setPosition={setPosition} />
    </MapContainer>
  )
}

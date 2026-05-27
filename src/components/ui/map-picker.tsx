"use client"

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'

function MapLoadingFallback() {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
      <Loader2 className="animate-spin mr-2" size={24} />
      <p>{t("map_loading")}</p>
    </div>
  )
}

// Dynamically import the MapComponent with SSR disabled
const DynamicMap = dynamic(
  () => import('./map-component'),
  { 
    ssr: false,
    loading: MapLoadingFallback
  }
)

interface MapPickerProps {
  initialPosition: { lat: number, lng: number } | null
  onLocationSelect: (location: { lat: number, lng: number }) => void
  className?: string
}

export function MapPicker({ initialPosition, onLocationSelect, className = "h-64 w-full rounded-xl overflow-hidden" }: MapPickerProps) {
  return (
    <div className={className}>
      <DynamicMap initialPosition={initialPosition} onLocationSelect={onLocationSelect} />
    </div>
  )
}

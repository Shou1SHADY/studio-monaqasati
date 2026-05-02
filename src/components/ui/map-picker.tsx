"use client"

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

// Dynamically import the MapComponent with SSR disabled
const DynamicMap = dynamic(
  () => import('./map-component'),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-slate-50 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={24} />
        <p>جاري تحميل الخريطة...</p>
      </div>
    )
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

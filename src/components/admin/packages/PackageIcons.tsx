"use client"

import type { ElementType } from "react"
import { Building2, ShoppingCart, Warehouse, Wallet, Wrench } from "lucide-react"
import { CONNECTORS, type PackageFlags } from "@/lib/procurement/package"
import type { PipelineUnit } from "@/lib/procurement/package-data"
import { COMPONENT_ACCENT_CLASSES, type AccentToken } from "@/lib/portal-components"
import { cn } from "@/lib/utils"

export const UNIT_ICON: Record<PipelineUnit, ElementType> = { core: ShoppingCart, inv: Warehouse, pm: Building2, fin: Wallet, mfg: Wrench }
export const UNIT_TOKEN: Record<PipelineUnit, AccentToken> = { core: "teal", inv: "accent", pm: "pm", fin: "success", mfg: "warning" }

export function UnitIcon({ unit, on = true, className }: { unit: PipelineUnit; on?: boolean; className?: string }) {
  const Icon = UNIT_ICON[unit]
  return (
    <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", on ? COMPONENT_ACCENT_CLASSES[UNIT_TOKEN[unit]].tile : "bg-muted text-muted-foreground/60", className)}>
      <Icon size={15} aria-hidden="true" />
    </span>
  )
}

/** The package at a glance: the two base units, a separator, then the three connectors (grey when closed). */
export function PackageChips({ pkg, labels }: { pkg: PackageFlags; labels: Record<PipelineUnit, string> }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={CONNECTORS.filter((c) => pkg[c]).map((c) => labels[c]).join(" + ") || labels.core}>
      <UnitIcon unit="core" />
      <UnitIcon unit="inv" />
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      {CONNECTORS.map((c) => (
        <UnitIcon key={c} unit={c} on={pkg[c]} />
      ))}
    </span>
  )
}

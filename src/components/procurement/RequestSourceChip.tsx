"use client"

// Where an incoming request came from — Projects · the team · the workshop · the stores — with its icon and in its module's own
// colour (the prototype's `srcChip`), read from the registry like `SourceBadge`, so the chip never disagrees with the module's tile.
// The team has no module: its chip stays neutral.

import type { ElementType } from "react"
import { useTranslations } from "next-intl"
import { Boxes, Factory, FolderKanban, Users } from "lucide-react"
import { COMPONENT_ACCENT_CLASSES, CONTRACTOR_COMPONENTS, type PortalComponentId } from "@/lib/portal-components"
import type { NeedKind } from "@/lib/procurement/needs"
import { cn } from "@/lib/utils"

export const SOURCE_ICON: Record<NeedKind, ElementType> = { mfg: Factory, project: FolderKanban, stock: Boxes, team: Users }
const SOURCE_MODULE: Record<NeedKind, PortalComponentId | null> = { project: "project-management", mfg: "manufacturing", stock: "warehouses", team: null }

export function sourceTone(kind: NeedKind): string {
  const module = SOURCE_MODULE[kind]
  const accent = module ? CONTRACTOR_COMPONENTS.find((c) => c.id === module)?.accentToken : null
  return accent ? COMPONENT_ACCENT_CLASSES[accent].tile : "bg-muted text-muted-foreground"
}

export function RequestSourceChip({ kind, className }: { kind: NeedKind; className?: string }) {
  const t = useTranslations("Portal.Shared")
  const Icon = SOURCE_ICON[kind]
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold", sourceTone(kind), className)} data-testid={`source-${kind}`}>
      <Icon size={11} aria-hidden="true" />
      {t(`pri_from_${kind}`)}
    </span>
  )
}

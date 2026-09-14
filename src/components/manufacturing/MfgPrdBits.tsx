"use client"

// Small pieces shared by the product cards, the product drawer, the new-product
// form and the production lines in Settings: a family's icon, a route as chips,
// the blocking flags, and the tone a queue length earns.

import type { ElementType } from "react"
import { useTranslations } from "next-intl"
import { AppWindow, Eye, Mountain, Package, PencilRuler, Ruler, TreePine, Wrench } from "lucide-react"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { MfgFamily, MfgProduct, MfgRouteStep } from "@/lib/manufacturing-engine"
import { MfgChip, departmentIcon, type MfgTone } from "./ui/MfgUi"

export const MFG_FAMILIES: MfgFamily[] = ["stone", "wood", "aluminium", "steel", "other"]

const FAMILY_ICONS: Record<MfgFamily, ElementType> = {
  stone: Mountain,
  wood: TreePine,
  aluminium: AppWindow,
  steel: Wrench,
  other: Package,
}

export function familyIcon(family: MfgFamily | null | undefined): ElementType {
  return (family && FAMILY_ICONS[family]) || Package
}

/** A department's current name — a renamed department shows its new name on
 * every card that routes through it; the step keeps the old one as fallback. */
export function stepName(departments: MfgDepartment[], step: Pick<MfgRouteStep, "departmentId" | "departmentName">): string {
  return departments.find((d) => d.id === step.departmentId)?.name || step.departmentName
}

/** Queue days → tone: under a day and a half is fine, over three is the bottleneck zone. */
export function queueTone(days: number): Extract<MfgTone, "ok" | "warn" | "bad"> {
  return days > 3 ? "bad" : days > 1.5 ? "warn" : "ok"
}

export function MfgPrdRouteChips({ route, departments }: { route: MfgRouteStep[]; departments: MfgDepartment[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {route.map((step, i) => {
        const dept = departments.find((d) => d.id === step.departmentId)
        const Icon = departmentIcon(stepName(departments, step), step.onSite || dept?.onSite)
        return (
          <MfgChip key={`${step.departmentId}_${i}`} tone="muted" icon={Icon}>
            {stepName(departments, step)}
          </MfgChip>
        )
      })}
    </span>
  )
}

export function MfgPrdFlags({ product }: { product: Pick<MfgProduct, "requiresMeasurement" | "requiresDrawingApproval" | "requiresSlabApproval"> }) {
  const t = useTranslations("Portal.Shared")
  if (!product.requiresMeasurement && !product.requiresDrawingApproval && !product.requiresSlabApproval) return null
  return (
    <span className="flex flex-wrap gap-1">
      {product.requiresMeasurement && (
        <MfgChip tone="warn" icon={Ruler}>
          {t("mfg2_flag_measurement")}
        </MfgChip>
      )}
      {product.requiresDrawingApproval && (
        <MfgChip tone="info" icon={PencilRuler}>
          {t("mfg2_flag_drawing")}
        </MfgChip>
      )}
      {product.requiresSlabApproval && (
        <MfgChip tone="accent" icon={Eye}>
          {t("mfg2_flag_slab")}
        </MfgChip>
      )}
    </span>
  )
}

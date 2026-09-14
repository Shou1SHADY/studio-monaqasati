"use client"

// Small pieces shared by the product list, the product panel, the product form
// and Settings: a route as chips (a step without standard time marked "·?"
// while time is on — PC-03), the blocking flags, a station's current name, the
// tone a queue earns, and who uses a station.

import { useTranslations } from "next-intl"
import { Eye, PencilRuler, Ruler } from "lucide-react"
import type { MfgDepartment } from "@/lib/manufacturing"
import { effectiveRoute, round2, stationGate, type MfgProduct, type MfgRouteStep } from "@/lib/manufacturing-engine"
import type { OrderView } from "@/lib/manufacturing-view"
import { MfgChip, departmentIcon, type MfgTone } from "./ui/MfgUi"

/** Stone products are measured in square or linear metres (PC-05). */
export const STONE_UNITS = ["m²", "m"] as const

/** A station's current name — a renamed station shows its new name on every
 * card that routes through it; the step keeps the old one as a fallback. */
export function stepName(departments: Array<Pick<MfgDepartment, "id" | "name">>, step: Pick<MfgRouteStep, "departmentId" | "departmentName">): string {
  return departments.find((d) => d.id === step.departmentId)?.name || step.departmentName
}

/** Queue days → tone: under a day and a half is fine, over three is the bottleneck zone. */
export function queueTone(days: number): Extract<MfgTone, "ok" | "warn" | "bad"> {
  return days > 3 ? "bad" : days > 1.5 ? "warn" : "ok"
}

/** Standard hours per unit over the estimated steps, and how many are not estimated. */
export function productTime(product: Pick<MfgProduct, "route">): { hours: number; unestimated: number } {
  const route = effectiveRoute(product)
  return {
    hours: round2(route.reduce((a, r) => a + (r.hoursPerUnit ?? 0), 0)),
    unestimated: route.filter((r) => r.hoursPerUnit == null).length,
  }
}

/** Live orders on a product lock its route order (times stay editable). */
export function liveOrdersOn(productId: string, views: OrderView[]): number {
  return views.filter((v) => v.product.id === productId && v.live).length
}

/** Where a station is used: orders holding quantity there now, and product routes through it. */
export function stationUsage(departmentId: string, views: OrderView[], products: Array<Pick<MfgProduct, "route" | "archived">>): { ordersInHand: number; routes: number } {
  const ordersInHand = views.filter((v) => v.live && v.calc.route.some((r, i) => r.departmentId === departmentId && (v.calc.pend[i] || 0) > 0)).length
  const routes = products.filter((p) => (p.route || []).some((r) => r.departmentId === departmentId)).length
  return { ordersInHand, routes }
}

export function MfgPrdRouteChips({ product, departments, timeOn }: { product: Pick<MfgProduct, "route">; departments: MfgDepartment[]; timeOn: boolean }) {
  const t = useTranslations("Portal.Shared")
  return (
    <span className="flex flex-wrap gap-1">
      {effectiveRoute(product).map((step, i) => {
        const name = stepName(departments, step)
        const Icon = departmentIcon(name)
        const missing = timeOn && step.hoursPerUnit == null
        return (
          <MfgChip key={`${step.departmentId}_${i}`} tone={missing ? "warn" : "muted"} icon={Icon}>
            <span dir="auto">{name}</span>
            {missing && <span title={t("mfr_prd_not_estimated")}> ·?</span>}
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
          {t("mfr_prd_flag_measure")}
        </MfgChip>
      )}
      {product.requiresDrawingApproval && (
        <MfgChip tone="info" icon={PencilRuler}>
          {t("mfr_prd_flag_drawing")}
        </MfgChip>
      )}
      {product.requiresSlabApproval && (
        <MfgChip tone="accent" icon={Eye}>
          {t("mfr_prd_flag_slab")}
        </MfgChip>
      )}
    </span>
  )
}

/** Whether a station is an order-level step (design, slab selection). */
export function isOrderLevel(dept: Pick<MfgDepartment, "name"> & { gate?: "drawing" | "slab" | null } | undefined): boolean {
  return !!stationGate(dept)
}

"use client"

// The supplier plan the layout read once (SupplierPlanFrame provides it for both plans), and the portal registry
// that plan shapes. Every piece of the portal frame — sidebar, active module, breadcrumbs, app switcher, module gate,
// home — asks these, so a free supplier's Invoices & transfers sit under Order Management everywhere at once.
// Outside the supplier layout (a contractor, a test) there is no plan: the full registry.

import { createContext, useContext } from "react"
import { supplierRegistry, type ModulePortal } from "@/lib/company-modules"
import { CONTRACTOR_COMPONENTS, type PortalComponentDef } from "@/lib/portal-components"
import type { SupplierPlan } from "@/lib/supplier-plan"

export interface PlanState {
  plan: SupplierPlan
  loading: boolean
  orgId: string | null
}

/** The plan the supplier layout already read: every page under it reads this one answer instead of subscribing again,
 * so moving between pages never flashes a loader inside the frame. */
export const SupplierPlanContext = createContext<PlanState | null>(null)

/** The plan from the layout, or null outside it. */
export const usePlanContext = () => useContext(SupplierPlanContext)

/** The supplier's plan as the frame should draw it: "full" outside the supplier layout. */
export function useSupplierPlanName(): SupplierPlan {
  return usePlanContext()?.plan ?? "full"
}

/** The portal's whole registry for this company's plan (before its module switches). */
export function usePortalRegistry(portal: ModulePortal | null): PortalComponentDef[] {
  const plan = useSupplierPlanName()
  if (portal === "supplier") return supplierRegistry(plan)
  return portal === "contractor" ? CONTRACTOR_COMPONENTS : []
}

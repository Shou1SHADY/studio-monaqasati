"use client"

import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { useSupplierPlan } from "@/hooks/useSupplierPlan"
import { SupplierPlanContext, usePlanContext, type PlanState } from "@/hooks/usePortalRegistry"

export { SupplierPlanContext, usePlanContext, type PlanState }

export function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
    </div>
  )
}

function Choose({ state, free, full }: { state: PlanState; free: ReactNode; full: ReactNode }) {
  if (state.loading) return <Splash />
  return <>{state.plan === "free" ? free : full}</>
}

/** Outside the supplier layout (a test, a stray mount): read the plan here. */
function StandaloneSwitch({ free, full }: { free: ReactNode; full: ReactNode }) {
  const state = useSupplierPlan()
  return <Choose state={state} free={free} full={full} />
}

/** One address, two journeys: the free account's page or the full portal's, by the company's plan. */
export function PlanSwitch({ free, full }: { free: ReactNode; full: ReactNode }) {
  const ctx = usePlanContext()
  if (!ctx) return <StandaloneSwitch free={free} full={full} />
  return <Choose state={ctx} free={free} full={full} />
}

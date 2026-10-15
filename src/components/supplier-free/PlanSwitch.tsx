"use client"

import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { useSupplierPlan } from "@/hooks/useSupplierPlan"

export function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
    </div>
  )
}

/** One address, two journeys: the free account's page or the full portal's, by the company's plan. */
export function PlanSwitch({ free, full }: { free: ReactNode; full: ReactNode }) {
  const { plan, loading } = useSupplierPlan()
  if (loading) return <Splash />
  return <>{plan === "free" ? free : full}</>
}

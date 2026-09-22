"use client"

import { Suspense } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementReports } from "@/components/procurement/ProcurementReports"

export default function ProcurementReportsPage() {
  return (
    <PortalLayout>
      {/* useSearchParams needs a boundary for the static shell. */}
      <Suspense fallback={null}>
        <ProcurementReports />
      </Suspense>
    </PortalLayout>
  )
}

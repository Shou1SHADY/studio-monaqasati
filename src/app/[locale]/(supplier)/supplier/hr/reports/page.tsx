"use client"

import { Suspense } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { HrReportsView } from "@/components/hr/HrReportsView"
import { HrShell } from "@/components/hr/HrShell"

export default function HrReportsPage() {
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="reports">
        {(access) => (
          // useSearchParams needs a boundary for the static shell.
          <Suspense fallback={null}>
            <HrReportsView access={access} />
          </Suspense>
        )}
      </HrShell>
    </PortalLayout>
  )
}

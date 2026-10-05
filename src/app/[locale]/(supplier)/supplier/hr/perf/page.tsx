"use client"

import { Suspense } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { HrShell } from "@/components/hr/HrShell"
import { HrGrowthView } from "@/components/hr/HrGrowthView"
import { useHrGrowthKpis } from "@/hooks/useHrGrowthKpis"
import { usePermissions } from "@/hooks/usePermissions"
import { useUser } from "@/firebase"

function Page() {
  const { profile } = usePermissions()
  const { user } = useUser()
  return (
    <PortalLayout>
      <HrShell portal="supplier" tab="perf" useKpis={useHrGrowthKpis}>
        {(access) => <HrGrowthView access={access} portal="supplier" actor={{ uid: user?.uid ?? "", name: (profile?.name as string) || null }} />}
      </HrShell>
    </PortalLayout>
  )
}

export default function HrGrowthPage() {
  // The segment (?seg=train) is read from the URL: a boundary for the static shell.
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { ProcurementToday } from "@/components/procurement/ProcurementToday"

export default function ProcurementTodayPage() {
  return (
    <PortalLayout>
      <ProcurementToday />
    </PortalLayout>
  )
}

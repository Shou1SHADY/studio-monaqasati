"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { MyActivities } from "@/components/activities/MyActivities"

export default function SupplierActivitiesPage() {
  return (
    <PortalLayout>
      <MyActivities portal="supplier" />
    </PortalLayout>
  )
}

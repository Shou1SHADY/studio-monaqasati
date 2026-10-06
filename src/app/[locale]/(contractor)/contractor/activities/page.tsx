"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { MyActivities } from "@/components/activities/MyActivities"

export default function ContractorActivitiesPage() {
  return (
    <PortalLayout>
      <MyActivities portal="contractor" />
    </PortalLayout>
  )
}

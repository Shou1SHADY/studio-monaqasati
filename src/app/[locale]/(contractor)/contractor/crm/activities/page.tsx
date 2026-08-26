"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmActivitiesView } from "@/components/crm/CrmActivitiesView"

export default function ContractorCrmActivitiesPage() {
  return (
    <PortalLayout>
      <CrmActivitiesView portal="contractor" />
    </PortalLayout>
  )
}

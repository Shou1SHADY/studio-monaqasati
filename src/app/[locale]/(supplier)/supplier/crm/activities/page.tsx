"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmActivitiesView } from "@/components/crm/CrmActivitiesView"

export default function SupplierCrmActivitiesPage() {
  return (
    <PortalLayout>
      <CrmActivitiesView portal="supplier" />
    </PortalLayout>
  )
}

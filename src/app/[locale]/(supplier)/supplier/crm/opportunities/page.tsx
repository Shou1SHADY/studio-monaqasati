"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmOpportunitiesView } from "@/components/crm/CrmOpportunitiesView"

export default function SupplierOpportunitiesPage() {
  return (
    <PortalLayout>
      <CrmOpportunitiesView portal="supplier" />
    </PortalLayout>
  )
}

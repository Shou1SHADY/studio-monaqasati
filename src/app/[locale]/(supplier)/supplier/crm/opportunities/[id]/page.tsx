"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmOpportunityDetailView } from "@/components/crm/CrmOpportunityDetailView"

export default function SupplierOpportunityDetailPage() {
  return (
    <PortalLayout>
      <CrmOpportunityDetailView portal="supplier" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmOpportunityDetailView } from "@/components/crm/CrmOpportunityDetailView"

export default function ContractorOpportunityDetailPage() {
  return (
    <PortalLayout>
      <CrmOpportunityDetailView portal="contractor" />
    </PortalLayout>
  )
}

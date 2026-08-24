"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmOpportunitiesView } from "@/components/crm/CrmOpportunitiesView"

export default function ContractorOpportunitiesPage() {
  return (
    <PortalLayout>
      <CrmOpportunitiesView portal="contractor" />
    </PortalLayout>
  )
}

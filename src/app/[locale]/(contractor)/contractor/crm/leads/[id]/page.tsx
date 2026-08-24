"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmLeadDetailView } from "@/components/crm/CrmLeadDetailView"

export default function ContractorLeadDetailPage() {
  return (
    <PortalLayout>
      <CrmLeadDetailView portal="contractor" />
    </PortalLayout>
  )
}

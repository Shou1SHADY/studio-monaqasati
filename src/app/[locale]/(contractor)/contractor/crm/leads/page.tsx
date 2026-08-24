"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmLeadsView } from "@/components/crm/CrmLeadsView"

export default function ContractorLeadsPage() {
  return (
    <PortalLayout>
      <CrmLeadsView portal="contractor" />
    </PortalLayout>
  )
}

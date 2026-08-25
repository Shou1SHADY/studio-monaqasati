"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmRfqsView } from "@/components/crm/CrmRfqsView"

export default function ContractorRfqsPage() {
  return (
    <PortalLayout>
      <CrmRfqsView portal="contractor" />
    </PortalLayout>
  )
}

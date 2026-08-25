"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmRfqsView } from "@/components/crm/CrmRfqsView"

export default function SupplierRfqsPage() {
  return (
    <PortalLayout>
      <CrmRfqsView portal="supplier" />
    </PortalLayout>
  )
}

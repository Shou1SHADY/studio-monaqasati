"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmLeadsView } from "@/components/crm/CrmLeadsView"

export default function SupplierLeadsPage() {
  return (
    <PortalLayout>
      <CrmLeadsView portal="supplier" />
    </PortalLayout>
  )
}

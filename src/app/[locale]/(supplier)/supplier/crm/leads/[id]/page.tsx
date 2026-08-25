"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmLeadDetailView } from "@/components/crm/CrmLeadDetailView"

export default function SupplierLeadDetailPage() {
  return (
    <PortalLayout>
      <CrmLeadDetailView portal="supplier" />
    </PortalLayout>
  )
}

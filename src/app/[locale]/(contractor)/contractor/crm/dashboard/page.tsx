"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { CrmDashboardView } from "@/components/crm/CrmDashboardView"

export default function ContractorCrmDashboardPage() {
  return (
    <PortalLayout>
      <CrmDashboardView portal="contractor" />
    </PortalLayout>
  )
}

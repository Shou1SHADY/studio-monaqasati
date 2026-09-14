"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AuditTrailView } from "@/components/accounting/AccountingViews"

export default function ContractorAccountingAuditTrailPage() {
  return (
    <PortalLayout>
      <AuditTrailView portal="contractor" />
    </PortalLayout>
  )
}

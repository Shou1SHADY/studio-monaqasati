"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AuditTrailView } from "@/components/accounting/AccountingViews"

export default function SupplierAccountingAuditTrailPage() {
  return (
    <PortalLayout>
      <AuditTrailView portal="supplier" />
    </PortalLayout>
  )
}

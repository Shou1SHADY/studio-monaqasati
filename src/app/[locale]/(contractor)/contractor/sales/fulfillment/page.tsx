"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { SalesFulfillmentView } from "@/components/sales/SalesFulfillmentView"

export default function ContractorSalesFulfillmentPage() {
  return (
    <PortalLayout>
      <SalesFulfillmentView portal="contractor" />
    </PortalLayout>
  )
}

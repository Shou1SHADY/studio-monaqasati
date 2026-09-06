"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PriceListView } from "@/components/sales/PriceListView"

export default function ContractorPriceListPage() {
  return (
    <PortalLayout>
      <PriceListView portal="contractor" />
    </PortalLayout>
  )
}

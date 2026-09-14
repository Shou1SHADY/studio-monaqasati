"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { MfgInventoryDesk } from "@/components/inventory/MfgInventoryDesk"

export default function ContractorInventoryManufacturingDeskPage() {
  return (
    <PortalLayout>
      <MfgInventoryDesk portal="contractor" />
    </PortalLayout>
  )
}

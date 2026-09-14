"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { MfgInventoryDesk } from "@/components/inventory/MfgInventoryDesk"

export default function SupplierInventoryManufacturingDeskPage() {
  return (
    <PortalLayout>
      <MfgInventoryDesk portal="supplier" />
    </PortalLayout>
  )
}

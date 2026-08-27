"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { StandaloneWasteView } from "@/components/inventory/StandaloneWasteView"

export default function SupplierWastePage() {
  return (
    <PortalLayout>
      <StandaloneWasteView portal="supplier" />
    </PortalLayout>
  )
}

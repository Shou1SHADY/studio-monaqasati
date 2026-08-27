"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { StandaloneWasteView } from "@/components/inventory/StandaloneWasteView"

export default function ContractorWastePage() {
  return (
    <PortalLayout>
      <StandaloneWasteView portal="contractor" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { DeliveryNotesView } from "@/components/inventory/DeliveryNotesView"

export default function ContractorDeliveryNotesPage() {
  return (
    <PortalLayout>
      <DeliveryNotesView portal="contractor" />
    </PortalLayout>
  )
}

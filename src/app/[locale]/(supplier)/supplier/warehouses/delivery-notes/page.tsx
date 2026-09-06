"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { DeliveryNotesView } from "@/components/inventory/DeliveryNotesView"

export default function SupplierDeliveryNotesPage() {
  return (
    <PortalLayout>
      <DeliveryNotesView portal="supplier" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PurchaseRequestsInbox } from "@/components/contractor/PurchaseRequestsInbox"

export default function PurchaseRequestsPage() {
  return (
    <PortalLayout>
      <PurchaseRequestsInbox />
    </PortalLayout>
  )
}

"use client"

import { Suspense } from "react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { PurchaseRequestsInbox } from "@/components/contractor/PurchaseRequestsInbox"

export default function PurchaseRequestsPage() {
  return (
    <PortalLayout>
      <Suspense fallback={null}>
        <PurchaseRequestsInbox />
      </Suspense>
    </PortalLayout>
  )
}

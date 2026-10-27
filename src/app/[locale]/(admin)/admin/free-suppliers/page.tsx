"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { FreeSuppliersView } from "@/components/admin/free-suppliers/FreeSuppliersView"

export default function AdminFreeSuppliersPage() {
  return (
    <PortalLayout>
      <FreeSuppliersView />
    </PortalLayout>
  )
}

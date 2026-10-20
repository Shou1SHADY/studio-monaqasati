"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { AdminMaterialsView } from "@/components/admin/materials/AdminMaterialsView"

export default function AdminMaterialsPage() {
  return (
    <PortalLayout>
      <AdminMaterialsView />
    </PortalLayout>
  )
}

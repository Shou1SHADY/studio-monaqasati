"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { DocumentLibrary } from "@/components/documents/DocumentLibrary"

export default function SupplierDocumentsPage() {
  return (
    <PortalLayout>
      <DocumentLibrary portal="supplier" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { DocumentLibrary } from "@/components/documents/DocumentLibrary"

export default function ContractorDocumentsPage() {
  return (
    <PortalLayout>
      <DocumentLibrary portal="contractor" />
    </PortalLayout>
  )
}

"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { PipelineContractPage } from "@/components/admin/packages/PipelineContractPage"

export default function AdminPipelinePage() {
  return (
    <PortalLayout>
      <PipelineContractPage />
    </PortalLayout>
  )
}

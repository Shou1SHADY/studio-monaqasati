"use client"

import { useParams } from "next/navigation"
import { ContractorPackagePreview } from "@/components/admin/packages/ContractorPackagePreview"

export default function AdminContractorPackagePreviewPage() {
  const params = useParams()
  return <ContractorPackagePreview orgId={params.orgId as string} />
}

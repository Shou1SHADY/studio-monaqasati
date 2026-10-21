"use client"

import { useParams } from "next/navigation"
import { ContractorPackagePage } from "@/components/admin/packages/ContractorPackagePage"

export default function AdminContractorPackagePage() {
  const params = useParams()
  return <ContractorPackagePage orgId={params.orgId as string} />
}

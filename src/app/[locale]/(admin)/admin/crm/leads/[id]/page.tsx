"use client"

import { useParams } from "next/navigation"
import { LeadFile } from "@/components/admin/crm/LeadFile"

export default function AdminCrmLeadPage() {
  const params = useParams<{ id: string }>()
  return <LeadFile crmId={decodeURIComponent(params.id)} />
}

"use client"

import { useParams } from "next/navigation"
import { ClientFile } from "@/components/admin/crm/ClientFile"

export default function AdminCrmCustomerPage() {
  const params = useParams<{ id: string }>()
  return <ClientFile clientId={decodeURIComponent(params.id)} />
}

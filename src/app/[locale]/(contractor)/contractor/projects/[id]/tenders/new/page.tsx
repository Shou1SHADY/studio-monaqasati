"use client"

import { useParams } from "next/navigation"
import { RfqForm } from "@/components/contractor/RfqForm"

export default function NewTenderPage() {
  const params = useParams()
  const projectId = params.id as string
  return <RfqForm projectId={projectId} />
}

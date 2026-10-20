"use client"

import { useParams } from "next/navigation"
import { RfqEditorPage } from "@/components/procurement/rfq-editor/RfqEditorPage"

// A project's RFQ: the same editor, its group fixed to the project.
export default function NewTenderPage() {
  const params = useParams()
  return <RfqEditorPage projectId={params.id as string} />
}

"use client"

import { useParams } from "next/navigation"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"

// The RFQ's one page (Procurement 1.5, PUR-09 #5) — with or without a project, with Project
// Management on or off. Before 20 Oct 2026 a project's RFQ redirected to its tender route.
export default function RfqOffersPage() {
  const params = useParams()
  return <RfqOffersView rfqId={params.id as string} />
}

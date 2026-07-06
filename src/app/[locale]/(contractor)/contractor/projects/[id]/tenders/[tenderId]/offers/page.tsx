"use client"

import { useParams } from "next/navigation"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"

export default function RfqOffersPage() {
  const params = useParams()
  const rfqId = params.tenderId as string
  return <RfqOffersView rfqId={rfqId} />
}

"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { LinkPreview } from "@/components/procurement/rfq/LinkPreview"

// The buyer's preview of the visitor link. It lives under the RFQ it previews and reads through an authenticated route.
export default function RfqLinkPreviewPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <Suspense fallback={null}>
      <LinkPreview rfqId={id} />
    </Suspense>
  )
}

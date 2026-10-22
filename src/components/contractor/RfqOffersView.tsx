"use client"

import { RfqPage } from "@/components/procurement/rfq/RfqPage"

// The RFQ's one page, for both routes (`/contractor/rfqs/{id}/offers` and the project-scoped address that forwards to it): the
// route hands over the id, the page is `RfqPage`.
export function RfqOffersView({ rfqId }: { rfqId: string }) {
  return <RfqPage rfqId={rfqId} />
}

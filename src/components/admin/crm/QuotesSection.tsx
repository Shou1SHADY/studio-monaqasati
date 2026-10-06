"use client"

import { CrmDeals } from "@/components/admin/CrmDeals"

/** The price quotes given to a lead or client (ADM-05). They live in the platform CRM's deals collection; the opportunity itself is part of the lead, not a section of its own (ADM-07). */
export function QuotesSection({ recordId, alsoIds, author }: { recordId: string; alsoIds?: string[]; author: { uid: string; name: string } }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <CrmDeals clientId={recordId} alsoIds={alsoIds} author={author} kinds={["quote"]} />
    </section>
  )
}

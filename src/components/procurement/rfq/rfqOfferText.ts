"use client"

// Small readers the RFQ page's pieces share: «for (project)» under a line, how an offer asks to be paid, and a lead time.

import { useTranslations } from "next-intl"
import { lineForKey, termsOf, type RfqOfferView, type RfqView } from "./rfqOfferView"

/** «for (project)» under a line: its own project, the RFQ's, the workshop, or general stock. */
export function useLineFor(rfq: RfqView, projectName: string | null) {
  const tp = useTranslations("Portal.Procurement")
  return (index: number): string => {
    const f = lineForKey(rfq, index)
    if (f.kind === "workshop") return tp("rfqpo.list.workshop")
    if (f.kind === "general") return tp("rfqx.details.for_general")
    return f.name || (f.id === rfq.projectId ? projectName : null) || tp("rfqpo.list.project_unknown")
  }
}

export function useTermsText() {
  const t = useTranslations("Portal.Procurement.rfqd")
  return (o: Pick<RfqOfferView, "advancePercent" | "creditDays" | "paymentTerms">): string | null => {
    const terms = termsOf(o)
    if (!terms) return null
    if (terms.key === "advance") return t("terms.advance", { percent: terms.percent, days: terms.days })
    if (terms.key === "credit") return t("terms.credit", { days: terms.days })
    if (terms.key === "cash") return t("terms.cash")
    return terms.text
  }
}

"use client"

// The tags an offer carries (RFQ-05/07, §8 «العرض»): one word per state, the same in the row, the panel and the comparison.

import { useTranslations } from "next-intl"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useDateText } from "@/components/procurement/PoBits"
import type { OfferTagCode } from "@/lib/procurement/offer-labels"
import type { OfferRowModel } from "@/lib/procurement/rfq-offers-view"

const TONE: Record<OfferTagCode, PillTone> = {
  awarded: "ok",
  excluded: "bad",
  shortlisted: "warn",
  bafo_asked: "info",
  bafo_lowered: "ok",
  reval_asked: "info",
  new_today: "module",
  updated: "info",
  version: "mute",
  differs_terms: "warn",
  whole_only: "mute",
  unregistered: "warn",
  expired: "bad",
}

export function OfferTags({ row }: { row: Pick<OfferRowModel, "tags"> }) {
  const t = useTranslations("Portal.Procurement.offerLabel")
  const date = useDateText()
  return (
    <>
      {row.tags.map((tag) => (
        <StatusPill key={tag.code} tone={TONE[tag.code]}>
          {tag.code === "bafo_lowered" && tag.value != null ? t("bafo_lowered_pct", { pct: tag.value }) : t(tag.code, { date: tag.code === "bafo_asked" ? date(String(tag.value || "")) : "", version: tag.value ?? "" })}
        </StatusPill>
      ))}
    </>
  )
}

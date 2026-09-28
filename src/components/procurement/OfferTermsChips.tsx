"use client"

// An offer's commercial terms on its card (R-16): delivered or ex-works, the
// advance and the credit, and its validity — red once two days or less are
// left, because an award after it lapses is a new negotiation. Absent fields
// say nothing — except that an offer which stated its terms (the current
// forms always say delivered/ex-works) and gave no credit reads «نقداً مقدّماً»,
// and one that stated them without a validity reads «بلا تاريخ صلاحية».

import { useTranslations } from "next-intl"
import { StatusPill } from "@/components/module-ui/StatusPill"

type Terms = { priceBasis?: unknown; validUntil?: unknown; advancePercent?: unknown; creditDays?: unknown }

export function OfferTermsChips({ offer, now }: { offer: unknown; now: Date }) {
  const t = useTranslations("Portal.Procurement")
  const tx = useTranslations("Portal.Procurement.rfqx")
  const o = (offer || {}) as Terms
  const adv = Number(o.advancePercent)
  const credit = Number(o.creditDays)
  const valid = typeof o.validUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.validUntil) ? o.validUntil : null
  const today = now.toISOString().slice(0, 10)
  const daysLeft = valid ? Math.round((Date.parse(`${valid}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null
  return (
    <>
      {(o.priceBasis === "site" || o.priceBasis === "exw") && <StatusPill tone={o.priceBasis === "exw" ? "warn" : "mute"} className="text-[10px]">{t(`rfqpo.terms.basis_${o.priceBasis}`)}</StatusPill>}
      {adv > 0 && (
        <StatusPill tone="info" className="text-[10px]">
          {t("rfqpo.terms.chip_advance", { pct: adv, days: credit > 0 ? credit : 0 })}
        </StatusPill>
      )}
      {!(adv > 0) && credit > 0 && (
        <StatusPill tone="mute" className="text-[10px]">
          {t("rfqpo.terms.chip_credit", { days: credit })}
        </StatusPill>
      )}
      {!(adv > 0) && !(credit > 0) && o.creditDays != null && Number.isFinite(credit) && (
        <StatusPill tone="warn" className="text-[10px]">
          {tx("terms.cash")}
        </StatusPill>
      )}
      {daysLeft === null && (o.priceBasis === "site" || o.priceBasis === "exw") && (
        <StatusPill tone="mute" className="text-[10px]">
          {tx("terms.no_validity")}
        </StatusPill>
      )}
      {daysLeft !== null && (
        <StatusPill tone={daysLeft <= 2 ? "bad" : "mute"} className="text-[10px]">
          {daysLeft < 0 ? t("rfqpo.terms.chip_expired") : t("rfqpo.terms.chip_valid", { days: daysLeft })}
        </StatusPill>
      )}
    </>
  )
}

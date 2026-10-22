"use client"

import { useLocale, useTranslations } from "next-intl"
import { CalendarDays, Clock, Coins, MapPin, Truck } from "lucide-react"
import { bareNumber } from "@/lib/supplier-free/derive"
import { riyadhDay } from "@/lib/hr/format"
import type { LinkRfqView } from "@/lib/procurement/rfq-share-view"
import { fmtDay, placeText, relativeDays, termsText } from "./link-format"

// One header (LNK-02): «طلب 2026/012», the request's name, and ONE line — when it closes, where (the city and the district,
// nothing finer), when it is needed, the payment, the delivery options — then the access note when the buyer left one.
export function LinkHead({ rfq }: { rfq: LinkRfqView }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const open = rfq.state === "open"
  const places = rfq.places.map((p) => placeText(p, locale)).join(" · ")
  const pay = termsText(rfq, t) || t("pay_default")
  const delivery = rfq.delivery ? [rfq.delivery.unload ? t(`deliv_unload_${rfq.delivery.unload}`) : "", rfq.delivery.slot ? t(`deliv_slot_${rfq.delivery.slot}`) : ""].filter(Boolean).join(" · ") : ""
  const closedDay = (rfq.closedAt || rfq.closeAt || "").slice(0, 10)
  return (
    <section className="space-y-2" aria-labelledby="link-title">
      {rfq.number && (
        <p className="text-xs font-semibold text-muted-foreground">
          {t("rfq_number", { no: bareNumber(rfq.number) })}
        </p>
      )}
      <h1 id="link-title" className="text-xl font-black leading-snug text-foreground" dir="auto">
        {rfq.title}
      </h1>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock size={13} aria-hidden="true" />
          {open ? (
            <>
              {t("head_closes")} <b className="text-foreground">{fmtDay(rfq.closeDay, locale)}</b> · {relativeDays(rfq.closeDay, riyadhDay(), t)}
            </>
          ) : (
            <>
              {t("head_closed")} <b className="text-foreground">{fmtDay(closedDay, locale)}</b>
            </>
          )}
        </span>
        {places && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={13} aria-hidden="true" />
            {places}
          </span>
        )}
        {rfq.needBy && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={13} aria-hidden="true" />
            {t("head_needed")} <b className="text-foreground">{fmtDay(rfq.needBy, locale)}</b>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Coins size={13} aria-hidden="true" />
          {pay}
        </span>
        {delivery && (
          <span className="inline-flex items-center gap-1">
            <Truck size={13} aria-hidden="true" />
            {delivery}
          </span>
        )}
      </p>
      {rfq.accessNote && (
        <p className="flex items-start gap-1.5 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground" dir="auto">
          <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {rfq.accessNote}
        </p>
      )}
    </section>
  )
}

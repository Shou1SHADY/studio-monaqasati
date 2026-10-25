"use client"

// What the request's panel says of where it stands (PUR-01, the prototype's `lnStates` and `reqStatusBlock`): the materials that
// already went into an RFQ or an order (or could not be bought) with a link to each, and — by the request's state — one sentence:
// in an RFQ and when it closes, in an order, withdrawn, could not be bought, complete, or prepared with a draft waiting.

import { useLocale, useTranslations } from "next-intl"
import { Fragment } from "react"
import { Link } from "@/i18n/routing"
import { Callout } from "@/components/module-ui/Callout"
import { fmtDay, qty } from "@/components/procurement/need-bits"
import { displayPoNumber } from "@/lib/procurement/format"
import type { RequestCard } from "@/lib/procurement/incoming-requests"

export function RequestStatusBlock({
  card,
  rfqDeadline,
  order,
}: {
  card: RequestCard
  /** The deadline of the RFQ the request is in. */
  rfqDeadline: string | null
  /** The order the request is in, as far as it is known: its supplier and its date. */
  order: { supplierName: string | null; dueDate: string | null } | null
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const rfq = card.rfqs[0]
  const po = card.orders[0]
  const day = (d: string | null | undefined) => (d ? fmtDay(d, locale) : "—")
  const held = card.rows.filter((r) => r.state === "rfq" || r.state === "po" || (r.state === "cx" && card.need.incoming?.lines[r.index]?.fail))
  const showHeld = held.length > 0 && (card.state === "new" || card.state === "prepared" || card.state === "partial")
  const sep = " · "

  return (
    <>
      {showHeld && (
        <Callout tone="info">
          {held.map((r, i) => (
            <Fragment key={r.key}>
              {i > 0 && sep}
              <span dir="auto">
                {r.name} <b className="tabular-nums" dir="ltr">{qty(r.total)}</b> {r.unit}:{" "}
              </span>
              {r.state === "rfq" && r.link?.rfqId ? (
                <Link href={`/contractor/rfqs/${r.link.rfqId}`} className="font-semibold text-module hover:underline">
                  {t("rq_ln_in_rfq")} {r.link.rfqNumber || ""}
                </Link>
              ) : r.state === "po" && r.link?.poId ? (
                <Link href={`/contractor/rfqs/orders?po=${r.link.poId}`} className="font-semibold text-module hover:underline">
                  {t("rq_ln_in_po")} {displayPoNumber(r.link.poNumber || "", locale)}
                </Link>
              ) : (
                t("rq_ln_failed")
              )}
            </Fragment>
          ))}
          . {t("rq_ln_rest")}
        </Callout>
      )}
      {card.state === "rfq" && rfq && <Callout tone="info">{t("rq_st_rfq", { rfq: rfq.number || "—", date: day(rfqDeadline) })}</Callout>}
      {card.state === "order" && po && (
        <Callout tone="info">
          {[t("rq_st_po", { po: displayPoNumber(po.number || "", locale) }), order?.supplierName, order?.dueDate ? t("rq_st_po_due", { date: day(order.dueDate) }) : ""].filter(Boolean).join(sep)}.
        </Callout>
      )}
      {card.state === "withdrawn" && <Callout tone="warn">{t("rq_st_wd", { name: card.withdrawal?.byName || "—", date: day(card.withdrawal?.on) })}</Callout>}
      {card.state === "failed" && card.failed && (
        <Callout tone="block">{card.failed.alt ? t("rq_failed_block", { why: card.failed.why, alt: card.failed.alt }) : t("rq_failed_block_noalt", { why: card.failed.why })}</Callout>
      )}
      {card.state === "done" && <Callout tone="info">{t("rq_st_done")}</Callout>}
      {card.state === "prepared" && <Callout tone="info">{t("rq_st_prep")}</Callout>}
    </>
  )
}

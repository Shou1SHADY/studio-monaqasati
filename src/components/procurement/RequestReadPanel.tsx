"use client"

// The WHOLE request, read only (Procurement 2.0, the prototype's `DRAW.req` + `reqStatusBlock` + `reqOpenBtn`): pressing a request
// that is in an RFQ, in an order, complete, could not be bought, withdrawn — or prepared into a draft — opens the request itself, not
// its first line. The head (number · state · source · «name · N مواد»), the facts (delivery place, need-by, who asked and who approved,
// the last day to order, the workshop's product, the stock it falls short of), every material with its state — each a door to its
// own line drawer — the status sentence, the open-RFQ / open-order / open-draft buttons, and the request's history.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { LINE_STATE_TONE, fmtDay, qty } from "@/components/procurement/need-bits"
import { RequestSourceChip } from "@/components/procurement/RequestSourceChip"
import { RequestStatusBlock } from "@/components/procurement/RequestStatusBlock"
import { RequestLogSection } from "@/components/procurement/RequestLogSection"
import { displayCity } from "@/lib/constants"
import { siteLine } from "@/lib/procurement/delivery-sites"
import { displayNeedRef } from "@/lib/procurement/format"
import type { RequestCard } from "@/lib/procurement/incoming-requests"
import { requestTone } from "@/lib/procurement/request-facts"

export function RequestReadPanel({
  card,
  rfqDeadline,
  order,
  canAct,
  onLine,
  onFail,
  extra,
}: {
  card: RequestCard
  rfqDeadline: string | null
  order: { supplierName: string | null; dueDate: string | null } | null
  /** May open the draft (the buyer who prepares; the reading owner may not). */
  canAct: boolean
  onLine: (rowKey: string) => void
  onFail?: () => void
  /** Anything the page shows under the status (the before-buying table on a live request). */
  extra?: ReactNode
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight
  const n = card.need
  const doc = n.incoming
  const ref = displayNeedRef(n.refLabel, locale)
  const where = doc ? siteLine(doc.place, (c) => displayCity(c, locale)) : ""
  const live = card.buyLines > 0 && (card.state === "new" || card.state === "prepared" || card.state === "partial")
  const ld = card.lastOrderIn
  const rfq = card.rfqs[0] ?? (n.rfqId ? { id: n.rfqId, number: n.rfqNumber } : null)
  const po = card.orders[0] ?? (n.poId ? { id: n.poId, number: n.poNumber } : null)
  const approvedLine = n.approved?.name || n.approved?.on ? (n.kind === "team" ? t("rq_approved_team", { name: n.approved?.name || "—", date: n.approved?.on ? fmtDay(n.approved.on, locale) : "—" }) : t("rq_approved", { date: n.approved?.on ? fmtDay(n.approved.on, locale) : "—" })) : ""

  return (
    <div className="space-y-4" data-testid="request-read-panel">
      <header className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-black text-foreground">
          <span dir="auto">{ref}</span>
          <StatusPill tone={requestTone(card.state)}>{t(`rq_state_${card.state}`)}</StatusPill>
          {card.remainder && <StatusPill tone="violet">{t("rq_remainder")}</StatusPill>}
          <RequestSourceChip kind={n.kind} />
        </h2>
        <p className="text-sm text-muted-foreground" dir="auto">
          {t("rq_ro_sub", { place: n.projectName || n.context || n.place?.label || t("nd_for_stock"), count: card.rows.length })}
        </p>
      </header>

      <div className="rounded-xl border bg-card px-4 py-1">
        {where && <KeyValueRow label={t("rq_ro_place")} value={where} />}
        <KeyValueRow label={t("rq_ro_need_by")} value={card.needBy ? fmtDay(card.needBy, locale) : "—"} />
        {n.requestedBy && <KeyValueRow label={t("rq_ro_by")} value={[n.requestedBy, approvedLine].filter(Boolean).join(" · ")} />}
        {live && ld != null && <KeyValueRow label={t("rq_ro_last_day")} value={ld < 0 ? t("nd_last_day_passed", { days: -ld }) : t("rq_last_day", { date: fmtDay(card.lastOrderDay, locale), days: ld })} />}
        {doc?.src === "mfg" && (doc.productName || doc.workOrderNo) && <KeyValueRow label={t("rq_ro_product")} value={[doc.productName, doc.workOrderNo ? t("rq_wo", { no: doc.workOrderNo }) : ""].filter(Boolean).join(" · ")} />}
        {n.kind === "stock" && n.stock && <KeyValueRow label={t("rq_ro_why")} value={t("rq_stock_why", { onHand: qty(n.stock.onHand), min: qty(n.stock.min) })} />}
      </div>

      <section aria-label={t("rq_ro_lines")} className="overflow-hidden rounded-xl border bg-card">
        <p className="border-b px-4 py-2 text-xs font-bold text-muted-foreground">{t("rq_ro_lines")}</p>
        <ul className="divide-y">
          {card.rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onLine(r.key)}
                className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-start text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={t("rq_line_open", { name: r.name })}
              >
                <span className="min-w-0 flex-1 font-semibold" dir="auto">
                  {r.name}
                </span>
                <span>
                  <b className="tabular-nums" dir="ltr">
                    {qty(r.total)}
                  </b>{" "}
                  <span className="text-xs text-muted-foreground">{r.unit}</span>
                </span>
                <StatusPill tone={LINE_STATE_TONE[r.state]}>{t(`nd_state_${r.state}`)}</StatusPill>
                <Chevron size={14} className="text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <RequestStatusBlock card={card} rfqDeadline={rfqDeadline} order={order} />
      {extra}

      <div className="flex flex-wrap items-center gap-2">
        {canAct && card.state === "prepared" && card.draftId && (
          <Button asChild size="sm">
            <Link href={`/contractor/rfqs/new?edit=${encodeURIComponent(card.draftId)}`}>{t("rq_open_draft")}</Link>
          </Button>
        )}
        {(card.state === "rfq" || card.state === "partial") && rfq && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/contractor/rfqs/${rfq.id}`}>{t("rq_open_rfq")}</Link>
          </Button>
        )}
        {(card.state === "order" || card.state === "partial" || card.state === "done") && po?.id && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/contractor/rfqs/orders?po=${po.id}`}>{t("rq_open_po")}</Link>
          </Button>
        )}
        {onFail && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onFail}>
            {t("rq_fail")}
          </Button>
        )}
      </div>

      {doc && <RequestLogSection doc={doc} />}
    </div>
  )
}

"use client"

// One request and one cost statement in the Requests list. A request card
// says who asked through which door, for what, by when, and whether it waits
// on us; the manager reads it in its drawer before answering. A cost statement
// card carries cost, lead time and validity only — and Sales' side of it,
// read-only. Its two actions belong to the cost controller (REQ-06).

import { useMemo, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Calculator, Check, Eye, RotateCcw, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { addDaysISO, estimateCost, type MfgCostEstimate } from "@/lib/manufacturing-engine"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import {
  estimateCostToday,
  estimateEarliestDays,
  estimateSentDays,
  estimateStatus,
  requestLines,
  salesQuoteState,
} from "@/lib/manufacturing-requests"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip } from "./MfgOrderBits"
import {
  DownPaymentChip,
  EstimateStatusPill,
  RequestRefs,
  RequestSourceChip,
  RequestStatePill,
  answerText,
  requestTitle,
  salesQuoteText,
  sourceIcon,
  useAgo,
  useSourceInfo,
} from "./MfgReqBits"
import { fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"

const HEADER_BUTTON =
  "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

export function MfgRequestCard({ request: r, onOpen }: { request: ManufacturingRequest; onOpen: () => void }) {
  const t = useTranslations("Portal.Shared")
  const { perms } = useMfgUi()
  const date = useMfgDate()
  const ago = useAgo()
  const info = useSourceInfo(r)!
  const Icon = sourceIcon(info)
  const isNew = r.status === "new"
  const lines = requestLines(r)

  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm" aria-label={requestTitle(r, info, t)}>
      <button type="button" onClick={onOpen} className={HEADER_BUTTON}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-foreground" dir="auto">
            {requestTitle(r, info, t)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            <RequestSourceChip info={info} />
            <b className="text-slate-700">{t(`mfr_kind_${info.kind}`)}</b>
            <RequestRefs info={info} />
            {r.note && (
              <span className="text-slate-700" dir="auto">
                · {r.note}
              </span>
            )}
            {r.requestedAt && <span>· {t("mfr_arrived", { when: ago(r.requestedAt) })}</span>}
            <span>· {t("mfr_needed", { date: date.short(r.neededBy) })}</span>
            <DownPaymentChip state={info.downPayment} />
          </span>
        </span>
        <span className="shrink-0">
          <RequestStatePill request={r} />
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="min-w-0 flex-1 text-[11px] text-muted-foreground" dir="auto">
          {lines.map((l, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {l.itemName} × <span dir="ltr" className="tabular-nums">{fmtQty(l.quantity)}</span> {l.unit}
            </span>
          ))}
        </span>
        {isNew && perms.canManage ? (
          <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={onOpen}>
            <Check size={13} aria-hidden="true" /> {t("mfr_read_answer")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-9 gap-1.5 text-xs" onClick={onOpen}>
            <Eye size={13} aria-hidden="true" /> {t("mfr_details")}
          </Button>
        )}
      </div>

      {!isNew && (
        <div className="border-t border-border/60 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
          <b className="font-semibold text-foreground" dir="auto">
            {answerText(r, t)}
          </b>
          {r.decidedByUserName && <> · {r.decidedByUserName}</>}
          {r.decidedAt && <> · {ago(r.decidedAt)}</>}
        </div>
      )}
    </article>
  )
}

export function MfgEstimateCard({ estimate: e, onOpen }: { estimate: MfgCostEstimate; onOpen?: () => void }) {
  const t = useTranslations("Portal.Shared")
  const ui = useMfgUi()
  const { data, perms, seesMoney, today, world } = ui
  const date = useMfgDate()
  const timeOn = data.settings.features.time
  const status = estimateStatus(e, today, data.settings)
  const quote = salesQuoteState(e)
  const sentDays = estimateSentDays(e, today)

  // A draft is shown at today's cards (what sending will write); a sent one as sent.
  const live = status === "draft"
  const costNow = useMemo(() => (live ? estimateCostToday(e, data.productById, data.departments, data.settings) : null), [live, e, data.productById, data.departments, data.settings])
  const lineCost = (i: number) => (live ? estimateCostToday({ lines: [e.lines[i]] }, data.productById, data.departments, data.settings).total : e.lines[i].totalCost)
  const total = costNow ? costNow.total : estimateCost(e)
  const readyDate = useMemo(() => {
    if (!timeOn) return null
    if (!live && e.earliestDays != null && e.sentAt) return addDaysISO(e.sentAt, e.earliestDays)
    const days = estimateEarliestDays(e, data.productById, world.calcs, data.departments, world.lost)
    return days == null ? null : addDaysISO(today, days)
  }, [timeOn, live, e, data.productById, data.departments, world.calcs, world.lost, today])

  const header = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
        <Calculator size={15} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-foreground" dir="auto">
          <span dir="ltr">{e.estimateNumber}</span> — {e.contactName || t("mfr_est_no_client")}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
          {e.note && (
            <span className="text-slate-700" dir="auto">
              {e.note} ·
            </span>
          )}
          {e.requestedBy && (
            <span>
              {t("mfr_requested_by")} <b className="text-slate-700">{e.requestedBy}</b> ·
            </span>
          )}
          <span>{t("mfr_needed", { date: date.short(e.neededBy) })}</span>
        </span>
      </span>
      <span className="shrink-0">
        <EstimateStatusPill status={status} />
      </span>
    </>
  )

  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm" aria-label={e.estimateNumber}>
      {onOpen ? (
        <button type="button" onClick={onOpen} className={HEADER_BUTTON}>
          {header}
        </button>
      ) : (
        <div className="flex items-start gap-3 border-b border-border/60 px-4 py-3">{header}</div>
      )}

      <dl className="divide-y divide-border/60 text-xs">
        {e.lines.map((l, i) => (
          <Row key={`${l.productId}_${i}`} label={<span dir="auto">{`${l.productName} × ${fmtQty(l.quantity)} ${l.unit}`}</span>}>
            {seesMoney ? <Money value={lineCost(i)} /> : null}
          </Row>
        ))}
        {seesMoney && (
          <Row label={<b className="text-foreground">{t("mfr_make_cost")}</b>} strong>
            <Money value={total} />
          </Row>
        )}
        {timeOn && readyDate && <Row label={t("mfr_earliest_ready")}>{date.short(readyDate)}</Row>}
        <Row label={t("mfr_validity")}>
          {t("mfr_validity_days", { days: e.validityDays || data.settings.estimateValidityDays })}
          {sentDays != null && <> · {t("mfr_sent_ago", { days: sentDays })}</>}
        </Row>
        <Row
          label={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {t("mfr_in_sales")} <MfgModuleChip module="sales" />
            </span>
          }
        >
          <span className="font-semibold text-slate-700">{salesQuoteText(quote, e.quoteNumber, e.salesOrderNumber, t)}</span>
        </Row>
      </dl>

      {perms.canCost && (status === "draft" || status === "expired") && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 px-4 py-2.5">
          {status === "expired" ? (
            <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={() => ui.openGlobal({ kind: "recalcEstimate", estimateId: e.id })}>
              <RotateCcw size={13} aria-hidden="true" /> {t("mfr_recalc_cta")}
            </Button>
          ) : (
            <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={() => ui.openGlobal({ kind: "sendEstimate", estimateId: e.id })}>
              <Send size={13} className="rtl-flip" aria-hidden="true" /> {t("mfr_send_cta")}
            </Button>
          )}
        </div>
      )}
    </article>
  )
}

function Row({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 py-2", strong && "bg-muted/20")}>
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className={cn("shrink-0 text-end", strong ? "font-bold text-foreground" : "text-foreground")}>{children}</dd>
    </div>
  )
}

function Money({ value }: { value: number }) {
  return (
    <span dir="ltr" className="tabular-nums">
      {fmtMoney(value)} ﷼
    </span>
  )
}

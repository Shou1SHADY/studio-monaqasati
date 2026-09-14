"use client"

// Small pieces that show a request or a cost statement the same way in its
// card, its drawer and its forms: where it came from (two doors only), how
// long it has waited against the answer window, the verdict of each line
// with its reason, and the cost statement's state here and at Sales.

import { useMemo, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Calculator, Clock, FileText, ShoppingCart } from "lucide-react"
import { itemKey, type Verdict } from "@/lib/manufacturing-engine"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import {
  neededInDays,
  requestSourceInfo,
  requestState,
  verdictReason,
  type EstimateStatus,
  type RequestRef,
  type RequestSourceInfo,
  type RequestState,
  type SalesQuoteState,
  type ScreenContext,
  type ScreenedLine,
} from "@/lib/manufacturing-requests"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { MfgModuleChip, errorText } from "./MfgOrderBits"
import { MfgChip, MfgPill, fmtMoney, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"

type T = ReturnType<typeof useTranslations>

/** The org's screening inputs — the same world the Workshop computes from. */
export function useScreenContext(): ScreenContext {
  const { data, world, today } = useMfgUi()
  return useMemo(() => {
    let free: Map<string, number> | null = world.alloc?.free ?? null
    if (!free && data.stock) free = new Map(data.stock.onHand)
    return {
      products: data.products,
      productById: data.productById,
      calcs: world.calcs,
      departments: data.departments,
      settings: data.settings,
      lost: world.lost,
      free,
      today,
    }
  }, [data.products, data.productById, data.departments, data.settings, data.stock, world.alloc, world.calcs, world.lost, today])
}

/** The request's source, read against its sales order when there is one. */
export function useSourceInfo(r: ManufacturingRequest | null): RequestSourceInfo | null {
  const { data } = useMfgUi()
  return useMemo(() => (r ? requestSourceInfo(r, r.orderId ? data.salesOrders.get(r.orderId) : null) : null), [r, data.salesOrders])
}

export function sourceIcon(info: Pick<RequestSourceInfo, "source" | "kind">) {
  if (info.source === "procurement") return ShoppingCart
  return info.kind === "cost" ? Calculator : FileText
}

/** "MR-2026/045 — Namaa" (falls back to the kind when the name is unknown). */
export function requestTitle(r: Pick<ManufacturingRequest, "requestNumber">, info: RequestSourceInfo, t: T): string {
  return `${r.requestNumber} — ${info.name || t(`mfr_kind_${info.kind}`)}`
}

export function RequestSourceChip({ info }: { info: Pick<RequestSourceInfo, "source"> }) {
  return <MfgModuleChip module={info.source} prefix="from" />
}

export function refText(ref: RequestRef, t: T): string {
  return ref.kind === "cost_item" ? t("mfr_ref_cost_item", { name: ref.ref }) : ref.ref
}

export function RequestRefs({ info }: { info: RequestSourceInfo }) {
  const t = useTranslations("Portal.Shared")
  if (!info.refs.length) return null
  return (
    <>
      {info.refs.map((ref) => (
        <span key={`${ref.kind}_${ref.ref}`} dir={ref.kind === "cost_item" ? "auto" : "ltr"} className="font-semibold text-slate-700">
          {refText(ref, t)}
        </span>
      ))}
    </>
  )
}

export function DownPaymentChip({ state }: { state: RequestSourceInfo["downPayment"] }) {
  const t = useTranslations("Portal.Shared")
  if (state === "confirmed") return <MfgChip tone="ok">{t("mfr_dp_confirmed")}</MfgChip>
  if (state === "pending") return <MfgChip tone="bad">{t("mfr_dp_pending")}</MfgChip>
  return null
}

// ---------------------------------------------------------------------------
// Age and state
// ---------------------------------------------------------------------------

/** "5 hours" under two days, "3 days" beyond. */
export function ageText(t: T, hours: number): string {
  const h = Math.max(0, Math.floor(hours))
  return h < 48 ? t("mfr_age_hours", { hours: h }) : t("mfr_age_days", { days: Math.floor(h / 24) })
}

/** "just now", "3 hours ago", "2 days ago". */
export function useAgo() {
  const t = useTranslations("Portal.Shared")
  const { nowMs } = useMfgUi()
  return (iso: string | null | undefined): string => {
    if (!iso) return ""
    const hours = (nowMs - new Date(iso).getTime()) / 3600000
    if (!Number.isFinite(hours)) return ""
    if (hours < 1) return t("mfr_ago_now")
    return t("mfr_ago", { age: ageText(t, hours) })
  }
}

const STATE_TONE: Record<RequestState, MfgTone> = {
  awaiting: "warn",
  overdue: "bad",
  accepted: "ok",
  partial: "warn",
  costed: "info",
  declined: "muted",
  moved: "muted",
}

export function RequestStatePill({ request }: { request: ManufacturingRequest }) {
  const t = useTranslations("Portal.Shared")
  const { data, nowMs } = useMfgUi()
  const state = requestState(request, data.settings.answerWindowHours, nowMs)
  const hours = request.requestedAt ? Math.max(0, (nowMs - new Date(request.requestedAt).getTime()) / 3600000) : 0
  return (
    <MfgPill tone={STATE_TONE[state]} icon={state === "awaiting" || state === "overdue" ? Clock : undefined} dot={state !== "awaiting" && state !== "overdue"}>
      {state === "overdue" ? t("mfr_state_overdue", { age: ageText(t, hours) }) : t(`mfr_state_${state}`)}
    </MfgPill>
  )
}

const ESTIMATE_TONE: Record<EstimateStatus, MfgTone> = { draft: "warn", sent: "info", expired: "bad" }

export function EstimateStatusPill({ status }: { status: EstimateStatus }) {
  const t = useTranslations("Portal.Shared")
  return (
    <MfgPill tone={ESTIMATE_TONE[status]} dot>
      {t(`mfr_est_${status}`)}
    </MfgPill>
  )
}

/** Sales' side of a statement, as read: quote and its state, or "no quote yet". */
export function salesQuoteText(state: SalesQuoteState, quoteNumber: string | null | undefined, salesOrderNumber: number | null | undefined, t: T): string {
  if (state === "none") return "—"
  if (state === "no_quote") return t("mfr_sales_no_quote")
  const parts = [t(`mfr_sales_${state}`)]
  if (quoteNumber) parts.push(quoteNumber)
  if (salesOrderNumber != null) parts.push(`SO-${salesOrderNumber}`)
  return parts.join(" · ")
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const VERDICT_TONE: Record<Verdict["kind"], MfgTone> = { make: "ok", partial: "warn", buy_price: "warn", buy_capacity: "bad" }

export function verdictLabel(v: Verdict, t: T): string {
  return v.kind === "partial" ? t("mfr_verdict_partial", { qty: fmtQty(v.makeQty) }) : t(`mfr_verdict_${v.kind}`)
}

export function VerdictPill({ verdict }: { verdict: Verdict | null }) {
  const t = useTranslations("Portal.Shared")
  if (!verdict) return <MfgPill tone="muted">{t("mfr_no_card")}</MfgPill>
  return <MfgPill tone={VERDICT_TONE[verdict.kind]}>{verdictLabel(verdict, t)}</MfgPill>
}

/** The verdict's reason in one line; money figures only for the money roles. */
export function useVerdictReason() {
  const t = useTranslations("Portal.Shared")
  const date = useMfgDate()
  const { seesMoney, today } = useMfgUi()
  const inDays = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return date.short(d.toISOString().slice(0, 10))
  }
  return (line: ScreenedLine, request: Pick<ManufacturingRequest, "neededBy">): string => {
    if (!line.verdict) return t("mfr_reason_no_card")
    const reason = verdictReason(line.verdict, neededInDays(request, today))
    switch (reason.key) {
      case "make_ready":
        return reason.spareDays > 0 ? t("mfr_reason_make_ready", { date: inDays(reason.days), days: reason.spareDays }) : t("mfr_reason_make_tight", { date: inDays(reason.days) })
      case "make_untimed":
        return t("mfr_reason_make_untimed")
      case "partial":
        return t("mfr_reason_partial", { qty: fmtQty(reason.qty), date: inDays(reason.needDays) })
      case "buy_labour_gap":
        return seesMoney ? t("mfr_reason_buy_labour_gap", { amount: fmtMoney(reason.materialUnit) }) : t("mfr_reason_buy_cheaper")
      case "buy_materials_dearer":
        return seesMoney ? t("mfr_reason_buy_materials_dearer", { amount: fmtMoney(reason.materialUnit) }) : t("mfr_reason_buy_cheaper")
      case "buy_capacity":
        return t("mfr_reason_buy_capacity", { possible: reason.possibleDays == null ? "—" : inDays(reason.possibleDays), need: inDays(reason.needDays) })
    }
  }
}

/** "Crema slab: needs 13 m² incl. waste · available 8" — green when covered. */
export function SlabNeedText({ line }: { line: ScreenedLine }) {
  const t = useTranslations("Portal.Shared")
  if (!line.slab) return null
  const s = line.slab
  return (
    <span className="block">
      <span dir="auto">{t("mfr_slab_need", { item: s.itemName, qty: fmtQty(s.need), unit: s.unit })}</span>
      {s.available != null && (
        <>
          {" · "}
          <b className={cn("tabular-nums", s.available >= s.need ? "text-success" : "text-destructive")}>{t("mfr_slab_available", { qty: fmtQty(s.available) })}</b>
        </>
      )}
    </span>
  )
}

export function productUnitOf(line: ScreenedLine): string {
  return line.product?.unit || line.line.unit
}

/** Search suggestions for a product select: cards whose name is close to the line's. */
export function closeProducts<P extends { name: string; archived?: boolean }>(products: P[], itemName: string): P[] {
  const key = itemKey(itemName)
  const live = products.filter((p) => !p.archived)
  const near = live.filter((p) => key && (itemKey(p.name).includes(key) || key.includes(itemKey(p.name))))
  return [...near, ...live.filter((p) => !near.includes(p))]
}

/** "4 m² · 30 m" — never one total across units (UI-06). */
export function qtyByUnitText(pairs: Array<[string, number]>): string {
  const m = new Map<string, number>()
  for (const [unit, qty] of pairs) if (qty > 0) m.set(unit, (m.get(unit) || 0) + qty)
  return Array.from(m, ([unit, qty]) => `${fmtQty(qty)} ${unit}`).join(" · ")
}

/** The answer in one line, as it returned to the requester. */
export function answerText(r: ManufacturingRequest, t: T): string {
  const note = r.answerNote && r.status !== "rejected" ? ` — ${r.answerNote}` : ""
  const count = r.workOrderIds?.length || (r.workOrderId ? 1 : 0)
  switch (r.status) {
    case "accepted":
      return t("mfr_ans_accepted", { count }) + note
    case "partial": {
      const returned = qtyByUnitText((r.lines || []).map((l) => [l.unit, l.returnedQuantity ?? 0]))
      return t("mfr_ans_partial", { count, returned: returned || "—" }) + note
    }
    case "estimated":
      return t("mfr_ans_costed", { number: r.estimateNumber || "—" }) + note
    case "rejected":
      return t("mfr_ans_declined", { reason: r.rejectionReason || r.answerNote || "—" })
    case "moved":
      return t("mfr_ans_moved")
    default:
      return ""
  }
}

// ---------------------------------------------------------------------------
// Errors and tables
// ---------------------------------------------------------------------------

/** A write's error code → this area's message, else the shared one. */
export function reqErrorText(t: T, err: unknown): string {
  const code = (err as Error)?.message || ""
  const key = `mfr_err_${code}`
  return t.has(key) ? t(key) : errorText(t, err)
}

/** A table that scrolls sideways on a phone instead of squeezing its columns. */
export function ReqTable({ head, children, minWidth = "min-w-[520px]" }: { head: ReactNode; children: ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-xs", minWidth)}>
        <thead>
          <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-semibold text-muted-foreground">{head}</tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("whitespace-nowrap px-3 py-2 text-start font-semibold", className)}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2.5 align-top", className)}>{children}</td>
}

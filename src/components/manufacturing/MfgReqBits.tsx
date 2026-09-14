"use client"

// Small pieces that show a manufacturing request the same way in its card,
// its drawer and the answer form: where it came from, how long it has waited,
// and the make-or-buy verdict of each line with its reason in one line.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Clock, FolderKanban, HandCoins, ShoppingCart } from "lucide-react"
import type { ManufacturingRequest } from "@/lib/sales-orders"
import type { Verdict } from "@/lib/manufacturing-engine"
import {
  answerWindow,
  requestSourceKind,
  requestSourceName,
  type ScreenContext,
  type ScreenedLine,
  type VerdictReason,
} from "@/lib/manufacturing-requests"
import { cn } from "@/lib/utils"
import { useMfgUi } from "./MfgUiContext"
import { MfgChip, MfgPill, fmtMoney, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"

type T = ReturnType<typeof useTranslations>

export const SOURCE_META = {
  sales: { icon: HandCoins, tone: "accent" as MfgTone, labelKey: "mfg2_req_src_sales" },
  project: { icon: FolderKanban, tone: "info" as MfgTone, labelKey: "mfg2_req_src_project" },
  procurement: { icon: ShoppingCart, tone: "muted" as MfgTone, labelKey: "mfg2_req_src_procurement" },
}

export function sourceMetaOf(r: ManufacturingRequest) {
  return SOURCE_META[requestSourceKind(r)]
}

export function RequestSourceChip({ request }: { request: ManufacturingRequest }) {
  const t = useTranslations("Portal.Shared")
  const meta = sourceMetaOf(request)
  return (
    <MfgChip tone={meta.tone} icon={meta.icon}>
      {t(meta.labelKey)}
    </MfgChip>
  )
}

/** "MR-XXXX — Project name" (falls back to the source's label). */
export function requestTitle(r: ManufacturingRequest, t: T): string {
  return `${r.requestNumber} — ${requestSourceName(r) || t(sourceMetaOf(r).labelKey)}`
}

/** The sales order behind a sales-born request — the "via" of its requester. */
export function requestVia(r: ManufacturingRequest, t: T): string | null {
  return r.orderNumber ? t("mfg3_req_via_order", { number: r.orderNumber }) : null
}

export function workOrderIdsOf(r: Pick<ManufacturingRequest, "workOrderIds" | "workOrderId">): string[] {
  if (r.workOrderIds?.length) return r.workOrderIds
  return r.workOrderId ? [r.workOrderId] : []
}

/** The org's screening inputs, memoised once per data change. */
export function useScreenContext(): ScreenContext {
  const { data, today } = useMfgUi()
  return useMemo(
    () => ({
      products: data.products,
      productById: data.productById,
      inputs: data.scheduleInputs,
      departments: data.departments,
      settings: data.settings,
      today,
    }),
    [data.products, data.productById, data.scheduleInputs, data.departments, data.settings, today]
  )
}

/** A clock that ticks once a minute, so a waiting request visibly ages. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** "5 hours" under two days, "3 days" beyond. */
export function ageText(t: T, hours: number): string {
  const h = Math.max(0, Math.floor(hours))
  return h < 48 ? t("mfg3_req_age_hours", { hours: h }) : t("mfg3_req_age_days", { days: Math.floor(h / 24) })
}

/** "just now", "3 hours ago", "2 days ago". */
export function useArrivedLabel() {
  const t = useTranslations("Portal.Shared")
  const date = useMfgDate()
  return (iso: string | null | undefined, now: number): string => {
    if (!iso) return ""
    const hours = (now - new Date(iso).getTime()) / 3600000
    if (!Number.isFinite(hours)) return ""
    if (hours < 1) return t("mfg3_req_arrived_now")
    if (hours < 24) return t("mfg3_req_arrived_hours", { hours: Math.floor(hours) })
    return date.relative(iso)
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function RequestStatePill({ request, now }: { request: ManufacturingRequest; now: number }) {
  const t = useTranslations("Portal.Shared")
  const { data } = useMfgUi()
  if (request.status === "new") {
    const w = answerWindow(request, data.settings.answerWindowHours, now)
    if (w.overdue) {
      return (
        <MfgPill tone="bad" icon={Clock}>
          {t("mfg3_req_age_overdue", { age: ageText(t, Math.max(1, w.overdueHours)) })}
        </MfgPill>
      )
    }
    return (
      <MfgPill tone="warn" icon={Clock}>
        {t("mfg3_req_age_left", { hours: Math.max(1, w.leftHours) })}
      </MfgPill>
    )
  }
  const tone: MfgTone =
    request.status === "accepted" ? "ok" : request.status === "partial" ? "warn" : request.status === "estimated" ? "info" : "muted"
  const label =
    request.status === "rejected" && requestSourceKind(request) === "sales"
      ? t("mfg3_req_state_declined")
      : t(`mfg2_req_state_${request.status}`)
  return (
    <MfgPill tone={tone} dot>
      {label}
    </MfgPill>
  )
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const VERDICT_TONE: Record<Verdict["kind"], MfgTone> = {
  make: "ok",
  partial: "warn",
  buy_price: "warn",
  buy_capacity: "bad",
}

export function verdictLabel(v: Verdict, t: T): string {
  switch (v.kind) {
    case "make":
      return t("mfg2_verdict_make")
    case "partial":
      return t("mfg2_verdict_partial", { count: fmtQty(v.makeQty) })
    case "buy_price":
      return t("mfg2_verdict_buy_price")
    case "buy_capacity":
      return t("mfg2_verdict_buy_capacity")
  }
}

export function verdictTone(v: Verdict): MfgTone {
  return VERDICT_TONE[v.kind]
}

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const t = useTranslations("Portal.Shared")
  return <MfgPill tone={VERDICT_TONE[verdict.kind]}>{verdictLabel(verdict, t)}</MfgPill>
}

/** The verdict's reason in one line. Money figures only for those who see money. */
export function useVerdictReasonText() {
  const t = useTranslations("Portal.Shared")
  const date = useMfgDate()
  const { perms } = useMfgUi()
  return (reason: VerdictReason | null): string => {
    if (!reason) return t("mfg2_err_needs_product_card")
    switch (reason.key) {
      case "make_ready":
        return reason.spareDays > 0
          ? t("mfg3_req_reason_make_ready", { date: date.short(reason.date), days: reason.spareDays })
          : t("mfg3_req_reason_make_tight", { date: date.short(reason.date) })
      case "make_untimed":
        return reason.hasBuyPrice ? t("mfg3_req_reason_make_untimed") : t("mfg3_req_reason_make_untimed_no_buy")
      case "partial":
        return t("mfg3_req_reason_partial", { qty: fmtQty(reason.qty), date: date.short(reason.needDate) })
      case "buy_labour_gap":
        return perms.seesMoney
          ? t("mfg3_req_reason_buy_labour_gap", { amount: fmtMoney(reason.materialUnit) })
          : t("mfg3_req_reason_buy_cheaper")
      case "buy_materials_dearer":
        return perms.seesMoney
          ? t("mfg3_req_reason_buy_materials_dearer", { amount: fmtMoney(reason.materialUnit) })
          : t("mfg3_req_reason_buy_cheaper")
      case "buy_capacity":
        return t("mfg3_req_reason_buy_capacity", { possible: date.short(reason.possibleDate), need: date.short(reason.needDate) })
    }
  }
}

/** The line's verdict pill with its reason underneath (or the missing-card chip). */
export function VerdictCell({ line, align = "start" }: { line: ScreenedLine; align?: "start" | "end" }) {
  const t = useTranslations("Portal.Shared")
  const reasonText = useVerdictReasonText()
  return (
    <div className={cn("min-w-0", align === "end" ? "text-end" : "text-start")}>
      {line.verdict ? <VerdictPill verdict={line.verdict} /> : <MfgPill tone="muted">{t("mfg2_no_product_card")}</MfgPill>}
      <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{reasonText(line.reason)}</span>
    </div>
  )
}

/** A table that scrolls sideways on a phone instead of squeezing its columns. */
export function MfgReqTable({ head, children, minWidth = "min-w-[560px]" }: { head: ReactNode; children: ReactNode; minWidth?: string }) {
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
  return <th className={cn("whitespace-nowrap px-3 py-2 text-start font-semibold", className)}>{children}</th>
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2.5 align-top", className)}>{children}</td>
}

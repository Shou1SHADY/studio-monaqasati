"use client"

// Small pieces that show one work order the same way on every screen: its
// state, where it came from, its quantities, its dates, and its route.

import { useTranslations } from "next-intl"
import { AlertTriangle, CalendarDays, FileText, FolderKanban, Lock, Warehouse, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MfgDepartment } from "@/lib/manufacturing"
import { pendingAt, remainAt, stationBlocks } from "@/lib/manufacturing-engine"
import type { OrderStateKey, OrderView } from "@/lib/manufacturing-view"
import { MfgChip, MfgPill, MfgQtyBar, departmentIcon, fmtQty, useMfgDate, type MfgTone } from "./ui/MfgUi"

const STATE_TONE: Record<OrderStateKey, MfgTone> = {
  cancelled: "muted",
  done: "ok",
  blocked: "bad",
  awaiting_release: "muted",
  at_department: "mfg",
  awaiting_qc: "warn",
  in_transit: "info",
  breakage: "bad",
  ready: "accent",
  idle: "muted",
}

export function departmentNameOf(departments: MfgDepartment[], v: OrderView, index: number): string {
  const step = v.product.route[index]
  if (!step) return ""
  return departments.find((d) => d.id === step.departmentId)?.name || step.departmentName
}

export function MfgStatePill({ view, departments }: { view: OrderView; departments: MfgDepartment[] }) {
  const t = useTranslations("Portal.Shared")
  const label =
    view.state === "at_department"
      ? t("mfg3_state_at_department", { dept: departmentNameOf(departments, view, view.current) })
      : t(`mfg3_state_${view.state}`)
  return <MfgPill tone={STATE_TONE[view.state]} dot>{label}</MfgPill>
}

export function MfgSourceChip({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  if (view.sourceKind === "project") return <MfgChip tone="info" icon={FolderKanban}>{t("mfg3_source_project")}</MfgChip>
  if (view.sourceKind === "quotation")
    return <MfgChip tone="warn" icon={FileText}>{view.quotationNumber || t("mfg3_source_quotation")}</MfgChip>
  return <MfgChip tone="muted" icon={Warehouse}>{t("mfg3_source_stock")}</MfgChip>
}

export function sourceNameOf(view: OrderView, t: (k: string) => string): string {
  return view.sourceName || (view.sourceKind === "stock" ? t("mfg3_source_stock_name") : "—")
}

export function MfgRushChip() {
  const t = useTranslations("Portal.Shared")
  return <MfgChip tone="warn" icon={Zap}>{t("mfg3_rush")}</MfgChip>
}

/** "Delivered 6 of 10 m²", the bar, and the non-zero buckets in words. */
export function MfgQtyCell({ view }: { view: OrderView }) {
  const t = useTranslations("Portal.Shared")
  const bits: Array<{ key: string; text: string; tone?: string }> = []
  if (view.shipped) bits.push({ key: "transit", text: t("mfg3_qty_bit_transit", { qty: fmtQty(view.shipped) }), tone: "text-cta" })
  if (view.atSite) bits.push({ key: "site", text: t("mfg3_qty_bit_site", { qty: fmtQty(view.atSite) }), tone: "text-cta" })
  if (view.broken) bits.push({ key: "broken", text: t("mfg3_qty_bit_broken", { qty: fmtQty(view.broken) }), tone: "text-destructive" })
  if (view.ready) bits.push({ key: "ready", text: t("mfg3_qty_bit_ready", { qty: fmtQty(view.ready) }), tone: "text-success" })
  if (view.wip) bits.push({ key: "wip", text: t("mfg3_qty_bit_wip", { qty: fmtQty(view.wip) }) })
  if (view.rejected) bits.push({ key: "held", text: t("mfg3_qty_bit_held", { qty: fmtQty(view.rejected) }), tone: "text-warning" })
  if (view.scrapApproved) bits.push({ key: "scrap", text: t("mfg3_qty_bit_scrap", { qty: fmtQty(view.scrapApproved) }), tone: "text-destructive" })
  if (!view.released) bits.push({ key: "unreleased", text: t("mfg3_qty_bit_unreleased") })
  return (
    <div className="flex min-w-[140px] flex-col gap-1">
      <span className="text-xs font-bold text-foreground">
        {fmtQty(view.delivered)} <span className="text-[11px] font-semibold text-muted-foreground">{t("mfg3_qty_of", { total: fmtQty(view.quantity), unit: view.unit })}</span>
      </span>
      <MfgQtyBar
        total={view.quantity}
        label={t("mfg3_qty_bar_label")}
        segments={[
          { key: "delivered", value: view.delivered },
          { key: "transit", value: view.shipped },
          { key: "ready", value: view.ready },
          { key: "wip", value: view.wip },
          { key: "held", value: view.rejected },
          { key: "scrap", value: view.scrapApproved },
        ]}
      />
      <span className="flex flex-wrap gap-x-2 text-[10px] font-semibold text-muted-foreground">
        {bits.length ? bits.map((b) => <span key={b.key} className={b.tone}>{b.text}</span>) : t("mfg3_qty_bit_not_started")}
      </span>
    </div>
  )
}

/** Needed date, what capacity makes possible, and why it slips. */
export function MfgDueCell({ view, departments, compact }: { view: OrderView; departments: MfgDepartment[]; compact?: boolean }) {
  const t = useTranslations("Portal.Shared")
  const d = useMfgDate()
  if (view.done) {
    const last = view.notes.filter((n) => n.receivedAt).map((n) => n.receivedAt!).sort().pop()
    return <span className="text-[11px] text-muted-foreground">{t("mfg3_due_delivered", { date: d.short(last || view.neededBy) })}</span>
  }
  const tone = view.late ? "text-destructive" : view.neededBy && d.dayDiff(view.neededBy) <= 2 ? "text-warning" : "text-success"
  const waitDept = view.schedule?.waitDepartmentId ? departments.find((x) => x.id === view.schedule!.waitDepartmentId)?.name : null
  let sub: string
  if (view.overdue) sub = t("mfg3_due_overdue", { days: view.lateDays })
  else if (view.possibleDate) {
    sub = view.willMiss
      ? t("mfg3_due_possible_late", { date: d.short(view.possibleDate), days: view.lateDays })
      : t("mfg3_due_possible", { date: d.short(view.possibleDate) })
    if (view.schedule?.condition) sub += ` (${t(`mfg3_cond_${view.schedule.condition}`)})`
    if (view.willMiss && waitDept) sub += ` · ${t("mfg3_due_queue_at", { dept: waitDept })}`
  } else if (!view.released && view.releaseBlocks.some((b) => b.key === "quote")) sub = t("mfg3_due_no_date_quote")
  else sub = d.relative(view.neededBy)
  return (
    <div className="flex min-w-[120px] flex-col gap-0.5">
      <span className={cn("flex items-center gap-1 text-xs font-bold", tone)}>
        {view.late ? <AlertTriangle size={12} aria-hidden="true" /> : <CalendarDays size={12} aria-hidden="true" />}
        {d.short(view.neededBy)}
      </span>
      {!compact && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

/** The route as a strip: each department with what it finished and what it holds. */
export function MfgRouteStrip({ view, departments }: { view: OrderView; departments: MfgDepartment[] }) {
  const t = useTranslations("Portal.Shared")
  const route = view.product.route
  return (
    <div className="flex overflow-x-auto" role="list">
      {route.map((step, i) => {
        const dept = departments.find((d) => d.id === step.departmentId)
        const Icon = departmentIcon(dept?.name || step.departmentName, step.onSite)
        const inHand = pendingAt(view.slice, route, i, view.noteSlices)
        const done = view.slice.progress[i]?.done || 0
        const rejected = view.slice.progress[i]?.rejected || 0
        const blocked = inHand > 0 && stationBlocks(view.slice, view.product, route, i).some((b) => b.severity === "hard")
        const complete = done > 0 && remainAt(view.slice, i) <= 0
        const cls = complete
          ? "border-success/30 bg-success/5 text-success"
          : blocked
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : inHand > 0
              ? "border-warning/30 bg-warning/5 text-warning"
              : "border-border bg-white text-muted-foreground"
        return (
          <div
            key={`${step.departmentId}_${i}`}
            role="listitem"
            className={cn(
              "relative min-w-[120px] flex-1 border px-3 py-2 text-start first:rounded-s-xl last:rounded-e-xl [&+&]:border-s-0",
              cls
            )}
          >
            <span className="flex items-center gap-1 text-[10px] font-bold">
              <Icon size={12} aria-hidden="true" /> {i + 1}
            </span>
            <span className="mt-0.5 block text-[11px] font-bold leading-snug">{dept?.name || step.departmentName}</span>
            <span className="mt-0.5 block text-[10px] font-semibold text-muted-foreground">
              {done > 0 ? t("mfg3_step_done", { qty: fmtQty(done) }) : t("mfg3_step_idle")}
              {inHand > 0 && ` · ${t("mfg3_step_in_hand", { qty: fmtQty(inHand) })}`}
              {rejected > 0 && ` · ${t("mfg3_step_rejected", { qty: fmtQty(rejected) })}`}
            </span>
            {blocked && (
              <span className="absolute end-0 top-0 inline-flex items-center gap-0.5 rounded-es-lg bg-destructive/10 px-1.5 py-px text-[9px] font-bold text-destructive">
                <Lock size={9} aria-hidden="true" /> {t("mfg3_blocked")}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

"use client"

// Small pieces the orders list and the drawer share: the status pill (derived
// status, late badge), the line's segmented bar, a figure with the riyal
// sign, and the "honest date" sentence.

import { useLocale, useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { poLate, poStatus } from "@/lib/procurement/po"
import type { PoLine, PoStatus, PurchaseOrder } from "@/lib/procurement/types"
import { sarLtr } from "@/lib/riyal"
import { figure, honestDate, lineParts, percentOf, quantityText, type HonestDate } from "./PoModel"

const PILL: Record<PoStatus, string> = {
  awaiting_approval: "bg-warning/10 text-warning",
  approved: "bg-cta/10 text-cta",
  sent: "bg-cta/10 text-cta",
  accepted: "bg-module/10 text-module",
  in_delivery: "bg-module/10 text-module",
  part_received: "bg-module/10 text-module",
  received: "bg-success/10 text-success",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
}

export function PoStatusPill({ po, now, className }: { po: PurchaseOrder; now: Date; className?: string }) {
  const tProc = useTranslations("Portal.Procurement")
  const t = useTranslations("Portal.ProcOrders")
  const status = poStatus(po)
  const key = status === "closed" && po.closedShort ? "closed_short" : status
  const late = poLate(po, now)
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <Badge className={cn("border-none text-[11px] font-bold", PILL[status])}>{tProc(`status.${key}`)}</Badge>
      {late && <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{tProc("deliveryState.late", { days: daysLateOf(po, now) })}</Badge>}
      {po.status === "awaiting_approval" && po.returnedReason && <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{t("pill_returned")}</Badge>}
    </span>
  )
}

function daysLateOf(po: PurchaseOrder, now: Date): number {
  // The pill only needs the number the domain already computed.
  const d = honestDate(po, now)
  return d.kind === "promised" ? d.daysLate : 0
}

/** The riyal sign to the left of grouped Latin digits, isolated LTR in both scripts. */
export function Money({ value, className, masked }: { value: number | null | undefined; className?: string; masked?: boolean }) {
  if (masked) return <span className={cn("text-muted-foreground", className)}>—</span>
  return (
    <span dir="ltr" className={cn("tabular-nums", className)}>
      {sarLtr(figure(value))}
    </span>
  )
}

export function useDateText() {
  const locale = useLocale()
  return (day: string | null | undefined, style: "short" | "long" = "short"): string => {
    if (!day) return "—"
    const d = new Date(day.length === 10 ? `${day}T00:00:00` : day)
    if (Number.isNaN(d.getTime())) return day
    return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { year: "numeric", month: style === "long" ? "long" : "short", day: "numeric" })
  }
}

/** The sentence the date column shows. */
export function HonestDateText({ po, now, className }: { po: PurchaseOrder; now: Date; className?: string }) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const fmt = useDateText()
  const d: HonestDate = honestDate(po, now)
  switch (d.kind) {
    case "with_approver":
      return <span className={cn("text-muted-foreground", className)}>{t("date.with_approver", { approver: tProc(`approver.${d.approver}`) })}</span>
    case "not_sent":
      return <span className={cn("text-muted-foreground", className)}>{t("date.not_sent")}</span>
    case "no_acceptance":
      return <span className={cn("text-muted-foreground", className)}>{t("date.no_acceptance")}</span>
    case "no_date":
      return <span className={cn("text-muted-foreground", className)}>{t("date.no_date")}</span>
    case "promised":
      return (
        <span className={cn(d.daysLate > 0 ? "font-bold text-destructive" : "text-foreground", className)}>
          {fmt(d.date)}
          {d.daysLate > 0 && <span className="ms-1 text-xs">· {tProc("deliveryState.late", { days: d.daysLate })}</span>}
        </span>
      )
    case "closed":
      return <span className={cn("text-muted-foreground", className)}>{t("date.closed", { date: fmt(d.date) })}</span>
    case "cancelled":
      return <span className={cn("text-muted-foreground", className)}>{tProc("status.cancelled")}</span>
  }
}

/** accepted · held · rejected (undecided) · cancelled · to arrive — the bar partitions the ordered quantity. */
export function LineBar({ line, className }: { line: PoLine; className?: string }) {
  const t = useTranslations("Portal.ProcOrders")
  const p = lineParts(line)
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? <div className={cn("h-full", cls)} style={{ width: `${percentOf(n, p.ordered)}%` }} title={label} aria-hidden="true" /> : null
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t("bar.aria", { accepted: p.accepted, held: p.held, rejected: p.rejected, cancelled: p.cancelled, toArrive: p.toArrive, unit: line.unit })}>
        {seg(p.accepted, "bg-success", t("bar.accepted"))}
        {seg(p.held, "bg-warning", t("bar.held"))}
        {seg(p.rejected, "bg-destructive", t("bar.rejected"))}
        {seg(p.cancelled, "bg-muted-foreground/40", t("bar.cancelled"))}
      </div>
      <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        <span className="font-bold text-success">
          {t("bar.accepted")} {figure(p.accepted)}
        </span>
        {p.held > 0 && (
          <span className="text-warning">
            {t("bar.held")} {figure(p.held)}
          </span>
        )}
        {p.rejected > 0 && (
          <span className="text-destructive">
            {t("bar.rejected")} {figure(p.rejected)}
          </span>
        )}
        {p.cancelled > 0 && (
          <span>
            {t("bar.cancelled")} {figure(p.cancelled)}
          </span>
        )}
        <span>
          {t("bar.to_arrive")} {figure(p.toArrive)}
        </span>
        <span>{quantityText(p.ordered, line.unit)}</span>
      </p>
    </div>
  )
}

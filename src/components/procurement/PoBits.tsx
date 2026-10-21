"use client"

// Small pieces the orders list and the drawer share: the status pill (derived
// status, late badge), the line's segmented bar, a figure with the riyal
// sign, and the "honest date" sentence.

import { useLocale, useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { poLate, poStatus, type NoticeFact } from "@/lib/procurement/po"
import { asX, closedByPayment } from "@/lib/procurement/po-extras"
import { poTags, poVer, type PoNextStep, type PoWho } from "@/lib/procurement/po-state"
import type { PoLine, PoStatus, ProcurementPolicies, PurchaseOrder } from "@/lib/procurement/types"
import { sarLtr } from "@/lib/riyal"
import { figure, honestDate, lineParts, moneyFigure, percentOf, quantityText, type HonestDate } from "./PoModel"

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

/** `notices` = the order's delivery notices: a notice in time that waits for OUR count is not the supplier's delay (PUR-07). */
export function PoStatusPill({ po, now, notices, className }: { po: PurchaseOrder; now: Date; notices?: ReadonlyArray<NoticeFact>; className?: string }) {
  const tProc = useTranslations("Portal.Procurement")
  const t = useTranslations("Portal.ProcOrders")
  const paid = closedByPayment(asX(po))
  const status = paid ? "closed" : poStatus(po)
  const key = paid ? "closed_paid" : status === "closed" && po.closedShort ? "closed_short" : status
  const late = poLate(po, now, notices)
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <Badge className={cn("border-none text-[11px] font-bold", PILL[status])}>{tProc(`status.${key}` as "status.closed")}</Badge>
      {late && <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{tProc("deliveryState.late", { days: daysLateOf(po, now, notices) })}</Badge>}
      {po.status === "sent" && po.supplierDecline && <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{t("supplier.declined")}</Badge>}
      {po.status === "awaiting_approval" && po.returnedReason && <Badge className="border-none bg-destructive/10 text-[11px] font-bold text-destructive">{t("pill_returned")}</Badge>}
    </span>
  )
}

function daysLateOf(po: PurchaseOrder, now: Date, notices?: ReadonlyArray<NoticeFact>): number {
  // The pill only needs the number the domain already computed.
  const d = honestDate(po, now, notices)
  return d.kind === "promised" ? d.daysLate : 0
}

/** The riyal sign to the left of grouped Latin digits, isolated LTR in both scripts. */
export function Money({ value, className, masked }: { value: number | null | undefined; className?: string; masked?: boolean }) {
  if (masked) return <span className={cn("text-muted-foreground", className)}>—</span>
  return (
    <span dir="ltr" className={cn("tabular-nums", className)}>
      {sarLtr(moneyFigure(value))}
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
export function HonestDateText({ po, now, notices, className }: { po: PurchaseOrder; now: Date; notices?: ReadonlyArray<NoticeFact>; className?: string }) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const fmt = useDateText()
  const d: HonestDate = honestDate(po, now, notices)
  switch (d.kind) {
    case "with_approver":
      return <span className={cn("text-muted-foreground", className)}>{t("date.with_approver", { approver: tProc(`approver.${d.approver}`), days: d.days })}</span>
    case "not_sent":
      return <span className={cn("text-muted-foreground", className)}>{t("date.not_sent")}</span>
    case "no_acceptance":
      return <span className={cn("text-muted-foreground", className)}>{t("date.no_acceptance", { days: d.days })}</span>
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

/** accepted · held · in transit · rejected (undecided) · cancelled · not shipped — the bar partitions the ordered quantity. */
export function LineBar({ line, inTransit = 0, className }: { line: PoLine; inTransit?: number; className?: string }) {
  const t = useTranslations("Portal.ProcOrders")
  const p = lineParts(line)
  const transit = Math.min(Math.max(0, inTransit), p.toArrive)
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? <div className={cn("h-full", cls)} style={{ width: `${percentOf(n, p.ordered)}%` }} title={label} aria-hidden="true" /> : null
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t("bar.aria", { accepted: p.accepted, held: p.held, rejected: p.rejected, cancelled: p.cancelled, toArrive: p.toArrive, unit: line.unit })}>
        {seg(p.accepted, "bg-success", t("bar.accepted"))}
        {seg(p.held, "bg-warning", t("bar.held"))}
        {seg(transit, "bg-cta", t("bar.in_transit"))}
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
        {transit > 0 && (
          <span className="text-cta">
            {t("bar.in_transit")} {figure(transit)}
          </span>
        )}
        <span>
          {transit > 0 ? t("bar.not_shipped") : t("bar.to_arrive")} {figure(p.toArrive - transit)}
        </span>
        <span>{quantityText(p.ordered, line.unit)}</span>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// «من ننتظر», the header tags and the next-step sentence (Procurement 2.0)
// ---------------------------------------------------------------------------

const WHO_STYLE: Record<PoWho, string> = {
  sup: "bg-cta/10 text-cta",
  us: "bg-warning/10 text-warning",
  rcv: "bg-module/10 text-module",
  fin: "bg-success/10 text-success",
  app: "bg-warning/10 text-warning",
  inv: "bg-module/10 text-module",
  mfg: "bg-module/10 text-module",
  none: "bg-muted text-muted-foreground",
}

/** Who the order waits on: المورد · نحن · المستلم · المالية · المعتمِد · المخزون · الورشة · —. */
export function WhoTag({ who, className }: { who: PoWho; className?: string }) {
  const t = useTranslations("Portal.ProcOrders")
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold", WHO_STYLE[who], className)}>{t(`who.${who}`)}</span>
}

/** The header pills: the version, how the order was won, and what it carries. */
export function PoTags({ po, policies, className }: { po: PurchaseOrder; policies: Pick<ProcurementPolicies, "directPurchaseCap" | "minOffers">; className?: string }) {
  const t = useTranslations("Portal.ProcOrders")
  const tProc = useTranslations("Portal.Procurement")
  const ver = poVer(po)
  const tags = poTags(po, policies)
  if (ver <= 1 && tags.length === 0) return null
  const why = (x: { why: string | null; whyCode: string | null }) => x.why || (x.whyCode ? tProc(`awardReason.${x.whyCode}` as "awardReason.other") : "—")
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {ver > 1 && <Badge className="border-none bg-cta/10 text-[11px] font-bold text-cta">{tProc("rfqpo.po.revision", { n: ver })}</Badge>}
      {tags.map((tag) => (
        <Badge key={tag.id} className={cn("border-none text-[11px] font-bold", tag.id === "lump" || tag.id === "noVat" ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning")}>
          {tag.id === "notLowest" && t("tag.not_lowest", { why: why(tag) })}
          {tag.id === "lowComp" && t("tag.low_comp", { n: tag.n ?? 0, of: tag.of ?? 3, why: why(tag) })}
          {tag.id === "directOver" && t("tag.direct_over", { why: why(tag) })}
          {tag.id === "lump" && t("tag.lump")}
          {tag.id === "noVat" && t("tag.no_vat")}
        </Badge>
      ))}
    </span>
  )
}

/** The sentence of the next step, in the reader's language — the rows of the list and the drawer's new states read it. */
export function useStepSentence() {
  const t = useTranslations("Portal.ProcOrders")
  const fmt = useDateText()
  return (step: PoNextStep): string => {
    const { state, params } = step
    const key = state.k === "adv" ? (state.who === "app" ? "adv_owner" : state.who === "fin" ? "adv_fin" : "adv_us") : state.k
    const date = typeof params.date === "string" && params.date ? fmt(params.date) : "—"
    const reason = typeof params.reason === "string" && ["stock", "price", "date", "other"].includes(params.reason) ? t(`supplier.reason_${params.reason}` as "supplier.reason_other") : String(params.reason ?? "")
    return t(`step.${key}` as "step.appr", { ...params, date, reason, name: String(params.name || "—") })
  }
}

"use client"

// One RFQ as a tile (the reference prototype's RFQ grid, PRD 2.0 «طلبات العروض»): its state pill with its number, its auto-generated
// name, the places it is delivered to, how many materials it asks for, who it reaches, the unanswered inquiries, when it closes, how many
// offers it has (and how many came from off the platform), the lowest COMPLETE offer — the same figure as the RFQ page's header and
// Today — and the ONE thing to do next: finish a draft, compare and award, reopen a round with nothing live, or just open it.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Clock, Eye, FileText, Globe, Hand, LayoutGrid, Link2, Lock, MapPin, MessageCircleQuestion, Package, Printer, RotateCcw, Scale, Send, ShieldCheck, Trash2 } from "lucide-react"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { moneyFigure } from "@/components/procurement/PoModel"
import { Button } from "@/components/ui/button"
import { useRfqInquiryCounts } from "@/hooks/useRfqInquiryCounts"
import { Link } from "@/i18n/routing"
import { fmtDayLong, rfqDisplayNumber } from "@/lib/procurement/format"
import { fromHalalas } from "@/lib/procurement/offer-calc"
import { actionHref, isJustPublished, primaryAction, type ListReach, type ListRfq, type ListState, type PrimaryAction, type RfqListRow } from "@/lib/procurement/rfq-list"
import { rfqReviewHref } from "@/lib/procurement/rfq-routes"
import { productCount } from "@/lib/procurement/rfq-view"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

export const STAGE_EDGE: Record<ListState, string> = {
  draft: "border-t-muted-foreground/40",
  open: "border-t-cta",
  compare: "border-t-warning",
  awarded: "border-t-success",
  cancelled: "border-t-border",
}

const STATE_TONE: Record<ListState, PillTone> = { draft: "mute", open: "info", compare: "warn", awarded: "ok", cancelled: "mute" }

export type RfqRow = ListRfq & {
  createdByUserName?: string
  requiresWarranty?: boolean
  invitedSupplierOrgIds?: string[] | null
}

export type RfqCardRow = RfqListRow<RfqRow>

const REACH_ICON = { public: Globe, private: Lock, direct: Hand } as const

export function RfqStagePill({ row }: { row: Pick<RfqListRow, "state" | "closedEarly"> & { publishedMs?: number } }) {
  const tp = useTranslations("Portal.Procurement.rfqpage")
  const tList = useTranslations("Portal.Procurement.rfqlist")
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusPill tone={STATE_TONE[row.state]}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        {tp(`stage.${row.state}`)}
      </StatusPill>
      {row.closedEarly && row.state === "awarded" && <StatusPill tone="warn">{tp("stage.early")}</StatusPill>}
      {isJustPublished(row, Date.now()) && <StatusPill tone="ok">{tList("just_published")}</StatusPill>}
    </span>
  )
}

export function RfqNumber({ rfq }: { rfq: Pick<RfqRow, "id" | "rfqNumber"> }) {
  const locale = useLocale()
  return (
    <span className="whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground" dir="ltr">
      {rfqDisplayNumber(rfq, locale)}
    </span>
  )
}

export function Tag({ icon: Icon, tone = "mute", children, className }: { icon?: typeof LayoutGrid; tone?: "mute" | "info" | "ok" | "warn"; children: ReactNode; className?: string }) {
  const TONE = {
    mute: "border-border bg-card text-muted-foreground",
    info: "border-cta/20 bg-cta/5 text-cta",
    ok: "border-success/25 bg-success/5 text-success",
    warn: "border-warning/30 bg-warning/5 text-warning",
  }
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE[tone], className)}>
      {Icon && <Icon size={12} className="shrink-0" aria-hidden="true" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

/** «عام · 8 موردين» — who it reaches; the count only when it is known. */
export function ReachTag({ row }: { row: Pick<RfqListRow, "reach" | "reachCount"> }) {
  const tp = useTranslations("Portal.Procurement.rfqpage")
  const t = useTranslations("Portal.Procurement.rfqlist")
  const Icon = REACH_ICON[row.reach as ListReach]
  return (
    <Tag icon={Icon}>
      {tp(`audience.${row.reach}`)}
      {row.reachCount != null && row.reachCount > 0 ? ` · ${t("suppliers", { count: row.reachCount })}` : ""}
    </Tag>
  )
}

export function SitesTag({ row }: { row: Pick<RfqListRow, "siteLabels"> }) {
  const labels = Array.from(new Set(row.siteLabels))
  return (
    <Tag icon={MapPin} className="max-w-[16rem]">
      <span dir="auto">{labels.join(" · ")}</span>
    </Tag>
  )
}

/** The unanswered inquiries, as a link to the RFQ's inquiries tab. */
export function UnansweredTag({ rfqId, count }: { rfqId: string; count: number }) {
  const t = useTranslations("Portal.Procurement.rfqlist")
  if (!count) return null
  return (
    <Link href={`/contractor/rfqs/${rfqId}/offers?tab=inquiries`} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Tag icon={MessageCircleQuestion} tone="warn">
        {t("unanswered", { count })}
      </Tag>
    </Link>
  )
}

/** When it closes (open), when it closed (compare, awarded — «مبكراً» if it was closed early), when it was cancelled. */
export function ClosesText({ row }: { row: Pick<RfqListRow, "state" | "closedEarly" | "direct" | "daysLeft" | "endDay" | "rfq"> }) {
  const t = useTranslations("Portal.Procurement.rfqlist")
  const locale = useLocale()
  const date = (d: string | null | undefined) => fmtDayLong(d, locale, false)
  if (row.state === "draft") return <span>{t("draft_line")}</span>
  if (row.state === "cancelled") return <span>{t("cancelled_on", { date: date(row.rfq.cancellation?.at ? String(row.rfq.cancellation.at).slice(0, 10) : row.endDay) })}</span>
  if (row.direct && !row.endDay) return <span>{t("direct_none")}</span>
  if (row.state === "open") {
    if (row.daysLeft == null) return <span>{t("no_deadline")}</span>
    return (
      <span className={cn(row.daysLeft <= 2 && "font-semibold text-warning")} suppressHydrationWarning>
        {t("closes", { date: date(row.endDay), days: Math.max(0, row.daysLeft) })}
      </span>
    )
  }
  return <span suppressHydrationWarning>{t(row.closedEarly ? "closed_early" : "closed", { date: date(row.endDay) })}</span>
}

/** The figure the RFQ page's header, «أفضل ما وصل» and Today print: the lowest complete offer's total, with its basis. */
export function LowestOffer({ row }: { row: Pick<RfqListRow, "lowest"> }) {
  const t = useTranslations("Portal.Procurement.rfqlist")
  if (!row.lowest) return null
  return (
    <span className="whitespace-nowrap">
      {t("lowest")} <bdi dir="ltr" className="font-bold tabular-nums text-foreground">{sarLtr(moneyFigure(fromHalalas(row.lowest.grossH)))}</bdi>
      <span className="ms-1 text-[11px] text-muted-foreground">{t(row.lowest.basis)}</span>
    </span>
  )
}

/** The offers pill: how many, opening the side-by-side glance. */
export function OffersPill({ row, onGlance }: { row: Pick<RfqListRow, "offers" | "state" | "id">; onGlance: () => void }) {
  const tn = useTranslations("Portal.Procurement.rfqpage.numbers")
  if (row.state === "draft") return null
  return (
    <button type="button" onClick={onGlance} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Tag icon={FileText} tone={row.offers > 0 ? "ok" : "mute"}>
        {tn("offers", { count: row.offers })}
      </Tag>
    </button>
  )
}

const ACTION_ICON: Record<PrimaryAction, typeof Eye> = { complete: Send, compare: Scale, reopen: RotateCcw, open: Eye }

/** The card's and the row's ONE primary action (`primaryAction`). A draft the viewer does not run shows none. */
export function RfqPrimaryAction({ row, canAct, onReopen, className }: { row: RfqCardRow; canAct: boolean; onReopen: (row: RfqCardRow) => void; className?: string }) {
  const t = useTranslations("Portal.Procurement.rfqlist")
  const tp = useTranslations("Portal.Procurement.rfqpage")
  const tx = useTranslations("Portal.Procurement.rfqx.draft")
  const tl = useTranslations("Portal.Procurement.rfqlife")
  const action = primaryAction(row, canAct)
  if (action === "complete" && !canAct) return null
  const Icon = ACTION_ICON[action]
  const label = action === "complete" ? tx("complete") : action === "compare" ? tp("compare_cta") : action === "reopen" ? tl("reopen") : t("open")
  const filled = action === "compare" || action === "complete"
  const cls = cn("h-8 gap-1.5 rounded-xl text-xs font-semibold", filled ? "bg-module text-module-foreground hover:bg-module/90" : "border border-border bg-card text-foreground shadow-none hover:bg-muted", className)
  const href = actionHref(row, action, rfqReviewHref)
  if (href)
    return (
      <Button asChild size="sm" variant={filled ? "default" : "outline"} className={cls} data-action={action}>
        <Link href={href}>
          <Icon size={14} aria-hidden="true" />
          {label}
        </Link>
      </Button>
    )
  return (
    <Button type="button" size="sm" variant="outline" className={cls} data-action={action} onClick={() => onReopen(row)}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </Button>
  )
}

export interface RfqCardProps {
  row: RfqCardRow
  seesPrices: boolean
  /** Runs this RFQ (rfq-access.ts): share, extend, reopen, finish a draft. */
  canAct: boolean
  canDelete: boolean
  directSupplier: string | null
  onGlance: () => void
  onShare: () => void
  onDelete: () => void
  onExtend: () => void
  onPrint: () => void
  onReopen: (row: RfqCardRow) => void
}

export function RfqCard(p: RfqCardProps) {
  const t = useTranslations("Portal.Procurement.rfqlist")
  const tc = useTranslations("Portal.Contractor")
  const tn = useTranslations("Portal.Procurement.rfqpage.numbers")
  const tg = useTranslations("Portal.Procurement.rfqpage")
  const { row } = p
  const { rfq } = row
  const queries = useRfqInquiryCounts(row.state === "draft" ? null : rfq.id)
  const live = row.state === "open" || row.state === "compare"
  const share = p.canAct && row.state === "open" && !row.direct
  const extendable = p.canAct && live && !row.direct && !row.noLive
  const reach = row.reachCount ?? 0

  const caption = (() => {
    if (row.state === "draft" || row.state === "cancelled") return null
    if (row.noLive) return <span className="font-semibold text-destructive">{t(row.noLive === "all_excluded" ? "no_live_all_excluded" : "no_live_closed_empty")}</span>
    if (row.state === "awarded") {
      if (row.direct && p.directSupplier) return <span>{t("awarded_to", { supplier: p.directSupplier })}</span>
      return row.orders > 0 ? <span>{t("awarded_in", { count: row.orders })}</span> : null
    }
    if (row.state === "compare") return <span>{t("compare_open")}</span>
    if (row.offers === 0) return <span>{reach > 0 ? t("none_yet_reached", { suppliers: t("suppliers", { count: reach }) }) : t("none_yet")}</span>
    return <span>{t("so_far", { count: row.offers })}</span>
  })()

  return (
    <article className={cn("flex flex-col rounded-2xl border border-t-[3px] bg-card shadow-sm transition-shadow hover:shadow-md", STAGE_EDGE[row.state])}>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <RfqStagePill row={row} />
          <RfqNumber rfq={rfq} />
        </div>

        <h3 className="text-base font-black leading-snug text-foreground">
          <Link href={`/contractor/rfqs/${rfq.id}/offers?tab=details`} className="rounded-sm text-start hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {rfq.title}
          </Link>
        </h3>

        <div className="flex flex-wrap gap-1.5">
          <SitesTag row={row} />
          <Tag icon={Package}>{t("materials", { count: productCount(rfq) })}</Tag>
          <ReachTag row={row} />
          <UnansweredTag rfqId={rfq.id} count={queries.unanswered} />
          {rfq.requiresWarranty && (
            <Tag icon={ShieldCheck} tone="warn">
              {tc("rfqv_warranty")}
            </Tag>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Clock size={13} className="shrink-0" aria-hidden="true" />
          <ClosesText row={row} />
          {row.state !== "draft" && (
            <span className="ms-auto">
              <OffersPill row={row} onGlance={p.onGlance} />
            </span>
          )}
        </div>

        {live && row.offers > 0 && row.reach !== "direct" && reach > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <i className="block h-full rounded-full bg-module" style={{ width: `${Math.min(100, Math.round((row.offers / reach) * 100))}%` }} />
          </div>
        )}

        {caption && (
          <p className="text-xs text-muted-foreground">
            {caption}
            {live && !row.noLive && row.offers > 0 && p.seesPrices && row.lowest && (
              <>
                {" · "}
                <LowestOffer row={row} />
              </>
            )}
            {row.offPlatform > 0 && <span className="block text-[11px]">{tn("offers_off", { count: row.offPlatform })}</span>}
          </p>
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        <div className="flex flex-wrap items-center gap-2">
          <RfqPrimaryAction row={row} canAct={p.canAct} onReopen={p.onReopen} className="flex-1 min-w-[7rem]" />
          {row.state === "draft" && p.canDelete && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl border border-destructive/30 bg-card text-xs font-semibold text-destructive shadow-none hover:bg-destructive/5 hover:text-destructive" onClick={p.onDelete}>
              <Trash2 size={14} aria-hidden="true" />
              {tc("rfqv_delete")}
            </Button>
          )}
          {share && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground shadow-none hover:bg-muted hover:text-foreground" onClick={p.onShare} title={tc("rfqv_share")}>
              <Link2 size={14} aria-hidden="true" />
              {tg("guest_link")}
            </Button>
          )}
          {row.state !== "draft" && (
            <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 rounded-xl border border-border bg-card p-0 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground" onClick={p.onPrint} aria-label={t("print")} title={t("print")}>
              <Printer size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
        {extendable && (
          <button type="button" onClick={p.onExtend} className="block w-full rounded text-center text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {row.state === "compare" ? t("republish") : tc("rfqv_edit_open")}
          </button>
        )}
      </div>
    </article>
  )
}

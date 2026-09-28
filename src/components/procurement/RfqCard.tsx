"use client"

// One RFQ as a card (the reference prototype's RFQ grid): a coloured top edge
// and a status pill that say its stage at a glance, its number, its title, the
// project (or general stock / the workshop) and the categories of its lines,
// what it asks and what came back — offers, or the supplier of a direct award —
// its unanswered queries, its city, deadline ("n left" always) and author, and
// the actions its stage allows: complete a draft, view offers and queries,
// share, print, and extend / re-publish while nobody has seen a price.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, CalendarDays, Eye, FileText, Info, LayoutGrid, Link2, Lock, MessageCircleQuestion, Package, Printer, Send, ShieldCheck, Trash2, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { useRfqInquiryCounts } from "@/hooks/useRfqInquiryCounts"
import { displayCategory, displayCity } from "@/lib/constants"
import { displayDocNumber } from "@/lib/procurement/format"
import { deadlineTag, productCount, rfqCategories, rfqStage, STAGE_TONE, type RfqListLike, type RfqStage } from "@/lib/procurement/rfq-view"
import { cn } from "@/lib/utils"

export const STAGE_EDGE: Record<RfqStage, string> = {
  draft: "border-t-muted-foreground/40",
  open: "border-t-cta",
  compare: "border-t-warning",
  closed_empty: "border-t-destructive",
  awarded: "border-t-success",
  direct: "border-t-success",
  cancelled: "border-t-border",
}

const PILL: Record<(typeof STAGE_TONE)[RfqStage], string> = {
  mute: "bg-muted text-muted-foreground",
  info: "bg-cta/10 text-cta",
  warn: "bg-warning/10 text-warning",
  bad: "bg-destructive/10 text-destructive",
  ok: "bg-success/10 text-success",
}

export type RfqRow = RfqListLike & {
  title?: string
  rfqNumber?: string | null
  district?: string
  deadline?: string
  createdByUserName?: string
  requiresWarranty?: boolean
  visibility?: string | null
  allowedSupplierOrgIds?: string[] | null
  invitedSupplierOrgIds?: string[] | null
}

export function RfqStagePill({ stage, sealed }: { stage: RfqStage; sealed: boolean }) {
  const t = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement")
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", PILL[STAGE_TONE[stage]])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {stage === "cancelled" ? tp("rfqpo.list.stage_cancelled") : t(stage === "open" && sealed ? "rfqv_stage_open_sealed" : `rfqv_stage_${stage}`)}
    </span>
  )
}

export function RfqNumber({ rfq }: { rfq: Pick<RfqRow, "id" | "rfqNumber"> }) {
  const locale = useLocale()
  return (
    <span className="whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground" dir="ltr">
      {rfq.rfqNumber ? displayDocNumber(rfq.rfqNumber, locale) : `#${rfq.id.slice(0, 6)}`}
    </span>
  )
}

export function Tag({ icon: Icon, tone = "mute", children }: { icon?: typeof LayoutGrid; tone?: "mute" | "info" | "ok" | "warn" | "violet"; children: ReactNode }) {
  const TONE = {
    mute: "border-border bg-card text-muted-foreground",
    info: "border-cta/20 bg-cta/5 text-cta",
    ok: "border-success/25 bg-success/5 text-success",
    warn: "border-warning/30 bg-warning/5 text-warning",
    violet: "border-violet/25 bg-violet/5 text-violet",
  }
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE[tone])}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** The offers pill: the supplier of a direct award, else the count (locked while sealed). */
export function OffersTag({ rfq, sealed, directSupplier }: { rfq: RfqRow; sealed: boolean; directSupplier: string | null }) {
  const t = useTranslations("Portal.Contractor")
  const offers = rfq.offersCount ?? 0
  if (rfq.directAward) return <Tag tone="ok">{directSupplier || t("rfqv_stage_awarded")}</Tag>
  return (
    <Tag icon={FileText} tone={offers > 0 ? "ok" : "mute"}>
      {t("rfqv_offers", { count: offers })}
      {sealed && offers > 0 && <Lock size={11} aria-label={t("rfqv_sealed")} />}
    </Tag>
  )
}

/** The deadline and its tag: "n left" (amber at two days or less), passed, or none on a direct award. */
export function DeadlineText({ rfq, now }: { rfq: RfqRow; now: Date }) {
  const t = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const tag = deadlineTag(rfq, now)
  if (tag?.kind === "direct") return <span>{tp("rfqpo.list.direct_no_deadline")}</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-2" suppressHydrationWarning>
      <span>{rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long" }) : t("rfq_not_set")}</span>
      {tag?.kind === "passed" && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{t("rfqv_passed")}</span>}
      {tag?.kind === "left" && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tag.urgent ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>{tp("rfqpo.list.left", { days: tag.days })}</span>}
    </span>
  )
}

export function UnansweredTag({ count }: { count: number }) {
  const tp = useTranslations("Portal.Procurement")
  if (!count) return null
  return (
    <Tag icon={MessageCircleQuestion} tone="warn">
      {tp("rfqpo.list.unanswered", { count })}
    </Tag>
  )
}

export interface RfqCardProps {
  rfq: RfqRow
  projectLabel: string
  sealed: boolean
  now: Date
  offersHref: string
  editHref: string
  directSupplier: string | null
  canManage: boolean
  canDelete: boolean
  onGlance: () => void
  onShare: () => void
  onDelete: () => void
  onExtend: () => void
  onPrint: () => void
}

export function RfqCard(p: RfqCardProps) {
  const t = useTranslations("Portal.Contractor")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { rfq } = p
  const stage = rfqStage(rfq, p.now, p.sealed)
  const tag = deadlineTag(rfq, p.now)
  const offers = rfq.offersCount ?? 0
  const queries = useRfqInquiryCounts(stage === "draft" ? null : rfq.id)
  const extendable = p.canManage && rfq.status === "New" && !rfq.directAward && (p.sealed || offers === 0)

  return (
    <article className={cn("flex flex-col rounded-2xl border border-t-[3px] bg-card shadow-sm transition-shadow hover:shadow-md", STAGE_EDGE[stage])}>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <RfqStagePill stage={stage} sealed={p.sealed} />
          <RfqNumber rfq={rfq} />
        </div>

        <h3 className="text-base font-black leading-snug text-foreground">
          <Link href={p.offersHref} className="rounded-sm text-start hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
            {rfq.title}
          </Link>
        </h3>

        <div className="flex flex-wrap gap-1.5">
          <Tag icon={LayoutGrid} tone="info">
            {p.projectLabel}
          </Tag>
          {rfqCategories(rfq).map((c) => (
            <Tag key={c}>{displayCategory(c, locale)}</Tag>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Tag icon={Package}>{t("rfqv_products", { count: productCount(rfq) })}</Tag>
          {stage !== "draft" && (
            <button type="button" onClick={p.onGlance} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <OffersTag rfq={rfq} sealed={p.sealed} directSupplier={p.directSupplier} />
            </button>
          )}
          <UnansweredTag count={queries.unanswered} />
          {rfq.requiresWarranty && (
            <Tag icon={ShieldCheck} tone="warn">
              {t("rfqv_warranty")}
            </Tag>
          )}
        </div>

        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">
            <Building2 size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate">
              {displayCity(rfq.city ?? "", locale)}
              {rfq.district ? ` — ${displayCity(rfq.district, locale)}` : ""}
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <CalendarDays size={14} className="shrink-0" aria-hidden="true" />
            {tag?.kind === "direct" ? null : <span>{tp("rfqpo.list.deadline_label")}</span>}
            <DeadlineText rfq={rfq} now={p.now} />
          </li>
          <li className="flex items-center gap-2">
            <User size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate">
              {t("rfqv_by")} <span className="font-bold text-foreground">{rfq.createdByUserName || t("rfq_admin_label")}</span>
            </span>
          </li>
        </ul>
      </div>

      <div className="space-y-2 border-t p-3">
        {stage === "draft" ? (
          p.canManage && (
            <div className="flex gap-2">
              <Button asChild size="sm" className="h-8 flex-1 gap-1.5 rounded-xl bg-module text-xs font-semibold text-module-foreground hover:bg-module/90">
                <Link href={p.editHref}>
                  <Send size={14} aria-hidden="true" />
                  {t("rfqv_complete")}
                </Link>
              </Button>
              {p.canDelete && (
                <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 rounded-xl border border-destructive/30 bg-card text-xs font-semibold text-destructive shadow-none hover:bg-destructive/5 hover:text-destructive" onClick={p.onDelete}>
                  <Trash2 size={14} aria-hidden="true" />
                  {t("rfqv_delete")}
                </Button>
              )}
            </div>
          )
        ) : (
          <>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline" className="h-8 flex-1 gap-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground shadow-none hover:border-cta/30 hover:bg-card hover:text-foreground">
                <Link href={p.offersHref}>
                  <Eye size={14} aria-hidden="true" />
                  {t("rfqv_view_offers")}
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 flex-1 gap-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground shadow-none hover:border-cta/30 hover:bg-card hover:text-foreground">
                <Link href={`${p.offersHref}?tab=inquiries`}>
                  <Info size={14} aria-hidden="true" />
                  {t("rfqv_inquiries")}
                  {queries.total > 0 && <span className="tabular-nums">({queries.total})</span>}
                </Link>
              </Button>
              {p.canManage && rfq.status === "New" && tag?.kind === "left" && (
                <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 rounded-xl border border-border bg-card p-0 text-xs font-semibold text-muted-foreground shadow-none hover:border-cta/30 hover:bg-card hover:text-foreground" onClick={p.onShare} aria-label={t("rfqv_share")} title={t("rfqv_share")}>
                  <Link2 size={14} aria-hidden="true" />
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 rounded-xl border border-border bg-card p-0 text-xs font-semibold text-muted-foreground shadow-none hover:border-cta/30 hover:bg-card hover:text-foreground" onClick={p.onPrint} aria-label={tp("rfqpo.print.button")} title={tp("rfqpo.print.button")}>
                <Printer size={14} aria-hidden="true" />
              </Button>
            </div>
            {extendable && (
              <button type="button" onClick={p.onExtend} className="block w-full rounded text-center text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {tag?.kind === "passed" ? tp("rfqpo.list.republish") : t("rfqv_edit_open")}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  )
}

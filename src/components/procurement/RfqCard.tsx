"use client"

// One RFQ as a card (the reference prototype's RFQ grid): a coloured top edge
// and a status pill that say its stage at a glance, its number, its title, the
// project and category, what it asks and what came back, its city, deadline
// and author — and the actions its stage allows.

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Building2, CalendarDays, Eye, FileText, Info, LayoutGrid, Link2, Lock, Package, RotateCw, Send, ShieldCheck, Trash2, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { displayCategory, displayCity } from "@/lib/constants"
import { displayDocNumber } from "@/lib/procurement/format"
import { deadlinePill, productCount, rfqStage, STAGE_TONE, type RfqLike, type RfqStage } from "@/lib/procurement/rfq-view"
import { cn } from "@/lib/utils"

export const STAGE_EDGE: Record<RfqStage, string> = {
  draft: "border-t-muted-foreground/40",
  open: "border-t-cta",
  compare: "border-t-warning",
  closed_empty: "border-t-destructive",
  awarded: "border-t-success",
}

const PILL: Record<(typeof STAGE_TONE)[RfqStage], string> = {
  mute: "bg-muted text-muted-foreground",
  info: "bg-cta/10 text-cta",
  warn: "bg-warning/10 text-warning",
  bad: "bg-destructive/10 text-destructive",
  ok: "bg-success/10 text-success",
}

export type RfqRow = RfqLike & {
  id: string
  title?: string
  rfqNumber?: string | null
  category?: string
  city?: string
  district?: string
  deadline?: string
  createdByUserName?: string
  requiresWarranty?: boolean
  projectId?: string | null
}

export function RfqStagePill({ stage, sealed }: { stage: RfqStage; sealed: boolean }) {
  const t = useTranslations("Portal.Contractor")
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", PILL[STAGE_TONE[stage]])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {t(stage === "open" && sealed ? "rfqv_stage_open_sealed" : `rfqv_stage_${stage}`)}
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

function Tag({ icon: Icon, tone = "mute", children }: { icon?: typeof LayoutGrid; tone?: "mute" | "info" | "ok" | "warn" | "violet"; children: ReactNode }) {
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

export interface RfqCardProps {
  rfq: RfqRow
  projectName: string | null
  sealed: boolean
  now: Date
  offersHref: string
  editHref: string
  canManage: boolean
  canEdit: boolean
  canDelete: boolean
  onGlance: () => void
  onShare: () => void
  onDelete: () => void
  onRepublish: () => void
}

export function RfqCard(p: RfqCardProps) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const { rfq } = p
  const stage = rfqStage(rfq, p.now)
  const pill = deadlinePill(rfq, p.now)
  const offers = rfq.offersCount ?? 0
  const products = productCount(rfq)

  return (
    <article className={cn("flex flex-col rounded-2xl border border-t-[3px] bg-card shadow-sm transition-shadow hover:shadow-md", STAGE_EDGE[stage])}>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <RfqStagePill stage={stage} sealed={p.sealed} />
          <RfqNumber rfq={rfq} />
        </div>

        <h3 className="text-base font-black leading-snug text-foreground">
          <button type="button" onClick={p.onGlance} className="text-start hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm" dir="auto">
            {rfq.title}
          </button>
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {p.projectName && (
            <Tag icon={LayoutGrid} tone="info">
              {p.projectName}
            </Tag>
          )}
          {rfq.category && <Tag>{displayCategory(rfq.category, locale)}</Tag>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Tag icon={Package}>{t("rfqv_products", { count: products })}</Tag>
          {stage !== "draft" && (
            <button type="button" onClick={p.onGlance} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Tag icon={FileText} tone={offers > 0 ? "ok" : "mute"}>
                {t("rfqv_offers", { count: offers })}
                {p.sealed && offers > 0 && <Lock size={11} aria-label={t("rfqv_sealed")} />}
              </Tag>
            </button>
          )}
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
          <li className="flex flex-wrap items-center gap-2" suppressHydrationWarning>
            <CalendarDays size={14} className="shrink-0" aria-hidden="true" />
            <span>{t("rfqv_deadline", { date: rfq.deadline ? new Date(rfq.deadline).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long" }) : t("rfq_not_set") })}</span>
            {pill?.kind === "passed" && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{t("rfqv_passed")}</span>}
            {pill?.kind === "soon" && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">{t("rfqv_soon", { days: pill.days })}</span>}
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
                </Link>
              </Button>
              {stage === "open" && (
                <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 rounded-xl p-0 border border-border bg-card text-xs font-semibold text-muted-foreground shadow-none hover:border-cta/30 hover:bg-card hover:text-foreground" onClick={p.onShare} aria-label={t("rfqv_share")} title={t("rfqv_share")}>
                  <Link2 size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
            {stage === "open" && p.canManage && p.canEdit && (
              <Link href={p.editHref} className="block rounded text-center text-xs font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("rfqv_edit_open")}
              </Link>
            )}
            {stage === "closed_empty" && p.canManage && p.canEdit && (
              <Button size="sm" variant="outline" className="h-8 w-full gap-1.5 rounded-xl border border-warning/40 bg-card text-xs font-semibold text-warning shadow-none hover:bg-warning/10 hover:text-warning" onClick={p.onRepublish}>
                <RotateCw size={14} aria-hidden="true" />
                {t("rfqv_republish")}
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  )
}

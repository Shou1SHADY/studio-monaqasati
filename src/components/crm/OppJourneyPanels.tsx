"use client"

// The panels of an opportunity's page in the journey v1.1 — each shows a FACT and the one act that moves the deal on.
// Co-located: they read the same deal, pricing state and offer, and render as one page.

import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Circle,
  Clock,
  Coins,
  FileText,
  History,
  Loader2,
  Pause,
  RefreshCcw,
  Send,
  ShieldCheck,
  Trophy,
  Undo2,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { CrmPanel, CrmRow } from "@/components/crm/CrmShell"
import { OfferPdfButton } from "@/components/crm/OfferPdfButton"
import { daysSince, iso, ltr } from "@/components/crm/OppBits"
import {
  OPEN_OPPORTUNITY_STAGES,
  daysUntil,
  fitCheck,
  formatCrmDate,
  formatSar,
  gateLabelKey,
  isGateDone,
  isOpportunityOpen,
  opportunityGates,
  stageHistory,
  type CrmContact,
  type CrmOpportunity,
  type CrmOrgProfile,
  type CrmQuotation,
  type GateContext,
  type StageHistoryEntry,
} from "@/lib/crm"
import { isReplaced, type PricingState } from "@/lib/crm-journey"
import type { OpportunityFile } from "@/lib/crm-opportunity-writes"
import { displayDocNumber } from "@/lib/sales-numbering"
import { cn } from "@/lib/utils"

const rowIcon = (done: boolean, warn = false) =>
  done ? (
    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
  ) : (
    <Circle size={16} className={cn("mt-0.5 shrink-0", warn ? "text-warning" : "text-muted-foreground/40")} aria-hidden="true" />
  )

/** The open-deal footer every stage shares: postpone and close are always there, with a written reason (OPP-05 #4). */
function CloseActions({ canManage, canClose, onHold, onLost }: { canManage: boolean; canClose: boolean; onHold: () => void; onLost: () => void }) {
  const t = useTranslations("Portal.Shared")
  return (
    <>
      {canManage && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onHold}>
          <Pause size={13} aria-hidden="true" />
          {t("crm_hold_btn")}
        </Button>
      )}
      {canClose && (
        <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={onLost}>
          <XCircle size={13} aria-hidden="true" />
          {t("crm_close_lost_btn")}
        </Button>
      )}
    </>
  )
}

/**
 * «Before moving to qualified» (OPP-03): three conditions, each a fact — the tender documents uploaded (by file), the
 * eligibility check (only a computed conflict blocks; «not checked» warns), and the bid decision recorded with a name.
 */
export function QualifyPanel({
  opp,
  ctx,
  tenderFiles,
  busy,
  canManage,
  canClose,
  onGo,
  onUndoGo,
  onNoGo,
  onQualify,
  onHold,
  onLost,
}: {
  opp: CrmOpportunity
  ctx: GateContext
  tenderFiles: OpportunityFile[]
  busy: boolean
  canManage: boolean
  canClose: boolean
  onGo: () => void
  onUndoGo: () => void
  onNoGo: () => void
  onQualify: () => void
  onHold: () => void
  onLost: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const gates = opportunityGates(opp)
  if (gates.length === 0) return null
  const fit = fitCheck(opp, ctx.profile, ctx.offerValue)
  const blocking = gates.filter((g) => !isGateDone(opp, g, ctx))
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <CrmPanel
      icon={CheckCircle2}
      title={t("crm_qualify_title")}
      action={
        <Badge variant="outline" className={cn("text-[10px]", blocking.length ? "border-warning/20 bg-warning/10 text-warning" : "border-success/20 bg-success/10 text-success")}>
          {blocking.length ? t("crm_qualify_blocking", { count: blocking.length }) : t("crm_qualify_clear")}
        </Badge>
      }
    >
      <ul className="divide-y">
        {gates.map((gate) => {
          const done = isGateDone(opp, gate, ctx)
          if (gate.auto === "tender_docs") {
            return (
              <li key={gate.id} className="flex items-start gap-3 px-4 py-3">
                {rowIcon(done)}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t(gateLabelKey(gate))}</p>
                  {tenderFiles.length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {tenderFiles.map((f) => (
                        <span key={f.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px]">
                          <FileText size={11} aria-hidden="true" />
                          <bdi dir="auto">{f.name}</bdi>
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{t("crm_qualify_docs_hint")}</p>
                  )}
                </div>
              </li>
            )
          }
          if (gate.auto === "fit") {
            return (
              <li key={gate.id} className="flex items-start gap-3 px-4 py-3">
                {rowIcon(fit.status === "ok", fit.status === "unchecked")}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {t(gateLabelKey(gate))}
                    {fit.status === "unchecked" && (
                      <Badge variant="outline" className="border-warning/20 bg-warning/10 text-[10px] text-warning">{t("crm_fit_warn_badge")}</Badge>
                    )}
                    {fit.status === "conflict" && (
                      <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-[10px] text-destructive">{t("crm_fit_conflict_badge")}</Badge>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fit.status === "unchecked"
                      ? t(`crm_fit_unchecked_${fit.eligibility.unknown}`)
                      : fit.status === "conflict"
                        ? !fit.eligibility.eligible
                          ? t("crm_eligibility_blocked")
                          : t("crm_capacity_exceeds")
                        : t("crm_fit_ok")}
                  </p>
                </div>
              </li>
            )
          }
          if (gate.auto === "go") {
            const decided = opp.goDecision?.go === true
            return (
              <li key={gate.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                {rowIcon(decided)}
                <div className="min-w-[10rem] flex-1">
                  <p className="text-sm font-semibold">{decided ? t("crm_go_decided") : t(gateLabelKey(gate))}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {decided && opp.goDecision
                      ? `${opp.goDecision.byName} · ${formatCrmDate(opp.goDecision.at, locale)}`
                      : t("crm_go_question")}
                  </p>
                </div>
                {canManage && isOpportunityOpen(opp) && (
                  <div className="flex shrink-0 gap-1.5">
                    {decided ? (
                      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={onUndoGo} disabled={busy}>
                        <Undo2 size={12} aria-hidden="true" />
                        {t("crm_go_undo")}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" className="h-8 gap-1" onClick={onGo} disabled={busy}>
                          <CheckCircle2 size={12} aria-hidden="true" />
                          {t("crm_go_yes")}
                        </Button>
                        {canClose && (
                          <Button size="sm" variant="outline" className="h-8 text-destructive" onClick={onNoGo} disabled={busy}>
                            {t("crm_go_no")}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          }
          return (
            <li key={gate.id} className="flex items-start gap-3 px-4 py-3">
              {rowIcon(done)}
              <p className="text-sm font-semibold">{t(gateLabelKey(gate))}</p>
            </li>
          )
        })}
      </ul>
      {isOpportunityOpen(opp) && (
        <div className="space-y-3 border-t bg-muted/20 p-4">
          {blocking.length > 0 && (
            <p className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t("crm_qualify_blocked_by", { items: blocking.map((g) => t(gateLabelKey(g))).join(" · ") })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" disabled={!canManage || busy || blocking.length > 0} onClick={onQualify}>
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Arrow size={13} aria-hidden="true" />}
              {t("crm_advance_to", { stage: t("crm_opp_stage_qualified") })}
            </Button>
            <CloseActions canManage={canManage} canClose={canClose} onHold={onHold} onLost={onLost} />
          </div>
        </div>
      )}
    </CrmPanel>
  )
}

/** Eligibility and capacity, checked on the best figure available (OPP-03 #4). */
export function EligibilityPanel({ opp, profile, offerValue, settingsHref }: { opp: CrmOpportunity; profile: CrmOrgProfile | null | undefined; offerValue: number | null; settingsHref: string }) {
  const t = useTranslations("Portal.Shared")
  const fit = fitCheck(opp, profile, offerValue)
  const e = fit.eligibility
  const unchecked = <span className="font-normal text-muted-foreground">{t("crm_fit_not_checked")}</span>
  return (
    <CrmPanel
      icon={ShieldCheck}
      title={t("crm_eligibility_panel")}
      action={
        <Link href={settingsHref} className="rounded text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("crm_settings_page_title")}
        </Link>
      }
    >
      <CrmRow label={t("crm_classification_activity")}>{e.activity ? t(`crm_activity_class_${e.activity}`) : <span className="font-normal text-muted-foreground">{t("crm_not_specified")}</span>}</CrmRow>
      <CrmRow label={t("crm_required_grade")}>
        {e.unknown ? unchecked : <span dir="ltr">{t("crm_eligibility_detail", { required: e.required ?? 0, held: e.held ?? 0 })}</span>}
      </CrmRow>
      <CrmRow label={t("crm_capacity_impact")}>
        {fit.value > 0 ? (
          <Badge variant="outline" className={cn("text-[10px]", fit.capacityOk ? "border-success/20 bg-success/10 text-success" : "border-destructive/20 bg-destructive/10 text-destructive")}>
            {t(fit.capacityOk ? "crm_capacity_within" : "crm_capacity_exceeds")}
          </Badge>
        ) : (
          unchecked
        )}
      </CrmRow>
      <p className="flex items-start gap-2 border-t px-4 py-3 text-[11px] text-muted-foreground">
        <Clock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {t("crm_fit_explain")}
      </p>
    </CrmPanel>
  )
}

/** «Next step: pricing» in «qualified» (OPP-04 #3): the one act that moves the deal — the request to Sales. */
export function PricingStepPanel({
  canManage,
  canClose,
  onRequest,
  onHold,
  onLost,
}: {
  canManage: boolean
  canClose: boolean
  onRequest: () => void
  onHold: () => void
  onLost: () => void
}) {
  const t = useTranslations("Portal.Shared")
  return (
    <CrmPanel icon={Send} title={t("crm_next_pricing_title")} action={<Badge variant="outline" className="text-[10px]">{t("crm_opp_stage_qualified")}</Badge>}>
      <p className="m-4 flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        {t("crm_next_pricing_desc")}
      </p>
      <div className="flex flex-wrap gap-2 border-t bg-muted/20 p-4">
        {canManage && (
          <Button size="sm" variant="accent" className="gap-1.5" onClick={onRequest}>
            <Send size={13} aria-hidden="true" />
            {t("crm_price_title")}
          </Button>
        )}
        <CloseActions canManage={canManage} canClose={canClose} onHold={onHold} onLost={onLost} />
      </div>
    </CrmPanel>
  )
}

/**
 * «Value» (OPP-04 #2): three lines — the optional estimate (never shown to the client), the offer from Sales (read only,
 * value and PDF), and the awarded value (recorded on a sent offer). No cost, no margin, no approval limit here.
 */
export function ValuePanel({
  opp,
  offer,
  pricing,
  contact,
  canManage,
  awardAllowed,
  onEstimate,
  onAward,
}: {
  opp: CrmOpportunity
  offer: CrmQuotation | null
  pricing: PricingState
  contact: CrmContact | null
  canManage: boolean
  awardAllowed: boolean
  onEstimate: () => void
  onAward: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const open = isOpportunityOpen(opp)
  const legacyOffer = !offer && (opp.submittedPrice || 0) > 0 ? opp.submittedPrice : null
  const offerAmount = offer?.amount ?? legacyOffer
  const partial = (opp.awardedValue || 0) > 0 && (offerAmount || 0) > 0 && (opp.awardedValue as number) < (offerAmount as number)
  const offerStatus =
    pricing.kind === "at_sales" || pricing.kind === "revision"
      ? t("crm_value_offer_waiting")
      : pricing.kind === "declined"
        ? t("crm_status_declined")
        : opp.stage === "new" || opp.stage === "qualified"
          ? t("crm_value_offer_after_qualified")
          : t("crm_value_offer_not_requested")
  return (
    <CrmPanel icon={Coins} title={t("crm_value_title")} action={open ? <Badge variant="outline" className="text-[10px]">{t(`crm_opp_stage_${opp.stage}`)}</Badge> : undefined}>
      <ol className="divide-y">
        <li className="flex items-center gap-3 px-4 py-3">
          {rowIcon(opp.value > 0)}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("crm_value_estimate_label")}</span>
            <span className="block text-[11px] text-muted-foreground">{t("crm_value_estimate_sub")}</span>
          </span>
          <span className={cn("text-sm font-black", opp.value > 0 ? "" : "text-muted-foreground/70")} dir={opp.value > 0 ? "ltr" : undefined}>
            {opp.value > 0 ? formatSar(opp.value, locale) : t("crm_no_estimate")}
          </span>
          {canManage && open && (
            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={onEstimate}>
              {t(opp.value > 0 ? "crm_edit_short" : "crm_value_set")}
            </Button>
          )}
        </li>
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          {rowIcon(offerAmount !== null && offerAmount !== undefined)}
          <span className="min-w-[8rem] flex-1">
            <span className="flex items-center gap-2 text-sm font-semibold">
              {t("crm_value_offer_label")}
              <Badge variant="outline" className="border-indigo/20 bg-indigo/10 text-[10px] text-indigo">{t("crm_from_sales")}</Badge>
            </span>
            <span className="block text-[11px] text-muted-foreground">{t("crm_value_offer_sub")}</span>
          </span>
          {offerAmount ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black" dir="ltr">{formatSar(offerAmount, locale)}</span>
              {offer && <OfferPdfButton quote={offer} contact={contact} />}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{offerStatus}</span>
          )}
        </li>
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          {rowIcon((opp.awardedValue || 0) > 0)}
          <span className="min-w-[8rem] flex-1">
            <span className="block text-sm font-semibold">{t("crm_value_award_label")}</span>
            <span className="block text-[11px] text-muted-foreground">{t("crm_value_award_sub")}</span>
          </span>
          {(opp.awardedValue || 0) > 0 ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black" dir="ltr">{formatSar(opp.awardedValue, locale)}</span>
              {partial && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-[10px] text-warning">{t("crm_award_partial")}</Badge>}
            </span>
          ) : awardAllowed ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onAward}>
              <Trophy size={13} aria-hidden="true" />
              {t("crm_record_award_btn")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{t(pricing.kind === "revision" ? "crm_value_award_after_revision" : "crm_value_award_after_offer")}</span>
          )}
        </li>
      </ol>
    </CrmPanel>
  )
}

/**
 * «The offer from Sales» (OPP-04): with Sales since when, under which request; the versions that reached the client —
 * value, PDF, current or replaced; «ask for a revised version»; or why Sales could not price it, with the three ways on.
 */
export function OfferPanel({
  opp,
  pricing,
  versions,
  contact,
  today,
  canManage,
  canClose,
  onRevision,
  onRequestAgain,
  onHold,
  onLost,
}: {
  opp: CrmOpportunity
  pricing: PricingState
  versions: CrmQuotation[]
  contact: CrmContact | null
  today: string
  canManage: boolean
  canClose: boolean
  onRevision: () => void
  onRequestAgain: () => void
  onHold: () => void
  onLost: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const open = isOpportunityOpen(opp)
  if (pricing.kind === "none" && versions.length === 0) return null
  return (
    <CrmPanel icon={FileText} title={t("crm_offer_panel_title")} action={<Badge variant="outline" className="border-indigo/20 bg-indigo/10 text-[10px] text-indigo">{t("crm_read_only")}</Badge>}>
      {(pricing.kind === "at_sales" || pricing.kind === "revision") && (
        <div className="m-4 space-y-1 rounded-lg border border-indigo/20 bg-indigo/5 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-bold text-indigo">
            <Clock size={13} aria-hidden="true" />
            {t(pricing.kind === "revision" ? "crm_status_revision" : "crm_status_at_sales", { days: daysSince(pricing.request.requestedAt, today) })}
          </p>
          <p className="text-muted-foreground">
            {[
              t("crm_offer_request_no", { number: iso(displayDocNumber(pricing.request.requestNumber, locale)) }),
              t("crm_offer_request_sent", { date: formatCrmDate(pricing.request.requestedAt, locale) }),
              pricing.request.dueDate ? t("crm_offer_request_due", { date: formatCrmDate(pricing.request.dueDate, locale), days: Math.max(0, daysUntil(pricing.request.dueDate) ?? 0) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {pricing.kind === "revision" && pricing.request.note && <p className="text-foreground/80">«{pricing.request.note}»</p>}
          {pricing.kind === "at_sales" && (
            <p className="text-muted-foreground">
              {t("crm_offer_request_carried", { files: pricing.request.files?.length ?? 0 })}
              {pricing.request.note ? ` · ${t("crm_price_note")}` : ""}
            </p>
          )}
        </div>
      )}

      {pricing.kind === "declined" && (
        <div className="m-4 space-y-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="flex items-start gap-1.5 text-xs font-bold text-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t("crm_offer_declined", {
                date: formatCrmDate(pricing.request.decidedAt, locale),
                reason: pricing.request.declineReason ? t(`sales_rq_reason_${pricing.request.declineReason}`) : "—",
              })}
              {pricing.request.declineNote && <span className="block font-normal text-foreground/80">«{pricing.request.declineNote}»</span>}
            </span>
          </p>
          {open && (
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <Button size="sm" className="gap-1.5" onClick={onRequestAgain}>
                  <RefreshCcw size={13} aria-hidden="true" />
                  {t("crm_offer_request_again")}
                </Button>
              )}
              <CloseActions canManage={canManage} canClose={canClose} onHold={onHold} onLost={onLost} />
            </div>
          )}
        </div>
      )}

      {pricing.kind === "offer" && (
        <p
          className={cn(
            "m-4 flex items-start gap-1.5 rounded-lg border p-3 text-xs font-semibold",
            pricing.expired ? "border-warning/30 bg-warning/5 text-warning" : "border-success/20 bg-success/5 text-success"
          )}
        >
          {pricing.expired ? <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {pricing.expired
            ? t("crm_offer_expired_banner", { date: formatCrmDate(pricing.quote.validUntil, locale) })
            : [
                pricing.quote.sentAt ? t("crm_offer_sent_on", { date: formatCrmDate(pricing.quote.sentAt, locale) }) : null,
                pricing.quote.validUntil
                  ? t("crm_offer_valid_until", { date: formatCrmDate(pricing.quote.validUntil, locale), days: Math.max(0, daysUntil(pricing.quote.validUntil) ?? 0) })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      )}

      {versions.length > 0 && (
        <ul className="divide-y border-t">
          {versions.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-[10rem] flex-1">
                <p className="text-sm font-black">
                  <bdi dir="ltr">{displayDocNumber(q.quotationNumber, locale)}</bdi>
                  <span className={cn("ms-2", isReplaced(q, versions) && "text-muted-foreground line-through")} dir="ltr">
                    {formatSar(q.amount, locale)}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">{q.sentAt ? t("crm_offer_sent_on", { date: formatCrmDate(q.sentAt, locale) }) : formatCrmDate(q.date, locale)}</p>
                <div className="mt-1.5">
                  <OfferPdfButton quote={q} contact={contact} />
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn("text-[10px]", isReplaced(q, versions) ? "border-border bg-muted text-muted-foreground" : "border-success/20 bg-success/10 text-success")}
              >
                {t(isReplaced(q, versions) ? "crm_offer_superseded" : q.status === "accepted" ? "crm_offer_accepted" : q.status === "rejected" ? "crm_offer_lost" : "crm_offer_current")}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {open && pricing.kind === "offer" && canManage && (
        <div className="border-t p-4">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onRevision}>
            <RefreshCcw size={13} aria-hidden="true" />
            {t("crm_revision_title")}
          </Button>
        </div>
      )}
    </CrmPanel>
  )
}

/**
 * «After the award» (OPP-06 #5): what happens follows «what we deliver». A project goes to Project Management with the
 * handover file (where its manager is chosen); supply and service are not handed to Projects — they wait for Sales' sales
 * order, whose number shows here once it exists.
 */
export function AfterAwardPanel({
  opp,
  offer,
  projectDeal,
  salesOrderNumber,
  canClose,
  onHandover,
}: {
  opp: CrmOpportunity
  offer: CrmQuotation | null
  projectDeal: boolean
  salesOrderNumber: string | null
  canClose: boolean
  onHandover: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  return (
    <CrmPanel icon={projectDeal ? Building2 : Trophy} title={t("crm_after_award_title")} action={<Badge variant="outline" className="text-[10px]">{projectDeal ? t("crm_deliverable_project") : t("crm_deliverable_supply_service")}</Badge>}>
      <div className="space-y-3 p-4">
        <p className="text-sm font-bold">{opp.title}</p>
        <p className="text-[11px] text-muted-foreground">{[iso(displayDocNumber(opp.docNumber, locale)), opp.contactName].filter(Boolean).join(" · ")}</p>
        <div className="rounded-lg border border-success/20 bg-success/5 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-bold text-success">
            <Trophy size={13} aria-hidden="true" />
            {t("crm_awarded_banner")}
            {opp.wonReason && ` — ${t(`crm_won_reason_${opp.wonReason}`)}`}
          </p>
          <p className="mt-1 text-muted-foreground" dir="auto">
            {[
              opp.awardedValue ? ltr(formatSar(opp.awardedValue, locale)) : null,
              iso(displayDocNumber(offer?.quotationNumber ?? opp.awardedQuotationNumber, locale)) || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {projectDeal ? (
          opp.handoverStatus === "pending" ? (
            <p className="text-xs text-muted-foreground">{t("crm_handover_waiting", { pm: opp.projectManagerName || "—" })}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" className="gap-1.5" disabled={!canClose} onClick={onHandover} title={!canClose ? t("crm_close_no_permission") : undefined}>
                <Building2 size={13} aria-hidden="true" />
                {t("crm_handover_btn")}
              </Button>
              <span className="text-[11px] text-muted-foreground">{t("crm_handover_pm_chosen_there")}</span>
            </div>
          )
        ) : salesOrderNumber ? (
          <p className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>
              <span className="block text-[11px] text-muted-foreground">{t("crm_sales_order_created")}</span>
              <span className="font-black" dir="ltr">{salesOrderNumber}</span>
            </span>
            <Badge variant="outline" className="border-indigo/20 bg-indigo/10 text-[10px] text-indigo">{t("crm_from_sales")}</Badge>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 rounded-lg border border-indigo/20 bg-indigo/5 p-3 text-xs text-indigo">
            <Clock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("crm_waiting_sales_order")}
          </p>
        )}
      </div>
    </CrmPanel>
  )
}

/**
 * «Path and log» (OPP-05 #1): every move with its fact, who and when — the request number, each offer as it arrived,
 * the decision, a removed file.
 */
export function JourneyHistoryPanel({ opp, versions }: { opp: CrmOpportunity; versions: CrmQuotation[] }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const history = stageHistory(opp)
  type Line = { at: string; label: string; by?: string | null; tone: "stage" | "fact" | "bad" }
  const lines: Line[] = history.map((h: StageHistoryEntry) => {
    const stage = (OPEN_OPPORTUNITY_STAGES as readonly string[]).includes(h.event) || h.event === "won"
    const label =
      h.event === "go_decided"
        ? t(h.note === "no_go" ? "crm_history_no_go" : h.note === "undo" ? "crm_history_go_undone" : "crm_history_go_decided")
        : h.event === "pricing_requested"
          ? t("crm_history_pricing_requested", { number: iso(displayDocNumber(h.note, locale)) })
          : h.event === "revision_requested"
            ? t("crm_history_revision_requested", { number: iso(displayDocNumber(h.note, locale)) })
            : h.event === "file_deleted"
              ? t("crm_history_file_deleted", { name: h.note || "" })
              : stage
                ? t(`crm_opp_stage_${h.event}`)
                : t(`crm_history_${h.event}`)
    return { at: h.at, label, by: h.byName, tone: h.event === "lost" || h.event === "handover_rejected" ? "bad" : stage ? "stage" : "fact" }
  })
  // Each offer as it reached the client — Sales' own record, not a copy on the deal.
  for (const q of versions) {
    if (q.sentAt) lines.push({ at: q.sentAt, label: t("crm_history_offer_arrived", { number: iso(displayDocNumber(q.quotationNumber, locale)), amount: ltr(formatSar(q.amount, locale)) }), tone: "fact" })
  }
  lines.sort((a, b) => a.at.localeCompare(b.at))
  return (
    <CrmPanel icon={History} title={t("crm_history_title")} subtitle={t("crm_history_desc")}>
      <ol className="space-y-3 p-4">
        {lines.map((l, i) => (
          <li key={`${l.at}-${i}`} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                l.tone === "stage" ? "bg-primary" : l.tone === "bad" ? "bg-destructive" : "bg-muted-foreground/40"
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", l.tone === "stage" ? "font-bold" : "")}>{l.label}</span>
              <span className="block text-[11px] text-muted-foreground">{[formatCrmDate(l.at, locale), l.by].filter(Boolean).join(" · ")}</span>
            </span>
          </li>
        ))}
      </ol>
    </CrmPanel>
  )
}

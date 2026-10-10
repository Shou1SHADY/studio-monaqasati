"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import {
  Building2,
  CalendarDays,
  ClipboardList,
  ExternalLink,
  FileStack,
  FileText,
  Loader2,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Target,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link, useRouter } from "@/i18n/routing"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useModules } from "@/hooks/useCompanyModules"
import { useCrmData } from "@/hooks/useCrmData"
import { useCrmOrgProfile } from "@/hooks/useCrmOrgProfile"
import { useOpportunityFiles } from "@/hooks/useOpportunityFiles"
import { cn } from "@/lib/utils"
import { PROJECT_STATUS_BADGE_CLASSES, projectStatusLabelKey, resolveProjectStatus } from "@/lib/project-status"
import {
  ACTIVITY_TYPE_BADGE_CLASS,
  CRM_ACTIVITIES,
  CRM_OPPORTUNITIES,
  HANDOVER_BADGE_CLASS,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  OPPORTUNITY_STATE_BADGE_CLASS,
  TRACK_BADGE_CLASS,
  canRecordAward,
  daysUntil,
  formatCrmDate,
  formatSar,
  historyEntry,
  isProjectDeal,
  opportunityAddenda,
  opportunityDeliverables,
  opportunityState,
  opportunityTrack,
  primaryScope,
  priceGapToWinner,
  stageHistory,
  trackDateLabelKey,
  type GateContext,
} from "@/lib/crm"
import { currentOffer, deadlinePassed, hasSentOffer, offerVersions, pricingState, revisionPending } from "@/lib/crm-journey"
import { qualifyOpportunity, recordGoDecision } from "@/lib/crm-opportunity-writes"
import { SALES_ORDERS } from "@/lib/sales-orders"
import { CrmEmptyState, CrmListSkeleton, CrmPanel, CrmRow, crmBasePath, type CrmPortal } from "@/components/crm/CrmShell"
import { CrmOpportunityDialog } from "@/components/crm/CrmOpportunityDialog"
import { CrmCloseDialog, type CloseMode } from "@/components/crm/CrmCloseDialog"
import { CrmHandoverDialog } from "@/components/crm/CrmHandoverDialog"
import { CrmActivityDialog } from "@/components/crm/CrmActivityDialog"
import { CrmAddendumDialog } from "@/components/crm/CrmAddendumDialog"
import { OppFilesPanel } from "@/components/crm/OppFilesPanel"
import { OppNumber, OppStatusLine, todayKey } from "@/components/crm/OppBits"
import { AwardDialog, EstimateDialog, NoGoDialog, PricingRequestDialog, RevisionRequestDialog } from "@/components/crm/OppJourneyDialogs"
import {
  AfterAwardPanel,
  EligibilityPanel,
  JourneyHistoryPanel,
  OfferPanel,
  PricingStepPanel,
  QualifyPanel,
  ValuePanel,
} from "@/components/crm/OppJourneyPanels"

/**
 * One deal on one page (Opportunity journey v1.1). CRM owns the deal — its client, details, files, qualification,
 * follow-up, outcome and handover — and never prices it: the offer comes from Sales as a value and a PDF. Each panel
 * shows a fact and the one act that moves the deal on, recorded in the name of whoever acts.
 */
export function CrmOpportunityDetailView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  // Project status labels live with the projects module.
  const tProject = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const params = useParams()
  const search = useSearchParams()
  const opportunityId = String(params.id ?? "")
  const router = useRouter()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const { on } = useModules()
  const canManage = can("crm.manage")
  // Closing — award, loss, handover — is its own permission.
  const canClose = can("crm.close")

  const { orgId, contacts, contactsById, opportunities, quotations, quoteRequests, activities, teamMembers, actor, isLoading } = useCrmData({
    opportunities: true,
    quotations: true,
    quoteRequests: true,
    activities: true,
  })
  const { profile } = useCrmOrgProfile()
  const { files } = useOpportunityFiles(opportunityId, orgId)

  const base = crmBasePath(portal)
  // Projects exist on the contractor portal only, and only while the company has them on; otherwise a won deal continues
  // in Sales — the award then waits for the sales order, like supply and service (OPP-06 #5).
  const projectsBase = portal === "contractor" && on("project-management") ? "/contractor/projects" : null
  const today = todayKey()

  const opportunity = useMemo(() => opportunities.find((o) => o.id === opportunityId) ?? null, [opportunities, opportunityId])

  const projectRef = useMemoFirebase(() => {
    if (!firestore || !opportunity?.projectId) return null
    return doc(firestore, "projects", opportunity.projectId)
  }, [firestore, opportunity?.projectId])
  const { data: project } = useDoc(projectRef)
  const projectStatus = project ? resolveProjectStatus((project as { status?: string }).status) : null

  const versions = useMemo(() => offerVersions(quotations, opportunityId), [quotations, opportunityId])
  const offer = useMemo(() => currentOffer(quotations, opportunityId), [quotations, opportunityId])
  // Supply and service end in Sales' sales order (OPP-06 #5): its number, once Sales creates it from the accepted offer.
  const awardedOffer = useMemo(
    () => quotations.find((q) => q.id === opportunity?.awardedQuotationId) ?? offer,
    [quotations, opportunity?.awardedQuotationId, offer]
  )
  const orderRef = useMemoFirebase(() => {
    if (!firestore || !awardedOffer?.salesOrderId) return null
    return doc(firestore, SALES_ORDERS, awardedOffer.salesOrderId)
  }, [firestore, awardedOffer?.salesOrderId])
  const { data: salesOrder } = useDoc(orderRef)

  const [showEdit, setShowEdit] = useState(false)
  const [closeMode, setCloseMode] = useState<CloseMode | null>(null)
  const [dialog, setDialog] = useState<"handover" | "activity" | "addendum" | "nogo" | "price" | "revision" | "award" | "estimate" | null>(null)
  const [busy, setBusy] = useState(false)

  // The board's «move the date with an addendum» / «close it» on a tender whose deadline passed (OPP-08 #3).
  useEffect(() => {
    const action = search.get("do")
    if (action === "addendum") setDialog("addendum")
    if (action === "lost") setCloseMode("lost")
  }, [search])

  const oppActivities = useMemo(
    () => activities.filter((a) => a.opportunityId === opportunityId).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")),
    [activities, opportunityId]
  )
  const handedOverCount = useMemo(() => opportunities.filter((o) => opportunityState(o) === "handed_over").length, [opportunities])

  if (isLoading) return <CrmListSkeleton rows={8} />

  if (!opportunity) {
    return (
      <CrmEmptyState
        icon={Target}
        title={t("crm_opp_not_found")}
        description={t("crm_opp_not_found_desc")}
        action={
          <Button variant="outline" onClick={() => router.push(`${base}/opportunities`)}>
            {t("crm_opp_back_to_list")}
          </Button>
        }
      />
    )
  }

  const opp = opportunity
  const track = opportunityTrack(opp)
  const state = opportunityState(opp)
  const isOpen = state === "open"
  const contact = contactsById.get(opp.contactId) ?? null
  const offerSent = hasSentOffer(opp, offer)
  const gateCtx: GateContext = { profile, offerValue: offer?.amount ?? null, offerSent }
  const pricing = pricingState(opp, quoteRequests, quotations, today)
  // One version is won: while Sales prepares the next, the award waits for it to reach the client.
  const awardAllowed = canClose && canRecordAward(opp, offerSent) && !revisionPending(offer)
  const overdue = deadlinePassed(opp, offerSent, today)
  const addenda = opportunityAddenda(opp)
  const scope = primaryScope(opp)
  const days = daysUntil(opp.expectedCloseDate)
  // A supplier has no projects: its won deals always end in a sales order.
  const projectDeal = !!projectsBase && isProjectDeal(opp)
  const tenderFiles = files.filter((f) => f.kind === "tender_docs")
  const details = opp.details || opp.notes || ""

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      await fn()
      toast({ title: t(ok) })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const reactivate = () =>
    act(
      () =>
        updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
          state: "open",
          holdReason: null,
          holdUntil: null,
          stageHistory: [...stageHistory(opp), historyEntry("reactivated", actor.name)],
          updatedAt: serverTimestamp(),
        }),
      "crm_reactivated"
    )

  const closeProps = {
    canManage,
    canClose,
    onHold: () => setCloseMode("hold"),
    onLost: () => setCloseMode("lost"),
  }

  // The stage decides the panel that holds the next act (OPP-05).
  const stagePanel = !isOpen ? null : opp.stage === "new" ? (
    <QualifyPanel
      opp={opp}
      ctx={gateCtx}
      tenderFiles={tenderFiles}
      busy={busy}
      onGo={() => void act(() => recordGoDecision(firestore, opp, actor, true), "crm_go_saved")}
      onUndoGo={() => void act(() => recordGoDecision(firestore, opp, actor, null), "crm_go_undone")}
      onNoGo={() => setDialog("nogo")}
      onQualify={() => void act(() => qualifyOpportunity(firestore, opp, actor, gateCtx), "crm_opp_stage_updated")}
      {...closeProps}
    />
  ) : opp.stage === "qualified" ? (
    <PricingStepPanel onRequest={() => setDialog("price")} {...closeProps} />
  ) : null

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* One way back — the portal's trail above the page (OPP-09 #1). */}
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <OppNumber number={opp.docNumber} className="text-[11px]" />
            <Badge variant="outline" className={cn("text-[10px]", TRACK_BADGE_CLASS[track])}>
              {t(`crm_track_${track}`)}
            </Badge>
            <Badge variant="outline" className={cn("text-[10px]", OPPORTUNITY_STATE_BADGE_CLASS[state])}>
              {t(`crm_state_${state}`)}
            </Badge>
            {isOpen && <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opp.stage])}>{t(`crm_opp_stage_${opp.stage}`)}</Badge>}
            {isOpen && <OppStatusLine opp={opp} pricing={pricing} gateCtx={gateCtx} today={today} />}
          </div>
          <h1 className="text-2xl font-black text-primary">{opp.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`${base}/leads/${opp.contactId}`} className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {opp.contactName || contact?.name || t("crm_client")}
            </Link>
            {opp.createdByName && <span> · {t("crm_recorded_by", { name: opp.createdByName })}</span>}
          </p>
        </div>
        {canManage && (
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => setShowEdit(true)}>
            <Pencil size={15} aria-hidden="true" />
            {t("crm_opp_edit_title")}
          </Button>
        )}
      </header>

      {/* What is asked, at the top — the same text Sales receives with the pricing request (OPP-01 #3). */}
      {details && <p className="whitespace-pre-wrap rounded-xl border bg-muted/20 p-4 text-sm leading-relaxed text-foreground/90">{details}</p>}

      {overdue && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <CalendarDays size={18} className="shrink-0 text-destructive" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm font-bold">{t("crm_deadline_passed_banner", { date: formatCrmDate(opp.expectedCloseDate, locale) })}</p>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setDialog("addendum")}>
              {t("crm_update_deadline")}
            </Button>
          )}
          {canClose && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCloseMode("lost")}>
              {t("crm_close_it")}
            </Button>
          )}
        </div>
      )}

      {/* ---- outcome banners ------------------------------------------- */}
      {state === "won" && opp.handoverStatus === "rejected" && (
        <p className="flex items-start gap-1.5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t("crm_handover_rejected_banner", { pm: opp.projectManagerName || "" })}
            {opp.handoverRejectReason && ` — ${opp.handoverRejectReason}`}
          </span>
        </p>
      )}

      {state === "handed_over" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <Building2 size={18} className="shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
              {t("crm_state_handed_over_banner")}
              {opp.handoverStatus && (
                <Badge variant="outline" className={cn("text-[10px]", HANDOVER_BADGE_CLASS[opp.handoverStatus])}>
                  {t(`crm_handover_status_${opp.handoverStatus}`)}
                </Badge>
              )}
              {projectStatus && (
                <Badge variant="outline" className={cn("text-[10px]", PROJECT_STATUS_BADGE_CLASSES[projectStatus])}>
                  {t("crm_handover_project_status")}: {tProject(projectStatusLabelKey(projectStatus))}
                </Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {[
                opp.contractNumber,
                opp.durationDays ? t("crm_handover_days", { days: opp.durationDays }) : opp.durationMonths ? t("crm_handover_months", { months: opp.durationMonths }) : null,
                opp.projectManagerName,
              ]
                .filter(Boolean)
                .join(" · ") || formatCrmDate(opp.handedOverAt, locale)}
            </p>
          </div>
          {opp.projectId && projectsBase && (
            <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
              <Link href={`${projectsBase}/${opp.projectId}`}>
                <ExternalLink size={13} aria-hidden="true" />
                {t("crm_handover_open_project")}
              </Link>
            </Button>
          )}
        </div>
      )}

      {state === "lost" && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <XCircle size={18} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-bold text-foreground">
              {t("crm_state_lost_banner")}
              {opp.lostReason && ` — ${t(`crm_lost_reason_${opp.lostReason}`)}`}
              {opp.lostReason === "withdrew" && opp.goDecision?.reason && ` · ${t(`crm_nogo_reason_${opp.goDecision.reason}`)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {[
                opp.lostToCompetitor ? `${t("crm_lost_competitor")}: ${opp.lostToCompetitor}` : null,
                priceGapToWinner(opp) !== null ? `${t("crm_lost_price_gap")}: +${priceGapToWinner(opp)}%` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
            {opp.lessonLearned && <p className="pt-1 text-xs text-foreground/80">{opp.lessonLearned}</p>}
          </div>
        </div>
      )}

      {state === "on_hold" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/20 bg-warning/5 p-4">
          <Pause size={18} className="shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">
              {t("crm_state_on_hold_banner")}
              {opp.holdReason && ` — ${t(`crm_hold_reason_${opp.holdReason}`)}`}
            </p>
            {opp.holdUntil && (
              <p className="text-xs text-muted-foreground">
                {t("crm_hold_revisit")}: {formatCrmDate(opp.holdUntil, locale)}
              </p>
            )}
          </div>
          {canManage && (
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5" disabled={busy} onClick={() => void reactivate()}>
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
              {t("crm_reactivate_btn")}
            </Button>
          )}
        </div>
      )}

      {/* ---- the act that moves it on, and its value --------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {stagePanel}
        {state === "won" && (
          <AfterAwardPanel
            opp={opp}
            offer={awardedOffer}
            projectDeal={projectDeal}
            salesOrderNumber={salesOrder ? `SO-${(salesOrder as { orderNumber?: number }).orderNumber ?? ""}` : null}
            canClose={canClose}
            onHandover={() => setDialog("handover")}
          />
        )}
        {opp.stage === "new" && isOpen ? (
          <EligibilityPanel opp={opp} profile={profile} offerValue={offer?.amount ?? null} settingsHref={`${base}/settings`} />
        ) : (
          <ValuePanel
            opp={opp}
            offer={offer}
            pricing={pricing}
            contact={contact}
            canManage={canManage}
            awardAllowed={awardAllowed}
            onEstimate={() => setDialog("estimate")}
            onAward={() => setDialog("award")}
          />
        )}
        <OfferPanel
          opp={opp}
          pricing={pricing}
          versions={versions}
          contact={contact}
          today={today}
          onRevision={() => setDialog("revision")}
          onRequestAgain={() => setDialog("price")}
          {...closeProps}
        />
        {opp.stage === "new" && isOpen && (
          <ValuePanel
            opp={opp}
            offer={offer}
            pricing={pricing}
            contact={contact}
            canManage={canManage}
            awardAllowed={false}
            onEstimate={() => setDialog("estimate")}
            onAward={() => undefined}
          />
        )}
        {/* In proposal / negotiation the offer panel holds the actions; postpone and close stay reachable. */}
        {isOpen && (opp.stage === "proposal" || opp.stage === "negotiation") && pricing.kind !== "declined" && (
          <div className="flex flex-wrap items-start gap-2 lg:col-span-2">
            {canManage && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCloseMode("hold")}>
                <Pause size={13} aria-hidden="true" />
                {t("crm_hold_btn")}
              </Button>
            )}
            {canClose && (
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setCloseMode("lost")}>
                <XCircle size={13} aria-hidden="true" />
                {t("crm_close_lost_btn")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---- details -------------------------------------------------- */}
        <CrmPanel icon={FileText} title={t("crm_opp_details")}>
          <CrmRow label={t("crm_opp_track")}>{t(`crm_track_${track}`)}</CrmRow>
          <CrmRow label={t("crm_deliverable")}>{opportunityDeliverables(opp).map((d) => t(`crm_deliverable_${d}`)).join(" · ")}</CrmRow>
          <CrmRow label={t("crm_opp_scope")}>
            {scope || opp.customScopeType ? (
              <span className="flex flex-wrap items-center justify-end gap-1">
                {(opp.scopeTypes ?? []).map((s) => (
                  <Badge key={s} variant="outline" className="border-border bg-muted text-[10px] text-muted-foreground">
                    {t(`crm_scope_${s}`)}
                  </Badge>
                ))}
                {opp.customScopeType && (
                  <Badge variant="outline" className="border-warning/20 bg-warning/10 text-[10px] text-warning">
                    {opp.customScopeType}
                  </Badge>
                )}
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">{t("crm_not_specified")}</span>
            )}
          </CrmRow>
          {opp.route && <CrmRow label={t("crm_opp_route")}>{t(`crm_route_${opp.route}`)}</CrmRow>}
          {opp.contractKind && <CrmRow label={t("crm_opp_contract_kind")}>{t(`crm_contract_kind_${opp.contractKind}`)}</CrmRow>}
          {opp.source && <CrmRow label={t("crm_opp_source")}>{t(`crm_opp_source_${opp.source}`)}</CrmRow>}
          {opp.consultantContactId && (
            <CrmRow label={t("crm_opp_consultant")}>
              <Link href={`${base}/leads/${opp.consultantContactId}`} className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {opp.consultantName || t("crm_opp_consultant")}
              </Link>
            </CrmRow>
          )}
          {opp.previousContractValue != null && (
            <CrmRow label={t("crm_previous_contract_value")}>
              <span dir="ltr">{formatSar(opp.previousContractValue, locale)}</span>
            </CrmRow>
          )}
          <CrmRow label={t(trackDateLabelKey(track))}>
            {opp.expectedCloseDate ? (
              <span className="flex items-center gap-2">
                <span>{formatCrmDate(opp.expectedCloseDate, locale)}</span>
                {isOpen && days !== null && days <= 7 && (
                  <Badge variant="outline" className={cn("text-[10px]", days < 0 ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-warning/20 bg-warning/10 text-warning")}>
                    {days < 0 ? t("crm_opp_overdue") : t("crm_opp_due_soon", { days })}
                  </Badge>
                )}
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">{t("crm_opp_no_close_date")}</span>
            )}
          </CrmRow>
          <CrmRow label={t("crm_opp_probability")}>
            <span dir={typeof opp.probability === "number" ? "ltr" : undefined}>{typeof opp.probability === "number" ? `${opp.probability}%` : t("crm_prob_by_stage")}</span>
          </CrmRow>
          {opp.bidderCount != null && (
            <CrmRow label={t("crm_award_bidders")}>
              <span dir="ltr">
                {opp.bidderCount}
                {opp.ourRank != null && ` · #${opp.ourRank}`}
              </span>
            </CrmRow>
          )}
        </CrmPanel>

        <JourneyHistoryPanel opp={opp} versions={versions} />
      </div>

      {/* ---- files and photos (OPP-10) ---------------------------------- */}
      <OppFilesPanel opp={opp} files={files} offers={versions} contact={contact} actor={actor} canManage={canManage} />

      {/* ---- addenda ----------------------------------------------------- */}
      {(track === "tender" || addenda.length > 0) && (
        <CrmPanel
          icon={FileStack}
          title={t("crm_addenda_title")}
          subtitle={t("crm_addenda_desc")}
          action={
            canManage && isOpen ? (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setDialog("addendum")}>
                <Plus size={13} aria-hidden="true" />
                {t("crm_addendum_add_btn")}
              </Button>
            ) : undefined
          }
        >
          {addenda.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("crm_addenda_empty")}</p>
          ) : (
            <ul className="divide-y">
              {[...addenda].reverse().map((addendum) => (
                <li key={addendum.number} className="flex items-start gap-3 px-4 py-3">
                  <Badge variant="outline" className="shrink-0 border-primary/20 bg-primary/10 text-[10px] text-primary">
                    {t("crm_addendum_number", { number: addendum.number })}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{addendum.note}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {[
                        formatCrmDate(addendum.at, locale),
                        addendum.newDate ? `${t("crm_addendum_new_date")}: ${formatCrmDate(addendum.newDate, locale)}` : null,
                        addendum.newValue ? `${t("crm_addendum_new_value")}: ${formatSar(addendum.newValue, locale)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CrmPanel>
      )}

      {/* ---- activities -------------------------------------------------- */}
      <CrmPanel
        icon={ClipboardList}
        title={t("crm_nav_activities")}
        count={oppActivities.length}
        action={
          canManage ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setDialog("activity")}>
              <Plus size={13} aria-hidden="true" />
              {t("crm_activity_add_btn")}
            </Button>
          ) : undefined
        }
      >
        {oppActivities.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("crm_activities_empty")}</p>
        ) : (
          <ul className="divide-y">
            {oppActivities.map((activity) => {
              const due = daysUntil(activity.dueDate)
              const attached = files.filter((f) => f.activityId === activity.id)
              return (
                <li key={activity.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Badge variant="outline" className={cn("shrink-0 text-[10px]", ACTIVITY_TYPE_BADGE_CLASS[activity.type])}>
                    {t(`crm_activity_type_${activity.type}`)}
                  </Badge>
                  <span className="min-w-[10rem] flex-1">
                    <span className={cn("block text-sm", activity.done && "text-muted-foreground line-through")}>{activity.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {[activity.ownerName, attached.length ? t("crm_activity_attachments", { count: attached.length }) : null].filter(Boolean).join(" · ")}
                      {attached.length > 0 && <Paperclip size={10} className="ms-1 inline" aria-hidden="true" />}
                    </span>
                  </span>
                  {activity.dueDate && (
                    <span className={cn("shrink-0 text-[11px] font-semibold", activity.done ? "text-muted-foreground" : due !== null && due < 0 ? "text-destructive" : "text-muted-foreground")}>
                      <CalendarDays size={11} className="me-1 inline" aria-hidden="true" />
                      {formatCrmDate(activity.dueDate, locale)}
                    </span>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => {
                        if (!firestore) return
                        void updateDoc(doc(firestore, CRM_ACTIVITIES, activity.id), { done: !activity.done, updatedAt: serverTimestamp() })
                      }}
                    >
                      {t(activity.done ? "crm_activity_reopen" : "crm_activity_complete")}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CrmPanel>

      {/* ---- dialogs ----------------------------------------------------- */}
      <CrmOpportunityDialog key={`edit-${opp.id}`} open={showEdit} onOpenChange={setShowEdit} opportunity={opp} orgId={orgId} contacts={contacts} teamMembers={teamMembers} portal={portal} actor={actor} />
      {closeMode && (
        <CrmCloseDialog key={`close-${closeMode}`} open onOpenChange={(open) => !open && setCloseMode(null)} mode={closeMode} opportunity={opp} offer={offer} actor={actor} />
      )}
      {projectsBase && projectDeal && (
        <CrmHandoverDialog
          open={dialog === "handover"}
          onOpenChange={(o) => !o && setDialog(null)}
          opportunity={opp}
          contact={contact}
          orgId={orgId}
          teamMembers={teamMembers}
          handedOverCount={handedOverCount}
          projectsBasePath={projectsBase}
          acceptedOffer={awardedOffer}
          files={files}
          actor={actor}
        />
      )}
      <CrmAddendumDialog open={dialog === "addendum"} onOpenChange={(o) => !o && setDialog(null)} opportunity={opp} />
      <CrmActivityDialog
        open={dialog === "activity"}
        onOpenChange={(o) => !o && setDialog(null)}
        orgId={orgId}
        contacts={contacts}
        opportunities={opportunities}
        teamMembers={teamMembers}
        fixedContactId={opp.contactId}
        fixedOpportunityId={opp.id}
      />
      <NoGoDialog open={dialog === "nogo"} onOpenChange={(o) => !o && setDialog(null)} opp={opp} actor={actor} />
      <PricingRequestDialog open={dialog === "price"} onOpenChange={(o) => !o && setDialog(null)} opp={opp} actor={actor} files={files} />
      {offer && <RevisionRequestDialog open={dialog === "revision"} onOpenChange={(o) => !o && setDialog(null)} opp={opp} actor={actor} offer={offer} />}
      <AwardDialog open={dialog === "award"} onOpenChange={(o) => !o && setDialog(null)} opp={opp} actor={actor} offer={offer} contact={contact} />
      <EstimateDialog open={dialog === "estimate"} onOpenChange={(o) => !o && setDialog(null)} opp={opp} />
    </div>
  )
}

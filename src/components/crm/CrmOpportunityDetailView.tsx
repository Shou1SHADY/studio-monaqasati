"use client"

import { useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Circle,
  Coins,
  ExternalLink,
  FileStack,
  FileText,
  History,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Target,
  Trophy,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link, useRouter } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmApproval } from "@/hooks/useCrmApproval"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  ACTIVITY_TYPE_BADGE_CLASS,
  CRM_ACTIVITIES,
  CRM_OPPORTUNITIES,
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  OPPORTUNITY_STATE_BADGE_CLASS,
  TRACK_BADGE_CLASS,
  canAdvanceStage,
  checkEligibility,
  daysUntil,
  fitsCapacity,
  formatCrmDate,
  formatSar,
  gateLabelKey,
  historyEntry,
  isGateDone,
  isPartialAward,
  nextStage,
  opportunityAddenda,
  opportunityGates,
  opportunityMargin,
  opportunityState,
  opportunityTrack,
  priceGapToWinner,
  primaryScope,
  stageHistory,
  trackDateLabelKey,
  type CrmOpportunity,
  type OpportunityGate,
} from "@/lib/crm"
import {
  CrmEmptyState,
  CrmListSkeleton,
  CrmPanel,
  CrmRow,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"
import { CrmOpportunityDialog } from "@/components/crm/CrmOpportunityDialog"
import { CrmValueDialog, type ValueStep } from "@/components/crm/CrmValueDialog"
import { CrmCloseDialog, type CloseMode } from "@/components/crm/CrmCloseDialog"
import { CrmHandoverDialog } from "@/components/crm/CrmHandoverDialog"
import { CrmActivityDialog } from "@/components/crm/CrmActivityDialog"
import { CrmAddendumDialog } from "@/components/crm/CrmAddendumDialog"
import { EligibilityBadge } from "@/components/crm/CrmOpportunitiesView"
import { useCrmOrgProfile } from "@/hooks/useCrmOrgProfile"

/** The four rungs, in the order they get filled in. */
const LADDER: Array<{ step: ValueStep; field: keyof CrmOpportunity }> = [
  { step: "estimate", field: "value" },
  { step: "cost", field: "approvedCost" },
  { step: "submitted", field: "submittedPrice" },
  { step: "award", field: "awardedValue" },
]

/**
 * Everything about one deal on one page: what it is worth at each stage of
 * being priced, what still blocks it, what was said to the client, and the
 * actions that move it — including the handover that turns it into a project.
 */
export function CrmOpportunityDetailView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const params = useParams()
  const opportunityId = String(params.id ?? "")
  const router = useRouter()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("crm.manage")
  const { approvalLimit, canApprovePrices } = useCrmApproval()

  const { orgId, contacts, contactsById, opportunities, quotations, activities, teamMembers, isLoading } =
    useCrmData({ opportunities: true, quotations: true, activities: true })
  const { profile } = useCrmOrgProfile()

  const base = crmBasePath(portal)
  const projectsBase = portal === "contractor" ? "/contractor/projects" : "/supplier/projects"

  // Picked out of the org-scoped list rather than read by id: the query is
  // already filtered by `organizationId`, so a deal from another org simply is
  // not here — no separate cross-org guard to get wrong.
  const opportunity = useMemo(
    () => opportunities.find((o) => o.id === opportunityId) ?? null,
    [opportunities, opportunityId]
  )

  const [showEdit, setShowEdit] = useState(false)
  const [valueStep, setValueStep] = useState<ValueStep | null>(null)
  const [closeMode, setCloseMode] = useState<CloseMode | null>(null)
  const [showHandover, setShowHandover] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [showAddendum, setShowAddendum] = useState(false)
  const [busy, setBusy] = useState(false)

  const oppQuotations = useMemo(
    () =>
      quotations
        .filter((q) => q.opportunityId === opportunityId)
        .sort((a, b) => (b.version || 0) - (a.version || 0)),
    [quotations, opportunityId]
  )
  const oppActivities = useMemo(
    () =>
      activities
        .filter((a) => a.opportunityId === opportunityId)
        .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")),
    [activities, opportunityId]
  )
  const handedOverCount = useMemo(
    () => opportunities.filter((o) => opportunityState(o) === "handed_over").length,
    [opportunities]
  )

  if (isLoading) {
    return <CrmListSkeleton rows={8} />
  }

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
  const gateCtx = { profile }
  const gates = opportunityGates(opp)
  const doneGates = gates.filter((g) => isGateDone(opp, g, gateCtx))
  const remaining = gates.length - doneGates.length
  const next = nextStage(opp)
  const eligibility = checkEligibility(opp, profile)
  const withinCapacity = fitsCapacity(opp, profile)
  const history = stageHistory(opp)
  const addenda = opportunityAddenda(opp)
  const scope = primaryScope(opp)
  const margin = opportunityMargin(opp)
  const days = daysUntil(opp.expectedCloseDate)
  const approvalPending = (opp.approvalStatus || "none") === "pending"

  const patch = async (data: Record<string, unknown>, successKey: string) => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), { ...data, updatedAt: serverTimestamp() })
      toast({ title: t(successKey) })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const toggleGate = (gate: OpportunityGate) => {
    const current = opp.completedGates || []
    const next = current.includes(gate.id) ? current.filter((id) => id !== gate.id) : [...current, gate.id]
    void patch({ completedGates: next }, "crm_gate_updated")
  }

  const advance = () => {
    if (!next) return
    void patch(
      {
        // Reaching `won` is an outcome, not just another column.
        ...(next === "won" ? { stage: "won", state: "won" } : { stage: next }),
        stageHistory: [...history, historyEntry(next, opp.ownerName)],
      },
      "crm_opp_stage_updated"
    )
  }

  const reactivate = () =>
    void patch(
      {
        state: "open",
        holdReason: null,
        holdUntil: null,
        stageHistory: [...history, historyEntry("reactivated", opp.ownerName)],
      },
      "crm_reactivated"
    )

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <Link
        href={`${base}/opportunities`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {isRtl ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}
        {t("crm_opp_back_to_list")}
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <Badge variant="outline" className={cn("text-[10px]", TRACK_BADGE_CLASS[track])}>
              {t(`crm_track_${track}`)}
            </Badge>
            <Badge variant="outline" className={cn("text-[10px]", OPPORTUNITY_STATE_BADGE_CLASS[state])}>
              {t(`crm_state_${state}`)}
            </Badge>
            {isOpen && (
              <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opp.stage])}>
                {t(`crm_opp_stage_${opp.stage}`)}
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-black text-primary">{opp.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Link
              href={`${base}/leads/${opp.contactId}`}
              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {opp.contactName || contact?.name || t("crm_opp_contact")}
            </Link>
            {opp.ownerName && <span> · {opp.ownerName}</span>}
          </p>
        </div>
        {canManage && (
          <Button variant="outline" className="gap-2 shrink-0" onClick={() => setShowEdit(true)}>
            <Pencil size={15} />
            {t("crm_opp_edit_title")}
          </Button>
        )}
      </header>

      {/* ---- outcome banners ------------------------------------------- */}
      {state === "handed_over" && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-wrap items-center gap-3">
          <Building2 size={18} className="text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-foreground">{t("crm_state_handed_over_banner")}</p>
            <p className="text-xs text-muted-foreground">
              {[opp.contractNumber, opp.durationMonths ? t("crm_handover_months", { months: opp.durationMonths }) : null, opp.projectManagerName]
                .filter(Boolean)
                .join(" · ") || formatCrmDate(opp.handedOverAt, locale)}
            </p>
          </div>
          {opp.projectId && (
            <Button asChild variant="outline" size="sm" className="gap-1.5 shrink-0">
              <Link href={`${projectsBase}/${opp.projectId}`}>
                <ExternalLink size={13} />
                {t("crm_handover_open_project")}
              </Link>
            </Button>
          )}
        </div>
      )}

      {state === "lost" && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 flex items-start gap-3">
          <XCircle size={18} className="text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="font-bold text-sm text-foreground">
              {t("crm_state_lost_banner")}
              {opp.lostReason && ` — ${t(`crm_lost_reason_${opp.lostReason}`)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {[
                opp.lostToCompetitor ? `${t("crm_lost_competitor")}: ${opp.lostToCompetitor}` : null,
                priceGapToWinner(opp) !== null ? `${t("crm_lost_price_gap")}: +${priceGapToWinner(opp)}%` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
            {opp.lessonLearned && <p className="text-xs text-foreground/80 pt-1">{opp.lessonLearned}</p>}
          </div>
        </div>
      )}

      {state === "on_hold" && (
        <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 flex flex-wrap items-center gap-3">
          <Pause size={18} className="text-warning shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-foreground">
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
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              disabled={busy}
              onClick={reactivate}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {t("crm_reactivate_btn")}
            </Button>
          )}
        </div>
      )}

      {approvalPending && (
        <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 flex flex-wrap items-center gap-3">
          <ShieldCheck size={18} className="text-warning shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-foreground">{t("crm_approval_pending_banner")}</p>
            <p className="text-xs text-muted-foreground" dir="ltr">
              {formatSar(opp.approvalAmount || opp.submittedPrice || 0, locale)}
            </p>
          </div>
          {canManage && canApprovePrices && (opp.approvalAmount || 0) <= approvalLimit ? (
            <div className="flex items-center gap-2 shrink-0">
              {/* Sending back is the other half of approving. Without it the
                  only way to reject a price is to approve it and re-enter one. */}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy}
                onClick={() =>
                  void patch(
                    { approvalStatus: "none", submittedPrice: null, approvalAmount: null },
                    "crm_price_sent_back"
                  )
                }
              >
                {t("crm_send_back_btn")}
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() => void patch({ approvalStatus: "approved" }, "crm_price_approved")}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                {t("crm_approve_btn")}
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground shrink-0">{t("crm_approval_above_your_limit")}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ---- value ladder --------------------------------------------- */}
        <CrmPanel
          icon={Coins}
          title={t("crm_value_ladder")}
          subtitle={t("crm_value_ladder_desc")}
          action={
            margin !== null ? (
              <span className="text-xs font-bold" dir="ltr">
                <span className="text-muted-foreground font-normal">{t("crm_margin")} </span>
                <span className={margin >= 12 ? "text-success" : "text-warning"}>{margin}%</span>
              </span>
            ) : undefined
          }
        >
          <ol className="divide-y">
            {LADDER.map((rung, index) => {
              const amount = (opp[rung.field] as number | null | undefined) || 0
              const isSet = amount > 0
              // Each rung unlocks only once the one before it is filled: a
              // submitted price with no approved cost is a guess, and an award
              // with nothing submitted is a typo.
              const previous = index === 0 ? Infinity : ((opp[LADDER[index - 1].field] as number | null) || 0)
              const unlocked = index === 0 || previous > 0
              const editable =
                canManage &&
                unlocked &&
                (rung.step === "award" ? state === "open" || state === "won" : isOpen)
              return (
                <li key={rung.step} className="px-4 py-3 flex items-center gap-3">
                  <span
                    className={cn(
                      "grid place-items-center h-7 w-7 rounded-full text-xs font-black shrink-0",
                      isSet ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                    )}
                    aria-hidden="true"
                  >
                    {isSet ? <CheckCircle2 size={15} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{t(`crm_value_${rung.step}_label`)}</span>
                    <span className="block text-[11px] text-muted-foreground">{t(`crm_value_${rung.step}_hint`)}</span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className={cn("block text-sm font-black", isSet ? "text-foreground" : "text-muted-foreground/60")} dir="ltr">
                      {isSet ? formatSar(amount, locale) : t("crm_value_not_set")}
                    </span>
                    {rung.step === "award" && isPartialAward(opp) && (
                      <Badge variant="outline" className="mt-1 text-[10px] bg-warning/10 text-warning border-warning/20">
                        {t("crm_award_partial")} {Math.round((amount / (opp.submittedPrice || 1)) * 100)}%
                      </Badge>
                    )}
                  </span>
                  {editable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 h-8"
                      onClick={() => setValueStep(rung.step)}
                    >
                      {isSet ? (rung.step === "submitted" ? t("crm_value_new_version") : t("crm_edit_short")) : t("crm_value_set")}
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
        </CrmPanel>

        {/* ---- gates ---------------------------------------------------- */}
        <CrmPanel
          icon={CheckCircle2}
          title={t("crm_gates_title", { stage: t(`crm_opp_stage_${opp.stage}`) })}
          subtitle={t("crm_gates_desc")}
          action={
            <span className="text-xs font-bold text-muted-foreground" dir="ltr">
              {doneGates.length}/{gates.length}
            </span>
          }
        >
          {gates.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">{t("crm_gates_none")}</p>
          ) : (
            <ul className="divide-y">
              {gates.map((gate) => {
                const done = isGateDone(opp, gate, gateCtx)
                // Auto gates read the record; ticking them by hand would let a
                // deal claim a cost it does not have.
                const interactive = canManage && isOpen && !gate.auto
                const Row = interactive ? "button" : "div"
                return (
                  <li key={gate.id}>
                    <Row
                      {...(interactive ? { type: "button" as const, onClick: () => toggleGate(gate), disabled: busy } : {})}
                      className={cn(
                        "w-full px-4 py-3 flex items-start gap-3 text-start",
                        interactive && "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      )}
                    >
                      {done ? (
                        <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-success" aria-hidden="true" />
                      ) : (
                        <Circle size={16} className="shrink-0 mt-0.5 text-muted-foreground/40" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm", done ? "text-foreground font-semibold" : "text-foreground")}>
                          {t(gateLabelKey(gate))}
                        </span>
                        {(gate.auto || gate.module) && (
                          <span className="block text-[11px] text-muted-foreground mt-0.5">
                            {gate.auto ? t(`crm_gate_auto_${gate.auto}`) : t(`crm_gate_module_${gate.module}`)}
                          </span>
                        )}
                      </span>
                      {gate.module && (
                        <Badge variant="outline" className="shrink-0 text-[10px] bg-muted text-muted-foreground border-border">
                          {t(`crm_module_${gate.module}`)}
                        </Badge>
                      )}
                    </Row>
                  </li>
                )
              })}
            </ul>
          )}

          {isOpen && (
            <div className="p-4 border-t space-y-3 bg-muted/20">
              {remaining > 0 && (
                <p className="flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>{t("crm_gates_blocking", { count: remaining })}</span>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {next && next !== "won" ? (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!canManage || busy || !canAdvanceStage(opp, gateCtx)}
                    onClick={advance}
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : isRtl ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}
                    {t("crm_advance_to", { stage: t(`crm_opp_stage_${next}`) })}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!canManage || busy || remaining > 0}
                    onClick={() => setValueStep("award")}
                  >
                    <Trophy size={13} />
                    {t("crm_record_award_btn")}
                  </Button>
                )}
                {canManage && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCloseMode("hold")}>
                      <Pause size={13} />
                      {t("crm_hold_btn")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => setCloseMode("lost")}
                    >
                      <XCircle size={13} />
                      {t("crm_close_lost_btn")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {state === "won" && (
            <div className="p-4 border-t space-y-3 bg-success/5">
              <p className="text-xs text-muted-foreground">{t("crm_handover_prompt")}</p>
              <Button size="sm" className="gap-1.5" disabled={!canManage} onClick={() => setShowHandover(true)}>
                <Building2 size={13} />
                {t("crm_handover_btn")}
              </Button>
            </div>
          )}
        </CrmPanel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ---- details -------------------------------------------------- */}
        <CrmPanel icon={FileText} title={t("crm_opp_details")}>
          <CrmRow label={t("crm_opp_track")}>{t(`crm_track_${track}`)}</CrmRow>
          <CrmRow label={t("crm_opp_scope")}>
            {scope || opp.customScopeType ? (
              <span className="flex flex-wrap items-center justify-end gap-1">
                {(opp.scopeTypes ?? []).map((s, i) => (
                  <Badge key={s} variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border">
                    {t(`crm_scope_${s}`)}
                    {i === 0 && (opp.scopeTypes?.length ?? 0) > 1 && <span aria-hidden="true"> ★</span>}
                  </Badge>
                ))}
                {opp.customScopeType && (
                  <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20">
                    {opp.customScopeType}
                  </Badge>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground font-normal">{t("crm_not_specified")}</span>
            )}
          </CrmRow>
          {opp.route && <CrmRow label={t("crm_opp_route")}>{t(`crm_route_${opp.route}`)}</CrmRow>}
          {opp.contractKind && <CrmRow label={t("crm_opp_contract_kind")}>{t(`crm_contract_kind_${opp.contractKind}`)}</CrmRow>}
          {opp.source && <CrmRow label={t("crm_opp_source")}>{t(`crm_opp_source_${opp.source}`)}</CrmRow>}
          {opp.consultantContactId && (
            <CrmRow label={t("crm_opp_consultant")}>
              <Link
                href={`${base}/leads/${opp.consultantContactId}`}
                className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
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
                <span dir="ltr">{formatCrmDate(opp.expectedCloseDate, locale)}</span>
                {isOpen && days !== null && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      days < 0
                        ? "bg-destructive/10 text-destructive border-destructive/20"
                        : days <= 7
                          ? "bg-warning/10 text-warning border-warning/20"
                          : "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {days < 0 ? t("crm_opp_overdue") : t("crm_opp_due_soon", { days })}
                  </Badge>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground font-normal">{t("crm_opp_no_close_date")}</span>
            )}
          </CrmRow>
          <CrmRow label={t("crm_opp_probability")}>
            <span dir="ltr">{typeof opp.probability === "number" ? `${opp.probability}%` : "—"}</span>
          </CrmRow>
          <CrmRow label={t("crm_owner")}>
            {opp.ownerName || <span className="text-muted-foreground font-normal">{t("crm_owner_none")}</span>}
          </CrmRow>
          {opp.bidderCount != null && (
            <CrmRow label={t("crm_value_bidders")}>
              <span dir="ltr">
                {opp.bidderCount}
                {opp.ourRank != null && ` · #${opp.ourRank}`}
              </span>
            </CrmRow>
          )}
          {opp.notes && <p className="px-4 py-3 text-sm text-muted-foreground border-t whitespace-pre-wrap">{opp.notes}</p>}
        </CrmPanel>

        {/* ---- offer versions ------------------------------------------- */}
        <CrmPanel
          icon={FileText}
          title={t("crm_offer_versions")}
          subtitle={t("crm_offer_versions_desc")}
          action={
            oppQuotations.length > 0 ? (
              <span className="text-xs font-bold text-muted-foreground" dir="ltr">{oppQuotations.length}</span>
            ) : undefined
          }
        >
          {oppQuotations.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">{t("crm_offer_versions_empty")}</p>
          ) : (
            <ul className="divide-y">
              {oppQuotations.map((q, index) => (
                <li key={q.id} className="px-4 py-3 flex items-center gap-3">
                  <span
                    className={cn(
                      "shrink-0 grid place-items-center h-7 w-9 rounded-md text-[11px] font-black",
                      index === 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                    )}
                    dir="ltr"
                  >
                    v{q.version || 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-foreground" dir="ltr">{formatSar(q.amount, locale)}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {[
                        q.date ? formatCrmDate(q.date, locale) : null,
                        q.validityDays ? t("crm_offer_valid_days", { days: q.validityDays }) : null,
                        q.paymentTerms,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px]",
                      index === 0
                        ? "bg-success/10 text-success border-success/20"
                        : "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {t(index === 0 ? "crm_offer_current" : "crm_offer_superseded")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CrmPanel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ---- eligibility and capacity --------------------------------- */}
        <CrmPanel
          icon={ShieldCheck}
          title={t("crm_eligibility_panel")}
          subtitle={t("crm_eligibility_panel_desc")}
          action={
            <Link
              href={`${base}/settings`}
              className="text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {t("crm_settings_page_title")}
            </Link>
          }
        >
          <CrmRow label={t("crm_classification_activity")}>
            {eligibility.activity ? (
              t(`crm_activity_class_${eligibility.activity}`)
            ) : (
              <span className="text-muted-foreground font-normal">{t("crm_not_specified")}</span>
            )}
          </CrmRow>
          <CrmRow label={t("crm_required_grade")}>
            <EligibilityBadge check={eligibility} />
          </CrmRow>
          {eligibility.unknown === null && (
            <CrmRow label={t("crm_grade_comparison")}>
              <span dir="ltr">
                {t("crm_eligibility_detail", { required: eligibility.required ?? 0, held: eligibility.held ?? 0 })}
              </span>
            </CrmRow>
          )}
          <CrmRow label={t("crm_capacity_impact")}>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                withinCapacity
                  ? "bg-success/10 text-success border-success/20"
                  : "bg-destructive/10 text-destructive border-destructive/20"
              )}
            >
              {t(withinCapacity ? "crm_capacity_within" : "crm_capacity_exceeds")}
            </Badge>
          </CrmRow>
          {eligibility.unknown && (
            <p className="px-4 py-3 border-t flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-warning" />
              <span>{t(`crm_eligibility_hint_${eligibility.unknown}`)}</span>
            </p>
          )}
          {eligibility.unknown === null && !eligibility.eligible && (
            <p className="px-4 py-3 border-t flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{t("crm_eligibility_blocked")}</span>
            </p>
          )}
        </CrmPanel>

        {/* ---- path and history ----------------------------------------- */}
        <CrmPanel icon={History} title={t("crm_history_title")} subtitle={t("crm_history_desc")}>
          <ol className="p-4 space-y-0">
            {OPEN_OPPORTUNITY_STAGES.concat("won").map((s, index) => {
              const entry = history.find((h) => h.event === s)
              const currentIndex = OPEN_OPPORTUNITY_STAGES.indexOf(opp.stage)
              const thisIndex = index
              const reached = !!entry || (isOpen && thisIndex < currentIndex)
              const isCurrent = isOpen && s === opp.stage
              return (
                <li key={s} className="flex items-start gap-3 pb-4 last:pb-0 relative">
                  {/* Connector runs behind the markers, stopping at the last. */}
                  {index < OPEN_OPPORTUNITY_STAGES.length && (
                    <span
                      className="absolute start-[11px] top-6 bottom-0 w-px bg-border"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 grid place-items-center h-6 w-6 rounded-full text-[10px] font-black shrink-0",
                      isCurrent
                        ? "bg-primary text-primary-foreground"
                        : reached
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                    )}
                    aria-hidden="true"
                  >
                    {reached && !isCurrent ? <CheckCircle2 size={13} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    <span className={cn("block text-sm", isCurrent ? "font-black text-foreground" : "text-foreground")}>
                      {t(`crm_opp_stage_${s}`)}
                    </span>
                    {entry && (
                      <span className="block text-[11px] text-muted-foreground">
                        {formatCrmDate(entry.at, locale)}
                        {entry.byName && ` · ${entry.byName}`}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
            {/* Terminal events are not stages, so they sit after the ladder. */}
            {history
              .filter((h) => h.event === "lost" || h.event === "handed_over" || h.event === "on_hold" || h.event === "reactivated")
              .map((entry, index) => (
                <li key={`${entry.event}-${index}`} className="flex items-start gap-3 pt-1">
                  <span
                    className={cn(
                      "grid place-items-center h-6 w-6 rounded-full shrink-0",
                      entry.event === "lost" ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"
                    )}
                    aria-hidden="true"
                  >
                    {entry.event === "lost" ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    <span className="block text-sm text-foreground">{t(`crm_history_${entry.event}`)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatCrmDate(entry.at, locale)}
                      {entry.byName && ` · ${entry.byName}`}
                    </span>
                  </span>
                </li>
              ))}
          </ol>
        </CrmPanel>
      </div>

      {/* ---- addenda ----------------------------------------------------- */}
      {(track === "tender" || addenda.length > 0) && (
        <CrmPanel
          icon={FileStack}
          title={t("crm_addenda_title")}
          subtitle={t("crm_addenda_desc")}
          action={
            canManage && isOpen ? (
              <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setShowAddendum(true)}>
                <Plus size={13} />
                {t("crm_addendum_add_btn")}
              </Button>
            ) : undefined
          }
        >
          {addenda.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">{t("crm_addenda_empty")}</p>
          ) : (
            <ul className="divide-y">
              {[...addenda].reverse().map((addendum) => (
                <li key={addendum.number} className="px-4 py-3 flex items-start gap-3">
                  <Badge variant="outline" className="shrink-0 text-[10px] bg-primary/10 text-primary border-primary/20">
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
        subtitle={t("crm_activities_on_deal_desc")}
        action={
          canManage ? (
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setShowActivity(true)}>
              <Plus size={13} />
              {t("crm_activity_add_btn")}
            </Button>
          ) : undefined
        }
      >
        {oppActivities.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">{t("crm_activities_empty")}</p>
        ) : (
          <ul className="divide-y">
            {oppActivities.map((activity) => {
              const due = daysUntil(activity.dueDate)
              return (
                <li key={activity.id} className="px-4 py-3 flex items-center gap-3">
                  <Badge variant="outline" className={cn("shrink-0 text-[10px]", ACTIVITY_TYPE_BADGE_CLASS[activity.type])}>
                    {t(`crm_activity_type_${activity.type}`)}
                  </Badge>
                  <span className={cn("min-w-0 flex-1 text-sm", activity.done && "line-through text-muted-foreground")}>
                    {activity.title}
                  </span>
                  {activity.dueDate && (
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-semibold",
                        activity.done ? "text-muted-foreground" : due !== null && due < 0 ? "text-destructive" : "text-muted-foreground"
                      )}
                      dir="ltr"
                    >
                      <CalendarDays size={11} className="inline me-1" />
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
                        void updateDoc(doc(firestore, CRM_ACTIVITIES, activity.id), {
                          done: !activity.done,
                          updatedAt: serverTimestamp(),
                        })
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
      <CrmOpportunityDialog
        key={`edit-${opp.id}`}
        open={showEdit}
        onOpenChange={setShowEdit}
        opportunity={opp}
        orgId={orgId}
        contacts={contacts}
        teamMembers={teamMembers}
      />
      {valueStep && (
        <CrmValueDialog
          key={`value-${valueStep}`}
          open
          onOpenChange={(open) => { if (!open) setValueStep(null) }}
          step={valueStep}
          opportunity={opp}
          orgId={orgId}
          quotationCount={oppQuotations.length}
          currentUserName={opp.ownerName}
        />
      )}
      {closeMode && (
        <CrmCloseDialog
          key={`close-${closeMode}`}
          open
          onOpenChange={(open) => { if (!open) setCloseMode(null) }}
          mode={closeMode}
          opportunity={opp}
        />
      )}
      <CrmHandoverDialog
        open={showHandover}
        onOpenChange={setShowHandover}
        opportunity={opp}
        contact={contact}
        orgId={orgId}
        teamMembers={teamMembers}
        handedOverCount={handedOverCount}
        projectsBasePath={projectsBase}
      />
      <CrmAddendumDialog open={showAddendum} onOpenChange={setShowAddendum} opportunity={opp} />
      <CrmActivityDialog
        open={showActivity}
        onOpenChange={setShowActivity}
        orgId={orgId}
        contacts={contacts}
        opportunities={opportunities}
        teamMembers={teamMembers}
        fixedContactId={opp.contactId}
        fixedOpportunityId={opp.id}
      />
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Gauge,
  Coins,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Lock,
  ShieldCheck,
  Target,
  TrendingDown,
  Trophy,
  UserX,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link, useRouter } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { createRenewalOpportunity } from "@/lib/crm-writes"
import { useCrmData } from "@/hooks/useCrmData"
import { useCrmOrgProfile } from "@/hooks/useCrmOrgProfile"
import { cn } from "@/lib/utils"
import {
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  capacitySnapshot,
  contactPeople,
  contractsAtRisk,
  daysUntil,
  formatCrmDate,
  formatSar,
  formatSarCompact,
  gateLabelKey,
  gatesRemaining,
  isOpportunityOpen,
  opportunityState,
  priceGapToWinner,
  summarizeOpportunities,
  type CrmOpportunity,
} from "@/lib/crm"
import {
  CrmListSkeleton,
  CrmMeter,
  CrmPanel,
  CrmShell,
  CrmStat,
  CrmStatRow,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"

/**
 * The question this page answers is "what needs me today" — not "how did the
 * quarter go". Every panel is a work queue: prices waiting on a signature,
 * deals stuck behind a checklist, dates about to pass, and the one backward-
 * looking panel that changes future behaviour (why we lose).
 */
export function CrmDashboardView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { orgId, contacts, opportunities, activities, isLoading } = useCrmData({ opportunities: true, activities: true })
  const { profile } = useCrmOrgProfile()
  const { can } = usePermissions()
  const canManage = can("crm.manage")
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const base = crmBasePath(portal)

  const [renewingId, setRenewingId] = useState<string | null>(null)

  /** Turn an expiring contract into a renewal deal and open it. */
  const openRenewal = async (source: CrmOpportunity, endDate: string) => {
    if (!firestore || renewingId) return
    setRenewingId(source.id)
    try {
      const id = await createRenewalOpportunity(firestore, {
        source,
        orgId: source.organizationId || orgId,
        endDate,
      })
      toast({ title: t("crm_renewal_opened") })
      router.push(`${base}/opportunities/${id}`)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setRenewingId(null)
    }
  }

  const summary = useMemo(() => summarizeOpportunities(opportunities), [opportunities])
  const capacity = useMemo(() => capacitySnapshot(opportunities, profile), [opportunities, profile])

  const open = useMemo(() => opportunities.filter(isOpportunityOpen), [opportunities])

  const atRisk = useMemo(() => contractsAtRisk(opportunities), [opportunities])

  // Parties nobody can actually call. A CRM full of company names and no
  // people is an address book that cannot be used.
  const incompleteParties = useMemo(
    () => contacts.filter((c) => contactPeople(c).length === 0 && !c.phone && !c.email).slice(0, 6),
    [contacts]
  )

  const byStage = useMemo(() => {
    const rows = OPEN_OPPORTUNITY_STAGES.map((stage) => {
      const items = open.filter((o) => o.stage === stage)
      return { stage, count: items.length, value: items.reduce((sum, o) => sum + (o.value || 0), 0) }
    })
    const max = Math.max(...rows.map((r) => r.value), 1)
    return { rows, max }
  }, [open])

  const pendingApproval = useMemo(
    () => opportunities.filter((o) => (o.approvalStatus || "none") === "pending"),
    [opportunities]
  )

  const blocked = useMemo(
    () =>
      open
        .map((o) => ({ opp: o, missing: gatesRemaining(o, { profile }) }))
        .filter((row) => row.missing.length > 0)
        .sort((a, b) => (b.opp.value || 0) - (a.opp.value || 0))
        .slice(0, 6),
    [open, profile]
  )

  const dueSoon = useMemo(
    () =>
      open
        .filter((o) => o.expectedCloseDate)
        .map((o) => ({ opp: o, days: daysUntil(o.expectedCloseDate) }))
        .filter((row) => row.days !== null && row.days <= 14)
        .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
        .slice(0, 6),
    [open]
  )

  const awaitingHandover = useMemo(
    () => opportunities.filter((o) => opportunityState(o) === "won"),
    [opportunities]
  )

  const lossAnalysis = useMemo(() => {
    const lost = opportunities.filter((o) => opportunityState(o) === "lost")
    const gaps = lost.map(priceGapToWinner).filter((g): g is number => g !== null)
    const avgGap = gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null
    const byReason = new Map<string, number>()
    for (const o of lost) {
      if (!o.lostReason) continue
      byReason.set(o.lostReason, (byReason.get(o.lostReason) || 0) + 1)
    }
    return {
      lost,
      avgGap,
      reasons: [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    }
  }, [opportunities])

  const overdueActivities = useMemo(
    () =>
      activities
        .filter((a) => !a.done)
        .map((a) => ({ activity: a, days: daysUntil(a.dueDate) }))
        .filter((row) => row.days !== null && row.days <= 0)
        .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
        .slice(0, 6),
    [activities]
  )

  return (
    <CrmShell
      portal={portal}
      icon={LayoutDashboard}
      title={t("crm_dashboard_page_title")}
      description={t("crm_dashboard_page_desc")}
    >
      <CrmStatRow>
        <CrmStat icon={Target} label={t("crm_opp_stat_open")} value={summary.open} accent="cta" hint={summary.onHold > 0 ? t("crm_dash_on_hold_hint", { count: summary.onHold }) : undefined} />
        <CrmStat icon={Coins} label={t("crm_opp_stat_open_value")} value={formatSarCompact(summary.openValue, locale)} accent="primary" />
        <CrmStat icon={TrendingDown} label={t("crm_dash_weighted")} value={formatSarCompact(summary.weightedValue, locale)} accent="accent" hint={t("crm_dash_weighted_hint")} />
        <CrmStat icon={Trophy} label={t("crm_opp_stat_win_rate")} value={`${summary.winRate}%`} accent="success" hint={summary.avgDealValue > 0 ? `${t("crm_opp_stat_avg")}: ${formatSarCompact(summary.avgDealValue, locale)}` : undefined} />
      </CrmStatRow>

      {isLoading ? (
        <CrmListSkeleton rows={6} />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CrmPanel icon={Target} title={t("crm_dash_funnel")} subtitle={t("crm_dash_funnel_desc")}>
              {byStage.rows.every((r) => r.count === 0) ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_funnel_empty")}</p>
              ) : (
                <div className="p-4 space-y-4">
                  {byStage.rows.map((row) => (
                    <div key={row.stage}>
                      <div className="flex items-center gap-2 text-xs mb-1.5">
                        <span className="font-bold text-foreground">{t(`crm_opp_stage_${row.stage}`)}</span>
                        <Badge variant="secondary" className="bg-muted text-muted-foreground border-none text-[10px]">
                          {row.count}
                        </Badge>
                        <span className="ms-auto font-bold text-foreground" dir="ltr">
                          {formatSarCompact(row.value, locale)}
                        </span>
                      </div>
                      <CrmMeter percent={(row.value / byStage.max) * 100} />
                    </div>
                  ))}
                </div>
              )}
            </CrmPanel>

            <CrmPanel
              icon={ShieldCheck}
              title={t("crm_dash_pending_approval")}
              subtitle={t("crm_dash_pending_approval_desc")}
            >
              {pendingApproval.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_no_approvals")}</p>
              ) : (
                <ul className="divide-y">
                  {pendingApproval.map((opp) => (
                    <DealRow key={opp.id} opp={opp} href={`${base}/opportunities/${opp.id}`} locale={locale}>
                      <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20">
                        {t("crm_approval_pending_short")}
                      </Badge>
                    </DealRow>
                  ))}
                </ul>
              )}
            </CrmPanel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CrmPanel icon={Lock} title={t("crm_dash_blocked")} subtitle={t("crm_dash_blocked_desc")}>
              {blocked.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_nothing_blocked")}</p>
              ) : (
                <ul className="divide-y">
                  {blocked.map(({ opp, missing }) => (
                    <li key={opp.id} className="px-4 py-3">
                      <Link
                        href={`${base}/opportunities/${opp.id}`}
                        className="text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        {opp.title}
                      </Link>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {missing.map((gate) => t(gateLabelKey(gate))).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CrmPanel>

            <CrmPanel icon={AlertTriangle} title={t("crm_dash_due_soon")} subtitle={t("crm_dash_due_soon_desc")}>
              {dueSoon.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_nothing_due")}</p>
              ) : (
                <ul className="divide-y">
                  {dueSoon.map(({ opp, days }) => (
                    <DealRow key={opp.id} opp={opp} href={`${base}/opportunities/${opp.id}`} locale={locale}>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          (days ?? 0) < 0
                            ? "bg-destructive/10 text-destructive border-destructive/20"
                            : "bg-warning/10 text-warning border-warning/20"
                        )}
                      >
                        {(days ?? 0) < 0 ? t("crm_opp_overdue") : t("crm_opp_due_soon", { days: days ?? 0 })}
                      </Badge>
                    </DealRow>
                  ))}
                </ul>
              )}
            </CrmPanel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CrmPanel icon={Building2} title={t("crm_dash_awaiting_handover")} subtitle={t("crm_dash_awaiting_handover_desc")}>
              {awaitingHandover.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_nothing_awaiting")}</p>
              ) : (
                <ul className="divide-y">
                  {awaitingHandover.map((opp) => (
                    <DealRow key={opp.id} opp={opp} href={`${base}/opportunities/${opp.id}`} locale={locale}>
                      <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS.won)}>
                        {t("crm_dash_generate_project")}
                      </Badge>
                    </DealRow>
                  ))}
                </ul>
              )}
            </CrmPanel>

            <CrmPanel icon={ClipboardList} title={t("crm_dash_overdue_activities")} subtitle={t("crm_dash_overdue_activities_desc")}>
              {overdueActivities.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_nothing_overdue")}</p>
              ) : (
                <ul className="divide-y">
                  {overdueActivities.map(({ activity, days }) => (
                    <li key={activity.id} className="px-4 py-3 flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`${base}/activities`}
                          className="block text-sm font-bold text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {activity.title}
                        </Link>
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {activity.contactName} · {formatCrmDate(activity.dueDate, locale)}
                        </span>
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px]",
                          (days ?? 0) < 0
                            ? "bg-destructive/10 text-destructive border-destructive/20"
                            : "bg-warning/10 text-warning border-warning/20"
                        )}
                      >
                        {(days ?? 0) < 0 ? t("crm_activity_overdue_days", { days: -(days ?? 0) }) : t("crm_activity_due_today")}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CrmPanel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CrmPanel
              icon={RefreshCw}
              title={t("crm_dash_renewals_at_risk")}
              subtitle={t("crm_dash_renewals_at_risk_desc")}
            >
              {atRisk.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_no_renewals_at_risk")}</p>
              ) : (
                <ul className="divide-y">
                  {atRisk.map(({ opportunity, endDate, daysRemaining }) => (
                    <li key={opportunity.id} className="px-4 py-3 flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`${base}/opportunities/${opportunity.id}`}
                          className="block text-sm font-bold text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {opportunity.title}
                        </Link>
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {opportunity.contactName} · {formatCrmDate(endDate, locale)}
                        </span>
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px]",
                          daysRemaining <= 45
                            ? "bg-destructive/10 text-destructive border-destructive/20"
                            : "bg-warning/10 text-warning border-warning/20"
                        )}
                      >
                        {daysRemaining < 0
                          ? t("crm_contract_ended")
                          : t("crm_contract_ends_in", { days: daysRemaining })}
                      </Badge>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 gap-1.5"
                          disabled={renewingId === opportunity.id}
                          onClick={() => void openRenewal(opportunity, endDate)}
                        >
                          {renewingId === opportunity.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RefreshCw size={12} />
                          )}
                          {t("crm_open_renewal_btn")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CrmPanel>

            <CrmPanel
              icon={Gauge}
              title={t("crm_settings_capacity")}
              subtitle={t("crm_dash_capacity_desc")}
              action={
                <Link
                  href={`${base}/settings`}
                  className="text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {t("crm_nav_settings")}
                </Link>
              }
            >
              {!capacity.configured ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_capacity_unset")}</p>
              ) : (
                <>
                  <div className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-foreground">{t("crm_capacity_used")}</span>
                      <span className="ms-auto font-black" dir="ltr">{capacity.usedPercent}%</span>
                    </div>
                    <CrmMeter
                      percent={capacity.usedPercent}
                      tone={capacity.usedPercent > 85 ? "destructive" : capacity.usedPercent > 65 ? "warning" : "success"}
                    />
                  </div>
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3 border-t text-sm">
                    <span className="text-muted-foreground">{t("crm_settings_ceiling")}</span>
                    <span className="font-semibold" dir="ltr">{formatSarCompact(capacity.ceiling, locale)}</span>
                  </div>
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3 border-t text-sm">
                    <span className="text-muted-foreground">{t("crm_capacity_projected")}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        capacity.projectedPercent > 100
                          ? "bg-destructive/10 text-destructive border-destructive/20"
                          : capacity.projectedPercent > 85
                            ? "bg-warning/10 text-warning border-warning/20"
                            : "bg-success/10 text-success border-success/20"
                      )}
                    >
                      <span dir="ltr">{capacity.projectedPercent}%</span>
                    </Badge>
                  </div>
                  {capacity.projectedPercent > 100 && (
                    <p className="px-4 py-3 border-t flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      <span>{t("crm_capacity_over")}</span>
                    </p>
                  )}
                </>
              )}
            </CrmPanel>
          </div>

          {incompleteParties.length > 0 && (
            <CrmPanel
              icon={UserX}
              title={t("crm_dash_incomplete_parties")}
              subtitle={t("crm_dash_incomplete_parties_desc")}
            >
              <ul className="divide-y">
                {incompleteParties.map((contact) => (
                  <li key={contact.id} className="px-4 py-3 flex items-center gap-3">
                    <Link
                      href={`${base}/leads/${contact.id}`}
                      className="min-w-0 flex-1 text-sm font-bold text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {contact.name}
                    </Link>
                    <Badge variant="outline" className="shrink-0 text-[10px] bg-warning/10 text-warning border-warning/20">
                      {t("crm_dash_no_contact_person")}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CrmPanel>
          )}

          <CrmPanel
            icon={TrendingDown}
            title={t("crm_dash_loss_analysis")}
            subtitle={t("crm_dash_loss_analysis_desc")}
            action={
              lossAnalysis.avgGap !== null ? (
                <span className="text-xs font-bold" dir="ltr">
                  <span className="text-muted-foreground font-normal">{t("crm_dash_avg_gap")} </span>
                  <span className="text-destructive">+{lossAnalysis.avgGap}%</span>
                </span>
              ) : undefined
            }
          >
            {lossAnalysis.lost.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground text-center">{t("crm_dash_no_losses")}</p>
            ) : (
              <div className="p-4 space-y-4">
                {lossAnalysis.reasons.length > 0 && (
                  <ul className="space-y-2.5">
                    {lossAnalysis.reasons.map(([reason, count]) => (
                      <li key={reason}>
                        <div className="flex items-center gap-2 text-xs mb-1.5">
                          <span className="font-semibold text-foreground truncate">{t(`crm_lost_reason_${reason}`)}</span>
                          <span className="ms-auto font-bold text-muted-foreground" dir="ltr">{count}</span>
                        </div>
                        <CrmMeter percent={(count / lossAnalysis.lost.length) * 100} tone="destructive" />
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="divide-y border-t">
                  {lossAnalysis.lost.slice(0, 5).map((opp) => {
                    const gap = priceGapToWinner(opp)
                    return (
                      <li key={opp.id} className="py-2.5 flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <Link
                            href={`${base}/opportunities/${opp.id}`}
                            className="block text-sm font-bold text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          >
                            {opp.title}
                          </Link>
                          <span className="block text-[11px] text-muted-foreground truncate">
                            {[opp.lostReason ? t(`crm_lost_reason_${opp.lostReason}`) : null, opp.lostToCompetitor]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {gap !== null && (
                          <Badge variant="outline" className="shrink-0 text-[10px] bg-destructive/10 text-destructive border-destructive/20">
                            +{gap}%
                          </Badge>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </CrmPanel>
        </>
      )}
    </CrmShell>
  )
}

/** Deal name + client + value, with a caller-supplied badge on the end. */
function DealRow({
  opp,
  href,
  locale,
  children,
}: {
  opp: CrmOpportunity
  href: string
  locale: string
  children?: React.ReactNode
}) {
  return (
    <li className="px-4 py-3 flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <Link
          href={href}
          className="block text-sm font-bold text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {opp.title}
        </Link>
        <span className="block text-[11px] text-muted-foreground truncate">{opp.contactName || "—"}</span>
      </span>
      <span className="shrink-0 text-xs font-black text-foreground" dir="ltr">
        {formatSar(opp.approvalAmount || opp.awardedValue || opp.submittedPrice || opp.value, locale)}
      </span>
      {children}
    </li>
  )
}

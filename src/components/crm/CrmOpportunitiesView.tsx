"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Coins,
  Contact,
  Loader2,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  Trophy,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Link, useRouter } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { deleteOpportunityCascade } from "@/lib/crm-writes"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { useCrmOrgProfile } from "@/hooks/useCrmOrgProfile"
import { useCrmListState, type CrmListConfig } from "@/hooks/useCrmListState"
import { cn } from "@/lib/utils"
import {
  CRM_OPPORTUNITIES,
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  OPPORTUNITY_STAGE_BAR_CLASS,
  OPPORTUNITY_STATE_BADGE_CLASS,
  OPPORTUNITY_TRACKS,
  SCOPE_TYPES,
  TRACK_BADGE_CLASS,
  checkEligibility,
  daysUntil,
  formatCrmDate,
  formatSar,
  formatSarCompact,
  gatesRemaining,
  historyEntry,
  isOpportunityOpen,
  opportunityState,
  opportunityTrack,
  primaryScope,
  summarizeOpportunities,
  toDate,
  type CrmOpportunity,
  type EligibilityCheck,
  type OpportunityStage,
} from "@/lib/crm"
import { CrmContactDialog } from "@/components/crm/CrmContactDialog"
import { CrmOpportunityDialog } from "@/components/crm/CrmOpportunityDialog"
import { CrmShowMore, CrmSortHeader, CrmToolbar } from "@/components/crm/CrmToolbar"
import {
  CRM_CARD_LINK_CLASS,
  CRM_ROW_LINK_CLASS,
  CrmEmptyState,
  CrmListSkeleton,
  CrmShell,
  CrmStat,
  CrmStatRow,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"

export function CrmOpportunitiesView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageCrm = can("crm.manage")
  const { orgId, contacts, opportunities, teamMembers, isLoading } = useCrmData({ opportunities: true })
  const { profile } = useCrmOrgProfile()
  const router = useRouter()
  const base = crmBasePath(portal)

  const [view, setView] = useState<"board" | "list">("board")
  const [showAdd, setShowAdd] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [editOpp, setEditOpp] = useState<CrmOpportunity | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CrmOpportunity | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)

  const summary = useMemo(() => summarizeOpportunities(opportunities), [opportunities])

  const listConfig = useMemo<CrmListConfig<CrmOpportunity>>(
    () => ({
      segments: [
        { key: "open", label: t("crm_state_open"), predicate: isOpportunityOpen },
        { key: "won", label: t("crm_state_won"), predicate: (o) => opportunityState(o) === "won" },
        { key: "handed_over", label: t("crm_state_handed_over"), predicate: (o) => opportunityState(o) === "handed_over" },
        { key: "on_hold", label: t("crm_state_on_hold"), predicate: (o) => opportunityState(o) === "on_hold" },
        { key: "lost", label: t("crm_state_lost"), predicate: (o) => opportunityState(o) === "lost" },
        { key: "all", label: t("crm_tab_all"), predicate: () => true },
      ],
      facets: [
        {
          key: "track",
          label: t("crm_opp_track"),
          options: OPPORTUNITY_TRACKS.map((tr) => ({ value: tr, label: t(`crm_track_${tr}`) })),
          valueOf: (o) => opportunityTrack(o),
        },
        {
          key: "stage",
          label: t("crm_col_stage"),
          options: OPPORTUNITY_STAGES.map((s) => ({ value: s, label: t(`crm_opp_stage_${s}`) })),
          valueOf: (o) => o.stage,
        },
        {
          key: "scope",
          label: t("crm_opp_scope"),
          options: SCOPE_TYPES.map((s) => ({ value: s, label: t(`crm_scope_${s}`) })),
          valueOf: (o) => o.scopeTypes ?? [],
        },
        {
          key: "owner",
          label: t("crm_owner"),
          options: teamMembers.map((m) => ({ value: m.id, label: m.name })),
          valueOf: (o) => o.ownerId ?? null,
        },
      ],
      savedViews: [
        { key: "all_open", label: t("crm_view_all_open"), segment: "open", sort: { key: "date", direction: 1 }, group: "stage" },
        { key: "by_track", label: t("crm_view_by_track"), segment: "open", sort: { key: "date", direction: 1 }, group: "track" },
        { key: "awarded_not_handed", label: t("crm_view_awarded_not_handed"), segment: "won", sort: { key: "value", direction: -1 } },
        { key: "handed_over", label: t("crm_view_handed_over"), segment: "handed_over", sort: { key: "value", direction: -1 } },
        { key: "loss_analysis", label: t("crm_view_loss_analysis"), segment: "lost", sort: { key: "value", direction: -1 } },
        { key: "on_hold", label: t("crm_view_on_hold"), segment: "on_hold", sort: { key: "value", direction: -1 } },
      ],
      groups: [
        { key: "stage", label: t("crm_col_stage"), keyOf: (o) => t(`crm_opp_stage_${o.stage}`) },
        { key: "track", label: t("crm_opp_track"), keyOf: (o) => t(`crm_track_${opportunityTrack(o)}`) },
        { key: "owner", label: t("crm_owner"), keyOf: (o) => o.ownerName || t("crm_owner_none") },
        { key: "contact", label: t("crm_opp_contact"), keyOf: (o) => o.contactName || "—" },
      ],
      sorts: [
        { key: "title", valueOf: (o) => o.title || "" },
        { key: "value", valueOf: (o) => o.value || 0 },
        { key: "probability", valueOf: (o) => o.probability ?? 0 },
        // Undated deals sort last: nobody has committed to them.
        { key: "date", valueOf: (o) => toDate(o.expectedCloseDate)?.getTime() ?? Number.MAX_SAFE_INTEGER },
        { key: "owner", valueOf: (o) => o.ownerName || "" },
      ],
      searchText: (o) =>
        [o.title, o.contactName, o.ownerName, o.contractNumber, o.customScopeType].filter(Boolean).join(" "),
      isMine: (o) => !!o.ownerId && teamMembers.some((m) => m.id === o.ownerId),
      defaultSegment: "open",
      defaultSort: { key: "date", direction: 1 },
      defaultGroup: "",
      pageSize: 15,
    }),
    [t, teamMembers]
  )

  const state = useCrmListState(opportunities, listConfig, locale)

  // The board always shows open deals by stage, filtered by the toolbar — a
  // pipeline column full of closed deals is not a pipeline.
  const byStage = useMemo(() => {
    const map = new Map<OpportunityStage, CrmOpportunity[]>()
    for (const stage of OPPORTUNITY_STAGES) map.set(stage, [])
    for (const opp of state.filtered) {
      if (isOpportunityOpen(opp)) map.get(opp.stage)?.push(opp)
    }
    return map
  }, [state.filtered])

  const outcomes = useMemo(() => {
    const of = (s: string) => state.filtered.filter((o) => opportunityState(o) === s)
    return { won: of("won"), handedOver: of("handed_over"), onHold: of("on_hold"), lost: of("lost") }
  }, [state.filtered])

  const moveStage = async (opp: CrmOpportunity, stage: OpportunityStage) => {
    if (!firestore || stage === opp.stage) return
    setMovingId(opp.id)
    try {
      await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), {
        stage,
        // Reaching won/lost from the board is an outcome, not just a column.
        ...(stage === "won" ? { state: "won" } : stage === "lost" ? { state: "lost" } : { state: "open" }),
        stageHistory: [...(opp.stageHistory ?? []), historyEntry(stage, opp.ownerName)],
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("crm_opp_stage_updated") })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setMovingId(null)
    }
  }

  const handleDelete = async () => {
    if (!firestore || !deleteTarget) return
    setIsDeleting(true)
    try {
      // Offer versions belong to the deal and go with it; logged activities
      // survive with their deal reference cleared.
      await deleteOpportunityCascade(firestore, deleteTarget.id, deleteTarget.organizationId || orgId)
      toast({ title: t("crm_opp_deleted") })
      setDeleteTarget(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  // An opportunity always hangs off a contact, so the add button is only
  // meaningful once there is at least one contact to hang it on.
  const addButton = canManageCrm ? (
    contacts.length === 0 ? (
      <Button onClick={() => setShowAddContact(true)} variant="outline" className="gap-2">
        <Plus size={16} />
        {t("crm_add_btn")}
      </Button>
    ) : (
      <Button onClick={() => setShowAdd(true)} className="gap-2">
        <Plus size={16} />
        {t("crm_opp_add_btn")}
      </Button>
    )
  ) : undefined

  const viewSwitch = (
    <div className="flex rounded-lg border p-0.5">
      {(["board", "list"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setView(mode)}
          aria-pressed={view === mode}
          className={cn(
            "px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t(mode === "board" ? "crm_opp_view_board" : "crm_opp_view_list")}
        </button>
      ))}
    </div>
  )

  const cellPad = state.dense ? "py-1.5" : ""
  const columnCount = canManageCrm ? 11 : 10

  return (
    <CrmShell
      portal={portal}
      icon={Target}
      title={t("crm_opps_page_title")}
      description={t("crm_opps_page_desc")}
      action={addButton}
    >
      <CrmStatRow>
        <CrmStat icon={Target} label={t("crm_opp_stat_open")} value={summary.open} accent="cta" />
        <CrmStat icon={Coins} label={t("crm_opp_stat_open_value")} value={formatSarCompact(summary.openValue, locale)} accent="primary" />
        <CrmStat icon={Trophy} label={t("crm_opp_stat_won_value")} value={formatSarCompact(summary.wonValue, locale)} accent="success" />
        <CrmStat
          icon={Trophy}
          label={t("crm_opp_stat_win_rate")}
          value={`${summary.winRate}%`}
          accent="accent"
          hint={summary.avgDealValue > 0 ? `${t("crm_opp_stat_avg")}: ${formatSarCompact(summary.avgDealValue, locale)}` : undefined}
        />
      </CrmStatRow>

      {!isLoading && opportunities.length > 0 && (
        <CrmToolbar config={listConfig} state={state} extra={viewSwitch} />
      )}

      {isLoading ? (
        <CrmListSkeleton />
      ) : contacts.length === 0 ? (
        <CrmEmptyState
          icon={Contact}
          title={t("crm_opp_no_contacts_title")}
          description={t("crm_opp_no_contacts_desc")}
          action={canManageCrm ? (
            <Button variant="outline" className="gap-2" onClick={() => setShowAddContact(true)}>
              <Plus size={14} />
              {t("crm_add_btn")}
            </Button>
          ) : undefined}
        />
      ) : opportunities.length === 0 ? (
        <CrmEmptyState
          icon={Target}
          title={t("crm_opp_empty_title")}
          description={t("crm_opp_empty_desc")}
          action={canManageCrm ? (
            <Button variant="outline" className="gap-2" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              {t("crm_opp_add_btn")}
            </Button>
          ) : undefined}
        />
      ) : state.filtered.length === 0 ? (
        <CrmEmptyState
          icon={Search}
          title={t("crm_no_results")}
          description={t("crm_no_results_desc")}
          action={<Button variant="outline" size="sm" onClick={state.clearAll}>{t("crm_clear_filters")}</Button>}
        />
      ) : view === "board" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {OPEN_OPPORTUNITY_STAGES.map((stage) => {
              const items = byStage.get(stage) || []
              const columnValue = items.reduce((sum, o) => sum + (o.value || 0), 0)
              return (
                <section key={stage} className="rounded-xl border bg-muted/20 overflow-hidden flex flex-col">
                  <div className={cn("h-1", OPPORTUNITY_STAGE_BAR_CLASS[stage])} aria-hidden="true" />
                  <header className="px-3 py-2.5 flex items-center justify-between gap-2 border-b bg-card">
                    <h2 className="text-xs font-black text-foreground truncate">{t(`crm_opp_stage_${stage}`)}</h2>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-bold text-muted-foreground" dir="ltr">
                        {formatSarCompact(columnValue, locale)}
                      </span>
                      <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px]">
                        {items.length}
                      </Badge>
                    </div>
                  </header>
                  <div className="p-2 space-y-2 flex-1 min-h-[80px]">
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground/60 text-center py-6">{t("crm_opp_stage_empty")}</p>
                    ) : (
                      items.map((opp) => (
                        <OpportunityCard
                          key={opp.id}
                          opp={opp}
                          detailHref={`${base}/opportunities/${opp.id}`}
                          contactHref={`${base}/leads/${opp.contactId}`}
                          canManage={canManageCrm}
                          isMoving={movingId === opp.id}
                          blocking={gatesRemaining(opp, { profile }).length}
                          eligibility={checkEligibility(opp, profile)}
                          onMove={(next) => void moveStage(opp, next)}
                          onEdit={() => setEditOpp(opp)}
                          onDelete={() => setDeleteTarget(opp)}
                        />
                      ))
                    )}
                  </div>
                </section>
              )
            })}
          </div>

          {/* Outcomes, not queues. Won and handed-over are split because the
              gap between them is real work someone still owes. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              { outcome: "won" as const, items: outcomes.won },
              { outcome: "handed_over" as const, items: outcomes.handedOver },
              { outcome: "on_hold" as const, items: outcomes.onHold },
              { outcome: "lost" as const, items: outcomes.lost },
            ]).map(({ outcome, items }) => {
              const value = items.reduce((sum, o) => sum + (o.awardedValue || o.submittedPrice || o.value || 0), 0)
              return (
                <div key={outcome} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline" className={cn("text-[10px]", OPPORTUNITY_STATE_BADGE_CLASS[outcome])}>
                      {t(`crm_state_${outcome}`)}
                    </Badge>
                    <span className="text-sm font-black text-foreground shrink-0" dir="ltr">{items.length}</span>
                  </div>
                  <p className="text-base font-black text-foreground mt-2 truncate" dir="ltr">
                    {formatSarCompact(value, locale)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Eleven columns do not fit a phone. Rather than force a
                      horizontal scroll through everything, the secondary ones
                      drop out at each breakpoint — the name, value and date
                      survive to the narrowest screen because those are what
                      the list is scanned for. */}
                  <TableHead><CrmSortHeader state={state} sortKey="title" label={t("crm_opp_title")} /></TableHead>
                  <TableHead className="hidden md:table-cell">{t("crm_opp_contact")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("crm_opp_track")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("crm_opp_scope")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("crm_col_stage")}</TableHead>
                  <TableHead><CrmSortHeader state={state} sortKey="value" label={t("crm_col_value")} /></TableHead>
                  <TableHead className="hidden lg:table-cell"><CrmSortHeader state={state} sortKey="probability" label={t("crm_opp_probability")} /></TableHead>
                  <TableHead className="hidden md:table-cell"><CrmSortHeader state={state} sortKey="date" label={t("crm_col_close_date")} /></TableHead>
                  <TableHead className="hidden xl:table-cell">{t("crm_eligibility")}</TableHead>
                  <TableHead className="hidden lg:table-cell"><CrmSortHeader state={state} sortKey="owner" label={t("crm_owner")} /></TableHead>
                  {canManageCrm && <TableHead className="text-end">{t("crm_col_actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.grouped.map((bucket) => (
                  <GroupFragment
                    key={bucket.key || "__all"}
                    label={bucket.label}
                    count={bucket.rows.length}
                    value={formatSarCompact(bucket.rows.reduce((sum, o) => sum + (o.value || 0), 0), locale)}
                    colSpan={columnCount}
                  >
                    {bucket.rows.map((opp) => {
                      const days = daysUntil(opp.expectedCloseDate)
                      const open = isOpportunityOpen(opp)
                      const rowState = opportunityState(opp)
                      const scope = primaryScope(opp)
                      const extraScopes = (opp.scopeTypes?.length ?? 0) - 1
                      return (
                        // The row navigates on click for the mouse; the title
                        // inside it stays the real link so keyboard and screen
                        // readers get a proper target.
                        <TableRow
                          key={opp.id}
                          className={cn(CRM_ROW_LINK_CLASS, "group/row")}
                          onClick={() => router.push(`${base}/opportunities/${opp.id}`)}
                        >
                          {/* Titles are free text and some are pasted
                              paragraphs. Without a ceiling one of those makes
                              its row 400px tall and squashes every other
                              column into a sliver. */}
                          <TableCell className={cn("font-bold text-foreground max-w-[260px] lg:max-w-[360px]", cellPad)}>
                            <span className="flex items-start gap-1.5">
                              <Link
                                href={`${base}/opportunities/${opp.id}`}
                                onClick={(e) => e.stopPropagation()}
                                title={opp.title}
                                className="text-primary hover:underline line-clamp-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                              >
                                {opp.title}
                              </Link>
                              <ChevronArrow />
                            </span>
                            {/* On narrow screens the dropped columns collapse
                                into a sub-line rather than vanishing. */}
                            <span className="md:hidden block text-[11px] font-normal text-muted-foreground truncate mt-0.5">
                              {[opp.contactName, t(`crm_opp_stage_${opp.stage}`)].filter(Boolean).join(" · ")}
                            </span>
                            {rowState !== "open" && (
                              <Badge variant="outline" className={cn("ms-2 text-[10px]", OPPORTUNITY_STATE_BADGE_CLASS[rowState])}>
                                {t(`crm_state_${rowState}`)}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className={cn("hidden md:table-cell", cellPad)}>
                            <Link
                              href={`${base}/leads/${opp.contactId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            >
                              {opp.contactName || t("crm_opp_contact")}
                            </Link>
                          </TableCell>
                          <TableCell className={cn("hidden xl:table-cell", cellPad)}>
                            <Badge variant="outline" className={cn("text-[10px]", TRACK_BADGE_CLASS[opportunityTrack(opp)])}>
                              {t(`crm_track_${opportunityTrack(opp)}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className={cn("hidden xl:table-cell text-xs text-muted-foreground", cellPad)}>
                            {scope ? t(`crm_scope_${scope}`) : opp.customScopeType || "—"}
                            {extraScopes > 0 && <span className="ms-1 text-[10px]" dir="ltr">+{extraScopes}</span>}
                          </TableCell>
                          <TableCell className={cn("hidden sm:table-cell", cellPad)}>
                            <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opp.stage])}>
                              {t(`crm_opp_stage_${opp.stage}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className={cn("font-bold whitespace-nowrap", cellPad)} dir="ltr">
                            {formatSar(opp.awardedValue || opp.submittedPrice || opp.value, locale)}
                          </TableCell>
                          <TableCell className={cn("hidden lg:table-cell text-xs text-muted-foreground", cellPad)} dir="ltr">
                            {typeof opp.probability === "number" ? `${opp.probability}%` : "—"}
                          </TableCell>
                          <TableCell className={cn("hidden md:table-cell text-xs text-muted-foreground", cellPad)}>
                            {opp.expectedCloseDate ? (
                              <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", open && days !== null && days < 0 && "text-destructive font-semibold")}>
                                <CalendarDays size={11} />
                                <span>{formatCrmDate(opp.expectedCloseDate, locale)}</span>
                                {open && days !== null && days < 0 && <AlertTriangle size={11} />}
                              </span>
                            ) : (
                              t("crm_opp_no_close_date")
                            )}
                          </TableCell>
                          <TableCell className={cn("hidden xl:table-cell", cellPad)}>
                            <EligibilityBadge check={checkEligibility(opp, profile)} />
                          </TableCell>
                          <TableCell className={cn("hidden lg:table-cell text-xs text-muted-foreground", cellPad)}>
                            {opp.ownerName || t("crm_owner_none")}
                          </TableCell>
                          {canManageCrm && (
                            <TableCell className={cellPad}>
                              {/* Without stopPropagation these would edit AND
                                  navigate, landing the user on the detail page
                                  with a dialog open behind them. */}
                              <div className="flex items-center gap-1 justify-end">
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                                  onClick={(e) => { e.stopPropagation(); setEditOpp(opp) }} aria-label={`${t("crm_opp_edit_title")} — ${opp.title}`}>
                                  <Pencil size={13} />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(opp) }} aria-label={`${t("crm_opp_delete_confirm_title")} — ${opp.title}`}>
                                  <Trash2 size={13} />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </GroupFragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <CrmShowMore state={state} />
        </div>
      )}

      <CrmOpportunityDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        orgId={orgId}
        contacts={contacts}
        teamMembers={teamMembers}
      />
      <CrmOpportunityDialog
        key={editOpp?.id ?? "edit"}
        open={!!editOpp}
        onOpenChange={(open) => { if (!open) setEditOpp(null) }}
        opportunity={editOpp ?? undefined}
        orgId={orgId}
        contacts={contacts}
        teamMembers={teamMembers}
      />
      <CrmContactDialog open={showAddContact} onOpenChange={setShowAddContact} orgId={orgId} teamMembers={teamMembers} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null) }}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_opp_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("crm_opp_delete_confirm_desc", { name: deleteTarget?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleDelete() }}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmShell>
  )
}

/** A group header row followed by its rows, or just the rows when grouping is
 * off (the header is skipped when the bucket has no label). */
function GroupFragment({
  label,
  count,
  value,
  colSpan,
  children,
}: {
  label: string
  count: number
  value: string
  colSpan: number
  children: React.ReactNode
}) {
  if (!label) return <>{children}</>
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={colSpan} className="py-2">
          <span className="flex items-center gap-2 text-xs font-black text-foreground">
            {label}
            <span className="rounded-full bg-background px-1.5 text-[10px] font-bold text-muted-foreground" dir="ltr">
              {count}
            </span>
            <span className="ms-auto font-bold text-muted-foreground" dir="ltr">{value}</span>
          </span>
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}

/** Can we even bid on this? Renders "unknown" rather than "no" whenever the
 * question has not been set up — an unconfigured profile must not read as a
 * failed check. */
export function EligibilityBadge({ check }: { check: EligibilityCheck }) {
  const t = useTranslations("Portal.Shared")
  if (check.unknown) {
    return (
      <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border">
        {t(`crm_eligibility_${check.unknown}`)}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        check.eligible
          ? "bg-success/10 text-success border-success/20"
          : "bg-destructive/10 text-destructive border-destructive/20"
      )}
      title={t("crm_eligibility_detail", { required: check.required ?? 0, held: check.held ?? 0 })}
    >
      {t(check.eligible ? "crm_eligibility_yes" : "crm_eligibility_no")}
    </Badge>
  )
}

/**
 * A deal on the board.
 *
 * Carries the same facts as a table row — value, probability, eligibility,
 * owner, what is blocking it — because a person who switches to the board
 * should not lose information, only rearrange it. The whole card navigates to
 * the deal; the stage select and the row of actions sit above that overlay so
 * they stay usable.
 */
function OpportunityCard({
  opp,
  detailHref,
  contactHref,
  canManage,
  isMoving,
  blocking,
  eligibility,
  onMove,
  onEdit,
  onDelete,
}: {
  opp: CrmOpportunity
  detailHref: string
  contactHref: string
  canManage: boolean
  isMoving: boolean
  blocking: number
  eligibility: EligibilityCheck
  onMove: (stage: OpportunityStage) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const days = daysUntil(opp.expectedCloseDate)
  const isOverdue = days !== null && days < 0
  const isDueSoon = days !== null && days >= 0 && days <= 7
  const scope = primaryScope(opp)
  const extraScopes = (opp.scopeTypes?.length ?? 0) - 1

  return (
    <article className={cn(CRM_CARD_LINK_CLASS, "p-3")}>
      {/* Whole-card target sits UNDERNEATH the controls below. */}
      <Link
        href={detailHref}
        className="absolute inset-0 rounded-lg focus:outline-none"
        aria-label={opp.title}
        tabIndex={-1}
      />

      <div className="relative pointer-events-none space-y-2">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={detailHref}
            className="pointer-events-auto text-sm font-bold text-foreground group-hover:text-primary hover:underline line-clamp-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {opp.title}
          </Link>
          <Badge variant="outline" className={cn("shrink-0 text-[9px]", TRACK_BADGE_CLASS[opportunityTrack(opp)])}>
            {t(`crm_track_${opportunityTrack(opp)}`)}
          </Badge>
        </div>

        {(scope || opp.customScopeType) && (
          <p className="text-[10px] text-muted-foreground truncate">
            {scope ? t(`crm_scope_${scope}`) : opp.customScopeType}
            {extraScopes > 0 && <span dir="ltr"> +{extraScopes}</span>}
          </p>
        )}

        <Link
          href={contactHref}
          className="pointer-events-auto block text-xs text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {opp.contactName || t("crm_opp_open_contact")}
        </Link>

        {/* Value and confidence read together — one is meaningless without
            the other when comparing two cards. */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-black text-foreground" dir="ltr">{formatSar(opp.value, locale)}</span>
          {typeof opp.probability === "number" && (
            <span className="text-[11px] font-bold text-muted-foreground" dir="ltr">{opp.probability}%</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <EligibilityBadge check={eligibility} />
          {opp.ownerName && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[50%]">{opp.ownerName}</span>
          )}
        </div>

        {blocking > 0 && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <AlertTriangle size={11} className="shrink-0 text-warning" />
            {t("crm_gates_blocking", { count: blocking })}
          </p>
        )}

        {opp.expectedCloseDate && (
          <p
            className={cn(
              "text-[11px] flex items-center gap-1",
              isOverdue ? "text-destructive font-semibold" : isDueSoon ? "text-warning font-semibold" : "text-muted-foreground"
            )}
          >
            <CalendarDays size={11} className="shrink-0" />
            <span>{formatCrmDate(opp.expectedCloseDate, locale)}</span>
            {isOverdue && <span>· {t("crm_opp_overdue")}</span>}
            {!isOverdue && isDueSoon && <span>· {t("crm_opp_due_soon", { days })}</span>}
          </p>
        )}
      </div>

      {canManage && (
        <div className="relative z-10 flex items-center gap-1 pt-2 mt-2 border-t">
          {/* Stage moves are a Select rather than drag-and-drop: it is
              keyboard-reachable, works on touch, and needs no extra dependency. */}
          <Select value={opp.stage} onValueChange={(v) => onMove(v as OpportunityStage)} disabled={isMoving}>
            <SelectTrigger className="h-7 text-[11px] flex-1" aria-label={t("crm_opp_stage")}>
              {isMoving ? <Loader2 size={11} className="animate-spin" /> : <SelectValue />}
            </SelectTrigger>
            <SelectContent>
              {OPPORTUNITY_STAGES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{t(`crm_opp_stage_${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
            onClick={onEdit} aria-label={`${t("crm_opp_edit_title")} — ${opp.title}`}>
            <Pencil size={12} />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete} aria-label={`${t("crm_opp_delete_confirm_title")} — ${opp.title}`}>
            <Trash2 size={12} />
          </Button>
        </div>
      )}
    </article>
  )
}

/** Small directional cue that a row or card opens a detail page. Fades in on
 * hover so it does not add noise to a dense table at rest. */
function ChevronArrow() {
  const locale = useLocale()
  const Icon = locale === "ar" ? ArrowLeft : ArrowRight
  return (
    <Icon
      size={12}
      className="shrink-0 opacity-0 -translate-x-1 rtl:translate-x-1 transition-all text-primary group-hover/row:opacity-100 group-hover/row:translate-x-0"
      aria-hidden="true"
    />
  )
}

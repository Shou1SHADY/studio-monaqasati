"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import {
  AlertTriangle,
  CalendarDays,
  Contact,
  Coins,
  Loader2,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  Trophy,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import { Link } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  CRM_OPPORTUNITIES,
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_BADGE_CLASS,
  OPPORTUNITY_STAGE_BAR_CLASS,
  daysUntil,
  formatCrmDate,
  formatSar,
  formatSarCompact,
  summarizeOpportunities,
  toDate,
  type CrmOpportunity,
  type OpportunityStage,
} from "@/lib/crm"
import { CrmContactDialog } from "@/components/crm/CrmContactDialog"
import { CrmOpportunityDialog } from "@/components/crm/CrmOpportunityDialog"
import {
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
  const base = crmBasePath(portal)

  const [search, setSearch] = useState("")
  const [stageFilter, setStageFilter] = useState<OpportunityStage | "all">("all")
  const [view, setView] = useState<"board" | "list">("board")
  const [showAdd, setShowAdd] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [editOpp, setEditOpp] = useState<CrmOpportunity | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CrmOpportunity | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)

  const summary = useMemo(() => summarizeOpportunities(opportunities), [opportunities])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return opportunities
      .filter((opp) => {
        if (stageFilter !== "all" && opp.stage !== stageFilter) return false
        if (!q) return true
        return [opp.title, opp.contactName, opp.rfqTitle].some((f) => (f || "").toLowerCase().includes(q))
      })
      .sort((a, b) => {
        // Deals with a close date lead, soonest first — an opportunity with no
        // date is one nobody has committed to and belongs at the bottom.
        const aDate = toDate(a.expectedCloseDate)?.getTime()
        const bDate = toDate(b.expectedCloseDate)?.getTime()
        if (aDate && bDate) return aDate - bDate
        if (aDate) return -1
        if (bDate) return 1
        return (b.value || 0) - (a.value || 0)
      })
  }, [opportunities, stageFilter, search])

  const byStage = useMemo(() => {
    const map = new Map<OpportunityStage, CrmOpportunity[]>()
    for (const stage of OPPORTUNITY_STAGES) map.set(stage, [])
    for (const opp of visible) map.get(opp.stage)?.push(opp)
    return map
  }, [visible])

  const moveStage = async (opp: CrmOpportunity, stage: OpportunityStage) => {
    if (!firestore || stage === opp.stage) return
    setMovingId(opp.id)
    try {
      await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), { stage, updatedAt: serverTimestamp() })
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
      await deleteDoc(doc(firestore, CRM_OPPORTUNITIES, deleteTarget.id))
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

  const hasActiveFilters = !!search || stageFilter !== "all"

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

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("crm_opp_search_placeholder")}
            className="ps-9"
            aria-label={t("crm_opp_search_placeholder")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as OpportunityStage | "all")}>
            <SelectTrigger className="w-[160px]" aria-label={t("crm_opp_filter_stage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("crm_opp_filter_all_stages")}</SelectItem>
              {OPPORTUNITY_STAGES.map((s) => (
                <SelectItem key={s} value={s}>{t(`crm_opp_stage_${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStageFilter("all") }}
              className="gap-1 text-muted-foreground hover:text-destructive">
              <X size={13} />
              {t("crm_clear_filters")}
            </Button>
          )}
        </div>
      </div>

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
      ) : visible.length === 0 ? (
        <CrmEmptyState
          icon={Search}
          title={t("crm_no_results")}
          description={t("crm_no_results_desc")}
          action={<Button variant="outline" size="sm" onClick={() => { setSearch(""); setStageFilter("all") }}>{t("crm_clear_filters")}</Button>}
        />
      ) : view === "board" ? (
        <div className="space-y-4">
          {/* Open stages as columns; won/lost are outcomes, not queues, so they
              get one summary strip instead of two columns that only ever grow. */}
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
                          contactHref={`${base}/leads/${opp.contactId}`}
                          canManage={canManageCrm}
                          isMoving={movingId === opp.id}
                          onMove={(stage) => void moveStage(opp, stage)}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(["won", "lost"] as const).map((stage) => {
              const items = byStage.get(stage) || []
              const value = items.reduce((sum, o) => sum + (o.value || 0), 0)
              return (
                <div key={stage} className="rounded-xl border p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[stage])}>
                      {t(`crm_opp_stage_${stage}`)}
                    </Badge>
                    <p className="text-lg font-black text-foreground mt-1.5" dir="ltr">{formatSar(value, locale)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setStageFilter(stage); setView("list") }}
                    className="text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                  >
                    {items.length}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crm_opp_title")}</TableHead>
                <TableHead>{t("crm_opp_contact")}</TableHead>
                <TableHead>{t("crm_col_stage")}</TableHead>
                <TableHead>{t("crm_col_value")}</TableHead>
                <TableHead>{t("crm_col_close_date")}</TableHead>
                {canManageCrm && <TableHead className="text-end">{t("crm_col_actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((opp) => {
                const days = daysUntil(opp.expectedCloseDate)
                const isOpen = opp.stage !== "won" && opp.stage !== "lost"
                return (
                  <TableRow key={opp.id}>
                    <TableCell className="font-bold text-foreground">
                      {opp.title}
                      {opp.rfqTitle && (
                        <p className="text-[11px] font-normal text-muted-foreground truncate">
                          {t("crm_opp_linked_rfq")}: {opp.rfqTitle}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`${base}/leads/${opp.contactId}`}
                        className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        {opp.contactName || t("crm_opp_contact")}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px]", OPPORTUNITY_STAGE_BADGE_CLASS[opp.stage])}>
                        {t(`crm_opp_stage_${opp.stage}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-bold" dir="ltr">{formatSar(opp.value, locale)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {opp.expectedCloseDate ? (
                        <span className={cn("inline-flex items-center gap-1", isOpen && days !== null && days < 0 && "text-destructive font-semibold")}>
                          <CalendarDays size={11} />
                          <span>{formatCrmDate(opp.expectedCloseDate, locale)}</span>
                          {isOpen && days !== null && days < 0 && <AlertTriangle size={11} />}
                        </span>
                      ) : (
                        t("crm_opp_no_close_date")
                      )}
                    </TableCell>
                    {canManageCrm && (
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => setEditOpp(opp)} aria-label={`${t("crm_opp_edit_title")} — ${opp.title}`}>
                            <Pencil size={13} />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(opp)} aria-label={`${t("crm_opp_delete_confirm_title")} — ${opp.title}`}>
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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

function OpportunityCard({
  opp,
  contactHref,
  canManage,
  isMoving,
  onMove,
  onEdit,
  onDelete,
}: {
  opp: CrmOpportunity
  contactHref: string
  canManage: boolean
  isMoving: boolean
  onMove: (stage: OpportunityStage) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const days = daysUntil(opp.expectedCloseDate)
  const isOverdue = days !== null && days < 0
  const isDueSoon = days !== null && days >= 0 && days <= 7

  return (
    <article className="rounded-lg border bg-card p-3 space-y-2">
      <p className="text-sm font-bold text-foreground line-clamp-2">{opp.title}</p>
      <Link
        href={contactHref}
        className="block text-xs text-primary hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {opp.contactName || t("crm_opp_open_contact")}
      </Link>
      <p className="text-sm font-black text-foreground" dir="ltr">{formatSar(opp.value, locale)}</p>
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
      {canManage && (
        <div className="flex items-center gap-1 pt-2 border-t">
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

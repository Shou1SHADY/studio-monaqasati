"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Circle,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { useCrmListState, type CrmListConfig } from "@/hooks/useCrmListState"
import { cn } from "@/lib/utils"
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_BADGE_CLASS,
  CRM_ACTIVITIES,
  daysUntil,
  formatCrmDate,

  type CrmActivity,
} from "@/lib/crm"
import { CrmActivityDialog } from "@/components/crm/CrmActivityDialog"
import { CrmShowMore, CrmToolbar } from "@/components/crm/CrmToolbar"
import {
  CrmEmptyState,
  CrmListSkeleton,
  CrmShell,
  CrmStat,
  CrmStatRow,
  crmBasePath,
  type CrmPortal,
} from "@/components/crm/CrmShell"

/**
 * Every call, meeting, site visit, task and email in one list.
 *
 * It opens on "open" rather than "all": the question this page answers is what
 * is still owed, and a completed log grows without bound while the list of
 * commitments does not.
 */
export function CrmActivitiesView({ portal }: { portal: CrmPortal }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManage = can("crm.manage")
  const { orgId, contacts, opportunities, activities, teamMembers, isLoading } = useCrmData({
    opportunities: true,
    activities: true,
  })
  const base = crmBasePath(portal)

  const [showAdd, setShowAdd] = useState(false)
  const [editActivity, setEditActivity] = useState<CrmActivity | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CrmActivity | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const summary = useMemo(() => {
    let open = 0
    let overdue = 0
    let today = 0
    let done = 0
    for (const a of activities) {
      if (a.done) {
        done++
        continue
      }
      open++
      const days = daysUntil(a.dueDate)
      if (days === null) continue
      if (days < 0) overdue++
      else if (days === 0) today++
    }
    return { open, overdue, today, done }
  }, [activities])

  const listConfig = useMemo<CrmListConfig<CrmActivity>>(
    () => ({
      segments: [
        { key: "open", label: t("crm_activity_due_open"), predicate: (a) => !a.done },
        {
          key: "overdue",
          label: t("crm_activity_due_overdue"),
          predicate: (a) => { const d = daysUntil(a.dueDate); return !a.done && d !== null && d < 0 },
        },
        {
          key: "today",
          label: t("crm_activity_due_today"),
          predicate: (a) => !a.done && daysUntil(a.dueDate) === 0,
        },
        {
          key: "week",
          label: t("crm_activity_due_week"),
          predicate: (a) => { const d = daysUntil(a.dueDate); return !a.done && d !== null && d >= 0 && d <= 7 },
        },
        { key: "done", label: t("crm_activity_due_done"), predicate: (a) => !!a.done },
        { key: "all", label: t("crm_tab_all"), predicate: () => true },
      ],
      facets: [
        {
          key: "type",
          label: t("crm_activity_type"),
          options: ACTIVITY_TYPES.map((at) => ({ value: at, label: t(`crm_activity_type_${at}`) })),
          valueOf: (a) => a.type,
        },
        {
          key: "owner",
          label: t("crm_owner"),
          options: teamMembers.map((m) => ({ value: m.id, label: m.name })),
          valueOf: (a) => a.ownerId ?? null,
        },
      ],
      savedViews: [
        { key: "open", label: t("crm_activity_due_open"), segment: "open", sort: { key: "due", direction: 1 } },
        { key: "overdue", label: t("crm_activity_due_overdue"), segment: "overdue", sort: { key: "due", direction: 1 } },
        { key: "today", label: t("crm_activity_due_today"), segment: "today", sort: { key: "due", direction: 1 } },
      ],
      groups: [
        { key: "type", label: t("crm_activity_type"), keyOf: (a) => t(`crm_activity_type_${a.type}`) },
        { key: "contact", label: t("crm_opp_contact"), keyOf: (a) => a.contactName || "—" },
        { key: "owner", label: t("crm_owner"), keyOf: (a) => a.ownerName || t("crm_owner_none") },
      ],
      sorts: [
        // Undated commitments sink: nobody has put a date on them.
        { key: "due", valueOf: (a) => a.dueDate || "9999-99-99" },
        { key: "title", valueOf: (a) => a.title || "" },
      ],
      searchText: (a) => [a.title, a.contactName, a.opportunityTitle, a.ownerName].filter(Boolean).join(" "),
      isMine: (a) => !!a.ownerId && teamMembers.some((m) => m.id === a.ownerId),
      defaultSegment: "open",
      defaultSort: { key: "due", direction: 1 },
      pageSize: 20,
    }),
    [t, teamMembers]
  )

  const state = useCrmListState(activities, listConfig, locale)

  const toggleDone = async (activity: CrmActivity) => {
    if (!firestore) return
    setTogglingId(activity.id)
    try {
      await updateDoc(doc(firestore, CRM_ACTIVITIES, activity.id), {
        done: !activity.done,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async () => {
    if (!firestore || !deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteDoc(doc(firestore, CRM_ACTIVITIES, deleteTarget.id))
      toast({ title: t("crm_activity_deleted") })
      setDeleteTarget(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const addButton =
    canManage && contacts.length > 0 ? (
      <Button onClick={() => setShowAdd(true)} className="gap-2">
        <Plus size={16} />
        {t("crm_activity_add_btn")}
      </Button>
    ) : undefined

  return (
    <CrmShell
      portal={portal}
      icon={ClipboardList}
      title={t("crm_activities_page_title")}
      description={t("crm_activities_page_desc")}
      action={addButton}
    >
      <CrmStatRow>
        <CrmStat icon={ClipboardList} label={t("crm_activity_stat_open")} value={summary.open} accent="cta" />
        <CrmStat icon={AlertTriangle} label={t("crm_activity_stat_overdue")} value={summary.overdue} accent="destructive" />
        <CrmStat icon={CalendarDays} label={t("crm_activity_stat_today")} value={summary.today} accent="warning" />
        <CrmStat icon={CalendarCheck} label={t("crm_activity_stat_done")} value={summary.done} accent="success" />
      </CrmStatRow>

      {!isLoading && activities.length > 0 && <CrmToolbar config={listConfig} state={state} />}

      {isLoading ? (
        <CrmListSkeleton />
      ) : contacts.length === 0 ? (
        <CrmEmptyState icon={ClipboardList} title={t("crm_activity_no_contacts_title")} description={t("crm_activity_no_contacts_desc")} />
      ) : activities.length === 0 ? (
        <CrmEmptyState
          icon={ClipboardList}
          title={t("crm_activities_empty")}
          description={t("crm_activities_empty_desc")}
          action={
            canManage ? (
              <Button variant="outline" className="gap-2" onClick={() => setShowAdd(true)}>
                <Plus size={14} />
                {t("crm_activity_add_btn")}
              </Button>
            ) : undefined
          }
        />
      ) : state.filtered.length === 0 ? (
        <CrmEmptyState
          icon={Search}
          title={t("crm_no_results")}
          description={t("crm_no_results_desc")}
          action={<Button variant="outline" size="sm" onClick={state.clearAll}>{t("crm_clear_filters")}</Button>}
        />
      ) : (
        <ul className="rounded-xl border divide-y bg-card">
          {state.visible.map((activity) => {
            const days = daysUntil(activity.dueDate)
            const isOverdue = !activity.done && days !== null && days < 0
            return (
              <li key={activity.id} className="p-3 sm:p-4 flex items-start gap-3">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => void toggleDone(activity)}
                    disabled={togglingId === activity.id}
                    aria-pressed={!!activity.done}
                    aria-label={t(activity.done ? "crm_activity_reopen" : "crm_activity_complete")}
                    className="shrink-0 mt-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {togglingId === activity.id ? (
                      <Loader2 size={18} className="animate-spin text-muted-foreground" />
                    ) : activity.done ? (
                      <CheckCircle2 size={18} className="text-success" />
                    ) : (
                      <Circle size={18} className="text-muted-foreground/40 hover:text-primary transition-colors" />
                    )}
                  </button>
                ) : (
                  <span className="shrink-0 mt-0.5" aria-hidden="true">
                    {activity.done ? (
                      <CheckCircle2 size={18} className="text-success" />
                    ) : (
                      <Circle size={18} className="text-muted-foreground/40" />
                    )}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("text-[10px]", ACTIVITY_TYPE_BADGE_CLASS[activity.type])}>
                      {t(`crm_activity_type_${activity.type}`)}
                    </Badge>
                    <p className={cn("text-sm font-bold text-foreground", activity.done && "line-through text-muted-foreground")}>
                      {activity.title}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`${base}/leads/${activity.contactId}`}
                      className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {activity.contactName || t("crm_opp_contact")}
                    </Link>
                    {activity.opportunityId && activity.opportunityTitle && (
                      <>
                        <span aria-hidden="true">·</span>
                        <Link
                          href={`${base}/opportunities/${activity.opportunityId}`}
                          className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded truncate"
                        >
                          {activity.opportunityTitle}
                        </Link>
                      </>
                    )}
                    {activity.ownerName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{activity.ownerName}</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="shrink-0 flex items-center gap-1">
                  {activity.dueDate && (
                    <span
                      className={cn(
                        "text-[11px] font-semibold whitespace-nowrap",
                        activity.done ? "text-muted-foreground" : isOverdue ? "text-destructive" : days !== null && days <= 3 ? "text-warning" : "text-muted-foreground"
                      )}
                      dir="ltr"
                    >
                      {formatCrmDate(activity.dueDate, locale)}
                    </span>
                  )}
                  {canManage && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => setEditActivity(activity)}
                        aria-label={`${t("crm_activity_edit_title")} — ${activity.title}`}
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(activity)}
                        aria-label={`${t("crm_delete_btn")} — ${activity.title}`}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!isLoading && state.hasMore && (
        <div className="rounded-xl border"><CrmShowMore state={state} /></div>
      )}

      <CrmActivityDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        orgId={orgId}
        contacts={contacts}
        opportunities={opportunities}
        teamMembers={teamMembers}
      />
      <CrmActivityDialog
        key={editActivity?.id ?? "edit"}
        open={!!editActivity}
        onOpenChange={(open) => { if (!open) setEditActivity(null) }}
        activity={editActivity ?? undefined}
        orgId={orgId}
        contacts={contacts}
        opportunities={opportunities}
        teamMembers={teamMembers}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null) }}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_activity_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("crm_activity_delete_confirm_desc", { name: deleteTarget?.title ?? "" })}
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

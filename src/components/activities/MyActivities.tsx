"use client"

// "My to-dos" (DEV-69, Odoo's "My activities"): one list of what is planned for
// me across every module, grouped overdue · today · planned, plus what I planned
// for others and what was finished lately. Plan one here or from any document.
// The decisions waiting on me (the home page's work queue) join the same groups,
// derived live from the records: they clear when the work is done, not by ticking.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ListChecks, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog"
import { ActivityRow } from "@/components/activities/ActivityRow"
import { QueueTaskRow } from "@/components/activities/QueueTaskRow"
import { useUser } from "@/firebase"
import { useMyActivities } from "@/hooks/useActivities"
import { useQueueTasks } from "@/hooks/useQueueTasks"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { isOpen, recentlyDone } from "@/lib/activities"
import type { ActivityActor, ActivityPortal } from "@/lib/activity-writes"
import { todayDay } from "@/lib/pm/format"
import { cn } from "@/lib/utils"
import { groupTasks, mergeRows, todoCounts, type TodoRow } from "@/lib/work-queue-tasks"

export function MyActivities({ portal }: { portal: ActivityPortal }) {
  const t = useTranslations("Portal.Activities")
  const { user } = useUser()
  const { profile, organizationId } = useResolvedProfile(user?.uid)
  const { isOrgOwner } = usePermissions()
  const { loading, activities, groups } = useMyActivities(organizationId || null, user?.uid)
  const { tasks } = useQueueTasks(organizationId || null, user?.uid, portal)
  const [adding, setAdding] = useState(false)
  const today = todayDay()

  const actor: ActivityActor = {
    uid: user?.uid ?? "",
    name: ((profile as { name?: string } | null)?.name || user?.displayName || user?.email || "") as string,
    isOwner: isOrgOwner,
  }
  const byMe = useMemo(
    () => activities.filter((a) => isOpen(a) && a.createdById === actor.uid && a.assigneeId !== actor.uid).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    [activities, actor.uid]
  )
  const done = useMemo(() => recentlyDone(activities.filter((a) => a.assigneeId === actor.uid || a.createdById === actor.uid)), [activities, actor.uid])
  const counts = todoCounts(groups, tasks)
  const queue = groupTasks(tasks)
  const mine = {
    overdue: mergeRows(groups.overdue, queue.overdue),
    today: mergeRows(groups.today, queue.today),
    planned: mergeRows(groups.planned, queue.planned),
  }
  const mineCount = counts.overdue + counts.today + counts.planned

  const mineList = (rows: TodoRow[]) => (
    <div className="divide-y">
      {rows.map((r) =>
        r.kind === "activity" ? (
          <ActivityRow key={r.activity.id} activity={r.activity} today={today} actor={actor} portal={portal} />
        ) : (
          <QueueTaskRow key={r.task.id} task={r.task} today={today} />
        )
      )}
    </div>
  )

  const list = (rows: typeof groups.overdue, forOthers = false) => (
    <div className="divide-y">
      {rows.map((a) => (
        <ActivityRow key={a.id} activity={a} today={today} actor={actor} portal={portal} forOthers={forOthers} />
      ))}
    </div>
  )

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <ListChecks size={20} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-black text-foreground">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("desc")}</p>
          </div>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} className="me-1.5" aria-hidden="true" />
          {t("add")}
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label={t("kpi_overdue")} value={counts.overdue} tone={counts.overdue > 0 ? "bad" : undefined} />
        <Kpi label={t("kpi_today")} value={counts.today} tone={counts.today > 0 ? "warn" : undefined} />
        <Kpi label={t("kpi_planned")} value={counts.planned} />
      </div>

      {loading ? (
        <div className="flex justify-center p-10">
          <Loader2 className="animate-spin text-primary" size={24} aria-hidden="true" />
        </div>
      ) : (
        <>
          {mineCount === 0 && <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{t("empty_mine")}</p>}
          {mine.overdue.length > 0 && (
            <Panel title={t("group_overdue")} count={mine.overdue.length} countTone="bad" bodyClassName="p-0">
              {mineList(mine.overdue)}
            </Panel>
          )}
          {mine.today.length > 0 && (
            <Panel title={t("group_today")} count={mine.today.length} bodyClassName="p-0">
              {mineList(mine.today)}
            </Panel>
          )}
          {mine.planned.length > 0 && (
            <Panel title={t("group_planned")} count={mine.planned.length} bodyClassName="p-0">
              {mineList(mine.planned)}
            </Panel>
          )}
          {byMe.length > 0 && (
            <Panel title={t("group_by_me")} count={byMe.length} bodyClassName="p-0">
              {list(byMe, true)}
            </Panel>
          )}
          {done.length > 0 && (
            <Panel title={t("group_done")} bodyClassName="p-0">
              {list(done, false)}
            </Panel>
          )}
        </>
      )}

      {adding && <ActivityFormDialog portal={portal} onClose={() => setAdding(false)} />}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-black tabular-nums", tone === "bad" && "text-destructive", tone === "warn" && "text-warning")} dir="ltr">
        {value}
      </p>
    </div>
  )
}

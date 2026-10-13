"use client"

// "My to-dos" (DEV-69, Odoo's Activities): what is planned for me across every module,
// laid out as Odoo lays its activities out — a control panel (title, New, one search
// bar, a list/kanban switch), three scopes (mine · planned by me for others · done
// lately), the state counters in Odoo's colours (red late, orange today, green
// planned) that filter the list when pressed, type filters, and the rows grouped by
// state — in the list as collapsible groups, in the kanban as one column per state.
// The decisions waiting on me (the home page's work queue) join the same groups,
// derived live from the records: they clear when the work is done, not by ticking.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, Inbox, LayoutGrid, List, ListChecks, Loader2, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Chip } from "@/components/module-ui/Chip"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { ActivityFormDialog } from "@/components/activities/ActivityFormDialog"
import { ActivityRow, TYPE_ICON } from "@/components/activities/ActivityRow"
import { QueueTaskRow } from "@/components/activities/QueueTaskRow"
import { useUser } from "@/firebase"
import { useMyActivities } from "@/hooks/useActivities"
import { useQueueTasks } from "@/hooks/useQueueTasks"
import { usePermissions } from "@/hooks/usePermissions"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { ACTIVITY_TYPES, bucketOf, isOpen, recentlyDone, type Activity, type ActivityBucket, type ActivityType } from "@/lib/activities"
import type { ActivityActor, ActivityPortal } from "@/lib/activity-writes"
import { todayDay } from "@/lib/pm/format"
import { matchesSearch } from "@/lib/search-text"
import { cn } from "@/lib/utils"
import { mergeRows, taskTitle, type QueueTask, type TodoRow } from "@/lib/work-queue-tasks"

type Scope = "mine" | "by_me" | "done"
type View = "list" | "kanban"
/** A row's type for the filter: an activity's own, or "queue" for a decision from the work queue. */
type TypeFilter = ActivityType | "queue"

const BUCKETS: ActivityBucket[] = ["overdue", "today", "planned"]
const GROUP_KEY: Record<ActivityBucket, string> = { overdue: "group_overdue", today: "group_today", planned: "group_planned" }
/** Odoo's state colours: the counter, the column's top line. */
const STATE_STYLE: Record<ActivityBucket, { text: string; bar: string; on: string }> = {
  overdue: { text: "text-destructive", bar: "bg-destructive", on: "border-destructive bg-destructive/5" },
  today: { text: "text-warning", bar: "bg-warning", on: "border-warning bg-warning/5" },
  planned: { text: "text-success", bar: "bg-success", on: "border-success bg-success/5" },
}
const VIEW_KEY = "activities.view"

export function MyActivities({ portal }: { portal: ActivityPortal }) {
  const t = useTranslations("Portal.Activities")
  const tc = useTranslations("Portal.Contractor")
  const tsb = useTranslations("Portal.Sidebar")
  const { user } = useUser()
  const { profile, organizationId } = useResolvedProfile(user?.uid)
  const { isOrgOwner } = usePermissions()
  const { loading, activities } = useMyActivities(organizationId || null, user?.uid)
  const { tasks } = useQueueTasks(organizationId || null, user?.uid, portal)
  const [adding, setAdding] = useState(false)
  const [scope, setScope] = useState<Scope>("mine")
  const [view, setView] = useState<View>("list")
  const [state, setState] = useState<ActivityBucket | null>(null)
  const [types, setTypes] = useState<ReadonlySet<TypeFilter>>(new Set())
  const [q, setQ] = useState("")
  const [collapsed, setCollapsed] = useState<ReadonlySet<ActivityBucket>>(new Set())
  const today = todayDay()

  // The list/kanban choice is a per-viewer convenience: remembered in this browser only.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY)
      if (saved === "list" || saved === "kanban") setView(saved)
    } catch {
      /* storage blocked — the default view stands */
    }
  }, [])
  const chooseView = (v: View) => {
    setView(v)
    try {
      window.localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* storage blocked — the choice lasts this visit */
    }
  }

  const actor: ActivityActor = {
    uid: user?.uid ?? "",
    name: ((profile as { name?: string } | null)?.name || user?.displayName || user?.email || "") as string,
    isOwner: isOrgOwner,
  }

  // Every row of each scope, before the filters.
  const scoped = useMemo(() => {
    const mineActs = activities.filter((a) => isOpen(a) && a.assigneeId === actor.uid)
    const byMe = activities.filter((a) => isOpen(a) && a.createdById === actor.uid && a.assigneeId !== actor.uid)
    const done = recentlyDone(activities.filter((a) => a.assigneeId === actor.uid || a.createdById === actor.uid))
    return { mineActs, byMe, done }
  }, [activities, actor.uid])

  const queueText = (task: QueueTask) => [taskTitle(task, tc), tsb(task.moduleLabelKey)]
  const activityText = (a: Activity) => [a.summary, a.note ?? "", a.target?.label ?? "", a.assigneeName ?? "", a.createdByName ?? "", t(`type_${a.type}`)]
  const passType = (k: TypeFilter) => types.size === 0 || types.has(k)
  const passQ = (fields: string[]) => q.trim() === "" || matchesSearch(q, fields)

  const shownActs = (list: Activity[]) => list.filter((a) => passType(a.type) && passQ(activityText(a)))
  const shownTasks = scope === "mine" ? tasks.filter((task) => passType("queue") && passQ(queueText(task))) : []

  // State counts follow the search and the type filter, never the state filter itself.
  const openActs = shownActs(scope === "by_me" ? scoped.byMe : scoped.mineActs)
  const stateCount = (b: ActivityBucket) => openActs.filter((a) => bucketOf(a, today) === b).length + shownTasks.filter((task) => task.bucket === b).length
  const rowsIn = (b: ActivityBucket): TodoRow[] =>
    mergeRows(
      openActs.filter((a) => bucketOf(a, today) === b),
      shownTasks.filter((task) => task.bucket === b)
    )
  const doneRows = shownActs(scoped.done)

  const scopeCount: Record<Scope, number> = {
    mine: scoped.mineActs.length + tasks.length,
    by_me: scoped.byMe.length,
    done: scoped.done.length,
  }
  const typeCounts = useMemo(() => {
    const base = scope === "mine" ? scoped.mineActs : scope === "by_me" ? scoped.byMe : scoped.done
    const out = new Map<TypeFilter, number>()
    for (const a of base) out.set(a.type, (out.get(a.type) ?? 0) + 1)
    if (scope === "mine" && tasks.length > 0) out.set("queue", tasks.length)
    return out
  }, [scope, scoped, tasks.length])
  const typeOptions: TypeFilter[] = [...ACTIVITY_TYPES, "queue" as const].filter((k) => (typeCounts.get(k) ?? 0) > 0 || types.has(k))

  const toggleType = (k: TypeFilter) =>
    setTypes((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const toggleGroup = (b: ActivityBucket) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(b)) next.delete(b)
      else next.add(b)
      return next
    })
  const filtering = q.trim() !== "" || types.size > 0 || state !== null
  const clear = () => {
    setQ("")
    setTypes(new Set())
    setState(null)
  }
  const typeLabel = (k: TypeFilter) => (k === "queue" ? t("type_queue") : t(`type_${k}`))

  const renderRow = (r: TodoRow, layout: "row" | "card") =>
    r.kind === "activity" ? (
      <ActivityRow key={r.activity.id} activity={r.activity} today={today} actor={actor} portal={portal} forOthers={scope === "by_me"} layout={layout} />
    ) : (
      <QueueTaskRow key={r.task.id} task={r.task} today={today} layout={layout} />
    )

  const buckets = state ? [state] : BUCKETS
  const scopeEmpty = scope === "done" ? scoped.done.length === 0 : scopeCount[scope] === 0
  const filteredEmpty = !scopeEmpty && (scope === "done" ? doneRows.length === 0 : buckets.every((b) => rowsIn(b).length === 0))

  return (
    <div className="mx-auto max-w-6xl space-y-4 py-4">
      {/* Control panel — title and New, the search bar with its facets, the view switch. */}
      <header className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module">
              <ListChecks size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-black text-foreground">{t("title")}</h1>
              <p className="text-xs text-muted-foreground line-clamp-1" title={t("desc")}>
                {t("desc")}
              </p>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5" role="group" aria-label={t("view_label")}>
              <ViewButton active={view === "list"} onClick={() => chooseView("list")} icon={List} label={t("view_list")} />
              <ViewButton active={view === "kanban"} onClick={() => chooseView("kanban")} icon={LayoutGrid} label={t("view_kanban")} />
            </div>
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} className="me-1.5" aria-hidden="true" />
              {t("add")}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-lg border bg-background ps-9 pe-2 py-1 focus-within:ring-2 focus-within:ring-ring">
            <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            {state && <Facet label={t(`kpi_${state}`)} onRemove={() => setState(null)} removeLabel={t("remove_filter_named", { name: t(`kpi_${state}`) })} />}
            {[...types].map((k) => (
              <Facet key={k} label={typeLabel(k)} onRemove={() => toggleType(k)} removeLabel={t("remove_filter_named", { name: typeLabel(k) })} />
            ))}
            <Input
              type="search"
              dir="auto"
              className="h-8 min-w-[10rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label={t("search_label")}
              placeholder={t("search_ph")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {filtering && (
            <button
              type="button"
              onClick={clear}
              className="rounded px-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("clear_filters")}
            </button>
          )}
        </div>
      </header>

      <SegmentedNav
        ariaLabel={t("scope_label")}
        active={scope}
        onSelect={(id) => {
          setScope(id as Scope)
          setState(null)
          setTypes(new Set())
        }}
        segments={[
          { id: "mine", label: t("scope_mine"), count: scopeCount.mine, tone: stateCount("overdue") > 0 && scope === "mine" ? "bad" : "mute" },
          { id: "by_me", label: t("group_by_me"), count: scopeCount.by_me },
          { id: "done", label: t("group_done"), count: scopeCount.done, tone: "ok" },
        ]}
      />

      {/* The state counters — Odoo's red / orange / green. Pressing one shows only that state. */}
      {scope !== "done" && (
        <div className="grid grid-cols-3 gap-3" role="group" aria-label={t("state_label")}>
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={state === b}
              onClick={() => setState(state === b ? null : b)}
              className={cn(
                "relative overflow-hidden rounded-xl border bg-card p-3 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                state === b && STATE_STYLE[b].on
              )}
            >
              <span className={cn("absolute inset-x-0 top-0 h-[3px]", STATE_STYLE[b].bar)} aria-hidden="true" />
              <span className="block text-xs font-semibold text-muted-foreground">{t(`kpi_${b}`)}</span>
              <span className={cn("mt-1 block text-2xl font-black tabular-nums", stateCount(b) > 0 ? STATE_STYLE[b].text : "text-foreground")} dir="ltr">
                {stateCount(b)}
              </span>
            </button>
          ))}
        </div>
      )}

      {typeOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("type_label")}>
          {typeOptions.map((k) => (
            <Chip key={k} selected={types.has(k)} onClick={() => toggleType(k)} count={typeCounts.get(k) ?? 0} icon={k === "queue" ? Inbox : TYPE_ICON[k]}>
              {typeLabel(k)}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-10">
          <Loader2 className="animate-spin text-primary" size={24} aria-hidden="true" />
        </div>
      ) : scopeEmpty ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{t(scope === "mine" ? "empty_mine" : scope === "by_me" ? "empty_by_me" : "empty_done")}</p>
      ) : filteredEmpty ? (
        <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          <p>{t("empty_filtered")}</p>
          <button type="button" onClick={clear} className="mt-2 text-sm font-semibold text-cta underline-offset-2 hover:underline">
            {t("clear_filters")}
          </button>
        </div>
      ) : scope === "done" ? (
        view === "kanban" ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {doneRows.map((a) => (
              <li key={a.id}>
                <ActivityRow activity={a} today={today} actor={actor} portal={portal} layout="card" />
              </li>
            ))}
          </ul>
        ) : (
          <section className="overflow-hidden rounded-xl border bg-card" aria-label={t("group_done")}>
            <div className="divide-y">
              {doneRows.map((a) => (
                <ActivityRow key={a.id} activity={a} today={today} actor={actor} portal={portal} />
              ))}
            </div>
          </section>
        )
      ) : view === "kanban" ? (
        <div className={cn("-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:overflow-visible sm:px-0", buckets.length === 1 ? "sm:grid-cols-1" : "sm:grid-cols-3")}>
          {buckets.map((b) => {
            const rows = rowsIn(b)
            return (
              <section key={b} className="w-[85vw] max-w-sm shrink-0 snap-start rounded-xl bg-muted/40 p-2 sm:w-auto sm:max-w-none" aria-label={t(GROUP_KEY[b])}>
                <header className="mb-2 flex items-center gap-2 px-1">
                  <span className={cn("h-2.5 w-2.5 rounded-full", STATE_STYLE[b].bar)} aria-hidden="true" />
                  <h2 className="text-sm font-black text-foreground">{t(GROUP_KEY[b])}</h2>
                  <span className="ms-auto rounded-full bg-background px-2 text-xs font-bold tabular-nums text-muted-foreground" dir="ltr">
                    {rows.length}
                  </span>
                </header>
                <div className="flex flex-col gap-2">
                  {rows.length === 0 ? <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t("column_empty")}</p> : rows.map((r) => renderRow(r, "card"))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {buckets.map((b) => {
            const rows = rowsIn(b)
            if (rows.length === 0) return null
            const isCollapsed = collapsed.has(b)
            return (
              <section key={b} className="overflow-hidden rounded-xl border bg-card" aria-label={t(GROUP_KEY[b])}>
                <h2>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(b)}
                    className="flex min-h-11 w-full items-center gap-2 border-b bg-muted/30 px-4 py-2.5 text-start text-sm font-black text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <ChevronDown size={15} className={cn("transition-transform", isCollapsed && "-rotate-90 rtl:rotate-90")} aria-hidden="true" />
                    <span className={cn("h-2.5 w-2.5 rounded-full", STATE_STYLE[b].bar)} aria-hidden="true" />
                    <span>{t(GROUP_KEY[b])}</span>
                    <span className={cn("ms-1 tabular-nums", STATE_STYLE[b].text)} dir="ltr">
                      ({rows.length})
                    </span>
                  </button>
                </h2>
                {!isCollapsed && <div className="divide-y">{rows.map((r) => renderRow(r, "row"))}</div>}
              </section>
            )
          })}
        </div>
      )}

      {adding && <ActivityFormDialog portal={portal} onClose={() => setAdding(false)} />}
    </div>
  )
}

function Facet({ label, onRemove, removeLabel }: { label: string; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-module/10 py-0.5 ps-2 pe-0.5 text-xs font-semibold text-module">
      <span>{label}</span>
      <button type="button" onClick={onRemove} aria-label={removeLabel} className="grid h-8 w-8 place-items-center rounded hover:bg-module/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  )
}

function ViewButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof List; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-11 sm:h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-module/10 text-module" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="max-sm:sr-only">{label}</span>
    </button>
  )
}

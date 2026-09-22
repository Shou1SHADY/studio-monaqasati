"use client"

// اليوم — Procurement's Today (PRD 3.0 §7.2 tab 1): three numbers, each a door
// to the list behind it; one decision list sorted by who-only-can-act, then
// severity, then days; the declared waits (no button — the action is theirs);
// and what the suppliers announced for this week. Everything on this screen is
// derived by `src/lib/procurement/today.ts` on every read — nothing here is
// stored, and a member who may not see money is handed no amount to hide.

import type { ElementType, ReactNode } from "react"
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, Clock, Hourglass, Info, Loader2, Sunrise, Truck } from "lucide-react"
import { Link } from "@/i18n/routing"
import { ProcurementHeader, type ProcurementKpi } from "@/components/contractor/ProcurementHeader"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { RECEIPT_HREF, TASK_GROUPS, todayKpis, todayTasks, todayWaits, type Task, type TaskGroup, type TaskSeverity, type Wait } from "@/lib/procurement/today"
import { displayDocNumber } from "@/lib/procurement/format"
import { arrivingThisWeek, toProcWorld } from "@/lib/procurement/shell"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

const CLIP_TASKS = 7
const CLIP_WAITS = 4
const CLIP_ARRIVING = 5

const SEVERITY_ICON: Record<TaskSeverity, ElementType> = { red: AlertTriangle, amber: Clock, blue: Info }
const SEVERITY_TILE: Record<TaskSeverity, string> = {
  red: "bg-destructive/10 text-destructive",
  amber: "bg-warning/10 text-warning",
  blue: "bg-module/10 text-module",
}
const MODULE_TAG: Record<Wait["module"], string> = {
  supplier: "bg-violet/10 text-violet",
  finance: "bg-success/10 text-success",
  inventory: "bg-accent/10 text-accent",
}

/** A figure with the sign, for a number isolated in `dir="ltr"`. */
const money = (n: number) => sarLtr(Math.round(n).toLocaleString("en-US"))
const compact = (n: number) => {
  const abs = Math.abs(n)
  const figure = abs >= 1_000_000 ? `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M` : abs >= 10_000 ? `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K` : Math.round(n).toLocaleString("en-US")
  return sarLtr(figure)
}

/** `YYYY-MM-DD` → a short day in the locale's script, Western digits in both. */
function fmtDay(day: string | null | undefined, locale: string): string {
  if (!day) return ""
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}

type Params = Record<string, string | number>

/** The parameters the sentences take, with the document number in the
 * reader's script and the days as dates. Numbers stay numbers — the ICU
 * `{x, number}` and plural forms need them. */
function presentParams(p: Params, locale: string): Params {
  const out: Params = { ...p }
  for (const k of ["number", "receipt"]) if (typeof out[k] === "string") out[k] = displayDocNumber(out[k] as string, locale)
  for (const k of ["date", "promised"]) if (typeof out[k] === "string" && out[k]) out[k] = fmtDay(out[k] as string, locale)
  return out
}

export function ProcurementToday() {
  const t = useTranslations("Portal.ProcToday")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const Chevron = isRtl ? ChevronLeft : ChevronRight
  const loaded = useProcurementWorld()
  const { actor, loading } = loaded
  // One clock per visit: the derivations take time as an input.
  const [now] = useState(() => new Date())

  const { orders, deliveries, rfqs, offers, policies, supplierFacts } = loaded
  const world = useMemo(() => toProcWorld({ orders, deliveries, rfqs, offers, policies, supplierFacts }), [orders, deliveries, rfqs, offers, policies, supplierFacts])
  const tasks = useMemo(() => todayTasks(world, actor, now), [world, actor, now])
  const waits = useMemo(() => todayWaits(world, actor, now), [world, actor, now])
  const kpis = useMemo(() => todayKpis(world, actor, now), [world, actor, now])
  const arriving = useMemo(() => arrivingThisWeek(world, now, RECEIPT_HREF), [world, now])

  const [group, setGroup] = useState<TaskGroup | "all">("all")
  const [allTasks, setAllTasks] = useState(false)
  const [allWaits, setAllWaits] = useState(false)
  const [allArriving, setAllArriving] = useState(false)

  const countOf = (g: TaskGroup) => tasks.filter((x) => x.group === g).length
  const groupsWithItems = TASK_GROUPS.filter((g) => countOf(g) > 0)
  const activeGroup = group !== "all" && countOf(group) === 0 ? "all" : group
  const shown = activeGroup === "all" ? tasks : tasks.filter((x) => x.group === activeGroup)
  const visibleTasks = allTasks ? shown : shown.slice(0, CLIP_TASKS)
  const visibleWaits = allWaits ? waits : waits.slice(0, CLIP_WAITS)
  const visibleArriving = allArriving ? arriving : arriving.slice(0, CLIP_ARRIVING)

  const headerKpis: ProcurementKpi[] = kpis.tiles.map((k) => ({
    id: k.id,
    label: t(k.labelKey),
    value: k.unit === "money" ? compact(k.value) : k.value.toLocaleString("en-US"),
    note: t(k.noteKey, k.noteParams),
    tone: k.tone,
    href: k.href,
  }))

  const taskTitle = (task: Task) => t(task.titleKey, presentParams(task.titleParams, locale))
  const taskSub = (task: Task) => (task.subNs === "Procurement" ? tProc(task.subKey, presentParams(task.subParams, locale)) : t(task.subKey, presentParams(task.subParams, locale)))

  return (
    <div className="space-y-6">
      <ProcurementHeader icon={Sunrise} title={t("page.title")} description={t("page.subtitle")} kpis={loading ? undefined : headerKpis} />

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          {/* ── Needs your decision ── */}
          <Panel title={t("title")} subtitle={t("subtitle")} icon={AlertTriangle} count={tasks.length}>
            {tasks.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" role="group" aria-label={t("groups.all")}>
                {(["all", ...groupsWithItems] as Array<TaskGroup | "all">).map((g) => {
                  const count = g === "all" ? tasks.length : countOf(g)
                  const on = activeGroup === g
                  return (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setGroup(g)
                        setAllTasks(false)
                      }}
                      className={cn(
                        "flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-module bg-module text-white" : "border-border bg-white text-muted-foreground hover:border-module/40 hover:text-foreground"
                      )}
                    >
                      {t(`groups.${g}`)}
                      <span className={cn("tabular-nums", on ? "text-white/80" : "text-muted-foreground/80")}>{count}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {tasks.length === 0 ? (
              <Empty icon={CheckCircle2} title={t("empty.title")} body={t("empty.body")} />
            ) : (
              <ul className="divide-y">
                {visibleTasks.map((task) => {
                  const Icon = SEVERITY_ICON[task.severity]
                  return (
                    <li key={task.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
                      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", SEVERITY_TILE[task.severity])}>
                        <Icon size={16} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm font-bold leading-snug text-foreground" dir="auto">
                          {taskTitle(task)}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground" dir="auto">
                          {taskSub(task)}
                          {task.kind === "reject_decide" && task.reasonCode && (
                            <span className="ms-1.5 inline-block rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">{tProc(`rejectReason.${task.reasonCode}`)}</span>
                          )}
                        </p>
                      </div>
                      {task.amount != null && (
                        <span className="shrink-0 self-center text-sm font-black tabular-nums text-foreground" dir="ltr">
                          {money(task.amount)}
                        </span>
                      )}
                      <Link
                        href={task.href}
                        className={cn(
                          "inline-flex min-h-9 shrink-0 items-center gap-1 self-center rounded-lg border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          "max-sm:ms-11 max-sm:basis-full max-sm:justify-center",
                          task.priority === 0 ? "border-module bg-module text-white hover:bg-module/90" : "border-border bg-white text-foreground hover:border-module/40"
                        )}
                      >
                        {t(task.actionKey)}
                        <Chevron size={13} aria-hidden="true" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            {shown.length > CLIP_TASKS && <MoreButton open={allTasks} onClick={() => setAllTasks((v) => !v)} label={allTasks ? t("showLess") : t("showMore", { count: shown.length - CLIP_TASKS })} />}
          </Panel>

          <div className="space-y-4">
            {/* ── Waiting on other modules — no button, by design ── */}
            <Panel title={t("waits.title")} subtitle={t("waits.subtitle")} icon={Hourglass} count={waits.length}>
              {waits.length === 0 ? (
                <Empty icon={CheckCircle2} title={t("waits.empty")} />
              ) : (
                <ul className="divide-y">
                  {visibleWaits.map((w) => (
                    <li key={w.id} className="px-4 py-3">
                      <span className={cn("mb-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold", MODULE_TAG[w.module])}>{t("waits.on", { module: t(`modules.${w.module}`) })}</span>
                      <p className="text-sm font-bold leading-snug text-foreground" dir="auto">
                        {t(w.titleKey, presentParams(w.titleParams, locale))}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                        {t(w.subKey, presentParams(w.subParams, locale))}
                        {w.kind === "held_inspection" && w.reasonCode && <> · {tProc(`holdReason.${w.reasonCode}`)}</>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {waits.length > CLIP_WAITS && <MoreButton open={allWaits} onClick={() => setAllWaits((v) => !v)} label={allWaits ? t("showLess") : t("moreRows", { count: waits.length - CLIP_WAITS })} />}
            </Panel>

            {/* ── Arriving this week — by the supplier's notice; Inventory records the receipt ── */}
            <Panel title={t("arriving.title")} subtitle={t("arriving.subtitle")} icon={Truck} count={arriving.length}>
              {arriving.length === 0 ? (
                <Empty icon={CalendarClock} title={t("arriving.empty")} />
              ) : (
                <ul className="divide-y">
                  {visibleArriving.map((row) => (
                    <li key={row.id}>
                      <Link href={row.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="truncate text-sm font-bold text-foreground" dir="auto">
                            {row.lines || row.supplierName}
                          </p>
                          <p className="text-xs text-muted-foreground" dir="auto">
                            {row.number && (
                              <>
                                <span dir="ltr" className="font-mono">
                                  {displayDocNumber(row.number, locale)}
                                </span>{" "}
                                ·{" "}
                              </>
                            )}
                            {row.supplierName}
                          </p>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", row.inDays < 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                          {row.inDays < 0 ? t("arriving.late", { days: -row.inDays }) : t("arriving.on", { date: fmtDay(row.date, locale), inDays: row.inDays })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {arriving.length > CLIP_ARRIVING && <MoreButton open={allArriving} onClick={() => setAllArriving((v) => !v)} label={allArriving ? t("showLess") : t("moreRows", { count: arriving.length - CLIP_ARRIVING })} />}
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}

function Panel({ title, subtitle, icon: Icon, count, children }: { title: string; subtitle: string; icon: ElementType; count?: number; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-white">
      <header className="flex items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            <Icon size={15} className="shrink-0 text-module" aria-hidden="true" />
            {title}
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>
        </div>
        {count != null && count > 0 && <span className="shrink-0 rounded-full bg-module/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-module">{count}</span>}
      </header>
      {children}
    </section>
  )
}

function Empty({ icon: Icon, title, body }: { icon: ElementType; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
      <Icon size={20} className="text-success" aria-hidden="true" />
      <p className="text-sm font-bold text-foreground">{title}</p>
      {body && <p className="text-xs text-muted-foreground">{body}</p>}
    </div>
  )
}

function MoreButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t bg-muted/20 text-xs font-bold text-module transition-colors hover:bg-module/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {label}
      <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  )
}

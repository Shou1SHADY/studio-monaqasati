"use client"

// The Contract tab's Programme (PM 1.0 §8, PRG-01/02, the prototype's
// "البرنامج الزمني"): the duration in force and its revisions, planned against
// actual, the projected damages, plan against actual by BOQ division, and the
// activities laid over the programme. There is no button to edit the plan, on
// purpose: a new revision comes only from a claim granted with days.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { CalendarClock, CalendarRange, Clock, FileClock, ListChecks, Loader2, Pencil, Plus, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { progressOf } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { claimNo, delayAndDamages, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { PM_SHEETS, type PmSheet } from "@/lib/pm/measurement"
import {
  activityBlocks,
  activityNext,
  activityPlanned,
  activityProgress,
  activityState,
  criticalPath,
  effectiveDuration,
  PM_ACTIVITIES,
  planF,
  plannedLine,
  programmeK,
  programmeRevisions,
  progressCurve,
  type CurvePoint,
  type ActivityState,
  type PmActivity,
} from "@/lib/pm/programme"
import { addActivity, PmActivityError, updateActivity, type ActivityActor } from "@/lib/pm/programme-writes"
import { sectionRows } from "@/lib/pm/pulse"
import type { ContractTerms } from "@/lib/pm/terms"
import { approvedValue, PM_VARIATIONS, type PmVariation } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"

type Item = {
  id: string
  code?: string
  description?: string
  division?: string
  quantity: number
  rate: number
  executed: number
}

const spanDays = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))

const STATE_TONE: Record<ActivityState, PillTone> = {
  done: "ok",
  run: "info",
  late: "bad",
  soon: "mute",
  idle: "warn",
}

export function ProgrammePanel({
  projectId,
  lifecycle,
  original,
  startOn,
  durationDays,
  baseValue,
  items,
  access,
  actor,
  showActivities = true,
}: {
  projectId: string
  lifecycle: string
  original: ContractTerms
  startOn: string | null
  durationDays: number
  baseValue: number
  items: Item[]
  access: PmAccess
  actor: ActivityActor
  /** The detailed schedule section (`sched`): activities show only when it is on. */
  showActivities?: boolean
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const money = access.has("money")
  const seesTerms = money || access.has("approve")

  const claimQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId])
  const { data: claimData } = useCollection(claimQ)
  const addQ = useMemoFirebase(() => (firestore && seesTerms ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId, seesTerms])
  const { data: addenda } = useCollection(addQ)
  const voQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId])
  const { data: vos } = useCollection(voQ)
  const sheetQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SHEETS) : null), [firestore, projectId])
  const { data: sheetData } = useCollection(sheetQ)
  const actQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ACTIVITIES) : null), [firestore, projectId])
  const { data: actData } = useCollection(actQ)

  const claims = useMemo(() => (claimData ?? []) as unknown as PmClaim[], [claimData])
  const terms = useMemo(() => inForce(original, (addenda ?? []) as unknown as PmAddendum[]), [original, addenda])
  const effective = effectiveDuration(durationDays, claims)
  const start = startOn ? startOn.slice(0, 10) : null
  const contractValue = baseValue + approvedValue((vos ?? []) as unknown as PmVariation[])
  const progress = progressOf(items)
  const actsRaw = useMemo(() => (actData ?? []) as unknown as PmActivity[], [actData])
  const k = useMemo(() => programmeK({ acts: actsRaw, items, startOn: start, durationDays, today }), [actsRaw, items, start, durationDays, today])
  const delayBase = {
    lifecycle,
    startOn: start,
    progress,
    contractValue,
    damages: terms.damages,
    today,
    curveK: k,
  }
  const delay = delayAndDamages({ ...delayBase, effectiveDays: effective })
  const delayOnOriginal = effective > durationDays ? delayAndDamages({ ...delayBase, effectiveDays: durationDays }) : null
  const revisions = programmeRevisions({
    durationDays,
    startOn: start,
    claims,
  })
  const current = revisions[revisions.length - 1]
  const rateById = useMemo(() => new Map(items.map((i) => [i.id, i.rate])), [items])
  const curve = useMemo(
    () =>
      progressCurve({
        startOn: start,
        effectiveDays: effective,
        contractValue: items.reduce((a, i) => a + (i.rate > 0 ? i.quantity * i.rate : 0), 0),
        sheets: (sheetData ?? []) as unknown as PmSheet[],
        rateOf: (id) => rateById.get(id) ?? 0,
        today,
        k,
      }),
    [start, effective, items, sheetData, rateById, today, k],
  )
  const sections = useMemo(
    () =>
      sectionRows(
        items.map((i) => ({
          division: i.division || "",
          quantity: i.quantity,
          rate: i.rate,
          executed: i.executed,
        })),
        delay?.planned ?? null,
      ),
    [items, delay?.planned],
  )
  const sectionCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) if (i.division && i.rate > 0 && i.quantity > 0) m.set(i.division, (m.get(i.division) ?? 0) + 1)
    return m
  }, [items])
  const acts = useMemo(() => actsRaw.slice().sort((a, b) => a.from.localeCompare(b.from) || a.seq - b.seq), [actsRaw])
  const critical = useMemo(() => criticalPath(acts), [acts])
  const canManage = !access.ctx.archived && access.allowed("programme.manage")
  const [editing, setEditing] = useState<PmActivity | "new" | null>(null)
  const gap = delay ? Math.round((delay.planned - (progress ?? 0)) * 10) / 10 : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          icon={CalendarClock}
          label={t("prg.in_force")}
          value={t("days", { count: effective })}
          note={
            start
              ? t(effective - durationDays > 0 ? "prg.ends" : "prg.ends_no_eot", {
                  rev: `R${current.rev}`,
                  date: pmDate(current.endOn || "", locale),
                  eot: effective - durationDays,
                })
              : t("prg.not_started")
          }
        />
        <Tile
          icon={TrendingUp}
          label={t("prg.plan_vs_actual")}
          value={delay ? `${delay.planned}% / ${progress ?? 0}%` : "—"}
          note={delay ? (gap > 0.5 ? t("prg.behind", { pts: gap, rev: `R${current.rev}` }) : t("prg.on_plan")) : t("prg.no_plan")}
          bad={gap > 4}
        />
        <Tile
          icon={Clock}
          label={t("prg.penalty")}
          value={!terms.damages.on ? t("prg.no_penalty") : money ? pmMoney(delay?.damages ?? 0) : "—"}
          note={terms.damages.on ? (delay?.delayDays ? t("prg.delay_days", { count: delay.delayDays }) : t("prg.no_delay")) : t("prg.penalty_off")}
          bad={(delay?.damages ?? 0) > 0}
        />
      </div>

      {money && terms.damages.on && delay && delayOnOriginal && delayOnOriginal.damages > delay.damages && (
        <Callout tone="info" title={t("prg.eot_counts_title")}>
          {t("prg.eot_counts", {
            eot: t("days", { count: effective - durationDays }),
            now: pmMoney(delay.damages),
            was: pmMoney(delayOnOriginal.damages),
            diff: pmMoney(delayOnOriginal.damages - delay.damages),
          })}
        </Callout>
      )}

      <Panel title={t("prg.curve_title")} icon={TrendingUp}>
        {curve.length < 2 || lifecycle === "plan" ? (
          <p className="text-sm text-muted-foreground">{t("prg.curve_empty")}</p>
        ) : (
          <>
            <SCurve
              points={curve}
              effective={effective}
              original={revisions.length > 1 ? durationDays : null}
              k={k}
              start={start ?? ""}
              today={today}
              planned={delay?.planned ?? null}
              actual={progress}
              rev={`R${current.rev}`}
            />
            <p className="mt-2 text-xs text-muted-foreground">{k === 1 ? t("prg.curve_note") : t("prg.curve_note_k")}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-cta">{t("prg.as_table")}</summary>
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-start font-semibold">{t("prg.date")}</th>
                    <th className="py-1 text-end font-semibold">
                      {t("prg.planned")} R{current.rev}
                    </th>
                    <th className="py-1 text-end font-semibold">{t("prg.actual")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {curve.map((p) => (
                    <tr key={p.day}>
                      <td className="py-1">{pmDate(p.day, locale)}</td>
                      <td className="py-1 text-end tabular-nums" dir="ltr">
                        {p.planned}%
                      </td>
                      <td className="py-1 text-end tabular-nums" dir="ltr">
                        {p.actual == null ? "—" : `${p.actual}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </Panel>

      <Panel title={t("prg.revisions_title")} icon={FileClock} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("prg.revisions_desc")}</p>
        <ul className="divide-y">
          {revisions
            .slice()
            .reverse()
            .map((r, i) => (
              <li key={r.rev} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span dir="ltr">R{r.rev}</span>
                    <StatusPill tone={i === 0 ? "ok" : "mute"}>{i === 0 ? t("prg.rev_in_force") : t("prg.rev_superseded")}</StatusPill>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.claimSeq == null
                      ? t("prg.rev_original")
                      : t("prg.rev_claim", {
                          no: claimNo(r.claimSeq),
                          days: r.granted,
                        })}
                    {r.on ? ` · ${pmDate(r.on, locale)}` : ""}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-black">{t("days", { count: r.days })}</p>
                  <p className="text-xs text-muted-foreground">{r.endOn ? t("prg.rev_ends", { date: pmDate(r.endOn, locale) }) : "—"}</p>
                </div>
              </li>
            ))}
        </ul>
      </Panel>

      {sections.length > 0 && (
        <Panel title={t("prg.sections_title")} icon={ListChecks} bodyClassName="p-0">
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            {t("prg.sections_desc", {
              planned: delay?.planned ?? 0,
              rev: `R${current.rev}`,
            })}
          </p>
          <ul className="divide-y">
            {sections.map((s) => (
              <li key={s.division} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                  <b className="font-semibold">{s.division}</b>
                  <span className="text-xs text-muted-foreground"> · {t("prg.sec_items", { count: sectionCount.get(s.division) ?? 0 })}</span>
                </span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{t("prg.sec_plan", { pct: Math.round(s.planned ?? s.progress - s.deviation) })}</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted sm:w-48">
                  <div
                    className={cn("h-full rounded-full", s.deviation < -6 ? "bg-destructive" : s.deviation < -2 ? "bg-warning" : "bg-success")}
                    style={{
                      width: `${Math.min(100, Math.max(0, s.progress))}%`,
                    }}
                  />
                </div>
                <span className="w-12 text-end text-xs font-bold tabular-nums" dir="ltr">
                  {Math.round(s.progress)}%
                </span>
                <span className={cn("w-10 text-end text-xs font-bold tabular-nums", s.deviation < -4 ? "text-destructive" : s.deviation > 2 ? "text-success" : "text-muted-foreground")} dir="ltr">
                  {s.deviation >= 0 ? "+" : ""}
                  {Math.round(s.deviation)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Callout tone="info">{t("prg.no_edit_note")}</Callout>

      {showActivities && (
        <Panel
          title={t("prg.acts_title")}
          icon={CalendarRange}
          count={acts.length || undefined}
          actions={
            canManage ? (
              <Button size="sm" className="gap-1.5 bg-module text-module-foreground hover:bg-module/90" onClick={() => setEditing("new")}>
                <Plus size={14} aria-hidden="true" /> {t("prg.act_add")}
              </Button>
            ) : undefined
          }
          bodyClassName="p-0"
        >
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("prg.acts_desc")}</p>
          {acts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("prg.acts_empty")}</p>
          ) : (
            <ActivityRows acts={acts} items={items} critical={critical} today={today} canManage={canManage} onEdit={setEditing} />
          )}
        </Panel>
      )}

      {editing && <ActivityDialog projectId={projectId} access={access} actor={actor} items={items} acts={acts} editing={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const W = 640
const H = 236
const L = 38
const R = 14
const T = 16
const B = 30

/** Planned (in force, and R01 dashed once extended) against actual, with today's line (the prototype's sCurve). */
function SCurve({
  points,
  effective,
  original,
  k,
  start,
  today,
  planned,
  actual,
  rev,
}: {
  points: CurvePoint[]
  effective: number
  original: number | null
  k: number
  start: string
  today: string
  planned: number | null
  actual: number | null
  rev: string
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const dayOf = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
  const span = Math.max(effective, original ?? 0) + 6
  const X = (d: number) => L + (d / span) * (W - L - R)
  const Y = (v: number) => T + (1 - v / 100) * (H - T - B)
  const line = (dur: number) =>
    plannedLine(dur, k)
      .map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`)
      .join(" ")
  const act = points.filter((p) => p.actual !== null).map((p) => [dayOf(p.day), p.actual as number] as const)
  const now = Math.max(0, dayOf(today))
  const gap = planned !== null && actual !== null ? planned - actual : 0
  const ticks: number[] = []
  const stepDays = Math.max(30, Math.round(span / 7 / 30) * 30)
  for (let d = 0; d <= span; d += stepDays) ticks.push(d)
  const dayLabel = (d: number) => pmDate(new Date(Date.parse(`${start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10), locale)
  const [hover, setHover] = useState<number | null>(null)
  const clampDay = (d: number) => Math.max(0, Math.min(span, Math.round(d)))
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / Math.max(1, box.width)) * W
    setHover(clampDay(((x - L) / (W - L - R)) * span))
  }
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    setHover((h) => clampDay((h ?? now) + (e.key === "ArrowRight" ? 7 : -7)))
  }
  // The actual line at a day: the last approved measurement on or before it — nothing after today.
  const actualAt = (d: number) => (d > now ? null : (act.filter(([x]) => x <= d).pop()?.[1] ?? null))
  const readout =
    hover === null
      ? null
      : [
          t("prg.hover_planned", { date: dayLabel(hover), rev, pct: Math.round(planF(Math.min(1, hover / effective), k)) }),
          original !== null ? t("prg.hover_r0", { pct: Math.round(planF(Math.min(1, hover / original), k)) }) : null,
          actualAt(hover) !== null ? t("prg.hover_actual", { pct: actualAt(hover) as number }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-0.5 w-4 bg-pm" aria-hidden="true" />
          {t("prg.legend_planned", { rev })}
        </span>
        {original !== null && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden="true" />
            {t("prg.legend_r01")}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-0.5 w-4 bg-warning" aria-hidden="true" />
          {t("prg.legend_actual")}
        </span>
      </div>
      <p className="mb-1 min-h-5 text-xs font-semibold tabular-nums text-foreground" aria-live="polite">
        {readout ?? <span className="font-normal text-muted-foreground">{t("prg.hover_hint")}</span>}
      </p>
      <div dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t("prg.curve_aria")}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(now)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
          className="block h-auto w-full touch-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="stroke-muted" strokeWidth={1} />
              <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" fontSize={10} className="fill-muted-foreground">
                {v}%
              </text>
            </g>
          ))}
          {ticks.map((d) => (
            <text key={d} x={X(d)} y={H - 10} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
              {dayLabel(d)}
            </text>
          ))}
          {original !== null && <polyline points={line(original)} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 4" />}
          <polyline points={line(effective)} fill="none" className="stroke-pm" strokeWidth={2} />
          <polyline points={act.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" className="stroke-warning" strokeWidth={2} />
          {act.slice(1).map(([d, v]) => (
            <circle key={`${d}-${v}`} cx={X(d)} cy={Y(v)} r={4} className="fill-warning stroke-background" strokeWidth={2}>
              <title>{`${dayLabel(d)} · ${t("prg.planned")} ${Math.round(planF(d / effective, k))}% · ${t("prg.actual")} ${v}%`}</title>
            </circle>
          ))}
          {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} className="stroke-cta" strokeWidth={1} />}
          <line x1={X(now)} x2={X(now)} y1={T} y2={H - B} className="stroke-foreground/60" strokeWidth={1} strokeDasharray="2 3" />
          <text x={X(now) + 5} y={T + 9} fontSize={10} fontWeight={700} className="fill-foreground/70">
            {t("prg.today")}
          </text>
          {planned !== null && actual !== null && gap > 1 && (
            <g>
              <line x1={X(now)} x2={X(now)} y1={Y(planned)} y2={Y(actual)} className="stroke-foreground" strokeWidth={2} />
              <text x={X(now) + 6} y={(Y(planned) + Y(actual)) / 2 + 3.5} fontSize={10.5} fontWeight={700} className="fill-foreground">
                {t("prg.behind_short", { pts: Math.round(gap) })}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}

function Tile({ icon: Icon, label, value, note, bad }: { icon: typeof Clock; label: string; value: string; note: string; bad?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon size={13} aria-hidden="true" /> {label}
      </p>
      <p className={cn("mt-1 text-xl font-black tabular-nums", bad ? "text-destructive" : "text-foreground")} dir="auto">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

function ActivityRows({
  acts,
  items,
  critical,
  today,
  canManage,
  onEdit,
}: {
  acts: PmActivity[]
  items: Item[]
  critical: Set<string>
  today: string
  canManage: boolean
  onEdit: (a: PmActivity) => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const lo = acts.reduce((m, a) => (a.from < m ? a.from : m), today < acts[0].from ? today : acts[0].from)
  const hi = acts.reduce((m, a) => (a.to > m ? a.to : m), today > acts[0].to ? today : acts[0].to)
  const pos = (d: string) => {
    const span = Math.max(1, Date.parse(hi) - Date.parse(lo))
    return ((Date.parse(d) - Date.parse(lo)) / span) * 100
  }
  const codeOf = new Map(items.map((i) => [i.id, i.code || ""]))
  return (
    <ul className="divide-y">
      {acts.map((a) => {
        const pc = activityProgress(a, items)
        const st = activityState(a, pc, today)
        const plan = activityPlanned(a, today)
        const next = activityNext(acts, a.id)
        const left = pos(a.from)
        const width = Math.max(2, pos(a.to) - left)
        return (
          <li key={a.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <span dir="auto">{a.name}</span>
                {critical.has(a.id) && <StatusPill tone="bad">{t("prg.critical")}</StatusPill>}
                {a.permit && <StatusPill tone="warn">{t("prg.act_permit_pill")}</StatusPill>}
              </p>
              <p className="text-xs text-muted-foreground" dir="auto">
                {pmDate(a.from, locale)} — {pmDate(a.to, locale)} · {t("days", { count: spanDays(a.from, a.to) })}
                {a.itemIds.length > 0 &&
                  ` · ${a.itemIds
                    .map((id) => codeOf.get(id) || "")
                    .filter(Boolean)
                    .join(" · ")}`}
              </p>
              <div className="relative mt-2 h-2 rounded-full bg-muted" dir="ltr">
                <span className="absolute inset-y-0 rounded-full bg-pm/25" style={{ left: `${left}%`, width: `${width}%` }} />
                <span
                  className="absolute inset-y-0 rounded-full bg-pm"
                  style={{
                    left: `${left}%`,
                    width: `${width * Math.min(1, (pc ?? 0) / 100)}%`,
                  }}
                />
                <span className="absolute -inset-y-1 w-px bg-destructive" style={{ left: `${pos(today)}%` }} aria-hidden="true" />
              </div>
              {st === "late" && (
                <p className="mt-1 text-xs font-semibold text-destructive">
                  {next.length
                    ? t("prg.act_late_blocks", {
                        pts: Math.round(plan - (pc ?? 0)),
                        names: next.map((n) => n.name).join(" · "),
                      })
                    : t("prg.act_late", { pts: Math.round(plan - (pc ?? 0)) })}
                </p>
              )}
              {st === "idle" && <p className="mt-1 text-xs font-semibold text-amber-600">{t("prg.act_idle", { date: pmDate(a.from, locale) })}</p>}
              {pc == null && <p className="mt-1 text-xs text-muted-foreground">{t("prg.act_no_items")}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusPill tone={STATE_TONE[st]}>{t(`prg.state.${st}`)}</StatusPill>
              <span className="text-xs font-bold tabular-nums" dir="ltr">
                {pc == null ? "—" : `${pc}%`}
              </span>
              <span className="text-[11px] text-muted-foreground">{t("prg.act_plan", { pc: plan })}</span>
              {canManage && (
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onEdit(a)} aria-label={t("prg.act_edit")}>
                  <Pencil size={12} aria-hidden="true" />
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const NONE = "__none__"

function ActivityDialog({
  projectId,
  access,
  actor,
  items,
  acts,
  editing,
  onClose,
}: {
  projectId: string
  access: PmAccess
  actor: ActivityActor
  items: Item[]
  acts: PmActivity[]
  editing: PmActivity | null
  onClose: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [name, setName] = useState(editing?.name ?? "")
  const [from, setFrom] = useState(editing?.from ?? today)
  const [to, setTo] = useState(editing?.to ?? "")
  const [picked, setPicked] = useState<string[]>(editing?.itemIds ?? [])
  const [pred, setPred] = useState<string>(editing?.pred ?? NONE)
  const [permit, setPermit] = useState<boolean>(Boolean(editing?.permit))
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState(false)
  const blocks = activityBlocks(
    {
      id: editing?.id ?? null,
      name,
      from,
      to,
      pred: pred === NONE ? null : pred,
    },
    acts,
  )
  const shown = items.filter((i) => !filter.trim() || `${i.code} ${i.description}`.toLowerCase().includes(filter.trim().toLowerCase()))

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const input = {
        name,
        from,
        to,
        itemIds: picked,
        pred: pred === NONE ? null : pred,
        permit,
      }
      if (editing) await updateActivity(firestore, access.ctx, projectId, editing.id, input)
      else await addActivity(firestore, access.ctx, projectId, actor, input)
      toast({ title: t("prg.act_saved") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({
        title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmActivityError && err.blocks[0] ? `prg.block.${err.blocks[0]}` : "error.save"),
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{editing ? t("prg.act_edit") : t("prg.act_add")}</DialogTitle>
          <DialogDescription>{t("prg.act_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="act-name">{t("prg.act_name")}</Label>
            <Input id="act-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("prg.act_name_ph")} dir="auto" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="act-from">{t("prg.act_from")}</Label>
              <Input id="act-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-to">{t("prg.act_to")}</Label>
              <Input id="act-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} dir="ltr" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-pred">{t("prg.act_pred")}</Label>
            <Select value={pred} onValueChange={setPred}>
              <SelectTrigger id="act-pred">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("prg.act_pred_none")}</SelectItem>
                {acts
                  .filter((a) => a.id !== editing?.id)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-items">{t("prg.act_items", { count: picked.length })}</Label>
            <Input id="act-items" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("prg.act_items_ph")} dir="auto" />
            <ul className="max-h-44 divide-y overflow-y-auto rounded-lg border">
              {shown.map((i) => (
                <li key={i.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/40">
                    <input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
                    <span className="font-mono" dir="ltr">
                      {i.code}
                    </span>
                    <span className="truncate" dir="auto">
                      {i.description}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">{picked.length ? t("prg.act_items_hint") : t("prg.act_items_none")}</p>
          </div>
          <label htmlFor="act-permit" className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
            <input id="act-permit" type="checkbox" checked={permit} onChange={(e) => setPermit(e.target.checked)} className="h-4 w-4" />
            <span>
              <b className="block">{t("prg.act_permit")}</b>
              <span className="text-xs text-muted-foreground">{t("prg.act_permit_hint")}</span>
            </span>
          </label>
          {blocks.length > 0 && (name || to) && <p className="text-xs text-destructive">{t(`prg.block.${blocks[0]}`)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={busy || blocks.length > 0} className="gap-1.5">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t("prg.act_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

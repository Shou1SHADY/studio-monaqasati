// PM 1.0 — the three-week look-ahead and the weekly plan (PRD WWP-01…05,
// WF-21). The programme says when work must finish; the weekly plan says what
// will actually start next week and whether it is ready. Every constraint is
// COMPUTED from what the module already holds — never ticked by hand:
//   dwg  current drawing   — no drawing revised after the last approved measurement
//   subm approved sample   — every item needing a sample has an approved one
//   pred preceding work    — the preceding activity at ≥ 95%
//   insp passed inspection — no failed inspection on an item needing one
//   rfi  no open obstacle  — no open obstacle stopping one of its items
//   pmt  valid work permit — for an activity that needs a permit, one is live
//   mat  materials on site — every material of its items is on the project, or
//        an approved request brings it within a week of the start
//   crew plant             — every approved equipment request of the activity
//        was received on site (not evaluated when it asked for none)
// Committing with open constraints is allowed and
// recorded; at the week's end every task not done needs a reason from a closed
// list ("other" stated) — a repeated cause is a management defect, not bad
// luck. PPC = done ÷ committed. Pure: no I/O.

import { activityProgress, addDays, type PmActivity } from "./programme"
import { sampleStateOf } from "./sample"
import { storeBalance, type PmStoreLine } from "./store"
import { lineOut, type PmMaterialRequest } from "./supply"

/** `projects/{id}/pmWeeks/{weekStart}` — one plan a week, keyed by its first day. */
export const PM_WEEKS = "pmWeeks"

export const LOOKAHEAD_WEEKS = 3
export const PRED_READY = 95

export const CONSTRAINTS = ["dwg", "subm", "mat", "pred", "insp", "rfi", "crew", "pmt"] as const
export type ConstraintKey = (typeof CONSTRAINTS)[number]

/** A computed constraint. `ok: null` = not evaluated. `detail` words the failure. */
export interface Constraint {
  k: ConstraintKey
  ok: boolean | null
  detail?:
    | { kind: "stale"; count: number }
    | { kind: "sample"; code: string; state: "not_submitted" | "rejected" | "with_consultant" }
    | { kind: "pred"; name: string; pc: number }
    | { kind: "failed"; code: string }
    | { kind: "obstacle"; title: string; party: string; partyName?: string | null }
    | { kind: "no_permit" }
    | { kind: "materials"; names: string[]; count: number }
    | { kind: "plant"; what: string; count: number }
}

export interface LookItem {
  id: string
  code: string
  quantity: number
  rate: number
  executed: number
  unit?: string
  gate?: { pmInspect?: boolean | null; pmWir?: string | null }
  pmSample?: boolean | null
  pmSub?: string | null
}

export type LookActivity = PmActivity & { permit?: boolean | null }

/** An equipment request as the look-ahead reads it: approved (`go`) and whether it reached the site. */
export interface LookPlant {
  activityId: string | null
  status: string
  what: string
  got?: unknown
}

export interface LookFacts {
  items: LookItem[]
  activities: LookActivity[]
  /** Open obstacles and the items they stop. `party` is the stored code; the name is only what was typed. */
  obstacles: LookObstacle[]
  livePermits: number
  staleDrawings: number
  /** The project store and the material requests (mat), the equipment requests (crew). */
  stores?: PmStoreLine[]
  requests?: Array<Pick<PmMaterialRequest, "status" | "withdrawn" | "needBy" | "lines">>
  plant?: LookPlant[]
  /** Which sections the project has on — a constraint of a section that is off is not evaluated. */
  on: { docs: boolean; subm: boolean; wir: boolean; rfi: boolean; hse: boolean; stock?: boolean; eqp?: boolean }
}

export interface LookObstacle {
  title: string
  party: string
  partyName?: string | null
  itemIds: string[]
  closeOn?: string | null
}

/** An obstacle as the look-ahead reads it. The party's code and the name typed
 * for it travel apart: the screen words the code in the reader's language when
 * no name was typed — a stored code is never shown in a name's place. */
export const lookObstacle = (o: { title: string; party: string; partyName?: string | null; itemIds?: string[] | null; closeOn?: string | null }): LookObstacle => ({
  title: o.title,
  party: o.party,
  partyName: o.partyName?.trim() || null,
  itemIds: o.itemIds ?? [],
  closeOn: o.closeOn ?? null,
})

/** Materials of the activity's items that are neither on the project nor
 * brought by an approved request within a week of its start. */
export function missingMaterials(a: Pick<LookActivity, "from" | "itemIds">, f: Pick<LookFacts, "items" | "stores" | "requests">, today: string): string[] {
  const items = f.items.map((i) => ({ id: i.id, code: i.code, description: "", unit: i.unit ?? "", quantity: i.quantity, executed: i.executed }))
  const by = addDays(a.from > today ? a.from : today, 7)
  const out: string[] = []
  for (const x of f.stores ?? []) {
    const ids = a.itemIds.filter((id) => id in (x.rates || {}))
    if (!ids.length || storeBalance(x, items) > 0.005) continue
    const coming = (f.requests ?? []).some(
      (r) => r.status === "approved" && !r.withdrawn && (!r.needBy || r.needBy <= by) && r.lines.some((l) => l.key === x.key && (!l.itemId || ids.includes(l.itemId)) && lineOut(l) > 0)
    )
    if (!coming) out.push(x.name)
  }
  return out
}

const pcOf = (a: Pick<PmActivity, "itemIds">, items: LookItem[]) => activityProgress(a, items) ?? 0

/** The constraints of one activity. */
export function activityConstraints(a: LookActivity, f: LookFacts, today = new Date().toISOString().slice(0, 10)): Constraint[] {
  const out: Constraint[] = []
  const mine = f.items.filter((i) => a.itemIds.includes(i.id))
  if (f.on.docs) out.push({ k: "dwg", ok: f.staleDrawings === 0, detail: f.staleDrawings ? { kind: "stale", count: f.staleDrawings } : undefined })
  if (f.on.subm) {
    const bad = mine.find((i) => { const s = sampleStateOf(i); return s !== "free" && s !== "approved" })
    const state = bad ? sampleStateOf(bad) : null
    out.push({ k: "subm", ok: !bad, detail: bad && state && state !== "free" && state !== "approved" ? { kind: "sample", code: bad.code, state } : undefined })
  }
  if (a.pred) {
    const p = f.activities.find((x) => x.id === a.pred)
    const pc = p ? pcOf(p, f.items) : 100
    out.push({ k: "pred", ok: pc >= PRED_READY, detail: p && pc < PRED_READY ? { kind: "pred", name: p.name, pc } : undefined })
  }
  if (f.on.wir) {
    const bad = mine.find((i) => i.gate?.pmInspect && i.gate.pmWir === "fail")
    out.push({ k: "insp", ok: !bad, detail: bad ? { kind: "failed", code: bad.code } : undefined })
  }
  if (f.on.rfi) {
    const o = f.obstacles.find((x) => !x.closeOn && x.itemIds.some((id) => a.itemIds.includes(id)))
    out.push({ k: "rfi", ok: !o, detail: o ? { kind: "obstacle", title: o.title, party: o.party, partyName: o.partyName ?? null } : undefined })
  }
  if (f.on.stock) {
    const miss = missingMaterials(a, f, today)
    out.push({ k: "mat", ok: !miss.length, detail: miss.length ? { kind: "materials", names: miss.slice(0, 2), count: miss.length } : undefined })
  }
  if (f.on.eqp) {
    const rq = (f.plant ?? []).filter((r) => r.activityId === a.id && r.status === "go")
    const miss = rq.filter((r) => !r.got)
    out.push({ k: "crew", ok: rq.length ? !miss.length : null, detail: miss.length ? { kind: "plant", what: miss[0].what, count: miss.length } : undefined })
  }
  if (f.on.hse && a.permit) out.push({ k: "pmt", ok: f.livePermits > 0, detail: f.livePermits > 0 ? undefined : { kind: "no_permit" } })
  return out
}

export interface LookRow {
  a: LookActivity
  pc: number
  cs: Constraint[]
  block: Constraint[]
  /** Days to its start (negative = running for that many days). */
  startsIn: number
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

/** Activities that start or run in the next `weeks` weeks and are not complete, soonest first. */
export function lookahead(f: LookFacts, today: string, weeks = LOOKAHEAD_WEEKS): LookRow[] {
  const end = addDays(today, weeks * 7)
  return f.activities
    .filter((a) => a.to >= today && a.from <= end && pcOf(a, f.items) < 99.5)
    .map((a) => {
      const cs = activityConstraints(a, f, today)
      return { a, pc: pcOf(a, f.items), cs, block: cs.filter((c) => c.ok === false), startsIn: dayDiff(today, a.from) }
    })
    .sort((x, y) => x.a.from.localeCompare(y.a.from) || x.a.seq - y.a.seq)
}

// ── The weekly plan ─────────────────────────────────────────────────────────

/** Why a committed task was not done — a closed list; "other" is stated. */
export const MISS_REASONS = ["mat", "dwg", "crew", "prev", "insp", "rework", "weather", "other"] as const
export type MissReason = (typeof MISS_REASONS)[number]

export interface WeekTask {
  activityId: string
  name: string
  qty: number
  unit?: string | null
  /** It was constraint-free when committed — recorded, not a gate. */
  ready: boolean
  /** The constraints open at commitment. */
  open?: ConstraintKey[]
  done?: boolean | null
  why?: MissReason | null
  whyText?: string | null
}

export interface PmWeek {
  id: string
  /** The week's first day (Sunday), `YYYY-MM-DD`. */
  week: string
  status: "open" | "done"
  tasks: WeekTask[]
  by: string
  byName?: string | null
  closedOn?: string | null
  closedBy?: string | null
  closedByName?: string | null
}

/** The Saudi work week starts on Sunday: the Sunday on or before `day`. */
export function weekStart(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  return addDays(day, -d.getUTCDay())
}

/** The plan of this week, else the latest one still within the last seven days. */
export function currentWeek<T extends Pick<PmWeek, "week">>(weeks: T[], today: string): T | null {
  const from = addDays(today, -6)
  return weeks.filter((w) => w.week >= weekStart(from)).sort((a, b) => b.week.localeCompare(a.week))[0] ?? null
}

/** The plan the screen holds. A plan left open past its week is still owed its
 * close — until then its tasks reach neither PPC nor the reasons (WWP-04/05) —
 * so the oldest open plan of an earlier week comes first, before this week is
 * planned; with none, `currentWeek`. */
export function weekInHand<T extends Pick<PmWeek, "week" | "status">>(weeks: T[], today: string): T | null {
  const start = weekStart(today)
  const late = weeks.filter((w) => w.status === "open" && w.week < start).sort((a, b) => a.week.localeCompare(b.week))[0]
  return late ?? currentWeek(weeks, today)
}

export const ppc = (w: Pick<PmWeek, "tasks">) => (w.tasks.length ? Math.round((w.tasks.filter((t) => t.done).length / w.tasks.length) * 100) : 0)

/** Average PPC over the closed weeks; null when none is closed. */
export function ppcAverage(weeks: Array<Pick<PmWeek, "status" | "tasks">>): number | null {
  const closed = weeks.filter((w) => w.status === "done")
  return closed.length ? Math.round(closed.reduce((a, w) => a + ppc(w), 0) / closed.length) : null
}

/** The reasons for non-completion, most frequent first — the Pareto that shows the repeated defect. */
export function missReasonsTop(weeks: Array<Pick<PmWeek, "tasks">>): Array<{ k: MissReason; n: number }> {
  const c = new Map<MissReason, number>()
  for (const w of weeks) for (const t of w.tasks) if (!t.done && t.why) c.set(t.why, (c.get(t.why) ?? 0) + 1)
  return [...c.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n)
}

export const ppcTone = (pc: number): "ok" | "warn" | "bad" => (pc >= 80 ? "ok" : pc >= 60 ? "warn" : "bad")

export type CommitBlock = "archived" | "no_tasks" | "bad_qty" | "exists"

export function commitBlocks(input: { archived: boolean; tasks: Array<Pick<WeekTask, "qty">>; exists: boolean }): CommitBlock[] {
  const out: CommitBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.tasks.length) out.push("no_tasks")
  if (input.tasks.some((t) => !Number.isFinite(t.qty) || t.qty < 0)) out.push("bad_qty")
  if (input.exists) out.push("exists")
  return out
}

export type CloseBlock = "archived" | "not_open" | "no_reason"

/** Every task not done names its reason; "other" is stated — the week does not close otherwise. */
export function closeWeekBlocks(input: { archived: boolean; status: string; results: Array<{ done: boolean; why?: MissReason | null; whyText?: string | null }> }): CloseBlock[] {
  const out: CloseBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== "open") out.push("not_open")
  if (input.results.some((r) => !r.done && (!r.why || (r.why === "other" && !r.whyText?.trim())))) out.push("no_reason")
  return out
}

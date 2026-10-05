// HR 1.0 — performance and raises (PRD PF-01…07, form 27; optional feature `perf`). A review cycle opens with two
// dates; everyone with six months' service at work is in it, rated by his line manager (the chain of RL-04,
// named on each review when the cycle opens). A worker gets ONE grade (dependable · steady · weak) — there is no
// "all excellent"; staff are rated on four criteria, and may send a self-assessment their manager reads (not part
// of the score). The record is read, not rated: absences in the last two months and applied penalties in 180
// days make a record score that weighs `recordWeight` (20%) of the result. A sent review waits for the HR
// manager, who calibrates per rater (flags a rater whose grades are mostly outstanding, or one grade for almost
// all) and approves or returns each rater's set at once; band D on approval opens a 60-day improvement plan. The
// employee sees his review only once approved and acknowledges it. Raises by band (a company policy) go to
// management as ONE proposal; once decided, they are applied as steps on the pay from the first of next month.
// No amount ever sits on a review (raters and the employee read it) — the money is on the pay. Pure: no I/O.

import type { HrContext } from "./access"
import type { EmployeePay, HrEmployee } from "./employee"
import { gosiRates, payOn, wageOf } from "./pay"
import { addDays, daysBetween, DEFAULT_HR_POLICIES, serviceYears, type HrPolicies } from "./statutory"
import type { HrViolation } from "./violations"

/** `hrReviews/{id}` — cycles (`kind: cycle`), reviews (`kind: review`) and self-assessments (`kind: self`). */
export const HR_REVIEWS = "hrReviews"

export const cycleId = (orgId: string, open: string) => `${orgId}__cycle__${open}`
export const reviewId = (cycle: string, employeeId: string) => `${cycle}__${employeeId}`
export const selfId = (review: string) => `${review}__self`

/** PF-03 — the four criteria for staff, 1–5 each. */
export const CRITERIA = ["g", "q", "i", "t"] as const
export type Criterion = (typeof CRITERIA)[number]

/** PF-02 — one grade per worker: 3 dependable · 2 steady · 1 weak, and what each is worth on the 5-point scale. */
export const WORKER_GRADES = [3, 2, 1] as const
export type WorkerGrade = (typeof WORKER_GRADES)[number]
export const GRADE_VALUE: Record<WorkerGrade, number> = { 3: 4.7, 2: 3.6, 1: 2 }

export const BANDS = ["A", "B", "C", "D"] as const
export type Band = (typeof BANDS)[number]
const BAND_MIN: Record<Band, number> = { A: 4.3, B: 3.5, C: 2.5, D: 0 }
export const bandOf = (score: number): Band => BANDS.find((b) => score >= BAND_MIN[b]) ?? "D"

/** PF-01 — six months' service. */
export const ELIGIBLE_DAYS = 180
/** PF-07 — an improvement plan for band D: 60 days. */
export const PIP_DAYS = 60

export type ReviewState = "draft" | "done" | "ok" | "ack"

export interface RaiseProposal {
  /** mg: with management · ok: approved. Returned = the proposal is cleared. */
  state: "mg" | "ok"
  /** The first of next month at the time of the proposal — when the raises apply. */
  eff: string
  /** The percentages by band, frozen with the proposal. */
  pct: Record<Band, number>
  /** How many approved reviews it raises. */
  n: number
  by: string
  byName: string | null
  at: string
  okBy?: string | null
  okByName?: string | null
  okAt?: string | null
}

export interface ReviewCycle {
  id: string
  organizationId: string
  kind: "cycle"
  open: string
  close: string
  /** The year in the name («التقييم السنوي 2026»). */
  year: string
  raise: RaiseProposal | null
  by: string
  byName: string | null
  at: string
}

export interface ReviewScores {
  /** A worker's one grade. */
  o?: WorkerGrade
  g?: number
  q?: number
  i?: number
  t?: number
}

/** What the record says (PF-04) — read, not rated. */
export interface RecordFacts {
  abs: number
  pen: number
  ot: number
  injury: boolean
}

export interface HrReview {
  id: string
  organizationId: string
  kind: "review"
  cycleId: string
  employeeId: string
  employeeUserId: string | null
  employeeName: string
  employeeNo: number
  trade: string
  category: "labour" | "staff"
  siteId: string | null
  /** The line manager when the cycle opened: null = management rates. */
  raterEmployeeId: string | null
  raterUserId: string | null
  raterName: string | null
  /** The person is an HR manager: management rates him, approves his review and applies his raise (RL-02). */
  hrm?: boolean
  st: ReviewState
  /** Absent until the rater grades (the rules let the HR manager create a review only without one). */
  sc?: ReviewScores | null
  /** TR-06 — a skills course the manager names (feeds training needs). */
  need?: string | null
  /** To the employee. */
  note?: string | null
  /** Who graded or sent it, and when. */
  rated?: { by: string; byName: string | null; at: string } | null
  /** The record as the cycle opened — refreshed and frozen at approval with the score and band. */
  rec?: RecordFacts | null
  score?: number | null
  band?: Band | null
  okBy?: string | null
  okByName?: string | null
  okAt?: string | null
  ackAt?: string | null
  /** The raise applied from this review (the day it applies from) — no amount here (RL-03). */
  raised?: { on: string; at: string } | null
}

export interface SelfReview {
  id: string
  organizationId: string
  kind: "self"
  /** Always "self" — the rules read a person's own documents by `st`, and never let a review be updated through it. */
  st: "self"
  review: string
  employeeId: string
  employeeUserId: string
  sc: Required<Pick<ReviewScores, Criterion>>
  note: string | null
  at: string
}

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

export const cycleOpen = (c: Pick<ReviewCycle, "open" | "close"> | null | undefined, today: string) => Boolean(c && c.open <= today && today <= c.close)

/** The cycle shown: the latest opened. */
export const currentCycle = <C extends Pick<ReviewCycle, "open">>(cycles: readonly C[]): C | null => [...cycles].sort((a, b) => b.open.localeCompare(a.open))[0] ?? null

export type CycleBlock = "no_open" | "no_close" | "close_before_open" | "running"

/** Form 27 — two dates, close after open; one cycle at a time. */
export function cycleBlocks(input: { open: string | null; close: string | null }, current: Pick<ReviewCycle, "close"> | null): CycleBlock[] {
  const out: CycleBlock[] = []
  if (!input.open) out.push("no_open")
  if (!input.close) out.push("no_close")
  if (input.open && input.close && input.close <= input.open) out.push("close_before_open")
  if (current && input.open && current.close >= input.open) out.push("running")
  return out
}

/** PF-01 — at work (or on leave) with six months' service; never a recruit not yet arrived, never someone leaving. */
export function reviewEligible(e: Pick<HrEmployee, "status" | "join">, today: string): boolean {
  if (e.status !== "active" && e.status !== "leave") return false
  return daysBetween(e.join, today) >= ELIGIBLE_DAYS
}

// ---------------------------------------------------------------------------
// The record and the score (PF-04)
// ---------------------------------------------------------------------------

type AttMonths = { m?: Record<string, { absent?: number; ot?: number } | undefined> } | null | undefined

/** Absences and overtime over the last two months (this and the previous), penalties applied with an amount in
 * 180 days (never cancelled), a recorded injury. */
export function recordFacts(
  e: Pick<HrEmployee, "id"> & { att?: AttMonths },
  w: { violations: ReadonlyArray<Pick<HrViolation, "employeeId" | "state" | "on" | "amount">>; injuries: ReadonlyArray<{ employeeId: string }>; today: string }
): RecordFacts {
  const cur = w.today.slice(0, 7)
  const prev = addDays(`${cur}-01`, -1).slice(0, 7)
  const m = e.att?.m ?? {}
  const abs = (m[prev]?.absent ?? 0) + (m[cur]?.absent ?? 0)
  const ot = (m[prev]?.ot ?? 0) + (m[cur]?.ot ?? 0)
  const from = addDays(w.today, -180)
  const pen = w.violations.filter((v) => v.employeeId === e.id && (v.state === "applied" || v.state === "upheld") && v.on > from && (v.amount ?? 0) > 0).length
  return { abs, pen, ot, injury: w.injuries.some((x) => x.employeeId === e.id) }
}

/** The record's score out of 5: five less each absence and each penalty, never below 1. */
export const recordScore = (f: Pick<RecordFacts, "abs" | "pen">) => Math.max(1, 5 - f.abs - f.pen)

/** The manager's part: a worker's grade value, or the average of the four criteria. */
export function managerScore(category: "labour" | "staff", sc: ReviewScores | null | undefined): number | null {
  if (!sc) return null
  if (category === "labour") return sc.o ? GRADE_VALUE[sc.o] : null
  if (CRITERIA.some((k) => !(typeof sc[k] === "number" && (sc[k] as number) >= 1 && (sc[k] as number) <= 5))) return null
  return CRITERIA.reduce((a, k) => a + (sc[k] as number), 0) / CRITERIA.length
}

/** PF-04 — score = manager × (1 − w) + record × w, one decimal. */
export function reviewScore(category: "labour" | "staff", sc: ReviewScores | null | undefined, rec: Pick<RecordFacts, "abs" | "pen"> | null | undefined, weight = DEFAULT_HR_POLICIES.recordWeight): number | null {
  const base = managerScore(category, sc)
  if (base == null) return null
  const att = recordScore(rec ?? { abs: 0, pen: 0 })
  return Math.round((base * (1 - weight) + att * weight) * 10) / 10
}

/** A review's score and band: frozen at approval, else live. */
export function scoreOf(r: Pick<HrReview, "category" | "sc" | "rec" | "score" | "band" | "st">, weight: number): { score: number; band: Band } | null {
  if ((r.st === "ok" || r.st === "ack") && typeof r.score === "number" && r.band) return { score: r.score, band: r.band }
  const s = reviewScore(r.category, r.sc, r.rec, weight)
  return s == null ? null : { score: s, band: bandOf(s) }
}

export const isSent = (r: Pick<HrReview, "st">) => r.st === "done" || r.st === "ok" || r.st === "ack"
export const isApproved = (r: Pick<HrReview, "st">) => r.st === "ok" || r.st === "ack"

export type ReviewBlock = "closed" | "not_draft" | "incomplete"

/** A review can be sent while the cycle is open, from a draft, complete. */
export function sendBlocks(r: Pick<HrReview, "st" | "category" | "sc">, cycle: Pick<ReviewCycle, "open" | "close"> | null, today: string): ReviewBlock[] {
  const out: ReviewBlock[] = []
  if (!cycleOpen(cycle, today)) out.push("closed")
  if (r.st !== "draft") out.push("not_draft")
  if (managerScore(r.category, r.sc) == null) out.push("incomplete")
  return out
}

export function staffScoresComplete(sc: Partial<Record<Criterion, number | null>>): boolean {
  return CRITERIA.every((k) => typeof sc[k] === "number" && (sc[k] as number) >= 1 && (sc[k] as number) <= 5)
}

// ---------------------------------------------------------------------------
// Calibration (PF-05): per rater
// ---------------------------------------------------------------------------

export const MANAGEMENT_RATER = "__management__"
export const raterKey = (r: Pick<HrReview, "raterEmployeeId">) => r.raterEmployeeId ?? MANAGEMENT_RATER

export interface RaterRow {
  key: string
  name: string | null
  userId: string | null
  all: HrReview[]
  done: HrReview[]
  ok: HrReview[]
  /** Sent, awaiting approval. */
  pend: number
  avg: number
  /** % outstanding (A) of the sent. */
  pA: number
  /** Mostly outstanding: at least five sent and over 60% A. */
  flag: boolean
  /** One grade for almost all: at least ten sent and one grade ≥ 90%. */
  flat: boolean
}

export function raters(reviews: readonly HrReview[], weight: number): RaterRow[] {
  const by = new Map<string, RaterRow>()
  for (const r of reviews) {
    const k = raterKey(r)
    const row = by.get(k) ?? { key: k, name: r.raterName, userId: r.raterUserId, all: [], done: [], ok: [], pend: 0, avg: 0, pA: 0, flag: false, flat: false }
    row.all.push(r)
    if (isSent(r)) row.done.push(r)
    if (isApproved(r)) row.ok.push(r)
    by.set(k, row)
  }
  return [...by.values()]
    .map((row) => {
      const S = row.done.map((r) => scoreOf(r, weight)).filter((x): x is { score: number; band: Band } => x != null)
      const A = S.filter((s) => s.band === "A").length
      row.avg = S.length ? S.reduce((a, s) => a + s.score, 0) / S.length : 0
      row.pA = S.length ? Math.round((A / S.length) * 100) : 0
      row.flag = S.length >= 5 && row.pA > 60
      const cnt = new Map<string, number>()
      row.done.forEach((r, i) => {
        const g = r.category === "labour" ? `o${r.sc?.o ?? ""}` : `b${S[i]?.band ?? ""}`
        cnt.set(g, (cnt.get(g) ?? 0) + 1)
      })
      row.flat = S.length >= 10 && Math.max(0, ...cnt.values()) / S.length >= 0.9
      row.pend = row.done.filter((r) => r.st === "done").length
      return row
    })
    .sort((a, b) => b.pend - a.pend || b.all.length - a.all.length)
}

/** The distribution of sent reviews by band. */
export function distribution(reviews: readonly HrReview[], weight: number): Record<Band, number> {
  const out: Record<Band, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const r of reviews) {
    if (!isSent(r)) continue
    const s = scoreOf(r, weight)
    if (s) out[s.band]++
  }
  return out
}

// ---------------------------------------------------------------------------
// Raises (PF-06)
// ---------------------------------------------------------------------------

export const policyPct = (p: Pick<HrPolicies, "raiseA" | "raiseB" | "raiseC" | "raiseD">): Record<Band, number> => ({ A: p.raiseA, B: p.raiseB, C: p.raiseC, D: p.raiseD })

/** The new basic: the old raised by the percentage, to the nearest ten riyals. */
export const raisedBasic = (basic: number, pct: number) => Math.round((basic * (1 + pct / 100)) / 10) * 10

/** The first of the month after `day` — when an approved raise applies. */
export const firstOfNextMonth = (day: string) => `${addDays(`${day.slice(0, 7)}-28`, 4).slice(0, 7)}-01`

/** What a monthly raise costs the company: the raise, its employer GOSI, and the end-of-service accrual on it. */
export function raiseLoad(amount: number, e: Pick<HrEmployee, "nationality" | "join">, today: string): number {
  const gosi = gosiRates(e.nationality, e.join).employer
  return Math.round(amount * (1 + gosi) + amount * (serviceYears(e.join, today) < 5 ? 1 / 24 : 1 / 12))
}

export interface RaisePlan {
  byBand: Record<Band, string[]>
  cost: Record<Band, number>
  /** Monthly wage impact. */
  total: number
  /** Company cost with GOSI and the EOS accrual. */
  loaded: number
  /** Raises applied (pct > 0). */
  n: number
  /** Sent reviews still awaiting approval, and what they would add at the same percentages. */
  rest: number
  restCost: number
}

/** PF-06 — over APPROVED reviews by band: the wage raise is the wage × the band's percentage. */
export function raisePlan(
  reviews: readonly HrReview[],
  w: { pct: Record<Band, number>; weight: number; pays: ReadonlyMap<string, Pick<EmployeePay, "basic" | "housing" | "transport">>; people: ReadonlyMap<string, Pick<HrEmployee, "nationality" | "join">>; today: string }
): RaisePlan {
  const byBand: Record<Band, string[]> = { A: [], B: [], C: [], D: [] }
  const cost: Record<Band, number> = { A: 0, B: 0, C: 0, D: 0 }
  let loaded = 0
  let rest = 0
  let restCost = 0
  for (const r of reviews) {
    const s = scoreOf(r, w.weight)
    if (!s) continue
    const pay = w.pays.get(r.employeeId)
    const amt = pay ? Math.round((wageOf(pay) * w.pct[s.band]) / 100) : 0
    const person = w.people.get(r.employeeId)
    if (isApproved(r)) {
      byBand[s.band].push(r.employeeId)
      cost[s.band] += amt
      if (person) loaded += raiseLoad(amt, person, w.today)
    } else if (r.st === "done") {
      rest++
      if (person) restCost += raiseLoad(amt, person, w.today)
    }
  }
  const total = BANDS.reduce((a, b) => a + cost[b], 0)
  const n = BANDS.reduce((a, b) => a + (w.pct[b] > 0 ? byBand[b].length : 0), 0)
  return { byBand, cost, total, loaded, n, rest, restCost }
}

export type RaiseBlock = "nothing" | "proposed" | "no_approved"

export function proposeBlocks(cycle: Pick<ReviewCycle, "raise"> | null, plan: Pick<RaisePlan, "total" | "byBand">): RaiseBlock[] {
  const out: RaiseBlock[] = []
  if (!cycle || cycle.raise) out.push("proposed")
  if (!BANDS.some((b) => plan.byBand[b].length)) out.push("no_approved")
  else if (!(plan.total > 0)) out.push("nothing")
  return out
}

/** The raise one approved review gets under a decided proposal: none in a 0% band, none twice. */
export function raiseFor(r: Pick<HrReview, "st" | "raised" | "category" | "sc" | "rec" | "score" | "band">, proposal: Pick<RaiseProposal, "state" | "pct">, weight: number): { band: Band; pct: number } | null {
  if (proposal.state !== "ok" || !isApproved(r) || r.raised) return null
  const s = scoreOf(r, weight)
  if (!s) return null
  const pct = proposal.pct[s.band]
  return pct > 0 ? { band: s.band, pct } : null
}

/** The basic in force on the day the raise applies (a pay change already scheduled is respected). */
export const basicOn = (pay: EmployeePay, day: string) => payOn(pay, day).basic

/** The approved raise on a person's pay: the step a review raise wrote (kind raise, from the cycle's day). */
export function approvedRaise(pay: Pick<EmployeePay, "steps"> | null | undefined, eff: string | null | undefined): { from: number | null; to: number; on: string } | null {
  if (!pay?.steps?.length || !eff) return null
  const steps = [...pay.steps].sort((a, b) => a.from.localeCompare(b.from))
  const i = steps.findIndex((s) => s.from === eff && s.kind === "raise")
  if (i < 0) return null
  return { from: i > 0 ? steps[i - 1].basic : null, to: steps[i].basic, on: eff }
}

// ---------------------------------------------------------------------------
// Whose hand (RL-02): the rater named, the HR manager — never one's own
// ---------------------------------------------------------------------------

/** Who grades a review: the rater it names; with none, management (or the HR manager); never the person himself. */
export function mayRate(ctx: Pick<HrContext, "uid" | "owner" | "roles" | "employeeId">, r: Pick<HrReview, "raterUserId" | "employeeUserId" | "employeeId">): boolean {
  if (!ctx.owner && (r.employeeUserId === ctx.uid || r.employeeId === ctx.employeeId)) return false
  if (r.raterUserId) return r.raterUserId === ctx.uid
  return ctx.owner || ctx.roles.has("management") || ctx.roles.has("manager")
}

/** The HR manager's hand — never on his own review (management's). */
export const notOwn = (ctx: HrContext, r: Pick<HrReview, "employeeUserId" | "employeeId">) => ctx.owner || (r.employeeUserId !== ctx.uid && r.employeeId !== ctx.employeeId)

/** Who approves a sent review: the HR manager (not his own); management approves the ones it rates (no rater). */
export function mayApprove(ctx: HrContext, r: Pick<HrReview, "raterUserId" | "employeeUserId" | "employeeId">): boolean {
  if (!notOwn(ctx, r)) return false
  if (ctx.roles.has("manager") || ctx.owner) return true
  return ctx.roles.has("management") && !r.raterUserId
}

/** Whose raise this hand applies: the HR manager every one but an HR manager's (his own included); management
 * only an HR manager's (RL-02). The owner, who answers to nobody, any. */
export function mayApplyRaise(ctx: HrContext, r: Pick<HrReview, "employeeUserId" | "employeeId" | "hrm">): boolean {
  if (ctx.owner) return true
  if (ctx.roles.has("manager") && !r.hrm && notOwn(ctx, r)) return true
  return ctx.roles.has("management") && Boolean(r.hrm) && notOwn(ctx, r)
}


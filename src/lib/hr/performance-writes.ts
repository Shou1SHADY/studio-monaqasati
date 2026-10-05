// HR 1.0 — performance writes (PRD WF-21/22, PF-01…07, form 27; optional feature `perf`). The HR manager opens a
// cycle: one review per eligible person, its rater named from the line-manager chain (RL-04) as of that day — the
// rules let the named rater, and nobody else, grade it while it is a draft. A rater sends; the HR manager
// approves or returns each rater's set at once (never his own review — management rates and approves that one);
// band D opens a 60-day improvement plan on the record. Raises: the HR manager proposes ONE plan, management
// decides it, and the raises are applied as pay steps from the first of next month — by the HR manager for
// everyone but HR managers, whose raise management applies with its decision (RL-02). No amount is ever written
// on a review or in a log (RL-03). Batches stay small: the rules look each record up.

import { collection, doc, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_EMPLOYEES, HR_PAY } from "./collections"
import { lineManagerChain, type EmployeePay, type HrEmployee } from "./employee"
import { HR_LOG, payWithStep, type HrActor, type LogEntry } from "./employee-writes"
import { todayDay } from "./format"
import { emitHrNotice, emitHrNotices, hrLinks, type HrNotice } from "./notify"
import { payFromBasic } from "./pay"
import {
  bandOf,
  basicOn,
  cycleBlocks,
  cycleId,
  cycleOpen,
  firstOfNextMonth,
  HR_REVIEWS,
  mayApprove,
  mayApplyRaise,
  mayRate,
  notOwn,
  PIP_DAYS,
  proposeBlocks,
  raisedBasic,
  raiseFor,
  recordScore,
  reviewEligible,
  reviewId,
  reviewScore,
  selfId,
  sendBlocks,
  staffScoresComplete,
  type Band,
  type Criterion,
  type HrReview,
  type RaisePlan,
  type RecordFacts,
  type ReviewCycle,
  type SelfReview,
  type WorkerGrade,
} from "./performance"
import type { HrSite } from "./sites"
import { addDays, DEFAULT_HR_POLICIES, type HrPolicies } from "./statutory"
import { NEED_COURSES } from "./training"
import { assertHr, HrWriteError } from "./write-guard"

/** Reviews per batch: each approval may touch the record and its log, which the rules look up. */
export const REVIEW_BATCH = 8
/** Pay changes per transaction (the pay document, the review, the log — each looked up). */
export const RAISE_BATCH = 6

const stamp = (actor: HrActor) => ({ by: actor.uid, byName: actor.name, at: new Date().toISOString() })
const logEntry = (orgId: string, actor: HrActor, kind: string, params: LogEntry["params"]): LogEntry & { organizationId: string } => ({ organizationId: orgId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params: params ?? {}, source: "hr" })
const chunks = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

// ---------------------------------------------------------------------------
// Opening the cycle (form 27)
// ---------------------------------------------------------------------------

/** The review a person starts with: an empty draft naming his rater from the chain — or management. */
export function reviewFor(
  e: HrEmployee,
  w: { orgId: string; cycle: string; employees: readonly HrEmployee[]; sites: readonly Pick<HrSite, "id" | "supervisorEmployeeId" | "supervisorUserId">[]; rec: RecordFacts; hrManagerEmployeeIds?: readonly string[] }
): Omit<HrReview, "id"> {
  const chain = lineManagerChain(e, { employees: w.employees, supervisorOf: (sid) => w.sites.find((s) => s.id === sid)?.supervisorEmployeeId ?? null, isHrManager: (w.hrManagerEmployeeIds ?? []).includes(e.id) })
  const rater = chain.id ? (w.employees.find((x) => x.id === chain.id) ?? null) : null
  const site = w.sites.find((s) => s.id === e.siteId)
  const raterUserId = rater ? (rater.userId ?? (chain.via === "supervisor" ? (site?.supervisorUserId ?? null) : null)) : null
  return {
    organizationId: w.orgId,
    kind: "review",
    cycleId: w.cycle,
    employeeId: e.id,
    employeeUserId: e.userId ?? null,
    employeeName: e.names?.ar ?? "",
    employeeNo: e.no,
    trade: e.trade,
    category: e.category,
    siteId: e.siteId ?? null,
    raterEmployeeId: rater?.id ?? null,
    raterUserId,
    raterName: rater?.names?.ar ?? null,
    hrm: (w.hrManagerEmployeeIds ?? []).includes(e.id),
    st: "draft",
    rec: w.rec,
  }
}

export async function openCycle(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  input: { open: string; close: string },
  w: { employees: readonly HrEmployee[]; sites: readonly Pick<HrSite, "id" | "supervisorEmployeeId" | "supervisorUserId">[]; current: Pick<ReviewCycle, "close"> | null; recOf: (e: HrEmployee) => RecordFacts; hrManagerEmployeeIds?: readonly string[] }
): Promise<{ id: string; count: number }> {
  assertHr(ctx, "perf.cycle")
  const blocks = cycleBlocks(input, w.current)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const id = cycleId(orgId, input.open)
  const cycle: Omit<ReviewCycle, "id"> = { organizationId: orgId, kind: "cycle", open: input.open, close: input.close, year: input.open.slice(0, 4), raise: null, ...stamp(actor) }
  const reviews = w.employees.filter((e) => reviewEligible(e, input.open)).map((e) => reviewFor(e, { orgId, cycle: id, employees: w.employees, sites: w.sites, rec: w.recOf(e), hrManagerEmployeeIds: w.hrManagerEmployeeIds }))
  const first = writeBatch(firestore)
  first.set(doc(firestore, HR_REVIEWS, id), { ...cycle, updatedAt: serverTimestamp() })
  await first.commit()
  for (const part of chunks(reviews, 400)) {
    const batch = writeBatch(firestore)
    for (const r of part) batch.set(doc(firestore, HR_REVIEWS, reviewId(id, r.employeeId)), { ...r, updatedAt: serverTimestamp() })
    await batch.commit()
  }
  // Each rater learns how many of his team to rate.
  const byRater = new Map<string, number>()
  for (const r of reviews) if (r.raterUserId) byRater.set(r.raterUserId, (byRater.get(r.raterUserId) ?? 0) + 1)
  await emitHrNotices(
    firestore,
    actor,
    [...byRater].map(([uid, count]): HrNotice => ({ kind: "hr_cycle_opened", organizationId: orgId, to: [{ users: [uid] }], params: { count, close: input.close }, link: hrLinks.perf(), once: `${input.open}_${uid}` }))
  )
  return { id, count: reviews.length }
}

/** People who reached six months during the cycle join it (the HR manager's «حدّث القائمة»). */
export async function addToCycle(
  firestore: Firestore,
  ctx: HrContext,
  actor: HrActor,
  cycle: Pick<ReviewCycle, "id" | "organizationId" | "open" | "close">,
  w: { employees: readonly HrEmployee[]; sites: readonly Pick<HrSite, "id" | "supervisorEmployeeId" | "supervisorUserId">[]; existing: ReadonlySet<string>; recOf: (e: HrEmployee) => RecordFacts; hrManagerEmployeeIds?: readonly string[]; today?: string }
): Promise<number> {
  assertHr(ctx, "perf.cycle")
  const today = w.today ?? todayDay()
  if (!cycleOpen(cycle, today)) throw new HrWriteError("blocked", ["closed"])
  const add = w.employees.filter((e) => !w.existing.has(e.id) && reviewEligible(e, today))
  for (const part of chunks(add, 400)) {
    const batch = writeBatch(firestore)
    for (const e of part) batch.set(doc(firestore, HR_REVIEWS, reviewId(cycle.id, e.id)), { ...reviewFor(e, { orgId: cycle.organizationId, cycle: cycle.id, employees: w.employees, sites: w.sites, rec: w.recOf(e), hrManagerEmployeeIds: w.hrManagerEmployeeIds }), updatedAt: serverTimestamp() })
    await batch.commit()
  }
  return add.length
}

// ---------------------------------------------------------------------------
// Rating (PF-02/03): the rater named on the review — management when none
// ---------------------------------------------------------------------------

function rateGuard(ctx: HrContext, r: HrReview, cycle: Pick<ReviewCycle, "open" | "close"> | null, today: string) {
  if (!mayRate(ctx, r)) throw new HrWriteError("no_role")
  if (!cycleOpen(cycle, today)) throw new HrWriteError("blocked", ["closed"])
  if (r.st !== "draft") throw new HrWriteError("blocked", ["not_draft"])
}

/** A worker's one grade as a draft — the same grade again clears it (`null`). */
export async function gradeWorker(firestore: Firestore, ctx: HrContext, actor: HrActor, r: HrReview, grade: WorkerGrade | null, opts: { cycle: Pick<ReviewCycle, "open" | "close"> | null; today?: string }): Promise<void> {
  rateGuard(ctx, r, opts.cycle, opts.today ?? todayDay())
  if (r.category !== "labour") throw new HrWriteError("blocked", ["incomplete"])
  await updateDoc(doc(firestore, HR_REVIEWS, r.id), { sc: grade ? { o: grade } : null, rated: stamp(actor), updatedAt: serverTimestamp() })
}

/** «أرسل N للاعتماد» — the rater's graded drafts go to the HR manager. */
export async function sendDrafts(firestore: Firestore, ctx: HrContext, actor: HrActor, drafts: readonly HrReview[], opts: { cycle: Pick<ReviewCycle, "open" | "close"> | null; today?: string }): Promise<number> {
  const today = opts.today ?? todayDay()
  const ready = drafts.filter((r) => mayRate(ctx, r) && !sendBlocks(r, opts.cycle, today).length)
  if (!ready.length) throw new HrWriteError("blocked", ["incomplete"])
  for (const part of chunks(ready, 400)) {
    const batch = writeBatch(firestore)
    for (const r of part) batch.update(doc(firestore, HR_REVIEWS, r.id), { st: "done", rated: stamp(actor), updatedAt: serverTimestamp() })
    await batch.commit()
  }
  await emitHrNotice(firestore, actor, { kind: "hr_reviews_sent", organizationId: ready[0].organizationId, to: [{ hr: "manager" }], except: ready.map((r) => r.employeeUserId), params: { count: ready.length }, link: hrLinks.perf() })
  return ready.length
}

/** Form 27 — a staff member's review: four criteria (all required), an optional training need and note. */
export async function submitStaffReview(
  firestore: Firestore,
  ctx: HrContext,
  actor: HrActor,
  r: HrReview,
  input: Record<Criterion, number> & { need?: string | null; note?: string | null },
  opts: { cycle: Pick<ReviewCycle, "open" | "close"> | null; today?: string }
): Promise<void> {
  rateGuard(ctx, r, opts.cycle, opts.today ?? todayDay())
  if (r.category !== "staff" || !staffScoresComplete(input)) throw new HrWriteError("blocked", ["incomplete"])
  const need = input.need && NEED_COURSES.some((c) => c.id === input.need) ? input.need : null
  await updateDoc(doc(firestore, HR_REVIEWS, r.id), { sc: { g: input.g, q: input.q, i: input.i, t: input.t }, need, note: input.note?.trim() || null, st: "done", rated: stamp(actor), updatedAt: serverTimestamp() })
  await emitHrNotice(firestore, actor, { kind: "hr_reviews_sent", organizationId: r.organizationId, to: [{ hr: "manager" }], except: [r.employeeUserId], params: { count: 1 }, link: hrLinks.perf() })
}

/** Form 27 — the employee's self-assessment (staff, while the cycle is open): his manager reads it; it is not
 * part of the score. Sent once. */
export async function submitSelfReview(
  firestore: Firestore,
  ctx: HrContext,
  actor: HrActor,
  emp: Pick<HrEmployee, "id" | "organizationId" | "category" | "userId">,
  cycle: Pick<ReviewCycle, "id" | "open" | "close"> | null,
  input: Record<Criterion, number> & { note?: string | null },
  opts: { today?: string } = {}
): Promise<void> {
  if (!ctx.employeeId || ctx.employeeId !== emp.id || emp.userId !== ctx.uid) throw new HrWriteError("no_role")
  if (!cycle || !cycleOpen(cycle, opts.today ?? todayDay())) throw new HrWriteError("blocked", ["closed"])
  if (emp.category !== "staff" || !staffScoresComplete(input)) throw new HrWriteError("blocked", ["incomplete"])
  const review = reviewId(cycle.id, emp.id)
  const self: Omit<SelfReview, "id"> = { organizationId: emp.organizationId, kind: "self", st: "self", review, employeeId: emp.id, employeeUserId: ctx.uid, sc: { g: input.g, q: input.q, i: input.i, t: input.t }, note: input.note?.trim() || null, at: new Date().toISOString() }
  await setDoc(doc(firestore, HR_REVIEWS, selfId(review)), self)
}

// ---------------------------------------------------------------------------
// Calibration (PF-05): approve or return a rater's set at once
// ---------------------------------------------------------------------------

export async function approveReviews(
  firestore: Firestore,
  ctx: HrContext,
  actor: HrActor,
  reviews: readonly HrReview[],
  opts: { year: string; recOf: (r: HrReview) => RecordFacts; policies?: HrPolicies; today?: string }
): Promise<number> {
  if (!ctx.roles.has("manager") && !ctx.roles.has("management") && !ctx.owner) throw new HrWriteError("no_role")
  const today = opts.today ?? todayDay()
  const weight = (opts.policies ?? DEFAULT_HR_POLICIES).recordWeight
  const sent = reviews.filter((r) => r.st === "done" && mayApprove(ctx, r))
  if (!sent.length) throw new HrWriteError("blocked", ["nothing"])
  const at = new Date().toISOString()
  for (const part of chunks(sent, REVIEW_BATCH)) {
    const batch = writeBatch(firestore)
    for (const r of part) {
      const rec = opts.recOf(r)
      const score = reviewScore(r.category, r.sc, rec, weight) ?? recordScore(rec)
      const band = bandOf(score)
      batch.update(doc(firestore, HR_REVIEWS, r.id), { st: "ok", rec, score, band, okBy: actor.uid, okByName: actor.name, okAt: at, updatedAt: serverTimestamp() })
      if (band === "D" && (ctx.owner || ctx.roles.has("manager"))) batch.update(doc(firestore, HR_EMPLOYEES, r.employeeId), { pip: { until: addDays(today, PIP_DAYS), by: actor.uid, byName: actor.name, cycleId: r.cycleId }, updatedAt: serverTimestamp() })
      batch.set(doc(collection(firestore, HR_EMPLOYEES, r.employeeId, HR_LOG)), logEntry(r.organizationId, actor, "review_approved", { year: opts.year, band, to: band === "D" ? addDays(today, PIP_DAYS) : null }))
    }
    await batch.commit()
  }
  await emitHrNotices(
    firestore,
    actor,
    sent.map((r): HrNotice | null => (r.employeeUserId ? { kind: "hr_review_ready", organizationId: r.organizationId, to: [{ users: [r.employeeUserId] }], params: { year: opts.year }, link: hrLinks.me(), once: r.id, employeeId: r.employeeId } : null))
  )
  return sent.length
}

/** «أعده للمراجعة» — a rater's sent set goes back to drafts; the rater is told. */
export async function returnReviews(firestore: Firestore, ctx: HrContext, actor: HrActor, reviews: readonly HrReview[], opts: { close: string }): Promise<number> {
  assertHr(ctx, "perf.approve")
  const sent = reviews.filter((r) => r.st === "done" && notOwn(ctx, r))
  if (!sent.length) throw new HrWriteError("blocked", ["nothing"])
  const batch = writeBatch(firestore)
  for (const r of sent) batch.update(doc(firestore, HR_REVIEWS, r.id), { st: "draft", updatedAt: serverTimestamp() })
  await batch.commit()
  const raters = [...new Set(sent.map((r) => r.raterUserId).filter((u): u is string => Boolean(u)))]
  await emitHrNotices(
    firestore,
    actor,
    raters.map((uid): HrNotice => ({ kind: "hr_reviews_returned", organizationId: sent[0].organizationId, to: [{ users: [uid] }], params: { count: sent.filter((r) => r.raterUserId === uid).length, close: opts.close }, link: hrLinks.perf() }))
  )
  return sent.length
}

/** PF-07 — «اطّلعت»: the employee acknowledges his approved review. */
export async function acknowledgeReview(firestore: Firestore, ctx: HrContext, r: Pick<HrReview, "id" | "st" | "employeeUserId">): Promise<void> {
  if (r.employeeUserId !== ctx.uid) throw new HrWriteError("no_role")
  if (r.st !== "ok") throw new HrWriteError("blocked", ["stale"])
  await updateDoc(doc(firestore, HR_REVIEWS, r.id), { st: "ack", ackAt: new Date().toISOString(), updatedAt: serverTimestamp() })
}

// ---------------------------------------------------------------------------
// Raises (PF-06): one proposal, one decision, applied as pay steps
// ---------------------------------------------------------------------------

export async function proposeRaises(firestore: Firestore, ctx: HrContext, actor: HrActor, cycle: ReviewCycle, plan: RaisePlan, pct: Record<Band, number>, opts: { today?: string } = {}): Promise<void> {
  assertHr(ctx, "perf.raise")
  const blocks = proposeBlocks(cycle, plan)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  if (Object.values(pct).some((p) => !(p >= 0 && p <= 25))) throw new HrWriteError("blocked", ["bad_pct"])
  const eff = firstOfNextMonth(opts.today ?? todayDay())
  await updateDoc(doc(firestore, HR_REVIEWS, cycle.id), { raise: { state: "mg", eff, pct, n: plan.n, ...stamp(actor) }, updatedAt: serverTimestamp() })
  await emitHrNotice(firestore, actor, { kind: "hr_raises_proposed", organizationId: cycle.organizationId, to: [{ hr: "management" }], params: { count: plan.n, eff }, link: hrLinks.perf(), once: `${cycle.id.split("__").pop()}_${eff}` })
}

/** Management's one decision: approve (the raises then apply) or return (the proposal is cleared). */
export async function decideRaises(firestore: Firestore, ctx: HrContext, actor: HrActor, cycle: ReviewCycle, approve: boolean): Promise<void> {
  assertHr(ctx, "perf.raise.decide")
  if (cycle.raise?.state !== "mg") throw new HrWriteError("blocked", ["stale"])
  const raise = approve ? { ...cycle.raise, state: "ok", okBy: actor.uid, okByName: actor.name, okAt: new Date().toISOString() } : null
  await updateDoc(doc(firestore, HR_REVIEWS, cycle.id), { raise, updatedAt: serverTimestamp() })
  await emitHrNotice(firestore, actor, { kind: "hr_raises_decided", organizationId: cycle.organizationId, to: [{ hr: "manager" }], params: { verdict: approve ? "@hr_verdict.raises_ok" : "@hr_verdict.raises_back" }, link: hrLinks.perf() })
}

/** Apply a decided proposal: per approved review in a band above 0%, a pay step from the proposal's day (the basic
 * raised to the nearest ten, allowances following it), the review marked raised, the log naming it — never twice. */
export async function applyRaises(
  firestore: Firestore,
  ctx: HrContext,
  actor: HrActor,
  cycle: ReviewCycle,
  reviews: readonly HrReview[],
  opts: { policies?: HrPolicies; today?: string } = {}
): Promise<number> {
  if (!ctx.owner && !ctx.roles.has("manager") && !ctx.roles.has("management")) throw new HrWriteError("no_role")
  const raise = cycle.raise
  if (!raise || raise.state !== "ok") throw new HrWriteError("blocked", ["not_decided"])
  const policies = opts.policies ?? DEFAULT_HR_POLICIES
  const today = opts.today ?? todayDay()
  const due = reviews.filter((r) => raiseFor(r, raise, policies.recordWeight) && mayApplyRaise(ctx, r))
  let n = 0
  for (const part of chunks(due, RAISE_BATCH)) {
    await runTransaction(firestore, async (tx) => {
      const pays = await Promise.all(part.map((r) => tx.get(doc(firestore, HR_PAY, r.employeeId))))
      part.forEach((r, i) => {
        const snap = pays[i]
        const got = raiseFor(r, raise, policies.recordWeight)
        if (!snap.exists() || !got) return
        const pay = snap.data() as EmployeePay
        const basic = raisedBasic(basicOn(pay, raise.eff), got.pct)
        const reason = `زيادة التقييم ${cycle.year} — ${got.band} +${got.pct}%`
        const { steps, current } = payWithStep(pay, payFromBasic(basic, policies), raise.eff, today, { kind: "raise", reason, byName: actor.name })
        tx.set(doc(firestore, HR_PAY, r.employeeId), { ...current, steps, updatedAt: serverTimestamp() }, { merge: true })
        tx.update(doc(firestore, HR_REVIEWS, r.id), { raised: { on: raise.eff, at: new Date().toISOString() }, updatedAt: serverTimestamp() })
        tx.set(doc(collection(firestore, HR_EMPLOYEES, r.employeeId, HR_LOG)), logEntry(r.organizationId, actor, "pay_changed", { on: raise.eff, reason }))
        n++
      })
    })
  }
  return n
}

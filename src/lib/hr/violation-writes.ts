// HR 1.0 — violation writes (WF-09; PN-01…04, RL-02). One transaction each:
// the record at a fixed id (never twice), the HR manager's decision after a
// hearing with the step and amount computed from the wage read here, the
// employee's objection within 15 days, the decision on it. Nobody decides a
// penalty of his own; the employee's log names each step, never an amount.

import { collection, doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { hrAllowed, type HrContext } from "./access"
import { HR_EMPLOYEES, HR_PAY, HR_PAYROLLS, HR_VIOLATIONS } from "./collections"
import type { EmployeePay, HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import { payOn, wageOf } from "./pay"
import { deductedOn, payrollId, type Payroll } from "./payroll"
import type { PastViolation, ViolationCode } from "./penalties"
import { todayDay } from "./format"
import { applyQuote, mayObject, violationId, type HrViolation } from "./violations"
import { emitHrNotice, hrLinks, type HrNotice } from "./notify"
import { addDays, STATUTORY } from "./statutory"
import { assertHr, HrWriteError } from "./write-guard"

// The Riyadh day, as firestore.rules count it: the notice is dated today there (the objection's 15 days
// start from it, on the server too) — never the browser's own zone.
const localToday = () => todayDay()
const stamp = (a: HrActor) => ({ by: a.uid, byName: a.name, at: new Date().toISOString() })

function log(tx: Transaction, firestore: Firestore, v: Pick<HrViolation, "employeeId" | "organizationId">, actor: HrActor, kind: string, params: Record<string, string | number | null>) {
  tx.set(doc(collection(firestore, HR_EMPLOYEES, v.employeeId, HR_LOG)), { organizationId: v.organizationId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params, source: "hr" })
}

async function readV(tx: Transaction, firestore: Firestore, id: string): Promise<HrViolation> {
  const s = await tx.get(doc(firestore, HR_VIOLATIONS, id))
  if (!s.exists()) throw new HrWriteError("missing")
  return { id: s.id, ...(s.data() as Omit<HrViolation, "id">) }
}

/** The body of a new violation record — shared with the attendance sheet, which records them in its own transaction. */
export function violationRecord(orgId: string, emp: Pick<HrEmployee, "id" | "userId" | "names" | "siteId">, code: ViolationCode, on: string, actor: HrActor, source: HrViolation["source"], note?: string | null) {
  return {
    organizationId: orgId,
    employeeId: emp.id,
    employeeUserId: emp.userId ?? null,
    employeeName: emp.names?.ar ?? "",
    siteId: emp.siteId ?? null,
    code,
    on,
    note: note?.trim() || null,
    source,
    state: "recorded" as const,
    recorded: stamp(actor),
  }
}

/** A violation recorded (by hand or on the sheet) → the HR manager, who decides it after a hearing, and the
 * employee (his own file). Once per violation — its id is fixed. */
export function violationRecordedNotice(v: Pick<HrViolation, "id" | "organizationId" | "employeeId" | "employeeUserId" | "employeeName" | "on">): HrNotice {
  return {
    kind: "hr_violation_recorded",
    organizationId: v.organizationId,
    to: [{ hr: "manager" }, { users: [v.employeeUserId] }],
    params: { name: v.employeeName, on: v.on },
    link: hrLinks.person(v.employeeId),
    links: v.employeeUserId ? { [v.employeeUserId]: hrLinks.me() } : undefined,
    once: v.id,
    employeeId: v.employeeId,
  }
}

const toEmployee = (v: HrViolation, kind: HrNotice["kind"], params: HrNotice["params"]): HrNotice | null =>
  v.employeeUserId ? { kind, organizationId: v.organizationId, to: [{ users: [v.employeeUserId] }], params, link: hrLinks.me(), once: v.id, employeeId: v.employeeId } : null

/** Record a violation by hand — the supervisor on his own site, or the HR manager (WF-09 step 1). */
export async function recordViolation(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  input: { employeeId: string; code: ViolationCode; on: string; note?: string | null },
  opts: { today?: string } = {}
): Promise<string> {
  const today = opts.today ?? localToday()
  if (!input.on || input.on > today) throw new HrWriteError("blocked", ["future"])
  const id = violationId(orgId, input.employeeId, input.on, input.code)
  let recorded: Parameters<typeof violationRecordedNotice>[0] | null = null
  await runTransaction(firestore, async (tx) => {
    const es = await tx.get(doc(firestore, HR_EMPLOYEES, input.employeeId))
    if (!es.exists()) throw new HrWriteError("missing")
    const emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) }
    assertHr(ctx, "violation.record", { site: emp.siteId })
    if (!emp.siteId && !hrAllowed(ctx, "violation.record")) throw new HrWriteError("no_role")
    if ((await tx.get(doc(firestore, HR_VIOLATIONS, id))).exists()) throw new HrWriteError("blocked", ["exists"])
    tx.set(doc(firestore, HR_VIOLATIONS, id), { ...violationRecord(orgId, emp, input.code, input.on, actor, "manual", input.note), updatedAt: serverTimestamp() })
    log(tx, firestore, { employeeId: emp.id, organizationId: orgId }, actor, "violation_recorded", { code: input.code, on: input.on })
    recorded = { id, organizationId: orgId, employeeId: emp.id, employeeUserId: emp.userId ?? null, employeeName: emp.names?.ar ?? "", on: input.on }
  })
  const n = recorded as Parameters<typeof violationRecordedNotice>[0] | null
  if (n) await emitHrNotice(firestore, actor, violationRecordedNotice(n))
  return id
}

/** The HR manager decides after the hearing (PN-01, PN-02): apply at the ladder's step, or dismiss with a reason. */
export async function decidePenalty(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { verdict: "apply" | "dismiss"; hearingOn?: string | null; hearingNote?: string | null; note?: string | null },
  opts: { history: PastViolation[]; today?: string }
): Promise<void> {
  assertHr(ctx, "penalty.apply")
  const today = opts.today ?? localToday()
  let told: HrNotice | null = null
  await runTransaction(firestore, async (tx) => {
    const v = await readV(tx, firestore, id)
    if (ctx.employeeId === v.employeeId && !ctx.owner) throw new HrWriteError("own_request")
    if (v.state !== "recorded") throw new HrWriteError("blocked", ["decided"])
    const ref = doc(firestore, HR_VIOLATIONS, id)
    if (input.verdict === "dismiss") {
      if (!input.note?.trim()) throw new HrWriteError("blocked", ["no_reason"])
      tx.update(ref, { state: "dismissed", decision: { ...stamp(actor), note: input.note.trim() }, updatedAt: serverTimestamp() })
      log(tx, firestore, v, actor, "penalty_dismissed", { code: v.code, on: v.on })
      told = toEmployee(v, "hr_penalty_dismissed", { on: v.on })
      return
    }
    const ps = await tx.get(doc(firestore, HR_PAY, v.employeeId))
    const wage = ps.exists() ? wageOf(payOn(ps.data() as EmployeePay, today)) : 0
    const q = applyQuote(v, { hearingOn: input.hearingOn ?? null, today, wage, history: opts.history })
    if (q.blocks.length) throw new HrWriteError("blocked", q.blocks)
    tx.update(ref, {
      state: "applied",
      hearing: { on: input.hearingOn, note: input.hearingNote?.trim() || null },
      step: q.step,
      stepKind: q.stepKind,
      amount: q.amount,
      deductMonth: today.slice(0, 7),
      notifiedOn: today,
      decision: { ...stamp(actor), note: input.note?.trim() || null },
      updatedAt: serverTimestamp(),
    })
    log(tx, firestore, v, actor, "penalty_applied", { code: v.code, on: v.on, step: q.step + 1 })
    // PN-04 — he is told today, and the 15 days run from today: the notice names their last day.
    told = toEmployee(v, "hr_penalty_applied", { on: v.on, until: addDays(today, STATUTORY.penalties.objectionDays) })
  })
  const n = told as HrNotice | null
  if (n) await emitHrNotice(firestore, actor, n)
}

/** The employee objects within 15 days (PN-04): the penalty is suspended from payroll until decided. */
export async function objectPenalty(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, text: string, opts: { today?: string } = {}): Promise<void> {
  const today = opts.today ?? localToday()
  if (!text.trim()) throw new HrWriteError("blocked", ["no_text"])
  let objected: HrViolation | null = null
  await runTransaction(firestore, async (tx) => {
    const v = await readV(tx, firestore, id)
    if (!ctx.employeeId || ctx.employeeId !== v.employeeId) throw new HrWriteError("no_role")
    if (!mayObject(v, today)) throw new HrWriteError("blocked", ["objection_late"])
    tx.update(doc(firestore, HR_VIOLATIONS, id), { state: "objected", objection: { ...stamp(actor), text: text.trim() }, updatedAt: serverTimestamp() })
    log(tx, firestore, v, actor, "penalty_objected", { code: v.code, on: v.on })
    objected = v
  })
  const v = objected as HrViolation | null
  if (v)
    await emitHrNotice(firestore, actor, {
      kind: "hr_objection_filed",
      organizationId: v.organizationId,
      to: [{ hr: "manager" }],
      except: [v.employeeUserId],
      params: { name: v.employeeName, on: v.on },
      link: hrLinks.person(v.employeeId),
      once: v.id,
      employeeId: v.employeeId,
    })
}

/** The HR manager upholds or cancels (never counts again). An objection can come after the month's payroll
 * already deducted the penalty (PN-03/04): upheld, that deduction stands and nothing is taken again; cancelled,
 * it is paid back by that month's supplementary payroll (computeSupplementary). Upheld while it waited — the
 * payroll of its month went without it — it is deducted in the month decided. */
export async function decideObjection(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, verdict: "uphold" | "cancel", note: string, opts: { today?: string } = {}): Promise<void> {
  assertHr(ctx, "penalty.apply")
  const today = opts.today ?? localToday()
  if (!note.trim()) throw new HrWriteError("blocked", ["no_reason"])
  let told: HrNotice | null = null
  await runTransaction(firestore, async (tx) => {
    const v = await readV(tx, firestore, id)
    if (ctx.employeeId === v.employeeId && !ctx.owner) throw new HrWriteError("own_request")
    if (v.state !== "objected") throw new HrWriteError("blocked", ["decided"])
    let deductMonth = v.deductMonth ?? null
    if (verdict === "uphold") {
      const main = deductMonth ? await tx.get(doc(firestore, HR_PAYROLLS, payrollId(v.organizationId, deductMonth))) : null
      const closed = main?.exists() && (main.data() as Payroll).state !== "prepared"
      if (!deductMonth || (closed && !(deductedOn(((main!.data() as Payroll).lines ?? []).find((l) => l.employeeId === v.employeeId), v) > 0))) deductMonth = today.slice(0, 7)
    }
    tx.update(doc(firestore, HR_VIOLATIONS, id), {
      state: verdict === "uphold" ? "upheld" : "cancelled",
      ...(verdict === "uphold" && deductMonth !== v.deductMonth ? { deductMonth } : {}),
      objectionDecision: { ...stamp(actor), note: note.trim() },
      updatedAt: serverTimestamp(),
    })
    log(tx, firestore, v, actor, verdict === "uphold" ? "objection_upheld" : "objection_cancelled", { code: v.code, on: v.on })
    told = toEmployee(v, "hr_objection_decided", { on: v.on, verdict: verdict === "uphold" ? "@hr_verdict.upheld" : "@hr_verdict.cancelled", note: note.trim() })
  })
  const n = told as HrNotice | null
  if (n) await emitHrNotice(firestore, actor, n)
}

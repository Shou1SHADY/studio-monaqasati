// HR 1.0 — request writes (WF-07, WF-08; LV-01…07, AD-01…04, RL-02). Each is
// one transaction that reads the employee (and his pay for an advance) again,
// computes the request again and refuses what the rule refuses — the numbers
// on screen are never trusted. The employee's log names what happened, never
// an amount (RL-03).

import { collection, doc, runTransaction, serverTimestamp, type DocumentData, type Firestore, type Transaction, type UpdateData } from "firebase/firestore"
import { mayDecideRequest, type HrContext } from "./access"
import { HR_EMPLOYEES, HR_PAY, HR_REQUESTS } from "./collections"
import type { EmployeePay, HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import type { Holiday } from "./leave"
import { LEAVE_RULES, type LeaveType } from "./leave"
import {
  advanceQuote,
  dataBlocks,
  leaveQuote,
  mayCancel,
  REQUEST_NUMBER_TYPE,
  sickUsedIn,
  type DataFields,
  type HrRequest,
  type HrRequestKind,
  type Stamp,
} from "./requests"
import { serviceYears, type HrPolicies } from "./statutory"
import { drawYearlyDocNumber } from "../sales-numbering"
import { HrWriteError } from "./write-guard"

const localToday = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const stamp = (actor: HrActor, note?: string | null): Stamp => ({ by: actor.uid, byName: actor.name, at: new Date().toISOString(), note: note?.trim() || null })

function log(tx: Transaction, firestore: Firestore, emp: Pick<HrEmployee, "id" | "organizationId">, actor: HrActor, kind: string, params: Record<string, string | number | null>) {
  tx.set(doc(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG)), { organizationId: emp.organizationId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params, source: "hr" })
}

async function readEmp(tx: Transaction, firestore: Firestore, id: string): Promise<HrEmployee> {
  const snap = await tx.get(doc(firestore, HR_EMPLOYEES, id))
  if (!snap.exists()) throw new HrWriteError("missing")
  return { id: snap.id, ...(snap.data() as Omit<HrEmployee, "id">) }
}

async function readReq(tx: Transaction, firestore: Firestore, id: string): Promise<HrRequest> {
  const snap = await tx.get(doc(firestore, HR_REQUESTS, id))
  if (!snap.exists()) throw new HrWriteError("missing")
  return { id: snap.id, ...(snap.data() as Omit<HrRequest, "id">) }
}

export interface FileRequestInput {
  employeeId: string
  kind: HrRequestKind
  leave?: { type: LeaveType; from: string; to: string; excessUnpaid: boolean; travel: boolean; note?: string | null }
  advance?: { amount: number; reason: string }
  data?: DataFields
  /** The site's supervisor — the line manager (RL-04) — as the site names him. */
  supervisor?: { employeeId: string | null; userId: string | null } | null
}

type Opts = { policies: HrPolicies; holidays?: Holiday[]; today?: string; others?: Array<{ from: string; to: string }>; pendingAdvance?: boolean }

/** The employee files his own (My file); the HR manager files on his behalf. */
export async function fileRequest(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, input: FileRequestInput, opts: Opts): Promise<{ id: string; no: string }> {
  const own = Boolean(ctx.employeeId) && ctx.employeeId === input.employeeId
  if (!own && !ctx.roles.has("manager")) throw new HrWriteError("no_role")
  const today = opts.today ?? localToday()
  const ref = doc(collection(firestore, HR_REQUESTS))
  let no = ""
  await runTransaction(firestore, async (tx) => {
    const emp = await readEmp(tx, firestore, input.employeeId)
    if (emp.organizationId !== orgId) throw new HrWriteError("missing")
    if (emp.status === "left") throw new HrWriteError("blocked", ["left"])
    const pay = input.kind === "advance" ? await tx.get(doc(firestore, HR_PAY, emp.id)) : null
    const base = {
      organizationId: orgId,
      kind: input.kind,
      employeeId: emp.id,
      employeeUserId: emp.userId ?? null,
      employeeName: emp.names?.ar ?? "",
      siteId: emp.siteId ?? null,
      lineManagerId: input.supervisor?.employeeId && input.supervisor.employeeId !== emp.id ? input.supervisor.employeeId : null,
      lineManagerUserId: input.supervisor?.userId && input.supervisor.userId !== emp.userId ? input.supervisor.userId : null,
      // LV-05 — the HR manager's own goes to management.
      deciderLevel: (emp.userId === ctx.uid && ctx.roles.has("manager") ? "management" : "manager") as HrRequest["deciderLevel"],
      filedBy: stamp(actor),
      onBehalf: !own,
      state: "pending" as const,
      createdAt: new Date().toISOString(),
    }
    let body: Partial<HrRequest>
    if (input.kind === "leave") {
      const l = input.leave!
      const q = leaveQuote(emp, l, { holidays: opts.holidays, others: opts.others })
      if (q.blocks.length) throw new HrWriteError("blocked", q.blocks)
      body = { leave: { type: l.type, from: l.from, to: l.to, days: q.days, balance: q.balance, fromBalance: q.fromBalance, unpaidDays: q.unpaidDays, travel: l.travel, sick: q.sick, note: l.note?.trim() || null } }
    } else if (input.kind === "data") {
      const d = input.data!
      const blocks = dataBlocks(d)
      if (blocks.length) throw new HrWriteError("blocked", blocks)
      body = { data: { field: d.field, value: d.field === "iban" ? d.value.replace(/\s+/g, "").toUpperCase() : d.value.trim(), document: d.document?.trim() || null } }
    } else {
      const a = input.advance!
      const p = pay?.exists() ? (pay.data() as EmployeePay) : null
      const q = advanceQuote(p, a, { policies: opts.policies, today, contractEnd: emp.contract?.type === "fixed" ? emp.contract.end : null, pendingAdvance: opts.pendingAdvance })
      if (q.blocks.length) throw new HrWriteError("blocked", q.blocks)
      body = { advance: { amount: a.amount, reason: a.reason.trim(), instalment: q.instalment, months: q.months, overLimit: q.overLimit } }
    }
    no = await drawYearlyDocNumber(firestore, tx, orgId, REQUEST_NUMBER_TYPE[input.kind], Number(today.slice(0, 4)))
    tx.set(ref, { ...base, ...body, no, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, `${input.kind}_filed`, { no })
  })
  return { id: ref.id, no }
}

/** The supervisor or line manager endorses a leave (LV-05) — never his own. */
export async function endorseRequest(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, note?: string | null): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    if (r.kind !== "leave" || r.state !== "pending") throw new HrWriteError("blocked", ["stale"])
    if (ctx.employeeId && ctx.employeeId === r.employeeId) throw new HrWriteError("own_request")
    const mine = (r.lineManagerUserId && r.lineManagerUserId === ctx.uid) || (ctx.roles.has("supervisor") && r.siteId && ctx.sites.includes(r.siteId))
    if (!mine) throw new HrWriteError("no_role")
    tx.update(doc(firestore, HR_REQUESTS, id), { state: "endorsed", endorsement: stamp(actor, note), updatedAt: serverTimestamp() })
  })
}

/** The HR manager decides (management on the HR manager's own). A leave's
 * effects land on the record; an advance above the HR limit goes to Finance. */
export async function decideRequest(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  verdict: "approve" | "decline",
  note: string,
  opts: Opts
): Promise<{ state: HrRequest["state"] }> {
  const today = opts.today ?? localToday()
  let state: HrRequest["state"] = "declined"
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    const refusal = mayDecideRequest(ctx, { employeeId: r.employeeId, isHrManager: r.deciderLevel === "management" })
    if (refusal) throw new HrWriteError(refusal)
    if (r.state !== "pending" && r.state !== "endorsed") throw new HrWriteError("blocked", ["stale"])
    const emp = await readEmp(tx, firestore, r.employeeId)
    const payRef = doc(firestore, HR_PAY, r.employeeId)
    const paySnap = r.kind === "advance" ? await tx.get(payRef) : null
    const reqRef = doc(firestore, HR_REQUESTS, id)
    const decision = { ...stamp(actor, note), ownFlagged: ctx.owner && ctx.employeeId === r.employeeId }
    if (verdict === "decline") {
      if (!note.trim()) throw new HrWriteError("blocked", ["no_reason"])
      tx.update(reqRef, { state: "declined", decision, updatedAt: serverTimestamp() })
      log(tx, firestore, emp, actor, `${r.kind}_declined`, { no: r.no })
      state = "declined"
      return
    }
    if (r.kind === "data") {
      // ES-03 — applied by the HR manager's approval; the employee never edits his record.
      const d = r.data!
      if (d.field === "iban") tx.set(doc(firestore, HR_PAY, r.employeeId), { employeeId: r.employeeId, organizationId: r.organizationId, iban: d.value, ibanState: "ok", updatedAt: serverTimestamp() }, { merge: true })
      else tx.update(doc(firestore, HR_EMPLOYEES, r.employeeId), { [`contact.${d.field}`]: d.value, updatedAt: serverTimestamp() })
      tx.update(reqRef, { state: "approved", decision, updatedAt: serverTimestamp() })
      log(tx, firestore, emp, actor, "data_updated", { no: r.no, field: d.field })
      state = "approved"
      return
    }
    if (r.kind === "leave") {
      const l = r.leave!
      const q = leaveQuote(emp, { type: l.type, from: l.from, to: l.to, excessUnpaid: l.unpaidDays > 0 && Boolean(LEAVE_RULES[l.type].fromBalance), travel: l.travel }, { holidays: opts.holidays })
      const blocks: string[] = [...q.blocks]
      // LV-04 — not approvable for travel while a document would lapse abroad.
      if (q.warnings.includes("travel_docs")) blocks.push("travel_docs")
      if (blocks.length) throw new HrWriteError("blocked", blocks)
      const patch: UpdateData<DocumentData> = { updatedAt: serverTimestamp() }
      if (q.fromBalance) patch.leaveTaken = (emp.leaveTaken ?? 0) + q.fromBalance
      if (l.type === "sick") patch.sick = { year: Math.floor(serviceYears(emp.join, l.from)), days: sickUsedIn(emp, l.from) + q.days }
      if (l.type === "hajj") patch.hajjTaken = true
      tx.update(doc(firestore, HR_EMPLOYEES, emp.id), patch)
      tx.update(reqRef, {
        state: "approved",
        decision,
        leave: { ...l, days: q.days, balance: q.balance, fromBalance: q.fromBalance, unpaidDays: q.unpaidDays, sick: q.sick },
        updatedAt: serverTimestamp(),
      })
      log(tx, firestore, emp, actor, "leave_approved", { no: r.no, from: l.from, to: l.to })
      state = "approved"
      return
    }
    const a = r.advance!
    const pay = paySnap?.exists() ? (paySnap.data() as EmployeePay) : null
    const q = advanceQuote(pay, { amount: a.amount, reason: a.reason }, { policies: opts.policies, today })
    if (q.blocks.length) throw new HrWriteError("blocked", q.blocks)
    if (q.overLimit) {
      // AD-03 — held with HR's view, decided in Finance.
      tx.update(reqRef, { state: "finance", financeHold: true, decision, advance: { ...a, instalment: q.instalment, months: q.months, overLimit: true }, updatedAt: serverTimestamp() })
      log(tx, firestore, emp, actor, "advance_to_finance", { no: r.no })
      state = "finance"
      return
    }
    tx.set(payRef, { advance: { amount: a.amount, balance: a.amount, instalment: q.instalment }, updatedAt: serverTimestamp() }, { merge: true })
    tx.update(reqRef, { state: "approved", decision, advance: { ...a, instalment: q.instalment, months: q.months, overLimit: false }, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "advance_approved", { no: r.no })
    state = "approved"
  })
  return { state }
}

/** Finance decides an advance HR sent up (AD-03). `financeAllowed` = the owner, invoices.manage or accounting.post. */
export async function financeDecideAdvance(firestore: Firestore, actor: HrActor & { employeeId?: string | null }, financeAllowed: boolean, id: string, verdict: "approve" | "decline", note: string): Promise<void> {
  if (!financeAllowed) throw new HrWriteError("no_role")
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    if (r.kind !== "advance" || r.state !== "finance") throw new HrWriteError("blocked", ["stale"])
    if (actor.employeeId && actor.employeeId === r.employeeId) throw new HrWriteError("own_request")
    const payRef = doc(firestore, HR_PAY, r.employeeId)
    const pay = await tx.get(payRef)
    const reqRef = doc(firestore, HR_REQUESTS, id)
    if (verdict === "decline") {
      if (!note.trim()) throw new HrWriteError("blocked", ["no_reason"])
      tx.update(reqRef, { state: "declined", finance: stamp(actor, note), updatedAt: serverTimestamp() })
      return
    }
    if (((pay.data() as EmployeePay | undefined)?.advance?.balance ?? 0) > 0) throw new HrWriteError("blocked", ["outstanding"])
    const a = r.advance!
    tx.set(payRef, { advance: { amount: a.amount, balance: a.amount, instalment: a.instalment }, updatedAt: serverTimestamp() }, { merge: true })
    tx.update(reqRef, { state: "approved", finance: stamp(actor, note), updatedAt: serverTimestamp() })
  })
}

/** Cancel a request that has not started (LV-07): an approved leave gives its days back. */
export async function cancelRequest(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, note: string, opts: { today?: string } = {}): Promise<void> {
  const today = opts.today ?? localToday()
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    if (!mayCancel(ctx, r, today)) throw new HrWriteError("no_role")
    const emp = await readEmp(tx, firestore, r.employeeId)
    if (r.state === "approved" && r.leave) {
      const l = r.leave
      const patch: UpdateData<DocumentData> = { updatedAt: serverTimestamp() }
      if (l.fromBalance) patch.leaveTaken = Math.max(0, (emp.leaveTaken ?? 0) - l.fromBalance)
      if (l.type === "sick" && emp.sick) patch.sick = { ...emp.sick, days: Math.max(0, emp.sick.days - l.days) }
      if (l.type === "hajj") patch.hajjTaken = false
      tx.update(doc(firestore, HR_EMPLOYEES, emp.id), patch)
    }
    tx.update(doc(firestore, HR_REQUESTS, id), { state: "cancelled", cancel: stamp(actor, note), updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, `${r.kind}_cancelled`, { no: r.no })
  })
}

// HR 1.0 — employee writes (WF-03, WF-10, WF-11, WF-13, WF-14; EM-02…06).
// Each is one transaction with the guard first and the blocks run again; each
// appends an entry to the employee's log, which nobody can edit or delete
// (EM-06). Pay is written to `employeePay` only by those who may see it.

import { collection, doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { hrAllowed, type HrContext } from "./access"
import { HR_EMPLOYEES, HR_PAY } from "./collections"
import { HR_SETTINGS } from "./settings"
import type { DocType } from "./documents"
import {
  assignBlocks,
  newEmployeeBlocks,
  payChangeBlocks,
  probationBlocks,
  probationEnd,
  renewalBlocks,
  type EmployeePay,
  type HrEmployee,
  type NewEmployeeInput,
} from "./employee"
import { advanceInstalment, payFromBasic, retroDifference, wageOf } from "./pay"
import { DEFAULT_HR_POLICIES, monthRange, type HrPolicies } from "./statutory"
import { tradeOf } from "./trades"
import { UNASSIGNED_SITE } from "./sites"
import { assertHr, HrWriteError } from "./write-guard"

/** `hrCounters/{orgId}` — the last permanent employee number (never reused). */
export const HR_COUNTERS = "hrCounters"
/** `employees/{id}/log` — append-only. */
export const HR_LOG = "log"

export interface HrActor {
  uid: string
  name: string | null
}

export interface LogEntry {
  at: string
  by: string
  byName: string | null
  kind: string
  params?: Record<string, string | number | null>
  /** The module the event came from (EM-06). */
  source: "hr" | "finance" | "inventory" | "projects"
}

const today = () => new Date().toISOString().slice(0, 10)

function log(tx: Transaction, firestore: Firestore, employeeId: string, orgId: string, actor: HrActor, kind: string, params?: LogEntry["params"]) {
  const entry: LogEntry & { organizationId: string } = { organizationId: orgId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params: params ?? {}, source: "hr" }
  tx.set(doc(collection(firestore, HR_EMPLOYEES, employeeId, HR_LOG)), entry)
}

async function readEmployee(tx: Transaction, firestore: Firestore, id: string) {
  const ref = doc(firestore, HR_EMPLOYEES, id)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new HrWriteError("missing")
  return { ref, emp: { id: snap.id, ...(snap.data() as Omit<HrEmployee, "id">) } }
}

// ---------------------------------------------------------------------------
// New employee (EM-02, EM-03)
// ---------------------------------------------------------------------------

export interface CreateEmployeeInput extends NewEmployeeInput {
  iban?: string | null
  userId?: string | null
  /** Moving in (IM-02, PY-10): the import month payroll starts from, the leave
   * balance as an opening adjustment to accrual, the outstanding advance. */
  since?: string | null
  openingLeave?: number
  advanceBalance?: number
}

export async function createEmployee(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  input: CreateEmployeeInput,
  opts: { visas: number | null; policies?: HrPolicies } = { visas: null }
): Promise<{ id: string; no: number }> {
  assertHr(ctx, "employee.create")
  const day = today()
  const { blocks } = newEmployeeBlocks(input, { visas: opts.visas, today: day })
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  // Government relations records a joiner without pay; the HR manager completes it.
  const withPay = hrAllowed(ctx, "pay.view") && input.basic != null && input.basic > 0
  const ref = doc(collection(firestore, HR_EMPLOYEES))
  let no = 0
  await runTransaction(firestore, async (tx) => {
    const cRef = doc(firestore, HR_COUNTERS, orgId)
    const c = await tx.get(cRef)
    no = ((c.exists() ? (c.data() as { lastEmployeeNo?: number }).lastEmployeeNo : 0) ?? 0) + 1
    // A visa arrival uses one visa of the establishment file — read again here,
    // so two arrivals never spend the last visa twice.
    const sRef = doc(firestore, HR_SETTINGS, orgId)
    let visasLeft: number | null = null
    if (input.source === "visa") {
      const s = await tx.get(sRef)
      const v = s.exists() ? (s.data() as { establishment?: { visas?: unknown } }).establishment?.visas : null
      visasLeft = typeof v === "number" ? v : 0
      if (visasLeft <= 0) throw new HrWriteError("blocked", ["no_visas"])
    }
    const trade = tradeOf(input.trade)!
    const emp: Omit<HrEmployee, "id"> = {
      organizationId: orgId,
      no,
      names: { ar: input.nameAr.trim(), en: input.nameEn?.trim() || null },
      nationality: input.nationality,
      gender: input.gender,
      idNo: input.idNo?.trim() || null,
      trade: input.trade,
      category: trade.category,
      siteId: input.siteId && input.siteId !== UNASSIGNED_SITE ? input.siteId : null,
      managerId: null,
      userId: input.userId ?? null,
      join: input.join,
      since: input.since ?? null,
      source: input.source,
      contract: { type: input.contractType, end: input.contractType === "fixed" ? input.contractEnd ?? null : null },
      probation: { end: probationEnd(input.join), consentOn: null, decision: null, decidedOn: null },
      status: input.join > day ? "expected" : "active",
      docs: input.docs,
      leaveTaken: 0,
      openingLeave: input.openingLeave ?? 0,
      sick: null,
      hajjTaken: false,
    }
    tx.set(cRef, { organizationId: orgId, lastEmployeeNo: no, updatedAt: serverTimestamp() })
    if (visasLeft != null) tx.update(sRef, { "establishment.visas": visasLeft - 1 })
    // The old readers (delivery notes, lists) read `name`; pay never sits here.
    tx.set(ref, { ...emp, name: emp.names.ar, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    if (withPay) {
      const parts = payFromBasic(input.basic as number, opts.policies ?? DEFAULT_HR_POLICIES)
      const pay: EmployeePay = {
        employeeId: ref.id,
        organizationId: orgId,
        ...parts,
        iban: input.iban?.trim() || null,
        ibanState: input.iban ? "ok" : null,
        advance: (input.advanceBalance ?? 0) > 0 ? { amount: input.advanceBalance!, balance: input.advanceBalance!, instalment: advanceInstalment(wageOf(parts)) } : null,
        retro: [],
      }
      tx.set(doc(firestore, HR_PAY, ref.id), { ...pay, updatedAt: serverTimestamp() })
    }
    log(tx, firestore, ref.id, orgId, actor, input.since ? "imported" : "created", { no, site: emp.siteId, trade: emp.trade })
  })
  return { id: ref.id, no }
}

// ---------------------------------------------------------------------------
// Assign and move (AS-01, AS-03, DC-02)
// ---------------------------------------------------------------------------

export async function assignEmployee(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { siteId: string | null; effectiveOn: string }): Promise<void> {
  assertHr(ctx, "employee.assign")
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const blocks = assignBlocks(emp, input.siteId, input.effectiveOn, today())
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const to = input.siteId && input.siteId !== UNASSIGNED_SITE ? input.siteId : null
    tx.update(ref, { siteId: to, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "moved", { from: emp.siteId ?? UNASSIGNED_SITE, to: to ?? UNASSIGNED_SITE, on: input.effectiveOn })
  })
}

// ---------------------------------------------------------------------------
// Pay change and promotion (EM-04) — never one's own (RL-02)
// ---------------------------------------------------------------------------

export async function changePay(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { basic: number; effectiveOn: string; reason: string; kind: "raise" | "promotion" | "correction"; trade?: string | null },
  opts: { policies?: HrPolicies; lastClosedMonth?: string | null } = {}
): Promise<{ retro: number }> {
  assertHr(ctx, "pay.change")
  if (ctx.employeeId === id && !ctx.owner) throw new HrWriteError("own_request")
  let retro = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const pRef = doc(firestore, HR_PAY, id)
    const pSnap = await tx.get(pRef)
    const pay = pSnap.exists() ? (pSnap.data() as EmployeePay) : null
    const currentBasic = pay?.basic ?? 0
    const lastClosed = opts.lastClosedMonth ?? null
    const { blocks } = payChangeBlocks({ basic: input.basic, currentBasic, effectiveOn: input.effectiveOn, reason: input.reason, nationality: emp.nationality, lastClosedMonthStart: lastClosed ? monthRange(lastClosed).start : null })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const next = payFromBasic(input.basic, opts.policies ?? DEFAULT_HR_POLICIES)
    // An effective date inside the last closed month: the difference goes to the
    // supplementary payroll; the closed month is never reopened.
    const retroItems = [...(pay?.retro ?? [])]
    if (lastClosed && input.effectiveOn <= monthRange(lastClosed).end && pay) {
      const days = Math.round((Date.parse(monthRange(lastClosed).end) - Date.parse(input.effectiveOn)) / 86_400_000) + 1
      retro = retroDifference(wageOf(pay), wageOf(next), days)
      if (retro !== 0) retroItems.push({ month: lastClosed, amount: retro, reason: input.reason.trim() })
    }
    tx.set(pRef, { employeeId: id, organizationId: emp.organizationId, ...next, retro: retroItems, updatedAt: serverTimestamp() }, { merge: true })
    if (input.trade && input.trade !== emp.trade && tradeOf(input.trade)) {
      tx.update(ref, { trade: input.trade, category: tradeOf(input.trade)!.category, updatedAt: serverTimestamp() })
    }
    // The log is read by roles that may not see pay and by the employee — it
    // names the change and its day, never an amount (RL-03); the figures live
    // on the pay document.
    log(tx, firestore, id, emp.organizationId, actor, input.kind === "promotion" ? "promoted" : "pay_changed", { on: input.effectiveOn, reason: input.reason.trim(), trade: input.kind === "promotion" ? input.trade ?? null : null })
  })
  return { retro }
}

// ---------------------------------------------------------------------------
// Probation (EM-05) — the line manager's view attaches, never blocks
// ---------------------------------------------------------------------------

export async function decideProbation(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  decision: "confirm" | "extend" | "end",
  ext: { to?: string | null; consentOn?: string | null } = {}
): Promise<void> {
  assertHr(ctx, "request.decide")
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const blocks = probationBlocks(emp, decision, ext)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const probation =
      decision === "extend"
        ? { ...emp.probation, end: ext.to as string, consentOn: ext.consentOn ?? null }
        : { ...emp.probation, decision: decision === "confirm" ? ("confirmed" as const) : ("ended" as const), decidedOn: today() }
    tx.update(ref, { probation, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, `probation_${decision}`, { to: ext.to ?? null, consent: ext.consentOn ?? null })
  })
}

// ---------------------------------------------------------------------------
// Documents — a renewal (DC-03)
// ---------------------------------------------------------------------------

export async function recordRenewal(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { type: DocType; expiry: string; fee?: number | null }): Promise<void> {
  assertHr(ctx, "documents.manage")
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const blocks = renewalBlocks(emp.docs ?? {}, input.type, input.expiry, today())
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    tx.update(ref, { [`docs.${input.type}`]: input.expiry, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "renewed", { doc: input.type, from: emp.docs?.[input.type] ?? null, to: input.expiry, fee: input.fee ?? null })
  })
}

/** Link the platform user who IS this employee — his "My file" (ES-00). */
export async function linkUser(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, userId: string | null): Promise<void> {
  assertHr(ctx, "employee.edit")
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    // The pay document carries no user: the rules read the link here — whoever
    // a record names reads its pay and is "the employee" on his requests. So
    // nobody links himself onto a record or off one (RL-02; the owner, who has
    // nobody above him, excepted). The rules refuse it too.
    if (!ctx.owner && (userId === ctx.uid || emp.userId === ctx.uid)) throw new HrWriteError("own_request")
    tx.update(ref, { userId, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "user_linked", { user: userId })
  })
}

// ---------------------------------------------------------------------------
// A returned transfer's IBAN (PY-03, RL-02): payroll fixes it, the HR manager
// approves it — never the same hand; only then does Finance pay the line.
// ---------------------------------------------------------------------------

const IBAN = /^SA\d{22}$/

export async function fixIban(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, iban: string): Promise<void> {
  assertHr(ctx, "iban.fix")
  const clean = iban.replace(/\s+/g, "").toUpperCase()
  if (!IBAN.test(clean)) throw new HrWriteError("blocked", ["bad_iban"])
  await runTransaction(firestore, async (tx) => {
    const { emp } = await readEmployee(tx, firestore, id)
    tx.update(doc(firestore, HR_PAY, id), { iban: clean, ibanState: "fixed", ibanFixedBy: actor.uid, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "iban_fixed", {})
  })
}

export async function approveIban(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor): Promise<void> {
  assertHr(ctx, "iban.approve")
  await runTransaction(firestore, async (tx) => {
    const { emp } = await readEmployee(tx, firestore, id)
    const p = await tx.get(doc(firestore, HR_PAY, id))
    const pay = p.exists() ? (p.data() as EmployeePay & { ibanFixedBy?: string }) : null
    if (pay?.ibanState !== "fixed") throw new HrWriteError("blocked", ["stale"])
    if (pay.ibanFixedBy === actor.uid && !ctx.owner) throw new HrWriteError("own_request")
    tx.update(doc(firestore, HR_PAY, id), { ibanState: "ok", updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "iban_approved", {})
  })
}

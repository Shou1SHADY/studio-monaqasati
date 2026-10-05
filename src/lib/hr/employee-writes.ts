// HR 1.0 — employee writes (WF-03, WF-10, WF-11, WF-13, WF-14; EM-02…06).
// Each is one transaction with the guard first and the blocks run again; each
// appends an entry to the employee's log, which nobody can edit or delete
// (EM-06). Pay is written to `employeePay` only by those who may see it.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, type DocumentData, type Firestore, type Transaction, type UpdateData } from "firebase/firestore"
import { hrAllowed, mayDecideRequest, userIsHrManager, type HrContext } from "./access"
import { HR_EMPLOYEES, HR_EVENTS, HR_PAY, HR_PAYROLLS, HR_REQUESTS, HR_SITES } from "./collections"
import { attachmentBlocks, HR_FILES, type AttachmentKind, type EmployeeFile } from "./attachments"
import { HR_SETTINGS } from "./settings"
import { cleanIban, DOC_NUMBER_KEYS, iqamaDueBy, type DocDates, type DocNumbers, type DocType } from "./documents"
import {
  assignBlocks,
  contractBlocks,
  lineManagerBlocks,
  newEmployeeBlocks,
  payChangeRefusal,
  probationViewBlocks,
  type PayStepMeta,
  type ProbationRecommend,
  type ProbationView,
  type ScheduledMove,
  openingBlocks,
  payChangeBlocks,
  probationBlocks,
  probationEnd,
  renewalBlocks,
  type EmployeePay,
  type HrEmployee,
  type NewEmployeeInput,
} from "./employee"
import { openingFor } from "./leave"
import { advanceInstalment, payFromBasic, payOn, paySegments, wageOf, type PayFacts, type PayStep } from "./pay"
import { payrollId, type Payroll, type PayrollLine } from "./payroll"
import { addDays, DEFAULT_HR_POLICIES, monthRange, r2, type HrPolicies } from "./statutory"
import { tradeOf } from "./trades"
import { HR_ASSIGN_FIXES, UNASSIGNED_SITE, type AssignFix, type HrSite } from "./sites"
import type { HrRequest } from "./requests"
import { startExit } from "./exit-writes"
import { todayDay } from "./format"
import { emitHrNotice, hrLinks } from "./notify"
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

/** The day in Riyadh — 00:00–03:00 is today there, not yesterday (the UTC day). */
const today = () => todayDay()

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
  /** SAMA bank code — with the IBAN (PY-07). */
  bank?: string | null
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
  if (input.userId && (await otherRecordsOf(firestore, orgId, input.userId, ref.id)).length) throw new HrWriteError("blocked", ["user_linked"])
  let no = 0
  await runTransaction(firestore, async (tx) => {
    const cRef = doc(firestore, HR_COUNTERS, orgId)
    const c = await tx.get(cRef)
    no = ((c.exists() ? (c.data() as { lastEmployeeNo?: number }).lastEmployeeNo : 0) ?? 0) + 1
    // A visa arrival uses one visa of the establishment file — read again here,
    // so two arrivals never spend the last visa twice.
    const sRef = doc(firestore, HR_SETTINGS, orgId)
    let visasLeft: number | null = null
    let reserved = 0
    if (input.source === "visa") {
      const s = await tx.get(sRef)
      const est = s.exists() ? (s.data() as { establishment?: { visas?: unknown; visasReserved?: unknown } }).establishment : null
      visasLeft = typeof est?.visas === "number" ? est.visas : 0
      reserved = typeof est?.visasReserved === "number" ? est.visasReserved : 0
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
      siteSince: input.siteId && input.siteId !== UNASSIGNED_SITE ? input.join : null,
      probation: { end: probationEnd(input.join), consentOn: null, decision: null, decidedOn: null },
      status: input.join > day ? "expected" : "active",
      // A fixed-term contract's end is a document date too (DC-01): it reaches the nearest-document tile and Today.
      docs: { ...datesOf(input.docs), contract: input.contractType === "fixed" ? (input.contractEnd ?? null) : null, ...(cleanNumbers(input.docs?.no) ? { no: cleanNumbers(input.docs?.no) } : {}) },
      education: input.education?.trim() || null,
      leaveTaken: 0,
      openingLeave: input.openingLeave ?? 0,
      sick: null,
      hajjTaken: false,
    }
    tx.set(cRef, { organizationId: orgId, lastEmployeeNo: no, updatedAt: serverTimestamp() })
    // An arrival spends one visa; one a manpower plan reserved (WF-12) is that reservation arriving — never spent twice.
    if (visasLeft != null) tx.update(sRef, { "establishment.visas": visasLeft - 1, ...(reserved > 0 ? { "establishment.visasReserved": reserved - 1 } : {}) })
    // The old readers (delivery notes, lists) read `name`; pay never sits here.
    tx.set(ref, { ...emp, name: emp.names.ar, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    if (withPay) {
      const parts = payFromBasic(input.basic as number, opts.policies ?? DEFAULT_HR_POLICIES)
      const pay: EmployeePay = {
        employeeId: ref.id,
        organizationId: orgId,
        ...parts,
        iban: input.iban?.trim() ? cleanIban(input.iban) : null,
        bank: input.bank || null,
        ibanState: input.iban?.trim() ? "ok" : null,
        advance: (input.advanceBalance ?? 0) > 0 ? { amount: input.advanceBalance!, balance: input.advanceBalance!, instalment: advanceInstalment(wageOf(parts)) } : null,
        retro: [],
      }
      tx.set(doc(firestore, HR_PAY, ref.id), { ...pay, updatedAt: serverTimestamp() })
    }
    log(tx, firestore, ref.id, orgId, actor, input.since ? "imported" : "created", { no, site: emp.siteId, trade: emp.trade })
  })
  // DC-05 — a visa arrival's iqama is due 90 days after he joins: government relations hears it now.
  if (input.source === "visa" && input.nationality !== "sa" && !input.docs?.iqama && input.join)
    await emitHrNotice(firestore, actor, {
      kind: "hr_iqama_clock",
      organizationId: orgId,
      to: [{ hr: "gov" }],
      params: { name: input.nameAr.trim(), join: input.join, date: iqamaDueBy(input.join) },
      link: hrLinks.person(ref.id),
      once: ref.id,
      employeeId: ref.id,
    })
  return { id: ref.id, no }
}

/** The other employee records of the company that name this platform user. A transaction cannot query, so it is
 * read beside it — as the open assignment corrections are; two HR managers racing would both see none. */
async function otherRecordsOf(firestore: Firestore, orgId: string, userId: string, exceptId: string): Promise<string[]> {
  const snap = await getDocs(query(collection(firestore, HR_EMPLOYEES), where("organizationId", "==", orgId), where("userId", "==", userId)))
  return snap.docs.map((d) => d.id).filter((id) => id !== exceptId)
}

// ---------------------------------------------------------------------------
// Assign and move (AS-01, AS-03, DC-02)
// ---------------------------------------------------------------------------

/** The dates of a document set without its numbers (they are written cleaned, apart). */
function datesOf(docs: DocDates | null | undefined): DocDates {
  const out: DocDates = { ...(docs ?? {}) }
  delete out.no
  return out
}

/** The digits on a person's documents, trimmed; null when none was given. */
function cleanNumbers(no: DocNumbers | null | undefined): DocNumbers | null {
  if (!no) return null
  const out: DocNumbers = {}
  for (const k of DOC_NUMBER_KEYS) if (no[k]?.trim()) out[k] = no[k]!.trim()
  return Object.keys(out).length ? out : null
}

/**
 * Assign or move (AS-01, AS-03, the prototype's `assign` form). The move is checked on the day it takes effect —
 * an expired iqama goes nowhere but unassigned (DC-02), a driver with an expired licence is not moved to driving
 * work (DC-06). From today or earlier it moves now; dated ahead, the record keeps its place and carries the move
 * until its day (`applyDueMoves`). The person's pending assignment corrections are answered by it — done where
 * it puts him on the site he was reported working on, declined otherwise — and Projects hears of a move onto a
 * project's site. It may name the manpower request it answers (AS-02).
 */
export async function assignEmployee(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { siteId: string | null; effectiveOn: string; manpowerRequestId?: string | null },
  opts: { today?: string } = {}
): Promise<{ scheduled: boolean }> {
  assertHr(ctx, "employee.assign")
  const day = opts.today ?? today()
  const to = input.siteId && input.siteId !== UNASSIGNED_SITE ? input.siteId : null
  // A transaction cannot query: his open corrections are read beside it, each re-read inside.
  const orgId = await orgOfEmployee(firestore, id)
  const fixes = await getDocs(query(collection(firestore, HR_ASSIGN_FIXES), where("organizationId", "==", orgId), where("employeeId", "==", id), where("state", "==", "pending"))).catch(() => null)
  let moved: HrEmployee | null = null
  let site: HrSite | null = null
  const scheduled = Boolean(input.effectiveOn) && input.effectiveOn > day
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const sSnap = to ? await tx.get(doc(firestore, HR_SITES, to)) : null
    site = sSnap?.exists() ? ({ id: sSnap.id, ...(sSnap.data() as Omit<HrSite, "id">) } as HrSite) : null
    const blocks = assignBlocks(emp, input.siteId, input.effectiveOn, day, { type: site?.type ?? null })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const open: Array<{ ref: ReturnType<typeof doc>; fix: AssignFix }> = []
    for (const f of fixes?.docs ?? []) {
      const s = await tx.get(f.ref)
      if (s.exists() && (s.data() as AssignFix).state === "pending") open.push({ ref: f.ref, fix: s.data() as AssignFix })
    }
    const mr = input.manpowerRequestId || null
    if (scheduled) {
      const move: ScheduledMove = { to, on: input.effectiveOn, by: actor.uid, byName: actor.name, at: new Date().toISOString(), mr }
      tx.update(ref, { move, updatedAt: serverTimestamp() })
      log(tx, firestore, id, emp.organizationId, actor, "move_scheduled", { from: emp.siteId ?? UNASSIGNED_SITE, to: to ?? UNASSIGNED_SITE, on: input.effectiveOn, mr })
    } else {
      tx.update(ref, { siteId: to, siteSince: input.effectiveOn, move: null, updatedAt: serverTimestamp() })
      log(tx, firestore, id, emp.organizationId, actor, "moved", { from: emp.siteId ?? UNASSIGNED_SITE, to: to ?? UNASSIGNED_SITE, on: input.effectiveOn, mr })
    }
    const at = new Date().toISOString()
    for (const o of open) tx.update(o.ref, { state: o.fix.siteId === (to ?? UNASSIGNED_SITE) ? "done" : "declined", decision: { by: actor.uid, byName: actor.name, at, note: "moved" }, updatedAt: serverTimestamp() })
    moved = emp
  })
  const e = moved as HrEmployee | null
  const s = site as HrSite | null
  // AS-01 — Projects hears who comes onto its site, and from when (best-effort, after the write).
  if (e && s?.type === "project" && s.projectId) {
    const pm = await getDoc(doc(firestore, "projects", s.projectId))
      .then((p) => (p.exists() ? ((p.data() as { projectManagerId?: string | null }).projectManagerId ?? null) : null))
      .catch(() => null)
    if (pm)
      await emitHrNotice(firestore, actor, {
        kind: "hr_assigned_to_project",
        organizationId: e.organizationId,
        to: [{ users: [pm] }],
        params: { name: e.names?.ar ?? "", site: s.name, on: input.effectiveOn },
        link: hrLinks.projectTeam(s.projectId),
        once: `${id}_${s.id}_${input.effectiveOn}`,
        employeeId: id,
      })
  }
  return { scheduled }
}

async function orgOfEmployee(firestore: Firestore, id: string): Promise<string> {
  const s = await getDoc(doc(firestore, HR_EMPLOYEES, id))
  if (!s.exists()) throw new HrWriteError("missing")
  return (s.data() as { organizationId: string }).organizationId
}

/** A move dated ahead takes effect on its day (AS-03): whoever of the HR manager's screens opens first after it
 * applies it — read again inside, so a move cancelled or replaced meanwhile is left alone. Returns how many moved. */
export async function applyDueMoves(firestore: Firestore, ctx: HrContext, actor: HrActor, employees: ReadonlyArray<Pick<HrEmployee, "id" | "move">>, opts: { today?: string } = {}): Promise<number> {
  if (!hrAllowed(ctx, "employee.assign")) return 0
  const day = opts.today ?? today()
  let n = 0
  for (const e of employees) {
    if (!e.move || e.move.on > day) continue
    try {
      await runTransaction(firestore, async (tx) => {
        const { ref, emp } = await readEmployee(tx, firestore, e.id)
        const m = emp.move
        if (!m || m.on > day) return
        if (emp.status === "left") {
          tx.update(ref, { move: null, updatedAt: serverTimestamp() })
          return
        }
        tx.update(ref, { siteId: m.to, siteSince: m.on, move: null, updatedAt: serverTimestamp() })
        log(tx, firestore, e.id, emp.organizationId, { uid: actor.uid, name: actor.name }, "moved", { from: emp.siteId ?? UNASSIGNED_SITE, to: m.to ?? UNASSIGNED_SITE, on: m.on, mr: m.mr ?? null })
        n += 1
      })
    } catch (err) {
      console.warn("a due move was not applied:", (err as { code?: string })?.code || err)
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// The line manager (RL-04) and his probation view (EM-05)
// ---------------------------------------------------------------------------

/** The HR manager names a person's line manager (the prototype's `mgr` form) — or clears it, and the line manager
 * is derived again. Never himself, never someone gone or not yet arrived, never a circle. */
export async function setLineManager(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, managerId: string | null): Promise<void> {
  assertHr(ctx, "employee.edit")
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    let mgr: HrEmployee | null = null
    if (managerId) {
      const m = await tx.get(doc(firestore, HR_EMPLOYEES, managerId))
      mgr = m.exists() ? ({ id: m.id, ...(m.data() as Omit<HrEmployee, "id">) } as HrEmployee) : null
      if (mgr && mgr.organizationId !== emp.organizationId) mgr = null
    }
    const blocks = lineManagerBlocks(emp, managerId, mgr ? [mgr] : [])
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    tx.update(ref, { managerId: managerId || null, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "manager_set", { manager: mgr?.names?.ar ?? null })
  })
}

/** The line manager's probation view (EM-05; the prototype's `pe`): written by the person's line manager — the
 * one set on the card, or the workplace's supervisor — or by the HR manager; attached to the probation, shown at
 * the decision, never blocking it. The HR manager hears of it. */
export async function recordProbationView(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { rating: 1 | 2 | 3 | null; recommend: ProbationRecommend | null; note?: string | null },
  opts: { today?: string } = {}
): Promise<void> {
  const day = opts.today ?? today()
  let emp: HrEmployee | null = null
  await runTransaction(firestore, async (tx) => {
    const r = await readEmployee(tx, firestore, id)
    emp = r.emp
    // RL-02 — never on himself; the line manager is the one the card names, or the workplace's supervisor.
    if (ctx.employeeId === id || r.emp.userId === ctx.uid) throw new HrWriteError("own_request")
    let mine = ctx.roles.has("manager") || ctx.owner
    if (!mine && r.emp.managerId) {
      const m = await tx.get(doc(firestore, HR_EMPLOYEES, r.emp.managerId))
      mine = m.exists() && (m.data() as HrEmployee).userId === ctx.uid
    }
    if (!mine && r.emp.siteId) {
      const s = await tx.get(doc(firestore, HR_SITES, r.emp.siteId))
      mine = s.exists() && (s.data() as HrSite).supervisorUserId === ctx.uid
    }
    if (!mine) throw new HrWriteError("no_role")
    const blocks = probationViewBlocks(r.emp, input, day)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const view: ProbationView = { by: actor.uid, byName: actor.name, at: new Date().toISOString(), rating: input.rating as 1 | 2 | 3, recommend: input.recommend as ProbationRecommend, note: input.note?.trim() || null }
    tx.update(r.ref, { probationView: view, updatedAt: serverTimestamp() })
    // The log is HR staff's to write (a line manager with no HR role cannot) — the view itself names who and when.
    if (ctx.roles.size > 0 || ctx.owner) log(tx, firestore, id, r.emp.organizationId, actor, "probation_view", { recommend: view.recommend })
  })
  const e = emp as HrEmployee | null
  if (e)
    await emitHrNotice(firestore, actor, {
      kind: "hr_probation_view",
      organizationId: e.organizationId,
      to: [{ hr: "manager" }],
      except: [e.userId],
      params: { name: e.names?.ar ?? "", end: e.probation?.end ?? "", recommend: `@hr_probation_rec.${input.recommend}` },
      link: hrLinks.person(id),
      employeeId: id,
    })
}

// ---------------------------------------------------------------------------
// A fixed-term contract's end (EX-01, the prototype's `ct` form)
// ---------------------------------------------------------------------------

/** Renew (the prototype's +2 years by default): the contract's end and its document date move together. */
export async function renewContract(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { until: string | null }): Promise<void> {
  assertHr(ctx, "exit.manage")
  if (ctx.employeeId === id && !ctx.owner) throw new HrWriteError("own_request")
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const blocks = contractBlocks(emp, "renew", input.until)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    tx.update(ref, { "contract.end": input.until, "docs.contract": input.until, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "contract_renewed", { from: emp.contract.end ?? null, to: input.until })
  })
}

/** Do not renew: the exit starts now, reason "contract end", the last day the contract's end. */
export async function endContract(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, opts: { today?: string } = {}): Promise<string> {
  assertHr(ctx, "exit.manage")
  let orgId = ""
  let lastDay = ""
  await runTransaction(firestore, async (tx) => {
    const { emp } = await readEmployee(tx, firestore, id)
    const blocks = contractBlocks(emp, "end", null)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    orgId = emp.organizationId
    lastDay = emp.contract.end as string
  })
  return startExit(firestore, ctx, orgId, actor, id, { reason: "contract_end", lastDay }, { today: opts.today })
}

// ---------------------------------------------------------------------------
// Document numbers (EM-01) — government relations or the HR manager, inside `docs`
// ---------------------------------------------------------------------------

export async function recordDocNumbers(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: DocNumbers): Promise<void> {
  assertHr(ctx, "documents.manage")
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const next: DocNumbers = { ...(emp.docs?.no ?? {}) }
    const changed: string[] = []
    for (const k of DOC_NUMBER_KEYS) {
      if (!(k in input)) continue
      const v = input[k]?.trim() || null
      if ((next[k] ?? null) !== v) changed.push(k)
      next[k] = v
    }
    if (!changed.length) throw new HrWriteError("blocked", ["no_change"])
    tx.update(ref, { "docs.no": next, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "numbers_recorded", { docs: changed.join(",") })
  })
}

// ---------------------------------------------------------------------------
// Pay change and promotion (EM-04) — never one's own (RL-02)
// ---------------------------------------------------------------------------

/** The months a pay change may reach back over, looking for the last closed one (a closed month is one whose
 * main payroll was approved). Further back than this is "too old" without a look. */
export const PAY_CHANGE_LOOKBACK_MONTHS = 12

/** The months from `from` to `to` inclusive, `YYYY-MM`. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to && out.length <= PAY_CHANGE_LOOKBACK_MONTHS + 1; m = addDays(monthRange(m).end, 1).slice(0, 7)) out.push(m)
  return out
}

/** The pay document after a change from `effectiveOn` (EM-04): its history gains the step, and the top-level
 * figures are the pay in force on `today` — a future-dated raise waits for its day, a back-dated one is in force. */
export function payWithStep(pay: EmployeePay | null, next: PayFacts, effectiveOn: string, today: string, meta: PayStepMeta = {}): { steps: Array<PayStep & PayStepMeta>; current: PayFacts } {
  const base: Array<PayStep & PayStepMeta> = pay?.steps?.length ? pay.steps : pay ? [{ from: "", basic: pay.basic, housing: pay.housing, transport: pay.transport }] : []
  const steps = [...base.filter((s) => s.from !== effectiveOn), { from: effectiveOn, ...next, ...meta }].sort((a, b) => a.from.localeCompare(b.from))
  const now = payOn({ ...next, steps }, today)
  return { steps, current: { basic: now.basic, housing: now.housing, transport: now.transport } }
}

export async function changePay(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { basic: number; effectiveOn: string; reason: string; kind: "raise" | "promotion" | "correction"; trade?: string | null },
  opts: { policies?: HrPolicies; today?: string; /** EM-04 — the raise request this change decides (approved with it). */ requestId?: string | null } = {}
): Promise<{ retro: number; retroMonth: string | null }> {
  // RL-02 — never one's own; the HR manager's own pay is management's (the guard's variant, read below).
  if (ctx.employeeId === id && !ctx.owner) throw new HrWriteError("own_request")
  if (!ctx.owner && !ctx.roles.has("manager") && !ctx.roles.has("management")) throw new HrWriteError("no_role")
  const day = opts.today ?? today()
  let retro = 0
  let retroMonth: string | null = null
  let request: HrRequest | null = null
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const isHrManager = ctx.owner || ctx.roles.has("manager") ? false : await employeeIsHrManager(tx, firestore, emp.organizationId, emp.userId)
    const refusal = payChangeRefusal(ctx, { own: ctx.employeeId === id || (Boolean(emp.userId) && emp.userId === ctx.uid), isHrManager })
    if (refusal) throw new HrWriteError(refusal)
    // Management changes the pay, not the record: a promotion's new trade is the HR manager's to write.
    if (!ctx.owner && !ctx.roles.has("manager") && input.trade && input.trade !== emp.trade) throw new HrWriteError("no_role")
    if (opts.requestId) {
      const rq = await tx.get(doc(firestore, HR_REQUESTS, opts.requestId))
      const r = rq.exists() ? ({ id: rq.id, ...(rq.data() as Omit<HrRequest, "id">) } as HrRequest) : null
      if (!r || r.kind !== "raise" || r.employeeId !== id || (r.state !== "pending" && r.state !== "endorsed")) throw new HrWriteError("blocked", ["stale"])
      const decider = mayDecideRequest(ctx, { employeeId: r.employeeId, isHrManager: r.deciderLevel === "management" || isHrManager })
      if (decider) throw new HrWriteError(decider)
      request = r
    }
    const pRef = doc(firestore, HR_PAY, id)
    const pSnap = await tx.get(pRef)
    const pay = pSnap.exists() ? (pSnap.data() as EmployeePay) : null
    const currentBasic = pay ? payOn(pay, day).basic : 0
    // The last closed month is read here, never taken from the screen: every main payroll from the effective
    // month to last month. A change may reach one closed month back (PY-04) — older is a documented manual decision.
    const effMonth = (input.effectiveOn || day).slice(0, 7)
    const lastMonth = addDays(`${day.slice(0, 7)}-01`, -1).slice(0, 7)
    const span = monthsBetween(effMonth, lastMonth)
    let lastClosed: string | null = null
    let lastClosedLines: PayrollLine[] = []
    if (span.length > PAY_CHANGE_LOOKBACK_MONTHS) lastClosed = lastMonth
    else
      for (const m of span) {
        const s = await tx.get(doc(firestore, HR_PAYROLLS, payrollId(emp.organizationId, m)))
        if (s.exists() && (s.data() as Payroll).state !== "prepared") {
          lastClosed = m
          lastClosedLines = (s.data() as Payroll).lines ?? []
        }
      }
    const { blocks } = payChangeBlocks({ basic: input.basic, currentBasic, effectiveOn: input.effectiveOn, reason: input.reason, nationality: emp.nationality, lastClosedMonthStart: lastClosed ? monthRange(lastClosed).start : null, trade: input.kind === "promotion" ? (input.trade ?? null) : null })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const next = payFromBasic(input.basic, opts.policies ?? DEFAULT_HR_POLICIES)
    const { steps, current } = payWithStep(pay, next, input.effectiveOn, day, { kind: input.kind, reason: input.reason.trim(), byName: actor.name })
    // An effective date inside the last closed month: that month's difference — what it would have paid
    // with the change, less what it paid — goes to a supplementary payroll; the closed month never reopens.
    // The months after it are open and compute with the new pay from its history.
    const retroItems = [...(pay?.retro ?? [])]
    if (pay && lastClosed && effMonth === lastClosed && lastClosedLines.some((l) => l.employeeId === id)) {
      const monthWage = (p: EmployeePay) => paySegments(p, emp.join, lastClosed as string, emp.lastDay).reduce((s, x) => s + (wageOf(x.pay) * x.days) / 30, 0)
      retro = r2(monthWage({ ...pay, steps }) - monthWage(pay))
      if (retro !== 0) {
        retroMonth = lastClosed
        retroItems.push({ id: `${input.effectiveOn}:${new Date().toISOString()}`, month: lastClosed, amount: retro, reason: input.reason.trim() })
      }
    }
    tx.set(pRef, { employeeId: id, organizationId: emp.organizationId, ...current, steps, retro: retroItems, updatedAt: serverTimestamp() }, { merge: true })
    if (input.trade && input.trade !== emp.trade && tradeOf(input.trade)) {
      tx.update(ref, { trade: input.trade, category: tradeOf(input.trade)!.category, updatedAt: serverTimestamp() })
    }
    // The log is read by roles that may not see pay and by the employee — it
    // names the change and its day, never an amount (RL-03); the figures live
    // on the pay document.
    log(tx, firestore, id, emp.organizationId, actor, input.kind === "promotion" ? "promoted" : "pay_changed", { on: input.effectiveOn, reason: input.reason.trim(), trade: input.kind === "promotion" ? input.trade ?? null : null })
    const r = request as HrRequest | null
    if (r) {
      const own = ctx.owner && ctx.employeeId === r.employeeId
      tx.update(doc(firestore, HR_REQUESTS, r.id), { state: "approved", decision: { by: actor.uid, byName: actor.name, at: new Date().toISOString(), note: input.reason.trim(), ownFlagged: own }, updatedAt: serverTimestamp() })
      log(tx, firestore, id, emp.organizationId, actor, "raise_approved", { no: r.no })
    }
  })
  const r = request as HrRequest | null
  if (r)
    await emitHrNotice(firestore, actor, {
      kind: "hr_request_decided",
      organizationId: r.organizationId,
      to: [{ users: [r.employeeUserId, r.filedBy?.by && r.filedBy.by !== r.employeeUserId ? r.filedBy.by : null] }],
      params: { no: r.no, req: "@hr_req_kind.raise", verdict: "@hr_verdict.approved", note: "" },
      link: hrLinks.me(),
      once: r.id,
      employeeId: r.employeeId,
    })
  return { retro, retroMonth }
}

/** RL-02 — is the person on this record an HR manager? (His own pay is then management's.) Read from HIS default
 * group, as the rules read it. */
async function employeeIsHrManager(tx: Transaction, firestore: Firestore, orgId: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const u = await tx.get(doc(firestore, "users", userId))
  if (!u.exists()) return false
  const user = { id: u.id, ...(u.data() as { organizationId?: string | null; organizationRole?: string | null; defaultGroupId?: string | null }) }
  const gid = typeof user.defaultGroupId === "string" && user.defaultGroupId ? user.defaultGroupId : null
  const g = gid ? await tx.get(doc(firestore, "teamGroups", gid)) : null
  return userIsHrManager(user, g?.exists() ? (g.data() as { organizationId?: string; permissions?: string[] }) : null, orgId)
}

// ---------------------------------------------------------------------------
// Commission (PY-01) — what Sales approved, paid with a month's payroll
// ---------------------------------------------------------------------------

export type CommissionBlock = "bad_amount" | "no_reason" | "bad_month" | "future_month"

/** Sales approves the commission (its reference is the reason); the HR manager records it against the month it is
 * paid with — never his own (RL-02). That month's payroll puts it on the line; once that payroll is approved, a
 * commission for it goes to its supplementary. The log names the month, never the amount (RL-03). */
export function commissionBlocks(input: { month: string; amount: number; reason: string }, today: string): CommissionBlock[] {
  const out: CommissionBlock[] = []
  if (!(input.amount > 0)) out.push("bad_amount")
  if (!input.reason.trim()) out.push("no_reason")
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) out.push("bad_month")
  else if (input.month > today.slice(0, 7)) out.push("future_month")
  return out
}

export async function recordCommission(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { month: string; amount: number; reason: string },
  opts: { today?: string } = {}
): Promise<string> {
  assertHr(ctx, "pay.change")
  if (ctx.employeeId === id && !ctx.owner) throw new HrWriteError("own_request")
  const day = opts.today ?? today()
  const blocks = commissionBlocks(input, day)
  if (blocks.length) throw new HrWriteError("blocked", blocks)
  const itemId = `${input.month}:${new Date().toISOString()}`
  await runTransaction(firestore, async (tx) => {
    const { emp } = await readEmployee(tx, firestore, id)
    const pRef = doc(firestore, HR_PAY, id)
    const pSnap = await tx.get(pRef)
    if (!pSnap.exists()) throw new HrWriteError("blocked", ["no_wage"])
    const pay = pSnap.data() as EmployeePay
    const item = { id: itemId, month: input.month, amount: r2(input.amount), reason: input.reason.trim(), at: new Date().toISOString(), by: actor.uid }
    tx.update(pRef, { commissions: [...(pay.commissions ?? []), item], updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "commission_recorded", { month: input.month, reason: input.reason.trim() })
  })
  return itemId
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
  ext: { to?: string | null; consentOn?: string | null; lastDay?: string | null } = {},
  opts: { today?: string } = {}
): Promise<void> {
  assertHr(ctx, "request.decide")
  // RL-02 — nobody decides his own probation; the owner, who answers to nobody, may (flagged on the record).
  if (ctx.employeeId === id && !ctx.owner) throw new HrWriteError("own_request")
  const ownFlagged = ctx.employeeId === id
  const day = opts.today ?? today()
  if (decision === "end") {
    // "End" IS an exit (WF-11 → WF-16): reason "probation" — no gratuity, no notice — and
    // Inventory asked to clear the custody. startExit records the probation decision with it.
    let orgId = ""
    await runTransaction(firestore, async (tx) => {
      const { emp } = await readEmployee(tx, firestore, id)
      const blocks = probationBlocks(emp, decision, ext, day)
      if (blocks.length) throw new HrWriteError("blocked", blocks)
      orgId = emp.organizationId
    })
    await startExit(firestore, ctx, orgId, actor, id, { reason: "probation", lastDay: ext.lastDay ?? null }, { today: day })
    return
  }
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const blocks = probationBlocks(emp, decision, ext, day)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const probation =
      decision === "extend"
        ? { ...emp.probation, end: ext.to as string, consentOn: ext.consentOn ?? null }
        : { ...emp.probation, decision: "confirmed" as const, decidedOn: day }
    tx.update(ref, { probation: ownFlagged ? { ...probation, ownFlagged: true } : probation, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, `probation_${decision}`, { to: ext.to ?? null, consent: ext.consentOn ?? null, ...(ownFlagged ? { ownFlagged: 1 } : {}) })
  })
}

// ---------------------------------------------------------------------------
// Attachments (EM-07) — the file is uploaded first; this names it on the record
// ---------------------------------------------------------------------------

export async function attachEmployeeFile(
  firestore: Firestore,
  ctx: HrContext,
  id: string,
  actor: HrActor,
  input: { kind: AttachmentKind; name: string; size: number; contentType: string; path: string; note?: string | null }
): Promise<string> {
  assertHr(ctx, "documents.manage")
  const ref = doc(collection(firestore, HR_EMPLOYEES, id, HR_FILES))
  await runTransaction(firestore, async (tx) => {
    const { emp } = await readEmployee(tx, firestore, id)
    const blocks = attachmentBlocks(input, { orgId: emp.organizationId, employeeId: id })
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const entry: Omit<EmployeeFile, "id"> = {
      organizationId: emp.organizationId,
      employeeId: id,
      kind: input.kind,
      name: input.name,
      path: input.path,
      size: input.size,
      contentType: input.contentType,
      by: actor.uid,
      byName: actor.name,
      at: new Date().toISOString(),
      note: input.note?.trim() || null,
    }
    tx.set(ref, entry)
    log(tx, firestore, id, emp.organizationId, actor, "file_attached", { type: input.kind, name: input.name })
  })
  return ref.id
}

// ---------------------------------------------------------------------------
// Opening balance from the card (IM-04, WF-02 step 6)
// ---------------------------------------------------------------------------

/** The HR manager enters, once, one employee's leave balance as of today and his outstanding
 * advance — the import's opening balances for someone who came in by hand. The balance then
 * reads back exactly that; the gratuity is never typed (it is computed from the join day). */
export async function recordOpeningBalance(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { leave: number; advance: number }, opts: { today?: string } = {}): Promise<void> {
  assertHr(ctx, "employee.edit")
  const day = opts.today ?? today()
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const pRef = doc(firestore, HR_PAY, id)
    const pSnap = await tx.get(pRef)
    const pay = pSnap.exists() ? (pSnap.data() as EmployeePay) : null
    const blocks = openingBlocks(emp, input, pay, day)
    if (input.advance > 0 && !(pay && pay.basic > 0)) blocks.push("bad_advance")
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    tx.update(ref, { openingLeave: openingFor(emp.join, day, input.leave, emp.leaveTaken ?? 0), opening: { leave: input.leave, at: new Date().toISOString(), by: actor.uid, byName: actor.name }, updatedAt: serverTimestamp() })
    if (input.advance > 0 && pay) tx.update(pRef, { advance: { amount: input.advance, balance: input.advance, instalment: advanceInstalment(wageOf(pay)) }, updatedAt: serverTimestamp() })
    // The log is read by roles without pay: it says an advance was entered, never how much.
    log(tx, firestore, id, emp.organizationId, actor, "opening_recorded", { leave: input.leave, advance: input.advance > 0 ? 1 : 0 })
  })
}

// ---------------------------------------------------------------------------
// The start (employee states: expected → active)
// ---------------------------------------------------------------------------

export type StartBlock = "not_expected" | "no_date" | "future"

/** An expected joiner (a visa arrival, a future start) starts work: the record turns active
 * on the day he actually started — which is his join day from then on (the probation, the
 * iqama clock and pro-rata pay run from it). The list already reads him at work from his
 * planned day (`statusOn`); this writes the fact and its day to the record and the log. */
export async function startWork(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { on: string | null }, opts: { today?: string } = {}): Promise<void> {
  assertHr(ctx, "employee.assign")
  const day = opts.today ?? today()
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const blocks: StartBlock[] = []
    if (emp.status !== "expected") blocks.push("not_expected")
    if (!input.on) blocks.push("no_date")
    else if (input.on > day) blocks.push("future")
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const on = input.on as string
    const patch: UpdateData<DocumentData> = { status: "active", join: on, updatedAt: serverTimestamp() }
    if (!emp.probation?.decision) patch.probation = { ...emp.probation, end: probationEnd(on), consentOn: null }
    tx.update(ref, patch)
    log(tx, firestore, id, emp.organizationId, actor, "started", { on })
  })
}

// ---------------------------------------------------------------------------
// Documents — a renewal (DC-03)
// ---------------------------------------------------------------------------

/** `hr:PR:DOC:<no>:<document>:<new expiry>` — a renewal's fee as a payment request to Finance (DC-03, HR-Pipeline
 * §2.1 `hr:PR:<type>:<number>`): one per renewal, never sent twice (a renewal to the same expiry is refused). */
export const feeEventKey = (no: number, type: DocType, expiry: string) => `hr:PR:DOC:${no}:${type}:${expiry}`

/** A renewal or a first issue (DC-03, the prototype's `doc` form): the new expiry (and the document's number when
 * given) — the iqama renewed with the medical insurance for the same term when ticked (its condition). A contract
 * is never "renewed" here: its end is the HR manager's decision (`renewContract`), and writing the document date
 * alone would leave `contract.end` behind. */
export async function recordRenewal(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { type: DocType; expiry: string; fee?: number | null; number?: string | null; insuranceToo?: boolean }): Promise<void> {
  assertHr(ctx, "documents.manage")
  if (input.type === "contract") throw new HrWriteError("blocked", ["contract"])
  const fee = r2(input.fee ?? 0)
  if (!(fee >= 0)) throw new HrWriteError("blocked", ["bad_fee"])
  let lapsed: { orgId: string; name: string; siteId: string | null } | null = null
  await runTransaction(firestore, async (tx) => {
    const { ref, emp } = await readEmployee(tx, firestore, id)
    const blocks = renewalBlocks(emp.docs ?? {}, input.type, input.expiry, today())
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    // DC-03 — an expired iqama renewed: the HR manager may assign him again (the prototype's notice).
    const was = emp.docs?.iqama
    if (input.type === "iqama" && was && was < today() && emp.status !== "left") lapsed = { orgId: emp.organizationId, name: emp.names?.ar ?? "", siteId: emp.siteId ?? null }
    const patch: UpdateData<DocumentData> = { [`docs.${input.type}`]: input.expiry, updatedAt: serverTimestamp() }
    const numberKey = input.type === "passport" || input.type === "insurance" || input.type === "licence" ? input.type : null
    if (numberKey && input.number?.trim()) patch["docs.no"] = { ...(emp.docs?.no ?? {}), [numberKey]: input.number.trim() }
    if (input.type === "iqama" && input.insuranceToo && (!emp.docs?.insurance || emp.docs.insurance < input.expiry)) patch["docs.insurance"] = input.expiry
    tx.update(ref, patch)
    log(tx, firestore, id, emp.organizationId, actor, "renewed", { doc: input.type, from: emp.docs?.[input.type] ?? null, to: input.expiry, fee: input.fee ?? null })
    if (patch["docs.insurance"]) log(tx, firestore, id, emp.organizationId, actor, "renewed", { doc: "insurance", from: emp.docs?.insurance ?? null, to: input.expiry, fee: null })
    // The fee goes to Finance as a payment request (Dr government & recruitment fees, the prototype's 6110) —
    // HR records, Finance pays. Written blind at its fixed id: the rules let it be created once, never rewritten.
    if (fee > 0) {
      const key = feeEventKey(emp.no, input.type, input.expiry)
      tx.set(doc(firestore, HR_EVENTS, `${emp.organizationId}__${key}`), {
        organizationId: emp.organizationId,
        key,
        kind: "PR",
        prType: "doc",
        month: today().slice(0, 7),
        amount: fee,
        employeeId: id,
        employeeNo: emp.no,
        doc: input.type,
        expiry: input.expiry,
        siteId: emp.siteId ?? null,
        state: "sent",
        sent: { by: actor.uid, byName: actor.name, at: new Date().toISOString() },
        createdAt: serverTimestamp(),
      })
    }
  })
  const l = lapsed as { orgId: string; name: string; siteId: string | null } | null
  if (l)
    await emitHrNotice(firestore, actor, { kind: "hr_iqama_renewed", organizationId: l.orgId, to: [{ hr: "manager" }], params: { name: l.name, expiry: input.expiry }, link: hrLinks.person(id), once: `${id}_${input.expiry}`, employeeId: id })
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
    // One user, one record (EM-01): "My file" and the pay the rules open to him follow the ONE record naming
    // him — a second link would make which one he reads a matter of chance.
    if (userId && (await otherRecordsOf(firestore, emp.organizationId, userId, id)).length) throw new HrWriteError("blocked", ["user_linked"])
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
  let fixed: HrEmployee | null = null
  await runTransaction(firestore, async (tx) => {
    const { emp } = await readEmployee(tx, firestore, id)
    tx.update(doc(firestore, HR_PAY, id), { iban: clean, ibanState: "fixed", ibanFixedBy: actor.uid, updatedAt: serverTimestamp() })
    log(tx, firestore, id, emp.organizationId, actor, "iban_fixed", {})
    fixed = emp
  })
  const e = fixed as HrEmployee | null
  if (e) await emitHrNotice(firestore, actor, { kind: "hr_iban_to_approve", organizationId: e.organizationId, to: [{ hr: "manager" }], except: [e.userId], params: { name: e.names?.ar ?? "" }, link: hrLinks.person(id), employeeId: id })
}

export async function approveIban(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor): Promise<void> {
  assertHr(ctx, "iban.approve")
  // RL-02 — never the bank account of his own record; the owner excepted, flagged in the log.
  if (ctx.employeeId === id && !ctx.owner) throw new HrWriteError("own_request")
  let approved: HrEmployee | null = null
  await runTransaction(firestore, async (tx) => {
    const { emp } = await readEmployee(tx, firestore, id)
    if (emp.userId && emp.userId === ctx.uid && !ctx.owner) throw new HrWriteError("own_request")
    const p = await tx.get(doc(firestore, HR_PAY, id))
    const pay = p.exists() ? (p.data() as EmployeePay & { ibanFixedBy?: string }) : null
    if (pay?.ibanState !== "fixed") throw new HrWriteError("blocked", ["stale"])
    if (pay.ibanFixedBy === actor.uid && !ctx.owner) throw new HrWriteError("own_request")
    tx.update(doc(firestore, HR_PAY, id), { ibanState: "ok", updatedAt: serverTimestamp() })
    const own = ctx.employeeId === id || emp.userId === ctx.uid
    log(tx, firestore, id, emp.organizationId, actor, "iban_approved", own ? { ownFlagged: 1 } : {})
    approved = emp
  })
  // Finance pays the held line now (PY-03).
  const e = approved as HrEmployee | null
  if (e) await emitHrNotice(firestore, actor, { kind: "hr_iban_approved", organizationId: e.organizationId, to: [{ finance: true }], except: [e.userId], params: { name: e.names?.ar ?? "" }, link: hrLinks.financeDesk(), employeeId: id })
}

// HR 1.0 — end of service writes (WF-16; EX-01…06, RL-02). The HR manager
// starts the exit — reason, last day, notice — and in the same act asks
// Inventory to clear the employee's custody (custody is Inventory's, EX-03);
// only Inventory's answer unlocks the settlement, which the HR manager
// approves as computed here from the record — never typed — and sends to
// Finance as hr:FS. Nobody ends his own service.

import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where, type Firestore, type Transaction } from "firebase/firestore"
import type { HrContext } from "./access"
import type { WorkplaceMonth } from "./attendance"
import { HR_EMPLOYEES, HR_EVENTS, HR_EXITS, HR_LETTERS, HR_PAY, HR_PAYROLLS, HR_SETTLEMENTS } from "./collections"
import type { EmployeePay, HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import { exitBlocks, exitId, settlementQuote, type ExitReason, type ExitTask, type LastMonth, type Settlement } from "./eos"
import { leaveBalance, type Holiday } from "./leave"
import { payOn, wageOf } from "./pay"
import { employeeLine, payrollId, type Payroll, type PayrollLine } from "./payroll"
import { eventId } from "./payroll-writes"
import type { HrRequest } from "./requests"
import { costKindOf, type HrSite } from "./sites"
import { todayDay } from "./format"
import { addDays, monthRange } from "./statutory"
import type { HrViolation } from "./violations"
import { issueLetter } from "./letter-writes"
import type { HrLetter, LetterHead } from "./letters"
import { emitHrNotice, emitHrNotices, hrLinks } from "./notify"
import { assertHr, HrWriteError } from "./write-guard"

const stamp = (a: { uid: string; name: string | null }) => ({ by: a.uid, byName: a.name, at: new Date().toISOString() })

export interface HrExit {
  id: string
  organizationId: string
  employeeId: string
  employeeUserId: string | null
  employeeName: string
  no: number
  siteId: string | null
  reason: ExitReason
  noticeOn: string | null
  lastDay: string
  art77: boolean
  note?: string | null
  state: "leaving" | "settled" | "paid"
  started: { by: string; byName: string | null; at: string }
  custody: { state: "requested" | "cleared"; requestedAt: string; by?: string; byName?: string | null; at?: string; shortfall?: number | null; note?: string | null }
  tasks?: Partial<Record<ExitTask, { by: string; byName: string | null; at: string } | null>>
}

export interface HrSettlement extends Settlement {
  id: string
  organizationId: string
  employeeId: string
  employeeUserId: string | null
  no: number
  lastDay: string
  reason: ExitReason
  siteId: string | null
  costKind: ReturnType<typeof costKindOf>
  projectId: string | null
  /** Later months whose payroll had already paid him when the settlement was approved (a back-dated last day). */
  paidAfter?: string[]
  state: "approved" | "paid"
  approved: { by: string; byName: string | null; at: string }
}

function log(tx: Transaction, firestore: Firestore, emp: Pick<HrEmployee, "id" | "organizationId">, actor: HrActor, kind: string, params: Record<string, string | number | null>) {
  tx.set(doc(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG)), { organizationId: emp.organizationId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params, source: "hr" })
}

/** Start the exit (EX-01): the employee is "leaving" and Inventory is asked to clear his custody. */
export async function startExit(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  employeeId: string,
  input: { reason: ExitReason | null; lastDay: string | null; noticeOn?: string | null; art77?: boolean; note?: string | null },
  opts: { today?: string } = {}
): Promise<string> {
  assertHr(ctx, "exit.manage")
  if (ctx.employeeId === employeeId && !ctx.owner) throw new HrWriteError("own_request")
  const id = exitId(orgId, employeeId)
  let started: { name: string; userId: string | null } | null = null
  await runTransaction(firestore, async (tx) => {
    const es = await tx.get(doc(firestore, HR_EMPLOYEES, employeeId))
    if (!es.exists()) throw new HrWriteError("missing")
    const emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) }
    const blocks = exitBlocks(emp, { reason: input.reason, lastDay: input.lastDay })
    if ((await tx.get(doc(firestore, HR_EXITS, id))).exists() && !blocks.includes("left")) blocks.push("left")
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const now = new Date().toISOString()
    tx.set(doc(firestore, HR_EXITS, id), {
      organizationId: orgId,
      employeeId,
      employeeUserId: emp.userId ?? null,
      employeeName: emp.names?.ar ?? "",
      no: emp.no,
      siteId: emp.siteId ?? null,
      reason: input.reason,
      noticeOn: input.noticeOn || null,
      lastDay: input.lastDay,
      art77: Boolean(input.art77),
      note: input.note?.trim() || null,
      state: "leaving",
      started: stamp(actor),
      custody: { state: "requested", requestedAt: now },
      tasks: {},
      updatedAt: serverTimestamp(),
    })
    // An exit during probation IS the probation decision "end" (EM-05) — recorded with it, either way it is started.
    const ended = input.reason === "probation" ? { probation: { ...emp.probation, decision: "ended", decidedOn: opts.today ?? todayDay() } } : {}
    tx.update(doc(firestore, HR_EMPLOYEES, employeeId), { status: "leaving", lastDay: input.lastDay, ...ended, updatedAt: serverTimestamp() })
    if (input.reason === "probation") log(tx, firestore, emp, actor, "probation_end", { lastDay: input.lastDay })
    log(tx, firestore, emp, actor, "exit_started", { reason: input.reason, lastDay: input.lastDay })
    started = { name: emp.names?.ar ?? "", userId: emp.userId ?? null }
  })
  // WF-16 — Inventory clears the custody (nothing settles before it); government relations has the platform tasks.
  const s = started as { name: string; userId: string | null } | null
  if (s) {
    const base = { organizationId: orgId, except: [s.userId], params: { name: s.name, lastDay: input.lastDay ?? "" }, once: id, employeeId }
    await emitHrNotices(firestore, actor, [
      { ...base, kind: "hr_custody_requested", to: [{ inventory: true }], link: hrLinks.custody() },
      { ...base, kind: "hr_exit_started", to: [{ hr: "gov" }], link: hrLinks.person(employeeId) },
    ])
  }
  return id
}

/** Inventory clears the custody (EX-03) — with the value of anything missing, deducted in the settlement. */
export async function clearCustody(firestore: Firestore, actor: { uid: string; name: string | null; allowed: boolean }, id: string, input: { shortfall?: number | null; note?: string | null }): Promise<void> {
  if (!actor.allowed) throw new HrWriteError("no_role")
  if (input.shortfall != null && !(input.shortfall >= 0)) throw new HrWriteError("blocked", ["bad_amount"])
  let cleared: HrExit | null = null
  await runTransaction(firestore, async (tx) => {
    const s = await tx.get(doc(firestore, HR_EXITS, id))
    if (!s.exists()) throw new HrWriteError("missing")
    const x = s.data() as HrExit
    if (x.custody?.state !== "requested") throw new HrWriteError("blocked", ["stale"])
    tx.update(doc(firestore, HR_EXITS, id), {
      custody: { ...x.custody, state: "cleared", ...stamp(actor), shortfall: input.shortfall ?? null, note: input.note?.trim() || null },
      updatedAt: serverTimestamp(),
    })
    cleared = { ...x, id }
  })
  // The settlement is the HR manager's to prepare now (WF-16 step 3) — never the shortfall's value in the notice.
  const x = cleared as HrExit | null
  if (x)
    await emitHrNotice(firestore, actor, {
      kind: "hr_custody_cleared",
      organizationId: x.organizationId,
      to: [{ hr: "manager" }],
      except: [x.employeeUserId],
      params: { name: x.employeeName },
      link: hrLinks.person(x.employeeId),
      once: id,
      employeeId: x.employeeId,
    })
}

/** The facts the last month is computed from — the screen reads them, the write is handed the same. */
export interface LastMonthFacts {
  sites: HrSite[]
  /** The month's workplace records, closed or not — what is recorded up to the last day counts. */
  attendance: WorkplaceMonth[]
  requests: HrRequest[]
  violations: HrViolation[]
  holidays?: Holiday[]
}

/** EX-04 — the month of the last day as a payroll line up to it (join date, the month's attendance, sick and
 * unpaid days, penalties, GOSI), with no advance instalment — the settlement takes the whole balance. Null when
 * that month's payroll already carried his line: a month is never paid twice. */
export function settlementLastMonth(
  emp: HrEmployee,
  pay: EmployeePay,
  lastDay: string,
  f: LastMonthFacts & { previous?: PayrollLine[] | null; paidMain?: Pick<Payroll, "state" | "lines"> | null }
): LastMonth | null {
  if (f.paidMain && f.paidMain.state !== "prepared" && f.paidMain.lines.some((l) => l.employeeId === emp.id)) return null
  const month = lastDay.slice(0, 7)
  const l = employeeLine(emp, pay, { month, sites: f.sites, counted: f.attendance.filter((a) => a.month === month), requests: f.requests, previous: f.previous, holidays: f.holidays, violations: f.violations, lastDay, noAdvance: true })
  return { days: l.days, net: l.net, gosiEmployee: l.gosiEmployee, gosiEmployer: l.gosiEmployer, penalties: l.penalties, cost: l.cost }
}

/** Riyadh's day (§17), as every HR write reads it. */
const localDay = () => todayDay()

/** Approve the settlement (EX-02, EX-04): computed here; the employee leaves; hr:FS goes to Finance. */
export async function approveSettlement(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  id: string,
  input: { ticket?: number; head?: LetterHead | null } & LastMonthFacts,
  opts: { today?: string } = {}
): Promise<Settlement> {
  assertHr(ctx, "exit.manage")
  const today = opts.today ?? localDay()
  let out: Settlement | null = null
  // EX-05 — the service certificate (art. 64) is issued with the settlement, as the prototype does: one already
  // asked for is issued; one already issued is not issued twice; else it is filed here, in the same act.
  const exp = await existingExperienceLetters(firestore, orgId, id)
  const letterRef = exp.issued || exp.pending ? null : doc(collection(firestore, HR_LETTERS))
  let leaver: { id: string; name: string; userId: string | null; lastDay: string } | null = null
  await runTransaction(firestore, async (tx) => {
    const xs = await tx.get(doc(firestore, HR_EXITS, id))
    if (!xs.exists()) throw new HrWriteError("missing")
    const x = { id: xs.id, ...(xs.data() as Omit<HrExit, "id">) }
    if (ctx.employeeId === x.employeeId && !ctx.owner) throw new HrWriteError("own_request")
    if (x.state !== "leaving") throw new HrWriteError("blocked", ["stale"])
    if (x.custody?.state !== "cleared") throw new HrWriteError("blocked", ["custody"])
    const es = await tx.get(doc(firestore, HR_EMPLOYEES, x.employeeId))
    const emp = { id: es.id, ...(es.data() as Omit<HrEmployee, "id">) }
    const ps = await tx.get(doc(firestore, HR_PAY, x.employeeId))
    const raw = ps.exists() ? (ps.data() as EmployeePay) : null
    const pay = raw ? payOn(raw, x.lastDay) : null
    if (!raw || !pay || !(wageOf(pay) > 0)) throw new HrWriteError("blocked", ["no_wage"])
    const evRef = doc(firestore, HR_EVENTS, eventId(orgId, `hr:FS:${x.no}`))
    if ((await tx.get(evRef)).exists()) throw new HrWriteError("blocked", ["sent"])
    // EX-04 — the last day's month, unless its payroll already paid him; last month's line carries the sick days.
    const month = x.lastDay.slice(0, 7)
    const mainSnap = await tx.get(doc(firestore, HR_PAYROLLS, payrollId(orgId, month)))
    const prevSnap = await tx.get(doc(firestore, HR_PAYROLLS, payrollId(orgId, addDays(`${month}-01`, -1).slice(0, 7))))
    const lastMonth = settlementLastMonth(emp, raw, x.lastDay, {
      ...input,
      paidMain: mainSnap.exists() ? (mainSnap.data() as Payroll) : null,
      previous: prevSnap.exists() ? ((prevSnap.data() as Payroll).lines ?? null) : null,
    })
    // A back-dated last day: payrolls of later months that already paid him are named on the settlement (they are
    // recovered by a documented decision, never silently).
    const paidAfter: string[] = []
    for (let m = addDays(monthRange(month).end, 1).slice(0, 7), n = 0; m < today.slice(0, 7) && n < 12; m = addDays(monthRange(m).end, 1).slice(0, 7), n++) {
      const s = await tx.get(doc(firestore, HR_PAYROLLS, payrollId(orgId, m)))
      if (s.exists() && (s.data() as Payroll).state !== "prepared" && ((s.data() as Payroll).lines ?? []).some((l) => l.employeeId === x.employeeId)) paidAfter.push(m)
    }
    const q = settlementQuote(
      {
        wage: wageOf(pay),
        join: emp.join,
        lastDay: x.lastDay,
        reason: x.reason,
        leaveTaken: emp.leaveTaken ?? 0,
        openingLeave: emp.openingLeave ?? 0,
        art77: x.art77,
        contract: emp.contract ?? null,
        ticket: input.ticket ?? 0,
        advanceBalance: raw.advance?.balance ?? 0,
        custodyShortfall: x.custody.shortfall ?? 0,
        lastMonth,
      },
      leaveBalance
    )
    const site = input.sites.find((s) => s.id === x.siteId)
    const by = stamp(actor)
    const settlement = {
      ...q,
      organizationId: orgId,
      employeeId: x.employeeId,
      employeeUserId: x.employeeUserId,
      no: x.no,
      lastDay: x.lastDay,
      reason: x.reason,
      siteId: x.siteId,
      costKind: x.siteId && site ? costKindOf(site.type) : "admin",
      projectId: site?.type === "project" ? (site.projectId ?? null) : null,
      paidAfter,
      state: "approved",
      approved: by,
    }
    tx.set(doc(firestore, HR_SETTLEMENTS, id), { ...settlement, updatedAt: serverTimestamp() })
    tx.set(evRef, { organizationId: orgId, key: `hr:FS:${x.no}`, kind: "FS", month: x.lastDay.slice(0, 7), settlementId: id, state: "sent", sent: by, net: q.net, createdAt: serverTimestamp() })
    tx.update(doc(firestore, HR_EXITS, id), { state: "settled", settled: by, updatedAt: serverTimestamp() })
    tx.update(doc(firestore, HR_EMPLOYEES, x.employeeId), { status: "left", updatedAt: serverTimestamp() })
    if (pay.advance) tx.update(doc(firestore, HR_PAY, x.employeeId), { advance: null, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "settlement_approved", { lastDay: x.lastDay })
    if (letterRef) {
      const letter: Omit<HrLetter, "id"> = {
        organizationId: orgId,
        kind: "exp",
        title: null,
        purpose: null,
        addressee: "لمن يهمه الأمر",
        lang: "ar",
        employeeId: emp.id,
        employeeUserId: emp.userId ?? null,
        employeeName: emp.names?.ar ?? "",
        signerLevel: "manager",
        filedBy: { ...by, note: null },
        onBehalf: true,
        state: "pending",
        createdAt: by.at,
      }
      tx.set(letterRef, { ...letter, updatedAt: serverTimestamp() })
      log(tx, firestore, emp, actor, "letter_filed", { letter: "exp", addressee: letter.addressee })
    }
    leaver = { id: emp.id, name: emp.names?.ar ?? "", userId: emp.userId ?? null, lastDay: x.lastDay }
    out = q
  })
  const l = leaver as { id: string; name: string; userId: string | null; lastDay: string } | null
  if (l) {
    await emitHrNotice(firestore, actor, {
      kind: "hr_settlement_approved",
      organizationId: orgId,
      to: [{ finance: true }],
      except: [l.userId],
      params: { name: l.name, lastDay: l.lastDay },
      link: hrLinks.financeDesk(),
      once: id,
      employeeId: l.id,
    })
    // Signed in its own act: should that fail, the letter waits in the HR manager's queue to sign.
    const toIssue = letterRef?.id ?? exp.pending
    if (toIssue) await issueLetter(firestore, ctx, toIssue, actor, { head: input.head ?? { name: null, cr: null, mol: null } }, { today }).catch((err) => console.warn("experience certificate not issued:", err))
  }
  return out as unknown as Settlement
}

/** The leaver's experience certificates already on file — read beside the transaction (it cannot query). */
async function existingExperienceLetters(firestore: Firestore, orgId: string, exitDocId: string): Promise<{ issued: boolean; pending: string | null }> {
  const employeeId = exitDocId.startsWith(`${orgId}__`) ? exitDocId.slice(orgId.length + 2) : exitDocId
  const snap = await getDocs(query(collection(firestore, HR_LETTERS), where("organizationId", "==", orgId), where("employeeId", "==", employeeId), where("kind", "==", "exp"))).catch(() => null)
  const docs = (snap?.docs ?? []).map((d) => ({ id: d.id, state: (d.data() as HrLetter).state }))
  return { issued: docs.some((d) => d.state === "issued"), pending: docs.find((d) => d.state === "pending")?.id ?? null }
}

/** EX-06 — the platform tasks after the exit (government relations): GOSI exclusion, insurance, final exit. */
export async function setExitTask(firestore: Firestore, ctx: HrContext, actor: HrActor, id: string, task: ExitTask, done: boolean): Promise<void> {
  assertHr(ctx, "platform.tasks")
  await runTransaction(firestore, async (tx) => {
    const s = await tx.get(doc(firestore, HR_EXITS, id))
    if (!s.exists()) throw new HrWriteError("missing")
    tx.update(doc(firestore, HR_EXITS, id), { [`tasks.${task}`]: done ? stamp(actor) : null, updatedAt: serverTimestamp() })
  })
}

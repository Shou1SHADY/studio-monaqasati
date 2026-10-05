// HR 1.0 — request writes (WF-07, WF-08; LV-01…07, AD-01…04, RL-02). Each is
// one transaction that reads the employee (and his pay for an advance) again,
// computes the request again and refuses what the rule refuses — the numbers
// on screen are never trusted. The employee's log names what happened, never
// an amount (RL-03).

import { collection, deleteField, doc, runTransaction, serverTimestamp, type DocumentData, type Firestore, type Transaction, type UpdateData } from "firebase/firestore"
import { hrRefusal, mayDecideRequest, userIsHrManager, type HrContext } from "./access"
import { attachmentBlocks, HR_FILES, type EmployeeFile } from "./attachments"
import { attendanceId, monthOf, type WorkplaceMonth } from "./attendance"
import { HR_ATTENDANCE, HR_EMPLOYEES, HR_PAY, HR_REQUESTS, HR_SITES } from "./collections"
import type { PunchMonth, PunchSite } from "./punches"
import { fixPunch, writeFixPunch } from "./punch-writes"
import type { EmployeeShift } from "./shifts"
import { raiseRequestBlocks, type EmployeePay, type HrEmployee, type RaiseFields } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import type { Holiday } from "./leave"
import { LEAVE_RULES, type LeaveType } from "./leave"
import {
  advanceQuote,
  attfixApplyBlocks,
  attfixBlocks,
  dataBlocks,
  leaveQuote,
  mayCancel,
  mayDecideAttfix,
  ownCancellable,
  REQUEST_NUMBER_TYPE,
  sickUsedIn,
  type AttfixFields,
  type DataFields,
  type HrRequest,
  type HrRequestKind,
  type LeaveMode,
  type Stamp,
} from "./requests"
import { daysBetween, serviceYears, type HrPolicies } from "./statutory"
import { drawYearlyDocNumber } from "../sales-numbering"
import { todayDay } from "./format"
import { emitHrNotice, emitHrNotices, hrLinks, type HrNotice } from "./notify"
import { projectAttendance } from "./me-writes"
import { payOn } from "./pay"
import { HrWriteError } from "./write-guard"

const stamp = (actor: HrActor, note?: string | null): Stamp => ({ by: actor.uid, byName: actor.name, at: new Date().toISOString(), note: note?.trim() || null })

function log(tx: Transaction, firestore: Firestore, emp: Pick<HrEmployee, "id" | "organizationId">, actor: HrActor, kind: string, params: Record<string, string | number | null>) {
  tx.set(doc(collection(firestore, HR_EMPLOYEES, emp.id, HR_LOG)), { organizationId: emp.organizationId, at: new Date().toISOString(), by: actor.uid, byName: actor.name, kind, params, source: "hr" })
}

async function readEmp(tx: Transaction, firestore: Firestore, id: string): Promise<HrEmployee> {
  const snap = await tx.get(doc(firestore, HR_EMPLOYEES, id))
  if (!snap.exists()) throw new HrWriteError("missing")
  return { id: snap.id, ...(snap.data() as Omit<HrEmployee, "id">) }
}

/** RL-02 — is the EMPLOYEE (not whoever files or decides) an HR manager? His own then goes to management. */
async function employeeIsHrManager(tx: Transaction, firestore: Firestore, orgId: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const u = await tx.get(doc(firestore, "users", userId))
  if (!u.exists()) return false
  const user = { id: u.id, ...(u.data() as { organizationId?: string | null; organizationRole?: string | null; defaultGroupId?: string | null }) }
  const gid = typeof user.defaultGroupId === "string" && user.defaultGroupId ? user.defaultGroupId : null
  const g = gid ? await tx.get(doc(firestore, "teamGroups", gid)) : null
  return userIsHrManager(user, g?.exists() ? (g.data() as { organizationId?: string; permissions?: string[] }) : null, orgId)
}

async function readReq(tx: Transaction, firestore: Firestore, id: string): Promise<HrRequest> {
  const snap = await tx.get(doc(firestore, HR_REQUESTS, id))
  if (!snap.exists()) throw new HrWriteError("missing")
  return { id: snap.id, ...(snap.data() as Omit<HrRequest, "id">) }
}

export interface FileRequestInput {
  employeeId: string
  kind: HrRequestKind
  leave?: { type: LeaveType; from: string; to: string; note?: string | null }
  advance?: { amount: number; reason: string }
  data?: DataFields
  attfix?: AttfixFields
  raise?: RaiseFields
  /** The site's supervisor — the line manager (RL-04) — as the site names him. */
  supervisor?: { employeeId: string | null; userId: string | null } | null
}

type Opts = {
  policies: HrPolicies
  holidays?: readonly Holiday[]
  today?: string
  others?: Array<{ from: string; to: string }>
  pendingAdvance?: boolean
  leaveMode?: LeaveMode | null
  /** An attendance correction: the punch feature (miss/out exist only with it), and his own requests (cap, duplicates). */
  punch?: boolean
  mine?: HrRequest[]
}

/** The employee files his own (My file); the HR manager files on his behalf. */
export async function fileRequest(firestore: Firestore, ctx: HrContext, orgId: string, actor: HrActor, input: FileRequestInput, opts: Opts): Promise<{ id: string; no: string }> {
  const own = Boolean(ctx.employeeId) && ctx.employeeId === input.employeeId
  if (!own && !ctx.roles.has("manager")) throw new HrWriteError("no_role")
  const today = opts.today ?? todayDay()
  const ref = doc(collection(firestore, HR_REQUESTS))
  let no = ""
  let filed: HrRequest | null = null
  await runTransaction(firestore, async (tx) => {
    const emp = await readEmp(tx, firestore, input.employeeId)
    if (emp.organizationId !== orgId) throw new HrWriteError("missing")
    if (emp.status === "left") throw new HrWriteError("blocked", ["left"])
    const pay = input.kind === "advance" || input.kind === "raise" ? await tx.get(doc(firestore, HR_PAY, emp.id)) : null
    // LV-05, RL-02 — the level follows who the employee IS: an HR manager's own request goes to
    // management whoever files it (another HR manager filing for him included).
    const hrManagerEmployee = (own && ctx.roles.has("manager")) || (await employeeIsHrManager(tx, firestore, orgId, emp.userId))
    const base = {
      organizationId: orgId,
      kind: input.kind,
      employeeId: emp.id,
      employeeUserId: emp.userId ?? null,
      employeeName: emp.names?.ar ?? "",
      siteId: emp.siteId ?? null,
      lineManagerId: input.supervisor?.employeeId && input.supervisor.employeeId !== emp.id ? input.supervisor.employeeId : null,
      lineManagerUserId: input.supervisor?.userId && input.supervisor.userId !== emp.userId ? input.supervisor.userId : null,
      deciderLevel: (hrManagerEmployee ? "management" : "manager") as HrRequest["deciderLevel"],
      filedBy: stamp(actor),
      onBehalf: !own,
      state: "pending" as const,
      createdAt: new Date().toISOString(),
    }
    let body: Partial<HrRequest>
    if (input.kind === "leave") {
      const l = input.leave!
      // Above the balance and a lapsing document are said before sending, not refused — HR decides (LV-03, LV-04).
      const q = leaveQuote(emp, { type: l.type, from: l.from, to: l.to }, { holidays: opts.holidays, others: opts.others })
      if (q.blocks.length) throw new HrWriteError("blocked", q.blocks)
      body = { leave: { type: l.type, from: l.from, to: l.to, days: q.days, balance: q.balance, fromBalance: q.fromBalance, unpaidDays: q.unpaidDays, travel: q.travel, sick: q.sick, note: l.note?.trim() || null } }
    } else if (input.kind === "data") {
      const d = input.data!
      const blocks: string[] = dataBlocks(d)
      // EM-07 — the bank's document is stored under HIS folder, an image or a PDF.
      if (d.file) blocks.push(...attachmentBlocks({ kind: "bank", ...d.file }, { orgId, employeeId: emp.id }))
      if (blocks.length) throw new HrWriteError("blocked", blocks)
      const file = d.file ? { path: d.file.path, name: d.file.name, size: d.file.size, contentType: d.file.contentType } : null
      body = { data: { field: d.field, value: d.field === "iban" ? d.value.replace(/\s+/g, "").toUpperCase() : d.value.trim(), document: d.document?.trim() || file?.name || null, file } }
    } else if (input.kind === "attfix") {
      // PRD form 11 — decided by whoever keeps the sheet: the workplace's supervisor (the line manager there).
      const f = input.attfix!
      const blocks = attfixBlocks(f, { today, punch: Boolean(opts.punch), mine: opts.mine ?? [] })
      if (blocks.length) throw new HrWriteError("blocked", blocks)
      body = { attfix: { type: f.type, day: f.day, reason: f.reason.trim() } }
    } else if (input.kind === "raise") {
      // EM-04 — asked for (by the HR manager, on a line manager's word; or the employee himself); decided as a pay change.
      const x = input.raise!
      const stored = pay?.exists() ? (pay.data() as EmployeePay) : null
      const blocks = raiseRequestBlocks(x, { currentBasic: stored ? payOn(stored, today).basic : null, nationality: emp.nationality })
      if (blocks.length) throw new HrWriteError("blocked", blocks)
      body = { raise: { basic: x.basic, kind: x.kind, effectiveOn: x.effectiveOn, reason: x.reason.trim(), trade: x.kind === "promotion" ? (x.trade ?? null) : null } }
    } else {
      const a = input.advance!
      // The wage in force today — a raise dated in the past applies though the stored figures lag (EM-04).
      const stored = pay?.exists() ? (pay.data() as EmployeePay) : null
      const p = stored ? payOn(stored, today) : null
      const q = advanceQuote(p, a, { policies: opts.policies, today, contractEnd: emp.contract?.type === "fixed" ? emp.contract.end : null, pendingAdvance: opts.pendingAdvance })
      if (q.blocks.length) throw new HrWriteError("blocked", q.blocks)
      body = { advance: { amount: a.amount, reason: a.reason.trim(), instalment: q.instalment, months: q.months, overLimit: q.overLimit } }
    }
    no = await drawYearlyDocNumber(firestore, tx, orgId, REQUEST_NUMBER_TYPE[input.kind], Number(today.slice(0, 4)))
    tx.set(ref, { ...base, ...body, no, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, `${input.kind}_filed`, { no })
    filed = { id: ref.id, ...base, ...body, no } as HrRequest
  })
  if (filed) await tellFiled(firestore, actor, filed)
  return { id: ref.id, no }
}

const reqKind = (r: Pick<HrRequest, "kind">) => `@hr_req_kind.${r.kind}`

/** A request filed → whoever decides it (management on the HR manager's own) and, for a leave, the line
 * manager who endorses it first; an attendance correction → the supervisor who keeps the sheet, else the
 * HR manager. Never the employee himself, whoever filed it. */
async function tellFiled(firestore: Firestore, actor: HrActor, r: HrRequest) {
  await emitHrNotices(firestore, actor, [
    {
      kind: "hr_request_filed",
      organizationId: r.organizationId,
      to: [r.kind === "attfix" && r.lineManagerUserId ? { users: [r.lineManagerUserId] } : { hr: r.deciderLevel === "management" ? "management" : "manager" }],
      except: [r.employeeUserId],
      params: { name: r.employeeName, no: r.no, req: reqKind(r) },
      link: hrLinks.today(),
      once: r.id,
      employeeId: r.employeeId,
    },
    r.kind === "leave" && r.leave && r.lineManagerUserId
      ? {
          kind: "hr_leave_to_endorse",
          organizationId: r.organizationId,
          to: [{ users: [r.lineManagerUserId] }],
          except: [r.employeeUserId],
          params: { name: r.employeeName, no: r.no, from: r.leave.from, to: r.leave.to },
          link: hrLinks.today(),
          once: r.id,
          employeeId: r.employeeId,
        }
      : null,
  ])
}

/** A decision → the employee (My file) and whoever filed it for him (the record). */
function decidedNotice(r: HrRequest, verdict: "approved" | "declined", note: string | null | undefined): HrNotice {
  const filer = r.filedBy?.by && r.filedBy.by !== r.employeeUserId ? r.filedBy.by : null
  return {
    kind: "hr_request_decided",
    organizationId: r.organizationId,
    to: [{ users: [r.employeeUserId, filer] }],
    params: { no: r.no, req: reqKind(r), verdict: `@hr_verdict.${verdict}`, note: note?.trim() || "" },
    link: hrLinks.me(),
    links: filer ? { [filer]: hrLinks.person(r.employeeId) } : undefined,
    once: r.id,
    employeeId: r.employeeId,
  }
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
  const today = opts.today ?? todayDay()
  const first = await runTransaction(firestore, async (tx) => readReq(tx, firestore, id))
  if (first.kind === "attfix") return decideAttfix(firestore, ctx, id, actor, verdict, note, today)
  let state: HrRequest["state"] = "declined"
  let decided: HrRequest | null = null
  let abroad = false
  let ibanBack = false
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    decided = r
    // The stored level, or the employee's own standing now — a request filed when the level
    // followed the filer (or before he became HR manager) is never decided by a peer (RL-02).
    const isHrManager = r.deciderLevel === "management" || (await employeeIsHrManager(tx, firestore, r.organizationId, r.employeeUserId))
    const refusal = mayDecideRequest(ctx, { employeeId: r.employeeId, isHrManager })
    if (refusal) throw new HrWriteError(refusal)
    if (r.state !== "pending" && r.state !== "endorsed") throw new HrWriteError("blocked", ["stale"])
    const emp = await readEmp(tx, firestore, r.employeeId)
    const payRef = doc(firestore, HR_PAY, r.employeeId)
    const paySnap = r.kind === "advance" ? await tx.get(payRef) : null
    const reqRef = doc(firestore, HR_REQUESTS, id)
    const decision = { ...stamp(actor, note), ownFlagged: ctx.owner && ctx.employeeId === r.employeeId }
    if (verdict === "approve" && r.kind === "raise") throw new HrWriteError("blocked", ["raise_via_pay"])
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
      if (d.field === "iban") {
        const before = await tx.get(doc(firestore, HR_PAY, r.employeeId))
        // A returned transfer (PY-03): his own IBAN, checked against the bank's document and approved by the HR
        // manager — two hands — makes the held line payable again; Finance is told.
        ibanBack = before.exists() && (before.data() as EmployeePay).ibanState === "returned"
        tx.set(doc(firestore, HR_PAY, r.employeeId), { employeeId: r.employeeId, organizationId: r.organizationId, iban: d.value, ibanState: "ok", updatedAt: serverTimestamp() }, { merge: true })
        // EM-07 — the bank's document joins the record's attachments (the HR manager files them; management cannot).
        if (d.file && ctx.roles.has("manager")) {
          const entry: Omit<EmployeeFile, "id"> = {
            organizationId: r.organizationId,
            employeeId: r.employeeId,
            kind: "bank",
            name: d.file.name,
            path: d.file.path,
            size: d.file.size,
            contentType: d.file.contentType,
            by: actor.uid,
            byName: actor.name,
            at: new Date().toISOString(),
            note: r.no,
          }
          if (!attachmentBlocks(entry, { orgId: r.organizationId, employeeId: r.employeeId }).length) tx.set(doc(collection(firestore, HR_EMPLOYEES, r.employeeId, HR_FILES)), entry)
        }
      } else tx.update(doc(firestore, HR_EMPLOYEES, r.employeeId), { [`contact.${d.field}`]: d.value, updatedAt: serverTimestamp() })
      tx.update(reqRef, { state: "approved", decision, updatedAt: serverTimestamp() })
      log(tx, firestore, emp, actor, "data_updated", { no: r.no, field: d.field })
      state = "approved"
      return
    }
    if (r.kind === "leave") {
      const l = r.leave!
      // LV-03 — above the balance HR chooses: balance only, or the excess unpaid. A request filed
      // before the choice moved to HR carried "excess unpaid" from the form; it keeps it.
      const mode = opts.leaveMode ?? (l.unpaidDays > 0 && LEAVE_RULES[l.type].fromBalance ? "excess_unpaid" : null)
      // LV-04 — and no leave is approved for travel while a document would lapse abroad (blocks here).
      const q = leaveQuote(emp, { type: l.type, from: l.from, to: l.to, mode }, { holidays: opts.holidays, deciding: true })
      if (q.blocks.length) throw new HrWriteError("blocked", q.blocks)
      const patch: UpdateData<DocumentData> = { updatedAt: serverTimestamp() }
      if (q.fromBalance) patch.leaveTaken = (emp.leaveTaken ?? 0) + q.fromBalance
      if (l.type === "sick") patch.sick = { year: Math.floor(serviceYears(emp.join, l.from)), days: sickUsedIn(emp, l.from) + q.days }
      if (l.type === "hajj") patch.hajjTaken = true
      tx.update(doc(firestore, HR_EMPLOYEES, emp.id), patch)
      tx.update(reqRef, {
        state: "approved",
        decision,
        leave: {
          ...l,
          to: q.to,
          requestedTo: q.to !== l.to ? l.to : (l.requestedTo ?? null),
          mode: q.to !== l.to || q.unpaidDays > 0 ? mode : null,
          days: q.days,
          balance: q.balance,
          fromBalance: q.fromBalance,
          unpaidDays: q.unpaidDays,
          travel: q.travel,
          sick: q.sick,
        },
        updatedAt: serverTimestamp(),
      })
      log(tx, firestore, emp, actor, "leave_approved", { no: r.no, from: l.from, to: q.to })
      // A non-Saudi's leave is travel (LV-04) — but not a sick leave, nor Hajj, which is made inside the Kingdom.
      abroad = Boolean(q.travel) && emp.nationality !== "sa" && l.type !== "sick" && l.type !== "hajj"
      state = "approved"
      return
    }
    const a = r.advance!
    const stored = paySnap?.exists() ? (paySnap.data() as EmployeePay) : null
    const pay = stored ? payOn(stored, today) : null
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
  const r = decided as HrRequest | null
  if (r) {
    const s = state as HrRequest["state"]
    await emitHrNotices(firestore, actor, [
      s === "approved" &&
        ibanBack && { kind: "hr_iban_approved", organizationId: r.organizationId, to: [{ finance: true }], except: [r.employeeUserId], params: { name: r.employeeName }, link: hrLinks.financeDesk(), employeeId: r.employeeId },
      s === "finance"
        ? {
            kind: "hr_advance_to_finance",
            organizationId: r.organizationId,
            to: [{ finance: true }],
            except: [r.employeeUserId],
            params: { name: r.employeeName, no: r.no },
            link: hrLinks.financeDesk(),
            once: r.id,
            employeeId: r.employeeId,
          }
        : decidedNotice(r, s === "approved" ? "approved" : "declined", note),
      // A leave abroad for a non-Saudi: government relations issues the exit re-entry visa before he travels.
      s === "approved" &&
        abroad &&
        r.leave && {
          kind: "hr_exit_reentry",
          organizationId: r.organizationId,
          to: [{ hr: "gov" }],
          params: { name: r.employeeName, from: r.leave.from },
          link: hrLinks.person(r.employeeId),
          once: r.id,
          employeeId: r.employeeId,
        },
    ])
  }
  return { state }
}

/** Finance decides an advance HR sent up (AD-03). `financeAllowed` = the owner, invoices.manage or accounting.post. */
export async function financeDecideAdvance(firestore: Firestore, actor: HrActor & { employeeId?: string | null }, financeAllowed: boolean, id: string, verdict: "approve" | "decline", note: string): Promise<void> {
  if (!financeAllowed) throw new HrWriteError("no_role")
  let decided: HrRequest | null = null
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    if (r.kind !== "advance" || r.state !== "finance") throw new HrWriteError("blocked", ["stale"])
    decided = r
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
  if (decided) await emitHrNotice(firestore, actor, decidedNotice(decided, verdict === "approve" ? "approved" : "declined", note))
}

export type ReturnBlock = "stale" | "no_date" | "future" | "before_end"

/** AT-05 — the return from a leave ("started today"), recorded once by the workplace's supervisor
 * or the HR manager. Days between the leave's end and the return are counted late — absence
 * without leave, which the sheet has been marking absent until now (art. 80 runs on them). */
export async function recordReturn(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, input: { on: string | null }, opts: { today?: string } = {}): Promise<{ lateDays: number }> {
  const today = opts.today ?? todayDay()
  let lateDays = 0
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    if (r.kind !== "leave" || r.state !== "approved" || !r.leave || r.returned) throw new HrWriteError("blocked", ["stale"])
    // A supervisor answers for his own workplaces — never for someone unassigned.
    const refusal = hrRefusal(ctx, "leave.return", { site: r.siteId }) ?? (!r.siteId && !ctx.roles.has("manager") ? "not_your_site" : null)
    if (refusal) throw new HrWriteError(refusal)
    const blocks: ReturnBlock[] = []
    if (!input.on) blocks.push("no_date")
    else if (input.on > today) blocks.push("future")
    else if (input.on <= r.leave.to) blocks.push("before_end")
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    const on = input.on as string
    lateDays = Math.max(0, daysBetween(r.leave.to, on) - 1)
    const emp = await readEmp(tx, firestore, r.employeeId)
    tx.update(doc(firestore, HR_REQUESTS, id), { returned: { on, by: actor.uid, byName: actor.name, at: new Date().toISOString(), lateDays }, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "leave_returned", { no: r.no, on, late: lateDays })
  })
  return { lateDays }
}

/** Cancel a request that has not started (LV-07): an approved leave gives its days back. */
export async function cancelRequest(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, note: string, opts: { today?: string } = {}): Promise<void> {
  const today = opts.today ?? todayDay()
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    if (!mayCancel(ctx, r, today)) throw new HrWriteError("no_role")
    const emp = await readEmp(tx, firestore, r.employeeId)
    const own = Boolean(ctx.employeeId) && ctx.employeeId === r.employeeId && !ctx.roles.has("manager")
    if (r.state === "approved" && r.leave && own) {
      // LV-07 — he withdraws his own approved leave before it starts: exactly its days come back, and the record
      // names the request they came back for (the rules hold the two against each other).
      if (!ownCancellable(r.leave.type)) throw new HrWriteError("no_role")
      if (r.leave.fromBalance) tx.update(doc(firestore, HR_EMPLOYEES, emp.id), { leaveTaken: (emp.leaveTaken ?? 0) - r.leave.fromBalance, undo: r.id, updatedAt: serverTimestamp() })
    } else if (r.state === "approved" && r.leave) {
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

/** PRD form 11 — the supervisor who keeps the sheet (or the HR manager) decides an attendance correction. An
 * approved "marked absent but present" takes the absence off that day's sheet in the same transaction; a closed
 * month never reopens, and a day that does not show him absent has nothing to correct. A decline needs its reason. */
async function decideAttfix(firestore: Firestore, ctx: HrContext, id: string, actor: HrActor, verdict: "approve" | "decline", note: string, today: string): Promise<{ state: HrRequest["state"] }> {
  let decided: HrRequest | null = null
  let after: WorkplaceMonth | null = null
  await runTransaction(firestore, async (tx) => {
    const r = await readReq(tx, firestore, id)
    if (r.kind !== "attfix" || !r.attfix || (r.state !== "pending" && r.state !== "endorsed")) throw new HrWriteError("blocked", ["stale"])
    if (ctx.employeeId && ctx.employeeId === r.employeeId && !ctx.owner) throw new HrWriteError("own_request")
    if (!mayDecideAttfix(ctx, r)) throw new HrWriteError("no_role")
    const f = r.attfix
    const wmRef = doc(firestore, HR_ATTENDANCE, attendanceId(r.organizationId, r.siteId ?? "-", monthOf(f.day)))
    const snap = verdict === "approve" && r.siteId ? await tx.get(wmRef) : null
    const emp = await readEmp(tx, firestore, r.employeeId)
    // PT-07 (optional: punch) — a forgotten punch, or one outside the fence on duty, puts a corrected punch on the day.
    const siteSnap = verdict === "approve" && r.siteId && f.type !== "abs" ? await tx.get(doc(firestore, HR_SITES, r.siteId)) : null
    const reqRef = doc(firestore, HR_REQUESTS, id)
    const decision = { ...stamp(actor, note), ownFlagged: ctx.owner && ctx.employeeId === r.employeeId }
    decided = r
    if (verdict === "decline") {
      if (!note.trim()) throw new HrWriteError("blocked", ["no_reason"])
      tx.update(reqRef, { state: "declined", decision, updatedAt: serverTimestamp() })
      log(tx, firestore, emp, actor, "attfix_declined", { no: r.no })
      return
    }
    const wm = snap?.exists() ? ({ id: snap.id, ...(snap.data() as Omit<WorkplaceMonth, "id">) } as WorkplaceMonth) : null
    const blocks = attfixApplyBlocks(wm, r.employeeId, f)
    if (blocks.length) throw new HrWriteError("blocked", blocks)
    if (wm && f.type === "abs") {
      const rest = { ...(wm.days[f.day].ex[r.employeeId] ?? {}) }
      delete rest.status
      const kept = Object.keys(rest).length ? rest : null
      // A recorded day is locked; the rules let this one entry change because the write names the
      // correction it approves (`fixReq`) — see hrAttfixOk in firestore.rules.
      tx.update(wmRef, { [`days.${f.day}.ex.${r.employeeId}`]: kept ?? deleteField(), fixReq: id, updatedAt: serverTimestamp() })
      const ex = { ...wm.days[f.day].ex }
      if (kept) ex[r.employeeId] = kept
      else delete ex[r.employeeId]
      after = { ...wm, days: { ...wm.days, [f.day]: { ...wm.days[f.day], ex } } }
    }
    if (r.siteId && (f.type === "miss" || f.type === "out")) {
      const rec = fixPunch(wm as (WorkplaceMonth & PunchMonth) | null, siteSnap?.exists() ? ({ id: siteSnap.id, ...siteSnap.data() } as PunchSite) : null, emp as HrEmployee & { shift?: EmployeeShift | null }, f.day, f.type)
      if (rec) writeFixPunch(tx, firestore, wm as PunchMonth | null, r.organizationId, r.siteId, f.day, r.employeeId, rec)
    }
    tx.update(reqRef, { state: "approved", decision, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "attfix_approved", { no: r.no, day: f.day })
  })
  const r = decided as HrRequest | null
  const fixed = after as WorkplaceMonth | null
  const approved = verdict === "approve"
  if (r && fixed) await projectAttendance(firestore, fixed, [r.employeeId], { day: r.attfix?.day ?? null, today })
  if (r) await emitHrNotice(firestore, actor, decidedNotice(r, approved ? "approved" : "declined", note))
  return { state: approved ? "approved" : "declined" }
}

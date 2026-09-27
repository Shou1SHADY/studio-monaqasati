// HR 1.0 — end of service writes (WF-16; EX-01…06, RL-02). The HR manager
// starts the exit — reason, last day, notice — and in the same act asks
// Inventory to clear the employee's custody (custody is Inventory's, EX-03);
// only Inventory's answer unlocks the settlement, which the HR manager
// approves as computed here from the record — never typed — and sends to
// Finance as hr:FS. Nobody ends his own service.

import { collection, doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import type { HrContext } from "./access"
import { HR_EMPLOYEES, HR_EVENTS, HR_EXITS, HR_PAY, HR_SETTLEMENTS } from "./collections"
import type { EmployeePay, HrEmployee } from "./employee"
import { HR_LOG, type HrActor } from "./employee-writes"
import { exitBlocks, exitId, settlementQuote, type ExitReason, type ExitTask, type Settlement } from "./eos"
import { leaveBalance } from "./leave"
import { wageOf } from "./pay"
import { eventId } from "./payroll-writes"
import { costKindOf, type HrSite } from "./sites"
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
  input: { reason: ExitReason | null; lastDay: string | null; noticeOn?: string | null; art77?: boolean; note?: string | null }
): Promise<string> {
  assertHr(ctx, "exit.manage")
  if (ctx.employeeId === employeeId && !ctx.owner) throw new HrWriteError("own_request")
  const id = exitId(orgId, employeeId)
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
    tx.update(doc(firestore, HR_EMPLOYEES, employeeId), { status: "leaving", lastDay: input.lastDay, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "exit_started", { reason: input.reason, lastDay: input.lastDay })
  })
  return id
}

/** Inventory clears the custody (EX-03) — with the value of anything missing, deducted in the settlement. */
export async function clearCustody(firestore: Firestore, actor: { uid: string; name: string | null; allowed: boolean }, id: string, input: { shortfall?: number | null; note?: string | null }): Promise<void> {
  if (!actor.allowed) throw new HrWriteError("no_role")
  if (input.shortfall != null && !(input.shortfall >= 0)) throw new HrWriteError("blocked", ["bad_amount"])
  await runTransaction(firestore, async (tx) => {
    const s = await tx.get(doc(firestore, HR_EXITS, id))
    if (!s.exists()) throw new HrWriteError("missing")
    const x = s.data() as HrExit
    if (x.custody?.state !== "requested") throw new HrWriteError("blocked", ["stale"])
    tx.update(doc(firestore, HR_EXITS, id), {
      custody: { ...x.custody, state: "cleared", ...stamp(actor), shortfall: input.shortfall ?? null, note: input.note?.trim() || null },
      updatedAt: serverTimestamp(),
    })
  })
}

/** Approve the settlement (EX-02, EX-04): computed here; the employee leaves; hr:FS goes to Finance. */
export async function approveSettlement(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  actor: HrActor,
  id: string,
  input: { ticket?: number; fixedRemainingMonths?: number | null; sites: HrSite[] }
): Promise<Settlement> {
  assertHr(ctx, "exit.manage")
  let out: Settlement | null = null
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
    const pay = ps.exists() ? (ps.data() as EmployeePay) : null
    if (!pay || !(wageOf(pay) > 0)) throw new HrWriteError("blocked", ["no_wage"])
    const evRef = doc(firestore, HR_EVENTS, eventId(orgId, `hr:FS:${x.no}`))
    if ((await tx.get(evRef)).exists()) throw new HrWriteError("blocked", ["sent"])
    const q = settlementQuote(
      {
        wage: wageOf(pay),
        join: emp.join,
        lastDay: x.lastDay,
        reason: x.reason,
        leaveTaken: emp.leaveTaken ?? 0,
        openingLeave: emp.openingLeave ?? 0,
        art77: x.art77,
        fixedRemainingMonths: input.fixedRemainingMonths ?? null,
        ticket: input.ticket ?? 0,
        advanceBalance: pay.advance?.balance ?? 0,
        custodyShortfall: x.custody.shortfall ?? 0,
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
      state: "approved",
      approved: by,
    }
    tx.set(doc(firestore, HR_SETTLEMENTS, id), { ...settlement, updatedAt: serverTimestamp() })
    tx.set(evRef, { organizationId: orgId, key: `hr:FS:${x.no}`, kind: "FS", month: x.lastDay.slice(0, 7), settlementId: id, state: "sent", sent: by, net: q.net, createdAt: serverTimestamp() })
    tx.update(doc(firestore, HR_EXITS, id), { state: "settled", settled: by, updatedAt: serverTimestamp() })
    tx.update(doc(firestore, HR_EMPLOYEES, x.employeeId), { status: "left", updatedAt: serverTimestamp() })
    if (pay.advance) tx.update(doc(firestore, HR_PAY, x.employeeId), { advance: null, updatedAt: serverTimestamp() })
    log(tx, firestore, emp, actor, "settlement_approved", { lastDay: x.lastDay })
    out = q
  })
  return out as unknown as Settlement
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

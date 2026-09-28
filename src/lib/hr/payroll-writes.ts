// HR 1.0 — payroll writes (WF-06; PY-02…05, RL-02, §7.2). Prepare re-reads
// every workplace's closing inside the transaction; approve is the HR
// manager's — never the preparer's — and in the same transaction sends the
// events to the outbox under their fixed keys (an event is never sent twice),
// takes the advance instalments off the balances and clears the retro items
// the supplementary paid. Finance posts and pays from the outbox.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { mayApprovePayroll, type HrContext } from "./access"
import { attendanceId, type WorkplaceMonth } from "./attendance"
import { HR_ATTENDANCE, HR_EVENTS, HR_PAY, HR_PAYROLLS } from "./collections"
import type { EmployeePay } from "./employee"
import type { HrActor } from "./employee-writes"
import { eosEvent, payEvent, payrollId, payrollTotals, supplementaryKey, type Payroll, type PayrollLine, type Stamp, type SupplementaryLine } from "./payroll"
import { monthRange, r2 } from "./statutory"
import { assertHr, HrWriteError } from "./write-guard"

const localToday = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const stamp = (a: HrActor): Stamp => ({ by: a.uid, byName: a.name, at: new Date().toISOString() })

/** `hrEvents/{orgId}__{key}` — the outbox Finance reads. */
export const eventId = (orgId: string, key: string) => `${orgId}__${key}`

/** Save the computed main payroll (PY-05). Recomputing replaces it until it is approved. */
export async function preparePayroll(
  firestore: Firestore,
  ctx: HrContext,
  orgId: string,
  month: string,
  actor: HrActor,
  input: { lines: PayrollLine[]; sitesToClose: string[]; missingPay: string[] },
  opts: { today?: string } = {}
): Promise<void> {
  assertHr(ctx, "payroll.prepare")
  const today = opts.today ?? localToday()
  if (today <= monthRange(month).end) throw new HrWriteError("blocked", ["not_over"])
  if (input.missingPay.length) throw new HrWriteError("blocked", ["no_pay"])
  const ref = doc(firestore, HR_PAYROLLS, payrollId(orgId, month))
  await runTransaction(firestore, async (tx) => {
    const cur = await tx.get(ref)
    if (cur.exists() && (cur.data() as Payroll).state !== "prepared") throw new HrWriteError("blocked", ["approved"])
    // PY-02 — every workplace closed, read again here.
    for (const siteId of input.sitesToClose) {
      const a = await tx.get(doc(firestore, HR_ATTENDANCE, attendanceId(orgId, siteId, month)))
      if (!a.exists() || !(a.data() as WorkplaceMonth).closed) throw new HrWriteError("blocked", ["unclosed"])
    }
    tx.set(ref, {
      organizationId: orgId,
      month,
      key: month,
      kind: "main",
      state: "prepared",
      lines: input.lines,
      totals: payrollTotals(input.lines),
      prepared: stamp(actor),
      approved: null,
      updatedAt: serverTimestamp(),
    })
  })
}

/** The supplementary "-D" (PY-04): only after the main payroll is approved; retro items only. */
export async function prepareSupplementary(firestore: Firestore, ctx: HrContext, orgId: string, month: string, actor: HrActor, lines: SupplementaryLine[]): Promise<void> {
  assertHr(ctx, "payroll.prepare")
  if (!lines.length) throw new HrWriteError("blocked", ["no_lines"])
  const key = supplementaryKey(month)
  const ref = doc(firestore, HR_PAYROLLS, payrollId(orgId, key))
  await runTransaction(firestore, async (tx) => {
    const main = await tx.get(doc(firestore, HR_PAYROLLS, payrollId(orgId, month)))
    if (!main.exists() || (main.data() as Payroll).state === "prepared") throw new HrWriteError("blocked", ["main_not_approved"])
    const cur = await tx.get(ref)
    if (cur.exists() && (cur.data() as Payroll).state !== "prepared") throw new HrWriteError("blocked", ["approved"])
    tx.set(ref, {
      organizationId: orgId,
      month,
      key,
      kind: "supplementary",
      state: "prepared",
      lines: [],
      supplementary: lines,
      totals: { people: lines.length, net: r2(lines.reduce((s, l) => s + l.net, 0)) },
      prepared: stamp(actor),
      approved: null,
      updatedAt: serverTimestamp(),
    })
  })
}

/** Approve (PY-05, RL-02): the HR manager who did not prepare it. Sends hr:PAY (and hr:EOS for the main). */
export async function approvePayroll(firestore: Firestore, ctx: HrContext, orgId: string, key: string, actor: HrActor): Promise<void> {
  assertHr(ctx, "payroll.approve")
  const ref = doc(firestore, HR_PAYROLLS, payrollId(orgId, key))
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new HrWriteError("missing")
    const p = { id: snap.id, ...(snap.data() as Omit<Payroll, "id">) }
    if (p.state !== "prepared") throw new HrWriteError("blocked", ["approved"])
    if (!ctx.owner && !mayApprovePayroll(ctx, p.prepared.by)) throw new HrWriteError("own_request")
    const pay = payEvent(p)
    const eos = p.kind === "main" ? eosEvent(p) : null
    const payRef = doc(firestore, HR_EVENTS, eventId(orgId, pay.key))
    const eosRef = eos ? doc(firestore, HR_EVENTS, eventId(orgId, eos.key)) : null
    // Never sent twice.
    if ((await tx.get(payRef)).exists() || (eosRef && (await tx.get(eosRef)).exists())) throw new HrWriteError("blocked", ["sent"])
    // Reads before writes: the pay documents this approval changes.
    const touched = p.kind === "main" ? p.lines.filter((l) => l.advance > 0).map((l) => l.employeeId) : (p.supplementary ?? []).map((l) => l.employeeId)
    const pays = new Map<string, EmployeePay>()
    for (const id of touched) {
      const s = await tx.get(doc(firestore, HR_PAY, id))
      if (s.exists()) pays.set(id, s.data() as EmployeePay)
    }
    const by = stamp(actor)
    tx.update(ref, { state: "approved", approved: by, ownFlagged: ctx.uid === p.prepared.by, updatedAt: serverTimestamp() })
    const base = { organizationId: orgId, month: p.month, payrollId: p.id, payrollKey: p.key, state: "sent", sent: by, createdAt: serverTimestamp() }
    tx.set(payRef, { ...base, kind: "PAY", ...pay })
    if (eos && eosRef) tx.set(eosRef, { ...base, kind: "EOS", ...eos })
    if (p.kind === "main") {
      for (const l of p.lines) {
        const cur = pays.get(l.employeeId)?.advance
        if (!cur || l.advance <= 0) continue
        const balance = r2(Math.max(0, cur.balance - l.advance))
        tx.update(doc(firestore, HR_PAY, l.employeeId), { advance: balance > 0 ? { ...cur, balance } : null, updatedAt: serverTimestamp() })
      }
    } else {
      for (const [id, pr] of pays) tx.update(doc(firestore, HR_PAY, id), { retro: (pr.retro ?? []).filter((x) => x.month !== p.month), updatedAt: serverTimestamp() })
    }
  })
}

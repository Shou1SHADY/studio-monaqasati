// HR 1.0 — Finance's side of payroll (PRD §7.2–7.4, WF-06 steps 5–7, AD-03).
// HR computes, approves and notifies; Finance posts and pays. Each act writes
// its ledger entry and its state change in ONE batch, so a posted event always
// has its entry and never a second one (entry ids are deterministic and the
// journal is append-only). With Accounting off, the payment is still recorded —
// the books simply have nothing to receive.

import { doc, getDoc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore"
import { postToLedger } from "../accounting/post"
import { postHrAdvance, postHrEos, postHrPay, postHrPayPayment, postHrPayReturn, postHrSettlement, type HrCostRow, type PostingResult } from "../accounting/posting-rules"
import { HR_EVENTS, HR_EXITS, HR_PAY, HR_PAYROLLS, HR_REQUESTS, HR_SETTLEMENTS } from "./collections"
import type { EmployeePay } from "./employee"
import type { HrSettlement } from "./exit-writes"
import { payrollId, payrollTotals, type Payroll } from "./payroll"
import { eventId } from "./payroll-writes"
import type { HrRequest } from "./requests"
import { monthRange, r2 } from "./statutory"
import { HrWriteError } from "./write-guard"

export interface FinanceActor {
  uid: string
  name: string | null
  /** The owner, invoices.manage or accounting.post. */
  allowed: boolean
  employeeId?: string | null
}

export interface HrEvent {
  id: string
  organizationId: string
  key: string
  kind: "PAY" | "EOS"
  month: string
  payrollKey: string
  state: "sent" | "posted" | "paid"
  debit: HrCostRow[]
  credit: Record<string, number>
  held?: number
  entryId?: string | null
}

type Books = { accountingOn: boolean; date: string; bankAccount?: string }

const stamp = (a: FinanceActor) => ({ by: a.uid, byName: a.name, at: new Date().toISOString() })

function need(a: FinanceActor) {
  if (!a.allowed) throw new HrWriteError("no_role")
}

async function book(firestore: Firestore, a: FinanceActor, orgId: string, result: PostingResult, books: Books, batch: ReturnType<typeof writeBatch>) {
  if (!books.accountingOn) return null
  return postToLedger(firestore, { organizationId: orgId, userId: a.uid, userName: a.name ?? "" }, result, { batch })
}

/** Post hr:PAY / hr:EOS to the books, dated the month's last day (the cost belongs to the month worked). */
export async function postHrEvent(firestore: Firestore, a: FinanceActor, orgId: string, ev: HrEvent, books: Pick<Books, "accountingOn">): Promise<void> {
  need(a)
  const cur = await getDoc(doc(firestore, HR_EVENTS, ev.id))
  if (!cur.exists() || (cur.data() as HrEvent).state !== "sent") throw new HrWriteError("blocked", ["stale"])
  const date = monthRange(ev.month).end
  const result =
    ev.kind === "PAY"
      ? postHrPay({ key: ev.key, month: ev.month, date, debit: ev.debit, credit: ev.credit as { salariesPayable: number; gosi: number; advances: number; fines: number } })
      : postHrEos({ key: ev.key, month: ev.month, date, debit: ev.debit, credit: ev.credit as { eosProvision: number; leaveProvision: number } })
  const batch = writeBatch(firestore)
  const entryId = await book(firestore, a, orgId, result, { ...books, date }, batch)
  const by = stamp(a)
  batch.update(doc(firestore, HR_EVENTS, ev.id), { state: "posted", posted: by, entryId: entryId ?? null, updatedAt: serverTimestamp() })
  if (ev.kind === "PAY") batch.update(doc(firestore, HR_PAYROLLS, payrollId(orgId, ev.payrollKey)), { state: "posted", posted: { ...by, entry: entryId ?? null }, updatedAt: serverTimestamp() })
  await batch.commit()
}

/** The amount transferred: net less the held lines, which wait in salaries payable. */
export function transferAmount(p: Payroll): number {
  if (p.kind === "supplementary") return r2((p.supplementary ?? []).filter((l) => !l.held).reduce((s, l) => s + l.net, 0))
  const t = payrollTotals(p.lines)
  return r2(t.net - t.heldNet)
}

/** fin:PAID — salaries transferred. Payslips open and the Mudad window starts. */
export async function recordPayrollPaid(firestore: Firestore, a: FinanceActor, orgId: string, p: Payroll, books: Books): Promise<void> {
  need(a)
  if (p.state !== "posted" && !(p.state === "approved" && !books.accountingOn)) throw new HrWriteError("blocked", ["not_posted"])
  const batch = writeBatch(firestore)
  const amount = transferAmount(p)
  await book(firestore, a, orgId, postHrPayPayment({ sourceId: p.key, date: books.date, amount, bankAccount: books.bankAccount, description: `سداد رواتب ${p.key}` }), books, batch)
  const by = stamp(a)
  batch.update(doc(firestore, HR_PAYROLLS, p.id), { state: "paid", paid: { ...by, date: books.date }, updatedAt: serverTimestamp() })
  batch.update(doc(firestore, HR_EVENTS, eventId(orgId, `hr:PAY:${p.key}`)), { state: "paid", paid: { ...by, date: books.date }, updatedAt: serverTimestamp() })
  await batch.commit()
}

type LineRef = { employeeId: string; no: number; net: number; held: boolean }

function lineOf(p: Payroll, employeeId: string): LineRef | null {
  const l = p.kind === "supplementary" ? p.supplementary?.find((x) => x.employeeId === employeeId) : p.lines.find((x) => x.employeeId === employeeId)
  return l ? { employeeId: l.employeeId, no: l.no, net: l.net, held: l.held } : null
}

/** fin:RETURNED — the bank sent a transfer back: the money is owed again and the IBAN goes to payroll to fix. */
export async function markReturned(firestore: Firestore, a: FinanceActor, orgId: string, p: Payroll & { returned?: Record<string, unknown> }, employeeId: string, reason: string, books: Books): Promise<void> {
  need(a)
  const l = lineOf(p, employeeId)
  if (!l || p.state !== "paid" || l.held || p.returned?.[employeeId]) throw new HrWriteError("blocked", ["stale"])
  if (!reason.trim()) throw new HrWriteError("blocked", ["no_reason"])
  const batch = writeBatch(firestore)
  await book(firestore, a, orgId, postHrPayReturn({ sourceId: `${p.key}:${l.no}`, date: books.date, amount: l.net, bankAccount: books.bankAccount, description: `حوالة رواتب مرتجعة ${p.key}` }), books, batch)
  batch.update(doc(firestore, HR_PAYROLLS, p.id), { [`returned.${employeeId}`]: { ...stamp(a), reason: reason.trim(), date: books.date }, updatedAt: serverTimestamp() })
  batch.update(doc(firestore, HR_PAY, employeeId), { ibanState: "returned", updatedAt: serverTimestamp() })
  await batch.commit()
}

/** A held or returned line, paid once the HR manager approved the IBAN. */
export async function payHeldLine(firestore: Firestore, a: FinanceActor, orgId: string, p: Payroll & { returned?: Record<string, unknown>; paidHeld?: Record<string, unknown> }, employeeId: string, books: Books): Promise<void> {
  need(a)
  const l = lineOf(p, employeeId)
  if (!l || p.state !== "paid" || !(l.held || p.returned?.[employeeId]) || p.paidHeld?.[employeeId]) throw new HrWriteError("blocked", ["stale"])
  const pay = await getDoc(doc(firestore, HR_PAY, employeeId))
  const pr = pay.exists() ? (pay.data() as EmployeePay) : null
  if (!pr?.iban || pr.ibanState === "returned" || pr.ibanState === "fixed") throw new HrWriteError("blocked", ["iban_not_ready"])
  const batch = writeBatch(firestore)
  await book(firestore, a, orgId, postHrPayPayment({ sourceId: `${p.key}:held:${l.no}`, date: books.date, amount: l.net, bankAccount: books.bankAccount, description: `سداد راتب موقوف ${p.key}` }), books, batch)
  batch.update(doc(firestore, HR_PAYROLLS, p.id), { [`paidHeld.${employeeId}`]: { ...stamp(a), date: books.date }, updatedAt: serverTimestamp() })
  await batch.commit()
}

/** Pay out an approved advance (hr:PR → fin:PRPAID): payroll takes it back in instalments. */
export async function payAdvance(firestore: Firestore, a: FinanceActor, orgId: string, r: HrRequest & { payout?: unknown }, books: Books): Promise<void> {
  need(a)
  if (r.kind !== "advance" || r.state !== "approved" || r.payout || !r.advance) throw new HrWriteError("blocked", ["stale"])
  if (a.employeeId && a.employeeId === r.employeeId) throw new HrWriteError("own_request")
  const batch = writeBatch(firestore)
  await book(firestore, a, orgId, postHrAdvance({ requestId: r.id, requestNo: r.no, date: books.date, amount: r.advance.amount, bankAccount: books.bankAccount }), books, batch)
  batch.update(doc(firestore, HR_REQUESTS, r.id), { payout: { ...stamp(a), date: books.date }, updatedAt: serverTimestamp() })
  await batch.commit()
}

/** Pay the final settlement (hr:FS → fin:PRPAID): the exit closes. */
export async function paySettlement(firestore: Firestore, a: FinanceActor, orgId: string, st: HrSettlement, books: Books): Promise<void> {
  need(a)
  if (st.state !== "approved") throw new HrWriteError("blocked", ["stale"])
  if (a.employeeId && a.employeeId === st.employeeId) throw new HrWriteError("own_request")
  const batch = writeBatch(firestore)
  const entryId = await book(
    firestore,
    a,
    orgId,
    postHrSettlement({
      settlementId: st.id,
      no: st.no,
      date: books.date,
      costKind: st.costKind,
      siteId: st.siteId,
      projectId: st.projectId,
      gratuity: st.gratuity,
      leaveCash: st.leaveCash,
      wages: r2(st.lastPay + st.noticePay + st.art77 + st.ticket),
      advance: st.advance,
      custody: st.custody,
      net: st.net,
      bankAccount: books.bankAccount,
    }),
    books,
    batch
  )
  const by = { ...stamp(a), date: books.date }
  batch.update(doc(firestore, HR_SETTLEMENTS, st.id), { state: "paid", paid: by, entryId: entryId ?? null, updatedAt: serverTimestamp() })
  batch.update(doc(firestore, HR_EXITS, st.id), { state: "paid", paid: by, updatedAt: serverTimestamp() })
  batch.update(doc(firestore, HR_EVENTS, eventId(orgId, `hr:FS:${st.no}`)), { state: "paid", paid: by, entryId: entryId ?? null, updatedAt: serverTimestamp() })
  await batch.commit()
}

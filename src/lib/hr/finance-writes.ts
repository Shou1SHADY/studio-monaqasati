// HR 1.0 — Finance's side of payroll (PRD §7.2–7.4, WF-06 steps 5–7, AD-03).
// HR computes, approves and notifies; Finance posts and pays. Each act writes
// its ledger entry and its state change in ONE batch, so a posted event always
// has its entry and never a second one (entry ids are deterministic and the
// journal is append-only). With Accounting off, the payment is still recorded —
// the books simply have nothing to receive.

import { doc, getDoc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore"
import { postToLedger } from "../accounting/post"
import { postHrAdvance, postHrEos, postHrFee, postHrPay, postHrPayPayment, postHrPayReturn, postHrSettlement, type HrCostRow, type PostingResult } from "../accounting/posting-rules"
import { HR_EVENTS, HR_EXITS, HR_PAY, HR_PAYROLLS, HR_PAYSLIPS, HR_REQUESTS, HR_SETTLEMENTS } from "./collections"
import type { EmployeePay } from "./employee"
import type { HrSettlement } from "./exit-writes"
import { payrollId, payrollTotals, type Payroll, type PayrollLine, type SupplementaryLine } from "./payroll"
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

/** The day an event is posted on: the month's last day for the month's payroll and accruals (the cost belongs
 * to the month worked); a supplementary on the day Finance posts it — it arrives after the month was closed,
 * and the closed month's entry is never reopened (HR-Pipeline §2.1), so it never lands in a locked period. */
export function eventPostingDate(ev: Pick<HrEvent, "kind" | "month" | "payrollKey">, postedOn: string): string {
  const supplementary = ev.kind === "PAY" && ev.payrollKey !== ev.month
  return supplementary ? postedOn : monthRange(ev.month).end
}

const localDay = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** Post hr:PAY / hr:EOS to the books (dated by `eventPostingDate`). */
export async function postHrEvent(firestore: Firestore, a: FinanceActor, orgId: string, ev: HrEvent, books: Pick<Books, "accountingOn"> & { date?: string }): Promise<void> {
  need(a)
  const cur = await getDoc(doc(firestore, HR_EVENTS, ev.id))
  if (!cur.exists() || (cur.data() as HrEvent).state !== "sent") throw new HrWriteError("blocked", ["stale"])
  const date = eventPostingDate(ev, books.date ?? localDay())
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

/** `hrPayslips/{payrollDocId}__{employeeId}` — one per paid line, the employee's to read (ES-04). */
export const payslipId = (payrollDocId: string, employeeId: string) => `${payrollDocId}__${employeeId}`

type AnyLine = PayrollLine | SupplementaryLine

/** Payslips open when the money leaves (fin:PAID): written after the payment, in chunks, best-effort —
 * a failure is logged and the next payment of the line writes it again. */
async function writePayslips(firestore: Firestore, orgId: string, p: Payroll, lines: AnyLine[], paidOn: string) {
  for (let i = 0; i < lines.length; i += 400) {
    const batch = writeBatch(firestore)
    for (const l of lines.slice(i, i + 400)) {
      batch.set(doc(firestore, HR_PAYSLIPS, payslipId(p.id, l.employeeId)), {
        organizationId: orgId,
        payrollId: p.id,
        key: p.key,
        month: p.month,
        kind: p.kind,
        employeeId: l.employeeId,
        employeeUserId: l.userId ?? null,
        line: l,
        paidOn,
        createdAt: serverTimestamp(),
      })
    }
    try {
      await batch.commit()
    } catch (err) {
      console.error("Payslips not written:", p.key, err)
    }
  }
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
  const lines: AnyLine[] = p.kind === "supplementary" ? (p.supplementary ?? []) : p.lines
  await writePayslips(firestore, orgId, p, lines.filter((l) => !l.held), books.date)
}

/** A payroll as Finance's desk reads it: with the transfers the bank returned and the held lines paid since. */
export type FinancePayroll = Payroll & { returned?: Record<string, { reason?: string } | unknown>; paidHeld?: Record<string, unknown> }

const linesOf = (p: Payroll): AnyLine[] => (p.kind === "supplementary" ? (p.supplementary ?? []) : p.lines)

/** PY-03 — every line still owed after its payroll was paid — held at approval or returned by the bank, and not
 * paid since — on EVERY paid payroll, however old (a held line never drops out of view), oldest first. */
export function owedLines(payrolls: FinancePayroll[]): Array<{ p: FinancePayroll; employeeId: string; no: number; name: string; net: number; reason: string | null }> {
  return payrolls
    .filter((p) => p.state === "paid")
    .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }))
    .flatMap((p) =>
      linesOf(p)
        .filter((l) => (l.held || p.returned?.[l.employeeId]) && !p.paidHeld?.[l.employeeId])
        .map((l) => {
          const r = p.returned?.[l.employeeId] as { reason?: string } | undefined
          return { p, employeeId: l.employeeId, no: l.no, name: l.name, net: l.net, reason: r?.reason ?? null }
        })
    )
}

/** fin:RETURNED can come for any paid payroll — a main one or a supplementary, this month's or older: the lines
 * that were transferred and not already returned. */
export function returnableLines(p: FinancePayroll): AnyLine[] {
  return p.state === "paid" ? linesOf(p).filter((l) => !l.held && !p.returned?.[l.employeeId]) : []
}

type LineRef = { employeeId: string; no: number; net: number; held: boolean; pos: number }

function lineOf(p: Payroll, employeeId: string): LineRef | null {
  const lines = linesOf(p)
  const i = lines.findIndex((x) => x.employeeId === employeeId)
  const l = i >= 0 ? lines[i] : null
  return l ? { employeeId: l.employeeId, no: l.no, net: l.net, held: l.held, pos: i + 1 } : null
}

/** The journal's reference for ONE line — a returned transfer, a held line paid later. The journal is read by
 * every member of the company (accounting_journal), and such an entry carries one person's net: it names no
 * person — not his name, number or record id (RL-03) — only the payroll and the line's place in it, which
 * pay roles and Finance alone can read back. An approved payroll's lines never move, so the place is fixed. */
export const lineJournalRef = (p: Pick<Payroll, "key">, l: Pick<LineRef, "pos">, held = false) => `${p.key}:${held ? "held:" : ""}L${l.pos}`

/** fin:RETURNED — the bank sent a transfer back: the money is owed again and the IBAN goes to payroll to fix. */
export async function markReturned(firestore: Firestore, a: FinanceActor, orgId: string, p: Payroll & { returned?: Record<string, unknown> }, employeeId: string, reason: string, books: Books): Promise<void> {
  need(a)
  const l = lineOf(p, employeeId)
  if (!l || p.state !== "paid" || l.held || p.returned?.[employeeId]) throw new HrWriteError("blocked", ["stale"])
  if (!reason.trim()) throw new HrWriteError("blocked", ["no_reason"])
  const batch = writeBatch(firestore)
  await book(firestore, a, orgId, postHrPayReturn({ sourceId: lineJournalRef(p, l), date: books.date, amount: l.net, bankAccount: books.bankAccount, description: `حوالة رواتب مرتجعة ${p.key}` }), books, batch)
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
  await book(firestore, a, orgId, postHrPayPayment({ sourceId: lineJournalRef(p, l, true), date: books.date, amount: l.net, bankAccount: books.bankAccount, description: `سداد راتب موقوف ${p.key}` }), books, batch)
  batch.update(doc(firestore, HR_PAYROLLS, p.id), { [`paidHeld.${employeeId}`]: { ...stamp(a), date: books.date }, updatedAt: serverTimestamp() })
  await batch.commit()
  const line = (p.kind === "supplementary" ? (p.supplementary ?? []) : p.lines).find((x) => x.employeeId === employeeId)
  if (line) await writePayslips(firestore, orgId, p, [line], books.date)
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

/** A payment request HR sent (hr:PR — a renewal's government fee, DC-03). */
export interface HrFeeEvent {
  id: string
  organizationId: string
  key: string
  kind: "PR"
  prType: "doc"
  month: string
  amount: number
  employeeId: string
  employeeNo: number
  doc: string
  expiry: string
  siteId: string | null
  state: "sent" | "paid"
}

/** Pay a payment request (hr:PR → fin:PRPAID): Dr government & recruitment fees · Cr bank, once — the entry id is
 * the request's key and the event moves to paid in the same batch. With Accounting off it is recorded paid. */
export async function payFeeRequest(firestore: Firestore, a: FinanceActor, orgId: string, ev: HrFeeEvent, books: Books & { projectId?: string | null }): Promise<void> {
  need(a)
  const cur = await getDoc(doc(firestore, HR_EVENTS, ev.id))
  if (!cur.exists() || (cur.data() as HrFeeEvent).state !== "sent" || (cur.data() as HrFeeEvent).kind !== "PR") throw new HrWriteError("blocked", ["stale"])
  const batch = writeBatch(firestore)
  const entryId = await book(
    firestore,
    a,
    orgId,
    postHrFee({ key: ev.key, date: books.date, amount: ev.amount, projectId: books.projectId ?? null, bankAccount: books.bankAccount, description: `رسوم تجديد ${ev.doc} — موظف ${String(ev.employeeNo).padStart(4, "0")}` }),
    books,
    batch
  )
  batch.update(doc(firestore, HR_EVENTS, ev.id), { state: "paid", paid: { ...stamp(a), date: books.date }, entryId: entryId ?? null, updatedAt: serverTimestamp() })
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
      // The last month at its cost (gross less sick and unpaid days + employer GOSI) with its GOSI and fines
      // credited; a settlement approved before that was kept reads its last pay as the cost.
      wages: r2((st.lastCost ?? st.lastPay) + st.noticePay + st.art77 + st.ticket),
      gosi: r2((st.lastGosiEmployee ?? 0) + (st.lastGosiEmployer ?? 0)),
      fines: st.lastPenalties ?? 0,
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

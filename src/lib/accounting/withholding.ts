// Withholding tax (ضريبة الاستقطاع) — tax a Saudi payer deducts from what it
// pays a NON-RESIDENT (an imported consulting service, a foreign licensor's
// royalty) and remits to ZATCA on the non-resident's behalf.
//
// The accounting, as in the finance prototype (120,000 consulting at 5 %):
//
//   Dr 520104 Professional fees          120,000   ← the FULL cost, P&L
//       Cr 210302 Withholding tax payable    6,000   ← owed to ZATCA, not the supplier
//       Cr 110102 Bank / 210101 Supplier   114,000   ← what the non-resident receives
//
// The expense is the gross amount: the tax is the supplier's, the company only
// collects it. Until it is remitted, 210302 is a working-capital liability, so
// the 6,000 reads as a positive movement in operating cash flow; the remittance
// (Dr 210302 / Cr bank, by the 10th of the following month) reverses it.
//
// Rates are per payment type, from the Income Tax Law's withholding schedule.
// An org may override any rate in its settings — the table below is the
// platform's reference, not a fixed law.

import { ACC } from "./accounts"
import { round2, type JournalEntry, type WhtLineInfo } from "./journal"

export interface WhtType {
  id: string
  nameAr: string
  nameEn: string
  /** Fraction — 0.05 is 5 %. */
  rate: number
}

export const WHT_TYPES: WhtType[] = [
  { id: "technical_services", nameAr: "خدمات فنية أو استشارية", nameEn: "Technical or consulting services", rate: 0.05 },
  { id: "rent", nameAr: "إيجار", nameEn: "Rent", rate: 0.05 },
  { id: "air_freight", nameAr: "تذاكر طيران أو شحن جوي أو بحري", nameEn: "Air tickets, air or sea freight", rate: 0.05 },
  { id: "telecom", nameAr: "خدمات اتصالات هاتفية دولية", nameEn: "International telecom services", rate: 0.05 },
  { id: "dividends", nameAr: "أرباح موزعة", nameEn: "Dividends", rate: 0.05 },
  { id: "loan_returns", nameAr: "عوائد قروض", nameEn: "Loan returns", rate: 0.05 },
  { id: "insurance", nameAr: "أقساط تأمين أو إعادة تأمين", nameEn: "Insurance or reinsurance premiums", rate: 0.05 },
  { id: "management_fees", nameAr: "أتعاب إدارة", nameEn: "Management fees", rate: 0.2 },
  { id: "royalties", nameAr: "إتاوات وريع", nameEn: "Royalties", rate: 0.15 },
  { id: "related_services", nameAr: "خدمات مدفوعة للمركز الرئيسي أو لشركة مرتبطة", nameEn: "Services paid to head office or a related party", rate: 0.15 },
  { id: "other", nameAr: "أي دفعات أخرى", nameEn: "Any other payments", rate: 0.15 },
]

export const WHT_TYPE_BY_ID: Record<string, WhtType> = Object.fromEntries(WHT_TYPES.map((w) => [w.id, w]))

/** The org's rate for a type: its override if it set one, else the reference rate. */
export function whtRate(type: string, overrides: Record<string, number> = {}): number {
  const own = overrides[type]
  if (typeof own === "number" && Number.isFinite(own) && own >= 0 && own <= 1) return own
  return WHT_TYPE_BY_ID[type]?.rate ?? 0
}

export function whtTypeName(type: string, locale = "ar"): string {
  const w = WHT_TYPE_BY_ID[type]
  if (!w) return type
  return locale === "ar" ? w.nameAr : w.nameEn
}

/** Tax withheld on a gross amount, to the halala. */
export function computeWht(base: number, rate: number): number {
  if (!(base > 0) || !(rate > 0)) return 0
  return round2(base * rate)
}

/** ZATCA's deadline: the 10th day of the month after the payment. */
export function whtDueDate(paymentDate: string): string {
  const y = Number(paymentDate.slice(0, 4))
  const m = Number(paymentDate.slice(5, 7))
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, "0")}-10`
}

/**
 * The withholding line a voucher carries: the credit to 210302, stamped with
 * what it withholds so the register can show type, base and rate without
 * re-deriving them from the other lines.
 */
export function whtLine(input: WhtLineInfo & { partyName?: string | null; note?: string | null }) {
  return {
    account: ACC.withholdingTaxPayable,
    debit: 0,
    credit: computeWht(input.base, input.rate),
    partyName: input.partyName?.trim() || null,
    note: input.note ?? null,
    wht: { type: input.type, rate: input.rate, base: round2(input.base) },
  }
}

export type WhtStatus = "outstanding" | "partial" | "remitted"

export interface WhtRegisterRow {
  entryId: string
  entryNumber: number
  date: string
  description: string
  partyName: string
  /** Null when the credit was posted without the WHT component (an old or
   * hand-typed line) — shown as "unclassified" rather than guessed. */
  type: string | null
  base: number | null
  rate: number | null
  amount: number
  /** What is still owed to ZATCA from this withholding after remittances. */
  outstanding: number
  status: WhtStatus
  dueDate: string
}

export interface WhtRegister {
  rows: WhtRegisterRow[]
  withheld: number
  remitted: number
  outstanding: number
  /** Outstanding amounts grouped by the month they were withheld — each month is
   * one remittance to ZATCA, due on the 10th of the next. */
  byMonth: Array<{ month: string; withheld: number; outstanding: number; dueDate: string }>
}

const posted = (entries: JournalEntry[]) => entries.filter((e) => e.status === "posted")

/**
 * Every withholding and its remittance status. Remittances (debits to 210302)
 * settle the oldest withholdings first — the order ZATCA's monthly returns
 * clear them in. A reversal of a withholding is a debit too, and cancels the
 * way a remittance would.
 */
export function whtRegister(entries: JournalEntry[], asOf: string): WhtRegister {
  const rows: WhtRegisterRow[] = []
  let remitted = 0
  const sorted = posted(entries)
    .filter((e) => e.date <= asOf)
    .sort((a, b) => (a.date === b.date ? a.entryNumber - b.entryNumber : a.date < b.date ? -1 : 1))
  for (const entry of sorted) {
    for (const line of entry.lines) {
      if (line.account !== ACC.withholdingTaxPayable) continue
      if (line.credit > 0) {
        rows.push({
          entryId: entry.id,
          entryNumber: entry.entryNumber,
          date: entry.date,
          description: entry.description,
          partyName: line.partyName || "",
          type: line.wht?.type ?? null,
          base: line.wht?.base ?? null,
          rate: line.wht?.rate ?? null,
          amount: round2(line.credit),
          outstanding: round2(line.credit),
          status: "outstanding",
          dueDate: whtDueDate(entry.date),
        })
      }
      if (line.debit > 0) remitted = round2(remitted + line.debit)
    }
  }
  let settle = remitted
  for (const row of rows) {
    if (settle <= 0.005) break
    const used = Math.min(row.outstanding, settle)
    row.outstanding = round2(row.outstanding - used)
    settle = round2(settle - used)
    row.status = row.outstanding <= 0.005 ? "remitted" : "partial"
  }
  const withheld = round2(rows.reduce((s, r) => s + r.amount, 0))
  const months = new Map<string, { month: string; withheld: number; outstanding: number; dueDate: string }>()
  for (const r of rows) {
    const month = r.date.slice(0, 7)
    const m = months.get(month) || { month, withheld: 0, outstanding: 0, dueDate: whtDueDate(r.date) }
    m.withheld = round2(m.withheld + r.amount)
    m.outstanding = round2(m.outstanding + r.outstanding)
    months.set(month, m)
  }
  return {
    rows: rows.reverse(),
    withheld,
    remitted: round2(Math.min(remitted, withheld)),
    outstanding: round2(Math.max(0, withheld - remitted)),
    byMonth: [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1)),
  }
}

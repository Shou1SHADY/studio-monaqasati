// Zakat base (وعاء الزكاة) — computed from the books, adjustable by the accountant.
//
// The system proposes each component from the ledger; the accountant may
// override any figure and add adjustments of their own (finance review, 23 Sep
// 2026: "companies often make adjustments, and actuals can differ from system
// data"). The overrides live in one document per fiscal year and never touch
// the ledger. What reaches the statements is the PROVISION the accountant books
// from this schedule:
//
//   Dr 540101 Zakat (expense)  →  income statement, "Zakat" under profit before zakat
//       Cr 210303 Zakat payable  →  balance sheet, tax & zakat liabilities, and
//                                   operating cash flow (working capital) until paid
//
// Paying it (Dr 210303 / Cr bank) clears the liability. Both are `manual`
// entries — a person decided them — so they need `accounting.post`.
//
// The components follow the finance prototype: equity, plus the year's adjusted
// profit before zakat, plus long-term loans and end-of-service provisions, less
// net non-current assets. The base is never below the adjusted profit — the
// zakat regulations' floor. This is a management estimate; the filed base is
// the qualified accountant's.

import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import { ACC } from "./accounts"
import { LEDGER_EPOCH, addDays, aggregate, nodeNatural } from "./balances"
import { round2, type JournalEntry } from "./journal"
import { incomeStatement, netProfit } from "./statements"

export const ACCOUNTING_ZAKAT = "accounting_zakat"

/** 2.5 % of a lunar (Hijri) year's base; a Gregorian year is 11 days longer,
 * so its rate is scaled by 365/354. */
export const ZAKAT_RATES = { hijri: 0.025, gregorian: 0.025776 } as const
export type ZakatRateBasis = keyof typeof ZAKAT_RATES

export type ZakatComponentKey = "equity" | "profit" | "loans" | "provisions" | "nonCurrentAssets"

/** +1 adds to the base, −1 is deducted from it. */
export const ZAKAT_COMPONENTS: Array<{ key: ZakatComponentKey; sign: 1 | -1; labelKey: string; codes: string[] }> = [
  { key: "equity", sign: 1, labelKey: "acc_zakat_c_equity", codes: ["3"] },
  { key: "profit", sign: 1, labelKey: "acc_zakat_c_profit", codes: ["4", "51", "52", "53"] },
  { key: "loans", sign: 1, labelKey: "acc_zakat_c_loans", codes: ["2201"] },
  { key: "provisions", sign: 1, labelKey: "acc_zakat_c_provisions", codes: ["2202"] },
  { key: "nonCurrentAssets", sign: -1, labelKey: "acc_zakat_c_nca", codes: ["12"] },
]

export interface ZakatOverride {
  value: number
  note?: string | null
}

export interface ZakatAdjustment {
  id: string
  label: string
  /** Signed: positive adds to the base, negative reduces it. */
  amount: number
  note?: string | null
}

/** The accountant's working paper for one fiscal year. */
export interface ZakatScheduleDoc {
  organizationId: string
  fiscalYear: number
  rateBasis: ZakatRateBasis
  overrides: Partial<Record<ZakatComponentKey, ZakatOverride>>
  adjustments: ZakatAdjustment[]
  updatedAt?: unknown
  updatedByUserId?: string | null
  updatedByUserName?: string | null
}

export function zakatDocId(organizationId: string, fiscalYear: number): string {
  return `${organizationId}__${fiscalYear}`
}

export interface ZakatComponentRow {
  key: ZakatComponentKey
  sign: 1 | -1
  labelKey: string
  codes: string[]
  /** What the books say (always a magnitude; `sign` says which way it counts). */
  system: number
  override: ZakatOverride | null
  /** The figure used: the override when set, otherwise the system's. */
  value: number
}

export interface ZakatComputation {
  components: ZakatComponentRow[]
  adjustments: ZakatAdjustment[]
  adjustmentsTotal: number
  /** Components and adjustments summed, before the floor. */
  computedBase: number
  /** True when the base was raised to the adjusted profit. */
  floorApplied: boolean
  base: number
  rateBasis: ZakatRateBasis
  rate: number
  zakat: number
  /** Zakat expense already booked in the fiscal year (540101 movement). */
  booked: number
  /** zakat − booked: what a provision entry would post now. Negative means
   * the books carry too much and the provision is released. */
  toBook: number
  /** Zakat payable (210303) outstanding at year end. */
  payable: number
}

/**
 * The year's schedule from the books plus the accountant's working paper.
 * `from`/`to` are the fiscal year's bounds.
 */
export function zakatComputation(
  entries: JournalEntry[],
  range: { from: string; to: string },
  schedule: Pick<ZakatScheduleDoc, "overrides" | "adjustments" | "rateBasis"> | null
): ZakatComputation {
  const closing = aggregate(entries, LEDGER_EPOCH, range.to)
  const movement = aggregate(entries, range.from, range.to)
  // Profits of earlier years that were never closed into retained earnings are
  // still equity — this ledger carries them in the P&L accounts.
  const priorResults = netProfit(aggregate(entries, LEDGER_EPOCH, addDays(range.from, -1)))
  const beforeZakat = incomeStatement(movement).totals.beforeZakat || 0

  const system: Record<ZakatComponentKey, number> = {
    equity: round2(nodeNatural(closing, "3") + priorResults),
    profit: round2(beforeZakat),
    loans: round2(nodeNatural(closing, "2201")),
    provisions: round2(nodeNatural(closing, "2202")),
    nonCurrentAssets: round2(nodeNatural(closing, "12")),
  }

  const overrides = schedule?.overrides ?? {}
  const components: ZakatComponentRow[] = ZAKAT_COMPONENTS.map((c) => {
    const o = overrides[c.key]
    const override = o && Number.isFinite(Number(o.value)) ? { value: round2(Number(o.value)), note: o.note ?? null } : null
    return { ...c, system: system[c.key], override, value: override ? override.value : system[c.key] }
  })
  const adjustments = (schedule?.adjustments ?? []).filter((a) => Number.isFinite(Number(a.amount)))
  const adjustmentsTotal = round2(adjustments.reduce((s, a) => s + Number(a.amount), 0))
  const computedBase = round2(components.reduce((s, c) => s + c.sign * c.value, 0) + adjustmentsTotal)
  const profit = components.find((c) => c.key === "profit")!.value
  const floorApplied = profit > 0 && computedBase < profit
  const base = floorApplied ? profit : computedBase
  const rateBasis: ZakatRateBasis = schedule?.rateBasis === "gregorian" ? "gregorian" : "hijri"
  const rate = ZAKAT_RATES[rateBasis]
  const zakat = round2(Math.max(0, base) * rate)
  const booked = round2(nodeNatural(movement, "54"))
  return {
    components,
    adjustments,
    adjustmentsTotal,
    computedBase,
    floorApplied,
    base: round2(base),
    rateBasis,
    rate,
    zakat,
    booked,
    toBook: round2(zakat - booked),
    payable: round2(nodeNatural(closing, ACC.zakatPayable)),
  }
}

/** The provision voucher's lines for `amount` (negative releases an over-provision). */
export function zakatProvisionLines(amount: number, note: string) {
  const a = round2(Math.abs(amount))
  return amount >= 0
    ? [
        { account: ACC.zakatExpense, debit: a, credit: 0, note },
        { account: ACC.zakatPayable, debit: 0, credit: a, note },
      ]
    : [
        { account: ACC.zakatPayable, debit: a, credit: 0, note },
        { account: ACC.zakatExpense, debit: 0, credit: a, note },
      ]
}

export async function saveZakatSchedule(
  firestore: Firestore,
  input: {
    organizationId: string
    fiscalYear: number
    rateBasis: ZakatRateBasis
    overrides: Partial<Record<ZakatComponentKey, ZakatOverride>>
    adjustments: ZakatAdjustment[]
    actor: { id: string; name: string }
  }
): Promise<void> {
  const overrides: Record<string, { value: number; note: string | null }> = {}
  for (const [k, o] of Object.entries(input.overrides)) {
    if (o && Number.isFinite(Number(o.value))) overrides[k] = { value: round2(Number(o.value)), note: o.note?.trim() || null }
  }
  await setDoc(doc(firestore, ACCOUNTING_ZAKAT, zakatDocId(input.organizationId, input.fiscalYear)), {
    organizationId: input.organizationId,
    fiscalYear: input.fiscalYear,
    rateBasis: input.rateBasis,
    overrides,
    adjustments: input.adjustments
      .filter((a) => a.label.trim() && Number.isFinite(Number(a.amount)) && Number(a.amount) !== 0)
      .map((a) => ({ id: a.id, label: a.label.trim(), amount: round2(Number(a.amount)), note: a.note?.trim() || null })),
    updatedAt: serverTimestamp(),
    updatedByUserId: input.actor.id,
    updatedByUserName: input.actor.name,
  })
}

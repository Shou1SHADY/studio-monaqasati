// Settlements (التسويات) — clearing what a counterparty owes or is owed.
//
// Each kind is a fixed two-line voucher between a party's balances (and cash
// where money actually moves). Keeping them as named templates rather than a
// free journal entry is the point: the accountant picks "offset the client's
// advance against their receivable", the accounts are always the right ones,
// and the party is tagged on both lines so sub-ledgers and aging stay true.

import { ACC } from "./accounts"
import { round2 } from "./journal"
import type { ManualLineInput } from "./manual-entry"

export type SettlementKind =
  | "customer_receipt"
  | "supplier_payment"
  | "client_advance_offset"
  | "supplier_advance_offset"
  | "retention_release"
  | "bad_debt_writeoff"

export type SettlementParty = "customer" | "supplier"

export interface SettlementDef {
  kind: SettlementKind
  party: SettlementParty
  /** Money actually moves through a cash or bank account. */
  usesCash: boolean
  /** Debit and credit sides; `cash` is replaced by the chosen cash account. */
  debit: string
  credit: string
}

export const SETTLEMENT_DEFS: SettlementDef[] = [
  { kind: "customer_receipt", party: "customer", usesCash: true, debit: "cash", credit: ACC.clientsReceivable },
  { kind: "client_advance_offset", party: "customer", usesCash: false, debit: ACC.advancesFromClients, credit: ACC.clientsReceivable },
  { kind: "retention_release", party: "customer", usesCash: false, debit: ACC.clientsReceivable, credit: ACC.retentionReceivable },
  { kind: "bad_debt_writeoff", party: "customer", usesCash: false, debit: ACC.doubtfulDebtExpense, credit: ACC.clientsReceivable },
  { kind: "supplier_payment", party: "supplier", usesCash: true, debit: ACC.suppliersPayable, credit: "cash" },
  { kind: "supplier_advance_offset", party: "supplier", usesCash: false, debit: ACC.suppliersPayable, credit: ACC.advancesToSuppliers },
]

export const SETTLEMENT_DEF: Record<SettlementKind, SettlementDef> = Object.fromEntries(
  SETTLEMENT_DEFS.map((d) => [d.kind, d])
) as Record<SettlementKind, SettlementDef>

/** The party balances the Settlements screen reads. */
export const CUSTOMER_ACCOUNTS = [ACC.clientsReceivable, ACC.retentionReceivable, ACC.advancesFromClients]
export const SUPPLIER_ACCOUNTS = [ACC.suppliersPayable, ACC.advancesToSuppliers]
export const CASH_ACCOUNTS = [ACC.pettyCash, ACC.bankMain, ACC.bankProjects]

/**
 * What can be cleared, given the party's natural balances — never more than
 * both sides hold, so a suggested settlement cannot flip a balance's sign.
 */
export function suggestedSettlementAmount(kind: SettlementKind, balances: Record<string, number>): number {
  const b = (code: string) => Math.max(0, balances[code] ?? 0)
  switch (kind) {
    case "customer_receipt":
    case "bad_debt_writeoff":
      return round2(b(ACC.clientsReceivable))
    case "client_advance_offset":
      return round2(Math.min(b(ACC.clientsReceivable), b(ACC.advancesFromClients)))
    case "retention_release":
      return round2(b(ACC.retentionReceivable))
    case "supplier_payment":
      return round2(b(ACC.suppliersPayable))
    case "supplier_advance_offset":
      return round2(Math.min(b(ACC.suppliersPayable), b(ACC.advancesToSuppliers)))
  }
}

export function settlementLines(
  kind: SettlementKind,
  input: { amount: number; cashAccount?: string; party?: string | null; partyName?: string | null; note?: string | null; project?: string | null; projectName?: string | null }
): ManualLineInput[] {
  const def = SETTLEMENT_DEF[kind]
  const cash = input.cashAccount || ACC.bankMain
  const resolve = (side: string) => (side === "cash" ? cash : side)
  const value = round2(input.amount)
  const common = {
    party: input.party ?? null,
    partyName: input.partyName ?? null,
    note: input.note ?? null,
    project: input.project ?? null,
    projectName: input.projectName ?? null,
  }
  return [
    { ...common, account: resolve(def.debit), debit: value, credit: 0 },
    { ...common, account: resolve(def.credit), debit: 0, credit: value },
  ]
}

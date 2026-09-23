// Accounting settings (إعدادات النظام المحاسبي) — one document per org.
//
// Holds the decisions every report depends on but no report should make: whether
// the module is on, when the company's financial year opens (which is what "Q1"
// and "H1" mean), and how figures are shown by default.

import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore"
import { ACCOUNTING_SETTINGS } from "./journal"
import { isMoneyScale, type MoneyScale } from "./display"
import { normalizeStartMonth } from "./periods"

export interface AccountingSettings {
  enabled: boolean
  /** 1–12: the calendar month the fiscal year opens in. */
  fiscalYearStartMonth: number
  /** The org's default presentation; each reader may override it for themselves. */
  displayScale: MoneyScale
  /** Statements filtered by project. Off in the standard product (finance review,
   * 23 Sep 2026): per-project, per-branch and per-region financials are a
   * customisation switched on for the client who asks for them. Lines still
   * carry their project, so job costing in Projects is unaffected. */
  projectReports: boolean
  /** Days after booking a client is expected to pay, and the company to pay a
   * supplier — the cash projection's timing when a line carries no due date. */
  customerTermDays: number
  supplierTermDays: number
  /** Withholding-tax rate overrides by payment type id (fractions, 0.05 = 5 %).
   * Absent types read the platform table in withholding.ts. */
  whtRates: Record<string, number>
}

export interface AccountingSettingsDoc extends AccountingSettings {
  id: string
  organizationId: string
  updatedAt?: unknown
  updatedByUserId?: string | null
  updatedByUserName?: string | null
}

export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettings = {
  enabled: false,
  fiscalYearStartMonth: 1,
  displayScale: "units",
  projectReports: false,
  customerTermDays: 30,
  supplierTermDays: 30,
  whtRates: {},
}

/** A whole number of days, 0–365; anything else falls back. */
function termDays(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 365 ? Math.round(n) : fallback
}

function rates(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0 && n <= 1) out[k] = n
  }
  return out
}

export function normalizeAccountingSettings(raw: Partial<AccountingSettings> | null | undefined): AccountingSettings {
  return {
    enabled: raw?.enabled === true,
    fiscalYearStartMonth: normalizeStartMonth(raw?.fiscalYearStartMonth ?? DEFAULT_ACCOUNTING_SETTINGS.fiscalYearStartMonth),
    displayScale: isMoneyScale(raw?.displayScale) ? raw.displayScale : DEFAULT_ACCOUNTING_SETTINGS.displayScale,
    projectReports: raw?.projectReports === true,
    customerTermDays: termDays(raw?.customerTermDays, DEFAULT_ACCOUNTING_SETTINGS.customerTermDays),
    supplierTermDays: termDays(raw?.supplierTermDays, DEFAULT_ACCOUNTING_SETTINGS.supplierTermDays),
    whtRates: rates(raw?.whtRates),
  }
}

/**
 * Write the org's settings. Older orgs may already have a settings doc under an
 * auto id (the module has always looked it up by `organizationId`), so an
 * existing id is reused; a first save uses the org id, which cannot duplicate.
 */
export async function saveAccountingSettings(
  firestore: Firestore,
  input: {
    existingDocId?: string | null
    organizationId: string
    settings: AccountingSettings
    actor: { id: string; name: string }
  }
): Promise<void> {
  const id = input.existingDocId || input.organizationId
  await setDoc(
    doc(firestore, ACCOUNTING_SETTINGS, id),
    {
      organizationId: input.organizationId,
      ...normalizeAccountingSettings(input.settings),
      updatedAt: serverTimestamp(),
      updatedByUserId: input.actor.id,
      updatedByUserName: input.actor.name,
    },
    { merge: true }
  )
}

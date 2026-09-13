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
}

export function normalizeAccountingSettings(raw: Partial<AccountingSettings> | null | undefined): AccountingSettings {
  return {
    enabled: raw?.enabled === true,
    fiscalYearStartMonth: normalizeStartMonth(raw?.fiscalYearStartMonth ?? DEFAULT_ACCOUNTING_SETTINGS.fiscalYearStartMonth),
    displayScale: isMoneyScale(raw?.displayScale) ? raw.displayScale : DEFAULT_ACCOUNTING_SETTINGS.displayScale,
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

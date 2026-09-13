"use client"

// The reader's own view settings for the accounting screens — which period they
// are looking at and whether figures are shown as reported, in thousands or in
// millions.
//
// A module-level store rather than component state: every accounting screen
// mounts its own `useAccounting()`, and the period chosen on the income
// statement must still be selected when the reader opens the balance sheet.
// Persisted per browser; the org's default scale (Accounting settings) applies
// until the reader picks one.

import { useSyncExternalStore } from "react"
import { isMoneyScale, type MoneyScale } from "@/lib/accounting/display"

export interface AccountingPrefs {
  /** null = follow the org's default. */
  scale: MoneyScale | null
  periodKey: string
  /** null = the fiscal year containing today. */
  fiscalYear: number | null
  customFrom: string
  customTo: string
}

const STORAGE_KEY = "mdmak.accounting.prefs.v1"
const DEFAULT_PREFS: AccountingPrefs = { scale: null, periodKey: "FY", fiscalYear: null, customFrom: "", customTo: "" }

let prefs: AccountingPrefs = DEFAULT_PREFS
let loaded = false
let orgDefaultScale: MoneyScale = "units"
const listeners = new Set<() => void>()

function sanitize(raw: Partial<AccountingPrefs>): AccountingPrefs {
  return {
    scale: isMoneyScale(raw.scale) ? raw.scale : null,
    periodKey: typeof raw.periodKey === "string" && raw.periodKey ? raw.periodKey : DEFAULT_PREFS.periodKey,
    fiscalYear: Number.isInteger(raw.fiscalYear) ? (raw.fiscalYear as number) : null,
    customFrom: typeof raw.customFrom === "string" ? raw.customFrom : "",
    customTo: typeof raw.customTo === "string" ? raw.customTo : "",
  }
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) prefs = sanitize(JSON.parse(raw))
  } catch {
    /* storage unavailable — keep defaults */
  }
}

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): AccountingPrefs {
  ensureLoaded()
  return prefs
}

export function setAccountingPrefs(patch: Partial<AccountingPrefs>): void {
  ensureLoaded()
  prefs = sanitize({ ...prefs, ...patch })
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable — the choice lasts for this session */
  }
  emit()
}

/** Called once the org's settings load; readers who never chose a scale follow it. */
export function setOrgDefaultScale(scale: MoneyScale): void {
  if (scale === orgDefaultScale) return
  orgDefaultScale = scale
  emit()
}

export function useAccountingPrefs(): AccountingPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFS)
}

export function useMoneyScale(): MoneyScale {
  const own = useAccountingPrefs().scale
  const orgDefault = useSyncExternalStore(subscribe, () => orgDefaultScale, () => "units" as MoneyScale)
  return own ?? orgDefault
}

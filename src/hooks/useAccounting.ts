"use client"

// One subscription, every screen.
//
// The ledger is small enough per org to hold in memory (an entry per money
// event, not per row), and every statement is a pure function over it. So the
// module subscribes once here and each screen derives what it needs — no screen
// issues its own query, the period filter costs nothing, and every statement on
// screen is guaranteed to be reading the same books at the same instant.

import { useEffect, useMemo, useState } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import {
  ACCOUNTING_PERIODS,
  JOURNAL_ENTRIES,
  type AccountingPeriod,
  type JournalEntry,
} from "@/lib/accounting/journal"
import { periodWindows, type LedgerFilter, type PeriodWindows } from "@/lib/accounting/balances"
import {
  fiscalPeriodOptions,
  fiscalYearChoices,
  fiscalYearOf,
  isoToday,
  resolvePeriod,
  type FiscalPeriod,
} from "@/lib/accounting/periods"
import {
  normalizeAccountingSettings,
  type AccountingSettings,
  type AccountingSettingsDoc,
} from "@/lib/accounting/settings"
import type { MoneyScale } from "@/lib/accounting/display"
import { setAccountingPrefs, setOrgDefaultScale, useAccountingPrefs, useMoneyScale } from "@/hooks/useAccountingPrefs"

export type { FiscalPeriod }

export interface AccountingData {
  organizationId: string
  userId: string
  userName: string
  entries: JournalEntry[]
  periods: AccountingPeriod[]
  isLoading: boolean
  /** True once the org has a settings doc with `enabled`. */
  isEnabled: boolean
  settings: AccountingSettings
  settingsDoc: AccountingSettingsDoc | null
  windows: PeriodWindows
  period: FiscalPeriod
  /** Presets of the selected fiscal year (FY, YTD, H1–H2, Q1–Q4, months). */
  periodOptions: FiscalPeriod[]
  setPeriodKey: (key: string) => void
  fiscalYear: number
  fiscalYears: number[]
  setFiscalYear: (fiscalYear: number) => void
  setCustomRange: (from: string, to: string) => void
  scale: MoneyScale
  setScale: (scale: MoneyScale) => void
  filter: LedgerFilter
  setFilter: (f: LedgerFilter) => void
  projects: Array<{ id: string; name: string }>
}

export function useAccounting(): AccountingData {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const organizationId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const userName = (profile as { name?: string } | null)?.name || user?.email || ""

  const entriesQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: entriesData, isLoading } = useCollection(entriesQuery)
  const entries = useMemo(() => (entriesData || []) as JournalEntry[], [entriesData])

  const periodsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, ACCOUNTING_PERIODS), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: periodsData } = useCollection(periodsQuery)
  const periods = useMemo(() => (periodsData || []) as AccountingPeriod[], [periodsData])

  const settingsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "accounting_settings"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: settingsData } = useCollection(settingsQuery)
  const settingsDoc = useMemo(() => {
    const docs = (settingsData || []) as AccountingSettingsDoc[]
    // Prefer the enabled doc if an org somehow carries more than one.
    return docs.find((d) => d.enabled === true) ?? docs[0] ?? null
  }, [settingsData])
  const settings = useMemo(() => normalizeAccountingSettings(settingsDoc), [settingsDoc])
  const isEnabled = settings.enabled

  useEffect(() => {
    setOrgDefaultScale(settings.displayScale)
  }, [settings.displayScale])

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: projectsData } = useCollection(projectsQuery)
  const projects = useMemo(
    () => ((projectsData || []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name })),
    [projectsData]
  )

  const prefs = useAccountingPrefs()
  const scale = useMoneyScale()
  const startMonth = settings.fiscalYearStartMonth
  const today = isoToday()
  const fiscalYear = prefs.fiscalYear ?? fiscalYearOf(today, startMonth)
  const fiscalYears = useMemo(() => {
    const years = fiscalYearChoices(entries.map((e) => e.date), startMonth, today)
    return years.includes(fiscalYear) ? years : [...years, fiscalYear].sort((a, b) => b - a)
  }, [entries, startMonth, today, fiscalYear])
  const periodOptions = useMemo(() => fiscalPeriodOptions({ fiscalYear, startMonth, today }), [fiscalYear, startMonth, today])
  const period = useMemo(
    () =>
      resolvePeriod(
        { key: prefs.periodKey, fiscalYear, customFrom: prefs.customFrom, customTo: prefs.customTo },
        startMonth,
        today
      ),
    [prefs.periodKey, prefs.customFrom, prefs.customTo, fiscalYear, startMonth, today]
  )
  const [filter, setFilter] = useState<LedgerFilter>({})

  const windows = useMemo(
    () => periodWindows(entries, period.from, period.to, filter),
    [entries, period.from, period.to, filter]
  )

  return {
    organizationId,
    userId: user?.uid || "",
    userName,
    entries,
    periods,
    isLoading,
    isEnabled,
    settings,
    settingsDoc,
    windows,
    period,
    periodOptions,
    setPeriodKey: (key) => setAccountingPrefs({ periodKey: key }),
    fiscalYear,
    fiscalYears,
    setFiscalYear: (fy) => setAccountingPrefs({ fiscalYear: fy, periodKey: prefs.periodKey === "CUSTOM" ? "FY" : prefs.periodKey }),
    setCustomRange: (from, to) => setAccountingPrefs({ periodKey: "CUSTOM", customFrom: from, customTo: to }),
    scale,
    setScale: (s) => setAccountingPrefs({ scale: s }),
    filter,
    setFilter,
    projects,
  }
}

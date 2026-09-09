"use client"

// One subscription, every screen.
//
// The ledger is small enough per org to hold in memory (an entry per money
// event, not per row), and every statement is a pure function over it. So the
// module subscribes once here and each screen derives what it needs — no screen
// issues its own query, the period filter costs nothing, and every statement on
// screen is guaranteed to be reading the same books at the same instant.

import { useMemo, useState } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import {
  ACCOUNTING_PERIODS,
  JOURNAL_ENTRIES,
  type AccountingPeriod,
  type JournalEntry,
} from "@/lib/accounting/journal"
import { periodWindows, type LedgerFilter, type PeriodWindows } from "@/lib/accounting/balances"

export interface FiscalPeriod {
  key: string
  labelAr: string
  labelEn: string
  from: string
  to: string
}

/** Month, quarter and year ranges around today — the windows people actually
 * ask for, without making them type dates. */
export function fiscalPeriods(reference = new Date()): FiscalPeriod[] {
  const year = reference.getUTCFullYear()
  const pad = (n: number) => String(n).padStart(2, "0")
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

  const months: FiscalPeriod[] = []
  for (let m = 1; m <= 12; m++) {
    months.push({
      key: `${year}-${pad(m)}`,
      labelAr: `${pad(m)}/${year}`,
      labelEn: `${pad(m)}/${year}`,
      from: `${year}-${pad(m)}-01`,
      to: `${year}-${pad(m)}-${pad(lastDay(year, m))}`,
    })
  }
  return [
    { key: "YTD", labelAr: `السنة المالية ${year}`, labelEn: `Fiscal year ${year}`, from: `${year}-01-01`, to: `${year}-12-31` },
    { key: "Q1", labelAr: `الربع الأول ${year}`, labelEn: `Q1 ${year}`, from: `${year}-01-01`, to: `${year}-03-31` },
    { key: "Q2", labelAr: `الربع الثاني ${year}`, labelEn: `Q2 ${year}`, from: `${year}-04-01`, to: `${year}-06-30` },
    { key: "Q3", labelAr: `الربع الثالث ${year}`, labelEn: `Q3 ${year}`, from: `${year}-07-01`, to: `${year}-09-30` },
    { key: "Q4", labelAr: `الربع الرابع ${year}`, labelEn: `Q4 ${year}`, from: `${year}-10-01`, to: `${year}-12-31` },
    ...months,
  ]
}

export interface AccountingData {
  organizationId: string
  userId: string
  userName: string
  entries: JournalEntry[]
  periods: AccountingPeriod[]
  isLoading: boolean
  /** True once the org has a settings doc with `enabled`. */
  isEnabled: boolean
  windows: PeriodWindows
  period: FiscalPeriod
  periodOptions: FiscalPeriod[]
  setPeriodKey: (key: string) => void
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
  const isEnabled = ((settingsData || []) as Array<{ enabled?: boolean }>).some((s) => s.enabled === true)

  const projectsQuery = useMemoFirebase(() => {
    if (!firestore || !organizationId) return null
    return query(collection(firestore, "projects"), where("organizationId", "==", organizationId))
  }, [firestore, organizationId])
  const { data: projectsData } = useCollection(projectsQuery)
  const projects = useMemo(
    () => ((projectsData || []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name })),
    [projectsData]
  )

  const periodOptions = useMemo(() => fiscalPeriods(), [])
  const [periodKey, setPeriodKey] = useState("YTD")
  const period = periodOptions.find((p) => p.key === periodKey) || periodOptions[0]
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
    windows,
    period,
    periodOptions,
    setPeriodKey,
    filter,
    setFilter,
    projects,
  }
}

"use client"

// A project's indirect costs: the manager's budgets on the project's pm block,
// the payroll and vouchers the books tag to the project (two equality reads of
// the org journal — payroll postings and manual vouchers are where a project's
// staff and overheads land), the salary transfers that settle those payrolls
// (what of it is paid), and the cost of the plant days logged on site.
// Money holders only.

import { useMemo } from "react"
import { collection, doc, query, where } from "firebase/firestore"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { indirectActuals, indirectPaid, indirectRows, type IndirectBudgets, type IndirectJournalEntry, type IndirectKind, type IndirectRow } from "@/lib/pm/indirect"
import { plantCost, PM_PLANT, type PmPlant } from "@/lib/pm/plant"

export interface PmIndirect {
  rows: IndirectRow[]
  budget: number
  actual: number
  plantLogged: number
  budgets: IndirectBudgets
  byKind: Record<IndirectKind, number>
  paid: Record<IndirectKind, number>
}

const JOURNAL = "accounting_journal"

export function usePmIndirect(projectId: string, orgId: string | null, money: boolean): PmIndirect {
  const firestore = useFirestore()
  const on = Boolean(firestore && money && orgId)
  const projectRef = useMemoFirebase(() => (on && firestore ? doc(firestore, "projects", projectId) : null), [on, firestore, projectId])
  const payQ = useMemoFirebase(() => (on && firestore ? query(collection(firestore, JOURNAL), where("organizationId", "==", orgId), where("sourceType", "==", "hr_pay")) : null), [on, firestore, orgId])
  const manualQ = useMemoFirebase(() => (on && firestore ? query(collection(firestore, JOURNAL), where("organizationId", "==", orgId), where("sourceType", "==", "manual_voucher")) : null), [on, firestore, orgId])
  const settleQ = useMemoFirebase(() => (on && firestore ? query(collection(firestore, JOURNAL), where("organizationId", "==", orgId), where("sourceType", "in", ["hr_pay_payment", "hr_pay_return"])) : null), [on, firestore, orgId])
  const plantQ = useMemoFirebase(() => (on && firestore ? collection(firestore, "projects", projectId, PM_PLANT) : null), [on, firestore, projectId])
  const { data: project } = useDoc<{ pm?: { indirect?: IndirectBudgets | null } | null }>(projectRef)
  const { data: pay } = useCollection(payQ)
  const { data: manual } = useCollection(manualQ)
  const { data: settle } = useCollection(settleQ)
  const { data: plant } = useCollection(plantQ)

  return useMemo(() => {
    const logged = ((plant ?? []) as unknown as PmPlant[]).reduce((a, p) => a + (p.dayRate ? plantCost(p) : 0), 0)
    const entries = [...((pay ?? []) as unknown as IndirectJournalEntry[]), ...((manual ?? []) as unknown as IndirectJournalEntry[])]
    const { byKind, plantLogged } = indirectActuals(projectId, entries, logged)
    const paid = indirectPaid(projectId, entries, (settle ?? []) as unknown as IndirectJournalEntry[])
    const budgets = project?.pm?.indirect ?? {}
    return { ...indirectRows(budgets, byKind), plantLogged, budgets, byKind, paid }
  }, [plant, pay, manual, settle, project, projectId])
}

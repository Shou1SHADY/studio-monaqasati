"use client"

// One PM 1.0 project's computed decisions (DEC-01): reads what the viewer may
// read — terms and certificates only for money or approve holders, as the
// rules allow — and derives the list. Nothing here is stored.

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { progressOf, type Acceptances } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { projectDecisions, type PmDecision } from "@/lib/pm/decisions"
import { todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { PM_SHEETS, type PmSheet } from "@/lib/pm/measurement"
import { PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"
import { PM_VARIATIONS, type PmVariation } from "@/lib/pm/variation"

export interface PmDecisionProject {
  budget?: number
  status?: string | null
  projectManagerId?: string | null
  pm?: {
    lifecycle?: string
    terms?: ContractTerms
    original?: ContractTerms | null
    startOn?: string | null
    startedAt?: string | null
    durationDays?: number
    acceptances?: Acceptances
  } | null
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

function useSub<T>(projectId: string, name: string, enabled = true) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && projectId && enabled ? collection(firestore, "projects", projectId, name) : null), [firestore, projectId, name, enabled])
  const { data, isLoading } = useCollection(q)
  return { rows: (data ?? []) as unknown as T[], isLoading }
}

export function usePmDecisions(projectId: string, project: PmDecisionProject | null | undefined, access: PmAccess): { decisions: PmDecision[]; progress: number | null; ready: boolean } {
  const seesTerms = access.has("money") || access.has("approve")
  const money = access.has("money")
  const items = useSub<Record<string, unknown>>(projectId, "boqItems")
  const sheets = useSub<PmSheet>(projectId, PM_SHEETS)
  const addenda = useSub<PmAddendum>(projectId, PM_ADDENDA, seesTerms)
  const certs = useSub<PmCertificate>(projectId, PM_CERTIFICATES, money)
  const punch = useSub<PunchItem>(projectId, PM_PUNCH)
  const vos = useSub<PmVariation>(projectId, PM_VARIATIONS)
  const claims = useSub<PmClaim>(projectId, PM_CLAIMS)

  const decisions = useMemo(() => {
    const pm = project?.pm
    if (!project || !pm) return []
    const original = pm.original ?? pm.terms ?? defaultTerms()
    return projectDecisions({
      lifecycle: lifecycleOf(project as { pm?: { lifecycle?: string }; status?: string }),
      managerless: !project.projectManagerId,
      startOn: pm.startedAt ?? null,
      plannedStart: pm.startOn ?? null,
      durationDays: pm.durationDays ?? 0,
      baseValue: project.budget ?? 0,
      terms: inForce(original, addenda.rows),
      acceptances: pm.acceptances ?? {},
      items: items.rows.map((d) => ({
        quantity: num(d.quantity),
        rate: num(d.unitPrice),
        executed: num(d.executedQuantity),
        gate: { pmInspect: d.pmInspect === true, pmWir: (d.pmWir as string | null) ?? null },
        pmSample: d.pmSample === true,
        pmSub: (d.pmSub as string | null) ?? null,
      })),
      sheets: sheets.rows,
      addenda: addenda.rows,
      certificates: certs.rows,
      punch: punch.rows,
      variations: vos.rows,
      claims: claims.rows,
      today: todayDay(),
    })
  }, [project, items.rows, sheets.rows, addenda.rows, certs.rows, punch.rows, vos.rows, claims.rows])

  const progress = useMemo(() => progressOf(items.rows.map((d) => ({ quantity: num(d.quantity), rate: num(d.unitPrice), executed: num(d.executedQuantity) }))), [items.rows])

  return { decisions, progress, ready: !items.isLoading && !sheets.isLoading }
}

"use client"

// A PM 1.0 project's figures, the same wherever they appear (the project head,
// its card, PM Today): progress by value against the planned line, work
// executed and not yet billed, and the cash position — what the client paid in
// against what went out, VAT collected excluded (it is the authority's, not
// ours). Money only for holders of money.

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useProjectMoneyFlow } from "@/hooks/useProjectMoneyFlow"
import { progressOf } from "@/lib/pm/acceptance"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { delayAndDamages } from "@/lib/pm/claim"
import { usePmPlan } from "@/hooks/usePmPlan"
import { moneyTrail } from "@/lib/pm/pulse"
import { PM_VARIATIONS } from "@/lib/pm/variation"
import { todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export interface ProjectFigures {
  itemCount: number
  unpricedCount: number
  progress: number | null
  planned: number | null
  /** Points behind the planned line (negative = ahead). */
  behind: number
  unbilled: number
  collected: number
  paid: number
  /** Collected less the VAT in it, and what went out — the cash tile's two sides. */
  cashIn: number
  cashOut: number
  cash: number
  /** Certified and past due, not yet collected. */
  overdue: number
}

export function useProjectFigures(
  projectId: string,
  project: { status?: string | null; budget?: number | null; pm?: { lifecycle?: string; startedAt?: string | null; durationDays?: number; cutPool?: number } | null } | null,
  access: Pick<PmAccess, "has">
): ProjectFigures {
  const firestore = useFirestore()
  const money = access.has("money")
  const itemQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, "boqItems") : null), [firestore, projectId])
  const { data: itemData } = useCollection(itemQ)
  const certQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, projectId, money])
  const { data: certs } = useCollection(certQ)
  const flow = useProjectMoneyFlow(money ? projectId : null)
  const voQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId])
  const { data: vos } = useCollection(voQ)
  const items = useMemo(
    () => ((itemData ?? []) as Array<Record<string, unknown>>).map((d, n) => ({ id: String(d.id ?? n), quantity: num(d.quantity), rate: num(d.unitPrice), executed: num(d.executedQuantity), billed: num(d.billedQuantity) })),
    [itemData]
  )
  const plan0 = usePmPlan(projectId, project, items)

  return useMemo(() => {
    const progress = progressOf(items)
    // One planned line everywhere: the current baseline on the programme's S-curve (the prototype's pPlan).
    const plan = project?.pm
      ? delayAndDamages({ lifecycle: lifecycleOf(project), startOn: project.pm.startedAt ?? null, effectiveDays: plan0.effectiveDays, progress, contractValue: 0, damages: { on: false, weeklyRate: 0, cap: 0 }, today: todayDay(), curveK: plan0.curveK })
      : null
    // Unbilled as the prototype's pUnbilled: BOQ + approved-variation work, less what was billed net of the consultant's cuts.
    const variations = ((vos ?? []) as Array<Record<string, unknown>>).map((v) => ({ status: String(v.status ?? ""), value: num(v.value), cost: num(v.cost), executedPct: num(v.executedPct), billedPct: num(v.billedPct) }))
    const trail = moneyTrail({ contractBase: project?.budget ?? 0, items, variations, cutPool: project?.pm?.cutPool ?? 0, certificates: [], cost: { budget: null, committed: 0, actual: 0, paid: 0 } })
    const unbilled = r2(Math.max(0, trail.gap))
    const list = ((certs ?? []) as unknown as PmCertificate[]).filter((c) => c.status !== "void")
    const shareOf = (c: PmCertificate) => (c.status === "paid" ? 1 : c.status === "part" ? Math.min(1, Math.max(0, (c as { collected?: number }).collected ?? 0)) : 0)
    const pmIn = list.reduce((a, c) => a + c.net * shareOf(c), 0)
    const vatIn = list.reduce((a, c) => a + (c.vat || 0) * shareOf(c), 0)
    const today = todayDay()
    const overdue = list
      .filter((c) => (c.status === "appr" || c.status === "part") && c.dueOn && c.dueOn.slice(0, 10) < today)
      .reduce((a, c) => a + c.net * (1 - shareOf(c)), 0)
    const collected = r2(pmIn + (flow.collected || 0))
    const paid = r2(flow.paid || 0)
    const cashIn = r2(collected - vatIn)
    return {
      itemCount: items.length,
      unpricedCount: items.filter((i) => !(i.rate > 0)).length,
      progress,
      planned: plan ? plan.planned : null,
      behind: progress !== null && plan ? Math.round(plan.planned - progress) : 0,
      unbilled,
      collected,
      paid,
      cashIn,
      cashOut: paid,
      cash: r2(cashIn - paid),
      overdue: r2(overdue),
    }
  }, [items, vos, plan0, certs, flow.collected, flow.paid, project])
}

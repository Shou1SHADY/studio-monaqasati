"use client"

// One project's line in the portfolio (the prototype's pcard / portTable row):
// progress against plan, contract value and cost budget, unbilled, cash, the
// urgent decisions, open obstacles, overdue collection — and, once technically
// complete, whether it can be archived (the closeout gate itself, one source of
// truth). Money only for holders of money; a legacy project shows what it has.

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { usePmAccess } from "@/hooks/usePmAccess"
import { usePmDecisions, type PmDecisionProject } from "@/hooks/usePmDecisions"
import { useProjectFigures } from "@/hooks/useProjectFigures"
import type { Acceptances } from "@/lib/pm/acceptance"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { closeBlocks, closeoutRows } from "@/lib/pm/closeout"
import { todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { PM_NCRS, type NcrStatus } from "@/lib/pm/ncr"
import { PM_PUNCH, type PunchStatus } from "@/lib/pm/punch"
import { isOpenObstacle, PM_OBSTACLES, type PmObstacle } from "@/lib/pm/site"
import type { ContractTerms } from "@/lib/pm/terms"
import { PM_VARIATIONS, type VoStatus } from "@/lib/pm/variation"
import { certificatesApply, termsNow } from "@/lib/pm/terms"

export type PortfolioProject = PmDecisionProject & {
  id: string
  name?: string
  clientName?: string | null
  location?: string | null
  region?: string | null
  projectType?: string | null
  projectManagerName?: string | null
  createdAt?: unknown
  pm?:
    | (PmDecisionProject["pm"] & {
        no?: string
        kind?: string
        holdWhy?: string | null
        cutPool?: number
        retentionHeld?: number
        retentionReleased?: boolean
        terms?: ContractTerms
        fin?: { contractValue: number; cost?: number | null; contractDays: number | null; actualDays: number | null; delayDays: number | null; closedOn: string; retentionHeld: number } | null
      })
    | null
}

export interface PortfolioFeed {
  ready: boolean
  money: boolean
  itemCount: number
  unpricedCount: number
  progress: number | null
  planned: number | null
  /** Points behind the plan (negative = ahead). */
  behind: number
  unbilled: number
  cash: number
  /** Σ quantity × estimated unit cost — the cost budget; 0 when nothing is estimated. */
  budget: number
  /** The contract value: the BOQ's value plus approved variations (INV-01), as Today reads it. */
  contract: number
  red: number
  obstacles: number
  overdue: number
  /** For a technically complete project: can it be archived now? */
  archivable: boolean | null
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export function usePortfolioFeed(project: PortfolioProject): PortfolioFeed {
  const firestore = useFirestore()
  const access = usePmAccess(project.id, project as { pm?: { lifecycle?: string } | null; status?: string; projectManagerId?: string | null })
  const money = access.has("money")
  const lifecycle = lifecycleOf(project as { pm?: { lifecycle?: string }; status?: string })
  const isPm = Boolean(project.pm)
  const done = isPm && lifecycle === "done"
  const fig = useProjectFigures(project.id, project, access)
  const { decisions, ready, facts } = usePmDecisions(project.id, isPm ? project : null, access)

  const sub = (name: string, on: boolean) => (firestore && on ? collection(firestore, "projects", project.id, name) : null)
  const itemsQ = useMemoFirebase(() => sub("boqItems", true), [firestore, project.id])
  const { data: items } = useCollection(itemsQ)
  const obsQ = useMemoFirebase(() => sub(PM_OBSTACLES, isPm), [firestore, project.id, isPm])
  const { data: obstacles } = useCollection(obsQ)
  const punchQ = useMemoFirebase(() => sub(PM_PUNCH, done), [firestore, project.id, done])
  const { data: punch } = useCollection(punchQ)
  const ncrQ = useMemoFirebase(() => sub(PM_NCRS, done), [firestore, project.id, done])
  const { data: ncrs } = useCollection(ncrQ)
  const voQ = useMemoFirebase(() => sub(PM_VARIATIONS, done), [firestore, project.id, done])
  const { data: vos } = useCollection(voQ)
  const certQ = useMemoFirebase(() => sub(PM_CERTIFICATES, done && money), [firestore, project.id, done, money])
  const { data: certs } = useCollection(certQ)

  return useMemo(() => {
    const rows = (items ?? []) as Array<Record<string, unknown>>
    const budget = rows.reduce((a, d) => a + num(d.quantity) * num(d.estCost), 0)
    const overdue = decisions.find((d) => d.kind === "collection_overdue")?.amount ?? 0
    let archivable: boolean | null = null
    if (done && project.pm) {
      const pm = project.pm
      archivable =
        closeBlocks(
          closeoutRows({
            hasClient: certificatesApply(pm.original ?? pm.terms, termsNow(pm)),
            acceptances: (pm.acceptances ?? {}) as Acceptances,
            punch: ((punch ?? []) as Array<{ status: PunchStatus }>).map((p) => ({ status: p.status })),
            ncrs: ((ncrs ?? []) as Array<{ status: NcrStatus }>).map((n) => ({ status: n.status })),
            variations: ((vos ?? []) as Array<{ status: VoStatus; value?: number; executedPct?: number; billedPct?: number }>).map((v) => ({ status: v.status, value: num(v.value), executedPct: num(v.executedPct), billedPct: num(v.billedPct) })),
            items: rows.map((d) => ({ rate: num(d.unitPrice), executed: num(d.executedQuantity), billed: num(d.billedQuantity) })),
            cutPool: pm.cutPool ?? 0,
            certificates: money ? ((certs ?? []) as unknown as PmCertificate[]) : [],
            retentionHeld: pm.retentionHeld ?? 0,
            retentionReleased: Boolean(pm.retentionReleased),
            today: todayDay(),
          })
        ).length === 0
    }
    return {
      ready: ready && !access.isLoading,
      money,
      itemCount: fig.itemCount,
      unpricedCount: fig.unpricedCount,
      progress: fig.progress,
      planned: fig.planned,
      behind: fig.behind,
      unbilled: fig.unbilled,
      cash: fig.cash,
      budget: Math.round(budget * 100) / 100,
      contract: Math.round(((project.budget ?? 0) + facts.approvedVariations) * 100) / 100,
      red: decisions.filter((d) => d.severity === "red").length,
      obstacles: ((obstacles ?? []) as unknown as PmObstacle[]).filter(isOpenObstacle).length,
      overdue,
      archivable,
    }
  }, [items, decisions, done, project.pm, project.budget, punch, ncrs, vos, certs, money, ready, access.isLoading, fig, obstacles, facts.approvedVariations])
}

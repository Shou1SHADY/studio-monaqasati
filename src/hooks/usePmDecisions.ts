"use client"

// One PM 1.0 project's computed decisions (DEC-01): reads what the viewer may
// read — terms and certificates only for money or approve holders, as the
// rules allow; the cost (for "damages above the margin") only for whoever sees
// both money and the client — and derives the list. Nothing here is stored.
// It also hands back the few site facts the Today figures show beside it.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePulseCost } from "@/hooks/usePulseCost"
import { progressOf, type Acceptances } from "@/lib/pm/acceptance"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { PM_LETTERS, type PmLetter } from "@/lib/pm/correspondence"
import { projectDecisions, type PmDecision } from "@/lib/pm/decisions"
import { lastCertificateDay, PM_DOCS, type PmDocument } from "@/lib/pm/documents"
import { todayDay } from "@/lib/pm/format"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { PM_SHEETS, type PmSheet } from "@/lib/pm/measurement"
import { PM_PLANT as PM_PLANT_ON_SITE, type PmPlant } from "@/lib/pm/plant"
import { PM_ACTIVITIES, type PmActivity } from "@/lib/pm/programme"
import { PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import { PM_SUBMITTALS, type PmSubmittal } from "@/lib/pm/sample"
import { isOpenObstacle, PM_OBSTACLES, type PmObstacle } from "@/lib/pm/site"
import { PM_STORE, storeLineOf, type PmStoreLine } from "@/lib/pm/store"
import { PM_SUB_CERTIFICATES } from "@/lib/pm/subcontract"
import { needsWithin, PM_PLANT as PM_PLANT_REQUESTS, PURCHASE_REQUESTS, reqState, requestOf, type PmPlantRequest } from "@/lib/pm/supply"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"
import { PM_VARIATIONS, type PmVariation } from "@/lib/pm/variation"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"
import { usePmPlan } from "@/hooks/usePmPlan"

export interface PmDecisionProject {
  budget?: number
  status?: string | null
  projectManagerId?: string | null
  organizationId?: string
  warehouseId?: string | null
  enabledSections?: string[]
  pm?: {
    lifecycle?: string
    terms?: ContractTerms
    original?: ContractTerms | null
    startOn?: string | null
    startedAt?: string | null
    holdSince?: string | null
    lastIpcOn?: string | null
    eac?: { on: string } | null
    durationDays?: number
    acceptances?: Acceptances
  } | null
}

/** Facts beside the decisions: open obstacles, requests awaiting approval,
 * materials short within 30 days, and the cost budget (Σ quantity × estimated
 * unit cost — 0 when nothing is estimated; shown to money holders only). */
export interface PmSiteFacts {
  openObstacles: number
  pendingRequests: number
  shortages: number
  costBudget: number
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

export function usePmDecisions(
  projectId: string,
  project: PmDecisionProject | null | undefined,
  access: PmAccess
): { decisions: PmDecision[]; progress: number | null; ready: boolean; facts: PmSiteFacts } {
  const on = Boolean(project?.pm)
  const seesTerms = access.has("money") || access.has("approve")
  const money = access.has("money")
  const client = access.has("client")
  const terms0 = project?.pm?.original ?? project?.pm?.terms ?? null
  const items = useSub<Record<string, unknown> & { id: string }>(projectId, "boqItems", on)
  const sheets = useSub<PmSheet>(projectId, PM_SHEETS, on)
  const addenda = useSub<PmAddendum>(projectId, PM_ADDENDA, on && seesTerms)
  const certs = useSub<PmCertificate>(projectId, PM_CERTIFICATES, on && money)
  const punch = useSub<PunchItem>(projectId, PM_PUNCH, on)
  const vos = useSub<PmVariation>(projectId, PM_VARIATIONS, on)
  const claims = useSub<PmClaim>(projectId, PM_CLAIMS, on)
  const submittals = useSub<PmSubmittal>(projectId, PM_SUBMITTALS, on)
  const subCerts = useSub<{ status: string; gross: number; prepOn: string }>(projectId, PM_SUB_CERTIFICATES, on)
  const docs = useSub<PmDocument>(projectId, PM_DOCS, on)
  const letters = useSub<PmLetter>(projectId, PM_LETTERS, on)
  const obstacles = useSub<PmObstacle>(projectId, PM_OBSTACLES, on)
  const plantRequests = useSub<PmPlantRequest>(projectId, PM_PLANT_REQUESTS, on)
  const plant = useSub<PmPlant>(projectId, PM_PLANT_ON_SITE, on)
  const reqRows = useSub<Record<string, unknown> & { id: string }>(projectId, PURCHASE_REQUESTS, on)
  const storeRows = useSub<Partial<PmStoreLine> & { id: string }>(projectId, PM_STORE, on)
  const activities = useSub<PmActivity>(projectId, PM_ACTIVITIES, on)
  const supply = useMemo(
    () => ({ requests: reqRows.rows.map(requestOf), stores: storeRows.rows.map((d) => storeLineOf(d.id, d)), activities: activities.rows }),
    [reqRows.rows, storeRows.rows, activities.rows]
  )
  const firestore = useFirestore()
  const approver = access.has("approve")
  const orgId = project?.organizationId ?? null
  const poQ = useMemoFirebase(
    () => (firestore && on && approver && orgId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null),
    [firestore, on, approver, orgId, projectId]
  )
  const { data: poData } = useCollection(poQ)
  const budgetReferrals = useMemo(
    () =>
      ((poData ?? []) as Array<{ status?: string; pmBudget?: { state?: string; over?: number | null; askedAt?: string | null } | null }>)
        .filter((po) => po.status === "awaiting_approval" && po.pmBudget?.state === "pending")
        .map((po) => ({ askedAt: po.pmBudget?.askedAt ?? null, over: po.pmBudget?.over ?? null })),
    [poData]
  )
  const damagesOn = Boolean(terms0?.damages?.on)
  const cost = usePulseCost(projectId, project?.organizationId ?? null, project?.warehouseId ?? null, project?.budget ?? 0, on && money && client && damagesOn)

  const today = todayDay()
  const planItems = useMemo(() => items.rows.map((d) => ({ id: d.id, quantity: num(d.quantity), rate: num(d.unitPrice) })), [items.rows])
  const plan = usePmPlan(projectId, project ?? null, planItems)
  const storeItems = useMemo(
    () => items.rows.map((d) => ({ id: d.id, code: String(d.itemNo ?? ""), description: "", unit: String(d.unit ?? ""), quantity: num(d.quantity), executed: num(d.executedQuantity) })),
    [items.rows]
  )
  const facts = useMemo<PmSiteFacts>(() => {
    const shortages = on ? needsWithin({ stores: supply.stores, items: storeItems, requests: supply.requests, activities: supply.activities, startOn: project?.pm?.startedAt ?? null, today }).gaps.length : 0
    return {
      openObstacles: obstacles.rows.filter(isOpenObstacle).length,
      pendingRequests: supply.requests.filter((r) => reqState(r) === "wait").length,
      shortages,
      costBudget: items.rows.reduce((a, d) => a + num(d.quantity) * num(d.estCost), 0),
    }
  }, [on, supply.stores, supply.requests, supply.activities, storeItems, project?.pm?.startedAt, today, obstacles.rows, items.rows])

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
        id: d.id,
        code: String(d.itemNo ?? ""),
        unit: String(d.unit ?? ""),
        quantity: num(d.quantity),
        rate: num(d.unitPrice),
        executed: num(d.executedQuantity),
        billed: num(d.billedQuantity),
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
      submittals: submittals.rows,
      subCertificates: subCerts.rows,
      documents: docs.rows,
      lastCertDay: money ? lastCertificateDay(certs.rows) : (pm.lastIpcOn ?? null),
      letters: letters.rows,
      obstacles: obstacles.rows,
      eac: pm.eac ?? null,
      holdSince: pm.holdSince ?? null,
      curveK: plan.curveK,
      sections: project.enabledSections?.length ? project.enabledSections : null,
      managerId: project.projectManagerId ?? null,
      requests: supply.requests,
      stores: supply.stores,
      shortages: facts.shortages,
      plantRequests: plantRequests.rows,
      plant: plant.rows,
      margin: cost ? cost.total.earned - cost.total.actual : null,
      budgetReferrals,
      today,
      viewer: access.uid ? { uid: access.uid, has: (k) => access.has(k as Parameters<PmAccess["has"]>[0]), owner: access.has("admin") } : null,
    })
  }, [project, items.rows, sheets.rows, addenda.rows, certs.rows, punch.rows, vos.rows, claims.rows, submittals.rows, subCerts.rows, docs.rows, letters.rows, obstacles.rows, supply.requests, supply.stores, facts.shortages, plantRequests.rows, plant.rows, cost, budgetReferrals, money, access, today, plan])

  const progress = useMemo(() => progressOf(items.rows.map((d) => ({ quantity: num(d.quantity), rate: num(d.unitPrice), executed: num(d.executedQuantity) }))), [items.rows])

  return { decisions, progress, ready: !items.isLoading && !sheets.isLoading, facts }
}

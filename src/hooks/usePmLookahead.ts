"use client"

// The three-week look-ahead of a PM project, computed from what the project
// already holds (activities, obstacles, permits, drawings, the last approved
// measurement, the BOQ lines' inspection and sample gates, the project store
// and material requests, the equipment requests). Shared by the weekly plan
// screen and the Execution sub-tab count.

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { staleDrawings, PM_DOCS, type PmDocument } from "@/lib/pm/documents"
import { PM_SHEETS, type PmSheet } from "@/lib/pm/measurement"
import { PM_ACTIVITIES } from "@/lib/pm/programme"
import { livePermits, PM_OBSTACLES, PM_PERMITS, type PmObstacle, type PmPermit } from "@/lib/pm/site"
import { PM_STORE, storeLineOf, type PmStoreLine } from "@/lib/pm/store"
import { PM_PLANT, PURCHASE_REQUESTS, requestOf } from "@/lib/pm/supply"
import { lookahead, lookObstacle, type LookActivity, type LookFacts, type LookItem, type LookPlant, type LookRow } from "@/lib/pm/weekly-plan"

export interface LookaheadSections {
  docs: boolean
  subm: boolean
  wir: boolean
  rfi: boolean
  hse: boolean
  /** The project store section — «مواد في الموقع». */
  stock?: boolean
  /** Equipment requests — «عمالة ومعدات». */
  eqp?: boolean
}

export function usePmLookahead(projectId: string, items: LookItem[], on: LookaheadSections, today: string, enabled = true): { rows: LookRow[]; facts: LookFacts; isLoading: boolean } {
  const firestore = useFirestore()
  const col = (name: string, want: boolean) => (firestore && enabled && want ? collection(firestore, "projects", projectId, name) : null)
  const actsQ = useMemoFirebase(() => col(PM_ACTIVITIES, true), [firestore, projectId, enabled])
  const obsQ = useMemoFirebase(() => col(PM_OBSTACLES, on.rfi), [firestore, projectId, enabled, on.rfi])
  const pmtQ = useMemoFirebase(() => col(PM_PERMITS, on.hse), [firestore, projectId, enabled, on.hse])
  const docsQ = useMemoFirebase(() => col(PM_DOCS, on.docs), [firestore, projectId, enabled, on.docs])
  const sheetsQ = useMemoFirebase(() => col(PM_SHEETS, on.docs), [firestore, projectId, enabled, on.docs])
  const storeQ = useMemoFirebase(() => col(PM_STORE, Boolean(on.stock)), [firestore, projectId, enabled, on.stock])
  const reqQ = useMemoFirebase(() => col(PURCHASE_REQUESTS, Boolean(on.stock)), [firestore, projectId, enabled, on.stock])
  const plantQ = useMemoFirebase(() => col(PM_PLANT, Boolean(on.eqp)), [firestore, projectId, enabled, on.eqp])
  const acts = useCollection(actsQ)
  const obs = useCollection(obsQ)
  const pmt = useCollection(pmtQ)
  const docs = useCollection(docsQ)
  const sheets = useCollection(sheetsQ)
  const store = useCollection(storeQ)
  const reqs = useCollection(reqQ)
  const plant = useCollection(plantQ)

  return useMemo(() => {
    const facts: LookFacts = {
      items,
      activities: (acts.data ?? []) as unknown as LookActivity[],
      obstacles: ((obs.data ?? []) as unknown as PmObstacle[]).map(lookObstacle),
      livePermits: livePermits((pmt.data ?? []) as unknown as PmPermit[], today).length,
      staleDrawings: staleDrawings((docs.data ?? []) as unknown as PmDocument[], (sheets.data ?? []) as unknown as PmSheet[]).length,
      stores: ((store.data ?? []) as Array<Partial<PmStoreLine> & { id: string }>).map((d) => storeLineOf(d.id, d)),
      requests: ((reqs.data ?? []) as Array<Record<string, unknown> & { id: string }>).map(requestOf),
      plant: (plant.data ?? []) as unknown as LookPlant[],
      on: { docs: on.docs, subm: on.subm, wir: on.wir, rfi: on.rfi, hse: on.hse, stock: Boolean(on.stock), eqp: Boolean(on.eqp) },
    }
    return { rows: lookahead(facts, today), facts, isLoading: acts.isLoading }
  }, [items, acts.data, acts.isLoading, obs.data, pmt.data, docs.data, sheets.data, store.data, reqs.data, plant.data, today, on.docs, on.subm, on.wir, on.rfi, on.hse, on.stock, on.eqp])
}

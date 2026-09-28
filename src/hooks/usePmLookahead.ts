"use client"

// The three-week look-ahead of a PM project, computed from what the project
// already holds (activities, obstacles, permits, drawings, the last approved
// measurement, the BOQ lines' inspection and sample gates). Shared by the
// weekly plan screen and the Execution sub-tab count.

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { staleDocuments, PM_DOCS, type PmDocument } from "@/lib/pm/documents"
import { lastApprovedDay, PM_SHEETS, type PmSheet } from "@/lib/pm/measurement"
import { PM_ACTIVITIES } from "@/lib/pm/programme"
import { livePermits, PM_OBSTACLES, PM_PERMITS, type PmObstacle, type PmPermit } from "@/lib/pm/site"
import { lookahead, type LookActivity, type LookFacts, type LookItem, type LookRow } from "@/lib/pm/weekly-plan"

export interface LookaheadSections {
  docs: boolean
  subm: boolean
  wir: boolean
  rfi: boolean
  hse: boolean
}

export function usePmLookahead(projectId: string, items: LookItem[], on: LookaheadSections, today: string, enabled = true): { rows: LookRow[]; facts: LookFacts; isLoading: boolean } {
  const firestore = useFirestore()
  const col = (name: string, want: boolean) => (firestore && enabled && want ? collection(firestore, "projects", projectId, name) : null)
  const actsQ = useMemoFirebase(() => col(PM_ACTIVITIES, true), [firestore, projectId, enabled])
  const obsQ = useMemoFirebase(() => col(PM_OBSTACLES, on.rfi), [firestore, projectId, enabled, on.rfi])
  const pmtQ = useMemoFirebase(() => col(PM_PERMITS, on.hse), [firestore, projectId, enabled, on.hse])
  const docsQ = useMemoFirebase(() => col(PM_DOCS, on.docs), [firestore, projectId, enabled, on.docs])
  const sheetsQ = useMemoFirebase(() => col(PM_SHEETS, on.docs), [firestore, projectId, enabled, on.docs])
  const acts = useCollection(actsQ)
  const obs = useCollection(obsQ)
  const pmt = useCollection(pmtQ)
  const docs = useCollection(docsQ)
  const sheets = useCollection(sheetsQ)

  return useMemo(() => {
    const lastDay = lastApprovedDay((sheets.data ?? []) as unknown as PmSheet[])
    const facts: LookFacts = {
      items,
      activities: (acts.data ?? []) as unknown as LookActivity[],
      obstacles: ((obs.data ?? []) as unknown as PmObstacle[]).map((o) => ({ title: o.title, party: o.partyName || o.party, itemIds: o.itemIds ?? [], closeOn: o.closeOn ?? null })),
      livePermits: livePermits((pmt.data ?? []) as unknown as PmPermit[], today).length,
      staleDrawings: staleDocuments((docs.data ?? []) as unknown as PmDocument[], lastDay).length,
      on: { docs: on.docs, subm: on.subm, wir: on.wir, rfi: on.rfi, hse: on.hse },
    }
    return { rows: lookahead(facts, today), facts, isLoading: acts.isLoading }
  }, [items, acts.data, acts.isLoading, obs.data, pmt.data, docs.data, sheets.data, today, on.docs, on.subm, on.wir, on.rfi, on.hse])
}

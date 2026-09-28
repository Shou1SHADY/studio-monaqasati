"use client"

// The Execution tab's sub-tab counts for SegmentedNav, read live (see
// src/lib/pm/exec-counts.ts for what each one counts).

import { useMemo } from "react"
import { collection } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { execCounts, type ExecCount } from "@/lib/pm/exec-counts"
import { PM_INSPECTIONS } from "@/lib/pm/inspection"
import { PM_SHEETS } from "@/lib/pm/measurement"
import { PM_NCRS } from "@/lib/pm/ncr"
import { PM_PUNCH } from "@/lib/pm/punch"
import { PM_OBSTACLES } from "@/lib/pm/site"
import { PM_SUB_CERTIFICATES } from "@/lib/pm/subcontract"
import type { LookItem } from "@/lib/pm/weekly-plan"
import { usePmLookahead, type LookaheadSections } from "./usePmLookahead"

export function usePmExecCounts(projectId: string, opts: { enabled: boolean; items: LookItem[]; sections: LookaheadSections; weeklyPlan: boolean; today: string }): Record<"pmMeasure" | "pmQa" | "pmSite" | "pmSubs", ExecCount> {
  const firestore = useFirestore()
  const on = opts.enabled
  const q = (name: string) => (firestore && on ? collection(firestore, "projects", projectId, name) : null)
  const sheets = useCollection(useMemoFirebase(() => q(PM_SHEETS), [firestore, projectId, on]))
  const wir = useCollection(useMemoFirebase(() => q(PM_INSPECTIONS), [firestore, projectId, on]))
  const punch = useCollection(useMemoFirebase(() => q(PM_PUNCH), [firestore, projectId, on]))
  const ncrs = useCollection(useMemoFirebase(() => q(PM_NCRS), [firestore, projectId, on]))
  const obs = useCollection(useMemoFirebase(() => q(PM_OBSTACLES), [firestore, projectId, on]))
  const subs = useCollection(useMemoFirebase(() => q(PM_SUB_CERTIFICATES), [firestore, projectId, on]))
  const look = usePmLookahead(projectId, opts.items, opts.sections, opts.today, on && opts.weeklyPlan)

  return useMemo(() => {
    const rows = <T,>(d: unknown) => (d ?? []) as T[]
    return execCounts({
      sheets: rows(sheets.data),
      inspections: rows(wir.data),
      punch: rows(punch.data),
      ncrs: rows(ncrs.data),
      obstacles: rows(obs.data),
      subCertificates: rows(subs.data),
      lookaheadBlocked: opts.weeklyPlan ? look.rows.filter((r) => r.block.length > 0).length : null,
    })
  }, [sheets.data, wir.data, punch.data, ncrs.data, obs.data, subs.data, look.rows, opts.weeklyPlan])
}

"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { noticesToForward, procNavBadges, publishProcNavBadges, readProcNavBadges, serverProcNavBadges, subscribeProcNavBadges, type ProcNavBadges } from "@/lib/procurement/nav-badges"
import type { ProcurementShell } from "@/hooks/useProcurementShell"

/** The page head's side: turns the numbers it already derived into the sidebar's counts and publishes them. */
export function useProcurementNavBadges(shell: Pick<ProcurementShell, "loading" | "counts" | "loaded">): ProcNavBadges {
  const badges = useMemo(() => procNavBadges(shell.counts, noticesToForward(shell.loaded.deliveries)), [shell.counts, shell.loaded.deliveries])
  const { loading } = shell
  useEffect(() => {
    if (!loading) publishProcNavBadges(badges)
  }, [loading, badges])
  return badges
}

/** The sidebar's side: the counts the last Procurement page published (none until one has). */
export const useProcurementNavBadgeFeed = (): ProcNavBadges => useSyncExternalStore(subscribeProcNavBadges, readProcNavBadges, serverProcNavBadges)

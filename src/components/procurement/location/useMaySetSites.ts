"use client"

import { useProcActor } from "@/hooks/useProcActor"

/** Who may add a delivery place (PRD §4 «يضبط المواقع»): the owner and whoever approves orders. */
export function useMaySetSites(): boolean {
  const { actor } = useProcActor()
  return actor.isOwner || actor.canApprove
}

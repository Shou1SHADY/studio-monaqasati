"use client"

// The RFQ runner for the list, the card and the RFQ page (`rfq-access.ts`):
// the procurement actor plus `rfq.manage`/`rfq.create`, and whether the owner
// has a procurement team — read from `useProcTeam`, so the RFQs and the rest of
// Procurement agree on when the owner only reads.

import { useMemo } from "react"
import { usePermissions } from "@/hooks/usePermissions"
import { useProcActor } from "@/hooks/useProcActor"
import { useProcTeam } from "@/hooks/useProcTeam"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"

export function useRfqRunner(projectId?: string): { runner: RfqWriteActor; orgId: string; orgName: string; isLoading: boolean } {
  const { actor, orgId, orgName, isLoading } = useProcActor(projectId)
  const { can } = usePermissions(projectId)
  const team = useProcTeam(actor.isOwner ? orgId : null, actor)
  const managesRfqs = can("rfq.manage") || can("rfq.create")
  const ownerHasTeam = actor.isOwner && team.ownerHasTeam
  const runner = useMemo<RfqWriteActor>(() => ({ ...actor, managesRfqs, ownerHasTeam }), [actor, managesRfqs, ownerHasTeam])
  return { runner, orgId, orgName, isLoading: isLoading || (actor.isOwner && team.loading) }
}

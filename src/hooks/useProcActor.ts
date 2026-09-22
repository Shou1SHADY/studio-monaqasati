"use client"

// Who is looking at Procurement (PRD 3.0 §3): the `ProcActor` every write and
// every derivation takes, resolved once from the team's permissions. UI-level
// — the rules re-check each act — and the price mask is UI-level too: a
// member holding only `po.expedite`/`deliveries.confirm` has the documents
// loaded (Firestore cannot hide a field) and the screens withhold amounts.

import { useMemo } from "react"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import type { ProcActor } from "@/lib/procurement/types"

export function useProcActor(projectId?: string): { actor: ProcActor; orgId: string; orgName: string; isLoading: boolean } {
  const { user, isUserLoading } = useUser()
  const { can, isOrgOwner, profile, isLoading } = usePermissions(projectId)

  const orgId = ((profile?.organizationId as string | undefined) || user?.uid || "") as string
  const orgName = ((profile?.companyName as string | undefined) || (profile?.name as string | undefined) || "") as string

  const actor = useMemo<ProcActor>(() => {
    const canPrepare = isOrgOwner || can("offers.accept")
    const canApprove = isOrgOwner || can("po.approve")
    return {
      uid: user?.uid || "",
      name: ((profile?.name as string | undefined) || user?.displayName || user?.email || "") as string,
      isOwner: isOrgOwner,
      canApprove,
      canPrepare,
      canExpedite: isOrgOwner || can("po.expedite") || canPrepare || canApprove,
      canReceive: isOrgOwner || can("deliveries.confirm"),
      seesPrices: isOrgOwner || can("offers.view") || canPrepare || canApprove,
    }
  }, [can, isOrgOwner, profile, user])

  return { actor, orgId, orgName, isLoading: isUserLoading || isLoading }
}

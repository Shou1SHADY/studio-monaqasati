"use client"

import { useMemo } from "react"
import { usePermissions } from "@/hooks/usePermissions"
import { DEFAULT_APPROVAL_LIMIT } from "@/lib/crm"

/**
 * How much this member may approve on a CRM opportunity before the price has
 * to escalate.
 *
 * The ceiling is derived from permissions the org already grants rather than
 * from a second role table nobody would remember to maintain: the org owner
 * signs anything, a member trusted to accept supplier offers on the platform
 * gets the standard limit, and everyone else records prices but cannot clear
 * them. Escalation is a workflow signal, not a security boundary — the
 * `crm.manage` rule in firestore.rules is what actually gates the write.
 */
export function useCrmApproval() {
  const { can, isOrgOwner, isLoading } = usePermissions()

  return useMemo(() => {
    const limit = isOrgOwner ? Number.POSITIVE_INFINITY : can("offers.accept") ? DEFAULT_APPROVAL_LIMIT : 0
    return {
      approvalLimit: limit,
      canApprovePrices: limit > 0,
      /** True when `amount` is beyond what this member can clear alone. */
      needsEscalation: (amount: number) => amount > limit,
      isLoading,
    }
  }, [can, isOrgOwner, isLoading])
}

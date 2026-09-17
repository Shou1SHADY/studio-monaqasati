"use client"

// Who sees what in Sales (PRD §3, D10, INV-08): the owner and the sales
// manager (`sales.approve`) see every client, and cost and margin; a rep
// (`sales.manage`) sees his own clients' requests, quotes and orders — and
// never a cost.

import { useCallback, useMemo } from "react"
import { useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import type { CrmContact } from "@/lib/crm"
import { inSalesScope, type SalesViewer } from "@/lib/sales-quotes"

export function useSalesScope(contacts: Array<Pick<CrmContact, "id" | "ownerId">>) {
  const { user } = useUser()
  const { can, isOrgOwner, isLoading } = usePermissions()
  const seesAll = isOrgOwner || can("sales.approve")
  const viewer = useMemo<SalesViewer>(() => ({ userId: user?.uid || "", seesAll }), [user?.uid, seesAll])
  const ownerByContact = useMemo(() => new Map(contacts.map((c) => [c.id, c.ownerId ?? null])), [contacts])

  /** A request, quote, order or note — anything carrying its client's id. */
  const mine = useCallback(
    (record: { contactId?: string | null; createdByUserId?: string | null }) =>
      inSalesScope(viewer, { contactOwnerId: record.contactId ? ownerByContact.get(record.contactId) ?? null : null, createdByUserId: record.createdByUserId ?? null }),
    [viewer, ownerByContact]
  )

  return { viewer, seesAll, seesCost: seesAll, mine, isLoading }
}

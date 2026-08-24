"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import {
  CRM_CONTACTS,
  CRM_OPPORTUNITIES,
  CRM_QUOTATIONS,
  type CrmContact,
  type CrmOpportunity,
  type CrmQuotation,
} from "@/lib/crm"

export interface TeamMember {
  id: string
  name: string
}

/**
 * Every CRM page needs the same three things: which organization the signed-in
 * member is acting for, that org's contacts (for names, pickers and the leads
 * list) and its team (for the owner dropdown). Loading them here keeps the
 * queries identical across the contractor and supplier portals — the ONLY
 * thing separating the two portals' data is this `organizationId`.
 *
 * Opportunities and quotations are opt-in: the leads list does not need them,
 * so it does not pay for the listener.
 */
export function useCrmData(options?: { opportunities?: boolean; quotations?: boolean }) {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { organizationId, isLoading: isProfileLoading } = useResolvedProfile(isUserLoading ? null : user?.uid)
  const orgId = organizationId || ""

  const contactsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, CRM_CONTACTS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: contactsData, isLoading: contactsLoading } = useCollection(contactsQuery)

  const teamQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, "users"), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: teamData } = useCollection(teamQuery)

  const oppsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !options?.opportunities) return null
    return query(collection(firestore, CRM_OPPORTUNITIES), where("organizationId", "==", orgId))
  }, [firestore, orgId, options?.opportunities])
  const { data: oppsData, isLoading: oppsLoading } = useCollection(oppsQuery)

  const quotesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !options?.quotations) return null
    return query(collection(firestore, CRM_QUOTATIONS), where("organizationId", "==", orgId))
  }, [firestore, orgId, options?.quotations])
  const { data: quotesData, isLoading: quotesLoading } = useCollection(quotesQuery)

  const contacts = useMemo(() => (contactsData || []) as CrmContact[], [contactsData])
  const opportunities = useMemo(() => (oppsData || []) as CrmOpportunity[], [oppsData])
  const quotations = useMemo(() => (quotesData || []) as CrmQuotation[], [quotesData])

  const teamMembers = useMemo<TeamMember[]>(
    () =>
      ((teamData || []) as { id: string; name?: string; email?: string }[]).map((m) => ({
        id: m.id,
        name: m.name || m.email || m.id,
      })),
    [teamData]
  )

  const contactsById = useMemo(() => {
    const map = new Map<string, CrmContact>()
    for (const c of contacts) map.set(c.id, c)
    return map
  }, [contacts])

  return {
    orgId,
    contacts,
    contactsById,
    opportunities,
    quotations,
    teamMembers,
    isLoading:
      isUserLoading ||
      isProfileLoading ||
      contactsLoading ||
      (!!options?.opportunities && oppsLoading) ||
      (!!options?.quotations && quotesLoading),
  }
}

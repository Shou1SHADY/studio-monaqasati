"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import {
  CRM_ACTIVITIES,
  CRM_CONTACTS,
  CRM_OPPORTUNITIES,
  CRM_QUOTATIONS,
  type CrmActivity,
  type CrmContact,
  type CrmOpportunity,
  type CrmQuotation,
} from "@/lib/crm"
import { SALES_QUOTE_REQUESTS, type QuoteRequest } from "@/lib/sales-transfers"

export interface TeamMember {
  id: string
  name: string
  /** The member's default permission group — copied onto a project
   * assignment when a deal is handed to them, so their project access
   * matches their org access. */
  defaultGroupId?: string | null
}

/**
 * Every CRM page needs the same three things: which organization the signed-in
 * member is acting for, that org's contacts (for names, pickers and the leads
 * list) and its team (for the owner dropdown). Loading them here keeps the
 * queries identical across the contractor and supplier portals — the ONLY
 * thing separating the two portals' data is this `organizationId`.
 *
 * Opportunities, quotations and activities are opt-in: the leads list does not
 * need them, so it does not pay for the listener.
 */
export function useCrmData(options?: {
  opportunities?: boolean
  quotations?: boolean
  activities?: boolean
  /** Sales' pricing requests — where each deal's pricing stands (Opportunity journey v1.1, OPP-04). */
  quoteRequests?: boolean
}) {
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

  const requestsQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !options?.quoteRequests) return null
    return query(collection(firestore, SALES_QUOTE_REQUESTS), where("organizationId", "==", orgId))
  }, [firestore, orgId, options?.quoteRequests])
  const { data: requestsData, isLoading: requestsLoading } = useCollection(requestsQuery)

  const activitiesQuery = useMemoFirebase(() => {
    if (!firestore || !orgId || !options?.activities) return null
    return query(collection(firestore, CRM_ACTIVITIES), where("organizationId", "==", orgId))
  }, [firestore, orgId, options?.activities])
  const { data: activitiesData, isLoading: activitiesLoading } = useCollection(activitiesQuery)

  const contacts = useMemo(() => (contactsData || []) as CrmContact[], [contactsData])
  const opportunities = useMemo(() => (oppsData || []) as CrmOpportunity[], [oppsData])
  const quotations = useMemo(() => (quotesData || []) as CrmQuotation[], [quotesData])
  const activities = useMemo(() => (activitiesData || []) as CrmActivity[], [activitiesData])
  const quoteRequests = useMemo(() => (requestsData || []) as QuoteRequest[], [requestsData])
  // Who is acting — every stage move, decision and file is recorded in this name (OPP-01 #2, OPP-10).
  const actor = useMemo(() => {
    const uid = user?.uid || ""
    const me = (teamData || []).find((m) => (m as { id: string }).id === uid) as { name?: string; email?: string } | undefined
    return { uid, name: me?.name || me?.email || user?.displayName || user?.email || "" }
  }, [teamData, user])

  const teamMembers = useMemo<TeamMember[]>(
    () =>
      ((teamData || []) as { id: string; name?: string; email?: string; defaultGroupId?: string | null }[]).map((m) => ({
        id: m.id,
        name: m.name || m.email || m.id,
        defaultGroupId: m.defaultGroupId ?? null,
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
    activities,
    quoteRequests,
    actor,
    teamMembers,
    isLoading:
      isUserLoading ||
      isProfileLoading ||
      contactsLoading ||
      (!!options?.opportunities && oppsLoading) ||
      (!!options?.quotations && quotesLoading) ||
      (!!options?.activities && activitiesLoading) ||
      (!!options?.quoteRequests && requestsLoading),
  }
}

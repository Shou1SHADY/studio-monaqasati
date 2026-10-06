"use client"

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import {
  buildClientRows,
  buildLeadRows,
  deriveContacts,
  leadMatches,
  type ClientRecord,
  type ClientUser,
  type CrmActivity,
  type DealDoc,
  type LeadDoc,
} from "@/lib/admin-crm"

export type StaffUser = { id: string; name?: string; email?: string }

export const staffName = (u: StaffUser): string => u.name?.trim() || u.email || u.id

/** Everything the platform staff's client CRM reads — one set of listeners shared by the tabs and the file pages. */
export function useAdminCrm() {
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const ready = !isUserLoading && !!user && !!firestore

  const usersQuery = useMemoFirebase(() => (ready ? query(collection(firestore!, "users"), where("role", "in", ["Contractor", "Supplier"])) : null), [firestore, ready])
  const staffQuery = useMemoFirebase(() => (ready ? query(collection(firestore!, "users"), where("role", "==", "Admin")) : null), [firestore, ready])
  const recordsQuery = useMemoFirebase(() => (ready ? collection(firestore!, "adminCrmClients") : null), [firestore, ready])
  const activitiesQuery = useMemoFirebase(() => (ready ? collection(firestore!, "adminCrmActivities") : null), [firestore, ready])
  const dealsQuery = useMemoFirebase(() => (ready ? collection(firestore!, "adminCrmDeals") : null), [firestore, ready])
  const demoQuery = useMemoFirebase(() => (ready ? collection(firestore!, "demoRequests") : null), [firestore, ready])
  const onboardingQuery = useMemoFirebase(() => (ready ? collection(firestore!, "onboardingRequests") : null), [firestore, ready])

  const { data: demoDocs, isLoading: demoLoading } = useCollection<Omit<LeadDoc, "id" | "source"> & { origin?: string }>(demoQuery)
  const { data: onboardingDocs, isLoading: onboardingLoading } = useCollection<Omit<LeadDoc, "id" | "source">>(onboardingQuery)
  const { data: users, isLoading: usersLoading } = useCollection<ClientUser>(usersQuery)
  const { data: staff } = useCollection<StaffUser>(staffQuery)
  const { data: records } = useCollection<ClientRecord>(recordsQuery)
  const { data: dealDocs } = useCollection<Omit<DealDoc, "id">>(dealsQuery)
  const { data: activityDocs, isLoading: activitiesLoading } = useCollection<Omit<CrmActivity, "id">>(activitiesQuery)

  const recordsById = useMemo(() => {
    const byId: Record<string, ClientRecord> = {}
    for (const r of records ?? []) byId[r.id] = r
    return byId
  }, [records])
  const activities = useMemo<CrmActivity[]>(() => (activityDocs ?? []).map((a) => ({ ...a, id: a.id })) as CrmActivity[], [activityDocs])
  /** Quotes per record id (a client's count also includes the lead it came from — callers add that). */
  const quoteCount = useMemo(() => {
    const out: Record<string, number> = {}
    for (const d of dealDocs ?? []) if (d.kind === "quote") out[d.clientId] = (out[d.clientId] ?? 0) + 1
    return out
  }, [dealDocs])
  const derived = useMemo(() => deriveContacts(activities), [activities])

  const leadRows = useMemo(() => {
    const docs: LeadDoc[] = [
      ...(demoDocs ?? []).map((d) => ({ ...d, source: d.origin === "manual" ? ("manual" as const) : ("demo" as const) })),
      ...(onboardingDocs ?? []).map((d) => ({ ...d, source: "onboarding" as const })),
    ]
    return buildLeadRows(docs, recordsById, new Date(), derived)
  }, [demoDocs, onboardingDocs, recordsById, derived])
  const clientRows = useMemo(() => buildClientRows(users ?? [], recordsById, new Date(), derived), [users, recordsById, derived])
  const dismissed = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const r of records ?? []) if (r.notDuplicateOf?.length) out[r.id] = r.notDuplicateOf
    return out
  }, [records])
  const matches = useMemo(() => leadMatches(leadRows, clientRows.map((r) => ({ name: r.name, email: r.email, phone: r.phone })), dismissed), [leadRows, clientRows, dismissed])

  return {
    user,
    staff: staff ?? [],
    records: recordsById,
    activities,
    quoteCount,
    leadRows,
    clientRows,
    matches,
    leadDocs: { demo: demoDocs ?? [], onboarding: onboardingDocs ?? [] },
    loading: { leads: demoLoading || onboardingLoading, clients: usersLoading, activities: activitiesLoading },
  }
}

export type AdminCrm = ReturnType<typeof useAdminCrm>

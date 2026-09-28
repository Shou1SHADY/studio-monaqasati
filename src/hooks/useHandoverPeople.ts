"use client"

// Who a handover can go to (the prototype's approvers and site staff): each org
// member with the PM ceiling their DEFAULT group gives them, the approval limit
// that follows, and the live projects each already manages — the load a
// reassignment and the manager picker weigh.

import { useMemo } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { legacyAwareRole, usePermissions } from "@/hooks/usePermissions"
import { pmCeiling, type PmKey } from "@/lib/pm/access"
import { handoverCandidates, type HandoverCandidate } from "@/lib/pm/handover"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { pmApprovalLimit } from "@/lib/pm/subcontract"

export interface HandoverPerson {
  uid: string
  name: string
  groupId: string | null
  owner: boolean
  ceiling: ReadonlySet<PmKey>
  seat: "owner" | "pm" | "qs" | "site"
}

export function useHandoverPeople(orgId: string | null | undefined): {
  people: HandoverPerson[]
  candidates: (exclude?: string | null) => HandoverCandidate[]
  siteStaff: HandoverPerson[]
  liveOf: (uid: string) => number
  isLoading: boolean
} {
  const firestore = useFirestore()
  const { orgMembers, isLoading: membersLoading } = useOrgMembers(orgId ?? undefined)
  const { groups } = usePermissions()
  const projectsQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projectData } = useCollection(projectsQ)

  return useMemo(() => {
    const perms = new Map(groups.map((g) => [g.id, (g.permissions as string[]) ?? []]))
    const people: HandoverPerson[] = orgMembers.map((m) => {
      const owner = legacyAwareRole(m) === "owner"
      const groupId = (m.defaultGroupId as string | undefined) ?? null
      const ceiling = pmCeiling({ owner, permissions: perms.get(groupId ?? "") ?? [] })
      const seat = ceiling.has("admin") ? "owner" : ceiling.has("approve") ? "pm" : ceiling.has("all") ? "qs" : "site"
      return { uid: m.id, name: (m.name as string | undefined) || (m.email as string | undefined) || m.id, groupId, owner: ceiling.has("admin"), ceiling, seat }
    })
    const projects = ((projectData ?? []) as Array<{ projectManagerId?: string | null; pm?: { lifecycle?: string } | null; status?: string }>).map((p) => ({
      managerId: p.projectManagerId ?? null,
      lifecycle: lifecycleOf(p),
    }))
    const approvers = people.map((p) => ({ uid: p.uid, name: p.name, approves: p.ceiling.has("approve"), owner: p.owner, limit: pmApprovalLimit(p.ceiling) }))
    return {
      people,
      candidates: (exclude?: string | null) => handoverCandidates(approvers, projects, exclude),
      siteStaff: people.filter((p) => p.ceiling.has("measure") || p.ceiling.has("daily")),
      liveOf: (uid: string) => projects.filter((p) => p.managerId === uid && p.lifecycle === "live").length,
      isLoading: membersLoading,
    }
  }, [orgMembers, groups, projectData, membersLoading])
}

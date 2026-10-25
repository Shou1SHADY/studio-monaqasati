// PM 1.1 — the guard's context on the server (Admin SDK; never import it in a
// client component). The same three layers usePmAccess builds in the browser:
// the system ceiling from the caller's DEFAULT group (owner / '*' = everything;
// an account with no `organizationRole` is a legacy solo owner), the live seat
// from `projects/{id}/members/{uid}`, and archived / managerless from the
// project as it stands. A route re-runs the guard with it inside its
// transaction, exactly as the client writes do.

import type { Firestore } from "firebase-admin/firestore"
import { pmCeiling, seatActive, seatFromMember, type PmContext } from "./access"
import { lifecycleOf } from "./lifecycle"

export interface PmCaller {
  uid: string
  name: string | null
  orgId: string
  owner: boolean
  permissions: string[]
}

/** Who is calling, as the PM guard reads it; null without a profile. */
export async function pmCallerOf(db: Firestore, uid: string): Promise<PmCaller | null> {
  const profile = (await db.collection("users").doc(uid).get()).data() as Record<string, unknown> | undefined
  if (!profile) return null
  const orgId = (typeof profile.organizationId === "string" && profile.organizationId) || uid
  const owner = !("organizationRole" in profile) || profile.organizationRole === "owner"
  const groupId = typeof profile.defaultGroupId === "string" ? profile.defaultGroupId : null
  let permissions: string[] = []
  if (groupId) {
    const group = (await db.collection("teamGroups").doc(groupId).get()).data() as { organizationId?: string; permissions?: unknown } | undefined
    if (group && group.organizationId === orgId && Array.isArray(group.permissions)) permissions = group.permissions.filter((p): p is string => typeof p === "string")
  }
  const name = (typeof profile.name === "string" && profile.name) || (typeof profile.email === "string" && profile.email) || null
  return { uid, name, orgId, owner, permissions }
}

type ProjectLike = { pm?: { lifecycle?: string | null } | null; status?: string | null; projectManagerId?: string | null }

/** The caller's context on this project: the seat is read live, and an exit dated today closes it (TM-01). */
export function pmContextFrom(caller: PmCaller, project: ProjectLike, member: Record<string, unknown> | null | undefined, today: string): PmContext {
  const seat = seatFromMember(member ?? null, caller.uid)
  return {
    ceiling: pmCeiling({ owner: caller.owner, permissions: caller.permissions }),
    seat: seat && seatActive(seat, today) ? seat : null,
    archived: Boolean(project.pm) && lifecycleOf(project) === "closed",
    managerless: Boolean(project.pm) && !project.projectManagerId,
  }
}

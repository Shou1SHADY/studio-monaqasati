// Server-only — the consultant portal's pieces that need the Admin SDK: who is
// calling (in the PM guard's terms), what a send does to the project's links,
// and what a change of the consultant's representative revokes (PRJ-01, CP-02,
// CP-03). The pure decisions are exported for the tests. Never import in
// client components.

import type { Firestore } from "firebase-admin/firestore"
import { pmCeiling, seatActive, seatFromMember, type PmContext } from "./access"
import type { ConsultantRep } from "./consultant-portal"
import { lifecycleOf } from "./lifecycle"
import { appendLog, linkRefusal, riyadhDay, type PmPortalLink, type PortalLogEntry } from "./portal-links"

export interface PmCaller {
  uid: string
  name: string
  orgId: string
  ctx: PmContext
}

/** The caller's PM context on this project — the server's twin of `usePmAccess`:
 * the ceiling from the DEFAULT group (the owner's when the account owns the org,
 * a legacy account without `organizationRole` included), the live seat from
 * `projects/{id}/members/{uid}`, archived = closed, managerless = no manager. */
export async function pmCallerContext(
  db: Firestore,
  uid: string,
  projectId: string,
  project: { organizationId?: string; pm?: unknown; status?: string | null; projectManagerId?: string | null }
): Promise<PmCaller | null> {
  const profile = (await db.collection("users").doc(uid).get()).data() as Record<string, unknown> | undefined
  if (!profile) return null
  const orgId = (profile.organizationId as string) || uid
  if (project.organizationId !== orgId) return null
  const owner = !("organizationRole" in profile) || profile.organizationRole === "owner"
  const groupId = (profile.defaultGroupId as string | undefined) || null
  const group = groupId ? (await db.collection("teamGroups").doc(groupId).get()).data() : undefined
  const permissions = group && group.organizationId === orgId && Array.isArray(group.permissions) ? (group.permissions as string[]) : []
  const member = (await db.collection("projects").doc(projectId).collection("members").doc(uid).get()).data()
  const seat = seatFromMember(member, uid)
  const live = seat && seatActive(seat, riyadhDay(Date.now())) ? seat : null
  return {
    uid,
    name: (profile.name as string) || (profile.email as string) || "",
    orgId,
    ctx: {
      ceiling: pmCeiling({ owner, permissions }),
      seat: live,
      archived: Boolean(project.pm) && lifecycleOf(project as { pm?: { lifecycle?: string } }) === "closed",
      managerless: Boolean(project.pm) && !project.projectManagerId,
    },
  }
}

/** CP-03: a change of the representative's name or mobile revokes the open link
 * (the SMS went to someone else); removing the consultant revokes it too. An
 * e-mail or a spelling of the company name changes nothing. */
export function repChangeRevokes(
  before: { consultant?: string | null; rep?: Partial<ConsultantRep> | null },
  after: { consultant: string | null; rep: ConsultantRep | null }
): "consultant_removed" | "rep_changed" | null {
  if (before.consultant?.trim() && !after.consultant?.trim()) return "consultant_removed"
  const b = before.rep ?? {}
  const a = after.rep ?? { name: null, phone: null, email: null }
  if ((b.phone ?? null) !== (a.phone ?? null) || (b.name?.trim() || null) !== (a.name?.trim() || null)) return "rep_changed"
  return null
}

/** What a send does: reuse the live link to the same mobile (a new code on the
 * same link, counted), else make a new one and revoke every other open link. */
export function planSend(links: Array<{ id: string; link: PmPortalLink }>, phone: string, now: number): { reuse: string | null; revoke: string[] } {
  const live = links
    .filter((l) => !linkRefusal(l.link, now) && l.link.consultant?.phone === phone)
    .sort((a, b) => (a.link.createdAt < b.link.createdAt ? 1 : -1))[0]
  return {
    reuse: live ? live.id : null,
    revoke: links.filter((l) => l.link.status === "open" && l.id !== live?.id).map((l) => l.id),
  }
}

/** The patch that revokes a link, with its log line. */
export const revokePatch = (link: Pick<PmPortalLink, "log">, why: NonNullable<PortalLogEntry["why"]>, byName: string, nowIso: string) => ({
  status: "revoked" as const,
  sessions: [],
  revokedAt: nowIso,
  revokedWhy: why,
  log: appendLog(link.log, { t: "revoke", at: nowIso, byName, why }),
})

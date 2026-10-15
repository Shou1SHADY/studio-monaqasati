// Server-side twin of `emitProcEvent` for the routes that must enforce a rule before they write (the supplier's
// invoice, the visitor's account). The notification document is the same pure `buildProcNotification` — only the
// writer differs (Admin SDK). Best-effort: a lost notification never undoes the act it reports.

import type { Firestore } from "firebase-admin/firestore"
import { buildProcNotification, procEventKey, type ProcEvent } from "@/lib/procurement/events"
import { resolveRecipients, type TeamSnapshot } from "@/lib/mfg-events"
import type { PermissionId, TeamGroup } from "@/lib/permissions"

/** The holders of these permissions in a company (its owner always among them) — the team read with the Admin SDK. */
export async function permissionHolders(db: Firestore, orgId: string, permissions: readonly PermissionId[]): Promise<string[]> {
  if (!permissions.length || !orgId) return []
  const [users, groups] = await Promise.all([db.collection("users").where("organizationId", "==", orgId).get(), db.collection("teamGroups").where("organizationId", "==", orgId).get()])
  const team: TeamSnapshot = {
    ownerId: orgId,
    members: users.docs.map((d) => {
      const u = d.data() as { defaultGroupId?: string | null; organizationRole?: string | null }
      return { id: d.id, defaultGroupId: u.defaultGroupId ?? null, organizationRole: "organizationRole" in u ? (u.organizationRole ?? null) : "owner" }
    }),
    groups: groups.docs.map((d) => ({ id: d.id, permissions: ((d.data() as { permissions?: TeamGroup["permissions"] }).permissions || []) as TeamGroup["permissions"] })),
    departments: [],
  }
  return resolveRecipients(team, permissions.map((permission) => ({ permission })), "")
}

export async function notifyNamed(
  db: Firestore,
  actor: { uid: string; name: string },
  e: Omit<ProcEvent, "to">,
  users: (string | null | undefined)[],
  opts: { owner?: boolean; permissions?: readonly PermissionId[] } = {}
): Promise<number> {
  const holders = opts.permissions?.length ? await permissionHolders(db, e.organizationId, opts.permissions).catch(() => [] as string[]) : []
  const recipients = [...new Set([...users, ...holders, ...(opts.owner === false ? [] : [e.organizationId])].filter((x): x is string => !!x && x !== actor.uid))]
  const at = new Date().toISOString()
  const key = procEventKey({ kind: e.kind, poId: e.poId })
  await Promise.all(
    recipients.map((uid) => {
      const box = db.collection("users").doc(uid).collection("notifications")
      const ref = key ? box.doc(key) : box.doc()
      return ref.set(buildProcNotification({ ...e, to: [] }, actor, uid, at)).catch((err) => console.warn("notification failed:", (err as { code?: string })?.code || err))
    })
  )
  return recipients.length
}

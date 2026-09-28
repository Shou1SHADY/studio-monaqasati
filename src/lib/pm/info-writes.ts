// PM 1.0 — the project's file (the prototype's formEdit and the org's recorded
// self-approval). On a PM project only the location and the consultant are
// edited here, by whoever approves: the client, the value, the duration and
// the signing date come from the handover — value changes by variation,
// duration by extension, terms by addendum, the manager in Team.
// Self-approval is the company's decision (admin), org-wide and recorded by
// name and date; the certificate write reads it inside its own transaction.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, PmAccessError, type PmContext } from "./access"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"

export class PmInfoError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "too_long") {
    super(code)
    this.name = "PmInfoError"
  }
}

export interface InfoActor {
  uid: string
  name: string | null
}

/** The fields a PM project's file lets `project.edit` change — nothing else. */
export const PM_INFO_FIELDS = ["location", "consultant"] as const

export async function updatePmInfo(firestore: Firestore, ctx: PmContext, projectId: string, input: { location: string; consultant: string }): Promise<void> {
  const location = input.location.trim()
  const consultant = input.consultant.trim()
  if (location.length > 200 || consultant.length > 200) throw new PmInfoError("too_long")
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, "projects", projectId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmInfoError("missing")
    const project = snap.data() as { pm?: unknown; status?: string; projectManagerId?: string | null }
    if (!project.pm) throw new PmInfoError("not_pm_project")
    assertPm(withFreshState(ctx, project), "project.edit")
    tx.update(ref, { location: location || null, consultant: consultant || null, updatedAt: serverTimestamp() })
  })
}

/** `pmSettings/{orgId}` — the company's PM policies. */
export const PM_SETTINGS = "pmSettings"

export interface PmOrgSettings {
  selfApproval?: boolean
  selfApprovalBy?: string | null
  selfApprovalByName?: string | null
  selfApprovalOn?: string | null
}

export async function readSelfApproval(tx: Transaction, firestore: Firestore, orgId: string | undefined | null): Promise<boolean> {
  if (!orgId) return false
  const snap = await tx.get(doc(firestore, PM_SETTINGS, orgId))
  return snap.exists() && (snap.data() as PmOrgSettings).selfApproval === true
}

export async function setSelfApproval(firestore: Firestore, ctx: PmContext, orgId: string, actor: InfoActor, allowed: boolean): Promise<void> {
  if (!ctx.ceiling.has("admin")) throw new PmAccessError("owner_only", "settings.selfApproval")
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, PM_SETTINGS, orgId)
    await tx.get(ref)
    tx.set(ref, { organizationId: orgId, selfApproval: allowed, selfApprovalBy: actor.uid, selfApprovalByName: actor.name, selfApprovalOn: todayDay(), updatedAt: serverTimestamp() }, { merge: true })
  })
}

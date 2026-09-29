// PM 1.0 — approving the monthly reconciliation (CVR-01, WF-22). The project
// manager approves the estimate at completion shown on screen; it is kept on
// the project (`pm.eac`) and sent to Finance as prj:BUD:<project>:<rev>, one
// document per approval (the outbox is append-only), the highest revision in
// force. The estimate itself is derived from orders, receipts, issues and
// subcontracts the transaction cannot re-read in full, so the screen's figure
// is what gets approved — and recorded with who approved it and when.

import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { budgetEvent, estimateBlocks, type ApprovedEstimate, type ProjectCost } from "./cost"
import { eventDocId, PM_EVENTS } from "./events"
import { todayDay } from "./format"
import { lifecycleOf } from "./lifecycle"
import { withFreshState } from "./project-writes"

export class PmCvrError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmCvrError"
  }
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: Record<string, unknown> & { no?: string; budCount?: number; lifecycle?: string } }

export async function approveReconciliation(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: { uid: string; name: string | null },
  cost: Pick<ProjectCost, "forecastCost" | "contract" | "actual" | "forecastMargin" | "estimatedLines">
): Promise<ApprovedEstimate> {
  let out: ApprovedEstimate = { v: 0, on: "", by: "", rev: 0 }
  await runTransaction(firestore, async (tx) => {
    const pRef = doc(firestore, "projects", projectId)
    const snap = await tx.get(pRef)
    if (!snap.exists()) throw new PmCvrError("missing")
    const project = snap.data() as ProjectData
    const pm = project.pm
    if (!pm) throw new PmCvrError("not_pm_project")
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "reconciliation.manage")
    const blocks = estimateBlocks({ archived: fresh.archived, lifecycle: lifecycleOf(project), estimate: cost.forecastCost, estimatedLines: cost.estimatedLines })
    if (blocks.length) throw new PmCvrError("blocked", blocks)
    const rev = (pm.budCount ?? 0) + 1
    const eac: ApprovedEstimate = { v: Math.round(cost.forecastCost * 100) / 100, on: todayDay(), by: actor.uid, byName: actor.name, rev }
    const event = budgetEvent({ organizationId: project.organizationId ?? "", projectId, projectNo: pm.no ?? projectId, rev, cost, by: actor.uid, at: new Date().toISOString() })
    tx.update(pRef, { pm: { ...pm, eac, budCount: rev }, updatedAt: serverTimestamp() })
    tx.set(doc(firestore, PM_EVENTS, eventDocId(event.key)), event)
    out = eac
  })
  return out
}

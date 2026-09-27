// PM 1.0 — non-conformance writes (WF-18). Recorded by quality (`qa`), one
// transaction each with the guard first; the project numbers them.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { todayDay } from "./format"
import { ncrBlocks, ncrNo, ncrStepBlocks, PM_NCRS, type NcrSeverity, type PmNcr } from "./ncr"
import { withFreshState } from "./project-writes"

export class PmNcrError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmNcrError"
  }
}

export interface NcrActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; ncrCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmNcrError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmNcrError("not_pm_project")
  return { ref, project, pm: project.pm }
}

export async function raiseNcr(firestore: Firestore, ctx: PmContext, projectId: string, actor: NcrActor, input: { itemId: string; severity: NcrSeverity; root: string; cost: number }): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const item = await tx.get(doc(firestore, "projects", projectId, "boqItems", input.itemId))
    const blocks = ncrBlocks({ archived: fresh.archived, itemId: item.exists() ? input.itemId : null, root: input.root, cost: input.cost })
    if (blocks.length) throw new PmNcrError("blocked", blocks)
    seq = (pm.ncrCount ?? 0) + 1
    const ncr: Omit<PmNcr, "id"> = {
      seq,
      itemId: input.itemId,
      code: (item.data() as { itemNo?: string }).itemNo ?? null,
      severity: input.severity,
      root: input.root.trim(),
      cost: input.cost,
      status: "open",
      day: todayDay(),
      by: actor.uid,
      byName: actor.name,
      plan: null,
      accepted: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_NCRS, ncrNo(seq)), { ...ncr, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, ncrCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

async function step(firestore: Firestore, ctx: PmContext, projectId: string, seq: number, which: "plan" | "accept", text: string | null, patch: () => Record<string, unknown>) {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const ref = doc(firestore, "projects", projectId, PM_NCRS, ncrNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmNcrError("missing")
    const ncr = snap.data() as PmNcr
    const blocks = ncrStepBlocks({ archived: fresh.archived, status: ncr.status, step: which, text })
    if (blocks.length) throw new PmNcrError("blocked", blocks)
    tx.update(ref, { ...patch(), updatedAt: serverTimestamp() })
  })
}

/** The corrective plan is submitted. */
export const submitNcrPlan = (firestore: Firestore, ctx: PmContext, projectId: string, actor: NcrActor, seq: number, text: string) =>
  step(firestore, ctx, projectId, seq, "plan", text, () => ({ status: "plan", plan: { on: todayDay(), by: actor.uid, byName: actor.name, text: text.trim() } }))

/** The consultant accepted the correction — closed. */
export const acceptNcr = (firestore: Firestore, ctx: PmContext, projectId: string, actor: NcrActor, seq: number) =>
  step(firestore, ctx, projectId, seq, "accept", null, () => ({ status: "done", accepted: { on: todayDay(), by: actor.uid, byName: actor.name } }))

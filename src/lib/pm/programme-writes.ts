// PM 1.0 — programme activities (PRG-01). Laid over the approved programme by
// whoever approves on the project (`programme.manage`), one transaction each
// with the guard first; the project numbers them (`pm.activityCount`). An
// activity is edited, never deleted — its dates and items are the record.

import { collection, doc, getDocs, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { activityBlocks, activityNo, PM_ACTIVITIES, type ActivityBlock, type PmActivity } from "./programme"
import { withFreshState } from "./project-writes"

export class PmActivityError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "archived" | "blocked", readonly blocks: ActivityBlock[] = []) {
    super(code)
    this.name = "PmActivityError"
  }
}

export interface ActivityActor {
  uid: string
  name: string | null
}

export interface ActivityInput {
  name: string
  from: string
  to: string
  itemIds: string[]
  pred: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; activityCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmActivityError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmActivityError("not_pm_project")
  return { ref, project, pm: project.pm }
}

async function existing(firestore: Firestore, projectId: string): Promise<Array<Pick<PmActivity, "id" | "pred">>> {
  const snap = await getDocs(collection(firestore, "projects", projectId, PM_ACTIVITIES))
  return snap.docs.map((d) => ({ id: d.id, pred: (d.data() as { pred?: string | null }).pred ?? null }))
}

export async function addActivity(firestore: Firestore, ctx: PmContext, projectId: string, actor: ActivityActor, input: ActivityInput): Promise<string> {
  const others = await existing(firestore, projectId)
  let id = ""
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    if (fresh.archived) throw new PmActivityError("archived")
    assertPm(fresh, "programme.manage")
    const seq = (pm.activityCount ?? 0) + 1
    id = activityNo(seq)
    const blocks = activityBlocks({ ...input, id }, others)
    if (blocks.length) throw new PmActivityError("blocked", blocks)
    const act: Omit<PmActivity, "id"> = {
      seq,
      name: input.name.trim(),
      from: input.from,
      to: input.to,
      itemIds: input.itemIds,
      pred: input.pred || null,
      by: actor.uid,
      byName: actor.name,
      at: new Date().toISOString(),
    }
    tx.set(doc(firestore, "projects", projectId, PM_ACTIVITIES, id), { ...act, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, activityCount: seq }, updatedAt: serverTimestamp() })
  })
  return id
}

export async function updateActivity(firestore: Firestore, ctx: PmContext, projectId: string, id: string, input: ActivityInput): Promise<void> {
  const others = await existing(firestore, projectId)
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    if (fresh.archived) throw new PmActivityError("archived")
    assertPm(fresh, "programme.manage")
    const aRef = doc(firestore, "projects", projectId, PM_ACTIVITIES, id)
    if (!(await tx.get(aRef)).exists()) throw new PmActivityError("missing")
    const blocks = activityBlocks({ ...input, id }, others)
    if (blocks.length) throw new PmActivityError("blocked", blocks)
    tx.update(aRef, { name: input.name.trim(), from: input.from, to: input.to, itemIds: input.itemIds, pred: input.pred || null, updatedAt: serverTimestamp() })
  })
}

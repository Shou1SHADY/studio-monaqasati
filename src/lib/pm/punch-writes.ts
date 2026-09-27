// PM 1.0 — punch-list writes (WF-17). Recorded by quality (`qa`), one
// transaction each with the guard first; the project numbers the items.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import { PM_PUNCH, punchBlocks, punchNo, punchStepBlocks, type PunchItem, type PunchSeverity, type PunchSource } from "./punch"

export class PmPunchError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmPunchError"
  }
}

export interface PunchActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; punchCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmPunchError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmPunchError("not_pm_project")
  return { ref, project, pm: project.pm }
}

export interface RaiseInput {
  what: string
  location: string
  severity: PunchSeverity
  source: PunchSource
  sourceText?: string | null
  itemId?: string | null
}

export async function raisePunch(firestore: Firestore, ctx: PmContext, projectId: string, actor: PunchActor, input: RaiseInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const blocks = punchBlocks({ archived: fresh.archived, what: input.what, location: input.location, source: input.source, sourceText: input.sourceText })
    if (blocks.length) throw new PmPunchError("blocked", blocks)
    seq = (pm.punchCount ?? 0) + 1
    const item: Omit<PunchItem, "id"> = {
      seq,
      what: input.what.trim(),
      location: input.location.trim(),
      severity: input.severity,
      source: input.source,
      sourceText: input.source === "oth" ? input.sourceText?.trim() ?? null : null,
      status: "open",
      day: todayDay(),
      by: actor.uid,
      byName: actor.name,
      itemId: input.itemId ?? null,
      fix: null,
      conf: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_PUNCH, punchNo(seq)), { ...item, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, punchCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

async function step(firestore: Firestore, ctx: PmContext, projectId: string, seq: number, which: "fix" | "confirm", patch: (item: PunchItem) => Record<string, unknown>) {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const ref = doc(firestore, "projects", projectId, PM_PUNCH, punchNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmPunchError("missing")
    const item = { id: snap.id, ...(snap.data() as Omit<PunchItem, "id">) }
    const blocks = punchStepBlocks({ archived: fresh.archived, status: item.status, step: which })
    if (blocks.length) throw new PmPunchError("blocked", blocks)
    tx.update(ref, { ...patch(item), updatedAt: serverTimestamp() })
  })
}

/** The fix is recorded: "fixed — awaiting confirmation", not closed (PN-02). */
export const recordFix = (firestore: Firestore, ctx: PmContext, projectId: string, actor: PunchActor, seq: number, note?: string | null) =>
  step(firestore, ctx, projectId, seq, "fix", () => ({ status: "fix", fix: { on: todayDay(), by: actor.uid, byName: actor.name, note: note?.trim() || null } }))

/** The raising party's confirmation is recorded: closed. */
export const recordConfirmation = (firestore: Firestore, ctx: PmContext, projectId: string, actor: PunchActor, seq: number) =>
  step(firestore, ctx, projectId, seq, "confirm", (item) => ({
    status: "done",
    conf: { on: todayDay(), by: actor.uid, byName: actor.name, party: item.source, partyText: item.sourceText ?? null },
  }))

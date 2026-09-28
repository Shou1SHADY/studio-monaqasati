// PM 1.0 — submittal writes (WF-16). Submitted and answered by measure |
// approve (`submittal.record`); which lines require a sample is approve's.
// Each is one transaction over the project, the submittal and its BOQ line: the
// line carries the latest state (`pmSub`) so every screen reads the gate the
// same way.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"
import { PM_SUBMITTALS, replyBlocks, sampleNo, submitBlocks, type PmSubmittal, type SampleReply } from "./sample"

export class PmSampleError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmSampleError"
  }
}

export interface SampleActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; sampleCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSampleError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmSampleError("not_pm_project")
  return { ref, project, pm: project.pm }
}

type LineData = { itemNo?: string; pmSub?: string | null; pmSubRev?: number }

/** Submit a sample to the consultant; a resubmission after a rejection is the next revision. */
export async function submitSample(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SampleActor,
  input: { itemId: string; supplier: string; what?: string; day?: string; files?: PmAttachment[] | null }
): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "submittal.record")
    const lineRef = doc(firestore, "projects", projectId, "boqItems", input.itemId)
    const line = await tx.get(lineRef)
    const data = (line.exists() ? line.data() : {}) as LineData
    const today = todayDay()
    const blocks = submitBlocks({ archived: fresh.archived, itemId: line.exists() ? input.itemId : null, supplier: input.supplier, pmSub: data.pmSub, what: input.what, day: input.day ?? today, today })
    if (blocks.length) throw new PmSampleError("blocked", blocks)
    seq = (pm.sampleCount ?? 0) + 1
    const rev = (data.pmSubRev ?? 0) + 1
    const submittal: Omit<PmSubmittal, "id"> = {
      seq,
      itemId: input.itemId,
      code: data.itemNo ?? null,
      supplier: input.supplier.trim(),
      what: input.what?.trim() || null,
      rev,
      status: "sub",
      day: input.day || today,
      by: actor.uid,
      byName: actor.name,
      files: cleanAttachments(input.files),
      reply: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_SUBMITTALS, sampleNo(seq)), { ...submittal, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(lineRef, { pmSub: "sub", pmSubRev: rev, updatedAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, sampleCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

/** The consultant's reply: approved · approved as noted · rejected — never without a choice. */
export async function recordSampleReply(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SampleActor,
  seq: number,
  input: { reply: unknown; note?: string | null; on?: string; files?: PmAttachment[] | null }
): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "submittal.record")
    const ref = doc(firestore, "projects", projectId, PM_SUBMITTALS, sampleNo(seq))
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmSampleError("missing")
    const s = snap.data() as PmSubmittal
    const today = todayDay()
    const blocks = replyBlocks({ archived: fresh.archived, status: s.status, reply: input.reply, note: input.note, on: input.on ?? today, today, submittedOn: s.day })
    if (blocks.length) throw new PmSampleError("blocked", blocks)
    const reply = input.reply as SampleReply
    tx.update(ref, {
      status: reply,
      reply: { on: input.on || today, by: actor.uid, byName: actor.name, note: input.note?.trim() || null, files: cleanAttachments(input.files), recordedOn: today },
      updatedAt: serverTimestamp(),
    })
    tx.update(doc(firestore, "projects", projectId, "boqItems", s.itemId), { pmSub: reply, updatedAt: serverTimestamp() })
  })
}

/** Which lines require a sample (SUB-01) — approve's. */
export async function setSampleRequired(firestore: Firestore, ctx: PmContext, projectId: string, itemId: string, required: boolean): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "project.edit")
    if (fresh.archived) throw new PmSampleError("blocked", ["archived"])
    const lineRef = doc(firestore, "projects", projectId, "boqItems", itemId)
    const line = await tx.get(lineRef)
    if (!line.exists()) throw new PmSampleError("missing")
    tx.update(lineRef, { pmSample: required, updatedAt: serverTimestamp() })
  })
}

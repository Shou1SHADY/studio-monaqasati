// PM 1.0 — inspection writes (WF-15, WIR-01…03, MS-03). Each is one
// transaction over the project, the inspection and its BOQ line: the line
// carries the last result (`pmWir`) so the measurement gate can read it inside
// its own transaction. The guard runs first; a result without a choice is
// refused here as well as on the screen.

import { doc, runTransaction, serverTimestamp, writeBatch, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { todayDay } from "./format"
import { canReinspect, PM_INSPECTIONS, requestBlocks, resultBlocks, wirNo, type PmInspection, type WirAttempt, type WirParty, type WirResult } from "./inspection"
import { withFreshState } from "./project-writes"

export class PmInspectionError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmInspectionError"
  }
}

export interface InspectionActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { lifecycle?: string; wirCount?: number } & Record<string, unknown> }

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmInspectionError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmInspectionError("not_pm_project")
  return { ref, project, pm: project.pm }
}

export interface RequestInput {
  itemId: string
  location: string
  /** The delivery unit inspected. */
  unit?: string | null
  party: WirParty
  partyText?: string | null
  on: string
  files?: PmAttachment[] | null
}

/** Request an inspection. The line waits for it — unless it already passed one. */
export async function requestInspection(firestore: Firestore, ctx: PmContext, projectId: string, actor: InspectionActor, input: RequestInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const itemRef = doc(firestore, "projects", projectId, "boqItems", input.itemId)
    const item = await tx.get(itemRef)
    const blocks = requestBlocks({ archived: fresh.archived, itemId: item.exists() ? input.itemId : null, location: input.location, on: input.on, party: input.party, partyText: input.partyText })
    if (blocks.length) throw new PmInspectionError("blocked", blocks)
    seq = (pm.wirCount ?? 0) + 1
    const data = item.data() as { itemNo?: string; pmWir?: string | null }
    const first: WirAttempt = { n: 1, on: input.on, result: null, note: null, by: actor.uid, byName: actor.name, rBy: null, rByName: null, rAt: null, files: cleanAttachments(input.files) }
    const inspection: Omit<PmInspection, "id"> = {
      seq,
      itemId: input.itemId,
      code: data.itemNo ?? null,
      location: input.location.trim(),
      unit: input.unit || null,
      party: input.party,
      partyText: input.party === "other" ? input.partyText?.trim() ?? null : null,
      status: "open",
      attempts: [first],
    }
    tx.set(doc(firestore, "projects", projectId, PM_INSPECTIONS, wirNo(seq)), { ...inspection, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, wirCount: seq }, updatedAt: serverTimestamp() })
    if (data.pmWir !== "pass" && data.pmWir !== "cond") tx.update(itemRef, { pmWir: "open", updatedAt: serverTimestamp() })
  })
  return seq
}

async function readInspection(tx: Transaction, firestore: Firestore, projectId: string, seq: number) {
  const ref = doc(firestore, "projects", projectId, PM_INSPECTIONS, wirNo(seq))
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmInspectionError("missing")
  return { ref, inspection: { id: snap.id, ...(snap.data() as Omit<PmInspection, "id">) } }
}

/** Record the result of the current attempt: one of three, never none (WIR-03).
 * `on` is the day on the signed form; `files` the form itself. */
export async function recordResult(firestore: Firestore, ctx: PmContext, projectId: string, actor: InspectionActor, seq: number, input: { result: WirResult | null; note?: string | null; on?: string | null; files?: PmAttachment[] | null }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const { ref, inspection } = await readInspection(tx, firestore, projectId, seq)
    const today = todayDay()
    const blocks = resultBlocks({ archived: fresh.archived, status: inspection.status, result: input.result, note: input.note, on: input.on === undefined ? undefined : input.on, today })
    if (blocks.length) throw new PmInspectionError("blocked", blocks)
    const result = input.result as WirResult
    const attempts = inspection.attempts.map((a, i) =>
      i === inspection.attempts.length - 1
        ? { ...a, result, note: input.note?.trim() || null, rBy: actor.uid, rByName: actor.name, rAt: new Date().toISOString(), rOn: input.on || today, rFiles: cleanAttachments(input.files) }
        : a
    )
    tx.update(ref, { status: result, attempts, updatedAt: serverTimestamp() })
    tx.update(doc(firestore, "projects", projectId, "boqItems", inspection.itemId), { pmWir: result, updatedAt: serverTimestamp() })
  })
}

/** A failed inspection is booked again as the next numbered attempt (WIR-02). */
export async function reinspect(firestore: Firestore, ctx: PmContext, projectId: string, actor: InspectionActor, seq: number, input: { on: string; files?: PmAttachment[] | null }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const { ref, inspection } = await readInspection(tx, firestore, projectId, seq)
    if (fresh.archived || !canReinspect(inspection.status) || !input.on) throw new PmInspectionError("blocked", [fresh.archived ? "archived" : !input.on ? "no_date" : "not_failed"])
    const next: WirAttempt = { n: inspection.attempts.length + 1, on: input.on, result: null, note: null, by: actor.uid, byName: actor.name, rBy: null, rByName: null, rAt: null, files: cleanAttachments(input.files) }
    tx.update(ref, { status: "open", attempts: [...inspection.attempts, next], updatedAt: serverTimestamp() })
    tx.update(doc(firestore, "projects", projectId, "boqItems", inspection.itemId), { pmWir: "open", updatedAt: serverTimestamp() })
  })
}

/** Which items require an inspection before they are measured — contract data,
 * set by whoever holds approve on the project. */
export async function setInspectionRequired(firestore: Firestore, ctx: PmContext, projectId: string, changes: Array<{ itemId: string; on: boolean }>): Promise<void> {
  assertPm(ctx, "project.edit")
  const batch = writeBatch(firestore)
  for (const c of changes) batch.update(doc(firestore, "projects", projectId, "boqItems", c.itemId), { pmInspect: c.on, updatedAt: serverTimestamp() })
  await batch.commit()
}

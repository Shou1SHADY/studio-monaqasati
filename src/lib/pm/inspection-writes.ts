// PM 1.0 — inspection writes (WF-15, WIR-01…03, MS-03). Each is one
// transaction over the project, the inspection and its BOQ line: the line
// carries the last result (`pmWir`, and per delivery unit `pmWirByUnit`) so the
// measurement gate can read it inside its own transaction. Only the item's
// newest inspection moves the line (1.1): a late result on an older request
// never overwrites a newer one. The guard runs first; a result without a choice
// is refused here as well as on the screen.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { todayDay } from "./format"
import { canReinspect, gatePatch, gateWrites, PM_INSPECTIONS, requestBlocks, resultBlocks, wirNo, type GateFields, type PmInspection, type WirAttempt, type WirParty, type WirResult, type WirStatus } from "./inspection"
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
    const data = item.data() as { itemNo?: string } & GateFields
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
    // The newest request: the item waits for it — and so does its unit — unless it already passed.
    const passed = (st: unknown) => st === "pass" || st === "cond"
    const patch = gatePatch(data, "open", input.unit, { item: !passed(data.pmWir), unit: Boolean(input.unit) && !passed(data.pmWirByUnit?.[input.unit as string]) })
    if (Object.keys(patch).length) tx.update(itemRef, { ...patch, updatedAt: serverTimestamp() })
  })
  return seq
}

/** The other inspections of the same item — read beside the transaction (a query
 * cannot run inside a client one); the project's newest is re-read inside it. */
async function sameItemInspections(firestore: Firestore, projectId: string, seq: number): Promise<Array<Pick<PmInspection, "seq" | "unit">>> {
  const own = await getDoc(doc(firestore, "projects", projectId, PM_INSPECTIONS, wirNo(seq)))
  const itemId = (own.data() as { itemId?: string } | undefined)?.itemId
  if (!itemId) return []
  const snap = await getDocs(query(collection(firestore, "projects", projectId, PM_INSPECTIONS), where("itemId", "==", itemId)))
  return snap.docs.map((d) => d.data() as PmInspection).filter((w) => w.seq !== seq).map((w) => ({ seq: w.seq, unit: w.unit ?? null }))
}

/** Which of the line's fields this inspection may move: newer requests read before
 * the transaction, plus the project's latest one re-read inside it (one raised in between). */
async function mayWrite(tx: Transaction, firestore: Firestore, projectId: string, inspection: PmInspection, others: Array<Pick<PmInspection, "seq" | "unit">>, wirCount: number) {
  const known = [...others]
  if (wirCount > inspection.seq && !known.some((w) => w.seq === wirCount)) {
    const last = await tx.get(doc(firestore, "projects", projectId, PM_INSPECTIONS, wirNo(wirCount)))
    const d = last.data() as PmInspection | undefined
    if (d && d.itemId === inspection.itemId) known.push({ seq: d.seq, unit: d.unit ?? null })
  }
  return gateWrites(inspection, known)
}

/** Reads the line (all reads before any write) and returns the write to make. */
async function gateWrite(tx: Transaction, firestore: Firestore, projectId: string, inspection: PmInspection, status: WirStatus, may: { item: boolean; unit: boolean }) {
  const itemRef = doc(firestore, "projects", projectId, "boqItems", inspection.itemId)
  const item = await tx.get(itemRef)
  const patch = gatePatch((item.data() ?? {}) as GateFields, status, inspection.unit, may)
  return () => {
    if (Object.keys(patch).length) tx.update(itemRef, { ...patch, updatedAt: serverTimestamp() })
  }
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
  const others = await sameItemInspections(firestore, projectId, seq)
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
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
    const may = await mayWrite(tx, firestore, projectId, inspection, others, pm.wirCount ?? 0)
    const commitGate = await gateWrite(tx, firestore, projectId, inspection, result, may)
    tx.update(ref, { status: result, attempts, updatedAt: serverTimestamp() })
    commitGate()
  })
}

/** A failed inspection is booked again as the next numbered attempt (WIR-02). */
export async function reinspect(firestore: Firestore, ctx: PmContext, projectId: string, actor: InspectionActor, seq: number, input: { on: string; files?: PmAttachment[] | null }): Promise<void> {
  const others = await sameItemInspections(firestore, projectId, seq)
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "qa.record")
    const { ref, inspection } = await readInspection(tx, firestore, projectId, seq)
    if (fresh.archived || !canReinspect(inspection.status) || !input.on) throw new PmInspectionError("blocked", [fresh.archived ? "archived" : !input.on ? "no_date" : "not_failed"])
    const next: WirAttempt = { n: inspection.attempts.length + 1, on: input.on, result: null, note: null, by: actor.uid, byName: actor.name, rBy: null, rByName: null, rAt: null, files: cleanAttachments(input.files) }
    const may = await mayWrite(tx, firestore, projectId, inspection, others, pm.wirCount ?? 0)
    const commitGate = await gateWrite(tx, firestore, projectId, inspection, "open", may)
    tx.update(ref, { status: "open", attempts: [...inspection.attempts, next], updatedAt: serverTimestamp() })
    commitGate()
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

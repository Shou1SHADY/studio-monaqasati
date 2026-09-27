// PM 1.0 — measurement writes (WF-04, MS-01…04). Writing a sheet moves
// nothing (unless the writer holds `approve`, which is recorded as a
// self-approval); approving it moves each item's executed quantity, capped at
// the remaining at that moment on a lump sum, and the first approved sheet
// takes the project live. One transaction each, re-reading the project and
// every item on the sheet, with the guard first.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, pmCan, type PmContext } from "./access"
import { lifecycleOf } from "./lifecycle"
import { applySheet, PM_SHEETS, sheetBlocks, sheetNo, type MeasuredItem, type PmSheet, type SheetLine } from "./measurement"
import { goLive, withFreshState } from "./project-writes"
import type { ContractTerms } from "./terms"

export class PmSheetError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "not_waiting" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmSheetError"
  }
}

export interface SheetActor {
  uid: string
  name: string | null
}

type PmData = { lifecycle?: string; terms?: ContractTerms; original?: ContractTerms | null; sheetCount?: number } & Record<string, unknown>
type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: PmData }

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** A stored BOQ line as the measurement rules read it. */
export const measuredItem = (id: string, data: Record<string, unknown>): MeasuredItem => ({
  id,
  quantity: num(data.quantity),
  rate: num(data.unitPrice),
  executed: num(data.executedQuantity),
})

async function readProject(tx: Transaction, firestore: Firestore, projectId: string) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmSheetError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmSheetError("not_pm_project")
  return { ref, project, pm: project.pm }
}

async function readItems(tx: Transaction, firestore: Firestore, projectId: string, ids: string[]): Promise<MeasuredItem[]> {
  const out: MeasuredItem[] = []
  for (const id of [...new Set(ids)]) {
    const snap = await tx.get(doc(firestore, "projects", projectId, "boqItems", id))
    if (snap.exists()) out.push(measuredItem(id, snap.data() as Record<string, unknown>))
  }
  return out
}

/** Apply an approved sheet: items move, and a planning project goes live. */
function approveInto(tx: Transaction, firestore: Firestore, projectId: string, project: ProjectData, items: MeasuredItem[], lines: SheetLine[]) {
  const applied = applySheet(lines, items, project.pm?.terms?.basis ?? "rem")
  for (const [id, executed] of Object.entries(applied.executed)) {
    const before = items.find((i) => i.id === id)?.executed
    if (before !== executed) tx.update(doc(firestore, "projects", projectId, "boqItems", id), { executedQuantity: executed, updatedAt: serverTimestamp() })
  }
  const wentLive = applied.moved > 0 && lifecycleOf(project) === "plan"
  return { applied, wentLive }
}

export interface WriteSheetInput {
  day: string
  lines: SheetLine[]
  note?: string | null
}

/** Write a measurement sheet. It waits for the PM — unless the writer holds
 * `approve`, in which case it is approved at once and marked as self-approved. */
export async function writeSheet(firestore: Firestore, ctx: PmContext, projectId: string, actor: SheetActor, input: WriteSheetInput): Promise<{ seq: number; self: boolean; wentLive: boolean }> {
  let seq = 0
  let self = false
  let wentLive = false
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "measurement.write")
    const lines = input.lines.filter((l) => l.qty !== 0).map((l) => ({ itemId: l.itemId, code: l.code ?? null, qty: l.qty, approved: null }))
    const items = await readItems(tx, firestore, projectId, lines.map((l) => l.itemId))
    const blocks = sheetBlocks({ archived: fresh.archived, lines, items })
    if (blocks.length) throw new PmSheetError("blocked", blocks)

    seq = (pm.sheetCount ?? 0) + 1
    self = pmCan(fresh, "approve")
    const now = new Date().toISOString()
    let stored: SheetLine[] = lines
    let nextPm: PmData = { ...pm, sheetCount: seq }
    let status: string | undefined
    if (self) {
      const r = approveInto(tx, firestore, projectId, project, items, lines)
      stored = r.applied.lines
      wentLive = r.wentLive
      if (wentLive) {
        nextPm = goLive(nextPm, "measurement")
        status = "working"
      }
    }
    const sheet: Omit<PmSheet, "id"> = {
      seq,
      status: self ? "ok" : "wait",
      day: input.day,
      by: actor.uid,
      byName: actor.name,
      lines: stored,
      note: input.note?.trim() || null,
      okBy: self ? actor.uid : null,
      okByName: self ? actor.name : null,
      okAt: self ? now : null,
      self,
      returnNote: null,
    }
    tx.set(doc(firestore, "projects", projectId, PM_SHEETS, sheetNo(seq)), { ...sheet, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: nextPm, ...(status ? { status } : {}), updatedAt: serverTimestamp() })
  })
  return { seq, self, wentLive }
}

/** The PM approves a waiting sheet: executed moves, capped at the remaining NOW
 * on a lump sum; the first approved sheet takes a planning project live. */
export async function approveSheet(firestore: Firestore, ctx: PmContext, projectId: string, actor: SheetActor, seq: number): Promise<{ value: number; moved: number; wentLive: boolean }> {
  let result = { value: 0, moved: 0, wentLive: false }
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm } = await readProject(tx, firestore, projectId)
    assertPm(withFreshState(ctx, project), "measurement.approve")
    const sRef = doc(firestore, "projects", projectId, PM_SHEETS, sheetNo(seq))
    const snap = await tx.get(sRef)
    if (!snap.exists()) throw new PmSheetError("missing")
    const sheet = snap.data() as PmSheet
    if (sheet.status !== "wait") throw new PmSheetError("not_waiting")
    const items = await readItems(tx, firestore, projectId, sheet.lines.map((l) => l.itemId))
    const { applied, wentLive } = approveInto(tx, firestore, projectId, project, items, sheet.lines)
    tx.update(sRef, { status: "ok", lines: applied.lines, okBy: actor.uid, okByName: actor.name, okAt: new Date().toISOString(), self: sheet.by === actor.uid, updatedAt: serverTimestamp() })
    if (wentLive) tx.update(ref, { pm: goLive(pm, "measurement"), status: "working", updatedAt: serverTimestamp() })
    result = { value: applied.value, moved: applied.moved, wentLive }
  })
  return result
}

/** Send a sheet back to its writer: nothing moves. */
export async function returnSheet(firestore: Firestore, ctx: PmContext, projectId: string, actor: SheetActor, seq: number, note: string | null): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { project } = await readProject(tx, firestore, projectId)
    assertPm(withFreshState(ctx, project), "measurement.approve")
    const sRef = doc(firestore, "projects", projectId, PM_SHEETS, sheetNo(seq))
    const snap = await tx.get(sRef)
    if (!snap.exists()) throw new PmSheetError("missing")
    if ((snap.data() as PmSheet).status !== "wait") throw new PmSheetError("not_waiting")
    tx.update(sRef, { status: "no", okBy: actor.uid, okByName: actor.name, okAt: new Date().toISOString(), returnNote: note?.trim() || null, updatedAt: serverTimestamp() })
  })
}

// PM 1.0 — plant-on-site writes (WF-14). The handover, the off-hire request,
// the desk's confirmation and the hand-back are `plant.request` (req); the day
// log is the site record (`daily.write`). One transaction each, guard first;
// the project numbers the units it receives. Nothing is ever deleted.

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, type PmAction, type PmContext } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { todayDay } from "./format"
import {
  backBlocks,
  dayBlocks,
  handoverBlocks,
  offBlocks,
  PM_PLANT,
  plantNo,
  type OffReason,
  type PlantCategory,
  type PlantCondition,
  type PlantDayState,
  type PlantOwnership,
  type PmPlant,
} from "./plant"
import { withFreshState } from "./project-writes"

export class PmPlantError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmPlantError"
  }
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { plantCount?: number } & Record<string, unknown> }
type Actor = { uid: string; name: string | null }

async function readProject(tx: Transaction, firestore: Firestore, ctx: PmContext, projectId: string, action: PmAction) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmPlantError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmPlantError("not_pm_project")
  const fresh = withFreshState(ctx, project)
  assertPm(fresh, action)
  return { ref, project, pm: project.pm, fresh }
}

async function readPlant(tx: Transaction, firestore: Firestore, projectId: string, seq: number) {
  const ref = doc(firestore, "projects", projectId, PM_PLANT, plantNo(seq))
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmPlantError("missing")
  return { ref, plant: { id: snap.id, ...(snap.data() as Omit<PmPlant, "id">) } }
}

export interface NoteInput {
  meter?: number | null
  fuel?: string | null
  accessories?: string | null
  condition: PlantCondition
  remark?: string | null
  files?: PmAttachment[] | null
}

export interface HandoverInput extends NoteInput {
  tag: string
  name: string
  category: PlantCategory
  ownership: PlantOwnership
  supplier?: string | null
  qty: number
  dayRate?: number | null
  from: string
  to: string
  licenceTo?: string | null
}

const note = (input: NoteInput, actor: Actor, on: string) => ({
  on,
  meter: input.meter ?? null,
  fuel: input.fuel || null,
  accessories: input.accessories?.trim() || null,
  condition: input.condition,
  remark: input.condition === "ok" ? null : input.remark?.trim() || null,
  files: cleanAttachments(input.files),
  by: actor.uid,
  byName: actor.name,
})

/** Receive a unit on site with its handover note. */
export async function receivePlant(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, input: HandoverInput): Promise<number> {
  let seq = 0
  await runTransaction(firestore, async (tx) => {
    const { ref, project, pm, fresh } = await readProject(tx, firestore, ctx, projectId, "plant.request")
    const today = todayDay()
    const blocks = handoverBlocks({ archived: fresh.archived, name: input.name, qty: input.qty, from: input.from, to: input.to, category: input.category, meter: input.meter, dayRate: input.dayRate, licenceTo: input.licenceTo, condition: input.condition, remark: input.remark, today })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    seq = (pm.plantCount ?? 0) + 1
    const plant: Omit<PmPlant, "id"> = {
      seq,
      tag: input.tag.trim(),
      name: input.name.trim(),
      category: input.category,
      ownership: input.ownership,
      supplier: input.ownership === "hire" ? input.supplier?.trim() || null : null,
      qty: input.qty,
      dayRate: input.category === "tool" ? null : input.dayRate ?? null,
      from: input.from,
      to: input.to,
      licenceTo: input.licenceTo || null,
      status: "use",
      handover: note(input, actor, input.from),
      days: {},
      offReq: null,
      offNo: null,
      offOk: null,
      back: null,
      by: actor.uid,
      byName: actor.name,
    }
    tx.set(doc(firestore, "projects", projectId, PM_PLANT, plantNo(seq)), { ...plant, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, plantCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

/** Log what the unit did on a day — one of five states; a second entry for the day replaces the first. */
export async function logPlantDay(firestore: Firestore, ctx: PmContext, projectId: string, seq: number, input: { day: string; st: PlantDayState }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "daily.write")
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    const blocks = dayBlocks({ archived: fresh.archived, status: plant.status, day: input.day, from: plant.from, today: todayDay(), st: input.st })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    tx.update(ref, { [`days.${input.day}`]: input.st, updatedAt: serverTimestamp() })
  })
}

/** Ask the desk to take it back. The charge runs until the desk confirms. */
export async function requestOffHire(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: { ready: string; why: OffReason | null; whyText?: string | null }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "plant.request")
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    const today = todayDay()
    const blocks = offBlocks({ archived: fresh.archived, status: plant.status, why: input.why, whyText: input.whyText, ready: input.ready, today })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    tx.update(ref, {
      status: "req",
      offReq: { on: today, ready: input.ready, why: input.why, whyText: input.why === "oth" ? input.whyText?.trim() ?? null : null, by: actor.uid, byName: actor.name },
      updatedAt: serverTimestamp(),
    })
  })
}

/** Record the desk's confirmation, with its off-hire number — from here the charge can stop. */
export async function recordOffHireConfirmation(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: { no: string; on: string }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "plant.request")
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    if (fresh.archived || plant.status !== "req" || plant.offOk || !input.no.trim() || !input.on || input.on > todayDay())
      throw new PmPlantError("blocked", [fresh.archived ? "archived" : !input.no.trim() ? "no_number" : "wrong_state"])
    tx.update(ref, { offNo: input.no.trim(), offOk: { on: input.on, by: actor.uid, byName: actor.name }, updatedAt: serverTimestamp() })
  })
}

/** Hand it back with the second reading — the one that closes the account. */
export async function handBackPlant(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: NoteInput): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "plant.request")
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    const blocks = backBlocks({ archived: fresh.archived, plant, meter: input.meter, condition: input.condition, remark: input.remark })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    tx.update(ref, { status: "back", back: note(input, actor, todayDay()), updatedAt: serverTimestamp() })
  })
}

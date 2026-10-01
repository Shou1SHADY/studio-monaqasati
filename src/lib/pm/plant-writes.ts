// PM 1.0 — plant-on-site writes (WF-14). The handover and the desk's
// confirmation are `plant.request` (req); the day log, the off-hire request and
// the hand-back are the site record (`daily.write` — the prototype's
// CAN('daily') on eqSitePanel). One transaction each, guard first;
// the project numbers the units it receives. Nothing is ever deleted. A unit
// received against an equipment request closes that request in the same write.
// The day rate is an amount: whoever receives a unit without seeing money
// leaves it unrated, and a money holder sets it afterwards (`setPlantDayRate`).

import { doc, runTransaction, serverTimestamp, type Firestore, type Transaction } from "firebase/firestore"
import { assertPm, PmAccessError, pmCan, type PmAction, type PmContext, type PmRefusal } from "./access"
import { cleanAttachments, type PmAttachment } from "./attachments"
import { todayDay } from "./format"
import {
  backBlocks,
  dayBlocks,
  deskBlocks,
  handoverBlocks,
  offBlocks,
  PM_PLANT,
  plantNo,
  rateBlocks,
  type OffReason,
  type PlantCategory,
  type PlantCondition,
  type PlantDayEntry,
  type PlantDayState,
  type PlantOwnership,
  type PmPlant,
} from "./plant"
import { withFreshState } from "./project-writes"
import { PM_PLANT as PM_PLANT_REQUESTS, plantNo as plantReqNo, plantReceivable, type PmPlantRequest } from "./supply"

export class PmPlantError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmPlantError"
  }
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: { plantCount?: number } & Record<string, unknown> }
type Actor = { uid: string; name: string | null }

/** Who may set a day rate: it is an amount, so `money`, held by someone who
 * runs the project's plant (`req`) or approves on it. PM_GUARD has no action
 * for this pair yet, so the check is spelled here in the guard's own terms. */
export function plantRateRefusal(ctx: PmContext): PmRefusal | null {
  if (ctx.archived) return "archived"
  if (!ctx.seat && !ctx.ceiling.has("all")) return "not_on_team"
  return pmCan(ctx, "money") && (pmCan(ctx, "req") || pmCan(ctx, "approve")) ? null : "no_duty"
}

const assertRate = (ctx: PmContext) => {
  const refusal = plantRateRefusal(ctx)
  if (refusal) throw new PmAccessError(refusal, "plant.rate.set")
}

async function readProject(tx: Transaction, firestore: Firestore, ctx: PmContext, projectId: string, guard: PmAction | ((fresh: PmContext) => void)) {
  const ref = doc(firestore, "projects", projectId)
  const snap = await tx.get(ref)
  if (!snap.exists()) throw new PmPlantError("missing")
  const project = snap.data() as ProjectData
  if (!project.pm) throw new PmPlantError("not_pm_project")
  const fresh = withFreshState(ctx, project)
  if (typeof guard === "function") guard(fresh)
  else assertPm(fresh, guard)
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
  /** The equipment request it answers (`pmPlantRequests/{NN}`), when there is one. */
  requestSeq?: number | null
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
    let reqRef: ReturnType<typeof doc> | null = null
    if (input.requestSeq) {
      reqRef = doc(firestore, "projects", projectId, PM_PLANT_REQUESTS, plantReqNo(input.requestSeq))
      const rs = await tx.get(reqRef)
      if (!rs.exists()) throw new PmPlantError("missing")
      if (!plantReceivable(rs.data() as PmPlantRequest)) throw new PmPlantError("blocked", ["not_receivable"])
    }
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
    tx.set(doc(firestore, "projects", projectId, PM_PLANT, plantNo(seq)), { ...plant, requestSeq: input.requestSeq ?? null, organizationId: project.organizationId ?? null, createdAt: serverTimestamp() })
    if (reqRef) tx.update(reqRef, { got: { plantSeq: seq, on: input.from, by: actor.uid, byName: actor.name }, updatedAt: serverTimestamp() })
    tx.update(ref, { pm: { ...pm, plantCount: seq }, updatedAt: serverTimestamp() })
  })
  return seq
}

/** Log what the unit did on a day — one of five states; a second entry for the
 * day replaces the first, and every entry names who logged it and when, so a
 * past day rewritten (it reprices the day) is never anonymous. No day after the
 * desk's confirmation: the charge stopped there. */
export async function logPlantDay(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: { day: string; st: PlantDayState }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "daily.write")
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    const today = todayDay()
    const blocks = dayBlocks({ archived: fresh.archived, status: plant.status, day: input.day, from: plant.from, today, st: input.st, offOn: plant.offOk?.on ?? null })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    const entry: PlantDayEntry = { st: input.st, by: actor.uid, byName: actor.name, on: today }
    tx.update(ref, { [`days.${input.day}`]: entry, updatedAt: serverTimestamp() })
  })
}

/** Give a unit its day rate after the handover — it arrived with someone who
 * does not see money, or with the rate not yet agreed. Until then its days
 * cost nothing and the idle decision never fires. Every logged day is priced
 * at the rate; who set it, when, and the rate it replaced are kept. */
export async function setPlantDayRate(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: { dayRate: number }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, assertRate)
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    const blocks = rateBlocks({ archived: fresh.archived, status: plant.status, category: plant.category, dayRate: input.dayRate })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    tx.update(ref, { dayRate: input.dayRate, rateSet: { on: todayDay(), by: actor.uid, byName: actor.name, was: plant.dayRate ?? null }, updatedAt: serverTimestamp() })
  })
}

/** Ask the desk to take it back. The charge runs until the desk confirms. */
export async function requestOffHire(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: { ready: string; why: OffReason | null; whyText?: string | null }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "daily.write")
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

/** Record the desk's confirmation, with its off-hire number — the charge stops
 * on its date, so the date is held in order: not before the request it answers. */
export async function recordOffHireConfirmation(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: { no: string; on: string }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "plant.request")
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    const blocks = deskBlocks({ archived: fresh.archived, plant, no: input.no, on: input.on, today: todayDay() })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    tx.update(ref, { offNo: input.no.trim(), offOk: { on: input.on, by: actor.uid, byName: actor.name }, updatedAt: serverTimestamp() })
  })
}

/** Hand it back with the second reading — the one that closes the account. */
export async function handBackPlant(firestore: Firestore, ctx: PmContext, projectId: string, actor: Actor, seq: number, input: NoteInput): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const { fresh } = await readProject(tx, firestore, ctx, projectId, "daily.write")
    const { ref, plant } = await readPlant(tx, firestore, projectId, seq)
    const blocks = backBlocks({ archived: fresh.archived, plant, meter: input.meter, condition: input.condition, remark: input.remark })
    if (blocks.length) throw new PmPlantError("blocked", blocks)
    tx.update(ref, { status: "back", back: note(input, actor, todayDay()), updatedAt: serverTimestamp() })
  })
}

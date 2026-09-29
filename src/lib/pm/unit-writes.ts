// PM 1.0 — delivery-unit writes. Setting up creates every unit at once with the
// equal split (never twice); the planned day and the handover are the
// approver's. A handover re-reads the unit and the contract in force inside the
// transaction and refuses unless its blocks are clear; open punch items and
// inspections are read just before (a collection read cannot run inside one).
// It sends prj:HND:<project>:U<no>:prov with the unit's half-retention, capped
// at what is still held and not yet freed, and adds it to `pm.retentionFreed`.

import { collection, doc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { freedOf } from "./acceptance-writes"
import { readContract } from "./addendum-writes"
import { eventDocId, PM_EVENTS } from "./events"
import { todayDay } from "./format"
import { isOpenOrFailed, PM_INSPECTIONS, type PmInspection } from "./inspection"
import { lifecycleOf } from "./lifecycle"
import { measuredItem } from "./measurement-writes"
import { withFreshState } from "./project-writes"
import { isOpenPunch, PM_PUNCH, type PunchItem } from "./punch"
import { PM_UNITS, splitEqually, UNITS_MAX, UNITS_MIN, unitBlocks, unitDone, unitFigures, unitHandoverEvent, unitNo, unitRetention, type PmUnit } from "./units"

export class PmUnitError extends Error {
  constructor(readonly code: "missing" | "exists" | "bad_count" | "no_label" | "done" | "blocked" | "archived", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmUnitError"
  }
}

export interface UnitActor {
  uid: string
  name: string | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

async function readItems(firestore: Firestore, projectId: string) {
  const snap = await getDocs(collection(firestore, "projects", projectId, "boqItems"))
  return snap.docs.map((d) => measuredItem(d.id, d.data() as Record<string, unknown>))
}

/** Create the units — once, when the section is switched on. */
export async function setUpUnits(firestore: Firestore, ctx: PmContext, projectId: string, actor: UnitActor, input: { count: number; label: string }): Promise<number> {
  if (!Number.isInteger(input.count) || input.count < UNITS_MIN || input.count > UNITS_MAX) throw new PmUnitError("bad_count")
  if (!input.label.trim()) throw new PmUnitError("no_label")
  const items = await readItems(firestore, projectId)
  const units = splitEqually(items, input.count, input.label)
  await runTransaction(firestore, async (tx) => {
    const { project } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "deliveryUnit.manage")
    if (fresh.archived) throw new PmUnitError("archived")
    const first = await tx.get(doc(firestore, "projects", projectId, PM_UNITS, unitNo(1)))
    if (first.exists()) throw new PmUnitError("exists")
    for (const u of units) {
      tx.set(doc(firestore, "projects", projectId, PM_UNITS, unitNo(u.seq)), {
        ...u,
        organizationId: (project as { organizationId?: string }).organizationId ?? null,
        by: actor.uid,
        byName: actor.name,
        createdAt: serverTimestamp(),
      })
    }
  })
  return units.length
}

/** The planned handover day of a unit (empty clears it). */
export async function setUnitPlan(firestore: Firestore, ctx: PmContext, projectId: string, unitId: string, plan: string | null): Promise<void> {
  if (plan !== null && !DAY.test(plan)) throw new PmUnitError("blocked", ["bad_date"])
  await runTransaction(firestore, async (tx) => {
    const { project } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "deliveryUnit.manage")
    if (fresh.archived) throw new PmUnitError("archived")
    const ref = doc(firestore, "projects", projectId, PM_UNITS, unitId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmUnitError("missing")
    if (unitDone(snap.data() as PmUnit)) throw new PmUnitError("done")
    tx.update(ref, { plan, updatedAt: serverTimestamp() })
  })
}

/** Hand a unit over: its work complete, nothing open on it. Half its retention
 * becomes claimable at Finance and its defects period starts. */
export async function handOverUnit(firestore: Firestore, ctx: PmContext, projectId: string, actor: UnitActor, unitId: string): Promise<{ claimable: number }> {
  const [items, punchSnap, wirSnap] = await Promise.all([
    readItems(firestore, projectId),
    getDocs(collection(firestore, "projects", projectId, PM_PUNCH)),
    getDocs(collection(firestore, "projects", projectId, PM_INSPECTIONS)),
  ])
  const punch = punchSnap.docs.map((d) => d.data() as PunchItem).filter(isOpenPunch)
  const inspections = wirSnap.docs.map((d) => d.data() as PmInspection).filter(isOpenOrFailed)
  let claimable = 0
  await runTransaction(firestore, async (tx) => {
    const { pRef, project, pm, terms } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "deliveryUnit.manage")
    if (fresh.archived || lifecycleOf(project) !== "live") throw new PmUnitError("archived")
    const ref = doc(firestore, "projects", projectId, PM_UNITS, unitId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmUnitError("missing")
    const unit = { ...(snap.data() as Omit<PmUnit, "id">), id: unitId }
    if (unitDone(unit)) throw new PmUnitError("done")
    const blocks = unitBlocks(unit, items, { punch, inspections })
    if (blocks.length) throw new PmUnitError("blocked", blocks.map((b) => b.key))
    const f = unitFigures(unit, items)
    const freed = freedOf(pm)
    claimable = Math.max(0, Math.min(unitRetention(f.contract, terms), Math.round(((pm.retentionHeld ?? 0) - freed) * 100) / 100))
    const on = todayDay()
    const event = unitHandoverEvent({
      organizationId: project.organizationId ?? "",
      projectId,
      projectNo: pm.no ?? projectId,
      unit,
      on,
      claimable,
      by: actor.uid,
      at: new Date().toISOString(),
    })
    tx.update(ref, { ho: { on, by: actor.uid, byName: actor.name }, updatedAt: serverTimestamp() })
    tx.update(pRef, { pm: { ...pm, retentionFreed: freed + claimable }, updatedAt: serverTimestamp() })
    tx.set(doc(firestore, PM_EVENTS, eventDocId(event.key)), event)
  })
  return { claimable }
}

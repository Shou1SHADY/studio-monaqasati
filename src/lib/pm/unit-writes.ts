// PM 1.0 — delivery-unit writes. Setting up creates every unit at once with the
// equal split — refused while the BOQ has no quantities to split, and never
// twice; the shares alone are split again while nothing was measured on a unit
// and none is handed over. The planned day and the handover are the
// approver's. A handover re-reads the unit and the contract in force inside the
// transaction and refuses unless its blocks are clear; open punch items and
// inspections are read just before (a collection read cannot run inside one).
// It sends prj:HND:<project>:U<no>:prov with what the release term frees — half
// of the retention held against the unit, or nothing when all of it waits for
// the final — never past the half not yet freed, and adds it to
// `pm.retentionFreed`.

import { collection, doc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { freedOf } from "./acceptance-writes"
import { readContract } from "./addendum-writes"
import { PM_EVENTS, pmEventDocId } from "./events"
import { todayDay } from "./format"
import { isOpenOrFailed, PM_INSPECTIONS, type PmInspection } from "./inspection"
import { lifecycleOf } from "./lifecycle"
import { PM_SHEETS, sheetNo, type PmSheet } from "./measurement"
import { measuredItem } from "./measurement-writes"
import { withFreshState } from "./project-writes"
import { isOpenPunch, PM_PUNCH, type PunchItem } from "./punch"
import { boqValue, equalShares, PM_UNITS, resplitBlocks, splitEqually, UNITS_MAX, UNITS_MIN, unitBlocks, unitClaimable, unitDone, unitFigures, unitHandoverEvent, unitNo, type PmUnit } from "./units"

export class PmUnitError extends Error {
  constructor(readonly code: "missing" | "exists" | "bad_count" | "no_label" | "no_boq" | "handed" | "measured" | "done" | "blocked" | "archived", readonly blocks: string[] = []) {
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

/** Units share out the BOQ's quantities: with none there is nothing to split. */
const hasQuantities = (items: Array<{ quantity: number }>) => items.some((i) => i.quantity > 0)

/** Create the units — once, when the section is switched on. Not before the
 * BOQ has quantities: units created over an empty BOQ would hold nothing. */
export async function setUpUnits(firestore: Firestore, ctx: PmContext, projectId: string, actor: UnitActor, input: { count: number; label: string }): Promise<number> {
  if (!Number.isInteger(input.count) || input.count < UNITS_MIN || input.count > UNITS_MAX) throw new PmUnitError("bad_count")
  if (!input.label.trim()) throw new PmUnitError("no_label")
  const items = await readItems(firestore, projectId)
  if (!hasQuantities(items)) throw new PmUnitError("no_boq")
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

/** Split the BOQ's quantities over the existing units again — the approver's,
 * for units set up before the BOQ was imported or a BOQ that changed since. The
 * units, their names and planned days stay; only the shares are replaced. It
 * is refused once a unit is handed over or a measurement names a unit: the
 * units and every sheet up to the project's sheet count are re-read inside the
 * transaction. Returns the number of units. */
export async function resplitUnits(firestore: Firestore, ctx: PmContext, projectId: string): Promise<number> {
  const [items, unitSnap] = await Promise.all([readItems(firestore, projectId), getDocs(collection(firestore, "projects", projectId, PM_UNITS))])
  if (!hasQuantities(items)) throw new PmUnitError("no_boq")
  const ids = unitSnap.docs.map((d) => d.id).sort()
  if (!ids.length) throw new PmUnitError("missing")
  await runTransaction(firestore, async (tx) => {
    const { project, pm } = await readContract(tx, firestore, projectId)
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "deliveryUnit.manage")
    if (fresh.archived) throw new PmUnitError("archived")
    const refs = ids.map((id) => doc(firestore, "projects", projectId, PM_UNITS, id))
    const unitDocs = await Promise.all(refs.map((ref) => tx.get(ref)))
    if (unitDocs.some((snap) => !snap.exists())) throw new PmUnitError("missing")
    const units = unitDocs.map((snap) => snap.data() as Omit<PmUnit, "id">)
    const sheetCount = Number((pm as { sheetCount?: number }).sheetCount) || 0
    const sheetDocs = await Promise.all(Array.from({ length: sheetCount }, (_, i) => tx.get(doc(firestore, "projects", projectId, PM_SHEETS, sheetNo(i + 1)))))
    const sheets = sheetDocs.filter((snap) => snap.exists()).map((snap) => snap.data() as Omit<PmSheet, "id">)
    const blocks = resplitBlocks(units.map((u) => ({ ho: u.ho ?? null, lines: u.lines ?? {} })), sheets)
    if (blocks.length) throw new PmUnitError(blocks[0])
    const shares = equalShares(items, units.length)
    // In the units' own order: the last one takes each line's remainder.
    units
      .map((u, i) => ({ seq: u.seq, ref: refs[i] }))
      .sort((a, b) => a.seq - b.seq)
      .forEach(({ ref }, n) => tx.update(ref, { lines: shares[n], updatedAt: serverTimestamp() }))
  })
  return ids.length
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

/** Hand a unit over: its work complete, nothing open on it. Its defects period
 * starts, and what the release term frees of its retention becomes claimable
 * at Finance — half of what is held against it, or nothing on a full release. */
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
    claimable = unitClaimable(f.contract, terms, { held: pm.retentionHeld ?? 0, of: boqValue(items), freed })
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
    tx.set(doc(firestore, PM_EVENTS, pmEventDocId(event.organizationId, event.key)), event)
  })
  return { claimable }
}

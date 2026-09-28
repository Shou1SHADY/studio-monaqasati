// PM 1.0 — BOQ writes on a PM project. Pricing an unpriced line puts it into
// the contract value and makes whatever was measured on it claimable at once,
// so it takes `item.price` (prep | approve) AND money, and the line is re-read
// inside the transaction: a line priced meanwhile is refused, never repriced.
// Importing writes every validated row in one transaction, and only into an
// empty BOQ — a second paste never doubles lines.

import { collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore"
import { assertPm, PmAccessError, type PmContext } from "./access"
import { divisionOfCode, MAX_IMPORT_ROWS, priceBlocks, type ImportRow } from "./boq"
import { todayDay } from "./format"
import { withFreshState } from "./project-writes"

export class PmBoqError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "has_items" | "too_many" | "no_rows" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmBoqError"
  }
}

export interface BoqActor {
  uid: string
  name: string | null
}

type ProjectData = { organizationId?: string; status?: string; projectManagerId?: string | null; pm?: Record<string, unknown> }

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

export async function priceItem(firestore: Firestore, ctx: PmContext, projectId: string, actor: BoqActor, itemId: string, input: { rate: number; cost: number }): Promise<void> {
  await runTransaction(firestore, async (tx) => {
    const pSnap = await tx.get(doc(firestore, "projects", projectId))
    if (!pSnap.exists()) throw new PmBoqError("missing")
    const project = pSnap.data() as ProjectData
    if (!project.pm) throw new PmBoqError("not_pm_project")
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "item.price")
    if (!fresh.ceiling.has("money")) throw new PmAccessError("no_duty", "item.price")
    const ref = doc(firestore, "projects", projectId, "boqItems", itemId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmBoqError("missing")
    const blocks = priceBlocks({ archived: fresh.archived, currentRate: num((snap.data() as { unitPrice?: unknown }).unitPrice), rate: input.rate, cost: input.cost })
    if (blocks.length) throw new PmBoqError("blocked", blocks)
    tx.update(ref, {
      unitPrice: input.rate,
      estCost: input.cost > 0 ? input.cost : null,
      pricedBy: actor.uid,
      pricedByName: actor.name,
      pricedOn: todayDay(),
      updatedAt: serverTimestamp(),
    })
  })
}

/** Rows already judged by `parseBoqPaste` — only its `ok` list is passed here. */
export async function importBoq(firestore: Firestore, ctx: PmContext, projectId: string, rows: ImportRow[]): Promise<number> {
  if (!rows.length) throw new PmBoqError("no_rows")
  if (rows.length > MAX_IMPORT_ROWS) throw new PmBoqError("too_many")
  if (rows.some((r) => r.problems.length)) throw new PmBoqError("blocked", ["invalid_rows"])
  const existing = await getDocs(query(collection(firestore, "projects", projectId, "boqItems"), limit(1)))
  if (!existing.empty) throw new PmBoqError("has_items")
  await runTransaction(firestore, async (tx) => {
    const pSnap = await tx.get(doc(firestore, "projects", projectId))
    if (!pSnap.exists()) throw new PmBoqError("missing")
    const project = pSnap.data() as ProjectData
    if (!project.pm) throw new PmBoqError("not_pm_project")
    assertPm(withFreshState(ctx, project), "boq.import")
    const items = collection(firestore, "projects", projectId, "boqItems")
    for (const r of rows) {
      tx.set(doc(items), {
        itemNo: r.code,
        descriptionAr: r.description,
        descriptionEn: r.description,
        unit: r.unit,
        quantity: r.quantity,
        unitPrice: r.rate && r.rate > 0 ? r.rate : 0,
        estCost: r.cost && r.cost > 0 ? r.cost : null,
        divisionNo: divisionOfCode(r.code),
        tenderId: null,
        isEditable: true,
        groupId: null,
        executedQuantity: 0,
        billedQuantity: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
  })
  return rows.length
}

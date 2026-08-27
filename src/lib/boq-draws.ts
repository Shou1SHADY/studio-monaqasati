import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore"

/**
 * Phased procurement against a BOQ.
 *
 * A BOQ line is the total quantity a project needs. Procurement happens in
 * phases — 1,000 of the 10,000 doors for the first twenty villas — so an
 * RFQ DRAWS a quantity from the line rather than consuming the whole of it.
 * The line keeps its total, remembers every draw, and only locks once nothing
 * is left to draw. Deleting an RFQ hands its draw back.
 */
export interface BoqDraw {
  rfqId: string
  quantity: number
  /** ISO timestamp — arrays cannot hold server timestamps. */
  at: string
  rfqTitle?: string | null
}

export interface BoqDrawState {
  quantity: number
  drawnQuantity: number
  draws: BoqDraw[]
}

export function boqRemaining(item: { quantity: number | string; drawnQuantity?: number | null }): number {
  const total = Number(item.quantity) || 0
  const drawn = Number(item.drawnQuantity) || 0
  return Math.max(0, parseFloat((total - drawn).toFixed(4)))
}

/** The item fields to write when a draw is added. */
export function applyDraw(
  item: { quantity: number | string; drawnQuantity?: number | null; draws?: BoqDraw[] | null },
  draw: BoqDraw
) {
  const total = Number(item.quantity) || 0
  const draws = [...(item.draws ?? []), draw]
  const drawnQuantity = parseFloat(draws.reduce((s, d) => s + (Number(d.quantity) || 0), 0).toFixed(4))
  return {
    draws,
    drawnQuantity,
    // The latest RFQ, for anything that still reads the single field.
    tenderId: draw.rfqId,
    // A line locks only when there is nothing left to draw.
    isEditable: drawnQuantity < total,
    updatedAt: serverTimestamp(),
  }
}

/** The item fields to write when one RFQ's draw is handed back. */
export function releaseDraw(
  item: { quantity: number | string; draws?: BoqDraw[] | null; tenderId?: string | null },
  rfqId: string
) {
  const draws = (item.draws ?? []).filter((d) => d.rfqId !== rfqId)
  const drawnQuantity = parseFloat(draws.reduce((s, d) => s + (Number(d.quantity) || 0), 0).toFixed(4))
  const last = draws[draws.length - 1]
  return {
    draws,
    drawnQuantity,
    tenderId: last?.rfqId ?? null,
    isEditable: true,
    updatedAt: serverTimestamp(),
  }
}

/** Fields that fully free a line — every draw handed back at once. */
export function releaseAllDraws() {
  return { draws: [], drawnQuantity: 0, tenderId: null, isEditable: true, updatedAt: serverTimestamp() }
}

/**
 * Hand back everything an RFQ drew from a project's BOQ. Called before the
 * RFQ is deleted.
 *
 * Items are found two ways: through the RFQ's own product list (each product
 * carries its `boqItemId`), and — for RFQs published before draws existed —
 * through the legacy `tenderId` pointer. Reading the RFQ first means this
 * works even when the item's `tenderId` has since moved on to a newer RFQ.
 */
export async function releaseBoqDrawsForRfq(firestore: Firestore, projectId: string, rfqId: string): Promise<number> {
  const itemIds = new Set<string>()

  const rfqSnap = await getDoc(doc(firestore, "rfqs", rfqId))
  if (rfqSnap.exists()) {
    const products = (rfqSnap.data().products ?? []) as Array<{ boqItemId?: string | null }>
    for (const p of products) if (p.boqItemId) itemIds.add(p.boqItemId)
  }
  const legacySnap = await getDocs(
    query(collection(firestore, "projects", projectId, "boqItems"), where("tenderId", "==", rfqId))
  )
  legacySnap.docs.forEach((d) => itemIds.add(d.id))

  if (itemIds.size === 0) return 0

  const batch = writeBatch(firestore)
  let released = 0
  for (const itemId of itemIds) {
    const ref = doc(firestore, "projects", projectId, "boqItems", itemId)
    const snap = await getDoc(ref)
    if (!snap.exists()) continue
    const data = snap.data() as { quantity?: number; draws?: BoqDraw[] | null; tenderId?: string | null }
    const hasDraws = Array.isArray(data.draws) && data.draws.length > 0
    // A legacy lock (no draws recorded) was the whole line — free it entirely.
    batch.update(ref, hasDraws ? releaseDraw({ quantity: data.quantity ?? 0, draws: data.draws, tenderId: data.tenderId }, rfqId) : releaseAllDraws())
    released++
  }
  await batch.commit()
  return released
}

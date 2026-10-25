// The stock that left each warehouse lately, read with the Admin SDK for «قادمة»'s days of cover (`issue-rate.ts`). Every source is
// read by the organisation (or the warehouse's own subcollection) and filtered by day here, so no composite index is needed:
// moves out of a warehouse (`warehouses/{central}/transfers`), released warehouse requests (`warehouses/{central}/requests`),
// signed customer deliveries (`salesDeliveryNotes`) and work-order materials issued by Inventory (`workOrders.materials`).

import { ISSUE_WINDOW_DAYS, issueRates, type StockMove } from "./issue-rate"

type Db = FirebaseFirestore.Firestore

const dayOf = (v: unknown): string => {
  if (typeof v === "string") return v.slice(0, 10)
  const t = v as { toDate?: () => Date } | null
  return t && typeof t.toDate === "function" ? t.toDate().toISOString().slice(0, 10) : ""
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0)

export async function stockMoves(db: Db, orgId: string): Promise<StockMove[]> {
  const [warehouses, notes, orders] = await Promise.all([
    db.collection("warehouses").where("organizationId", "==", orgId).get(),
    db.collection("salesDeliveryNotes").where("organizationId", "==", orgId).get(),
    db.collection("workOrders").where("organizationId", "==", orgId).get(),
  ])
  const moves: StockMove[] = []
  await Promise.all(
    warehouses.docs.map(async (w) => {
      const [transfers, requests] = await Promise.all([w.ref.collection("transfers").get(), w.ref.collection("requests").get()])
      for (const d of transfers.docs) {
        const t = d.data()
        moves.push({ warehouseId: String(t.fromWarehouseId || ""), name: String(t.itemName || ""), qty: num(t.quantity), day: dayOf(t.createdAt) })
      }
      for (const d of requests.docs) {
        const r = d.data()
        if (r.status !== "released" && r.status !== "received") continue
        moves.push({ warehouseId: String(r.fromWarehouseId || ""), name: String(r.itemName || ""), qty: num(r.releasedQuantity ?? r.quantity), day: dayOf(r.releasedAt) })
      }
    })
  )
  for (const d of notes.docs) {
    const n = d.data()
    if (n.status !== "delivered" || !n.warehouseId) continue
    for (const l of (n.lines || []) as Array<{ name?: string; quantity?: number }>) moves.push({ warehouseId: String(n.warehouseId), name: String(l.name || ""), qty: num(l.quantity), day: dayOf(n.deliveredAt || n.signedAt) })
  }
  for (const d of orders.docs) {
    for (const m of (d.data().materials || []) as Array<{ warehouseId?: string | null; itemName?: string; quantity?: number; state?: string; releasedAt?: string | null }>) {
      if (!m.warehouseId || (m.state !== "released" && m.state !== "received")) continue
      moves.push({ warehouseId: m.warehouseId, name: String(m.itemName || ""), qty: num(m.quantity), day: dayOf(m.releasedAt) })
    }
  }
  return moves
}

export async function orgIssueRates(db: Db, orgId: string, today: string): Promise<Record<string, number>> {
  return issueRates(await stockMoves(db, orgId), today, ISSUE_WINDOW_DAYS)
}

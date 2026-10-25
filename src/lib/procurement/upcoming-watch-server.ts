// «نبّهني حين يصل» (INC-06): a member watches something that is not in Incoming yet; when it lands — a project's request approved
// technically and ingested, a stock item that reached its minimum — he gets one notice and the watch is spent. The watches are
// `procUpcomingWatch/{orgId}__{key}` {organizationId, key, userIds[]}: written and read ONLY here (Admin SDK; the page asks through
// `/api/procurement/upcoming-watch`), so no rule reads or writes them. A spent watch keeps its document with no one on it.

import { isWatchKey } from "./upcoming"

type Db = FirebaseFirestore.Firestore

export const PROC_UPCOMING_WATCH = "procUpcomingWatch"
export const watchDocId = (orgId: string, key: string) => `${orgId}__${key}`

/** The keys this member watches. */
export async function watchedKeys(db: Db, orgId: string, uid: string): Promise<string[]> {
  const snap = await db.collection(PROC_UPCOMING_WATCH).where("organizationId", "==", orgId).where("userIds", "array-contains", uid).get()
  return snap.docs.map((d) => String(d.data().key || "")).filter(Boolean)
}

export async function setWatch(db: Db, orgId: string, uid: string, key: string, on: boolean): Promise<"ok" | "bad_key"> {
  if (!isWatchKey(key)) return "bad_key"
  const ref = db.collection(PROC_UPCOMING_WATCH).doc(watchDocId(orgId, key))
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const now = snap.exists ? (((snap.data() as { userIds?: string[] }).userIds || []) as string[]) : []
    const next = on ? Array.from(new Set([...now, uid])) : now.filter((u) => u !== uid)
    tx.set(ref, { organizationId: orgId, key, userIds: next })
  })
  return "ok"
}

async function tell(db: Db, orgId: string, uids: string[], ref: string, at: string): Promise<void> {
  await Promise.all(
    uids.map((uid) =>
      db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .add({
          userId: uid,
          organizationId: orgId,
          type: "upcoming_arrived",
          i18n: { title: "pn_upcoming_arrived_title", message: "pn_upcoming_arrived", params: { ref } },
          title: "وصل ما كنت تنتظره",
          message: `وصل ${ref} إلى «طلبات الشراء الواردة».`,
          link: "/contractor/rfqs/requests",
          createdAt: at,
          read: false,
        })
        .catch((err: { code?: string }) => console.warn("upcoming notice failed:", err?.code || err))
    )
  )
}

/** The watchers of requests that just reached Incoming are told; each watch is spent. Returns how many notices went out. */
export async function notifyArrived(db: Db, orgId: string, arrived: ReadonlyArray<{ key: string; ref: string }>, at = new Date().toISOString()): Promise<number> {
  let told = 0
  for (const a of arrived) {
    const ref = db.collection(PROC_UPCOMING_WATCH).doc(watchDocId(orgId, a.key))
    const snap = await ref.get()
    if (!snap.exists) continue
    const uids = ((snap.data() as { userIds?: string[] }).userIds || []).filter(Boolean)
    if (!uids.length) continue
    await ref.set({ organizationId: orgId, key: a.key, userIds: [] })
    await tell(db, orgId, uids, a.ref, at)
    told += uids.length
  }
  return told
}

/** The watchers of a stock item that reached its minimum are told (a stock need is computed, never stored, so this reads the watched items). */
export async function notifyStockReached(db: Db, orgId: string, at = new Date().toISOString()): Promise<number> {
  const snap = await db.collection(PROC_UPCOMING_WATCH).where("organizationId", "==", orgId).get()
  let told = 0
  for (const d of snap.docs) {
    const key = String(d.data().key || "")
    const [kind, warehouseId, itemId] = key.split(":")
    if (kind !== "stock" || !warehouseId || !itemId) continue
    const wh = await db.collection("warehouses").doc(warehouseId).get()
    if (!wh.exists || wh.data()?.organizationId !== orgId) continue
    const item = await db.collection("warehouses").doc(warehouseId).collection("inventoryItems").doc(itemId).get()
    const v = item.data() as { name?: string; quantity?: number; minStockLevel?: number | null } | undefined
    if (!v || typeof v.minStockLevel !== "number" || !((Number(v.quantity) || 0) <= v.minStockLevel)) continue
    const uids = ((d.data() as { userIds?: string[] }).userIds || []).filter(Boolean)
    if (!uids.length) continue
    await d.ref.set({ organizationId: orgId, key, userIds: [] })
    await tell(db, orgId, uids, v.name || key, at)
    told += uids.length
  }
  return told
}

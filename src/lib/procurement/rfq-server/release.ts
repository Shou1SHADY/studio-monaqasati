// An RFQ and the requests it holds (Procurement 2.0, G-13 «سطر في مكان واحد»), on the server. A publish links the lines it took
// to the stored request (`procIncoming`, one line one place) and stamps the legacy source documents that Projects and the
// workshop still read; a cancel hands them back — the lines return to «الواردة» and their requesters are told. The Admin twin
// of `needs-writes.ts` (`linkNeed` / `unlinkNeedsFromRfq`), so no client write is needed for either.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { WORK_ORDERS } from "../../manufacturing"
import { mfgMrKey, pmMrKey, teamMrKey } from "../incoming-state"
import { linkRfq, notifyMoved, releaseRfq, worldOf, type Committed } from "../incoming-server"
import { str, type Rec, type RfqCaller } from "./common"

interface Source extends Rec {
  kind?: string
  projectId?: string
  purchaseRequestId?: string
  workOrderId?: string
  line?: number
}

export function mrKeyOfSource(s: Source | null | undefined): string | null {
  if (!s) return null
  if (s.kind === "project_request" && str(s.projectId) && str(s.purchaseRequestId)) return pmMrKey(str(s.projectId), str(s.purchaseRequestId))
  if (s.kind === "team_request" && str(s.purchaseRequestId)) return teamMrKey(str(s.purchaseRequestId))
  if (s.kind === "mfg_purchase" && str(s.workOrderId) && str(s.purchaseRequestId)) return mfgMrKey(str(s.workOrderId), str(s.purchaseRequestId))
  return null
}

/** Every distinct source an RFQ names, whole (`needSources`, `purchaseSource`) or by line (a product's `needSource`). */
export function sourcesOfRfq(rfq: Rec): Source[] {
  const list: Source[] = []
  const seen = new Set<string>()
  const add = (s: unknown) => {
    if (!s || typeof s !== "object") return
    const key = JSON.stringify(s)
    if (seen.has(key)) return
    seen.add(key)
    list.push(s as Source)
  }
  for (const s of Array.isArray(rfq.needSources) ? (rfq.needSources as unknown[]) : []) add(s)
  add(rfq.purchaseSource)
  for (const p of Array.isArray(rfq.products) ? (rfq.products as Rec[]) : []) add(p.needSource)
  return list
}

export const mrKeysOfRfq = (rfq: Rec): string[] => [...new Set(sourcesOfRfq(rfq).map(mrKeyOfSource).filter((k): k is string => !!k))]

/** The lines of each request this RFQ's products stand for (the product's `needLine`, else the source's own `line`). */
export function linesByRequest(rfq: Rec): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const p of Array.isArray(rfq.products) ? (rfq.products as Rec[]) : []) {
    const src = (p.needSource as Source | undefined) || null
    const key = mrKeyOfSource(src)
    if (!key) continue
    const line = typeof p.needLine === "number" ? p.needLine : typeof src?.line === "number" ? src.line : null
    const cur = out.get(key) || []
    if (line != null && !cur.includes(line)) cur.push(line)
    out.set(key, cur)
  }
  return out
}

/** The legacy stamp on the source document, for the readers that have not moved to the stored request yet. */
export async function stampLegacy(db: Firestore, rfqId: string, rfqNumber: string | null, rfq: Rec, byName: string, at: string): Promise<void> {
  for (const s of sourcesOfRfq(rfq)) {
    try {
      if (s.kind === "mfg_purchase" && s.workOrderId && s.purchaseRequestId) {
        const ref = db.collection(WORK_ORDERS).doc(s.workOrderId)
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref)
          if (!snap.exists) return
          const rows = ((snap.data() as { purchaseRequests?: Rec[] }).purchaseRequests || []).map((p) => (p.id === s.purchaseRequestId && p.state === "sent" ? { ...p, state: "ordered", rfqId, rfqNumber, orderedAt: at } : p))
          tx.update(ref, { purchaseRequests: rows, updatedAt: FieldValue.serverTimestamp() })
        })
      } else if (s.kind === "project_request" && s.projectId && s.purchaseRequestId) {
        const ref = db.collection("projects").doc(s.projectId).collection("purchaseRequests").doc(s.purchaseRequestId)
        if (s.line != null) {
          const key = `lineLinks.${s.line}`
          await ref.update({ [`${key}.rfqId`]: rfqId, [`${key}.rfqNumber`]: rfqNumber, [`${key}.orderedAt`]: at, [`${key}.orderedByName`]: byName, updatedAt: FieldValue.serverTimestamp() })
        } else await ref.update({ rfqId, rfqNumber, orderedAt: at, orderedByName: byName, updatedAt: FieldValue.serverTimestamp() })
      }
    } catch (err) {
      console.warn("legacy need stamp failed:", (err as { code?: string })?.code || err)
    }
  }
}

/** Handed back as it was before: a link to THIS RFQ only — a request that has moved on is left alone. */
export async function unstampLegacy(db: Firestore, rfqId: string, rfq: Rec): Promise<void> {
  for (const s of sourcesOfRfq(rfq)) {
    try {
      if (s.kind === "mfg_purchase" && s.workOrderId && s.purchaseRequestId) {
        const ref = db.collection(WORK_ORDERS).doc(s.workOrderId)
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref)
          if (!snap.exists) return
          const rows = (snap.data() as { purchaseRequests?: Rec[] }).purchaseRequests || []
          const next = rows.map((p) => (p.id !== s.purchaseRequestId || p.state !== "ordered" || p.rfqId !== rfqId || p.poId ? p : { ...p, state: "sent", rfqId: null, rfqNumber: null, orderedAt: null }))
          if (next.some((p, i) => p !== rows[i])) tx.update(ref, { purchaseRequests: next, updatedAt: FieldValue.serverTimestamp() })
        })
      } else if (s.kind === "project_request" && s.projectId && s.purchaseRequestId) {
        const ref = db.collection("projects").doc(s.projectId).collection("purchaseRequests").doc(s.purchaseRequestId)
        const data = (await ref.get()).data() as { rfqId?: string | null; poId?: string | null; lineLinks?: Record<string, { rfqId?: string | null; poId?: string | null }> | null } | undefined
        if (!data) continue
        if (s.line != null) {
          const own = data.lineLinks?.[String(s.line)]
          if (own?.rfqId === rfqId && !own.poId) await ref.update({ [`lineLinks.${s.line}`]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
        } else if (data.rfqId === rfqId && !data.poId) {
          await ref.update({ rfqId: FieldValue.delete(), rfqNumber: FieldValue.delete(), orderedAt: FieldValue.delete(), orderedByName: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
        }
      }
    } catch (err) {
      console.warn("legacy need unstamp failed:", (err as { code?: string })?.code || err)
    }
  }
}

const heldBy = (c: Committed, rfqId: string): number => c.prev.lines.filter((l) => l.ps === "rfq" && l.rfqId === rfqId).length

/** The RFQ has been cancelled (its status is already written): every request line it held is to be bought again. Returns how many lines went back. */
export async function releaseRfqNeeds(db: Firestore, caller: RfqCaller, rfqId: string, rfq: Rec): Promise<number> {
  const by = { uid: caller.uid, name: caller.name }
  const world = await worldOf(db, caller.orgId)
  let back = 0
  for (const mrKey of mrKeysOfRfq(rfq)) {
    const res = await releaseRfq(db, caller.orgId, by, { mrKey, rfqId }, { world })
    if (typeof res === "string") continue
    back += heldBy(res, rfqId)
    if (res.moved) await notifyMoved(db, res).catch((e) => console.error("incoming notice:", e))
  }
  await unstampLegacy(db, rfqId, rfq)
  return back
}

/** A publish links ONLY the lines it took — a request taken in part leaves the rest in «جديدة» with «الباقي منه». Returns the requests linked. */
export async function linkRfqNeeds(db: Firestore, caller: RfqCaller, rfqId: string, rfqNumber: string, rfq: Rec, at: string): Promise<number> {
  const by = { uid: caller.uid, name: caller.name }
  const world = await worldOf(db, caller.orgId)
  const byRequest = linesByRequest(rfq)
  let linked = 0
  for (const mrKey of mrKeysOfRfq(rfq)) {
    const lines = byRequest.get(mrKey)
    const res = await linkRfq(db, caller.orgId, by, { mrKey, rfqId, rfqNumber, lines: lines && lines.length ? lines : undefined }, { world })
    if (typeof res === "string") continue
    linked++
    if (res.moved) await notifyMoved(db, res).catch((e) => console.error("incoming notice:", e))
  }
  await stampLegacy(db, rfqId, rfqNumber, rfq, caller.name, at)
  return linked
}

// The delivery notice, written on the server (G-08, WP-S5-02 / WP-S4-11): a DATE and a NOTE, numbered per order so two trucks on one
// day are two notices (REP1, REP2 — NFR-07). Three doors use this one core and cannot drift apart: the registered supplier in his
// portal, the off-platform supplier on his order link, and the buyer recording what a phone call said on his behalf. One Admin
// transaction re-reads the order, re-runs the rule, draws the notice's number from the order, writes the `deliveries` notice
// and the order's log; the outbox event (`proc:PO:<no>:REP<n>`) and the notices to the buyer's side follow, best-effort.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { poReportKey } from "./event-keys"
import { sendProcEvent } from "./proc-event-server"
import { noticeAudience } from "./policy-enforce"
import { buildDeliveryNotice, buildDeliveryNoticeNotification, noticeErrors, noticeRecipients, type NoticeSource } from "./supplier"
import { PURCHASE_ORDERS, type PoLogEntry, type PurchaseOrder } from "./types"

export type NoticeRefusalCode = "order_missing" | "not_yours" | "date_missing" | "date_past" | "not_accepted" | "supplier_on_platform"

const STATUS: Record<NoticeRefusalCode, number> = { order_missing: 404, not_yours: 403, date_missing: 400, date_past: 400, not_accepted: 409, supplier_on_platform: 409 }

export class NoticeRefusal extends Error {
  readonly status: number
  constructor(readonly code: NoticeRefusalCode) {
    super(code)
    this.name = "NoticeRefusal"
    this.status = STATUS[code]
  }
}

export interface NoticeWriter {
  source: NoticeSource
  uid: string
  name: string
}

export interface NoticeRequest {
  poId: string
  /** `YYYY-MM-DD`. */
  deliveryDate: string
  note?: string | null
  by: NoticeWriter
  /** Throws a `NoticeRefusal("not_yours")` when this writer may not notify for this order. */
  authorize: (po: PurchaseOrder) => void
}

export interface NoticeResult {
  deliveryId: string
  seq: number
  po: PurchaseOrder
}

const asPo = (id: string, data: Record<string, unknown>): PurchaseOrder => ({ ...(data as Omit<PurchaseOrder, "id">), id })

const isNotice = (d: Record<string, unknown>): boolean => d.source !== "manual" && !d.noNotice && d.status !== undefined

export async function createDeliveryNotice(db: Firestore, req: NoticeRequest, now: Date = new Date()): Promise<NoticeResult> {
  const at = now.toISOString()
  const poRef = db.collection(PURCHASE_ORDERS).doc(req.poId)
  const noticeRef = db.collection("deliveries").doc()
  const earlier = (await db.collection("deliveries").where("poId", "==", req.poId).get()).docs.filter((d) => isNotice(d.data() as Record<string, unknown>)).length

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(poRef)
    const data = snap.exists ? snap.data() : undefined
    if (!snap.exists || !data) throw new NoticeRefusal("order_missing")
    const po = asPo(snap.id, data)
    req.authorize(po)
    const errors = noticeErrors(po, req.deliveryDate, now)
    if (errors.length) throw new NoticeRefusal(errors[0].code)
    const stored = Number((data as { noticeSeq?: unknown }).noticeSeq)
    const seq = Math.max(Number.isFinite(stored) ? stored : 0, earlier) + 1
    const doc = buildDeliveryNotice({
      po,
      deliveryDate: req.deliveryDate,
      note: req.note,
      seq,
      reportedBy: req.by.source,
      supplier: { uid: po.supplierUserId || "guest", orgId: po.supplierOrgId || "guest", name: po.supplierName },
      contractorId: po.preparedById,
      createdAt: FieldValue.serverTimestamp(),
    })
    const offPlatform = po.isGuestSupplier || !po.supplierOrgId || po.supplierOrgId === "guest"
    tx.create(noticeRef, { ...doc, ...(offPlatform ? { isGuestDelivery: true } : {}), ...(req.by.source === "onBehalf" ? { recordedOnBehalf: { byId: req.by.uid, byName: req.by.name, at } } : {}) })
    const entry: PoLogEntry = { at, byId: req.by.uid, byName: req.by.name, action: "delivery_reported", note: doc.notes, params: { date: req.deliveryDate, seq, via: req.by.source } }
    tx.update(poRef, { noticeSeq: seq, log: [...(po.log || []), entry], updatedAt: FieldValue.serverTimestamp() })
    return { po, seq }
  })

  await sendProcEvent(db, { id: "po_report", key: poReportKey(out.po.docNumber, out.seq), organizationId: out.po.organizationId, by: req.by.uid, at, refs: { po: out.po.docNumber, rfq: out.po.rfqId, offer: out.po.offerId }, payload: { date: req.deliveryDate, source: req.by.source } })
  try {
    const recipients = noticeAudience(noticeRecipients(out.po, out.po.preparedById), out.po as { noticeCopyTo?: unknown })
    await Promise.all(
      recipients.map((uid) =>
        db
          .collection("users")
          .doc(uid)
          .collection("notifications")
          .add(buildDeliveryNoticeNotification(out.po, uid, noticeRef.id, at))
          .catch((err: unknown) => console.warn("notice notification failed:", (err as { code?: string })?.code || err))
      )
    )
  } catch (err) {
    console.warn("notice not announced:", (err as { code?: string })?.code || err)
  }
  return { deliveryId: noticeRef.id, seq: out.seq, po: out.po }
}

// THE RECEIVER'S CONFIRMATION IS THE RECEIPT (G-09, RCV-03, WP-S5-01). Procurement forwards and follows; whoever stands at the truck —
// with an account or with a link and a code — counts blind, says what was not accepted and why, and «أكّد الاستلام» is the signature.
// ONE Admin transaction then does what Procurement's own «record the receipt» button used to: re-validates the count against the
// order as it is NOW, draws `GR-yyyy/NNN` from the company's yearly sequence, moves the order's line counters and its log, flips the
// delivery to `confirmed` (or makes it, for a truck that came with no notice), closes the notice it answers and spends the link.
// What follows — stock into the store, the books, the workshop's request, the `inv:GRN` / `prj:GRN` event, the people who must
// know — is `./receipt-effects-server`, after the commit, each step on its own.
//
// Two doors, one core: the receiver's page (a signed-in member forwarded to, or anyone holding the link's code) and the arrival of
// a truck against an order with no notice. Nothing else can create a confirmed receipt of an order — the rules refuse a browser.

import { FieldValue, type DocumentData, type DocumentReference, type Firestore, type UpdateData } from "firebase-admin/firestore"
import { RECEIPT_LINKS, type ReceiverFile, type ReceiverReport, type ReceiverReportLine } from "@/lib/receipt-links"
import { riyadhDay } from "@/lib/hr/format"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"
import { readPoliciesAdmin } from "./policies-server"
import { applyReceiptToLines, lineToArrive, round2 } from "./po"
import { ReceiptValidationError, countedLines, trimNotices, validateReceiptLines } from "./receipt-count"
import { runReceiptEffects, resolveLanding, type LandingPlace, type ReceiptEffects } from "./receipt-effects-server"
import type { ReceiptPrintFacts } from "./receipt-print"
import { receiptNetValue, type ReceiptError } from "./receipts"
import { PURCHASE_ORDERS, type DeliveryLine, type PoLogEntry, type PurchaseOrder, type ReceiptCheck } from "./types"

export type ReceiptRefusalCode = "delivery_missing" | "order_missing" | "order_not_open" | "already_received" | "link_closed" | "invalid_count"

const STATUS: Record<ReceiptRefusalCode, number> = { delivery_missing: 404, order_missing: 404, order_not_open: 409, already_received: 410, link_closed: 410, invalid_count: 400 }

export class ReceiptRefusal extends Error {
  readonly status: number
  constructor(
    readonly code: ReceiptRefusalCode,
    readonly errors: ReceiptError[] = []
  ) {
    super(code)
    this.name = "ReceiptRefusal"
    this.status = STATUS[code]
  }
}

export interface ReceiverIdentity {
  name: string
  /** Null for a person with no account — he proved his mobile with the texted code. */
  userId: string | null
  phoneMasked?: string | null
  via: "login" | "sms_code"
}

export interface ConfirmRequest {
  /** The notice being counted, or — for a truck with no notice — the id the new receipt will take. */
  deliveryId: string
  /** Set for a truck that came with no notice: the receipt is born here against this order. */
  arrivalPoId?: string | null
  linkId?: string | null
  receiver: ReceiverIdentity
  rows: ReceiverReportLine[]
  note?: string | null
  files?: ReceiverFile[] | Array<Pick<ReceiverFile, "name" | "url" | "kind">>
  /** Who forwarded the notice — told when it is counted. */
  forwardedById?: string | null
}

export interface ConfirmResult extends ReceiptEffects {
  deliveryId: string
  docNumber: string
  po: PurchaseOrder | null
  place: LandingPlace
  net: number | null
  print: ReceiptPrintFacts
}

const riyadhYear = (now: Date): number => Number(riyadhDay(now).slice(0, 4))

const asPo = (id: string, data: Record<string, unknown>): PurchaseOrder => ({ ...(data as Omit<PurchaseOrder, "id">), id, lines: ((data as { lines?: PurchaseOrder["lines"] }).lines || []) as PurchaseOrder["lines"], log: ((data as { log?: PoLogEntry[] }).log || []) as PoLogEntry[] })

/** The order patch a receipt makes — the Admin twin of `applyReceipt`. An arrival on an order the supplier never acknowledged records
 * his acceptance for him («buyer», no date): goods on our floor are the strongest acceptance there is. */
export function poReceiptPatch(
  po: PurchaseOrder,
  deliveryLines: DeliveryLine[],
  actor: { uid: string; name: string },
  receipt: { deliveryId: string; docNumber: string; at: string }
): { lines: PurchaseOrder["lines"]; patch: UpdateData<DocumentData> } {
  if (po.status !== "sent" && po.status !== "accepted") throw new ReceiptRefusal("order_not_open")
  const lines = applyReceiptToLines(po.lines, deliveryLines)
  const accepted = round2(deliveryLines.reduce((s, d) => s + Math.max(0, (d.counted ?? 0) - (d.rejected ?? 0) - (d.held ?? 0)), 0))
  const entry: PoLogEntry = { at: receipt.at, byId: actor.uid, byName: actor.name, action: "received", note: null, params: { number: receipt.docNumber, deliveryId: receipt.deliveryId, accepted } }
  const acceptance = po.status === "sent" ? { status: "accepted", supplierAcceptedAt: receipt.at, acceptanceRecordedBy: "buyer" } : {}
  const open = (po.deliveryReports || []).some((r) => !r.closedAt)
  const answered = open ? { deliveryReports: (po.deliveryReports || []).map((r) => (r.closedAt ? r : { ...r, closedAt: receipt.at, closedBy: receipt.docNumber })) } : {}
  return { lines, patch: { lines, log: [...po.log, entry], ...acceptance, ...answered, updatedAt: FieldValue.serverTimestamp() } }
}

const checklistOf = (files: Array<{ kind: string }>): ReceiptCheck[] => {
  const kinds = new Set(files.map((f) => f.kind))
  return ([kinds.has("photo") ? "photos" : null, kinds.has("ticket") ? "weighbridge" : null, kinds.has("cert") ? "certificate" : null] as Array<ReceiptCheck | null>).filter((c): c is ReceiptCheck => c != null)
}

const toLines = (rows: ReceiverReportLine[], base: Map<string, { name: string; unit: string }>): DeliveryLine[] =>
  rows.map((r) => ({
    poLineId: r.poLineId,
    name: base.get(r.poLineId)?.name || r.name,
    unit: base.get(r.poLineId)?.unit || r.unit,
    noticeQuantity: 0,
    counted: r.counted,
    rejected: r.rejected,
    rejectReason: r.rejectReason as DeliveryLine["rejectReason"],
    rejectNote: r.note,
    held: r.held,
    holdReason: r.holdReason,
  }))

type Doc = Record<string, unknown>

export async function confirmReceipt(db: Firestore, req: ConfirmRequest, now: Date = new Date()): Promise<ConfirmResult> {
  const at = now.toISOString()
  const deliveryRef = db.collection("deliveries").doc(req.deliveryId)
  const arrival = Boolean(req.arrivalPoId)
  const linkRef = req.linkId ? db.collection(RECEIPT_LINKS).doc(req.linkId) : null

  const before = arrival ? undefined : ((await deliveryRef.get()).data() as Doc | undefined)
  if (!arrival && !before) throw new ReceiptRefusal("delivery_missing")
  const poId = (arrival ? req.arrivalPoId : (before?.poId as string | undefined)) || null
  const poRef: DocumentReference | null = poId ? db.collection(PURCHASE_ORDERS).doc(poId) : null
  const poBefore = poRef ? await poRef.get() : null
  if (poRef && !poBefore?.exists) throw new ReceiptRefusal("order_missing")
  const orgId = (arrival ? (poBefore?.data() as Doc | undefined)?.organizationId : before?.contractorOrgId) as string | undefined
  if (!orgId) throw new ReceiptRefusal("delivery_missing")

  const policies = await readPoliciesAdmin(db, orgId)
  const poPre = poBefore?.exists ? asPo(poBefore.id, poBefore.data() as Doc) : null
  const projectId = (before?.projectId as string | undefined) || poPre?.projectId || null
  const place = await resolveLanding(db, orgId, { warehouseId: (before?.landedWarehouseId as string | undefined) || (before?.warehouseId as string | undefined) || null, projectId, receiverUserId: req.receiver.userId })
  const placeName = ((await db.collection("warehouses").doc(place.warehouseId).get()).data() as { name?: string } | undefined)?.name || null

  const legacyNet = !poRef && typeof before?.offerId === "string" ? await legacyOfferNet(db, before.offerId as string) : null
  const rfqId = (poPre?.rfqId || (before?.rfqId as string | undefined)) ?? null
  const purchaseSource = poPre?.purchaseSource ?? (rfqId ? (((await db.collection("rfqs").doc(rfqId).get()).data() as { purchaseSource?: PurchaseOrder["purchaseSource"] } | undefined)?.purchaseSource ?? null) : null)

  const committed = await db.runTransaction(async (tx) => {
    if (linkRef) {
      const l = (await tx.get(linkRef)).data()
      if (!l || l.status !== "open") throw new ReceiptRefusal("link_closed")
    }
    const dSnap = await tx.get(deliveryRef)
    const current = dSnap.data() as Doc | undefined
    if (arrival ? dSnap.exists : !current) throw new ReceiptRefusal(arrival ? "already_received" : "delivery_missing")
    if (!arrival && (current?.status === "confirmed" || current?.closedByReceipt)) throw new ReceiptRefusal("already_received")

    let po: PurchaseOrder | null = null
    if (poRef) {
      const pSnap = await tx.get(poRef)
      if (!pSnap.exists) throw new ReceiptRefusal("order_missing")
      po = asPo(pSnap.id, pSnap.data() as Doc)
    }
    const siblings = poId ? (await tx.get(db.collection("deliveries").where("poId", "==", poId))).docs : []
    const counter = db.collection("mfgCounters").doc(`${orgId}__GR__${riyadhYear(now)}`)
    const counterSnap = await tx.get(counter)

    const base = new Map((po ? po.lines : []).map((l) => [l.id, { name: l.name, unit: l.unit }]))
    // A line that did not arrive (counted 0) was answered, but it is not part of the receipt.
    const lines = countedLines(toLines(req.rows, base)).filter((l) => (l.counted ?? 0) > 0)
    const errors = validateReceiptLines(po, lines, policies)
    if (errors.length) throw new ReceiptRefusal("invalid_count", errors)

    const last = counterSnap.exists ? Number((counterSnap.data() as Doc).last) || 0 : 0
    const year = riyadhYear(now)
    const docNumber = formatYearlyDocNumber("GR", year, last + 1)
    tx.set(counter, { organizationId: orgId, type: "GR", year, last: last + 1, updatedAt: FieldValue.serverTimestamp() })

    const posted = siblings.filter((s) => s.id !== req.deliveryId && (s.data() as Doc).status === "confirmed").reduce((sum, s) => sum + (Number((s.data() as Doc).postedNet) || 0), 0)
    let net: number | null = null
    let after: PurchaseOrder | null = null
    if (po && poRef) {
      net = receiptNetValue(po, lines, posted)
      const made = poReceiptPatch(po, lines, { uid: req.receiver.userId || `link:${req.linkId ?? req.deliveryId}`, name: req.receiver.name }, { deliveryId: req.deliveryId, docNumber, at })
      tx.update(poRef, made.patch)
      after = { ...po, lines: made.lines, status: po.status === "sent" ? "accepted" : po.status }
    } else if (legacyNet != null && legacyNet > 0) {
      net = round2(legacyNet)
    }

    if (arrival) {
      const pending = siblings
        .filter((s) => s.id !== req.deliveryId && (s.data() as Doc).status === "pending_confirmation" && !(s.data() as Doc).closedByReceipt)
        .sort((a, b) => (Number((a.data() as Doc).seq) || 0) - (Number((b.data() as Doc).seq) || 0) || a.id.localeCompare(b.id))
      const trimmed = trimNotices(pending.map((s) => ({ lines: (((s.data() as Doc).lines as DeliveryLine[] | undefined) || []) })), lines)
      trimmed.forEach((t, i) => {
        if (t.changed) tx.update(pending[i].ref, { lines: t.lines, ...(t.closed ? { closedByReceipt: { deliveryId: req.deliveryId, docNumber } } : {}), updatedAt: FieldValue.serverTimestamp() })
      })
    }

    const files = (req.files || []).map((f) => ({ name: f.name, url: f.url, kind: f.kind }))
    const kept = ((current?.attachmentUrls as string[] | undefined) || []).filter(Boolean)
    const attachmentUrls = Array.from(new Set([...kept, ...files.map((f) => f.url)]))
    const selfReceived = Boolean(po && req.receiver.userId && po.preparedById === req.receiver.userId)
    const report: ReceiverReport = {
      linkId: req.linkId ?? "",
      receiverName: req.receiver.name,
      receiverUserId: req.receiver.userId,
      phoneMasked: req.receiver.phoneMasked ?? "",
      lines: req.rows,
      note: req.note?.trim() || null,
      signatureData: null,
      signedAt: at,
      verifiedBy: req.receiver.via,
      files,
    }
    const receipt: UpdateData<DocumentData> = {
      status: "confirmed",
      docNumber,
      lines,
      receivedByName: req.receiver.name,
      receiverUserId: req.receiver.userId,
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedByUserId: req.receiver.userId,
      confirmedByName: req.receiver.name,
      confirmedVia: req.receiver.via,
      recordedBy: "receiver",
      receiverModule: place.module,
      grnKey: `${place.module === "projects" ? "prj" : "inv"}:GRN:${docNumber}`,
      checklist: checklistOf(files),
      attachmentUrls,
      receiptNote: req.note?.trim() || null,
      receiverReport: report,
      landedWarehouseId: place.warehouseId,
      postedNet: net,
      selfReceived,
      ...(po ? { poId: po.id, poNumber: po.docNumber } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (arrival && po) {
      tx.set(deliveryRef, {
        contractorOrgId: orgId,
        contractorId: po.preparedById,
        supplierName: po.supplierName,
        rfqTitle: po.rfqTitle,
        projectId: po.projectId ?? null,
        deliveryDate: at.slice(0, 10),
        noNotice: true,
        createdAt: FieldValue.serverTimestamp(),
        ...receipt,
      })
    } else {
      tx.update(deliveryRef, receipt)
    }
    if (linkRef) tx.update(linkRef, { status: "signed", signedAt: at })
    return { docNumber, po: after, net, lines, selfReceived, delivery: current }
  })

  const d = committed.delivery
  const po = committed.po
  const effects = await runReceiptEffects(db, {
    orgId,
    deliveryId: req.deliveryId,
    docNumber: committed.docNumber,
    receiver: { uid: req.receiver.userId || `link:${req.linkId ?? req.deliveryId}`, name: req.receiver.name },
    place,
    po,
    lines: committed.lines,
    net: committed.net,
    legacyNet,
    supplierName: po?.supplierName || (d?.supplierName as string | undefined) || null,
    supplierUserId: po?.supplierUserId ?? ((d?.supplierId as string | undefined) || null),
    supplierOrgId: po?.supplierOrgId ?? ((d?.supplierOrgId as string | undefined) || null),
    isGuestDelivery: Boolean(d?.isGuestDelivery) || Boolean(po?.isGuestSupplier),
    rfqTitle: po?.rfqTitle || (d?.rfqTitle as string | undefined) || null,
    projectId,
    projectName: po?.projectName ?? null,
    purchaseSource,
    forwardedById: req.forwardedById ?? null,
    noticeSeq: d?.seq != null ? Number(d.seq) : null,
    at,
  })

  return {
    deliveryId: req.deliveryId,
    docNumber: committed.docNumber,
    po,
    place,
    net: committed.net,
    ...effects,
    print: {
      docNumber: committed.docNumber,
      supplierName: po?.supplierName || (d?.supplierName as string | undefined) || "",
      poNumber: po?.docNumber ?? ((d?.poNumber as string | undefined) || null),
      rfqTitle: po?.rfqTitle || (d?.rfqTitle as string | undefined) || "",
      receiverName: req.receiver.name,
      at,
      lines: committed.lines,
      placeName,
      selfReceived: committed.selfReceived,
      companyName: ((await db.collection("users").doc(orgId).get()).data() as { companyName?: string; name?: string } | undefined)?.companyName || "",
      via: req.receiver.via,
      complete: po ? !po.lines.some((l) => lineToArrive(l) > 0) : null,
      remaining: po ? po.lines.filter((l) => lineToArrive(l) > 0).map((l) => ({ name: l.name, unit: l.unit, quantity: lineToArrive(l) })) : [],
    },
  }
}

/** A legacy delivery (no order) is worth its awarded offer's price, EXCLUDING VAT — what the books and the one-line unit cost read. */
async function legacyOfferNet(db: Firestore, offerId: string): Promise<number | null> {
  const o = (await db.collection("offers").doc(offerId).get()).data() as { totalBatchesPrice?: unknown; price?: unknown } | undefined
  if (!o) return null
  const raw = o.totalBatchesPrice ?? o.price
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[,\s]/g, ""))
  return Number.isFinite(n) && n > 0 ? n : null
}

export { ReceiptValidationError }

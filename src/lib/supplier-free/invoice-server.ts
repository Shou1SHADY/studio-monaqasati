// A supplier's invoice on an order (PRD BIL-01/02, G-07), written by the server. The rule is the one the form shows —
// `invoiceBlocks` — run again INSIDE one transaction that also takes a lock per receipt and per invoice number, so two
// requests at once cannot bill one receipt twice or use one number twice (the second finds the lock and is refused).
// The order's log names who filed which invoice on which receipts (NFR-06); Finance is told afterwards.

import { createHash } from "node:crypto"
import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { sarParam } from "@/lib/procurement/events"
import { allLinesComplete } from "@/lib/procurement/po"
import type { PoLogEntry, PurchaseOrder } from "@/lib/procurement/types"
import { invoiceBlocks, type InvoiceBlockCode, type InvoiceFacts } from "./invoice-rules"
import { notifyNamed } from "./server-notify"

export interface InvoiceInput {
  poId: string
  grns: string[]
  number: string
  date: string
  amountNet: number
  fileName: string
  fileUrl: string
}

export interface InvoiceSupplier {
  uid: string
  orgId: string
  name: string
  company: string
  taxNumber: string
}

export type InvoiceErrorCode = "NOT_FOUND" | "FORBIDDEN" | "WRONG_STATE" | "INVOICE_BLOCKED"

export class InvoiceError extends Error {
  constructor(
    readonly code: InvoiceErrorCode,
    readonly blocks: InvoiceBlockCode[] = []
  ) {
    super(code)
    this.name = "InvoiceError"
  }
}

type Rec = Record<string, unknown>
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const riyadh = (iso: unknown) => (typeof iso === "string" && iso ? new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10) : "")

/** One lock per receipt of an order (a receipt is billed once) and one per invoice number of a supplier. */
export const receiptLockId = (poId: string, grn: string) => `${poId}__grn__${createHash("sha1").update(grn).digest("hex").slice(0, 24)}`
export const numberLockId = (orgId: string, number: string) => `${orgId}__no__${createHash("sha1").update(number.trim().toLowerCase()).digest("hex").slice(0, 24)}`

export async function createSupplierInvoice(db: Firestore, s: InvoiceSupplier, input: InvoiceInput, now: Date = new Date()): Promise<{ id: string }> {
  const poRef = db.collection("purchaseOrders").doc(input.poId)
  const invRef = db.collection("supplierInvoices").doc()
  const locks = db.collection("supplierInvoiceLocks")
  const at = now.toISOString()
  const vat = s.taxNumber.trim() ? 0.15 : 0

  const po = await db.runTransaction(async (tx) => {
    const poSnap = await tx.get(poRef)
    if (!poSnap.exists) throw new InvoiceError("NOT_FOUND")
    const po = { ...(poSnap.data() as Omit<PurchaseOrder, "id">), id: poSnap.id } as PurchaseOrder
    if (po.supplierOrgId !== s.orgId) throw new InvoiceError("FORBIDDEN")
    if (po.status !== "accepted" && po.status !== "closed") throw new InvoiceError("WRONG_STATE")

    const lockRefs = [...input.grns.map((g) => locks.doc(receiptLockId(po.id, g))), locks.doc(numberLockId(s.orgId, input.number))]
    const [receiptSnap, billedSnap, usedSnap, ...lockSnaps] = await Promise.all([
      tx.get(db.collection("deliveries").where("poId", "==", po.id)),
      tx.get(db.collection("supplierInvoices").where("poId", "==", po.id)),
      tx.get(db.collection("supplierInvoices").where("supplierOrgId", "==", s.orgId)),
      ...lockRefs.map((r) => tx.get(r)),
    ])
    const priceOf = new Map(po.lines.map((l) => [l.id, l.unitPrice]))
    const receipts = receiptSnap.docs
      .map((d): Rec & { id: string } => ({ ...(d.data() as Rec), id: d.id }))
      .filter((d) => d.status === "confirmed")
      .map((d) => {
        const lines = Array.isArray(d.lines) ? (d.lines as { poLineId?: string; accepted?: number }[]) : []
        const prices = lines.map((l) => priceOf.get(String(l.poLineId)))
        const net = prices.some((p) => p == null) ? null : r2(lines.reduce((sum, l) => sum + (Number(l.accepted) || 0) * (priceOf.get(String(l.poLineId)) as number), 0))
        return { id: String(d.docNumber || d.id), day: riyadh(d.confirmedAt), net }
      })
    const lump = po.lines.length === 0 || po.lines.some((l) => l.unitPrice == null)
    const lockedGrns = input.grns.filter((_, i) => lockSnaps[i].exists)
    const facts: InvoiceFacts = {
      today: riyadhDay(now),
      receipts,
      billed: [...billedSnap.docs.flatMap((d) => ((d.data().grns as string[]) || []).map(String)), ...lockedGrns],
      lumpTotalWhenComplete: lump && allLinesComplete(po) ? po.totalExVat : null,
      usedNumbers: [...usedSnap.docs.map((d) => String(d.data().number || "")), ...(lockSnaps[lockSnaps.length - 1].exists ? [input.number] : [])],
    }
    const blocks = invoiceBlocks(facts, { number: input.number, date: input.date, amountNet: input.amountNet, hasFile: true, grns: input.grns })
    if (blocks.length) throw new InvoiceError("INVOICE_BLOCKED", blocks)

    for (const ref of lockRefs) tx.create(ref, { poId: po.id, supplierOrgId: s.orgId, invoiceId: invRef.id, createdAt: at })
    tx.create(invRef, {
      poId: po.id,
      rfqId: po.rfqId,
      offerId: po.offerId,
      supplierOrgId: s.orgId,
      buyerOrgId: po.organizationId,
      number: input.number,
      date: input.date,
      amountNet: r2(input.amountNet),
      vat,
      file: { name: input.fileName, url: input.fileUrl },
      grns: input.grns,
      createdAt: at,
      createdById: s.uid,
      createdByName: s.name,
      createdTs: FieldValue.serverTimestamp(),
    })
    const log: PoLogEntry = { at, byId: s.uid, byName: s.name, action: "invoice_uploaded", note: null, params: { invoice: input.number, receipts: input.grns.join("، "), amount: r2(input.amountNet) } }
    tx.update(poRef, { log: [...(po.log || []), log], updatedAt: FieldValue.serverTimestamp() })
    return po
  })

  await notifyNamed(
    db,
    { uid: s.uid, name: s.name || s.company },
    {
      kind: "po_invoice_uploaded",
      organizationId: po.organizationId,
      params: { supplier: s.company, number: po.docNumber, invoice: input.number, amount: sarParam(input.amountNet) },
      poId: po.id,
      rfqId: po.rfqId,
      offerId: po.offerId,
    },
    [po.preparedById, po.approvedById, po.sentById],
    // Finance matches and schedules it.
    { permissions: ["invoices.manage"] }
  )
  return { id: invRef.id }
}

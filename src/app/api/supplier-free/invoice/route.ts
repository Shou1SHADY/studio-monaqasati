import { NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { riyadhDay } from "@/lib/hr/format"
import { allLinesComplete } from "@/lib/procurement/po"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { invoiceBlocks, type InvoiceFacts } from "@/lib/supplier-free/invoice-rules"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { sarText } from "@/lib/procurement/events"

// A supplier's invoice on an order (PRD BIL-01/02, G-07). The rule is the one the form shows — `invoiceBlocks` —
// run again here, because a button that hides is not a control: the request itself is refused (NFR-08). The
// client never writes this collection.

const body = z.object({
  poId: z.string().min(1).max(128),
  grns: z.array(z.string().min(1).max(64)).min(1).max(50),
  number: z.string().trim().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountNet: z.number().positive().max(1e9),
  fileName: z.string().min(1).max(200),
  fileUrl: z.string().url().max(2000),
})

const fail = (message: string, code: string, status: number, extra?: Record<string, unknown>) => NextResponse.json({ error: true, message, code, ...extra }, { status })
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const riyadh = (iso: unknown) => (typeof iso === "string" && iso ? new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10) : "")

export async function POST(req: Request) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail("Invalid invoice", "BAD_REQUEST", 400)
  const input = parsed.data

  const db = getAdminFirestore()
  const user = (await db.collection("users").doc(uid).get()).data() as { role?: string; organizationId?: string; name?: string; companyName?: string; taxNumber?: string } | undefined
  if (!user || user.role !== "Supplier") return fail("Suppliers only", "FORBIDDEN", 403)
  const orgId = user.organizationId || uid

  const poSnap = await db.collection("purchaseOrders").doc(input.poId).get()
  if (!poSnap.exists) return fail("Order not found", "NOT_FOUND", 404)
  const po = { ...(poSnap.data() as Omit<PurchaseOrder, "id">), id: poSnap.id } as PurchaseOrder
  if (po.supplierOrgId !== orgId) return fail("Not your order", "FORBIDDEN", 403)
  if (po.status !== "accepted" && po.status !== "closed") return fail("The order is not accepted", "WRONG_STATE", 409)

  const [receiptSnap, billedSnap, usedSnap] = await Promise.all([
    db.collection("deliveries").where("poId", "==", po.id).get(),
    db.collection("supplierInvoices").where("poId", "==", po.id).get(),
    db.collection("supplierInvoices").where("supplierOrgId", "==", orgId).get(),
  ])
  const priceOf = new Map(po.lines.map((l) => [l.id, l.unitPrice]))
  const receipts = receiptSnap.docs
    .map((d): Record<string, unknown> & { id: string } => ({ ...(d.data() as Record<string, unknown>), id: d.id }))
    .filter((d) => d.status === "confirmed")
    .map((d) => {
      const lines = Array.isArray(d.lines) ? (d.lines as { poLineId?: string; accepted?: number }[]) : []
      const prices = lines.map((l) => priceOf.get(String(l.poLineId)))
      const net = prices.some((p) => p == null) ? null : r2(lines.reduce((s, l) => s + (Number(l.accepted) || 0) * (priceOf.get(String(l.poLineId)) as number), 0))
      return { id: String((d as { docNumber?: string }).docNumber || d.id), day: riyadh((d as { confirmedAt?: string }).confirmedAt), net }
    })
  const lump = po.lines.length === 0 || po.lines.some((l) => l.unitPrice == null)
  const facts: InvoiceFacts = {
    today: riyadhDay(),
    receipts,
    billed: billedSnap.docs.flatMap((d) => ((d.data().grns as string[]) || []).map(String)),
    lumpTotalWhenComplete: lump && allLinesComplete(po) ? po.totalExVat : null,
    usedNumbers: usedSnap.docs.map((d) => String(d.data().number || "")),
  }
  const blocks = invoiceBlocks(facts, { number: input.number, date: input.date, amountNet: input.amountNet, hasFile: true, grns: input.grns })
  if (blocks.length) return fail("The invoice is not allowed", "INVOICE_BLOCKED", 409, { blocks })

  const vat = String(user.taxNumber || "").trim() ? 0.15 : 0
  const ref = await db.collection("supplierInvoices").add({
    poId: po.id,
    rfqId: po.rfqId,
    offerId: po.offerId,
    supplierOrgId: orgId,
    buyerOrgId: po.organizationId,
    number: input.number,
    date: input.date,
    amountNet: r2(input.amountNet),
    vat,
    file: { name: input.fileName, url: input.fileUrl },
    grns: input.grns,
    createdAt: new Date().toISOString(),
    createdById: uid,
    createdByName: user.name || "",
    createdTs: FieldValue.serverTimestamp(),
  })
  const company = user.companyName || user.name || ""
  await notifyNamed(
    db,
    { uid, name: user.name || company },
    {
      kind: "po_invoice_uploaded",
      organizationId: po.organizationId,
      params: { supplier: company, number: po.docNumber, invoice: input.number, amount: sarText(input.amountNet, "ar") },
      poId: po.id,
      rfqId: po.rfqId,
      offerId: po.offerId,
    },
    [po.preparedById, po.approvedById, po.sentById]
  )
  return NextResponse.json({ success: true, data: { id: ref.id } })
}

import { NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { createSupplierInvoice, InvoiceError } from "@/lib/supplier-free/invoice-server"
import { supplierCompanyOf } from "@/lib/supplier-free/supplier-company"

// A supplier's invoice on an order (PRD BIL-01/02, G-07). The rule is the one the form shows — `invoiceBlocks` — run
// again on the server inside one transaction, because a button that hides is not a control: the request itself is
// refused (NFR-08). The client never writes this collection.

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

const STATUS: Record<string, [string, number]> = {
  NOT_FOUND: ["Order not found", 404],
  FORBIDDEN: ["Not your order", 403],
  WRONG_STATE: ["The order is not accepted", 409],
  INVOICE_BLOCKED: ["The invoice is not allowed", 409],
}

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

  try {
    const db = getAdminFirestore()
    const user = (await db.collection("users").doc(uid).get()).data() as ({ role?: string } & Record<string, unknown>) | undefined
    if (!user || user.role !== "Supplier") return fail("Suppliers only", "FORBIDDEN", 403)
    // The ACTIVE company's name and VAT standing — a team member or a secondary company is not the caller's own doc.
    const c = await supplierCompanyOf(db, uid, user)
    const data = await createSupplierInvoice(db, { uid, orgId: c.orgId, name: c.name, company: c.company, vatRate: c.vatRate }, parsed.data)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof InvoiceError) {
      const [message, status] = STATUS[error.code]
      return fail(message, error.code, status, error.code === "INVOICE_BLOCKED" ? { blocks: error.blocks } : undefined)
    }
    console.error("Supplier invoice error:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

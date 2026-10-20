import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { sendEmail } from "@/lib/email"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS } from "@/lib/procurement/types"
import type { InvoiceFile } from "@/lib/procurement/payment-mark"

// «أرسلها للمحاسب» / «أرسله إلى المحاسب» (PUR-10): without Finance, the company's accounting lives
// in its own system — the supplier's invoice file, or the period's export, goes to the
// accountant's address set in Procurement's policies. With no address, the screen asks for one.

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), poId: z.string().min(1).max(128), url: z.string().url().max(2000), name: z.string().max(200) }),
  z.object({ kind: z.literal("export"), filename: z.string().regex(/^[\w.؀-ۿ -]{1,120}\.(xlsx|csv)$/), content: z.string().max(12_000_000), period: z.string().max(80) }),
])
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)

export async function POST(req: NextRequest) {
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
  if (!parsed.success) return fail("Nothing to send", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !(caller.can("offers.accept") || caller.can("po.approve"))) return fail("Not yours to send", "FORBIDDEN", 403)
    const settings = (await db.collection(PROCUREMENT_SETTINGS).doc(caller.orgId).get()).data()
    const to = typeof settings?.accountantEmail === "string" ? settings.accountantEmail : ""
    if (!to) return fail("Set the accountant's e-mail first", "NO_ACCOUNTANT", 409)
    const company = (await db.collection("users").doc(caller.orgId).get()).data()?.companyName || ""
    const data = parsed.data
    if (data.kind === "invoice") {
      const ref = db.collection(PURCHASE_ORDERS).doc(data.poId)
      const po = (await ref.get()).data()
      if (!po || po.organizationId !== caller.orgId) return fail("Order not found", "NOT_FOUND", 404)
      const files = (po.invoiceFiles || []) as InvoiceFile[]
      const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8">فاتورة المورد «${esc(String(po.supplierName || ""))}» لأمر الشراء ${esc(String(po.docNumber || ""))}<br/><a href="${esc(data.url)}">${esc(data.name)}</a><br/><br/>أرسلها ${esc(caller.name)} من ${esc(String(company))} عبر منصة مدماك تِك.</div>`
      const sent = (await sendEmail({ to, subject: `فاتورة مورد — أمر الشراء ${po.docNumber || ""}`, html })).sent
      if (!sent) return fail("The e-mail could not be sent", "NOT_SENT", 502)
      const at = new Date().toISOString()
      // A supplier's invoice from his portal joins the order's files when it is first sent, so the drawer shows the day.
      const next = files.some((f) => f.url === data.url) ? files.map((f) => (f.url === data.url ? { ...f, sentToAccountantAt: at } : f)) : [...files, { name: data.name, url: data.url, path: null, from: "supplier" as const, number: data.name, at, sentToAccountantAt: at }]
      await ref.update({ invoiceFiles: next }).catch(() => undefined)
      return NextResponse.json({ success: true, data: { to } })
    }
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8">تصدير المشتريات للمحاسبة — ${esc(data.period)}<br/>أوامر الشراء المعتمدة وسندات الاستلام، بأعمدة ثابتة في كل تصدير.<br/><br/>أرسله ${esc(caller.name)} من ${esc(String(company))} عبر منصة مدماك تِك.</div>`
    const sent = (await sendEmail({ to, subject: `تصدير المشتريات للمحاسبة — ${data.period}`, html, attachments: [{ filename: data.filename, content: data.content }] })).sent
    if (!sent) return fail("The e-mail could not be sent", "NOT_SENT", 502)
    return NextResponse.json({ success: true, data: { to } })
  } catch (error) {
    console.error("to accountant:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

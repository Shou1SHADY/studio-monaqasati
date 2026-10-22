import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { sendEmail } from "@/lib/email"
import { financeOn } from "@/lib/procurement/financeless-server"
import { attachmentUrlsOf, receiptsZip, voucherFile, type ZipEntry } from "@/lib/procurement/receipt-export"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"

// «صدّر سندات الاستلام» (RCV-06). `zip`: the screen sends the table and the print-ready document of each receipt; this route adds the
// receipts' ATTACHMENTS beside them — read from the receipts themselves, never from addresses the browser names — and returns one zip.
// `send`: without Finance the file goes to the accountant's address in the policies («أرسله إلى المحاسب»).
const OWN_STORAGE = /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//
const MAX_FILE = 8 * 1024 * 1024
const MAX_TOTAL = 30 * 1024 * 1024
const MAX_PER_RECEIPT = 10

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("zip"),
    ids: z.array(z.string().min(1).max(128)).min(1).max(300),
    documents: z.array(z.object({ id: z.string().min(1).max(128), name: z.string().regex(/^[\w.-]{1,80}$/), html: z.string().max(60_000) })).max(300),
    table: z.object({ filename: z.string().regex(/^[\w.-]{1,80}\.(xlsx|csv)$/), base64: z.string().max(4_000_000) }).nullish(),
    withFiles: z.boolean(),
  }),
  z.object({ action: z.literal("send"), filename: z.string().regex(/^[\w.-]{1,80}\.(xlsx|csv|zip)$/), base64: z.string().max(6_000_000), period: z.string().max(80) }),
])
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)

const MAY = ["po.expedite", "offers.accept", "po.approve", "deliveries.confirm", "invoices.manage"] as const

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
  if (!parsed.success) return fail("Nothing to export", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !(caller.uid === caller.orgId || MAY.some((p) => caller.can(p)))) return fail("Not yours to export", "FORBIDDEN", 403)
    const data = parsed.data

    if (data.action === "send") {
      if (await financeOn(db, caller.orgId)) return fail("Finance receives this company's receipts", "FINANCE_ON", 409)
      const settings = (await db.collection(PROCUREMENT_SETTINGS).doc(caller.orgId).get()).data()
      const to = typeof settings?.accountantEmail === "string" ? settings.accountantEmail : ""
      if (!to) return fail("Set the accountant's e-mail first", "NO_ACCOUNTANT", 409)
      const company = (await db.collection("users").doc(caller.orgId).get()).data()?.companyName || ""
      const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8">سندات الاستلام — ${esc(data.period)}<br/>جدول بأعمدة ثابتة لكل سند، ومعه سند كل شحنة إن كان الملف مضغوطاً.<br/><br/>أرسله ${esc(caller.name)} من ${esc(String(company))} عبر منصة مدماك تِك.</div>`
      const sent = (await sendEmail({ to, subject: `سندات الاستلام — ${data.period}`, html, attachments: [{ filename: data.filename, content: data.base64 }] })).sent
      if (!sent) return fail("The e-mail could not be sent", "NOT_SENT", 502)
      return NextResponse.json({ success: true, data: { to } })
    }

    const docs = await Promise.all(data.ids.map(async (id) => ({ id, d: (await db.collection("deliveries").doc(id).get()).data() as (DeskDelivery & { contractorOrgId?: string }) | undefined })))
    const own = docs.filter((x) => x.d && x.d.contractorOrgId === caller.orgId)
    const ownIds = new Set(own.map((x) => x.id))
    const documents = data.documents.filter((x) => ownIds.has(x.id)).map((x) => ({ name: x.name, html: x.html }))
    if (!documents.length) return fail("None of these receipts is yours", "NOT_FOUND", 404)
    const attachments: ZipEntry[] = []
    let total = 0
    if (data.withFiles) {
      for (const x of own) {
        const folder = voucherFile(x.d?.docNumber, x.id)
        const urls = attachmentUrlsOf(x.d as DeskDelivery).filter((u) => OWN_STORAGE.test(u)).slice(0, MAX_PER_RECEIPT)
        let n = 0
        for (const url of urls) {
          if (total >= MAX_TOTAL) break
          try {
            const res = await fetch(url)
            if (!res.ok) continue
            const bytes = new Uint8Array(await res.arrayBuffer())
            if (bytes.byteLength > MAX_FILE) continue
            total += bytes.byteLength
            n += 1
            const ext = /\.(jpe?g|png|pdf|webp|gif)(\?|$)/i.exec(decodeURIComponent(url))?.[1]?.toLowerCase() || "bin"
            attachments.push({ path: `${folder}/${n}.${ext}`, bytes })
          } catch (err) {
            console.warn("export attachment not read:", (err as { code?: string })?.code || err)
          }
        }
      }
    }
    const table = data.table ? { filename: data.table.filename, bytes: Uint8Array.from(Buffer.from(data.table.base64, "base64")) } : null
    const zip = receiptsZip({ table, documents, attachments })
    return new Response(Buffer.from(zip), { status: 200, headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="receipts.zip"', "cache-control": "no-store" } })
  } catch (error) {
    console.error("receipt export:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

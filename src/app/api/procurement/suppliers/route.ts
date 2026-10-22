import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { PROC_TAB_GATES } from "@/lib/procurement/tab-gates"
import { DIR_STATUSES, SUPPLIER_SORTS, SUPPLIER_PAGE_SIZE } from "@/lib/procurement/supplier-list"
import { contactOf } from "@/lib/procurement/invitations"
import { cardsFor, directoryPage, ensureSupplierStats, findPlatformSupplier, oursOf, readCards } from "@/lib/procurement/supplier-stats-server"

// «دليل موردي المنصة» one page at a time (SUP-01, NFR-03), and the platform numbers of named suppliers for a supplier's file
// («أتمّ N عملية على المنصة»). The browser never receives the whole platform: the server filters the verified suppliers'
// cards (`supplierStats`) with the same pure functions the lists use and answers 24 rows plus the counts. `?contact=` answers
// «موجود في المنصة» for the invitation form: the id and the name behind a mobile or e-mail, nothing else. Any member who can
// open the Suppliers tab may ask; the cards carry public facts only (no phone, e-mail or tax number).

const query = z
  .object({
    ids: z.string().max(2000).optional(),
    contact: z.string().trim().max(200).optional(),
    q: z.string().trim().max(120).default(""),
    specialty: z.string().trim().max(120).default(""),
    city: z.string().trim().max(120).default(""),
    status: z.enum(DIR_STATUSES).default("all"),
    sort: z.enum(SUPPLIER_SORTS).default("deals"),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(48).default(SUPPLIER_PAGE_SIZE),
  })
  .strict()

const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })

export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") || ""
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!idToken) return fail("Sign in first", "UNAUTHENTICATED", 401)
  let uid: string
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid
  } catch {
    return fail("Sign in first", "UNAUTHENTICATED", 401)
  }
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!parsed.success) return fail("Check the request", "BAD_REQUEST", 400)
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !PROC_TAB_GATES.suppliers.some((p) => caller.can(p))) return fail("The supplier directory is for the buying team", "FORBIDDEN", 403)
    const { ids, contact, q, specialty, city, status, sort, offset, limit } = parsed.data
    if (contact) {
      const c = contactOf(contact)
      return NextResponse.json({ success: true, data: { match: c.phone || c.email ? await findPlatformSupplier(db, c) : null } })
    }
    await ensureSupplierStats(db)
    if (ids) {
      const cards = await cardsFor(db, ids.split(",").map((s) => s.trim()).filter(Boolean))
      return NextResponse.json({ success: true, data: { cards } })
    }
    const [cards, mine] = await Promise.all([readCards(db), oursOf(db, caller.orgId, caller.uid)])
    return NextResponse.json({ success: true, data: directoryPage(cards, mine.ours, { filter: { q, specialty, city, status, sort }, offset, limit }) })
  } catch (error) {
    console.error("supplier directory:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { mfgOn } from "@/lib/procurement/financeless-server"
import { PROCUREMENT_RECEIVERS } from "@/lib/procurement/receivers"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { siteInputSchema } from "@/lib/procurement/delivery-site-input"
import { storedSites, upsertSite, type DeliverySite } from "@/lib/procurement/delivery-sites"

// «مواقع التسليم» written here (Procurement 2.0, SET-02 / ED-03): the Settings page and the editor's «+ موقع جديد»
// both save one site at a time. The owner and whoever approves orders (`po.approve`) set the sites of the company
// (PRD §4: «يضبط السياسات والمواقع والمستلمون»); a member who only asks for materials is refused. The site is added
// when its id is new and replaced when the id is already stored; the document keeps the rest of the settings.

const MAX_SITES = 500
const body = z.object({ site: siteInputSchema }).strict()
const fail = (message: string, code: string, status: number) => NextResponse.json({ error: true, message, code }, { status })
const newSiteId = () => `site_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

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
  if (!parsed.success) {
    const mapIssue = parsed.error.issues.some((i) => i.message === "map_url")
    return fail(mapIssue ? "The map link must be an https address" : "Check the site", mapIssue ? "BAD_MAP_URL" : "BAD_REQUEST", 400)
  }
  const input = parsed.data.site
  try {
    const db = getAdminFirestore()
    const caller = await callerOf(db, uid)
    if (!caller || !caller.can("po.approve")) return fail("Setting the delivery sites is the owner's or the procurement manager's", "FORBIDDEN", 403)
    if (input.kind === "workshop" && !(await mfgOn(db, caller.orgId))) return fail("The workshop is a place only with Manufacturing in the package", "MFG_OFF", 409)
    if (input.receiverId) {
      const receiver = await db.collection(PROCUREMENT_RECEIVERS).doc(input.receiverId).get()
      if (!receiver.exists || receiver.data()?.organizationId !== caller.orgId) return fail("Receiver not found", "BAD_RECEIVER", 400)
    }
    const ref = db.collection(PROCUREMENT_SETTINGS).doc(caller.orgId)
    const site = await db.runTransaction(async (tx) => {
      const list = storedSites((await tx.get(ref)).data()?.deliverySites)
      const id = input.id || newSiteId()
      if (!list.some((s) => s.id === id) && list.length >= MAX_SITES) return null
      const next: DeliverySite = {
        id,
        kind: input.kind,
        name: input.name,
        city: input.city,
        district: input.district,
        address: input.address,
        receiverId: input.receiverId || null,
        projectId: input.projectId || null,
        warehouseId: input.warehouseId || null,
        ...(input.mapUrl ? { mapUrl: input.mapUrl } : {}),
        ...(input.retired ? { retired: true } : {}),
      }
      tx.set(ref, { organizationId: caller.orgId, deliverySites: upsertSite(list, next), updatedAt: FieldValue.serverTimestamp(), updatedById: caller.uid }, { merge: true })
      return next
    })
    if (!site) return fail("Too many delivery sites", "TOO_MANY", 409)
    return NextResponse.json({ success: true, data: { site } })
  } catch (error) {
    console.error("delivery sites:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

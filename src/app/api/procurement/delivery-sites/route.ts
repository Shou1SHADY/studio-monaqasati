import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { callerOf } from "@/lib/receipt-links"
import { mfgOn } from "@/lib/procurement/financeless-server"
import { PROCUREMENT_RECEIVERS } from "@/lib/procurement/receivers"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { siteInputSchema } from "@/lib/procurement/delivery-site-input"
import { siteWriteRefusal, storedSites, upsertSite, type DeliverySite } from "@/lib/procurement/delivery-sites"

// «مواقع التسليم» written here (Procurement 2.0, SET-02 / ED-03): the Settings page and the editor's «+ موقع جديد»
// both save one site at a time. The owner and whoever approves orders (`po.approve`) set the sites of the company
// (PRD §4: «يضبط السياسات والمواقع والمستلمون»): they add, change and retire. Whoever builds a request
// (`rfq.create` / `rfq.manage` / `offers.accept`) may ADD a new site from the editor's «+ موقع جديد» (ED-22, prototype
// 4616/4640) — never change or retire one already stored. A member who only asks for materials is refused. The site is
// added when its id is new and replaced when the id is already stored; the document keeps the rest of the settings.

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
    if (!caller || siteWriteRefusal(caller.can, false, !!input.retired)) return fail("Setting the delivery sites is the owner's or the procurement manager's", "FORBIDDEN", 403)
    if (input.kind === "workshop" && !(await mfgOn(db, caller.orgId))) return fail("The workshop is a place only with Manufacturing in the package", "MFG_OFF", 409)
    if (input.receiverId) {
      const receiver = await db.collection(PROCUREMENT_RECEIVERS).doc(input.receiverId).get()
      if (!receiver.exists || receiver.data()?.organizationId !== caller.orgId) return fail("Receiver not found", "BAD_RECEIVER", 400)
    }
    if (input.managerId) {
      const member = (await db.collection("users").doc(input.managerId).get()).data()
      if (!member || ((member.organizationId as string) || input.managerId) !== caller.orgId) return fail("That member is not in this company", "BAD_MANAGER", 400)
    }
    const ref = db.collection(PROCUREMENT_SETTINGS).doc(caller.orgId)
    const site = await db.runTransaction(async (tx) => {
      const list = storedSites((await tx.get(ref)).data()?.deliverySites)
      const id = input.id || newSiteId()
      // A buyer adds; only an approver changes a stored site (re-checked on the list just read).
      if (list.some((s) => s.id === id) && siteWriteRefusal(caller.can, true, !!input.retired)) return "forbidden" as const
      if (!list.some((s) => s.id === id) && list.length >= MAX_SITES) return null
      // The editor's «+ موقع جديد» does not send the manager: a site saved without the key keeps the one it had.
      const managerId = input.managerId !== undefined ? input.managerId : list.find((s) => s.id === id)?.managerId ?? null
      const next: DeliverySite = {
        id,
        kind: input.kind,
        name: input.name,
        city: input.city,
        district: input.district,
        address: input.address,
        receiverId: input.receiverId || null,
        ...(managerId ? { managerId } : {}),
        projectId: input.projectId || null,
        warehouseId: input.warehouseId || null,
        ...(input.mapUrl ? { mapUrl: input.mapUrl } : {}),
        ...(input.retired ? { retired: true } : {}),
      }
      tx.set(ref, { organizationId: caller.orgId, deliverySites: upsertSite(list, next), updatedAt: FieldValue.serverTimestamp(), updatedById: caller.uid }, { merge: true })
      return next
    })
    if (site === "forbidden") return fail("Changing a stored delivery site is the owner's or the procurement manager's", "FORBIDDEN", 403)
    if (!site) return fail("Too many delivery sites", "TOO_MANY", 409)
    return NextResponse.json({ success: true, data: { site } })
  } catch (error) {
    console.error("delivery sites:", error)
    return fail("Internal server error", "INTERNAL", 500)
  }
}

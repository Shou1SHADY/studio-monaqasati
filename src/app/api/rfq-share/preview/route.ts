import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { buildLinkView } from "@/lib/procurement/rfq-share-view"
import { statsOf } from "@/lib/procurement/link-views"
import { orderUrlOf } from "@/lib/procurement/visitor-order-link"
import { offerOfVisitor, visitorMe } from "@/lib/procurement/visitor-offer-server"
import { failure } from "@/lib/procurement/visitor-http"
import { shareLinkValidUntil } from "@/lib/procurement/guest-supplier"
import type { InquiryDoc } from "@/lib/procurement/rfq-inquiries"

// Authenticated, for the buyer of the request: the page a visitor would see, through the eyes of a new supplier or of a visitor
// who already quoted (his quote, what was asked of him, his result), and the link's counters. It reads the link and never
// writes to it — a buyer's preview is not counted as a view (R-21, LNK-13).
//   GET /api/rfq-share/preview?rfqId=…[&as=<offerId>]

export async function GET(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").startsWith("Bearer ") ? (req.headers.get("authorization") as string).slice(7) : null
    if (!idToken) return failure("Authentication required", "UNAUTHENTICATED", 401)
    let uid: string
    try {
      uid = (await getAdminAuth().verifyIdToken(idToken)).uid
    } catch {
      return failure("Invalid or expired session", "UNAUTHENTICATED", 401)
    }
    const params = new URL(req.url).searchParams
    const rfqId = params.get("rfqId") || ""
    const as = params.get("as") || ""
    if (!rfqId) return failure("A valid RFQ id is required", "INVALID_INPUT", 400)

    const db = getAdminFirestore()
    const [userSnap, rfqSnap] = await Promise.all([db.collection("users").doc(uid).get(), db.collection("rfqs").doc(rfqId).get()])
    const user = userSnap.data()
    if (!user) return failure("User profile not found", "PROFILE_NOT_FOUND", 403)
    if (!rfqSnap.exists) return failure("RFQ not found", "RFQ_NOT_FOUND", 404)
    const rfq = rfqSnap.data() as Record<string, unknown>
    const orgId = (user.organizationId as string) || uid
    const rfqOrg = (rfq.organizationId as string) || (rfq.contractorId as string)
    if (user.role !== "Admin" && rfqOrg !== orgId) return failure("You can only preview your own RFQs", "FORBIDDEN", 403)

    const now = new Date()
    const [inquiries, links, offers] = await Promise.all([
      db.collection("rfqs").doc(rfqId).collection("inquiries").limit(200).get(),
      db.collection("rfqShareLinks").where("rfqId", "==", rfqId).where("revoked", "==", false).limit(10).get(),
      db.collection("offers").where("rfqId", "==", rfqId).where("isGuestOffer", "==", true).get(),
    ])
    const view = buildLinkView(rfq, rfqId, now, inquiries.docs.map((d) => d.data() as InquiryDoc))
    const link = links.docs[0]
    const visitors = offers.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown> & { id: string })
      .filter((o) => o.status !== "مسحوب" && !o.withdrawnAt)
      .map((o) => ({ offerId: o.id, company: String(o.companyName || o.supplierName || "") }))

    let me = null
    if (as) {
      const picked = offers.docs.find((d) => d.id === as)
      const phone = (picked?.data().guestContact as { phone?: string } | undefined)?.phone
      if (picked && phone && offerOfVisitor(picked.data() as Record<string, unknown>, phone)) {
        me = await visitorMe(db, { phone, linkId: link?.id || "" }, { rfqId, rfq, now, orderUrlOf: (poId) => orderUrlOf(db, poId) })
      }
    }

    let contractorName = ""
    try {
      const contractor = (await db.collection("users").doc(rfq.contractorId as string).get()).data()
      contractorName = (contractor?.companyName as string) || (contractor?.name as string) || ""
    } catch {
      // Display-only.
    }

    return NextResponse.json({
      success: true,
      data: {
        rfq: view.rfq,
        contractorName,
        queries: view.queries,
        canSubmit: view.rfq.state === "open",
        linkExpiresAt: link ? shareLinkValidUntil(link.data(), rfq) : null,
        stats: statsOf(link?.data()),
        visitors,
        me,
      },
    })
  } catch (err) {
    console.error("RFQ share preview error:", err)
    return failure("Failed to build the preview", "INTERNAL_ERROR", 500)
  }
}

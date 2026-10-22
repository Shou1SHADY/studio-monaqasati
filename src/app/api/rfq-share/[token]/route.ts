import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveShareToken, isRfqDeadlinePassed } from "@/lib/rfq-share"
import { canSendCodes } from "@/lib/sms"
import { guestCodeAvailable, shareLinkValidUntil } from "@/lib/procurement/guest-supplier"
import { buildLinkView } from "@/lib/procurement/rfq-share-view"
import { countLinkView, isViewerId } from "@/lib/procurement/link-views"
import { testingEnvironment } from "@/lib/procurement/visitor-http"
import type { InquiryDoc } from "@/lib/procurement/rfq-inquiries"

// Public endpoint: resolves a share token to the RFQ's display data so a visitor can review it without an account. Tokens are
// unguessable (128 random bits), so no auth is required. Only what a visitor may see is returned (`rfq-share-view.ts`): the
// city and the district — never the site's pin, its address or the project's name — and the questions answered to everyone,
// never who asked. A decided or cancelled request still opens, view-only, so a visitor who quoted can read his result.
// The open is counted once per browser (`?v=`); the buyer's own preview is another route and never counts (R-21).

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const resolution = await resolveShareToken(token)
    if (!resolution.ok) {
      return errorResponse("This link is invalid or has expired", resolution.code, resolution.status)
    }

    const { rfq, rfqId, link, linkId } = resolution
    const db = getAdminFirestore()

    let contractorName = ""
    try {
      const contractor = (await db.collection("users").doc(rfq.contractorId as string).get()).data()
      contractorName = (contractor?.companyName as string) || (contractor?.name as string) || ""
    } catch {
      // Display-only — the page falls back to a generic label.
    }

    let inquiries: InquiryDoc[] = []
    try {
      const snap = await db.collection("rfqs").doc(rfqId).collection("inquiries").limit(200).get()
      inquiries = snap.docs.map((d) => d.data() as InquiryDoc)
    } catch (err) {
      console.error("RFQ share queries lookup failed:", err)
    }

    const now = new Date()
    const view = buildLinkView(rfq, rfqId, now, inquiries)
    const viewer = new URL(req.url).searchParams.get("v")
    if (isViewerId(viewer)) await countLinkView(db, linkId, viewer, now.getTime())

    const deadlinePassed = isRfqDeadlinePassed(rfq)
    return NextResponse.json({
      success: true,
      data: {
        rfq: view.rfq,
        contractorName,
        linkExpiresAt: shareLinkValidUntil(link, rfq) || link.expiresAt,
        deadlinePassed,
        canSubmit: rfq.status === "New" && !deadlinePassed,
        codeAvailable: guestCodeAvailable(canSendCodes(), testingEnvironment()),
        queries: view.queries,
      },
    })
  } catch (err) {
    console.error("RFQ share lookup error:", err)
    return errorResponse("Failed to load this RFQ", "INTERNAL_ERROR", 500)
  }
}

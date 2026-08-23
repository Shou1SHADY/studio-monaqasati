import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendEmail, buildRfqShareEmail } from "@/lib/email"
import { PUBLIC_BASE_URL } from "@/lib/rfq-share"

// Creates (or reuses) a portable guest link for an RFQ. The link lets a
// supplier view the RFQ and submit an offer WITHOUT registering. Links are
// unguessable 32-byte hex tokens and expire 3 days after creation.

const SHARE_LINK_TTL_DAYS = 3

const bodySchema = z.object({
  rfqId: z.string().trim().min(1).max(128),
  // Optional: also send the link by email through the platform (Resend).
  email: z.string().trim().toLowerCase().email().optional(),
  // Optional: which channel the contractor actually shared on. Recorded so the
  // rest of the RFQ workflow (reduction, sample, award, ...) can reach the
  // guest supplier back on the same channel.
  channel: z.enum(["whatsapp", "email", "link"]).optional(),
})

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ error: true, message, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    // --- Authentication ---
    const authHeader = req.headers.get("authorization") || ""
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!idToken) return errorResponse("Authentication required", "UNAUTHENTICATED", 401)

    let decoded
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken)
    } catch {
      return errorResponse("Invalid or expired session", "UNAUTHENTICATED", 401)
    }

    // --- Input validation ---
    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return errorResponse("A valid RFQ id is required", "INVALID_INPUT", 400)
    }
    const { rfqId, email, channel } = parsed.data
    // Sending through the platform is itself an email share.
    const effectiveChannel = channel || (email ? "email" : null)

    // --- Load sender + RFQ, verify ownership ---
    const db = getAdminFirestore()
    const [senderSnap, rfqSnap] = await Promise.all([
      db.collection("users").doc(decoded.uid).get(),
      db.collection("rfqs").doc(rfqId).get(),
    ])
    const sender = senderSnap.data()
    if (!sender) return errorResponse("User profile not found", "PROFILE_NOT_FOUND", 403)
    if (!rfqSnap.exists) return errorResponse("RFQ not found", "RFQ_NOT_FOUND", 404)

    const rfq = rfqSnap.data()!
    const senderOrgId = (sender.organizationId as string) || decoded.uid
    const isAdmin = sender.role === "Admin"
    const rfqOrgId = (rfq.organizationId as string) || (rfq.contractorId as string)
    if (!isAdmin && rfqOrgId !== senderOrgId) {
      return errorResponse("You can only share your own RFQs", "FORBIDDEN", 403)
    }
    if (rfq.status !== "New") {
      return errorResponse("Only published RFQs can be shared", "RFQ_NOT_PUBLISHED", 409)
    }

    // --- Reuse a still-valid link for this RFQ, otherwise mint a new one ---
    const now = Date.now()
    const existing = await db
      .collection("rfqShareLinks")
      .where("rfqId", "==", rfqId)
      .where("revoked", "==", false)
      .limit(10)
      .get()

    let token: string | null = null
    let expiresAt: string | null = null
    for (const d of existing.docs) {
      const data = d.data()
      const exp = new Date(data.expiresAt as string).getTime()
      if (exp > now) {
        token = data.token as string
        expiresAt = data.expiresAt as string
        if (effectiveChannel) {
          await d.ref
            .update({ channel: effectiveChannel, channelUpdatedAt: new Date().toISOString() })
            .catch((err) => console.error("Failed to record share channel:", err))
        }
        break
      }
    }

    if (!token) {
      token = randomBytes(32).toString("hex")
      expiresAt = new Date(now + SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      await db.collection("rfqShareLinks").add({
        token,
        rfqId,
        channel: effectiveChannel || "link",
        channelUpdatedAt: new Date().toISOString(),
        rfqTitle: (rfq.title as string) || "",
        contractorId: (rfq.contractorId as string) || decoded.uid,
        organizationId: rfqOrgId,
        createdBy: decoded.uid,
        createdByName: (sender.name as string) || (sender.companyName as string) || "",
        revoked: false,
        offersSubmitted: 0,
        expiresAt,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    const shareUrl = `${PUBLIC_BASE_URL}/rfq/${token}`

    // --- Optional: send the link by email through the platform ---
    let emailSent = false
    if (email) {
      const contractorName = (sender.companyName as string) || (sender.name as string) || ""
      const { subject, html } = buildRfqShareEmail({
        contractorName,
        rfqTitle: (rfq.title as string) || "",
        deadline: (rfq.deadline as string) || null,
        shareUrl,
        linkExpiresAt: expiresAt!,
      })
      const result = await sendEmail({ to: email, subject, html })
      emailSent = result.sent
    }

    return NextResponse.json({
      success: true,
      data: { url: shareUrl, token, expiresAt, emailSent },
    })
  } catch (err) {
    console.error("RFQ share link create error:", err)
    return errorResponse("Failed to create share link", "INTERNAL_ERROR", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendEmail, buildRfqShareEmail } from "@/lib/email"
import { resolveIdentityAdmin } from "@/lib/org-identity-admin"
import { PUBLIC_BASE_URL } from "@/lib/rfq-share"
import {
  MAX_GUEST_INVITES,
  deadlineEnd,
  guestInviteOf,
  guestInvitesNewestFirst,
  shareLinkState,
  shareLinkValidUntil,
  type GuestInvite,
} from "@/lib/procurement/guest-supplier"
import { rfqLogEntry } from "@/lib/procurement/rfq-detail"

// Creates (or reuses) a portable guest link for an RFQ. The link lets a
// supplier view the RFQ and submit an offer WITHOUT registering. Links are
// unguessable 32-byte hex tokens, valid until the RFQ's deadline (an extension
// reopens them); an RFQ with no deadline falls back to a fixed 3 days.
// Every share on a channel is kept on the link as «دعوات الزوار» (the link doc
// is server-only — a guest's address never lands on the semi-public RFQ; the
// RFQ keeps only the count and a log line naming the channel).

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
    const senderBase = senderSnap.data()
    if (!senderBase) return errorResponse("User profile not found", "PROFILE_NOT_FOUND", 403)
    if (!rfqSnap.exists) return errorResponse("RFQ not found", "RFQ_NOT_FOUND", 404)
    // The sender's ACTIVE company's identity — a secondary company (added via
    // the company-switcher) has its own name on organizations/{id}, not on
    // the sender's own users/{uid} doc — see org-identity-admin.ts.
    const sender = (await resolveIdentityAdmin(db, decoded.uid, senderBase)) as Record<string, unknown>

    const rfq = rfqSnap.data()!
    const senderOrgId = (senderBase.organizationId as string) || decoded.uid
    const isAdmin = senderBase.role === "Admin"
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
    let linkRef: FirebaseFirestore.DocumentReference | null = null
    let invites: GuestInvite[] = []
    const nowDate = new Date(now)
    const byDeadline = Boolean(deadlineEnd(rfq.deadline as string | null))
    // With a deadline only a deadline-bound link is reused (it follows the date,
    // so it is never stale); an older 3-day link keeps working for whoever has it.
    const found = existing.docs.find((d) => shareLinkState(d.data(), rfq, nowDate) !== "gone" && (d.data().expiresWith === "deadline") === byDeadline)
    if (found) {
      const data = found.data()
      token = data.token as string
      expiresAt = shareLinkValidUntil(data, rfq)
      linkRef = found.ref
      invites = (data.invites as GuestInvite[] | undefined) || []
      if (effectiveChannel) {
        await found.ref
          .update({ channel: effectiveChannel, channelUpdatedAt: new Date().toISOString() })
          .catch((err) => console.error("Failed to record share channel:", err))
      }
    }

    if (!token) {
      token = randomBytes(32).toString("hex")
      expiresAt = byDeadline ? deadlineEnd(rfq.deadline as string) : new Date(now + SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      linkRef = await db.collection("rfqShareLinks").add({
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
        ...(byDeadline ? { expiresWith: "deadline" } : {}),
        expiresAt,
        invites: [],
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    const shareUrl = `${PUBLIC_BASE_URL}/rfq/${token}`
    const closed = shareLinkState({ expiresAt, expiresWith: byDeadline ? "deadline" : null }, rfq, nowDate) === "closed"

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

    // «دعوات الزوار»: a share on a channel, or an invitation the platform sent.
    const byName = (senderBase.name as string) || (sender.name as string) || ""
    const invite = email && !emailSent ? null : guestInviteOf(channel ?? null, email ?? null, new Date(now).toISOString(), byName)
    if (invite && linkRef && invites.length < MAX_GUEST_INVITES) {
      invites = [...invites, invite]
      const logAction = invite.channel === "plat" ? "guest_link_emailed" : "guest_link_shared"
      await Promise.all([
        linkRef.update({ invites: FieldValue.arrayUnion(invite) }),
        rfqSnap.ref.update({
          guestInviteCount: FieldValue.increment(1),
          log: FieldValue.arrayUnion(rfqLogEntry({ uid: decoded.uid, name: byName }, logAction, invite.at, { params: { channel: `@guestChannel.${invite.channel}` } })),
        }),
      ]).catch((err) => console.error("Failed to record guest invitation:", err))
    }

    return NextResponse.json({
      success: true,
      data: {
        url: shareUrl,
        token,
        expiresAt,
        emailSent,
        closed,
        validity: byDeadline ? "deadline" : "ttl",
        invites: guestInvitesNewestFirst(invites),
        rfq: {
          title: (rfq.title as string) || "",
          number: (rfq.rfqNumber as string) || null,
          city: (rfq.city as string) || null,
          district: (rfq.district as string) || null,
          deadline: (rfq.deadline as string) || null,
        },
      },
    })
  } catch (err) {
    console.error("RFQ share link create error:", err)
    return errorResponse("Failed to create share link", "INTERNAL_ERROR", 500)
  }
}

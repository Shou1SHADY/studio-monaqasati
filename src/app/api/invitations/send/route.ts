import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendEmail, buildSupplierInviteEmail } from "@/lib/email"

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  companyName: z.string().trim().max(200).optional(),
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
      return errorResponse("A valid email address is required", "INVALID_INPUT", 400)
    }
    const { email, companyName } = parsed.data

    if (decoded.email && email === decoded.email.toLowerCase()) {
      return errorResponse("You cannot invite your own email address", "SELF_INVITE", 400)
    }

    // --- Authorization: sender must be a Contractor (or Admin) ---
    const db = getAdminFirestore()
    const senderSnap = await db.collection("users").doc(decoded.uid).get()
    const sender = senderSnap.data()
    if (!sender) return errorResponse("User profile not found", "PROFILE_NOT_FOUND", 403)
    if (sender.role !== "Contractor" && sender.role !== "Admin") {
      return errorResponse("Only contractors can invite suppliers", "FORBIDDEN", 403)
    }
    const contractorOrgId = (sender.organizationId as string) || decoded.uid
    const contractorName = (sender.companyName as string) || (sender.name as string) || ""

    // --- Reuse an existing pending invitation to the same email (resend the email) ---
    const existing = await db
      .collection("invitations")
      .where("contractorOrgId", "==", contractorOrgId)
      .where("email", "==", email)
      .where("type", "==", "supplier_invite")
      .where("status", "==", "pending")
      .limit(1)
      .get()

    let invitationRef
    let inviteToken: string
    if (!existing.empty) {
      invitationRef = existing.docs[0].ref
      inviteToken = existing.docs[0].data().inviteToken
      if (!inviteToken) {
        inviteToken = randomBytes(32).toString("hex")
        await invitationRef.update({ inviteToken })
      }
    } else {
      inviteToken = randomBytes(32).toString("hex")
      invitationRef = await db.collection("invitations").add({
        email,
        companyName: companyName || null,
        invitedBy: decoded.uid,
        contractorOrgId,
        contractorName,
        status: "pending",
        type: "supplier_invite",
        inviteToken,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    // --- Existing account? Point them at login; new users get the register link ---
    let isExistingUser = false
    try {
      await getAdminAuth().getUserByEmail(email)
      isExistingUser = true
    } catch {
      isExistingUser = false
    }

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://mdmaktech.sa").replace(/\/$/, "")
    const inviteUrl = isExistingUser
      ? `${baseUrl}/login`
      : `${baseUrl}/register?invite=${inviteToken}`

    const { subject, html } = buildSupplierInviteEmail({
      contractorName,
      companyName,
      inviteUrl,
      isExistingUser,
    })
    const result = await sendEmail({ to: email, subject, html })

    if (result.sent) {
      await invitationRef
        .update({ emailSentAt: FieldValue.serverTimestamp() })
        .catch((err) => console.error("Failed to record emailSentAt:", err))
    }

    return NextResponse.json({
      success: true,
      data: {
        invitationId: invitationRef.id,
        emailSent: result.sent,
        isExistingUser,
      },
    })
  } catch (err) {
    console.error("Invitation send error:", err)
    return errorResponse("Failed to send invitation", "INTERNAL_ERROR", 500)
  }
}

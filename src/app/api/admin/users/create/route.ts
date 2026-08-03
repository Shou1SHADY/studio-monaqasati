import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendEmail, buildAccountCreatedEmail } from "@/lib/email"

// Admin-only account creation. This is the sole way a Contractor/Supplier
// account can come into existence now that public self-registration has
// been removed — the admin reviews a demo/onboarding lead, then creates the
// account here. The new user gets a Firebase-generated password-set link by
// email; the admin never sees or sets a password.

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().max(30).optional(),
    role: z.enum(["Contractor", "Supplier"]),
    specializations: z.array(z.string().trim().min(1)).optional(),
    leadId: z.string().trim().min(1).optional(),
    leadCollection: z.enum(["demoRequests", "onboardingRequests"]).optional(),
  })
  .refine((data) => data.role !== "Supplier" || (data.specializations && data.specializations.length > 0), {
    message: "At least one specialization is required for supplier accounts",
    path: ["specializations"],
  })
  .refine((data) => !data.leadId || !!data.leadCollection, {
    message: "leadCollection is required when leadId is provided",
    path: ["leadCollection"],
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

    const db = getAdminFirestore()
    const senderSnap = await db.collection("users").doc(decoded.uid).get()
    const sender = senderSnap.data()
    if (!sender || sender.role !== "Admin") {
      return errorResponse("Only admins can create accounts", "FORBIDDEN", 403)
    }

    // --- Input validation ---
    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid input", "INVALID_INPUT", 400)
    }
    const { name, email, phone, role, specializations, leadId, leadCollection } = parsed.data

    // --- Create the Auth account (no password — the user sets their own) ---
    const adminAuth = getAdminAuth()
    let uid: string
    try {
      const created = await adminAuth.createUser({ email, displayName: name, emailVerified: false })
      uid = created.uid
    } catch (err: any) {
      if (err?.code === "auth/email-already-exists") {
        return errorResponse("An account with this email already exists", "EMAIL_IN_USE", 409)
      }
      console.error("Failed to create Auth user:", err)
      return errorResponse("Failed to create account", "INTERNAL_ERROR", 500)
    }

    // --- Create the Firestore profile (atomic: roll back the Auth user if this fails) ---
    try {
      await db.collection("users").doc(uid).set({
        id: uid,
        name,
        email,
        phone: phone || "",
        role,
        organizationId: uid,
        organizationRole: "owner",
        specializations: role === "Supplier" ? specializations : [],
        providers: ["password"],
        isVerified: true,
        profileCompleted: false,
        createdByAdmin: true,
        createdByAdminUid: decoded.uid,
        createdByAdminAt: FieldValue.serverTimestamp(),
        ...(leadId ? { convertedFromLeadId: leadId, convertedFromLeadCollection: leadCollection } : {}),
        joinedAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error("Failed to write user profile, rolling back Auth user:", err)
      await adminAuth.deleteUser(uid).catch(() => {})
      return errorResponse("Failed to create account", "INTERNAL_ERROR", 500)
    }

    // --- Email the new user a password-set link ---
    let emailSent = false
    try {
      const setPasswordUrl = await adminAuth.generatePasswordResetLink(email)
      const { subject, html } = buildAccountCreatedEmail({ name, role, setPasswordUrl })
      const result = await sendEmail({ to: email, subject, html })
      emailSent = result.sent
    } catch (err) {
      console.error("Failed to send account-created email:", err)
    }

    // --- Mark the source lead as converted (non-fatal) ---
    if (leadId && leadCollection) {
      await db
        .collection(leadCollection)
        .doc(leadId)
        .update({ status: "converted", convertedUserId: uid, convertedAt: FieldValue.serverTimestamp() })
        .catch((err) => console.error("Failed to mark lead as converted:", err))
    }

    return NextResponse.json({ success: true, data: { uid, emailSent } })
  } catch (err) {
    console.error("Admin create-account error:", err)
    return errorResponse("Failed to create account", "INTERNAL_ERROR", 500)
  }
}

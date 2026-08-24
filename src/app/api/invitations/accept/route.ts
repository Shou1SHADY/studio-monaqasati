import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { resolveIdentityAdmin } from "@/lib/org-identity-admin"

// Called right after a newly registered supplier signs up through an
// invitation link. Creates the contractor–supplier connection server-side so
// it works even when the supplier registered with a different email address
// than the one the invitation was sent to (the token is the capability).

const bodySchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
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
    if (!parsed.success) return errorResponse("Invalid invitation token", "INVALID_INPUT", 400)
    const { token, name, phone } = parsed.data

    // --- Load the invitation ---
    const db = getAdminFirestore()
    const snap = await db
      .collection("invitations")
      .where("inviteToken", "==", token)
      .limit(1)
      .get()
    if (snap.empty) return errorResponse("Invitation not found", "NOT_FOUND", 404)

    const invitationRef = snap.docs[0].ref
    const inv = snap.docs[0].data()
    const validType = inv.type === "supplier_invite" || inv.type === "team_invite"
    if (!validType || inv.status !== "pending") {
      return errorResponse("This invitation is no longer valid", "INVITATION_NOT_PENDING", 410)
    }

    // --- Load the accepting user, creating their profile if this is their
    // first action after Auth signup. Public self-registration no longer
    // writes users/{uid} client-side (firestore.rules restricts that create
    // to admins), so an invited user's profile is created here instead —
    // the invitation itself (already validated above) is the authorization.
    const userRef = db.collection("users").doc(decoded.uid)
    const userSnap = await userRef.get()
    let profile = userSnap.data()
    let justCreatedProfile = false
    // If a validation below rejects the invitation after we've created the
    // profile in this same request, undo it — otherwise a malformed/self-
    // targeted invitation would leave a Firestore profile with no accepted
    // org link and no way for the client's Auth-account rollback to know
    // about it (mirrors the atomic create-or-rollback pattern this replaced).
    const rejectAfterCreate = async (message: string, code: string, status: number) => {
      if (justCreatedProfile) await userRef.delete().catch(() => {})
      return errorResponse(message, code, status)
    }
    if (!profile) {
      justCreatedProfile = true
      const email = (decoded.email || "").toLowerCase()
      const role = inv.type === "supplier_invite" ? "Supplier" : (inv.role as string) || "Contractor"
      const provider = decoded.firebase?.sign_in_provider === "google.com" ? "google.com" : "password"
      profile = {
        id: decoded.uid,
        name: name || decoded.name || "",
        email,
        phone: phone || "",
        role,
        organizationId: decoded.uid,
        organizationRole: "owner",
        specializations: [] as string[],
        providers: [provider],
        isVerified: false,
        profileCompleted: false,
        joinedAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
      }
      await userRef.set(profile)
    }

    // ============================ TEAM INVITE ============================
    if (inv.type === "team_invite") {
      if (!inv.organizationId) {
        return rejectAfterCreate("Invitation is missing organization information", "INVALID_INVITATION", 422)
      }
      if (inv.organizationId === decoded.uid) {
        return rejectAfterCreate("You cannot accept an invitation to your own organization", "SELF_ACCEPT", 400)
      }
      // Guard: already a member of a different org (a solo org — own uid — is fine).
      if (
        profile.organizationId &&
        profile.organizationId !== decoded.uid &&
        profile.organizationId !== inv.organizationId
      ) {
        return rejectAfterCreate("You already belong to another organization", "IN_OTHER_ORG", 409)
      }

      await db.collection("users").doc(decoded.uid).update({
        organizationId: inv.organizationId,
        organizationRole: "member",
        role: inv.role || profile.role || "Contractor",
        defaultGroupId: inv.groupId || null,
      })

      await invitationRef.update({
        status: "accepted",
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedBy: decoded.uid,
        acceptedEmail: (profile.email as string) || decoded.email || null,
      })

      await db
        .collection("teamActivity")
        .add({
          organizationId: inv.organizationId,
          type: "member_joined",
          actorId: decoded.uid,
          actorName: (profile.name as string) || (profile.email as string) || "",
          targetName: null,
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch((err) => console.error("Failed to log join activity:", err))

      // Notify the new member (reuses the "invitation" type the notifications
      // pages already render with a "Go to Team" button) and the inviter, so
      // acceptance is visible on both sides instead of leaving no trace.
      const acceptedName = (profile.name as string) || (profile.email as string) || decoded.email || ""
      await db
        .collection("users")
        .doc(decoded.uid)
        .collection("notifications")
        .add({
          title: "انضممت إلى الفريق",
          message: `أصبحت الآن عضواً في فريق ${(inv.organizationName as string) || ""}. يمكنك الاطلاع على صلاحياتك من صفحة إدارة الفريق.`,
          type: "invitation",
          organizationId: inv.organizationId,
          createdAt: new Date().toISOString(),
          read: false,
        })
        .catch((err) => console.error("Failed to create join notification:", err))
      if (inv.invitedBy) {
        await db
          .collection("users")
          .doc(inv.invitedBy as string)
          .collection("notifications")
          .add({
            title: "تم قبول دعوة الفريق",
            message: `${acceptedName} انضم إلى فريقك.`,
            type: "team_invite_accepted",
            organizationId: inv.organizationId,
            createdAt: new Date().toISOString(),
            read: false,
          })
          .catch((err) => console.error("Failed to notify inviter of acceptance:", err))
      }

      return NextResponse.json({ success: true, data: { joined: true, organizationId: inv.organizationId } })
    }

    // ========================== SUPPLIER INVITE ==========================
    if (!inv.contractorOrgId) {
      return rejectAfterCreate("Invitation is missing contractor information", "INVALID_INVITATION", 422)
    }
    if (profile.role !== "Supplier") {
      return rejectAfterCreate("Only supplier accounts can accept supplier invitations", "FORBIDDEN", 403)
    }

    const supplierOrgId = (profile.organizationId as string) || decoded.uid
    if (supplierOrgId === inv.contractorOrgId) {
      return rejectAfterCreate("You cannot accept an invitation from your own organization", "SELF_ACCEPT", 400)
    }

    // Identity fields (companyName, specializations, ...) for display below —
    // resolved against a secondary company if this account is currently
    // switched into one, per src/lib/org-identity-admin.ts.
    const resolvedProfile = (await resolveIdentityAdmin(db, decoded.uid, profile)) as Record<string, unknown>

    // --- Create the link unless one is already active ---
    const linksSnap = await db
      .collection("contractorSupplierLinks")
      .where("contractorOrgId", "==", inv.contractorOrgId)
      .where("supplierOrgId", "==", supplierOrgId)
      .get()
    const hasActiveLink = linksSnap.docs.some((d) => d.data().status === "active")

    if (!hasActiveLink) {
      await db.collection("contractorSupplierLinks").add({
        contractorOrgId: inv.contractorOrgId,
        supplierOrgId,
        supplierName: (resolvedProfile.companyName as string) || (resolvedProfile.name as string) || "",
        supplierCategories: (resolvedProfile.specializations as string[]) || [],
        status: "active",
        requestedBy: "contractor",
        requestedAt: FieldValue.serverTimestamp(),
        connectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    await invitationRef.update({
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedBy: decoded.uid,
      acceptedEmail: (profile.email as string) || decoded.email || null,
    })

    // Notify the new supplier (nudges them to complete their profile — the
    // notifications pages don't have a dedicated action button for this type
    // yet, but the message alone still confirms the connection was made) and
    // the inviting contractor.
    const acceptedSupplierName = (resolvedProfile.companyName as string) || (resolvedProfile.name as string) || decoded.email || ""
    await db
      .collection("users")
      .doc(decoded.uid)
      .collection("notifications")
      .add({
        title: "تم الربط بنجاح",
        message: `تم ربط حسابك بـ ${(inv.contractorName as string) || "المقاول"}. أكمل بيانات ملفك الشخصي لتبدأ باستقبال طلبات عروض الأسعار.`,
        type: "supplier_connected",
        createdAt: new Date().toISOString(),
        read: false,
      })
      .catch((err) => console.error("Failed to create supplier connection notification:", err))
    if (inv.invitedBy) {
      await db
        .collection("users")
        .doc(inv.invitedBy as string)
        .collection("notifications")
        .add({
          title: "تم قبول دعوة المورد",
          message: `${acceptedSupplierName} قبل دعوتك وانضم إلى دليل مورّديك.`,
          type: "supplier_invite_accepted",
          createdAt: new Date().toISOString(),
          read: false,
        })
        .catch((err) => console.error("Failed to notify inviter of supplier acceptance:", err))
    }

    return NextResponse.json({ success: true, data: { linked: true } })
  } catch (err) {
    console.error("Invitation accept error:", err)
    return errorResponse("Failed to accept invitation", "INTERNAL_ERROR", 500)
  }
}

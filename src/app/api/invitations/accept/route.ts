import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"

// Called right after a newly registered supplier signs up through an
// invitation link. Creates the contractor–supplier connection server-side so
// it works even when the supplier registered with a different email address
// than the one the invitation was sent to (the token is the capability).

const bodySchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
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
    const { token } = parsed.data

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

    // --- Load the accepting user ---
    const userSnap = await db.collection("users").doc(decoded.uid).get()
    const profile = userSnap.data()
    if (!profile) return errorResponse("User profile not found", "PROFILE_NOT_FOUND", 403)

    // ============================ TEAM INVITE ============================
    if (inv.type === "team_invite") {
      if (!inv.organizationId) {
        return errorResponse("Invitation is missing organization information", "INVALID_INVITATION", 422)
      }
      if (inv.organizationId === decoded.uid) {
        return errorResponse("You cannot accept an invitation to your own organization", "SELF_ACCEPT", 400)
      }
      // Guard: already a member of a different org (a solo org — own uid — is fine).
      if (
        profile.organizationId &&
        profile.organizationId !== decoded.uid &&
        profile.organizationId !== inv.organizationId
      ) {
        return errorResponse("You already belong to another organization", "IN_OTHER_ORG", 409)
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

      return NextResponse.json({ success: true, data: { joined: true, organizationId: inv.organizationId } })
    }

    // ========================== SUPPLIER INVITE ==========================
    if (!inv.contractorOrgId) {
      return errorResponse("Invitation is missing contractor information", "INVALID_INVITATION", 422)
    }
    if (profile.role !== "Supplier") {
      return errorResponse("Only supplier accounts can accept supplier invitations", "FORBIDDEN", 403)
    }

    const supplierOrgId = (profile.organizationId as string) || decoded.uid
    if (supplierOrgId === inv.contractorOrgId) {
      return errorResponse("You cannot accept an invitation from your own organization", "SELF_ACCEPT", 400)
    }

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
        supplierName: (profile.companyName as string) || (profile.name as string) || "",
        supplierCategories: (profile.specializations as string[]) || [],
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

    return NextResponse.json({ success: true, data: { linked: true } })
  } catch (err) {
    console.error("Invitation accept error:", err)
    return errorResponse("Failed to accept invitation", "INTERNAL_ERROR", 500)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendEmail, buildSupplierInviteEmail, buildTeamInviteEmail } from "@/lib/email"

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  type: z.enum(["supplier_invite", "team_invite"]).default("supplier_invite"),
  // supplier_invite: invitee company name; team_invite: invitee person name
  companyName: z.string().trim().max(200).optional(),
  name: z.string().trim().max(200).optional(),
  // team_invite only: default permission group for the new member
  groupId: z.string().trim().max(100).optional(),
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
    const { email, type, companyName, name, groupId } = parsed.data

    if (decoded.email && email === decoded.email.toLowerCase()) {
      return errorResponse("You cannot invite your own email address", "SELF_INVITE", 400)
    }

    // --- Load sender profile ---
    const db = getAdminFirestore()
    const senderSnap = await db.collection("users").doc(decoded.uid).get()
    const sender = senderSnap.data()
    if (!sender) return errorResponse("User profile not found", "PROFILE_NOT_FOUND", 403)

    const senderOrgId = (sender.organizationId as string) || decoded.uid
    const senderOrgName = (sender.companyName as string) || (sender.name as string) || ""
    const isAdmin = sender.role === "Admin"

    // --- Existing account? (also needed for team-invite validation below) ---
    let targetUid: string | null = null
    try {
      const targetUser = await getAdminAuth().getUserByEmail(email)
      targetUid = targetUser.uid
    } catch {
      targetUid = null
    }
    const isExistingUser = targetUid !== null

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://mdmaktech.sa").replace(/\/$/, "")

    // ============================ TEAM INVITE ============================
    if (type === "team_invite") {
      // Only the org owner (or platform admin) can invite team members.
      if (!isAdmin && sender.organizationRole !== "owner") {
        return errorResponse("Only the organization owner can invite team members", "FORBIDDEN", 403)
      }

      // An existing user must not already belong to another organization.
      if (targetUid) {
        const targetSnap = await db.collection("users").doc(targetUid).get()
        const target = targetSnap.data()
        if (target?.organizationId && target.organizationId === senderOrgId) {
          return errorResponse("This user is already a member of your team", "ALREADY_MEMBER", 409)
        }
        if (target?.organizationId && target.organizationId !== targetUid) {
          return errorResponse("This user already belongs to another organization", "TARGET_IN_OTHER_ORG", 409)
        }
      }

      // Validate the group belongs to the sender's org (ignore silently if not).
      let groupName: string | null = null
      let validGroupId: string | null = null
      if (groupId) {
        const groupSnap = await db.collection("teamGroups").doc(groupId).get()
        const group = groupSnap.data()
        if (group && group.organizationId === senderOrgId) {
          validGroupId = groupSnap.id
          groupName = (group.name as string) || null
        }
      }

      // Reuse an existing pending team invite to the same email (resend).
      const existing = await db
        .collection("invitations")
        .where("organizationId", "==", senderOrgId)
        .where("email", "==", email)
        .where("type", "==", "team_invite")
        .where("status", "==", "pending")
        .limit(1)
        .get()

      let invitationRef
      let inviteToken: string
      if (!existing.empty) {
        invitationRef = existing.docs[0].ref
        inviteToken = existing.docs[0].data().inviteToken
        const updates: Record<string, unknown> = {}
        if (!inviteToken) {
          inviteToken = randomBytes(32).toString("hex")
          updates.inviteToken = inviteToken
        }
        if (validGroupId && validGroupId !== existing.docs[0].data().groupId) {
          updates.groupId = validGroupId
        }
        if (Object.keys(updates).length > 0) await invitationRef.update(updates)
      } else {
        inviteToken = randomBytes(32).toString("hex")
        invitationRef = await db.collection("invitations").add({
          email,
          name: name || null,
          invitedBy: decoded.uid,
          invitedByName: (sender.name as string) || senderOrgName,
          organizationId: senderOrgId,
          organizationName: senderOrgName,
          organizationRole: "member",
          role: (sender.role as string) || "Contractor",
          groupId: validGroupId,
          status: "pending",
          type: "team_invite",
          inviteToken,
          createdAt: FieldValue.serverTimestamp(),
        })
        await db
          .collection("teamActivity")
          .add({
            organizationId: senderOrgId,
            type: "invite_sent",
            actorId: decoded.uid,
            actorName: (sender.name as string) || senderOrgName,
            targetName: name || email,
            createdAt: FieldValue.serverTimestamp(),
          })
          .catch((err) => console.error("Failed to log invite activity:", err))
      }

      // In-app notification for existing users (Arabic-first, default locale).
      if (targetUid) {
        await db
          .collection("users")
          .doc(targetUid)
          .collection("notifications")
          .add({
            title: "دعوة للانضمام إلى فريق",
            message: `${(sender.name as string) || senderOrgName} يدعوك للانضمام إلى فريق ${senderOrgName}`,
            type: "invitation",
            organizationId: senderOrgId,
            createdAt: new Date().toISOString(),
            read: false,
          })
          .catch((err) => console.error("Failed to create invite notification:", err))
      }

      const inviteUrl = isExistingUser ? `${baseUrl}/login` : `${baseUrl}/register?invite=${inviteToken}`
      const { subject, html } = buildTeamInviteEmail({
        inviterName: (sender.name as string) || "",
        orgName: senderOrgName,
        memberName: name,
        groupName,
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
        data: { invitationId: invitationRef.id, emailSent: result.sent, isExistingUser },
      })
    }

    // ========================== SUPPLIER INVITE ==========================
    if (sender.role !== "Contractor" && !isAdmin) {
      return errorResponse("Only contractors can invite suppliers", "FORBIDDEN", 403)
    }
    const contractorOrgId = senderOrgId
    const contractorName = senderOrgName

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

    const inviteUrl = isExistingUser ? `${baseUrl}/login` : `${baseUrl}/register?invite=${inviteToken}`

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

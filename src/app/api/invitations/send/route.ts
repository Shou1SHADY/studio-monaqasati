import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendEmail, buildTeamInviteEmail } from "@/lib/email"
import { resolveIdentityAdmin } from "@/lib/org-identity-admin"
import { can as resolveCan, type TeamGroup } from "@/lib/permissions"
import { mayInviteSuppliers } from "@/lib/procurement/team"

const bodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    type: z.enum(["supplier_invite", "team_invite"]).default("supplier_invite"),
    // supplier_invite: invitee company name; team_invite: invitee person name
    companyName: z.string().trim().max(200).optional(),
    name: z.string().trim().max(200).optional(),
    // team_invite only: default permission group for the new member
    groupId: z.string().trim().max(100).optional(),
    // supplier_invite only: the contact mobile, what he supplies, the sender's
    // note, and how the invitation leaves — WhatsApp opens the sender's own
    // chat (the platform sends nothing), e-mail is sent from here.
    phone: z.string().trim().max(30).optional(),
    category: z.string().trim().max(120).optional(),
    message: z.string().trim().max(1000).optional(),
    channel: z.enum(["wa", "email"]).default("email"),
    // supplier_invite from a guest's offer: what the buyer recorded of him, carried onto his record when he joins.
    guest: z
      .object({
        vatNumber: z.string().trim().max(20).optional(),
        crExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        paymentTermsDays: z.number().int().min(0).max(365).optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "team_invite") {
      if (!v.email) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "A valid email address is required" })
      return
    }
    if (!v.companyName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "The company name is required" })
    if (v.channel === "wa" && (v.phone || "").replace(/\D/g, "").length < 9) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "A mobile number is required for WhatsApp" })
    if (v.channel === "email" && !v.email) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "A valid email address is required" })
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
      return errorResponse(parsed.error.issues[0]?.message || "Invalid input", "INVALID_INPUT", 400)
    }
    const { type, companyName, name, groupId, phone, category, message, channel, guest } = parsed.data
    const email = parsed.data.email || ""

    if (email && decoded.email && email === decoded.email.toLowerCase()) {
      return errorResponse("You cannot invite your own email address", "SELF_INVITE", 400)
    }

    // --- Load sender profile ---
    const db = getAdminFirestore()
    const senderSnap = await db.collection("users").doc(decoded.uid).get()
    const senderBase = senderSnap.data()
    if (!senderBase) return errorResponse("User profile not found", "PROFILE_NOT_FOUND", 403)
    // The sender's ACTIVE company's identity — a secondary company (added via
    // the company-switcher) has its own name on organizations/{id}, not on
    // the sender's own users/{uid} doc — see org-identity-admin.ts.
    const sender = (await resolveIdentityAdmin(db, decoded.uid, senderBase)) as Record<string, unknown>

    const senderOrgId = (senderBase.organizationId as string) || decoded.uid
    const senderOrgName = (sender.companyName as string) || (sender.name as string) || ""
    const isAdmin = senderBase.role === "Admin"

    // --- Existing account? (also needed for team-invite validation below) ---
    let targetUid: string | null = null
    if (email) {
      try {
        const targetUser = await getAdminAuth().getUserByEmail(email)
        targetUid = targetUser.uid
      } catch {
        targetUid = null
      }
    }
    const isExistingUser = targetUid !== null

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://mdmaktech.sa").replace(/\/$/, "")

    // ============================ TEAM INVITE ============================
    if (type === "team_invite") {
      // Only the org owner (or platform admin) can invite team members.
      if (!isAdmin && senderBase.organizationRole !== "owner") {
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
          role: (senderBase.role as string) || "Contractor",
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
    if (senderBase.role !== "Contractor" && !isAdmin) {
      return errorResponse("Only contractors can invite suppliers", "FORBIDDEN", 403)
    }
    // The supplier file is the procurement manager's and the buyer's (the
    // prototype's `CAN('sup')`): an expediter or a member outside Procurement
    // does not put names on our list. A legacy account with no role is an owner.
    if (!isAdmin) {
      const role = !("organizationRole" in senderBase) ? "owner" : ((senderBase.organizationRole as string | null) || null)
      const groupsSnap = role === "owner" ? null : await db.collection("teamGroups").where("organizationId", "==", senderOrgId).get()
      const ctx = { organizationRole: role, defaultGroupId: (senderBase.defaultGroupId as string | null) || null, groups: (groupsSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }) as TeamGroup) }
      if (!mayInviteSuppliers((p) => resolveCan(p, ctx))) {
        return errorResponse("Only the procurement manager or a buyer can invite suppliers", "FORBIDDEN", 403)
      }
    }
    const contractorOrgId = senderOrgId
    const contractorName = senderOrgName

    // --- Reuse an existing pending invitation to the same contact ---
    const existing = await db
      .collection("invitations")
      .where("contractorOrgId", "==", contractorOrgId)
      .where(email ? "email" : "phone", "==", email || phone)
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
        email: email || null,
        phone: phone || null,
        companyName: companyName || null,
        category: category || null,
        message: message || null,
        channel,
        guest: guest ?? null,
        invitedBy: decoded.uid,
        invitedByName: (sender.name as string) || senderOrgName,
        contractorOrgId,
        contractorName,
        status: "pending",
        type: "supplier_invite",
        inviteToken,
        sentChannel: null,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    // In-app notification for existing users — mirrors the team_invite
    // notification above; without this, existing suppliers only get the
    // email and have no way to discover the invite inside the app.
    if (targetUid) {
      await db
        .collection("users")
        .doc(targetUid)
        .collection("notifications")
        .add({
          title: "دعوة للانضمام كمورّد",
          message: `${contractorName || "أحد المقاولين"} يدعوك للانضمام إلى دليل مورّديه`,
          type: "supplier_invite_received",
          createdAt: new Date().toISOString(),
          read: false,
        })
        .catch((err) => console.error("Failed to create supplier invite notification:", err))
    }

    const inviteUrl = isExistingUser ? `${baseUrl}/login` : `${baseUrl}/register?invite=${inviteToken}`

    // WhatsApp or e-mail, the sender's own chat or mail opens with the link: the
    // platform never sends a supplier invite in his name (supplier-file.ts).
    await invitationRef
      .update({ sentChannel: channel, sentAt: FieldValue.serverTimestamp() })
      .catch((err) => console.error("Failed to record sentChannel:", err))
    return NextResponse.json({
      success: true,
      data: { invitationId: invitationRef.id, emailSent: false, isExistingUser, joinUrl: inviteUrl },
    })
  } catch (err) {
    console.error("Invitation send error:", err)
    return errorResponse("Failed to send invitation", "INTERNAL_ERROR", 500)
  }
}

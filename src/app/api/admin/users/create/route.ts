import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { sendEmail, buildAccountCreatedEmail } from "@/lib/email"
import { COMPANY_MODULES, SALES_ONLY_OFF } from "@/lib/company-modules"
import { offFor } from "@/lib/procurement/package"
import { serverMaterialTree } from "@/lib/materials/tree-server"
import { TRIAL_MAX_DAYS, trialWindow } from "@/lib/subscription-status"
import { COMPANY_PLANS } from "@/lib/supplier-plan"

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
    /** A supplier's specialties: sub-categories of the material tree (PUR-04), by id. */
    specialtyIds: z.array(z.string().trim().min(1).max(64)).max(120).optional(),
    leadId: z.string().trim().min(1).optional(),
    leadCollection: z.enum(["demoRequests", "onboardingRequests"]).optional(),
    /** A supplier that only sells starts with CRM, Inventory, Finance, HR and Manufacturing switched off. */
    salesOnly: z.boolean().optional(),
    /** A contractor starts with the base package (Procurement + Inventory) and the connectors named here (PRD ADM). */
    connectors: z.object({ pm: z.boolean().optional(), fin: z.boolean().optional(), mfg: z.boolean().optional() }).optional(),
    /** A contractor opened as a trial: it runs this many days from the moment the account is created, then locks. */
    trialDays: z.number().int().min(1).max(TRIAL_MAX_DAYS).optional(),
    /** A supplier given the paid portal as a trial: this many days from now, then it is back on the free journey. */
    paidTrialDays: z.number().int().min(1).max(TRIAL_MAX_DAYS).optional(),
  })
  .refine((data) => data.trialDays === undefined || data.role === "Contractor", {
    message: "A trial is for contractor accounts",
    path: ["trialDays"],
  })
  .refine((data) => data.paidTrialDays === undefined || data.role === "Supplier", {
    message: "A paid trial is for supplier accounts",
    path: ["paidTrialDays"],
  })
  .refine((data) => data.role !== "Supplier" || (data.specialtyIds && data.specialtyIds.length > 0), {
    message: "At least one specialization is required for supplier accounts",
    path: ["specialtyIds"],
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
    const { name, email, phone, role, leadId, leadCollection } = parsed.data
    const specialtyIds = role === "Supplier" ? [...new Set(parsed.data.specialtyIds)] : []
    if (specialtyIds.length) {
      const known = new Set((await serverMaterialTree(db)).subs.map((x) => x.id))
      if (specialtyIds.some((id) => !known.has(id))) return errorResponse("Unknown specialization", "INVALID_INPUT", 400)
    }

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

    const rollback = async () => {
      await db.collection("users").doc(uid).delete().catch(() => {})
      await db.collection(COMPANY_MODULES).doc(uid).delete().catch(() => {})
      await db.collection(COMPANY_PLANS).doc(uid).delete().catch(() => {})
      await adminAuth.deleteUser(uid).catch(() => {})
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
        specializations: [],
        specialtyIds,
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

    // --- A sales-only supplier starts with its other components switched off (non-fatal: the admin can set them later) ---
    if (role === "Supplier" && parsed.data.salesOnly) {
      await db
        .collection(COMPANY_MODULES)
        .doc(uid)
        .set({ organizationId: uid, off: [...SALES_ONLY_OFF], updatedById: decoded.uid, updatedByName: sender.name || sender.email || "", updatedAt: FieldValue.serverTimestamp() })
        .catch((err) => console.error("Failed to switch the new supplier to sales-only:", err))
    }

    // --- A contractor starts on the base package; the connectors the admin opened stay on. Without a trial this is non-fatal
    //     (the admin can set the package later); WITH a trial the account is not left open-ended — it is undone and the admin asked to retry. ---
    if (role === "Contractor") {
      const c = parsed.data.connectors
      const off = offFor({ pm: Boolean(c?.pm), fin: Boolean(c?.fin), mfg: Boolean(c?.mfg) }, [])
      const written = await db
        .collection(COMPANY_MODULES)
        .doc(uid)
        .set({
          organizationId: uid,
          off,
          ...(parsed.data.trialDays !== undefined ? { subscription: "trial", ...trialWindow(parsed.data.trialDays, new Date()) } : {}),
          updatedById: decoded.uid,
          updatedByName: sender.name || sender.email || "",
          updatedAt: FieldValue.serverTimestamp(),
        })
        .then(() => true)
        .catch((err) => {
          console.error("Failed to set the new contractor's package:", err)
          return false
        })
      if (!written && parsed.data.trialDays !== undefined) {
        await rollback()
        return errorResponse("Failed to start the trial", "INTERNAL_ERROR", 500)
      }
    }

    // --- A supplier given the paid portal for a few days: the plan document carries the end date. Undone if it cannot be written. ---
    if (role === "Supplier" && parsed.data.paidTrialDays !== undefined) {
      const trial = trialWindow(parsed.data.paidTrialDays, new Date())
      const written = await db
        .collection(COMPANY_PLANS)
        .doc(uid)
        .set({
          organizationId: uid,
          supplierPlan: "full",
          planTrialDays: trial.trialDays,
          planTrialStartedAt: trial.trialStartedAt,
          planTrialEndsAt: trial.trialEndsAt,
          updatedById: decoded.uid,
          updatedByName: sender.name || sender.email || "",
          updatedAt: FieldValue.serverTimestamp(),
        })
        .then(() => true)
        .catch((err) => {
          console.error("Failed to start the supplier's paid trial:", err)
          return false
        })
      if (!written) {
        await rollback()
        return errorResponse("Failed to start the trial", "INTERNAL_ERROR", 500)
      }
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

      // The lead's file moves with it (ADM-10): the new client keeps the owner, plan and contacts,
      // and its history shows the conversion. The lead's activities and quotes stay under the
      // lead's id — the client file reads both. Non-fatal: the account already exists.
      try {
        const leadSnap = await db.collection(leadCollection).doc(leadId).get()
        const kind = leadCollection === "onboardingRequests" ? "onboarding" : leadSnap.data()?.origin === "manual" ? "manual" : "demo"
        const crmId = `lead_${kind}_${leadId}`
        const rec = (await db.collection("adminCrmClients").doc(crmId).get()).data() ?? {}
        await db
          .collection("adminCrmClients")
          .doc(uid)
          .set(
            {
              stage: "onboarding",
              ownerUid: rec.ownerUid ?? "",
              ownerName: rec.ownerName ?? "",
              plan: rec.plan ?? "",
              contacts: rec.contacts ?? [],
              convertedFromLead: crmId,
              convertedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        await db.collection("adminCrmActivities").add({
          clientId: uid,
          type: "note",
          system: "converted",
          status: "done",
          title: "",
          note: "",
          authorUid: decoded.uid,
          authorName: "",
          createdAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        console.error("Failed to carry the lead's file over to the client:", err)
      }
    }

    return NextResponse.json({ success: true, data: { uid, emailSent } })
  } catch (err) {
    console.error("Admin create-account error:", err)
    return errorResponse("Failed to create account", "INTERNAL_ERROR", 500)
  }
}

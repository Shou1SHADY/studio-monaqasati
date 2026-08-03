/**
 * Tests for admin-only account creation (public self-registration removed):
 *  1. Admin create-account request schema (src/app/api/admin/users/create/route.ts)
 *  2. Invite-accept "build profile from invitation" logic (src/app/api/invitations/accept/route.ts)
 */

import { z } from "zod"

// ─────────────────────────────────────────────────────────────────────────────
// 1. Admin create-account body schema
// Mirrors the zod schema in src/app/api/admin/users/create/route.ts
// ─────────────────────────────────────────────────────────────────────────────

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

describe("admin create-account schema", () => {
  it("accepts a valid contractor", () => {
    const result = bodySchema.safeParse({
      name: "شركة الاختبار",
      email: "contractor@example.com",
      phone: "0512345678",
      role: "Contractor",
    })
    expect(result.success).toBe(true)
  })

  it("accepts a valid supplier with specializations", () => {
    const result = bodySchema.safeParse({
      name: "مورد الاختبار",
      email: "supplier@example.com",
      role: "Supplier",
      specializations: ["حديد ومعادن"],
    })
    expect(result.success).toBe(true)
  })

  it("rejects a supplier with no specializations", () => {
    const result = bodySchema.safeParse({
      name: "مورد الاختبار",
      email: "supplier@example.com",
      role: "Supplier",
      specializations: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects a supplier missing the specializations field entirely", () => {
    const result = bodySchema.safeParse({
      name: "مورد الاختبار",
      email: "supplier@example.com",
      role: "Supplier",
    })
    expect(result.success).toBe(false)
  })

  it("rejects an invalid email", () => {
    const result = bodySchema.safeParse({
      name: "شركة الاختبار",
      email: "not-an-email",
      role: "Contractor",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a role outside the enum", () => {
    const result = bodySchema.safeParse({
      name: "شركة الاختبار",
      email: "contractor@example.com",
      role: "Admin",
    })
    expect(result.success).toBe(false)
  })

  it("rejects an empty name", () => {
    const result = bodySchema.safeParse({
      name: "",
      email: "contractor@example.com",
      role: "Contractor",
    })
    expect(result.success).toBe(false)
  })

  it("requires leadCollection when leadId is provided", () => {
    const result = bodySchema.safeParse({
      name: "شركة الاختبار",
      email: "contractor@example.com",
      role: "Contractor",
      leadId: "abc123",
    })
    expect(result.success).toBe(false)
  })

  it("accepts a leadId paired with a valid leadCollection", () => {
    const result = bodySchema.safeParse({
      name: "شركة الاختبار",
      email: "contractor@example.com",
      role: "Contractor",
      leadId: "abc123",
      leadCollection: "demoRequests",
    })
    expect(result.success).toBe(true)
  })

  it("lowercases the email", () => {
    const result = bodySchema.safeParse({
      name: "شركة الاختبار",
      email: "Contractor@Example.COM",
      role: "Contractor",
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe("contractor@example.com")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Invite-accept: build a Firestore profile from the invitation
// Mirrors the profile-construction logic in
// src/app/api/invitations/accept/route.ts (used when users/{uid} doesn't
// exist yet — public self-registration no longer creates it client-side).
// ─────────────────────────────────────────────────────────────────────────────

type Invitation = {
  type: "team_invite" | "supplier_invite"
  role?: string
}

function buildProfileFromInvitation(
  inv: Invitation,
  decodedUid: string,
  decodedEmail: string | undefined,
  body: { name?: string; phone?: string }
) {
  const email = (decodedEmail || "").toLowerCase()
  const role = inv.type === "supplier_invite" ? "Supplier" : inv.role || "Contractor"
  return {
    id: decodedUid,
    name: body.name || "",
    email,
    phone: body.phone || "",
    role,
    organizationId: decodedUid,
    organizationRole: "owner",
    specializations: [] as string[],
    isVerified: false,
    profileCompleted: false,
  }
}

describe("invite-accept profile construction", () => {
  it("uses the invitation's role for a team_invite", () => {
    const profile = buildProfileFromInvitation(
      { type: "team_invite", role: "Supplier" },
      "uid123",
      "member@example.com",
      { name: "عضو الفريق", phone: "0512345678" }
    )
    expect(profile.role).toBe("Supplier")
    expect(profile.name).toBe("عضو الفريق")
  })

  it("defaults to Contractor for a team_invite with no role on the invitation", () => {
    const profile = buildProfileFromInvitation(
      { type: "team_invite" },
      "uid123",
      "member@example.com",
      {}
    )
    expect(profile.role).toBe("Contractor")
  })

  it("always forces Supplier for a supplier_invite, ignoring any role on the invitation", () => {
    const profile = buildProfileFromInvitation(
      { type: "supplier_invite", role: "Contractor" },
      "uid456",
      "supplier@example.com",
      { name: "مورد جديد" }
    )
    expect(profile.role).toBe("Supplier")
  })

  it("always starts unverified, regardless of invite type", () => {
    const teamProfile = buildProfileFromInvitation({ type: "team_invite" }, "uid1", "a@example.com", {})
    const supplierProfile = buildProfileFromInvitation({ type: "supplier_invite" }, "uid2", "b@example.com", {})
    expect(teamProfile.isVerified).toBe(false)
    expect(supplierProfile.isVerified).toBe(false)
  })

  it("defaults to a solo organization (own uid, owner role) before any org-linking branch runs", () => {
    const profile = buildProfileFromInvitation({ type: "team_invite" }, "uid789", "a@example.com", {})
    expect(profile.organizationId).toBe("uid789")
    expect(profile.organizationRole).toBe("owner")
  })

  it("lowercases the email and falls back to empty string phone/name", () => {
    const profile = buildProfileFromInvitation(
      { type: "team_invite" },
      "uid1",
      "Member@Example.COM",
      {}
    )
    expect(profile.email).toBe("member@example.com")
    expect(profile.name).toBe("")
    expect(profile.phone).toBe("")
  })
})

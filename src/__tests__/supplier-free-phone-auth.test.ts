/**
 * Supplier 1.0 — the free account is made and entered with a mobile code (LNK-02, WF-18): what a code is bound to,
 * who the new account is, and which guest offers a verified mobile claims.
 */

import { claimedOfferPatch, claimedOrderPatch, isClaimableGuestOffer, newAccountSchema, newSupplierUser, phoneSubject } from "@/lib/supplier-free/phone-auth"
import { judge, type OtpChallenge } from "@/lib/otp"

describe("the code is bound to the number", () => {
  it("a code issued for one mobile never answers another, or another purpose", () => {
    const challenge: OtpChallenge = { purpose: "supplier_phone", subjectId: phoneSubject("+966512345678"), phone: "+966512345678", codeHash: "", createdAt: 1, expiresAt: 10_000, attempts: 0, consumedAt: null }
    expect(judge(challenge, { purpose: "supplier_phone", subjectId: phoneSubject("+966598765432") }, "c1", "123456", 2)).toBe("mismatch")
    expect(judge(challenge, { purpose: "guest_offer", subjectId: phoneSubject("+966512345678") }, "c1", "123456", 2)).toBe("mismatch")
    expect(judge(challenge, { purpose: "supplier_phone", subjectId: phoneSubject("+966512345678") }, "c1", "000000", 2)).toBe("wrong")
  })
})

describe("the new account", () => {
  it("needs a name and a company of at least two letters", () => {
    expect(newAccountSchema.safeParse({ name: "Ali", company: "Al Noor" }).success).toBe(true)
    expect(newAccountSchema.safeParse({ name: "A", company: "Al Noor" }).success).toBe(false)
    expect(newAccountSchema.safeParse({ name: "Ali", company: "" }).success).toBe(false)
    expect(newAccountSchema.safeParse({}).success).toBe(false)
  })

  it("is a Supplier who owns his own company, with no e-mail and no plan (free)", () => {
    const u = newSupplierUser("u1", "+966512345678", { name: " Ali ", company: " Al Noor " })
    expect(u).toMatchObject({ id: "u1", role: "Supplier", organizationId: "u1", organizationRole: "owner", companyName: "Al Noor", name: "Ali", phone: "+966512345678", email: "", providers: ["phone"] })
    expect(u).not.toHaveProperty("supplierPlan")
  })
})

describe("claiming earlier guest offers", () => {
  const offer = { isGuestOffer: true, supplierId: "guest", guestContact: { phone: "+966512345678", phoneVerified: true } }

  it("only an unclaimed guest offer whose mobile was verified, and is this mobile", () => {
    expect(isClaimableGuestOffer(offer, "+966512345678")).toBe(true)
    expect(isClaimableGuestOffer(offer, "+966599999999")).toBe(false)
    expect(isClaimableGuestOffer({ ...offer, guestContact: { phone: "+966512345678", phoneVerified: false } }, "+966512345678")).toBe(false)
    expect(isClaimableGuestOffer({ ...offer, supplierId: "u9" }, "+966512345678")).toBe(false)
    expect(isClaimableGuestOffer({ ...offer, isGuestOffer: false }, "+966512345678")).toBe(false)
  })

  it("the offer and its order stop being a guest's: they carry his account", () => {
    expect(claimedOfferPatch("u1", "Ali", "Al Noor", "2026-10-12T00:00:00Z")).toMatchObject({ supplierId: "u1", organizationId: "u1", isGuestOffer: false, wasGuestOffer: true })
    expect(claimedOrderPatch("u1", "Al Noor")).toEqual({ supplierOrgId: "u1", supplierUserId: "u1", supplierName: "Al Noor", isGuestSupplier: false })
  })
})

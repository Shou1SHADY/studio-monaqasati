/**
 * Supplier 1.0 — the visitor link (LNK-01, LNK-02, B-12): a visitor is asked for prices, a company name and a Saudi
 * mobile only, his validity starts at the deadline + 14 days, a resent form is found by its mobile, and the account a
 * verified mobile opens starts with the specialties and cities of the requests his quotes answered.
 */

import fs from "fs"
import path from "path"
import { fieldFromClaims, guestValidityDefault, saudiMobileE164 } from "@/lib/supplier-free/phone-auth"

describe("the visitor link (LNK-01, LNK-02)", () => {
  it("a Saudi mobile in either spelling is the one contact required; anything else is refused", () => {
    expect(saudiMobileE164("0551234567")).toBe("+966551234567")
    expect(saudiMobileE164("+966551234567")).toBe("+966551234567")
    expect(saudiMobileE164("٠٥٥١٢٣٤٥٦٧")).toBe("+966551234567")
    expect(saudiMobileE164("055 123 4567")).toBe("+966551234567")
    expect(saudiMobileE164("+971501234567")).toBeNull()
    expect(saudiMobileE164("0451234567")).toBeNull()
    expect(saudiMobileE164("")).toBeNull()
  })

  it("the validity starts at the deadline + 14 days", () => {
    expect(guestValidityDefault("2026-10-20")).toBe("2026-11-03")
    expect(guestValidityDefault(null)).toBe("")
  })

  it("a new phone account's specialties and cities come from the requests his quotes answered — never over his own", () => {
    const rfqs = [{ category: "طوب وبلوك", city: "الرياض" }, { category: "أسمنت", city: "الرياض" }, null]
    expect(fieldFromClaims(rfqs, {})).toEqual({ specializations: ["طوب وبلوك", "أسمنت"], coverageCities: ["الرياض"] })
    expect(fieldFromClaims(rfqs, { specializations: ["حديد"] })).toEqual({ coverageCities: ["الرياض"] })
    expect(fieldFromClaims(rfqs, { specializations: ["حديد"], coverageCities: ["جدة"] })).toBeNull()
  })

  it("the guest offer route asks only the four fields, a price and a Saudi mobile, and finds his quote by mobile — never by e-mail", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/rfq-share/[token]/offer/route.ts"), "utf8")
    const server = fs.readFileSync(path.join(process.cwd(), "src/lib/procurement/visitor-offer-server.ts"), "utf8")
    expect(route).toMatch(/contactName: z\.string\(\)\.trim\(\)\.max\(200\)\.optional\(\)/)
    expect(route).toMatch(/email: z\.string\(\)\.trim\(\)\.toLowerCase\(\)\.email\(\)\.max\(254\)\.optional\(\)/)
    expect(route).toContain("phoneOf(v) != null")
    expect(server).toContain('.where("guestContact.phone", "==", ')
    expect(server).not.toContain('.where("guestContact.email"')
  })
})

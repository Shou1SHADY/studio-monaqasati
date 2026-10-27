// A free supplier account is made and entered with a mobile and a one-time code (PRD LNK-02, WF-18); there is no
// password. These are the pure parts the two routes share and the tests pin: what a code is bound to, how many a
// number may ask for, who the new account is, and what a verified mobile claims of the guest offers made before it.

import { z } from "zod"

export const PHONE_CODES_PER_HOUR = 5

export const phoneSubject = (phoneE164: string): string => `supplier_phone:${phoneE164}`

/** A Saudi mobile as the visitor types it — 05XXXXXXXX or +9665XXXXXXXX, in either numeral set — as E.164; anything
 * else is null (LNK-01, B-12: the visitor is asked for prices, a company name and a Saudi mobile, nothing more). */
export function saudiMobileE164(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\s\-()]/g, "")
  if (/^05\d{8}$/.test(s)) return `+966${s.slice(1)}`
  if (/^\+9665\d{8}$/.test(s)) return s
  if (/^009665\d{8}$/.test(s)) return `+${s.slice(2)}`
  return null
}

/** The visitor's validity, pre-filled: the submission deadline + 14 days (LNK-01). */
export function guestValidityDefault(deadline: string | null | undefined): string {
  const d = String(deadline || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ""
  return new Date(Date.parse(`${d}T00:00:00Z`) + 14 * 864e5).toISOString().slice(0, 10)
}

export const newAccountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  company: z.string().trim().min(2).max(120),
})

/** How a supplier account came to be, as the admin's free-suppliers page reads it. Accounts made through invitations
 * or by a contractor carry "invited", written by that code. */
export type SignupSource = "self" | "guest_claim"

/** Made from the public sign-up page or the login page: "self". Made when his earlier guest offers were claimed in the
 * same step: "guest_claim". */
export const signupSourceOf = (claimed: number): SignupSource => (claimed > 0 ? "guest_claim" : "self")

export interface NewSupplierUser {
  id: string
  name: string
  email: string
  phone: string
  role: "Supplier"
  organizationId: string
  organizationRole: "owner"
  companyName: string
  specializations: string[]
  providers: string[]
  isVerified: boolean
  profileCompleted: boolean
}

export function newSupplierUser(uid: string, phoneE164: string, input: { name: string; company: string }): NewSupplierUser {
  return {
    id: uid,
    name: input.name.trim(),
    email: "",
    phone: phoneE164,
    role: "Supplier",
    organizationId: uid,
    organizationRole: "owner",
    companyName: input.company.trim(),
    specializations: [],
    providers: ["phone"],
    isVerified: false,
    profileCompleted: false,
  }
}

/** A guest offer is his only when its mobile was verified by a code and it still belongs to nobody. */
export function isClaimableGuestOffer(offer: { isGuestOffer?: unknown; supplierId?: unknown; guestContact?: { phone?: unknown; phoneVerified?: unknown } | null }, phoneE164: string): boolean {
  return offer.isGuestOffer === true && offer.supplierId === "guest" && offer.guestContact?.phoneVerified === true && offer.guestContact.phone === phoneE164
}

export function claimedOfferPatch(uid: string, name: string, company: string, at: string): Record<string, string | boolean> {
  return { supplierId: uid, organizationId: uid, submittedByUserId: uid, submittedByUserName: name, supplierName: company, companyName: company, isGuestOffer: false, wasGuestOffer: true, claimedAt: at }
}

/** What the requests his claimed quotes answered tell about his field: their categories and cities, written only
 * where his own list is still empty (LNK-02 — an account with no specialty or city sees no request). Null = nothing to add. */
export function fieldFromClaims(rfqs: Array<Record<string, unknown> | null>, current?: { specializations?: unknown; coverageCities?: unknown } | null): { specializations?: string[]; coverageCities?: string[] } | null {
  const list = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === "string" && x) as string[]) : [])
  const pick = (k: "category" | "city") => [...new Set(rfqs.map((r) => (typeof r?.[k] === "string" ? (r[k] as string).trim() : "")).filter(Boolean))]
  const out: { specializations?: string[]; coverageCities?: string[] } = {}
  const cats = pick("category")
  const cities = pick("city")
  if (!list(current?.specializations).length && cats.length) out.specializations = cats
  if (!list(current?.coverageCities).length && cities.length) out.coverageCities = cities
  return out.specializations || out.coverageCities ? out : null
}

export function claimedOrderPatch(uid: string, company: string): Record<string, string | boolean> {
  return { supplierOrgId: uid, supplierUserId: uid, supplierName: company, isGuestSupplier: false }
}

// ---- Changing the locked fields (ACC-05) ----------------------------------------------------------------------
// The sign-in mobile and the commercial register are never edited inline; each changes under Security with a code.
// A new mobile is proved by a code sent TO it; a new register by a code sent to the sign-in mobile. Both are applied
// at once — the register's old certificate is taken off, so "Verified" waits for the new one (ACC-04).

export const accountChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("phone"), challengeId: z.string().trim().min(8).max(64), code: z.string().trim().min(4).max(8), phone: z.string().trim().min(7).max(20) }),
  z.object({ kind: z.literal("cr"), challengeId: z.string().trim().min(8).max(64), code: z.string().trim().min(4).max(8), crNumber: z.string().trim().min(5).max(20) }),
])
export type AccountChange = z.infer<typeof accountChangeSchema>

/** A Saudi commercial register (or unified) number: ten digits, typed in either numeral set. */
export function normalizeCr(value: string): string | null {
  const digits = value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, "")
  return /^\d{10}$/.test(digits) ? digits : null
}

/** Why a new sign-in mobile is refused before its code is spent: the same number, or a number another account holds. */
export function phoneChangeRefusal(uid: string, current: string, next: string, holders: readonly string[]): "SAME_PHONE" | "PHONE_TAKEN" | null {
  if (next === current) return "SAME_PHONE"
  if (holders.some((h) => h && h !== uid)) return "PHONE_TAKEN"
  return null
}

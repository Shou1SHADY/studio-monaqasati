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

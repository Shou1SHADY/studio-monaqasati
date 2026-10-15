// A free supplier account is made and entered with a mobile and a one-time code (PRD LNK-02, WF-18); there is no
// password. These are the pure parts the two routes share and the tests pin: what a code is bound to, how many a
// number may ask for, who the new account is, and what a verified mobile claims of the guest offers made before it.

import { z } from "zod"

export const PHONE_CODES_PER_HOUR = 5

export const phoneSubject = (phoneE164: string): string => `supplier_phone:${phoneE164}`

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

export function claimedOrderPatch(uid: string, company: string): Record<string, string | boolean> {
  return { supplierOrgId: uid, supplierUserId: uid, supplierName: company, isGuestSupplier: false }
}

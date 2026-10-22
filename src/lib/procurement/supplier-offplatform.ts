// The supplier who is NOT on the platform (SUP-03): no Mdmak profile, so no file of his own — what we know (the name and the
// mobile he gave on the visitor link, which a code proved), our orders with him, «ادعُه إلى المنصة» and «أضِفه إلى موردينا».
// He has no organisation id, so the record we keep of him is keyed by his VERIFIED mobile: the same man quoting us twice
// from the same number is one supplier, and a number nobody proved is never a key. He never appears in the platform
// directory — that list is built from platform accounts only. Pure.

import { foldSearchText } from "../search-text"
import { normalizeGuestMobile } from "./guest-supplier"
import type { SupplierLogEntry, SupplierRecord } from "./supplier-file"
import type { PurchaseOrder } from "./types"

/** The `supplierOrgId` of a record kept for an off-platform supplier: `guest_` + the digits of his E.164 mobile. */
export const GUEST_SUPPLIER_PREFIX = "guest_"

export const guestSupplierKey = (phone: string | null | undefined): string | null => {
  const e164 = normalizeGuestMobile(phone)
  return e164 ? `${GUEST_SUPPLIER_PREFIX}${e164.replace(/\D/g, "")}` : null
}

export const isGuestSupplierKey = (id: string | null | undefined): boolean => Boolean(id && id.startsWith(GUEST_SUPPLIER_PREFIX))

export type AddGuestRefusal = "no_permission" | "not_found" | "not_a_guest" | "phone_not_verified" | "already_ours"

export interface GuestFacts {
  name: string
  phone: string | null
  phoneVerified: boolean
  vatNumber?: string | null
}

/** Why this guest cannot be added, or null. A mobile nobody proved is no key; an offer from a registered supplier is added from the directory. */
export function addGuestRefusal(facts: GuestFacts | null, registeredSupplier: boolean): AddGuestRefusal | null {
  if (!facts) return "not_found"
  if (registeredSupplier) return "not_a_guest"
  if (!facts.phoneVerified || !guestSupplierKey(facts.phone)) return "phone_not_verified"
  return null
}

/** The record the add writes: unverified (our manager vouches for him before an order), tagged as coming from a visitor link. */
export function guestSupplierRecord(input: { organizationId: string; facts: GuestFacts; byId: string; byName: string; at: string }): Omit<SupplierRecord, "id"> & { guestPhone: string } {
  const key = guestSupplierKey(input.facts.phone) as string
  const log: SupplierLogEntry = { action: "added", at: input.at, byId: input.byId, byName: input.byName, params: { source: "guest_link" } }
  return {
    organizationId: input.organizationId,
    supplierOrgId: key,
    supplierName: input.facts.name,
    kind: "mat",
    source: "guest_link",
    vatNumber: input.facts.vatNumber?.trim() || null,
    crExpiry: null,
    paymentTermsDays: 30,
    leadTimeDays: null,
    verified: false,
    addedById: input.byId,
    addedByName: input.byName,
    addedAt: input.at,
    log: [log],
    guestPhone: normalizeGuestMobile(input.facts.phone) as string,
  }
}

export interface GuestOfferFact {
  id: string
  guestContact?: { phone?: string | null } | null
}

/**
 * Our orders with an off-platform supplier. His orders carry `supplierOrgId: "guest"` and his name, so the offer behind each
 * order says whose mobile it was: the same verified number is the same man, and the name is the fallback for an order whose
 * offer is gone.
 */
export function ordersOfGuest(orders: readonly PurchaseOrder[], offers: readonly GuestOfferFact[], key: string, name: string): PurchaseOrder[] {
  const phoneKeyOf = new Map(offers.map((o) => [o.id, guestSupplierKey(o.guestContact?.phone)]))
  const folded = foldSearchText(name)
  return orders
    .filter((po) => {
      if (po.supplierOrgId === key) return true
      const guest = po.isGuestSupplier || !po.supplierOrgId || po.supplierOrgId === "guest"
      if (!guest) return false
      const byPhone = po.offerId ? phoneKeyOf.get(po.offerId) : null
      return byPhone ? byPhone === key : foldSearchText(po.supplierName) === folded
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
}

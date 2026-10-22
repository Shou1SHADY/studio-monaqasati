// «أضِفه إلى موردينا» for a supplier who has no account (SUP-03): the Admin write that keeps a record of a guest, keyed by the
// mobile a one-time code proved on his visitor link. The act is named by the offer (or the order laid over it) — never by a
// typed name and number, so the browser cannot make a supplier up. Idempotent: the record id is `{org}__{guest_<mobile>}`.

import type { Firestore } from "firebase-admin/firestore"
import { SUPPLIER_RECORDS, supplierRecordId } from "./supplier-file"
import { addGuestRefusal, guestSupplierKey, guestSupplierRecord, type AddGuestRefusal, type GuestFacts } from "./supplier-offplatform"
import { PURCHASE_ORDERS } from "./types"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

export class AddGuestError extends Error {
  readonly status: number
  constructor(readonly code: AddGuestRefusal) {
    super(code)
    this.name = "AddGuestError"
    this.status = code === "no_permission" ? 403 : code === "not_found" ? 404 : 409
  }
}

export interface AddGuestResult {
  supplierOrgId: string
  created: boolean
}

export async function addGuestSupplier(db: Firestore, caller: { uid: string; name: string; orgId: string }, input: { offerId?: string; poId?: string }, now: Date = new Date()): Promise<AddGuestResult> {
  let offerId = input.offerId || ""
  if (input.poId) {
    const po = (await db.collection(PURCHASE_ORDERS).doc(input.poId).get()).data() as Rec | undefined
    if (!po || po.organizationId !== caller.orgId) throw new AddGuestError("not_found")
    offerId = str(po.offerId)
  }
  const offer = offerId ? ((await db.collection("offers").doc(offerId).get()).data() as Rec | undefined) : undefined
  const rfq = offer ? ((await db.collection("rfqs").doc(str(offer.rfqId) || "_").get()).data() as Rec | undefined) : undefined
  const buyerOrg = rfq ? str(rfq.organizationId) || str(rfq.contractorId) : ""
  if (!offer || !rfq || buyerOrg !== caller.orgId) throw new AddGuestError("not_found")

  const contact = (offer.guestContact || null) as Rec | null
  const registered = !contact || offer.isGuestOffer === false
  const facts: GuestFacts | null = contact
    ? { name: str(contact.name) || str(offer.companyName) || str(offer.supplierName), phone: str(contact.phone) || null, phoneVerified: contact.phoneVerified === true, vatNumber: str(contact.vatNumber) || null }
    : null
  const refusal = addGuestRefusal(facts, registered)
  if (refusal || !facts) throw new AddGuestError(refusal || "not_found")

  const key = guestSupplierKey(facts.phone) as string
  const ref = db.collection(SUPPLIER_RECORDS).doc(supplierRecordId(caller.orgId, key))
  const created = await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false
    tx.set(ref, guestSupplierRecord({ organizationId: caller.orgId, facts, byId: caller.uid, byName: caller.name, at: now.toISOString() }) as unknown as Rec)
    return true
  })
  return { supplierOrgId: key, created }
}

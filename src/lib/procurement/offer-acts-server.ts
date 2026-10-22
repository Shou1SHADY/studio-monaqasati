// The buying side's three small writes on an OFFER, on the server (Procurement 2.0, WP-S1-11): asking for a sample, recording that a guest
// was invited to join, and marking an offer rated. They were the last users of the `offers` contractor-update branch of the ruleset; with
// them on a route that branch is deleted and no browser of the buying company writes an offer's decision keys any more. Each act re-reads
// the offer and its RFQ in ONE transaction, checks the caller runs that RFQ (a buyer runs only the ones he raised) and appends to the
// RFQ's log. The supplier's notice rides after the commit, best-effort.

import type { Firestore } from "firebase-admin/firestore"
import { FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import type { PermissionId } from "@/lib/permissions"
import { rfqLogEntry, type RfqLogEntry } from "./rfq-detail"
import { rfqMine, runsRfqs, type RfqRunner } from "./rfq-access"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

export interface OfferActCaller {
  uid: string
  name: string
  orgId: string
  can: (permission: PermissionId) => boolean
}

export type OfferActReason = "no_permission" | "offer_missing" | "rfq_missing" | "date_invalid" | "reason_required"

const STATUS: Record<OfferActReason, number> = { no_permission: 403, offer_missing: 404, rfq_missing: 404, date_invalid: 400, reason_required: 400 }

export class OfferActError extends Error {
  readonly status: number
  constructor(readonly reason: OfferActReason) {
    super(reason)
    this.name = "OfferActError"
    this.status = STATUS[reason]
  }
}

const id = z.string().trim().min(1).max(128)

export const offerActBody = z.discriminatedUnion("act", [
  z.object({
    act: z.literal("sample"),
    offerId: id,
    what: z.string().trim().min(1).max(300),
    place: z.string().trim().min(1).max(300),
    by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ act: z.literal("guest_invited"), offerId: id, supplierName: z.string().trim().min(1).max(200), channel: z.enum(["wa", "email"]), invitationId: id.nullish() }),
  z.object({ act: z.literal("rated"), offerId: id }),
])
export type OfferActInput = z.infer<typeof offerActBody>

const runnerOf = (c: OfferActCaller): RfqRunner => ({
  uid: c.uid,
  isOwner: c.uid === c.orgId,
  canPrepare: c.can("offers.accept"),
  canApprove: c.can("po.approve"),
  managesRfqs: c.can("rfq.manage") || c.can("rfq.create"),
})

export interface OfferActResult {
  act: OfferActInput["act"]
  offerId: string
}

export async function runOfferAct(db: Firestore, caller: OfferActCaller, input: OfferActInput, now: Date = new Date()): Promise<OfferActResult> {
  const runner = runnerOf(caller)
  const at = now.toISOString()
  const offerRef = db.collection("offers").doc(input.offerId)
  let notice: { to: string; org: string; rfqTitle: string; rfqId: string } | null = null

  await db.runTransaction(async (tx) => {
    const oSnap = await tx.get(offerRef)
    if (!oSnap.exists) throw new OfferActError("offer_missing")
    const offer = oSnap.data() as Rec
    const rfqRef = db.collection("rfqs").doc(str(offer.rfqId) || "_")
    const rSnap = await tx.get(rfqRef)
    if (!rSnap.exists) throw new OfferActError("rfq_missing")
    const rfq = rSnap.data() as Rec
    const buyer = str(rfq.organizationId) || str(rfq.contractorId)
    if (buyer !== caller.orgId) throw new OfferActError("offer_missing")
    const log: RfqLogEntry[] = Array.isArray(rfq.log) ? (rfq.log as RfqLogEntry[]) : []

    if (input.act === "rated") {
      if (!runner.isOwner && !runner.canPrepare && !runner.canApprove) throw new OfferActError("no_permission")
      tx.update(offerRef, { contractorRated: true })
      return
    }
    if (!runsRfqs(runner) || !rfqMine({ createdByUserId: str(rfq.createdByUserId), contractorId: str(rfq.contractorId) }, runner)) throw new OfferActError("no_permission")

    if (input.act === "sample") {
      if (input.by < riyadhDay(now)) throw new OfferActError("date_invalid")
      tx.update(offerRef, {
        sampleStatus: "مطلوبة",
        sampleUpdatedAt: at,
        sampleWhat: input.what.slice(0, 300),
        samplePlace: input.place.slice(0, 300),
        sampleBy: input.by,
        sampleRequestedAt: at,
        sampleSentAt: null,
        sampleReceivedBy: null,
        sampleNote: null,
      })
      const supplierId = str(offer.supplierId)
      if (supplierId && supplierId !== "guest" && !offer.isGuestOffer) notice = { to: supplierId, org: str(offer.organizationId) || supplierId, rfqTitle: str(offer.rfqTitle) || str(rfq.title), rfqId: rfqRef.id }
      return
    }

    tx.update(offerRef, { guestInvite: { at, byId: caller.uid, byName: caller.name, channel: input.channel, invitationId: input.invitationId ?? null } })
    tx.update(rfqRef, { log: [...log, rfqLogEntry({ uid: caller.uid, name: caller.name }, "guest_invited", at, { params: { supplier: input.supplierName } })], updatedAt: FieldValue.serverTimestamp() })
  })

  const told = notice as { to: string; org: string; rfqTitle: string; rfqId: string } | null
  if (told) {
    try {
      await db
        .collection("users")
        .doc(told.to)
        .collection("notifications")
        .add({
          userId: told.to,
          organizationId: told.org,
          type: "sample_requested",
          i18n: { title: "pn_sample_requested_title", message: "pn_sample_requested", params: { rfq: told.rfqTitle } },
          title: "طلب عينة جديد",
          message: `قام المقاول بطلب عينة لطلب عروض الأسعار: ${told.rfqTitle}`,
          offerId: input.offerId,
          rfqId: told.rfqId,
          createdAt: at,
          read: false,
        })
    } catch (err) {
      console.warn("sample notice not sent:", (err as { code?: string })?.code || err)
    }
  }
  return { act: input.act, offerId: input.offerId }
}

// Server-only helpers for the guest offer follow-up flow — the private
// per-offer link a share-link supplier uses to keep negotiating (revise price,
// confirm a sample, send a delivery notice) without ever creating an account.
// Never import this file in client components.

import { randomBytes } from "crypto"
import { FieldValue } from "firebase-admin/firestore"
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin"
import { PUBLIC_BASE_URL } from "@/lib/rfq-share"
import { normalizeGuestChannel, type GuestOfferChannel } from "@/utils/guest-offer-workflow"

// Guest links outlive the 3-day RFQ share link: the negotiation (reduction →
// sample → award → delivery) routinely runs for weeks after the offer lands.
export const GUEST_OFFER_LINK_TTL_DAYS = 60

const COLLECTION = "guestOfferLinks"

export function guestOfferUrl(token: string): string {
  return `${PUBLIC_BASE_URL}/offer/${token}`
}

function ttlFromNow(): string {
  return new Date(Date.now() + GUEST_OFFER_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export interface GuestOfferLinkInfo {
  token: string
  linkId: string
  url: string
  channel: GuestOfferChannel
  email: string | null
  phone: string | null
}

type CreateGuestOfferLinkInput = {
  offerId: string
  rfqId: string
  rfqTitle?: string | null
  contractorId?: string | null
  organizationId?: string | null
  channel?: unknown
  email?: string | null
  phone?: string | null
  shareLinkId?: string | null
}

/** Mints a private link for a freshly submitted guest offer. */
export async function createGuestOfferLink(
  input: CreateGuestOfferLinkInput
): Promise<GuestOfferLinkInfo> {
  const db = getAdminFirestore()
  const token = randomBytes(32).toString("hex")
  const channel = normalizeGuestChannel(input.channel)
  const email = input.email || null
  const phone = input.phone || null

  const ref = await db.collection(COLLECTION).add({
    token,
    offerId: input.offerId,
    rfqId: input.rfqId,
    rfqTitle: input.rfqTitle || "",
    contractorId: input.contractorId || null,
    organizationId: input.organizationId || null,
    shareLinkId: input.shareLinkId || null,
    channel,
    email,
    phone,
    revoked: false,
    expiresAt: ttlFromNow(),
    createdAt: FieldValue.serverTimestamp(),
  })

  return { token, linkId: ref.id, url: guestOfferUrl(token), channel, email, phone }
}

/**
 * Returns the live link for a guest offer, minting one for offers submitted
 * before this flow existed. Also refreshes the expiry, so an offer that is
 * still moving never loses its link mid-negotiation.
 */
export async function ensureGuestOfferLink(
  offerId: string,
  offer: FirebaseFirestore.DocumentData
): Promise<GuestOfferLinkInfo> {
  const db = getAdminFirestore()
  const snap = await db
    .collection(COLLECTION)
    .where("offerId", "==", offerId)
    .where("revoked", "==", false)
    .limit(5)
    .get()

  const guestContact = (offer.guestContact || {}) as { email?: string; phone?: string }

  if (!snap.empty) {
    const linkDoc = snap.docs[0]
    const link = linkDoc.data()
    await linkDoc.ref.update({ expiresAt: ttlFromNow() }).catch(() => {})
    return {
      token: link.token as string,
      linkId: linkDoc.id,
      url: guestOfferUrl(link.token as string),
      channel: normalizeGuestChannel(link.channel),
      email: (link.email as string) || guestContact.email || null,
      phone: (link.phone as string) || guestContact.phone || null,
    }
  }

  // Backfill: the offer predates guest links (or its link was revoked). Reuse
  // the RFQ share link's channel when it is still around.
  let channel: GuestOfferChannel = "link"
  if (offer.guestChannel) {
    channel = normalizeGuestChannel(offer.guestChannel)
  } else if (offer.shareLinkId) {
    const shareSnap = await db.collection("rfqShareLinks").doc(offer.shareLinkId as string).get()
    if (shareSnap.exists) channel = normalizeGuestChannel(shareSnap.data()?.channel)
  }

  return createGuestOfferLink({
    offerId,
    rfqId: (offer.rfqId as string) || "",
    rfqTitle: (offer.rfqTitle as string) || "",
    contractorId: (offer.contractorId as string) || null,
    organizationId: (offer.contractorOrgId as string) || null,
    shareLinkId: (offer.shareLinkId as string) || null,
    channel,
    email: guestContact.email || null,
    phone: guestContact.phone || null,
  })
}

export type GuestOfferResolution =
  | {
      ok: true
      linkId: string
      link: FirebaseFirestore.DocumentData
      offerId: string
      offer: FirebaseFirestore.DocumentData
      rfq: FirebaseFirestore.DocumentData | null
    }
  | {
      ok: false
      code: "INVALID_TOKEN" | "NOT_FOUND" | "LINK_EXPIRED" | "LINK_REVOKED" | "OFFER_NOT_FOUND"
      status: number
    }

/** Resolves a guest offer token to its link + offer + RFQ documents. */
export async function resolveGuestOfferToken(token: string): Promise<GuestOfferResolution> {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { ok: false, code: "INVALID_TOKEN", status: 400 }
  }

  const db = getAdminFirestore()
  const snap = await db.collection(COLLECTION).where("token", "==", token).limit(1).get()
  if (snap.empty) return { ok: false, code: "NOT_FOUND", status: 404 }

  const linkDoc = snap.docs[0]
  const link = linkDoc.data()
  if (link.revoked) return { ok: false, code: "LINK_REVOKED", status: 410 }
  if (new Date(link.expiresAt as string).getTime() <= Date.now()) {
    return { ok: false, code: "LINK_EXPIRED", status: 410 }
  }

  const offerSnap = await db.collection("offers").doc(link.offerId as string).get()
  if (!offerSnap.exists) return { ok: false, code: "OFFER_NOT_FOUND", status: 404 }
  const offer = offerSnap.data()!

  let rfq: FirebaseFirestore.DocumentData | null = null
  if (offer.rfqId) {
    const rfqSnap = await db.collection("rfqs").doc(offer.rfqId as string).get()
    rfq = rfqSnap.exists ? rfqSnap.data()! : null
  }

  return { ok: true, linkId: linkDoc.id, link, offerId: offerSnap.id, offer, rfq }
}

/** Records that the contractor pushed an event out on a given channel. */
export async function recordGuestNotification(
  linkId: string,
  event: string,
  channel: GuestOfferChannel
): Promise<void> {
  const db = getAdminFirestore()
  await db
    .collection(COLLECTION)
    .doc(linkId)
    .update({
      lastEvent: event,
      lastEventChannel: channel,
      lastNotifiedAt: new Date().toISOString(),
      expiresAt: ttlFromNow(),
    })
    .catch((err) => console.error("Failed to record guest notification:", err))
}

export type ContractorOfferAuth =
  | {
      ok: true
      uid: string
      offerId: string
      offer: FirebaseFirestore.DocumentData
      contractorName: string
    }
  | { ok: false; code: string; message: string; status: number }

/**
 * Verifies the caller is signed in and owns (or administers) the guest offer
 * they're acting on, before anything is sent outside the platform.
 */
export async function authorizeContractorForOffer(
  authHeader: string | null,
  offerId: string
): Promise<ContractorOfferAuth> {
  const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!idToken) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Authentication required", status: 401 }
  }

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken)
  } catch {
    return { ok: false, code: "UNAUTHENTICATED", message: "Invalid or expired session", status: 401 }
  }

  const db = getAdminFirestore()
  const [userSnap, offerSnap] = await Promise.all([
    db.collection("users").doc(decoded.uid).get(),
    db.collection("offers").doc(offerId).get(),
  ])

  const user = userSnap.data()
  if (!user) {
    return { ok: false, code: "PROFILE_NOT_FOUND", message: "User profile not found", status: 403 }
  }
  if (!offerSnap.exists) {
    return { ok: false, code: "OFFER_NOT_FOUND", message: "Offer not found", status: 404 }
  }

  const offer = offerSnap.data()!
  if (!offer.isGuestOffer) {
    return {
      ok: false,
      code: "NOT_GUEST_OFFER",
      message: "This offer belongs to a registered supplier",
      status: 400,
    }
  }

  const orgId = (user.organizationId as string) || decoded.uid
  const isAdmin = user.role === "Admin"
  const offerOrgId = (offer.contractorOrgId as string) || (offer.contractorId as string)
  if (!isAdmin && offerOrgId !== orgId && offer.contractorId !== decoded.uid) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "You can only act on offers made to your own RFQs",
      status: 403,
    }
  }

  return {
    ok: true,
    uid: decoded.uid,
    offerId: offerSnap.id,
    offer,
    contractorName: (user.companyName as string) || (user.name as string) || "",
  }
}

/** Contractor-side in-app notification for a guest supplier's reply. */
export async function notifyContractor(params: {
  contractorId: string | null | undefined
  organizationId: string | null | undefined
  type: string
  title: string
  message: string
  offerId: string
  rfqId: string | null
  rfqTitle?: string | null
}): Promise<void> {
  if (!params.contractorId) return
  const db = getAdminFirestore()
  await db
    .collection("users")
    .doc(params.contractorId)
    .collection("notifications")
    .add({
      userId: params.contractorId,
      organizationId: params.organizationId || params.contractorId,
      type: params.type,
      title: params.title,
      message: params.message,
      offerId: params.offerId,
      rfqId: params.rfqId,
      rfqTitle: params.rfqTitle || "",
      createdAt: new Date().toISOString(),
      read: false,
    })
    .catch((err) => console.error("Failed to write contractor notification:", err))
}

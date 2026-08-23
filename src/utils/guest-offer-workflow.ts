/**
 * Pure helpers for the guest (share-link) offer workflow.
 *
 * A guest supplier has no platform account: they reach the RFQ through a share
 * link, submit an offer, and then keep the negotiation going through a private
 * per-offer link. Everything the contractor does to that offer (price
 * reduction, sample request, accept/reject, ...) is pushed back out on the
 * channel the contractor originally shared on — WhatsApp or email.
 *
 * Framework-agnostic and fully testable: no Firebase, no next-intl.
 */

export const OFFER_STATUS = {
  pending: 'قيد المراجعة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  reductionRequested: 'مطلوب تخفيض',
  delivered: 'تم التسليم',
} as const

export const SAMPLE_STATUS = {
  requested: 'مطلوبة',
  sent: 'تم الإرسال',
  received: 'تم الاستلام',
} as const

/** How the contractor reaches a guest supplier. `link` = copied by hand. */
export type GuestOfferChannel = 'whatsapp' | 'email' | 'link'

/** Contractor-side events that must be pushed out to a guest supplier. */
export type GuestOfferEvent =
  | 'reduction_requested'
  | 'sample_requested'
  | 'sample_received'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'supply_completed'

/** Guest-side actions available from the private offer link. */
export type GuestOfferAction = 'revise_price' | 'sample_sent' | 'delivery_notice'

export const GUEST_OFFER_EVENTS: readonly GuestOfferEvent[] = [
  'reduction_requested',
  'sample_requested',
  'sample_received',
  'offer_accepted',
  'offer_rejected',
  'supply_completed',
] as const

export const GUEST_OFFER_ACTIONS: readonly GuestOfferAction[] = [
  'revise_price',
  'sample_sent',
  'delivery_notice',
] as const

export function isGuestOfferEvent(value: unknown): value is GuestOfferEvent {
  return typeof value === 'string' && (GUEST_OFFER_EVENTS as readonly string[]).includes(value)
}

export function isGuestOfferAction(value: unknown): value is GuestOfferAction {
  return typeof value === 'string' && (GUEST_OFFER_ACTIONS as readonly string[]).includes(value)
}

/** Anything unrecognised degrades to a plain copyable link. */
export function normalizeGuestChannel(value: unknown): GuestOfferChannel {
  if (value === 'whatsapp' || value === 'email' || value === 'link') return value
  return 'link'
}

/**
 * Picks the channel to actually reach the guest on: the one the contractor
 * shared the RFQ on originally, falling back to whatever contact detail the
 * guest actually left behind.
 */
export function resolveNotifyChannel(
  preferred: unknown,
  contact: { hasPhone: boolean; hasEmail: boolean }
): GuestOfferChannel {
  const channel = normalizeGuestChannel(preferred)
  if (channel === 'whatsapp' && contact.hasPhone) return 'whatsapp'
  if (channel === 'email' && contact.hasEmail) return 'email'
  // The original channel is unusable (or was a copied link) — prefer email,
  // which every guest supplies when submitting an offer.
  if (contact.hasEmail) return 'email'
  if (contact.hasPhone) return 'whatsapp'
  return 'link'
}

/**
 * Saudi-friendly wa.me number: digits only, local `05…` promoted to `9665…`.
 * Returns null when there aren't enough digits to be a real number.
 */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return null
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('0')) return `966${digits.slice(1)}`
  return digits
}

export function buildWhatsAppLink(phone: string | null | undefined, message: string): string | null {
  const number = toWhatsAppNumber(phone)
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

export interface GuestOfferSnapshot {
  status?: string | null
  sampleStatus?: string | null
}

export interface GuestOfferAvailability {
  canRevisePrice: boolean
  canMarkSampleSent: boolean
  canSendDeliveryNotice: boolean
  isClosed: boolean
}

/**
 * What the guest may do right now, derived from the offer's own state — the
 * single source of truth shared by the guest page and the action endpoint.
 */
export function guestOfferAvailability(
  offer: GuestOfferSnapshot,
  hasDeliveryNotice = false
): GuestOfferAvailability {
  const status = offer.status || ''
  const sampleStatus = offer.sampleStatus || ''
  return {
    canRevisePrice: status === OFFER_STATUS.reductionRequested,
    canMarkSampleSent: sampleStatus === SAMPLE_STATUS.requested && status !== OFFER_STATUS.rejected,
    canSendDeliveryNotice: status === OFFER_STATUS.accepted && !hasDeliveryNotice,
    isClosed: status === OFFER_STATUS.rejected || status === OFFER_STATUS.delivered,
  }
}

export function isGuestActionAllowed(
  action: GuestOfferAction,
  offer: GuestOfferSnapshot,
  hasDeliveryNotice = false
): boolean {
  const availability = guestOfferAvailability(offer, hasDeliveryNotice)
  if (action === 'revise_price') return availability.canRevisePrice
  if (action === 'sample_sent') return availability.canMarkSampleSent
  if (action === 'delivery_notice') return availability.canSendDeliveryNotice
  return false
}

/**
 * Maps a contractor action to the guest event to push out, or null when the
 * action needs no outbound message.
 */
export function eventForDecision(
  decision: string,
  isGuestOffer: boolean
): GuestOfferEvent | null {
  if (!isGuestOffer) return null
  if (decision === OFFER_STATUS.accepted) return 'offer_accepted'
  if (decision === OFFER_STATUS.rejected) return 'offer_rejected'
  if (decision === OFFER_STATUS.reductionRequested) return 'reduction_requested'
  return null
}

/**
 * The event a guest supplier most recently needed to hear about, derived from
 * the offer's current state — used to re-send a notification by hand when the
 * first attempt didn't land.
 */
export function guestEventForOffer(offer: GuestOfferSnapshot): GuestOfferEvent | null {
  const status = offer.status || ''
  const sampleStatus = offer.sampleStatus || ''
  if (status === OFFER_STATUS.reductionRequested) return 'reduction_requested'
  if (sampleStatus === SAMPLE_STATUS.requested) return 'sample_requested'
  if (status === OFFER_STATUS.delivered) return 'supply_completed'
  if (status === OFFER_STATUS.accepted) return 'offer_accepted'
  if (status === OFFER_STATUS.rejected) return 'offer_rejected'
  if (sampleStatus === SAMPLE_STATUS.received) return 'sample_received'
  return null
}

export function eventForSampleAction(
  action: string,
  isGuestOffer: boolean
): GuestOfferEvent | null {
  if (!isGuestOffer) return null
  if (action === SAMPLE_STATUS.requested) return 'sample_requested'
  if (action === SAMPLE_STATUS.received) return 'sample_received'
  return null
}

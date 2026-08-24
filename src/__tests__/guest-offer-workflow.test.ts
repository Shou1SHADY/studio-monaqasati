import {
  OFFER_STATUS,
  SAMPLE_STATUS,
  normalizeGuestChannel,
  resolveNotifyChannel,
  toWhatsAppNumber,
  buildWhatsAppLink,
  guestOfferAvailability,
  isGuestActionAllowed,
  isGuestOfferAction,
  isGuestOfferEvent,
  eventForDecision,
  eventForSampleAction,
  guestEventForOffer,
} from '../utils/guest-offer-workflow'

// ─── normalizeGuestChannel ────────────────────────────────────────────────────

describe('normalizeGuestChannel()', () => {
  it('passes through the known channels', () => {
    expect(normalizeGuestChannel('whatsapp')).toBe('whatsapp')
    expect(normalizeGuestChannel('email')).toBe('email')
    expect(normalizeGuestChannel('link')).toBe('link')
  })

  it('degrades anything unknown to a plain link', () => {
    expect(normalizeGuestChannel(undefined)).toBe('link')
    expect(normalizeGuestChannel(null)).toBe('link')
    expect(normalizeGuestChannel('sms')).toBe('link')
    expect(normalizeGuestChannel(42)).toBe('link')
  })
})

// ─── resolveNotifyChannel ─────────────────────────────────────────────────────

describe('resolveNotifyChannel()', () => {
  it('keeps the channel the RFQ was originally shared on', () => {
    expect(resolveNotifyChannel('whatsapp', { hasPhone: true, hasEmail: true })).toBe('whatsapp')
    expect(resolveNotifyChannel('email', { hasPhone: true, hasEmail: true })).toBe('email')
  })

  it('falls back when the original channel has no contact detail', () => {
    expect(resolveNotifyChannel('whatsapp', { hasPhone: false, hasEmail: true })).toBe('email')
    expect(resolveNotifyChannel('email', { hasPhone: true, hasEmail: false })).toBe('whatsapp')
  })

  it('prefers email for links that were copied by hand', () => {
    expect(resolveNotifyChannel('link', { hasPhone: true, hasEmail: true })).toBe('email')
  })

  it('reports link when there is no way to reach the supplier', () => {
    expect(resolveNotifyChannel('whatsapp', { hasPhone: false, hasEmail: false })).toBe('link')
  })
})

// ─── toWhatsAppNumber / buildWhatsAppLink ─────────────────────────────────────

describe('toWhatsAppNumber()', () => {
  it('promotes a local Saudi number to international form', () => {
    expect(toWhatsAppNumber('0551234567')).toBe('966551234567')
  })

  it('strips formatting and the international prefix', () => {
    expect(toWhatsAppNumber('+966 55 123 4567')).toBe('966551234567')
    expect(toWhatsAppNumber('00966551234567')).toBe('966551234567')
  })

  it('rejects values that are too short to be a number', () => {
    expect(toWhatsAppNumber('123')).toBeNull()
    expect(toWhatsAppNumber('')).toBeNull()
    expect(toWhatsAppNumber(null)).toBeNull()
  })
})

describe('buildWhatsAppLink()', () => {
  it('builds a wa.me link with the message encoded', () => {
    expect(buildWhatsAppLink('0551234567', 'مرحبا')).toBe(
      `https://wa.me/966551234567?text=${encodeURIComponent('مرحبا')}`
    )
  })

  it('returns null without a usable phone number', () => {
    expect(buildWhatsAppLink(null, 'hi')).toBeNull()
  })
})

// ─── guestOfferAvailability / isGuestActionAllowed ────────────────────────────

describe('guestOfferAvailability()', () => {
  it('opens the price form only while a reduction is pending', () => {
    expect(guestOfferAvailability({ status: OFFER_STATUS.reductionRequested }).canRevisePrice).toBe(true)
    expect(guestOfferAvailability({ status: OFFER_STATUS.pending }).canRevisePrice).toBe(false)
  })

  it('opens the sample confirmation only while a sample is requested', () => {
    expect(
      guestOfferAvailability({ status: OFFER_STATUS.pending, sampleStatus: SAMPLE_STATUS.requested })
        .canMarkSampleSent
    ).toBe(true)
    expect(
      guestOfferAvailability({ status: OFFER_STATUS.pending, sampleStatus: SAMPLE_STATUS.sent })
        .canMarkSampleSent
    ).toBe(false)
  })

  it('does not let a rejected offer confirm a sample', () => {
    expect(
      guestOfferAvailability({ status: OFFER_STATUS.rejected, sampleStatus: SAMPLE_STATUS.requested })
        .canMarkSampleSent
    ).toBe(false)
  })

  it('allows one delivery notice on an awarded offer', () => {
    expect(guestOfferAvailability({ status: OFFER_STATUS.accepted }).canSendDeliveryNotice).toBe(true)
    expect(guestOfferAvailability({ status: OFFER_STATUS.accepted }, true).canSendDeliveryNotice).toBe(false)
    expect(guestOfferAvailability({ status: OFFER_STATUS.pending }).canSendDeliveryNotice).toBe(false)
  })

  it('marks rejected and delivered offers as closed', () => {
    expect(guestOfferAvailability({ status: OFFER_STATUS.rejected }).isClosed).toBe(true)
    expect(guestOfferAvailability({ status: OFFER_STATUS.delivered }).isClosed).toBe(true)
    expect(guestOfferAvailability({ status: OFFER_STATUS.accepted }).isClosed).toBe(false)
  })

  it('handles an offer with no status at all', () => {
    const availability = guestOfferAvailability({})
    expect(availability.canRevisePrice).toBe(false)
    expect(availability.canMarkSampleSent).toBe(false)
    expect(availability.canSendDeliveryNotice).toBe(false)
    expect(availability.isClosed).toBe(false)
  })
})

describe('isGuestActionAllowed()', () => {
  it('gates each action on the matching offer state', () => {
    expect(isGuestActionAllowed('revise_price', { status: OFFER_STATUS.reductionRequested })).toBe(true)
    expect(isGuestActionAllowed('revise_price', { status: OFFER_STATUS.accepted })).toBe(false)
    expect(
      isGuestActionAllowed('sample_sent', { status: OFFER_STATUS.pending, sampleStatus: SAMPLE_STATUS.requested })
    ).toBe(true)
    expect(isGuestActionAllowed('delivery_notice', { status: OFFER_STATUS.accepted })).toBe(true)
    expect(isGuestActionAllowed('delivery_notice', { status: OFFER_STATUS.accepted }, true)).toBe(false)
  })
})

// ─── guards ───────────────────────────────────────────────────────────────────

describe('payload guards', () => {
  it('accepts only known actions and events', () => {
    expect(isGuestOfferAction('revise_price')).toBe(true)
    expect(isGuestOfferAction('delete_offer')).toBe(false)
    expect(isGuestOfferEvent('offer_accepted')).toBe(true)
    expect(isGuestOfferEvent('offer_hacked')).toBe(false)
    expect(isGuestOfferEvent(undefined)).toBe(false)
  })
})

// ─── event mapping ────────────────────────────────────────────────────────────

describe('eventForDecision()', () => {
  it('maps contractor decisions to guest events', () => {
    expect(eventForDecision(OFFER_STATUS.accepted, true)).toBe('offer_accepted')
    expect(eventForDecision(OFFER_STATUS.rejected, true)).toBe('offer_rejected')
    expect(eventForDecision(OFFER_STATUS.reductionRequested, true)).toBe('reduction_requested')
  })

  it('stays silent for registered suppliers, who get in-app notifications', () => {
    expect(eventForDecision(OFFER_STATUS.accepted, false)).toBeNull()
  })
})

describe('eventForSampleAction()', () => {
  it('maps sample actions to guest events', () => {
    expect(eventForSampleAction(SAMPLE_STATUS.requested, true)).toBe('sample_requested')
    expect(eventForSampleAction(SAMPLE_STATUS.received, true)).toBe('sample_received')
    expect(eventForSampleAction(SAMPLE_STATUS.sent, true)).toBeNull()
    expect(eventForSampleAction(SAMPLE_STATUS.requested, false)).toBeNull()
  })
})

describe('guestEventForOffer()', () => {
  it('surfaces the step the supplier still owes a reply on first', () => {
    expect(
      guestEventForOffer({ status: OFFER_STATUS.reductionRequested, sampleStatus: SAMPLE_STATUS.requested })
    ).toBe('reduction_requested')
    expect(guestEventForOffer({ status: OFFER_STATUS.pending, sampleStatus: SAMPLE_STATUS.requested })).toBe(
      'sample_requested'
    )
  })

  it('falls back to the offer decision', () => {
    expect(guestEventForOffer({ status: OFFER_STATUS.accepted })).toBe('offer_accepted')
    expect(guestEventForOffer({ status: OFFER_STATUS.rejected })).toBe('offer_rejected')
    expect(guestEventForOffer({ status: OFFER_STATUS.delivered })).toBe('supply_completed')
    expect(guestEventForOffer({ status: OFFER_STATUS.pending, sampleStatus: SAMPLE_STATUS.received })).toBe(
      'sample_received'
    )
  })

  it('has nothing to announce on a freshly submitted offer', () => {
    expect(guestEventForOffer({ status: OFFER_STATUS.pending })).toBeNull()
  })
})

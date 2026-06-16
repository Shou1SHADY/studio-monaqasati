import {
  calculateOfferTotal,
  validateOfferBatches,
  formatOfferSummary,
  DeliveryBatch,
  Offer,
} from '../utils/offer-utils'

// ─── calculateOfferTotal ──────────────────────────────────────────────────────

describe('calculateOfferTotal()', () => {
  it('sums batch prices correctly', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '2026-07-01', price: '25000' },
      { location: 'جدة', deliveryDate: '2026-07-10', price: '30000' },
    ]
    expect(calculateOfferTotal(batches)).toBe(55000)
  })

  it('returns 0 for empty batches array', () => {
    expect(calculateOfferTotal([])).toBe(0)
  })

  it('returns 0 for undefined batches', () => {
    expect(calculateOfferTotal(undefined)).toBe(0)
  })

  it('ignores batches with invalid (non-numeric) price strings', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '2026-07-01', price: 'abc' },
      { location: 'جدة', deliveryDate: '2026-07-10', price: '10000' },
    ]
    expect(calculateOfferTotal(batches)).toBe(10000)
  })

  it('handles single batch', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الدمام', deliveryDate: '2026-07-15', price: '75000' },
    ]
    expect(calculateOfferTotal(batches)).toBe(75000)
  })

  it('handles decimal prices', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '2026-07-01', price: '1500.50' },
      { location: 'جدة', deliveryDate: '2026-07-10', price: '2499.50' },
    ]
    expect(calculateOfferTotal(batches)).toBeCloseTo(4000, 1)
  })

  it('handles batches with empty price', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '2026-07-01', price: '' },
      { location: 'جدة', deliveryDate: '2026-07-10', price: '5000' },
    ]
    expect(calculateOfferTotal(batches)).toBe(5000)
  })
})

// ─── validateOfferBatches ─────────────────────────────────────────────────────

describe('validateOfferBatches()', () => {
  it('returns valid for a complete batch', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '2026-07-01', price: '25000' },
    ]
    const result = validateOfferBatches(batches)
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('returns invalid for empty batches array', () => {
    const result = validateOfferBatches([])
    expect(result.isValid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns invalid when a batch is missing location', () => {
    const batches: DeliveryBatch[] = [
      { location: '', deliveryDate: '2026-07-01', price: '25000' },
    ]
    const result = validateOfferBatches(batches)
    expect(result.isValid).toBe(false)
  })

  it('returns invalid when a batch is missing deliveryDate', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '', price: '25000' },
    ]
    const result = validateOfferBatches(batches)
    expect(result.isValid).toBe(false)
  })

  it('returns invalid when a batch is missing price', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '2026-07-01', price: '' },
    ]
    const result = validateOfferBatches(batches)
    expect(result.isValid).toBe(false)
  })

  it('returns valid for multiple complete batches', () => {
    const batches: DeliveryBatch[] = [
      { location: 'الرياض', deliveryDate: '2026-07-01', price: '25000' },
      { location: 'جدة', deliveryDate: '2026-07-10', price: '30000' },
    ]
    const result = validateOfferBatches(batches)
    expect(result.isValid).toBe(true)
  })

  it('uses custom translation function when provided', () => {
    const t = jest.fn().mockReturnValue('Custom error')
    const result = validateOfferBatches([], t)
    expect(t).toHaveBeenCalled()
    expect(result.errors[0]).toBe('Custom error')
  })
})

// ─── formatOfferSummary ───────────────────────────────────────────────────────

describe('formatOfferSummary()', () => {
  const baseOffer: Offer = {
    price: 50000,
    deliveryMethod: 'شاحنات خاصة',
    deliveryFrequency: 'دفعة واحدة',
    isFreeShipping: false,
    includesSample: false,
  }

  it('includes price in Arabic format for ar locale', () => {
    const result = formatOfferSummary(baseOffer, 'ar')
    // ar-SA locale uses Eastern Arabic numerals (٥٠٬٠٠٠ not 50,000)
    expect(result).toContain('ر.س')
    expect(result).toContain('السعر')
  })

  it('includes price in English format for en locale', () => {
    const result = formatOfferSummary(baseOffer, 'en')
    expect(result).toContain('SAR')
    expect(result).toContain('50')
  })

  it('includes delivery method', () => {
    const result = formatOfferSummary(baseOffer, 'ar')
    expect(result).toContain('شاحنات خاصة')
  })

  it('includes delivery frequency', () => {
    const result = formatOfferSummary(baseOffer, 'ar')
    expect(result).toContain('دفعة واحدة')
  })

  it('adds "free shipping" indicator when isFreeShipping is true', () => {
    const offerWithFree = { ...baseOffer, isFreeShipping: true }
    const result = formatOfferSummary(offerWithFree, 'ar')
    expect(result).toContain('توصيل مجاني')
  })

  it('adds free shipping in English for en locale', () => {
    const offerWithFree = { ...baseOffer, isFreeShipping: true }
    const result = formatOfferSummary(offerWithFree, 'en')
    expect(result).toContain('Free Shipping')
  })

  it('adds "includes sample" indicator when includesSample is true', () => {
    const offerWithSample = { ...baseOffer, includesSample: true }
    const result = formatOfferSummary(offerWithSample, 'ar')
    expect(result).toContain('يتضمن عينة')
  })

  it('adds includes sample in English for en locale', () => {
    const offerWithSample = { ...baseOffer, includesSample: true }
    const result = formatOfferSummary(offerWithSample, 'en')
    expect(result).toContain('Includes Sample')
  })

  it('defaults to Arabic when no locale provided', () => {
    const result = formatOfferSummary(baseOffer)
    expect(result).toContain('ر.س')
  })

  it('does not include free shipping text when isFreeShipping is false', () => {
    const result = formatOfferSummary(baseOffer, 'ar')
    expect(result).not.toContain('توصيل مجاني')
  })
})

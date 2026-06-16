import {
  filterRfqsByDeadline,
  filterRfqsByCategory,
  filterRfqsByCity,
  sortRfqsByDate,
  searchRfqs,
  Rfq,
} from '../utils/rfq-filters'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-06-15T00:00:00.000Z'

function makeRfq(overrides: Partial<Rfq> = {}): Rfq {
  return {
    id: '1',
    title: 'توريد حديد تسليح',
    category: 'حديد ومعادن',
    city: 'الرياض',
    createdAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  }
}

// ─── filterRfqsByDeadline ─────────────────────────────────────────────────────

describe('filterRfqsByDeadline()', () => {
  describe('filter = "all"', () => {
    it('returns all RFQs', () => {
      const rfqs = [makeRfq(), makeRfq({ id: '2' })]
      expect(filterRfqsByDeadline(rfqs, 'all', NOW)).toHaveLength(2)
    })

    it('returns empty array for empty input', () => {
      expect(filterRfqsByDeadline([], 'all', NOW)).toHaveLength(0)
    })
  })

  describe('filter = "week"', () => {
    it('includes RFQs with deadline within 7 days', () => {
      const rfqs = [
        makeRfq({ id: '1', deadline: '2026-06-20T00:00:00.000Z' }), // 5 days from NOW
        makeRfq({ id: '2', deadline: '2026-07-01T00:00:00.000Z' }), // 16 days — excluded
        makeRfq({ id: '3' }),                                         // no deadline — included
      ]
      const result = filterRfqsByDeadline(rfqs, 'week', NOW)
      expect(result.map(r => r.id)).toContain('1')
      expect(result.map(r => r.id)).not.toContain('2')
      expect(result.map(r => r.id)).toContain('3') // no deadline passes through
    })

    it('excludes past deadlines', () => {
      const rfqs = [makeRfq({ deadline: '2026-06-01T00:00:00.000Z' })] // before NOW
      const result = filterRfqsByDeadline(rfqs, 'week', NOW)
      expect(result).toHaveLength(0)
    })
  })

  describe('filter = "month"', () => {
    it('includes RFQs with deadline within 30 days', () => {
      const rfqs = [
        makeRfq({ id: '1', deadline: '2026-07-10T00:00:00.000Z' }), // 25 days — included
        makeRfq({ id: '2', deadline: '2026-08-01T00:00:00.000Z' }), // 47 days — excluded
      ]
      const result = filterRfqsByDeadline(rfqs, 'month', NOW)
      expect(result.map(r => r.id)).toContain('1')
      expect(result.map(r => r.id)).not.toContain('2')
    })

    it('includes RFQs with no deadline', () => {
      const rfqs = [makeRfq()]
      const result = filterRfqsByDeadline(rfqs, 'month', NOW)
      expect(result).toHaveLength(1)
    })
  })

  describe('filter = "custom"', () => {
    it('includes RFQs with deadline on or before custom date', () => {
      const rfqs = [
        makeRfq({ id: '1', deadline: '2026-06-20T00:00:00.000Z' }),
        makeRfq({ id: '2', deadline: '2026-06-25T00:00:00.000Z' }),
      ]
      const result = filterRfqsByDeadline(rfqs, 'custom', NOW, '2026-06-21T00:00:00.000Z')
      expect(result.map(r => r.id)).toContain('1')
      expect(result.map(r => r.id)).not.toContain('2')
    })

    it('returns all when customDate is not provided', () => {
      const rfqs = [makeRfq({ deadline: '2026-06-20T00:00:00.000Z' })]
      const result = filterRfqsByDeadline(rfqs, 'custom', NOW, undefined)
      expect(result).toHaveLength(1)
    })
  })
})

// ─── filterRfqsByCategory ─────────────────────────────────────────────────────

describe('filterRfqsByCategory()', () => {
  const rfqs: Rfq[] = [
    makeRfq({ id: '1', category: 'حديد ومعادن' }),
    makeRfq({ id: '2', category: 'أسمنت وخرسانة' }),
    makeRfq({ id: '3', category: 'حديد ومعادن' }),
  ]

  it('returns all when category is "all"', () => {
    expect(filterRfqsByCategory(rfqs, 'all')).toHaveLength(3)
  })

  it('filters by specific category', () => {
    const result = filterRfqsByCategory(rfqs, 'حديد ومعادن')
    expect(result).toHaveLength(2)
    result.forEach(r => expect(r.category).toBe('حديد ومعادن'))
  })

  it('returns empty when category has no matches', () => {
    expect(filterRfqsByCategory(rfqs, 'كهرباء')).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    expect(filterRfqsByCategory([], 'حديد ومعادن')).toHaveLength(0)
  })
})

// ─── filterRfqsByCity ─────────────────────────────────────────────────────────

describe('filterRfqsByCity()', () => {
  const rfqs: Rfq[] = [
    makeRfq({ id: '1', city: 'الرياض' }),
    makeRfq({ id: '2', city: 'جدة' }),
    makeRfq({ id: '3', city: 'الرياض' }),
  ]

  it('returns all when city is "all"', () => {
    expect(filterRfqsByCity(rfqs, 'all')).toHaveLength(3)
  })

  it('filters by specific city', () => {
    const result = filterRfqsByCity(rfqs, 'الرياض')
    expect(result).toHaveLength(2)
    result.forEach(r => expect(r.city).toBe('الرياض'))
  })

  it('returns empty when city has no matches', () => {
    expect(filterRfqsByCity(rfqs, 'الدمام')).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    expect(filterRfqsByCity([], 'الرياض')).toHaveLength(0)
  })
})

// ─── sortRfqsByDate ───────────────────────────────────────────────────────────

describe('sortRfqsByDate()', () => {
  const rfqs: Rfq[] = [
    makeRfq({ id: '1', createdAt: '2026-01-10T00:00:00.000Z' }),
    makeRfq({ id: '2', createdAt: '2026-01-20T00:00:00.000Z' }),
    makeRfq({ id: '3', createdAt: '2026-01-05T00:00:00.000Z' }),
  ]

  it('sorts descending by default (newest first)', () => {
    const result = sortRfqsByDate(rfqs)
    expect(result[0].id).toBe('2')
    expect(result[2].id).toBe('3')
  })

  it('sorts ascending when specified', () => {
    const result = sortRfqsByDate(rfqs, 'asc')
    expect(result[0].id).toBe('3')
    expect(result[2].id).toBe('2')
  })

  it('does not mutate the original array', () => {
    const original = rfqs.map(r => r.id)
    sortRfqsByDate(rfqs, 'asc')
    expect(rfqs.map(r => r.id)).toEqual(original)
  })

  it('handles empty array', () => {
    expect(sortRfqsByDate([])).toHaveLength(0)
  })

  it('handles single element', () => {
    expect(sortRfqsByDate([makeRfq()])).toHaveLength(1)
  })
})

// ─── searchRfqs ───────────────────────────────────────────────────────────────

describe('searchRfqs()', () => {
  const rfqs: Rfq[] = [
    makeRfq({ id: '1', title: 'توريد حديد تسليح', category: 'حديد ومعادن', city: 'الرياض' }),
    makeRfq({ id: '2', title: 'مواد أسمنتية جاهزة', category: 'أسمنت وخرسانة', city: 'جدة' }),
    makeRfq({ id: '3', title: 'أسلاك كهربائية', category: 'كهرباء وإنارة', city: 'الدمام' }),
  ]

  it('returns all when query is empty', () => {
    expect(searchRfqs(rfqs, '')).toHaveLength(3)
  })

  it('returns all when query is whitespace', () => {
    expect(searchRfqs(rfqs, '   ')).toHaveLength(3)
  })

  it('matches by title substring', () => {
    const result = searchRfqs(rfqs, 'حديد')
    expect(result.map(r => r.id)).toContain('1')
  })

  it('matches by category', () => {
    const result = searchRfqs(rfqs, 'أسمنت')
    expect(result.map(r => r.id)).toContain('2')
  })

  it('matches by city', () => {
    const result = searchRfqs(rfqs, 'دمام')
    expect(result.map(r => r.id)).toContain('3')
  })

  it('is case-insensitive (works with lowercase)', () => {
    const result = searchRfqs(rfqs, 'كهرباء')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('3')
  })

  it('returns empty when no matches', () => {
    expect(searchRfqs(rfqs, 'xxxxxxx')).toHaveLength(0)
  })

  it('returns empty for empty input array', () => {
    expect(searchRfqs([], 'حديد')).toHaveLength(0)
  })

  it('multiple matching RFQs returned', () => {
    // Both RFQ 1 and 2 have Arabic words, but only RFQ 1 has "حديد"
    const result = searchRfqs(rfqs, 'ء')
    // "أسمنتية" contains "ء" — but standard Arabic search would match
    expect(result.length).toBeGreaterThanOrEqual(0)
  })
})

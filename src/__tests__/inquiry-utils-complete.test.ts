import {
  formatInquiryTimestamp,
  isInquiryReplied,
  getInquiryStatus,
  getStatusLabel,
  getTimeAgo,
  filterInquiriesBySupplier,
  sortInquiriesByDate,
  Inquiry,
} from '../utils/inquiry-utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    question: 'هل يمكن التسليم خلال أسبوع؟',
    supplierId: 'supplier-1',
    supplierName: 'مورد الحديد',
    createdAt: '2026-01-15T10:00:00.000Z',
    reply: null,
    repliedAt: null,
    ...overrides,
  }
}

// ─── formatInquiryTimestamp ───────────────────────────────────────────────────

describe('formatInquiryTimestamp()', () => {
  const timestamp = '2026-06-15T14:30:00.000Z'

  it('returns a non-empty string', () => {
    const result = formatInquiryTimestamp(timestamp)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('includes year in the formatted output', () => {
    // ar-SA locale uses Eastern Arabic numerals (٢٠٢٦ not 2026)
    const arResult = formatInquiryTimestamp(timestamp, 'ar-SA')
    const enResult = formatInquiryTimestamp(timestamp, 'en-US')
    expect(enResult).toContain('2026')
    expect(arResult.length).toBeGreaterThan(0)
  })

  it('formats differently for en-US locale', () => {
    const arResult = formatInquiryTimestamp(timestamp, 'ar-SA')
    const enResult = formatInquiryTimestamp(timestamp, 'en-US')
    expect(arResult).not.toBe(enResult)
  })

  it('handles past timestamps', () => {
    // ar-SA uses Eastern Arabic numerals; check en-US for Latin digits
    const enResult = formatInquiryTimestamp('2020-01-01T00:00:00.000Z', 'en-US')
    expect(enResult).toContain('2020')
  })
})

// ─── isInquiryReplied ─────────────────────────────────────────────────────────

describe('isInquiryReplied()', () => {
  it('returns true when both reply and repliedAt are set', () => {
    const inq = makeInquiry({ reply: 'نعم', repliedAt: '2026-01-16T10:00:00.000Z' })
    expect(isInquiryReplied(inq)).toBe(true)
  })

  it('returns false when reply is null', () => {
    const inq = makeInquiry({ reply: null, repliedAt: '2026-01-16T10:00:00.000Z' })
    expect(isInquiryReplied(inq)).toBe(false)
  })

  it('returns false when repliedAt is null', () => {
    const inq = makeInquiry({ reply: 'نعم', repliedAt: null })
    expect(isInquiryReplied(inq)).toBe(false)
  })

  it('returns false when both are null', () => {
    const inq = makeInquiry()
    expect(isInquiryReplied(inq)).toBe(false)
  })

  it('returns false for empty string reply', () => {
    const inq = makeInquiry({ reply: '', repliedAt: '2026-01-16T10:00:00.000Z' })
    expect(isInquiryReplied(inq)).toBe(false)
  })
})

// ─── getInquiryStatus ─────────────────────────────────────────────────────────

describe('getInquiryStatus()', () => {
  it('returns "مجابة" for a replied inquiry', () => {
    const inq = makeInquiry({ reply: 'إجابة', repliedAt: '2026-01-16T10:00:00.000Z' })
    expect(getInquiryStatus(inq)).toBe('مجابة')
  })

  it('returns "في انتظار الرد" for an unreplied inquiry', () => {
    const inq = makeInquiry()
    expect(getInquiryStatus(inq)).toBe('في انتظار الرد')
  })
})

// ─── getStatusLabel ───────────────────────────────────────────────────────────

describe('getStatusLabel()', () => {
  it('returns Arabic label for ar locale', () => {
    expect(getStatusLabel('مجابة', 'ar')).toBe('مجابة')
    expect(getStatusLabel('في انتظار الرد', 'ar')).toBe('في انتظار الرد')
  })

  it('returns English label for en locale', () => {
    expect(getStatusLabel('مجابة', 'en')).toBe('Answered')
    expect(getStatusLabel('في انتظار الرد', 'en')).toBe('Pending Reply')
  })

  it('defaults to ar locale if no locale given', () => {
    expect(getStatusLabel('مجابة')).toBe('مجابة')
  })
})

// ─── getTimeAgo ───────────────────────────────────────────────────────────────

describe('getTimeAgo()', () => {
  it('returns "الآن" for very recent timestamp in Arabic', () => {
    const now = new Date().toISOString()
    const result = getTimeAgo(now, 'ar')
    expect(result).toBe('الآن')
  })

  it('returns "just now" for very recent timestamp in English', () => {
    const now = new Date().toISOString()
    const result = getTimeAgo(now, 'en')
    expect(result).toBe('just now')
  })

  it('shows minutes ago in Arabic for ~30 min old timestamp', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const result = getTimeAgo(thirtyMinsAgo, 'ar')
    expect(result).toContain('دقيقة')
    expect(result).toContain('منذ')
  })

  it('shows minutes ago in English for ~30 min old timestamp', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const result = getTimeAgo(thirtyMinsAgo, 'en')
    expect(result).toContain('min ago')
  })

  it('shows hours ago in Arabic for ~3 hours old timestamp', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const result = getTimeAgo(threeHoursAgo, 'ar')
    expect(result).toContain('ساعة')
    expect(result).toContain('منذ')
  })

  it('shows hours ago in English for ~3 hours old timestamp', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const result = getTimeAgo(threeHoursAgo, 'en')
    expect(result).toContain('hr ago')
  })

  it('shows days ago in Arabic for ~2 days old timestamp', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const result = getTimeAgo(twoDaysAgo, 'ar')
    expect(result).toContain('يوم')
    expect(result).toContain('منذ')
  })

  it('falls back to formatted date for very old timestamps', () => {
    const oldDate = '2020-01-01T00:00:00.000Z'
    const arResult = getTimeAgo(oldDate, 'ar')
    const enResult = getTimeAgo(oldDate, 'en')
    // Should be a formatted date, not a relative string like "منذ X يوم"
    expect(arResult).not.toContain('منذ')
    // en-US locale uses Latin digits
    expect(enResult).toContain('2020')
  })
})

// ─── filterInquiriesBySupplier ────────────────────────────────────────────────

describe('filterInquiriesBySupplier()', () => {
  const inquiries: Inquiry[] = [
    makeInquiry({ supplierId: 'sup-1' }),
    makeInquiry({ supplierId: 'sup-2', question: 'هل لديك مخزون؟' }),
    makeInquiry({ supplierId: 'sup-1', question: 'ما هو سعر الطن؟' }),
  ]

  it('returns only inquiries for the given supplier', () => {
    const result = filterInquiriesBySupplier(inquiries, 'sup-1')
    expect(result).toHaveLength(2)
    result.forEach(inq => expect(inq.supplierId).toBe('sup-1'))
  })

  it('returns empty array when no match', () => {
    const result = filterInquiriesBySupplier(inquiries, 'sup-999')
    expect(result).toHaveLength(0)
  })

  it('returns all when supplier has all inquiries', () => {
    const result = filterInquiriesBySupplier(inquiries, 'sup-2')
    expect(result).toHaveLength(1)
  })

  it('returns empty for empty input', () => {
    const result = filterInquiriesBySupplier([], 'sup-1')
    expect(result).toHaveLength(0)
  })
})

// ─── sortInquiriesByDate ──────────────────────────────────────────────────────

describe('sortInquiriesByDate()', () => {
  const inquiries: Inquiry[] = [
    makeInquiry({ createdAt: '2026-01-10T10:00:00.000Z' }),
    makeInquiry({ createdAt: '2026-01-15T10:00:00.000Z' }),
    makeInquiry({ createdAt: '2026-01-05T10:00:00.000Z' }),
  ]

  it('sorts descending by default (newest first)', () => {
    const result = sortInquiriesByDate(inquiries)
    expect(result[0].createdAt).toBe('2026-01-15T10:00:00.000Z')
    expect(result[2].createdAt).toBe('2026-01-05T10:00:00.000Z')
  })

  it('sorts ascending when order is "asc"', () => {
    const result = sortInquiriesByDate(inquiries, 'asc')
    expect(result[0].createdAt).toBe('2026-01-05T10:00:00.000Z')
    expect(result[2].createdAt).toBe('2026-01-15T10:00:00.000Z')
  })

  it('does not mutate the original array', () => {
    const original = [...inquiries]
    sortInquiriesByDate(inquiries, 'asc')
    expect(inquiries[0].createdAt).toBe(original[0].createdAt)
  })

  it('handles empty array', () => {
    const result = sortInquiriesByDate([])
    expect(result).toHaveLength(0)
  })

  it('handles single element', () => {
    const single = [makeInquiry()]
    const result = sortInquiriesByDate(single)
    expect(result).toHaveLength(1)
  })
})

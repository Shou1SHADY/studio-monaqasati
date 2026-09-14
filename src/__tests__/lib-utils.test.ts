import { cn } from '../lib/utils'

describe('cn() — className merger', () => {
  it('merges two simple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles a single class', () => {
    expect(cn('flex')).toBe('flex')
  })

  it('filters out falsy values', () => {
    expect(cn('flex', undefined, null, false, '', 'gap-4')).toBe('flex gap-4')
  })

  it('merges Tailwind conflicting classes (twMerge behaviour)', () => {
    // twMerge resolves p-2 vs p-4 — last wins
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles conditional objects (clsx behaviour)', () => {
    expect(cn({ 'bg-primary': true, 'bg-secondary': false })).toBe('bg-primary')
  })

  it('handles arrays', () => {
    expect(cn(['flex', 'items-center'], 'gap-2')).toBe('flex items-center gap-2')
  })

  it('handles nested arrays and objects', () => {
    // flex and block are conflicting display utilities — twMerge keeps the last one
    expect(cn(['flex', { 'hidden': false, 'items-center': true }])).toBe('flex items-center')
  })

  it('returns empty string for no args', () => {
    expect(cn()).toBe('')
  })

  it('returns empty string for all falsy args', () => {
    expect(cn(undefined, null, false)).toBe('')
  })

  it('does not add duplicate classes', () => {
    expect(cn('flex', 'flex')).toBe('flex')
  })

  it('merges RTL direction classes without conflict', () => {
    // Real-world use: combining direction-aware classes
    const result = cn('text-start', 'font-body', 'text-sm')
    expect(result).toContain('text-start')
    expect(result).toContain('font-body')
  })
})

import { sanitizeDecimalInput } from '../lib/utils'

describe('sanitizeDecimalInput() — quantity boxes', () => {
  it('keeps plain decimals', () => {
    expect(sanitizeDecimalInput('12.5')).toBe('12.5')
  })

  it('drops a unit typed into the quantity box', () => {
    expect(sanitizeDecimalInput('m2')).toBe('2')
    expect(sanitizeDecimalInput('80 م²')).toBe('80')
    expect(sanitizeDecimalInput('kg')).toBe('')
  })

  it('converts Eastern Arabic and Persian digits and the Arabic decimal separator', () => {
    expect(sanitizeDecimalInput('١٢٫٥')).toBe('12.5')
    expect(sanitizeDecimalInput('۳۴')).toBe('34')
  })

  it('keeps only the first decimal point', () => {
    expect(sanitizeDecimalInput('1.2.3')).toBe('1.23')
    expect(sanitizeDecimalInput('1,5')).toBe('1.5')
  })
})

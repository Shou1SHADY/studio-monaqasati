import {
  filterSuppliersByStatus,
  filterSuppliersByCity,
  filterSuppliersBySpecialization,
  searchSuppliers,
  SupplierRow,
} from '../utils/supplier-filters'

function makeSupplier(overrides: Partial<SupplierRow> = {}): SupplierRow {
  return {
    id: '1',
    name: 'شركة الإنشاءات الحديثة',
    contact: '0501234567',
    email: 'info@modern.sa',
    city: 'الرياض',
    crNumber: '1010123456',
    taxNumber: '300123456700003',
    category: 'حديد ومعادن',
    specializations: ['حديد ومعادن'],
    verified: false,
    verificationRequested: false,
    ...overrides,
  }
}

describe('filterSuppliersByStatus()', () => {
  it('"all" returns every supplier', () => {
    const suppliers = [makeSupplier({ id: '1' }), makeSupplier({ id: '2', verified: true })]
    expect(filterSuppliersByStatus(suppliers, 'all')).toHaveLength(2)
  })

  it('"verified" returns only verified suppliers', () => {
    const suppliers = [
      makeSupplier({ id: '1', verified: true }),
      makeSupplier({ id: '2', verified: false }),
    ]
    const result = filterSuppliersByStatus(suppliers, 'verified')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('"pending" returns unverified suppliers who requested verification', () => {
    const suppliers = [
      makeSupplier({ id: '1', verified: false, verificationRequested: true }),
      makeSupplier({ id: '2', verified: false, verificationRequested: false }),
      makeSupplier({ id: '3', verified: true, verificationRequested: true }),
    ]
    const result = filterSuppliersByStatus(suppliers, 'pending')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('"review" returns unverified suppliers with no pending request', () => {
    const suppliers = [
      makeSupplier({ id: '1', verified: false, verificationRequested: false }),
      makeSupplier({ id: '2', verified: false, verificationRequested: true }),
    ]
    const result = filterSuppliersByStatus(suppliers, 'review')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('returns empty array for empty input', () => {
    expect(filterSuppliersByStatus([], 'verified')).toHaveLength(0)
  })
})

describe('filterSuppliersByCity()', () => {
  it('"all" returns every supplier', () => {
    const suppliers = [makeSupplier({ city: 'الرياض' }), makeSupplier({ city: 'جدة' })]
    expect(filterSuppliersByCity(suppliers, 'all')).toHaveLength(2)
  })

  it('filters by exact city match', () => {
    const suppliers = [
      makeSupplier({ id: '1', city: 'الرياض' }),
      makeSupplier({ id: '2', city: 'جدة' }),
    ]
    const result = filterSuppliersByCity(suppliers, 'جدة')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })
})

describe('filterSuppliersBySpecialization()', () => {
  it('"all" returns every supplier', () => {
    const suppliers = [makeSupplier(), makeSupplier({ specializations: ['كهرباء'] })]
    expect(filterSuppliersBySpecialization(suppliers, 'all')).toHaveLength(2)
  })

  it('matches a supplier with multiple specializations', () => {
    const suppliers = [
      makeSupplier({ id: '1', specializations: ['حديد ومعادن', 'كهرباء'] }),
      makeSupplier({ id: '2', specializations: ['سباكة'] }),
    ]
    const result = filterSuppliersBySpecialization(suppliers, 'كهرباء')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })
})

describe('searchSuppliers()', () => {
  it('empty query returns every supplier', () => {
    const suppliers = [makeSupplier(), makeSupplier({ id: '2' })]
    expect(searchSuppliers(suppliers, '  ')).toHaveLength(2)
  })

  it('matches by name (case-insensitive)', () => {
    const suppliers = [makeSupplier({ name: 'Modern Construction Co' })]
    expect(searchSuppliers(suppliers, 'modern')).toHaveLength(1)
  })

  it('matches by email', () => {
    const suppliers = [makeSupplier({ email: 'contact@steelco.sa' })]
    expect(searchSuppliers(suppliers, 'steelco')).toHaveLength(1)
  })

  it('matches by CR number', () => {
    const suppliers = [makeSupplier({ crNumber: '1010999999' })]
    expect(searchSuppliers(suppliers, '999999')).toHaveLength(1)
  })

  it('matches by tax number', () => {
    const suppliers = [makeSupplier({ taxNumber: '300987654300003' })]
    expect(searchSuppliers(suppliers, '987654')).toHaveLength(1)
  })

  it('matches by specialization', () => {
    const suppliers = [makeSupplier({ specializations: ['أعمال السباكة'] })]
    expect(searchSuppliers(suppliers, 'سباكة')).toHaveLength(1)
  })

  it('returns empty array when nothing matches', () => {
    const suppliers = [makeSupplier()]
    expect(searchSuppliers(suppliers, 'zzz-no-match')).toHaveLength(0)
  })
})

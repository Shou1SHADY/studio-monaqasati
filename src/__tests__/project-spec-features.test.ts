/**
 * Unit tests for the feature spec:
 *   1. Project extended fields (type, region, clientType, blueprint)
 *   2. BOQ parsing, validation, and calculation
 *   3. Procurement materials filtering and sidebar helpers
 *   4. Delivery attachment path helpers
 */

import {
  buildProjectData,
  validateProjectForm,
  filterProjectsByStatus,
  getStatusCounts,
  getProjectMetaSummary,
  hasBlueprint,
  type Project,
  type ProjectFormFields,
} from '../utils/project-utils'

import {
  calcRowTotal,
  calcBoqGrandTotal,
  validateBoqItem,
  filterBoqByRfq,
  parseBoqRow,
  parseBoqSheet,
  buildBoqStoragePayload,
  reorderItemNos,
  getBoqSummary,
  type BoqItem,
} from '../utils/boq-utils'

import {
  filterMaterials,
  getUniqueCategories,
  buildBoqRowFromMaterial,
  sortMaterialsByPrice,
  getMostUsedMaterials,
  buildAttachmentStoragePath,
  getAttachmentLabel,
  type ProcurementMaterial,
} from '../utils/procurement-utils'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'مشروع الرياض',
    status: 'active',
    rfqIds: [],
    ...overrides,
  }
}

function makeBoqItem(overrides: Partial<BoqItem> = {}): BoqItem {
  return {
    id: 'item-1',
    itemNo: '1',
    description: 'حديد تسليح',
    quantity: '10',
    unit: 'طن',
    unitPrice: '3000',
    rfqId: '',
    ...overrides,
  }
}

function makeMaterial(overrides: Partial<ProcurementMaterial> = {}): ProcurementMaterial {
  return {
    id: 'mat-1',
    name: 'حديد تسليح',
    nameEn: 'Rebar',
    unit: 'طن',
    refPrice: 3200,
    totalQtyUsed: 50,
    category: 'حديد ومعادن',
    ...overrides,
  }
}

const baseForm: ProjectFormFields = {
  name: 'مشروع الفيلا',
  description: 'وصف المشروع',
  location: 'شمال الرياض',
  region: 'الرياض',
  budget: '500000',
  status: 'active',
  projectType: 'proj_type_buildings',
  clientType: 'proj_client_private',
  blueprintUrl: 'https://storage.example.com/blueprint.pdf',
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PROJECT — EXTENDED FIELDS
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildProjectData — extended fields', () => {
  it('stores projectType from form', () => {
    const data = buildProjectData(baseForm, 'user-1', 'org-1')
    expect(data.projectType).toBe('proj_type_buildings')
  })

  it('stores clientType from form', () => {
    const data = buildProjectData(baseForm, 'user-1', 'org-1')
    expect(data.clientType).toBe('proj_client_private')
  })

  it('stores region from form', () => {
    const data = buildProjectData(baseForm, 'user-1', 'org-1')
    expect(data.region).toBe('الرياض')
  })

  it('stores blueprintUrl from form', () => {
    const data = buildProjectData(baseForm, 'user-1', 'org-1')
    expect(data.blueprintUrl).toBe('https://storage.example.com/blueprint.pdf')
  })

  it('sets projectType to undefined when empty string', () => {
    const data = buildProjectData({ ...baseForm, projectType: '' }, 'u', 'o')
    expect(data.projectType).toBeUndefined()
  })

  it('sets clientType to undefined when not provided', () => {
    const data = buildProjectData({ ...baseForm, clientType: undefined }, 'u', 'o')
    expect(data.clientType).toBeUndefined()
  })

  it('sets blueprintUrl to undefined when not provided', () => {
    const data = buildProjectData({ ...baseForm, blueprintUrl: undefined }, 'u', 'o')
    expect(data.blueprintUrl).toBeUndefined()
  })

  it('still initializes rfqIds as empty array', () => {
    expect(buildProjectData(baseForm, 'u', 'o').rfqIds).toEqual([])
  })

  it('trims region whitespace', () => {
    const data = buildProjectData({ ...baseForm, region: '  الرياض  ' }, 'u', 'o')
    expect(data.region).toBe('الرياض')
  })
})

describe('validateProjectForm — extended fields do not affect required validation', () => {
  it('valid without optional fields', () => {
    const result = validateProjectForm({ name: 'مشروع', status: 'active' })
    expect(result.isValid).toBe(true)
  })

  it('still invalid when name missing even if other fields present', () => {
    const result = validateProjectForm({ ...baseForm, name: '' })
    expect(result.isValid).toBe(false)
  })
})

describe('getProjectMetaSummary', () => {
  it('joins region, projectType, clientType with ·', () => {
    const project = makeProject({
      region: 'الرياض',
      projectType: 'proj_type_buildings',
      clientType: 'proj_client_private',
    })
    const summary = getProjectMetaSummary(project)
    expect(summary).toBe('الرياض · proj_type_buildings · proj_client_private')
  })

  it('returns empty string when no meta fields set', () => {
    expect(getProjectMetaSummary(makeProject())).toBe('')
  })

  it('handles only region', () => {
    const project = makeProject({ region: 'جازان' })
    expect(getProjectMetaSummary(project)).toBe('جازان')
  })

  it('skips undefined fields', () => {
    const project = makeProject({ region: 'تبوك', clientType: undefined })
    expect(getProjectMetaSummary(project)).toBe('تبوك')
  })
})

describe('hasBlueprint', () => {
  it('returns true when blueprintUrl is a non-empty string', () => {
    expect(hasBlueprint(makeProject({ blueprintUrl: 'https://example.com/file.pdf' }))).toBe(true)
  })

  it('returns false when blueprintUrl is undefined', () => {
    expect(hasBlueprint(makeProject({ blueprintUrl: undefined }))).toBe(false)
  })

  it('returns false when blueprintUrl is empty string', () => {
    expect(hasBlueprint(makeProject({ blueprintUrl: '' }))).toBe(false)
  })
})

describe('filterProjectsByStatus — unchanged behaviour', () => {
  const projects = [
    makeProject({ id: '1', status: 'active' }),
    makeProject({ id: '2', status: 'paused', projectType: 'proj_type_roads' }),
    makeProject({ id: '3', status: 'active', clientType: 'proj_client_government' }),
  ]

  it('returns all projects for "all"', () => {
    expect(filterProjectsByStatus(projects, 'all')).toHaveLength(3)
  })

  it('filters active only', () => {
    expect(filterProjectsByStatus(projects, 'active')).toHaveLength(2)
  })
})

describe('getStatusCounts — unchanged behaviour', () => {
  it('counts extended projects correctly', () => {
    const projects = [
      makeProject({ status: 'active', projectType: 'proj_type_infrastructure' }),
      makeProject({ status: 'completed', clientType: 'proj_client_government' }),
    ]
    const counts = getStatusCounts(projects)
    expect(counts.active).toBe(1)
    expect(counts.completed).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BOQ UTILS
// ═══════════════════════════════════════════════════════════════════════════════

describe('calcRowTotal', () => {
  it('multiplies quantity × unitPrice', () => {
    expect(calcRowTotal({ quantity: '10', unitPrice: '3000' })).toBe(30000)
  })

  it('returns 0 for non-numeric quantity', () => {
    expect(calcRowTotal({ quantity: 'abc', unitPrice: '100' })).toBe(0)
  })

  it('returns 0 for non-numeric price', () => {
    expect(calcRowTotal({ quantity: '5', unitPrice: '' })).toBe(0)
  })

  it('returns 0 for zero quantity', () => {
    expect(calcRowTotal({ quantity: '0', unitPrice: '5000' })).toBe(0)
  })

  it('handles decimal quantities', () => {
    expect(calcRowTotal({ quantity: '2.5', unitPrice: '100' })).toBeCloseTo(250)
  })

  it('returns 0 when both fields are empty strings', () => {
    expect(calcRowTotal({ quantity: '', unitPrice: '' })).toBe(0)
  })
})

describe('calcBoqGrandTotal', () => {
  it('sums all row totals', () => {
    const items = [
      makeBoqItem({ quantity: '10', unitPrice: '100' }),
      makeBoqItem({ id: '2', quantity: '5', unitPrice: '200' }),
    ]
    expect(calcBoqGrandTotal(items)).toBe(2000)
  })

  it('returns 0 for empty array', () => {
    expect(calcBoqGrandTotal([])).toBe(0)
  })

  it('ignores items with no price', () => {
    const items = [
      makeBoqItem({ quantity: '10', unitPrice: '' }),
      makeBoqItem({ id: '2', quantity: '5', unitPrice: '200' }),
    ]
    expect(calcBoqGrandTotal(items)).toBe(1000)
  })
})

describe('validateBoqItem', () => {
  it('is valid for a complete item', () => {
    const result = validateBoqItem(makeBoqItem())
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('requires description', () => {
    const result = validateBoqItem(makeBoqItem({ description: '' }))
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('الوصف مطلوب')
  })

  it('requires non-negative numeric quantity', () => {
    const result = validateBoqItem(makeBoqItem({ quantity: '-5' }))
    expect(result.isValid).toBe(false)
  })

  it('requires unit', () => {
    const result = validateBoqItem(makeBoqItem({ unit: '' }))
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('الوحدة مطلوبة')
  })

  it('rejects non-numeric quantity string', () => {
    const result = validateBoqItem(makeBoqItem({ quantity: 'many' }))
    expect(result.isValid).toBe(false)
  })

  it('collects multiple errors at once', () => {
    const result = validateBoqItem({ description: '', quantity: '', unit: '' })
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe('filterBoqByRfq', () => {
  const items = [
    makeBoqItem({ id: '1', rfqId: 'rfq-A' }),
    makeBoqItem({ id: '2', rfqId: 'rfq-B' }),
    makeBoqItem({ id: '3', rfqId: 'rfq-A' }),
    makeBoqItem({ id: '4', rfqId: '' }),
  ]

  it('returns only items linked to the given rfqId', () => {
    const result = filterBoqByRfq(items, 'rfq-A')
    expect(result).toHaveLength(2)
    expect(result.every((i) => i.rfqId === 'rfq-A')).toBe(true)
  })

  it('returns empty array when no items match', () => {
    expect(filterBoqByRfq(items, 'rfq-Z')).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(filterBoqByRfq([], 'rfq-A')).toHaveLength(0)
  })
})

describe('parseBoqRow', () => {
  it('maps Excel columns to BoqItem fields', () => {
    const row = ['1', 'حديد تسليح', '10', 'طن', '3200']
    const item = parseBoqRow(row, 0)
    expect(item.itemNo).toBe('1')
    expect(item.description).toBe('حديد تسليح')
    expect(item.quantity).toBe('10')
    expect(item.unit).toBe('طن')
    expect(item.unitPrice).toBe('3200')
  })

  it('uses row index + 1 as itemNo when first column is empty', () => {
    const row = [null, 'أسمنت', '50', 'كيس', '15']
    const item = parseBoqRow(row, 4)
    expect(item.itemNo).toBe('5')
  })

  it('sets empty rfqId', () => {
    const item = parseBoqRow(['1', 'test', '1', 'unit', '100'], 0)
    expect(item.rfqId).toBe('')
  })

  it('generates unique id based on rowIndex', () => {
    const a = parseBoqRow(['1', 'a', '1', 'u', '1'], 0)
    const b = parseBoqRow(['2', 'b', '2', 'u', '2'], 1)
    expect(a.id).not.toBe(b.id)
  })
})

describe('parseBoqSheet', () => {
  it('skips header row (index 0)', () => {
    const rows = [
      ['رقم البند', 'الوصف', 'الكمية', 'الوحدة', 'السعر'],
      ['1', 'حديد', '10', 'طن', '3000'],
    ]
    const items = parseBoqSheet(rows)
    expect(items).toHaveLength(1)
    expect(items[0].description).toBe('حديد')
  })

  it('skips fully empty rows', () => {
    const rows = [
      ['No', 'Desc', 'Qty', 'Unit', 'Price'],
      ['1', 'Item A', '5', 'م', '100'],
      ['', '', '', '', ''],
      ['2', 'Item B', '3', 'طن', '200'],
    ]
    const items = parseBoqSheet(rows)
    expect(items).toHaveLength(2)
  })

  it('returns empty array for header-only sheet', () => {
    const rows = [['No', 'Desc', 'Qty', 'Unit', 'Price']]
    expect(parseBoqSheet(rows)).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(parseBoqSheet([])).toHaveLength(0)
  })
})

describe('buildBoqStoragePayload', () => {
  it('converts quantity and unitPrice strings to numbers', () => {
    const payload = buildBoqStoragePayload(makeBoqItem({ quantity: '7', unitPrice: '1500' }))
    expect(payload.quantity).toBe(7)
    expect(payload.unitPrice).toBe(1500)
    expect(typeof payload.quantity).toBe('number')
  })

  it('sets rfqId to null when empty string', () => {
    const payload = buildBoqStoragePayload(makeBoqItem({ rfqId: '' }))
    expect(payload.rfqId).toBeNull()
  })

  it('preserves rfqId when set', () => {
    const payload = buildBoqStoragePayload(makeBoqItem({ rfqId: 'rfq-123' }))
    expect(payload.rfqId).toBe('rfq-123')
  })

  it('defaults non-numeric strings to 0', () => {
    const payload = buildBoqStoragePayload(makeBoqItem({ quantity: 'N/A', unitPrice: '' }))
    expect(payload.quantity).toBe(0)
    expect(payload.unitPrice).toBe(0)
  })
})

describe('reorderItemNos', () => {
  it('renumbers items 1, 2, 3 … based on array position', () => {
    const items = [
      makeBoqItem({ id: '1', itemNo: '5' }),
      makeBoqItem({ id: '2', itemNo: '3' }),
      makeBoqItem({ id: '3', itemNo: '9' }),
    ]
    const reordered = reorderItemNos(items)
    expect(reordered.map((i) => i.itemNo)).toEqual(['1', '2', '3'])
  })

  it('does not mutate original array', () => {
    const items = [makeBoqItem({ itemNo: '99' })]
    reorderItemNos(items)
    expect(items[0].itemNo).toBe('99')
  })

  it('returns empty array for empty input', () => {
    expect(reorderItemNos([])).toHaveLength(0)
  })
})

describe('getBoqSummary', () => {
  it('returns count, total, and linkedCount', () => {
    const items = [
      makeBoqItem({ quantity: '10', unitPrice: '100', rfqId: 'rfq-1' }),
      makeBoqItem({ id: '2', quantity: '5', unitPrice: '200', rfqId: '' }),
    ]
    const summary = getBoqSummary(items)
    expect(summary.count).toBe(2)
    expect(summary.total).toBe(2000)
    expect(summary.linkedCount).toBe(1)
  })

  it('returns zeros for empty array', () => {
    const summary = getBoqSummary([])
    expect(summary.count).toBe(0)
    expect(summary.total).toBe(0)
    expect(summary.linkedCount).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PROCUREMENT UTILS
// ═══════════════════════════════════════════════════════════════════════════════

describe('filterMaterials', () => {
  const materials = [
    makeMaterial({ id: '1', name: 'حديد تسليح', nameEn: 'Rebar', category: 'حديد ومعادن' }),
    makeMaterial({ id: '2', name: 'أسمنت بورتلاند', nameEn: 'Portland Cement', category: 'أسمنت' }),
    makeMaterial({ id: '3', name: 'طوب أحمر', nameEn: 'Red Brick', category: 'بناء' }),
  ]

  it('returns all materials with empty search and category', () => {
    expect(filterMaterials(materials, '', '')).toHaveLength(3)
  })

  it('filters by Arabic name (partial, case-insensitive)', () => {
    const result = filterMaterials(materials, 'حديد', '')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('filters by English name', () => {
    const result = filterMaterials(materials, 'cement', '')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('filters by category', () => {
    const result = filterMaterials(materials, '', 'حديد ومعادن')
    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('حديد ومعادن')
  })

  it('combines search and category filters', () => {
    const result = filterMaterials(materials, 'أسمنت', 'حديد ومعادن')
    expect(result).toHaveLength(0)
  })

  it('returns empty array when no match', () => {
    expect(filterMaterials(materials, 'xyz-nomatch', '')).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(filterMaterials([], 'حديد', '')).toHaveLength(0)
  })
})

describe('getUniqueCategories', () => {
  it('returns sorted unique categories', () => {
    const materials = [
      makeMaterial({ id: '1', category: 'حديد ومعادن' }),
      makeMaterial({ id: '2', category: 'أسمنت' }),
      makeMaterial({ id: '3', category: 'حديد ومعادن' }),
    ]
    const cats = getUniqueCategories(materials)
    expect(cats).toHaveLength(2)
    expect(new Set(cats).size).toBe(2)
  })

  it('excludes materials with no category', () => {
    const materials = [
      makeMaterial({ id: '1', category: undefined }),
      makeMaterial({ id: '2', category: 'أسمنت' }),
    ]
    const cats = getUniqueCategories(materials)
    expect(cats).toHaveLength(1)
    expect(cats[0]).toBe('أسمنت')
  })

  it('returns empty array for empty input', () => {
    expect(getUniqueCategories([])).toHaveLength(0)
  })
})

describe('buildBoqRowFromMaterial', () => {
  const material = makeMaterial({ name: 'حديد تسليح', unit: 'طن', refPrice: 3200 })

  it('uses material name as description', () => {
    const row = buildBoqRowFromMaterial(material, 0)
    expect(row.description).toBe('حديد تسليح')
  })

  it('uses material refPrice as unitPrice', () => {
    const row = buildBoqRowFromMaterial(material, 0)
    expect(row.unitPrice).toBe('3200')
  })

  it('uses material unit', () => {
    const row = buildBoqRowFromMaterial(material, 0)
    expect(row.unit).toBe('طن')
  })

  it('sets itemNo to existingCount + 1', () => {
    const row = buildBoqRowFromMaterial(material, 4)
    expect(row.itemNo).toBe('5')
  })

  it('sets quantity to empty string (user must fill)', () => {
    const row = buildBoqRowFromMaterial(material, 0)
    expect(row.quantity).toBe('')
  })
})

describe('sortMaterialsByPrice', () => {
  const materials = [
    makeMaterial({ id: '1', refPrice: 500 }),
    makeMaterial({ id: '2', refPrice: 100 }),
    makeMaterial({ id: '3', refPrice: 300 }),
  ]

  it('sorts ascending by default', () => {
    const sorted = sortMaterialsByPrice(materials)
    expect(sorted.map((m) => m.refPrice)).toEqual([100, 300, 500])
  })

  it('sorts descending when specified', () => {
    const sorted = sortMaterialsByPrice(materials, 'desc')
    expect(sorted.map((m) => m.refPrice)).toEqual([500, 300, 100])
  })

  it('does not mutate input array', () => {
    const copy = [...materials]
    sortMaterialsByPrice(materials, 'asc')
    expect(materials[0].refPrice).toBe(copy[0].refPrice)
  })
})

describe('getMostUsedMaterials', () => {
  const materials = [
    makeMaterial({ id: '1', totalQtyUsed: 200 }),
    makeMaterial({ id: '2', totalQtyUsed: 50 }),
    makeMaterial({ id: '3', totalQtyUsed: 500 }),
    makeMaterial({ id: '4', totalQtyUsed: 0 }),
    makeMaterial({ id: '5', totalQtyUsed: 150 }),
  ]

  it('returns top N by totalQtyUsed descending', () => {
    const result = getMostUsedMaterials(materials, 3)
    expect(result).toHaveLength(3)
    expect(result[0].id).toBe('3')
    expect(result[1].id).toBe('1')
    expect(result[2].id).toBe('5')
  })

  it('excludes materials with 0 or undefined totalQtyUsed', () => {
    const result = getMostUsedMaterials(materials, 10)
    expect(result.every((m) => (m.totalQtyUsed ?? 0) > 0)).toBe(true)
  })

  it('returns empty array for empty input', () => {
    expect(getMostUsedMaterials([])).toHaveLength(0)
  })

  it('returns all qualifying items when limit exceeds count', () => {
    const result = getMostUsedMaterials(materials, 100)
    expect(result.length).toBeLessThanOrEqual(materials.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ATTACHMENT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildAttachmentStoragePath', () => {
  it('produces deliveries/{id}/attachments/{filename} path', () => {
    const path = buildAttachmentStoragePath('del-abc', 'receipt.pdf')
    expect(path).toBe('deliveries/del-abc/attachments/receipt.pdf')
  })

  it('includes the delivery ID in the path', () => {
    const path = buildAttachmentStoragePath('xyz-999', 'photo.jpg')
    expect(path).toContain('xyz-999')
  })

  it('includes the filename in the path', () => {
    const path = buildAttachmentStoragePath('del-1', 'note.pdf')
    expect(path).toContain('note.pdf')
  })
})

describe('getAttachmentLabel', () => {
  it('returns Arabic label for ar locale', () => {
    expect(getAttachmentLabel(0, 'ar')).toBe('مستند 1')
    expect(getAttachmentLabel(2, 'ar')).toBe('مستند 3')
  })

  it('returns English label for en locale', () => {
    expect(getAttachmentLabel(0, 'en')).toBe('Document 1')
    expect(getAttachmentLabel(4, 'en')).toBe('Document 5')
  })

  it('is 1-indexed (index 0 → label 1)', () => {
    expect(getAttachmentLabel(0, 'en')).toContain('1')
  })
})

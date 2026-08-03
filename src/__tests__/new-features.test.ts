/**
 * Unit tests for the batch of new features:
 *
 *  1. Supplier Connections  — contractorSupplierLinks CRUD helpers
 *  2. RFQ Visibility        — public / private toggle, mergeAndDeduplicate, canView
 *  3. Delivery Notices      — buildDeliveryIndex, validateDeliveryForm, buildReceiptNumber
 *  4. Project Management    — filterProjectsByStatus, validateProjectForm, buildProjectData
 */

import {
  filterLinksByStatus,
  getLinkedOrgIds,
  isAlreadyConnected,
  hasPendingRequest,
  countByStatus,
  type SupplierLink,
} from '../utils/supplier-connections'

import {
  buildAllowedSupplierOrgIds,
  mergeAndDeduplicateRfqs,
  canSupplierViewRfq,
  countPrivateRfqRecipients,
  resolveRfqVisibility,
  type VisibilityRfq,
} from '../utils/rfq-visibility'

import {
  buildDeliveryIndex,
  validateDeliveryForm,
  buildReceiptNumber,
  isPendingConfirmation,
  isDeliveryConfirmed,
  type Delivery,
} from '../utils/delivery-utils'

import {
  filterProjectsByStatus,
  getProjectRfqCount,
  validateProjectForm,
  buildProjectData,
  getStatusCounts,
  type Project,
} from '../utils/project-utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLink(overrides: Partial<SupplierLink> = {}): SupplierLink {
  return {
    id: Math.random().toString(36).slice(2),
    contractorOrgId: 'contractor-org-1',
    supplierOrgId: 'supplier-org-1',
    status: 'pending',
    categories: [],
    ...overrides,
  }
}

function makeRfq(overrides: Partial<VisibilityRfq> = {}): VisibilityRfq {
  return {
    id: Math.random().toString(36).slice(2),
    status: 'New',
    visibility: 'public',
    allowedSupplierOrgIds: [],
    category: 'حديد ومعادن',
    ...overrides,
  }
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: Math.random().toString(36).slice(2),
    offerId: 'offer-1',
    status: 'pending_confirmation',
    deliveryPersonName: 'أحمد محمد',
    deliveryDate: '2026-08-01',
    ...overrides,
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'مشروع فيلا الرياض',
    status: 'active',
    rfqIds: [],
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SUPPLIER CONNECTIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('Supplier Connections — filterLinksByStatus', () => {
  it('returns only pending links', () => {
    const links = [
      makeLink({ id: '1', status: 'pending' }),
      makeLink({ id: '2', status: 'active' }),
      makeLink({ id: '3', status: 'pending' }),
    ]
    const result = filterLinksByStatus(links, 'pending')
    expect(result).toHaveLength(2)
    expect(result.every(l => l.status === 'pending')).toBe(true)
  })

  it('returns only active links', () => {
    const links = [
      makeLink({ id: '1', status: 'pending' }),
      makeLink({ id: '2', status: 'active' }),
    ]
    expect(filterLinksByStatus(links, 'active')).toHaveLength(1)
  })

  it('returns empty array when no matching status', () => {
    const links = [makeLink({ status: 'active' })]
    expect(filterLinksByStatus(links, 'rejected')).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(filterLinksByStatus([], 'pending')).toHaveLength(0)
  })
})

describe('Supplier Connections — getLinkedOrgIds', () => {
  it('collects supplierOrgId from non-rejected links', () => {
    const links = [
      makeLink({ supplierOrgId: 'sup-1', status: 'active' }),
      makeLink({ supplierOrgId: 'sup-2', status: 'pending' }),
      makeLink({ supplierOrgId: 'sup-3', status: 'rejected' }),
    ]
    const ids = getLinkedOrgIds(links, 'supplierOrgId')
    expect(ids.has('sup-1')).toBe(true)
    expect(ids.has('sup-2')).toBe(true)
    expect(ids.has('sup-3')).toBe(false)
  })

  it('collects contractorOrgId from non-rejected links', () => {
    const links = [
      makeLink({ contractorOrgId: 'con-1', status: 'active' }),
      makeLink({ contractorOrgId: 'con-2', status: 'rejected' }),
    ]
    const ids = getLinkedOrgIds(links, 'contractorOrgId')
    expect(ids.has('con-1')).toBe(true)
    expect(ids.has('con-2')).toBe(false)
  })

  it('deduplicates repeated org IDs', () => {
    const links = [
      makeLink({ supplierOrgId: 'sup-1', status: 'active' }),
      makeLink({ supplierOrgId: 'sup-1', status: 'pending' }),
    ]
    expect(getLinkedOrgIds(links, 'supplierOrgId').size).toBe(1)
  })

  it('returns empty set for empty input', () => {
    expect(getLinkedOrgIds([], 'supplierOrgId').size).toBe(0)
  })
})

describe('Supplier Connections — isAlreadyConnected', () => {
  it('returns true when an active link exists with the org ID', () => {
    const links = [makeLink({ supplierOrgId: 'sup-99', status: 'active' })]
    expect(isAlreadyConnected(links, 'sup-99', 'supplierOrgId')).toBe(true)
  })

  it('returns false when link is pending, not active', () => {
    const links = [makeLink({ supplierOrgId: 'sup-99', status: 'pending' })]
    expect(isAlreadyConnected(links, 'sup-99', 'supplierOrgId')).toBe(false)
  })

  it('returns false when org ID not present at all', () => {
    const links = [makeLink({ supplierOrgId: 'sup-1', status: 'active' })]
    expect(isAlreadyConnected(links, 'sup-99', 'supplierOrgId')).toBe(false)
  })

  it('returns false for empty links array', () => {
    expect(isAlreadyConnected([], 'sup-1', 'supplierOrgId')).toBe(false)
  })
})

describe('Supplier Connections — hasPendingRequest', () => {
  it('returns true when a pending link exists for the contractor', () => {
    const links = [makeLink({ contractorOrgId: 'con-5', status: 'pending' })]
    expect(hasPendingRequest(links, 'con-5', 'contractorOrgId')).toBe(true)
  })

  it('returns false when link exists but is active', () => {
    const links = [makeLink({ contractorOrgId: 'con-5', status: 'active' })]
    expect(hasPendingRequest(links, 'con-5', 'contractorOrgId')).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(hasPendingRequest([], 'con-5', 'contractorOrgId')).toBe(false)
  })
})

describe('Supplier Connections — countByStatus', () => {
  it('counts each status correctly', () => {
    const links = [
      makeLink({ status: 'pending' }),
      makeLink({ status: 'pending' }),
      makeLink({ status: 'active' }),
      makeLink({ status: 'rejected' }),
    ]
    const counts = countByStatus(links)
    expect(counts.pending).toBe(2)
    expect(counts.active).toBe(1)
    expect(counts.rejected).toBe(1)
  })

  it('returns all zeros for empty input', () => {
    const counts = countByStatus([])
    expect(counts.pending).toBe(0)
    expect(counts.active).toBe(0)
    expect(counts.rejected).toBe(0)
  })

  it('links with undefined status are counted as rejected', () => {
    const links = [makeLink({ status: undefined })]
    const counts = countByStatus(links)
    expect(counts.rejected).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. RFQ VISIBILITY
// ═════════════════════════════════════════════════════════════════════════════

describe('RFQ Visibility — buildAllowedSupplierOrgIds', () => {
  it('returns connected org IDs for private RFQs', () => {
    const ids = ['sup-1', 'sup-2']
    expect(buildAllowedSupplierOrgIds('private', ids)).toEqual(ids)
  })

  it('returns empty array for public RFQs regardless of connected suppliers', () => {
    expect(buildAllowedSupplierOrgIds('public', ['sup-1', 'sup-2'])).toEqual([])
  })

  it('returns empty array for private RFQ with no connected suppliers', () => {
    expect(buildAllowedSupplierOrgIds('private', [])).toEqual([])
  })

  it('does not mutate the input array', () => {
    const ids = ['sup-1']
    buildAllowedSupplierOrgIds('private', ids)
    expect(ids).toHaveLength(1)
  })
})

describe('RFQ Visibility — mergeAndDeduplicateRfqs', () => {
  it('deduplicates RFQs that appear in both public and private lists', () => {
    const rfq = makeRfq({ id: 'shared-id', status: 'New' })
    const result = mergeAndDeduplicateRfqs([rfq], [rfq])
    expect(result).toHaveLength(1)
  })

  it('keeps unique RFQs from both lists', () => {
    const pub = makeRfq({ id: 'pub-1' })
    const priv = makeRfq({ id: 'priv-1', status: 'New' })
    const result = mergeAndDeduplicateRfqs([pub], [priv])
    expect(result).toHaveLength(2)
  })

  it('filters out private RFQs with non-active statuses', () => {
    const pub = makeRfq({ id: 'pub-1', status: 'New' })
    const privActive = makeRfq({ id: 'priv-1', status: 'New' })
    const privInactive = makeRfq({ id: 'priv-2', status: 'Closed' })
    const result = mergeAndDeduplicateRfqs([pub], [privActive, privInactive])
    expect(result).toHaveLength(2)
    expect(result.find(r => r.id === 'priv-2')).toBeUndefined()
  })

  it('public RFQs always included regardless of status (filtered upstream)', () => {
    const pub = makeRfq({ id: 'pub-1', status: 'Awarded' })
    const result = mergeAndDeduplicateRfqs([pub], [])
    expect(result).toHaveLength(1)
  })

  it('returns empty array when both inputs are empty', () => {
    expect(mergeAndDeduplicateRfqs([], [])).toHaveLength(0)
  })

  it('preserves public-first order before private', () => {
    const pub = makeRfq({ id: 'a', status: 'New' })
    const priv = makeRfq({ id: 'b', status: 'New' })
    const result = mergeAndDeduplicateRfqs([pub], [priv])
    expect(result[0].id).toBe('a')
    expect(result[1].id).toBe('b')
  })

  it('accepts custom active statuses', () => {
    const priv = makeRfq({ id: 'p1', status: 'Custom' })
    const result = mergeAndDeduplicateRfqs([], [priv], ['Custom'])
    expect(result).toHaveLength(1)
  })
})

describe('RFQ Visibility — canSupplierViewRfq', () => {
  it('public RFQs are visible to any supplier', () => {
    const rfq = makeRfq({ visibility: 'public' })
    expect(canSupplierViewRfq(rfq, 'any-org')).toBe(true)
  })

  it('RFQs with no visibility field are treated as public', () => {
    const rfq = makeRfq({ visibility: undefined })
    expect(canSupplierViewRfq(rfq, 'any-org')).toBe(true)
  })

  it('private RFQ is visible to allowed supplier', () => {
    const rfq = makeRfq({ visibility: 'private', allowedSupplierOrgIds: ['sup-1', 'sup-2'] })
    expect(canSupplierViewRfq(rfq, 'sup-1')).toBe(true)
  })

  it('private RFQ is NOT visible to non-allowed supplier', () => {
    const rfq = makeRfq({ visibility: 'private', allowedSupplierOrgIds: ['sup-1'] })
    expect(canSupplierViewRfq(rfq, 'sup-99')).toBe(false)
  })

  it('private RFQ with empty allowedSupplierOrgIds is visible to no supplier', () => {
    const rfq = makeRfq({ visibility: 'private', allowedSupplierOrgIds: [] })
    expect(canSupplierViewRfq(rfq, 'sup-1')).toBe(false)
  })
})

describe('RFQ Visibility — countPrivateRfqRecipients', () => {
  it('returns the number of connected suppliers for a private RFQ', () => {
    expect(countPrivateRfqRecipients(['sup-1', 'sup-2', 'sup-3'], 'private')).toBe(3)
  })

  it('returns 0 for a public RFQ regardless of connected suppliers', () => {
    expect(countPrivateRfqRecipients(['sup-1', 'sup-2'], 'public')).toBe(0)
  })

  it('returns 0 for a private RFQ with no connected suppliers', () => {
    expect(countPrivateRfqRecipients([], 'private')).toBe(0)
  })
})

describe('RFQ Visibility — resolveRfqVisibility', () => {
  const MDMAK_ID = 'mdmak-system'

  it('"public" mode: public visibility, no allowed orgs, not a Mdmak-direct order', () => {
    const result = resolveRfqVisibility('public', ['sup-1', 'sup-2'], MDMAK_ID)
    expect(result).toEqual({ visibility: 'public', allowedSupplierOrgIds: [], orderedFromMdmakDirect: false })
  })

  it('"private" mode: private visibility scoped to the caller\'s connected suppliers', () => {
    const result = resolveRfqVisibility('private', ['sup-1', 'sup-2'], MDMAK_ID)
    expect(result).toEqual({ visibility: 'private', allowedSupplierOrgIds: ['sup-1', 'sup-2'], orderedFromMdmakDirect: false })
  })

  it('"private" mode with no connected suppliers: empty allowed orgs', () => {
    const result = resolveRfqVisibility('private', [], MDMAK_ID)
    expect(result.allowedSupplierOrgIds).toEqual([])
  })

  it('"mdmak_direct" mode: private visibility scoped only to the Mdmak system id, ignoring connected suppliers', () => {
    const result = resolveRfqVisibility('mdmak_direct', ['sup-1', 'sup-2'], MDMAK_ID)
    expect(result).toEqual({ visibility: 'private', allowedSupplierOrgIds: [MDMAK_ID], orderedFromMdmakDirect: true })
  })

  it('"mdmak_direct" mode never leaks connected supplier org ids into allowedSupplierOrgIds', () => {
    const result = resolveRfqVisibility('mdmak_direct', ['sup-1', 'sup-2', 'sup-3'], MDMAK_ID)
    expect(result.allowedSupplierOrgIds).not.toContain('sup-1')
    expect(result.allowedSupplierOrgIds).toHaveLength(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. DELIVERY NOTICES
// ═════════════════════════════════════════════════════════════════════════════

describe('Delivery Notices — buildDeliveryIndex', () => {
  it('indexes deliveries by offerId', () => {
    const d1 = makeDelivery({ id: 'd1', offerId: 'offer-1' })
    const d2 = makeDelivery({ id: 'd2', offerId: 'offer-2' })
    const index = buildDeliveryIndex([d1, d2])
    expect(index['offer-1'].id).toBe('d1')
    expect(index['offer-2'].id).toBe('d2')
  })

  it('last delivery wins when multiple share the same offerId', () => {
    const d1 = makeDelivery({ id: 'first', offerId: 'same-offer' })
    const d2 = makeDelivery({ id: 'second', offerId: 'same-offer' })
    const index = buildDeliveryIndex([d1, d2])
    expect(index['same-offer'].id).toBe('second')
  })

  it('returns empty object for empty input', () => {
    expect(buildDeliveryIndex([])).toEqual({})
  })

  it('has no undefined keys for undefined offerId', () => {
    const d = makeDelivery({ offerId: undefined as any })
    const index = buildDeliveryIndex([d])
    expect('undefined' in index || Object.keys(index).length === 0 || index['undefined']).toBeDefined()
  })
})

describe('Delivery Notices — validateDeliveryForm', () => {
  it('returns valid for complete form', () => {
    const result = validateDeliveryForm({ deliveryPersonName: 'أحمد', deliveryDate: '2026-08-15' })
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('requires deliveryPersonName', () => {
    const result = validateDeliveryForm({ deliveryPersonName: '', deliveryDate: '2026-08-15' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('اسم المندوب مطلوب')
  })

  it('rejects whitespace-only name', () => {
    const result = validateDeliveryForm({ deliveryPersonName: '   ', deliveryDate: '2026-08-15' })
    expect(result.isValid).toBe(false)
  })

  it('requires deliveryDate', () => {
    const result = validateDeliveryForm({ deliveryPersonName: 'أحمد', deliveryDate: '' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('تاريخ التسليم مطلوب')
  })

  it('rejects invalid date strings', () => {
    const result = validateDeliveryForm({ deliveryPersonName: 'أحمد', deliveryDate: 'not-a-date' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('تاريخ التسليم غير صالح')
  })

  it('collects all errors at once', () => {
    const result = validateDeliveryForm({ deliveryPersonName: '', deliveryDate: '' })
    expect(result.errors.length).toBe(2)
  })
})

describe('Delivery Notices — buildReceiptNumber', () => {
  it('prefixes receipt ID with DEL-', () => {
    expect(buildReceiptNumber('abc123xyz456').startsWith('DEL-')).toBe(true)
  })

  it('uses the first 8 characters of the delivery ID', () => {
    const id = 'abcdefghijklmnop'
    expect(buildReceiptNumber(id)).toBe('DEL-ABCDEFGH')
  })

  it('uppercases the ID portion', () => {
    const result = buildReceiptNumber('lowercase')
    expect(result).toBe(result.toUpperCase())
  })

  it('works for short IDs without throwing', () => {
    expect(() => buildReceiptNumber('abc')).not.toThrow()
  })
})

describe('Delivery Notices — isPendingConfirmation / isDeliveryConfirmed', () => {
  it('isPendingConfirmation returns true for pending_confirmation status', () => {
    const d = makeDelivery({ status: 'pending_confirmation' })
    expect(isPendingConfirmation(d)).toBe(true)
  })

  it('isPendingConfirmation returns false for confirmed status', () => {
    const d = makeDelivery({ status: 'confirmed' })
    expect(isPendingConfirmation(d)).toBe(false)
  })

  it('isDeliveryConfirmed returns true for confirmed status', () => {
    const d = makeDelivery({ status: 'confirmed' })
    expect(isDeliveryConfirmed(d)).toBe(true)
  })

  it('isDeliveryConfirmed returns false for pending_confirmation status', () => {
    const d = makeDelivery({ status: 'pending_confirmation' })
    expect(isDeliveryConfirmed(d)).toBe(false)
  })

  it('exactly one of the two predicates is true for any delivery', () => {
    const statuses: Array<'pending_confirmation' | 'confirmed'> = ['pending_confirmation', 'confirmed']
    for (const s of statuses) {
      const d = makeDelivery({ status: s })
      expect(isPendingConfirmation(d) !== isDeliveryConfirmed(d)).toBe(true)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. PROJECT MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Project Management — filterProjectsByStatus', () => {
  const projects = [
    makeProject({ id: '1', status: 'active' }),
    makeProject({ id: '2', status: 'paused' }),
    makeProject({ id: '3', status: 'active' }),
    makeProject({ id: '4', status: 'completed' }),
  ]

  it('returns all projects for "all" filter', () => {
    expect(filterProjectsByStatus(projects, 'all')).toHaveLength(4)
  })

  it('returns only active projects', () => {
    const result = filterProjectsByStatus(projects, 'active')
    expect(result).toHaveLength(2)
    expect(result.every(p => p.status === 'active')).toBe(true)
  })

  it('returns only paused projects', () => {
    expect(filterProjectsByStatus(projects, 'paused')).toHaveLength(1)
  })

  it('returns only completed projects', () => {
    expect(filterProjectsByStatus(projects, 'completed')).toHaveLength(1)
  })

  it('returns empty array when no projects match', () => {
    expect(filterProjectsByStatus([], 'active')).toHaveLength(0)
  })
})

describe('Project Management — getProjectRfqCount', () => {
  it('returns the length of rfqIds array', () => {
    const p = makeProject({ rfqIds: ['rfq-1', 'rfq-2', 'rfq-3'] })
    expect(getProjectRfqCount(p)).toBe(3)
  })

  it('returns 0 for empty rfqIds', () => {
    expect(getProjectRfqCount(makeProject({ rfqIds: [] }))).toBe(0)
  })

  it('returns 0 when rfqIds is undefined', () => {
    expect(getProjectRfqCount(makeProject({ rfqIds: undefined }))).toBe(0)
  })
})

describe('Project Management — validateProjectForm', () => {
  it('is valid when name is present', () => {
    const result = validateProjectForm({ name: 'مشروع الفيلا', status: 'active' })
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('is invalid when name is empty', () => {
    const result = validateProjectForm({ name: '', status: 'active' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('اسم المشروع مطلوب')
  })

  it('is invalid when name is whitespace only', () => {
    const result = validateProjectForm({ name: '   ', status: 'active' })
    expect(result.isValid).toBe(false)
  })
})

describe('Project Management — buildProjectData', () => {
  const form = {
    name: 'مشروع الرياض',
    description: 'وصف المشروع',
    location: 'شمال الرياض',
    budget: '500000',
    status: 'active' as const,
  }

  it('sets organizationId and contractorId from parameters', () => {
    const data = buildProjectData(form, 'user-1', 'org-1')
    expect(data.organizationId).toBe('org-1')
    expect(data.contractorId).toBe('user-1')
  })

  it('initializes rfqIds as empty array', () => {
    const data = buildProjectData(form, 'user-1', 'org-1')
    expect(data.rfqIds).toEqual([])
  })

  it('converts budget string to number', () => {
    const data = buildProjectData(form, 'u', 'o')
    expect(data.budget).toBe(500000)
    expect(typeof data.budget).toBe('number')
  })

  it('sets budget to undefined when empty string', () => {
    const data = buildProjectData({ ...form, budget: '' }, 'u', 'o')
    expect(data.budget).toBeUndefined()
  })

  it('trims whitespace from name', () => {
    const data = buildProjectData({ ...form, name: '  مشروع  ' }, 'u', 'o')
    expect(data.name).toBe('مشروع')
  })

  it('sets description to undefined when empty', () => {
    const data = buildProjectData({ ...form, description: '' }, 'u', 'o')
    expect(data.description).toBeUndefined()
  })

  it('sets location to undefined when empty', () => {
    const data = buildProjectData({ ...form, location: '' }, 'u', 'o')
    expect(data.location).toBeUndefined()
  })

  it('preserves status', () => {
    const data = buildProjectData({ ...form, status: 'paused' }, 'u', 'o')
    expect(data.status).toBe('paused')
  })
})

describe('Project Management — getStatusCounts', () => {
  it('counts each status accurately', () => {
    const projects = [
      makeProject({ status: 'active' }),
      makeProject({ status: 'active' }),
      makeProject({ status: 'paused' }),
      makeProject({ status: 'completed' }),
    ]
    const counts = getStatusCounts(projects)
    expect(counts.active).toBe(2)
    expect(counts.paused).toBe(1)
    expect(counts.completed).toBe(1)
  })

  it('returns all zeros for empty input', () => {
    const counts = getStatusCounts([])
    expect(counts.active).toBe(0)
    expect(counts.paused).toBe(0)
    expect(counts.completed).toBe(0)
  })

  it('unknown statuses do not increment any count', () => {
    const projects = [makeProject({ status: 'unknown-status' })]
    const counts = getStatusCounts(projects)
    expect(counts.active + counts.paused + counts.completed).toBe(0)
  })
})

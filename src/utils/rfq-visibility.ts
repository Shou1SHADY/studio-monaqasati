export type RfqVisibility = 'public' | 'private'

export type VisibilityRfq = {
  id: string
  status?: string
  visibility?: string
  allowedSupplierOrgIds?: string[]
  category?: string
  [key: string]: unknown
}

/** Returns the allowedSupplierOrgIds to store based on visibility. */
export function buildAllowedSupplierOrgIds(visibility: RfqVisibility, connectedOrgIds: string[]): string[] {
  return visibility === 'private' ? [...connectedOrgIds] : []
}

/**
 * Merges public RFQs with private RFQs (those explicitly shared via
 * allowedSupplierOrgIds), deduplicates by id, and filters private RFQs
 * to only active statuses.
 */
export function mergeAndDeduplicateRfqs(
  publicRfqs: VisibilityRfq[],
  privateRfqs: VisibilityRfq[],
  activeStatuses: string[] = ['New', 'Awarded']
): VisibilityRfq[] {
  const filtered = privateRfqs.filter(r => activeStatuses.includes(r.status ?? ''))
  const combined = [...publicRfqs, ...filtered]
  const seen = new Set<string>()
  return combined.filter(rfq => {
    if (seen.has(rfq.id)) return false
    seen.add(rfq.id)
    return true
  })
}

/**
 * Returns true if a supplier with the given orgId can view the RFQ.
 * Public RFQs are visible to all; private ones only to listed org IDs.
 */
export function canSupplierViewRfq(rfq: VisibilityRfq, supplierOrgId: string): boolean {
  if (!rfq.visibility || rfq.visibility === 'public') return true
  return (rfq.allowedSupplierOrgIds ?? []).includes(supplierOrgId)
}

/** Counts how many connected suppliers will receive a private RFQ. */
export function countPrivateRfqRecipients(connectedOrgIds: string[], visibility: RfqVisibility): number {
  return visibility === 'private' ? connectedOrgIds.length : 0
}

export type RfqVisibilityMode = 'public' | 'private' | 'mdmak_direct'

export interface RfqVisibilityResolution {
  visibility: RfqVisibility
  allowedSupplierOrgIds: string[]
  orderedFromMdmakDirect: boolean
}

/**
 * "mdmak_direct" reuses the existing private-RFQ mechanism (allowedSupplierOrgIds) rather
 * than a new visibility value — it stores as a private RFQ scoped to a single "supplier"
 * org (Mdmak's system id), so no new Firestore rules or supplier-query changes are needed:
 * real suppliers already can't see private RFQs they're not listed in allowedSupplierOrgIds for.
 */
export function resolveRfqVisibility(
  mode: RfqVisibilityMode,
  connectedSupplierOrgIds: string[],
  mdmakContractorId: string
): RfqVisibilityResolution {
  if (mode === 'mdmak_direct') {
    return { visibility: 'private', allowedSupplierOrgIds: [mdmakContractorId], orderedFromMdmakDirect: true }
  }
  if (mode === 'private') {
    return { visibility: 'private', allowedSupplierOrgIds: [...connectedSupplierOrgIds], orderedFromMdmakDirect: false }
  }
  return { visibility: 'public', allowedSupplierOrgIds: [], orderedFromMdmakDirect: false }
}

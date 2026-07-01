export type SupplierLink = {
  id: string
  contractorOrgId?: string
  supplierOrgId?: string
  supplierName?: string
  status?: string
  categories?: string[]
  requestedAt?: unknown
  connectedAt?: unknown
  requestedBy?: string
}

export type LinkStatus = 'pending' | 'active' | 'rejected'

export function filterLinksByStatus(links: SupplierLink[], status: LinkStatus): SupplierLink[] {
  return links.filter(l => l.status === status)
}

/** Returns org IDs of all non-rejected counterparts the caller is linked to. */
export function getLinkedOrgIds(links: SupplierLink[], field: 'contractorOrgId' | 'supplierOrgId'): Set<string> {
  const ids = new Set<string>()
  for (const link of links) {
    if (link.status !== 'rejected' && link[field]) {
      ids.add(link[field]!)
    }
  }
  return ids
}

export function isAlreadyConnected(links: SupplierLink[], orgId: string, field: 'contractorOrgId' | 'supplierOrgId'): boolean {
  return links.some(l => l.status === 'active' && l[field] === orgId)
}

export function hasPendingRequest(links: SupplierLink[], orgId: string, field: 'contractorOrgId' | 'supplierOrgId'): boolean {
  return links.some(l => l.status === 'pending' && l[field] === orgId)
}

export function countByStatus(links: SupplierLink[]): Record<LinkStatus, number> {
  const counts: Record<LinkStatus, number> = { pending: 0, active: 0, rejected: 0 }
  for (const link of links) {
    const s = (link.status ?? 'rejected') as LinkStatus
    if (s in counts) counts[s]++
  }
  return counts
}

export type DeliveryFormFields = {
  deliveryPersonName: string
  deliveryDate: string
}

export type ValidationResult = {
  isValid: boolean
  errors: string[]
}

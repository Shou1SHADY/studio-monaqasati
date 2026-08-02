export interface ContractorRow {
  id: string
  name: string
  contact: string
  email: string
  city: string
  crNumber: string
  taxNumber: string
  verified: boolean
  verificationRequested: boolean
  rfqCount: number
}

export type ContractorStatusFilter = 'all' | 'verified' | 'pending' | 'review'

export function filterContractorsByStatus<T extends ContractorRow>(contractors: T[], filter: ContractorStatusFilter): T[] {
  if (filter === 'all') return contractors
  if (filter === 'verified') return contractors.filter(c => c.verified)
  if (filter === 'pending') return contractors.filter(c => !c.verified && c.verificationRequested)
  return contractors.filter(c => !c.verified && !c.verificationRequested)
}

export function filterContractorsByCity<T extends ContractorRow>(contractors: T[], city: string): T[] {
  if (city === 'all') return contractors
  return contractors.filter(c => c.city === city)
}

export function searchContractors<T extends ContractorRow>(contractors: T[], query: string): T[] {
  if (!query.trim()) return contractors
  const q = query.trim().toLowerCase()
  return contractors.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.email.toLowerCase().includes(q) ||
    c.contact.toLowerCase().includes(q) ||
    c.city.toLowerCase().includes(q) ||
    c.crNumber.toLowerCase().includes(q) ||
    c.taxNumber.toLowerCase().includes(q) ||
    String(c.rfqCount).includes(q)
  )
}

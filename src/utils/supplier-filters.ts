export interface SupplierRow {
  id: string
  name: string
  contact: string
  email: string
  city: string
  crNumber: string
  taxNumber: string
  category: string
  specializations: string[]
  verified: boolean
  verificationRequested: boolean
}

export type SupplierStatusFilter = 'all' | 'verified' | 'pending' | 'review'

export function filterSuppliersByStatus<T extends SupplierRow>(suppliers: T[], filter: SupplierStatusFilter): T[] {
  if (filter === 'all') return suppliers
  if (filter === 'verified') return suppliers.filter(s => s.verified)
  if (filter === 'pending') return suppliers.filter(s => !s.verified && s.verificationRequested)
  return suppliers.filter(s => !s.verified && !s.verificationRequested)
}

export function filterSuppliersByCity<T extends SupplierRow>(suppliers: T[], city: string): T[] {
  if (city === 'all') return suppliers
  return suppliers.filter(s => s.city === city)
}

export function filterSuppliersBySpecialization<T extends SupplierRow>(suppliers: T[], specialization: string): T[] {
  if (specialization === 'all') return suppliers
  return suppliers.filter(s => s.specializations.includes(specialization))
}

export function searchSuppliers<T extends SupplierRow>(suppliers: T[], query: string): T[] {
  if (!query.trim()) return suppliers
  const q = query.trim().toLowerCase()
  return suppliers.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.email.toLowerCase().includes(q) ||
    s.contact.toLowerCase().includes(q) ||
    s.city.toLowerCase().includes(q) ||
    s.crNumber.toLowerCase().includes(q) ||
    s.taxNumber.toLowerCase().includes(q) ||
    s.specializations.some(spec => spec.toLowerCase().includes(q))
  )
}

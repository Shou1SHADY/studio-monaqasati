export interface Rfq {
  id: string
  title: string
  category: string
  city: string
  deadline?: string
  createdAt: string
}

export type DeadlineFilter = 'all' | 'week' | 'month' | 'custom'

export function filterRfqsByDeadline(rfqs: Rfq[], filter: DeadlineFilter, now?: string, customDate?: string): Rfq[] {
  if (filter === 'all') return rfqs
  
  const currentDate = new Date(now || new Date().toISOString())
  
  return rfqs.filter(rfq => {
    if (!rfq.deadline) return true
    
    const deadline = new Date(rfq.deadline)
    const diffTime = deadline.getTime() - currentDate.getTime()
    const diffDays = diffTime / (1000 * 60 * 60 * 24)
    
    if (filter === 'week') {
      return diffDays <= 7 && diffDays >= 0
    }
    if (filter === 'month') {
      return diffDays <= 30 && diffDays >= 0
    }
    if (filter === 'custom' && customDate) {
      const custom = new Date(customDate)
      return deadline <= custom
    }
    return true
  })
}

export function filterRfqsByCategory(rfqs: Rfq[], category: string): Rfq[] {
  if (category === 'all') return rfqs
  return rfqs.filter(rfq => rfq.category === category)
}

export function filterRfqsByCity(rfqs: Rfq[], city: string): Rfq[] {
  if (city === 'all') return rfqs
  return rfqs.filter(rfq => rfq.city === city)
}

export function sortRfqsByDate(rfqs: Rfq[], order: 'asc' | 'desc' = 'desc'): Rfq[] {
  return [...rfqs].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return order === 'desc' ? dateB - dateA : dateA - dateB
  })
}

export function searchRfqs(rfqs: Rfq[], query: string): Rfq[] {
  if (!query.trim()) return rfqs
  const q = query.toLowerCase()
  return rfqs.filter(rfq => 
    rfq.title.toLowerCase().includes(q) ||
    rfq.category.toLowerCase().includes(q) ||
    rfq.city.toLowerCase().includes(q)
  )
}
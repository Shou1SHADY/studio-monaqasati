export interface Inquiry {
  question: string
  supplierId: string
  supplierName: string
  createdAt: string
  reply?: string | null
  repliedAt?: string | null
}

export function formatInquiryTimestamp(timestamp: string, locale: string = 'ar-SA'): string {
  const date = new Date(timestamp)
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function isInquiryReplied(inquiry: Inquiry): boolean {
  return !!inquiry.reply && !!inquiry.repliedAt
}

export type InquiryStatus = 'مجابة' | 'في انتظار الرد'

export function getInquiryStatus(inquiry: Inquiry): InquiryStatus {
  return isInquiryReplied(inquiry) ? 'مجابة' : 'في انتظار الرد'
}

export function getTimeAgo(timestamp: string): string {
  const now = new Date()
  const date = new Date(timestamp)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffMins < 1) return 'الآن'
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`
  if (diffHours < 24) return `منذ ${diffHours} ساعة`
  if (diffDays < 7) return `منذ ${diffDays} يوم`
  
  return formatInquiryTimestamp(timestamp)
}

export function filterInquiriesBySupplier(inquiries: Inquiry[], supplierId: string): Inquiry[] {
  return inquiries.filter(inq => inq.supplierId === supplierId)
}

export function sortInquiriesByDate(inquiries: Inquiry[], order: 'asc' | 'desc' = 'desc'): Inquiry[] {
  return [...inquiries].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return order === 'desc' ? dateB - dateA : dateA - dateB
  })
}
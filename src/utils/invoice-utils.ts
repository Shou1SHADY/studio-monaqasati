export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue"

export type InvoiceItem = {
  description: string
  quantity: number
  unitPrice: number
}

export function calculateInvoiceTotal(items: InvoiceItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
}

export function calculateVat(total: number, ratePercent: number = 15): number {
  return Math.round(total * ratePercent / 100)
}

export function calculateGrandTotal(total: number, ratePercent: number = 15): number {
  return total + calculateVat(total, ratePercent)
}

export function formatInvoiceNumber(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(4, "0")}`
}

export function isInvoiceOverdue(dueDate: string, status: InvoiceStatus): boolean {
  if (status === "paid") return false
  return new Date(dueDate) < new Date()
}

export function resolveInvoiceStatus(dueDate: string, currentStatus: InvoiceStatus): InvoiceStatus {
  if (currentStatus === "paid" || currentStatus === "draft") return currentStatus
  if (isInvoiceOverdue(dueDate, currentStatus)) return "overdue"
  return currentStatus
}

export function getInvoiceStatusVariant(status: InvoiceStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paid": return "default"
    case "sent": return "secondary"
    case "overdue": return "destructive"
    default: return "outline"
  }
}

export function formatCurrency(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function generateInvoiceNumber(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return `INV-${year}${month}-${rand}`
}

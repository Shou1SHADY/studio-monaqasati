export type BoqItem = {
  id: string
  itemNo: string
  description: string
  quantity: string
  unit: string
  unitPrice: string
  rfqId?: string
}

export type BoqValidationResult = {
  isValid: boolean
  errors: string[]
}

export function calcRowTotal(item: Pick<BoqItem, 'quantity' | 'unitPrice'>): number {
  const qty = Number(item.quantity)
  const price = Number(item.unitPrice)
  if (!isFinite(qty) || !isFinite(price)) return 0
  return qty * price
}

export function calcBoqGrandTotal(items: BoqItem[]): number {
  return items.reduce((sum, item) => sum + calcRowTotal(item), 0)
}

export function validateBoqItem(item: Partial<BoqItem>): BoqValidationResult {
  const errors: string[] = []
  if (!item.description?.trim()) errors.push('الوصف مطلوب')
  const qty = Number(item.quantity)
  if (!item.quantity || !isFinite(qty) || qty < 0) errors.push('الكمية غير صالحة')
  if (!item.unit?.trim()) errors.push('الوحدة مطلوبة')
  return { isValid: errors.length === 0, errors }
}

export function filterBoqByRfq(items: BoqItem[], rfqId: string): BoqItem[] {
  return items.filter((item) => item.rfqId === rfqId)
}

export function parseBoqRow(row: unknown[], rowIndex: number): BoqItem {
  const cells = row as Array<string | number | null | undefined>
  return {
    id: `parsed_${rowIndex}`,
    itemNo: String(cells[0] ?? rowIndex + 1),
    description: String(cells[1] ?? ''),
    quantity: String(cells[2] ?? ''),
    unit: String(cells[3] ?? ''),
    unitPrice: String(cells[4] ?? ''),
    rfqId: '',
  }
}

export function parseBoqSheet(rows: unknown[][]): BoqItem[] {
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== '' && cell !== null && cell !== undefined))
    .map((row, i) => parseBoqRow(row, i))
}

export function buildBoqStoragePayload(item: BoqItem): Record<string, unknown> {
  return {
    itemNo: item.itemNo,
    description: item.description,
    quantity: Number(item.quantity) || 0,
    unit: item.unit,
    unitPrice: Number(item.unitPrice) || 0,
    rfqId: item.rfqId || null,
  }
}

export function reorderItemNos(items: BoqItem[]): BoqItem[] {
  return items.map((item, i) => ({ ...item, itemNo: String(i + 1) }))
}

export function getBoqSummary(items: BoqItem[]): { count: number; total: number; linkedCount: number } {
  return {
    count: items.length,
    total: calcBoqGrandTotal(items),
    linkedCount: items.filter((item) => !!item.rfqId).length,
  }
}

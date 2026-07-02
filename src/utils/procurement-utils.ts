export type ProcurementMaterial = {
  id: string
  name: string
  nameEn?: string
  unit: string
  refPrice: number
  totalQtyUsed?: number
  category?: string
}

export function filterMaterials(
  materials: ProcurementMaterial[],
  search: string,
  category: string
): ProcurementMaterial[] {
  const q = search.toLowerCase().trim()
  return materials.filter((m) => {
    const matchesSearch =
      !q ||
      m.name.toLowerCase().includes(q) ||
      (m.nameEn ?? '').toLowerCase().includes(q)
    const matchesCat = !category || m.category === category
    return matchesSearch && matchesCat
  })
}

export function getUniqueCategories(materials: ProcurementMaterial[]): string[] {
  const seen = new Set<string>()
  for (const m of materials) {
    if (m.category) seen.add(m.category)
  }
  return Array.from(seen).sort()
}

export function buildBoqRowFromMaterial(
  material: ProcurementMaterial,
  existingCount: number
): { itemNo: string; description: string; unit: string; unitPrice: string; quantity: string } {
  return {
    itemNo: String(existingCount + 1),
    description: material.name,
    unit: material.unit,
    unitPrice: String(material.refPrice),
    quantity: '',
  }
}

export function sortMaterialsByPrice(
  materials: ProcurementMaterial[],
  direction: 'asc' | 'desc' = 'asc'
): ProcurementMaterial[] {
  return [...materials].sort((a, b) =>
    direction === 'asc' ? a.refPrice - b.refPrice : b.refPrice - a.refPrice
  )
}

export function getMostUsedMaterials(
  materials: ProcurementMaterial[],
  limit = 5
): ProcurementMaterial[] {
  return [...materials]
    .filter((m) => (m.totalQtyUsed ?? 0) > 0)
    .sort((a, b) => (b.totalQtyUsed ?? 0) - (a.totalQtyUsed ?? 0))
    .slice(0, limit)
}

export function buildAttachmentStoragePath(deliveryId: string, filename: string): string {
  return `deliveries/${deliveryId}/attachments/${filename}`
}

export function getAttachmentLabel(index: number, locale: 'ar' | 'en'): string {
  return locale === 'ar' ? `مستند ${index + 1}` : `Document ${index + 1}`
}

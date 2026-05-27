export interface Product {
  id: string
  name: string
  quantity: string
  unit: string
  description: string
}

export function addProduct(products: Product[]): Product[] {
  return [...products, { id: Date.now().toString(), name: '', quantity: '', unit: '', description: '' }]
}

export function removeProduct(products: Product[], id: string): Product[] {
  if (products.length <= 1) return products
  return products.filter(p => p.id !== id)
}

export function updateProduct(products: Product[], id: string, field: keyof Product, value: string): Product[] {
  return products.map(p => p.id === id ? { ...p, [field]: value } : p)
}

export interface ValidationResult {
  isValid: boolean
  validProducts: Product[]
  errors: string[]
}

export function validateProducts(
  products: Product[],
  t?: (key: string) => string
): ValidationResult {
  const errors: string[] = []
  const validProducts = products.filter(p => p.name && p.quantity && p.unit)
  
  if (products.length === 0) {
    errors.push(t ? t('rfq_validation_add_product') : 'يجب إضافة منتج واحد على الأقل')
  }
  
  if (validProducts.length === 0 && products.length > 0) {
    errors.push(t ? t('rfq_validation_complete_data') : 'يرجى إكمال بيانات المنتجات المطلوبة')
  }
  
  return {
    isValid: errors.length === 0 && validProducts.length > 0,
    validProducts,
    errors
  }
}

export interface TotalQuantity {
  total: number
  unit: string
}

export function calculateTotalQuantity(products: Product[]): TotalQuantity {
  const total = products.reduce((sum, p) => sum + (parseFloat(p.quantity) || 0), 0)
  const units = [...new Set(products.map(p => p.unit).filter(Boolean))].join('، ')
  return { total, unit: units }
}

export function formatProductsForDisplay(products: Product[]): string {
  return products.map(p => `${p.name} (${p.quantity} ${p.unit})`).join(' | ')
}
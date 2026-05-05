export interface DeliveryBatch {
  location: string
  deliveryDate: string
  price: string
}

export interface Offer {
  price: number
  deliveryMethod: string
  deliveryFrequency: string
  isFreeShipping: boolean
  includesSample: boolean
  deliveryBatches?: DeliveryBatch[]
}

export function calculateOfferTotal(batches: DeliveryBatch[] | undefined): number {
  if (!batches || batches.length === 0) return 0
  return batches.reduce((sum, b) => sum + (parseFloat(b.price) || 0), 0)
}

export interface BatchValidationResult {
  isValid: boolean
  errors: string[]
}

export function validateOfferBatches(batches: DeliveryBatch[]): BatchValidationResult {
  const errors: string[] = []
  
  if (!batches || batches.length === 0) {
    errors.push('يرجى إضافة شحنة واحدة على الأقل')
    return { isValid: false, errors }
  }
  
  const incompleteBatches = batches.filter(b => !b.location || !b.deliveryDate || !b.price)
  if (incompleteBatches.length > 0) {
    errors.push('يرجى إكمال بيانات جميع الشحنات')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

export function formatOfferSummary(offer: Offer): string {
  let summary = `السعر: ${offer.price.toLocaleString('ar-SA')} ر.س`
  summary += ` | الطريقة: ${offer.deliveryMethod}`
  summary += ` | الوتيرة: ${offer.deliveryFrequency}`
  
  if (offer.isFreeShipping) {
    summary += ' | توصيل مجاني'
  }
  if (offer.includesSample) {
    summary += ' | يتضمن عينة'
  }
  
  return summary
}
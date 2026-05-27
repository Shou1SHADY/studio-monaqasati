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

export function validateOfferBatches(
  batches: DeliveryBatch[],
  t?: (key: string) => string
): BatchValidationResult {
  const errors: string[] = []
  
  if (!batches || batches.length === 0) {
    errors.push(t ? t('offer_validation_add_batch') : 'يرجى إضافة شحنة واحدة على الأقل')
    return { isValid: false, errors }
  }
  
  const incompleteBatches = batches.filter(b => !b.location || !b.deliveryDate || !b.price)
  if (incompleteBatches.length > 0) {
    errors.push(t ? t('offer_validation_complete_batches') : 'يرجى إكمال بيانات جميع الشحنات')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

export function formatOfferSummary(offer: Offer, locale: string = 'ar'): string {
  const isAr = locale.startsWith('ar')
  const localeStr = isAr ? 'ar-SA' : 'en-US'
  let summary = isAr
    ? `السعر: ${offer.price.toLocaleString(localeStr)} ر.س`
    : `Price: SAR ${offer.price.toLocaleString(localeStr)}`
  summary += isAr ? ` | الطريقة: ${offer.deliveryMethod}` : ` | Method: ${offer.deliveryMethod}`
  summary += isAr ? ` | الوتيرة: ${offer.deliveryFrequency}` : ` | Frequency: ${offer.deliveryFrequency}`
  
  if (offer.isFreeShipping) {
    summary += isAr ? ' | توصيل مجاني' : ' | Free Shipping'
  }
  if (offer.includesSample) {
    summary += isAr ? ' | يتضمن عينة' : ' | Includes Sample'
  }
  
  return summary
}
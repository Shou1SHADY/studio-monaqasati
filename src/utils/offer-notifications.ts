/**
 * Pure utility functions for offer and notification logic.
 * These are framework-agnostic and fully testable.
 */

export interface OfferData {
  supplierId: string
  organizationId: string
  supplierName: string
  companyName: string
  supplierWebsite?: string | null
  submittedByUserId: string
  submittedByUserName: string
  rfqId: string
  rfqTitle: string
  contractorId: string | null
  contractorOrgId: string | null
  price: string
  deliveryLocation?: string
  deliveryBatches?: Array<{
    location?: string
    deliveryDate: string
    price: string
  }>
  executionDuration?: string
  executionDurationUnit?: string
  offerPdfUrl?: string
  status: string
  createdAt: string
}

export interface NotificationPayload {
  userId: string
  organizationId: string
  type: string
  title: string
  message: string
  offerId: string | null
  rfqId: string
  createdAt: string
  read: boolean
}

/**
 * Builds the contractor notification payload when a supplier submits an offer.
 */
export function buildOfferNotification(
  offer: Pick<OfferData, 'rfqId' | 'rfqTitle' | 'contractorId' | 'contractorOrgId' | 'price'>,
  supplierName: string
): NotificationPayload | null {
  if (!offer.contractorId) return null

  return {
    userId: offer.contractorId,
    organizationId: offer.contractorOrgId || offer.contractorId,
    type: 'new_offer',
    title: 'عرض سعر جديد',
    message: `قدم المورد ${supplierName} عرضاً بمبلغ ${Number(offer.price).toLocaleString('ar-SA')} ر.س على مناقصة: ${offer.rfqTitle}`,
    offerId: null,
    rfqId: offer.rfqId,
    createdAt: new Date().toISOString(),
    read: false,
  }
}

/**
 * Builds the contractor notification payload when a supplier marks a sample as sent.
 */
export function buildSampleSentNotification(
  offerId: string,
  rfqId: string,
  rfqTitle: string,
  contractorId: string,
  contractorOrgId?: string
): NotificationPayload {
  return {
    userId: contractorId,
    organizationId: contractorOrgId || contractorId,
    type: 'sample_sent',
    title: '📦 تم إرسال العينة من المورد',
    message: `قام المورد بإرسال العينة لمناقصة: ${rfqTitle}. يرجى تأكيد الاستلام.`,
    offerId: offerId,
    rfqId: rfqId,
    createdAt: new Date().toISOString(),
    read: false,
  }
}

/**
 * Validates that an offer price is valid (positive number).
 */
export function validateOfferPrice(
  price: string,
  t?: (key: string) => string
): { isValid: boolean; error?: string } {
  if (!price || price.trim() === '') {
    return { isValid: false, error: t ? t('offer_validation_enter_price') : 'يرجى إدخال السعر الإجمالي' }
  }
  const parsed = parseFloat(price)
  if (isNaN(parsed) || parsed <= 0) {
    return { isValid: false, error: t ? t('offer_validation_price_positive') : 'يجب أن يكون السعر رقماً موجباً' }
  }
  return { isValid: true }
}

/**
 * Determines if the offer form is submittable (all required fields present).
 */
export function isOfferSubmittable(price: string, isSubmitting: boolean, isUploadingPdf: boolean): boolean {
  return Boolean(price) && !isSubmitting && !isUploadingPdf && validateOfferPrice(price).isValid
}

/**
 * Notification titles/messages stored in Firestore are in Arabic (data values).
 * The UI display translation is handled in Portal.Layout notification rendering.
 * Builds the complete offer data object for Firestore submission.
 */
export function buildOfferData(params: {
  userId: string
  organizationId: string
  profileName: string
  companyName: string
  website: string | null
  rfqId: string
  rfqTitle: string
  contractorId: string | null
  contractorOrgId: string | null
  price: string
  deliveryLocation: string
  executionDuration: string
  executionDurationUnit: string
  offerPdfUrl: string | null
}): OfferData {
  const base: OfferData = {
    supplierId: params.userId,
    organizationId: params.organizationId,
    supplierName: params.profileName || 'مورد',
    companyName: params.companyName || '',
    supplierWebsite: params.website || null,
    submittedByUserId: params.userId,
    submittedByUserName: params.profileName || 'عضو الفريق',
    rfqId: params.rfqId,
    rfqTitle: params.rfqTitle,
    contractorId: params.contractorId,
    contractorOrgId: params.contractorOrgId,
    price: params.price,
    deliveryLocation: params.deliveryLocation,
    status: 'قيد المراجعة',
    createdAt: new Date().toISOString(),
  }

  if (params.executionDuration) {
    base.executionDuration = params.executionDuration
    base.executionDurationUnit = params.executionDurationUnit
  }
  if (params.offerPdfUrl) {
    base.offerPdfUrl = params.offerPdfUrl
  }

  return base
}

/**
 * Resolves the website URL: uses provided value or falls back to profile website.
 */
export function resolveWebsiteUrl(supplierWebsite: string, profileWebsite?: string): string {
  if (supplierWebsite && supplierWebsite.trim() !== '') return supplierWebsite.trim()
  if (profileWebsite && profileWebsite.trim() !== '') return profileWebsite.trim()
  return ''
}

/**
 * Checks if offers query should use supplierId (always available) vs organizationId.
 * supplierId is always set at offer submission time, so it's the reliable field.
 */
export function getOffersQueryField(): 'supplierId' {
  return 'supplierId'
}

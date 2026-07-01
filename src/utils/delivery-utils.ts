export type DeliveryStatus = 'pending_confirmation' | 'confirmed'

export type Delivery = {
  id: string
  offerId: string
  status: DeliveryStatus
  deliveryPersonName?: string
  deliveryDate?: string
  receivedByName?: string
  confirmedAt?: unknown
  notes?: string
  rfqTitle?: string
  supplierName?: string
  rfqId?: string
  contractorOrgId?: string
  supplierOrgId?: string
}

export type DeliveryFormFields = {
  deliveryPersonName: string
  deliveryDate: string
  notes?: string
}

export type ValidationResult = {
  isValid: boolean
  errors: string[]
}

/** Build a lookup map from offerId → Delivery for O(1) access in the UI. */
export function buildDeliveryIndex(deliveries: Delivery[]): Record<string, Delivery> {
  const index: Record<string, Delivery> = {}
  for (const d of deliveries) {
    index[d.offerId] = d
  }
  return index
}

/** Validate the delivery notice form fields. */
export function validateDeliveryForm(form: DeliveryFormFields): ValidationResult {
  const errors: string[] = []
  if (!form.deliveryPersonName.trim()) {
    errors.push('اسم المندوب مطلوب')
  }
  if (!form.deliveryDate.trim()) {
    errors.push('تاريخ التسليم مطلوب')
  } else {
    const d = new Date(form.deliveryDate)
    if (isNaN(d.getTime())) {
      errors.push('تاريخ التسليم غير صالح')
    }
  }
  return { isValid: errors.length === 0, errors }
}

/** Formats a short receipt number for display (e.g. DEL-ABC12345). */
export function buildReceiptNumber(deliveryId: string): string {
  return `DEL-${deliveryId.substring(0, 8).toUpperCase()}`
}

/** Returns whether a delivery is awaiting contractor confirmation. */
export function isPendingConfirmation(delivery: Delivery): boolean {
  return delivery.status === 'pending_confirmation'
}

/** Returns whether a delivery has been confirmed by the contractor. */
export function isDeliveryConfirmed(delivery: Delivery): boolean {
  return delivery.status === 'confirmed'
}

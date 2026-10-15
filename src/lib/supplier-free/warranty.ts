// Warranty applies to materials where it means something (PRD ORD-14): insulation, doors, plumbing, electrical and
// finishes — registered after receipt, ending in the future. The categories are the platform's own.

export const WARRANTY_CATEGORIES: readonly string[] = ["عزل وأسقف", "أبواب ونوافذ", "أدوات صحية وسباكة", "كهرباء وإنارة", "أرضيات وتشطيبات"]

export const warrantyEligible = (category: string | null | undefined): boolean => !!category && WARRANTY_CATEGORIES.includes(category)

/** The warranty button shows after something was received and only for these materials. */
export const canRegisterWarranty = (category: string | null | undefined, hasReceipt: boolean, alreadyRegistered: boolean): boolean => warrantyEligible(category) && hasReceipt && !alreadyRegistered

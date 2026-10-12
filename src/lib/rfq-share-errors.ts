export const SHARE_ERROR_CODES = ["RFQ_NOT_PUBLISHED", "FORBIDDEN", "RFQ_NOT_FOUND", "PROFILE_NOT_FOUND", "UNAUTHENTICATED", "INTERNAL_ERROR", "INVALID_INPUT"] as const

export const shareErrorKey = (code: string): string =>
  (SHARE_ERROR_CODES as readonly string[]).includes(code) ? `rfq_share_err_${code.toLowerCase()}` : "rfq_share_generate_failed"

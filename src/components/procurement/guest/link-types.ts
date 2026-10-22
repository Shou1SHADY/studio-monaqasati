import type { AnsweredQuery } from "@/lib/procurement/guest-supplier"
import type { LinkRfqView, VisitorResult } from "@/lib/procurement/rfq-share-view"
import type { VisitorMe } from "@/lib/procurement/visitor-offer-server"

export type { AnsweredQuery, LinkRfqView, VisitorResult }

export type LinkMe = VisitorMe

export interface LinkData {
  rfq: LinkRfqView
  contractorName: string
  linkExpiresAt?: string | null
  canSubmit: boolean
  codeAvailable?: boolean
  queries: AnsweredQuery[]
}

export const PAY_PRESETS = ["cash", "30", "60", "half"] as const
export type PayPreset = (typeof PAY_PRESETS)[number]

export const PAY_FIELDS: Record<PayPreset, { advancePercent: number; creditDays: number }> = {
  cash: { advancePercent: 0, creditDays: 0 },
  "30": { advancePercent: 0, creditDays: 30 },
  "60": { advancePercent: 0, creditDays: 60 },
  half: { advancePercent: 50, creditDays: 30 },
}

export interface LineState {
  price: string
  /** The sale unit priced by, as its length in request units; null = the request's unit. */
  per: number | null
  skipped: boolean
  /** The warranty offered in months, when the line asks one; null = as asked. */
  war: number | null
}

export interface FormState {
  lines: Record<number, LineState>
  total: string
  days: string
  valid: string
  company: string
  mobile: string
  pay: PayPreset | ""
  nonVat: boolean
  whole: boolean
  note: string
  contact: string
  email: string
  vat: string
}

export const emptyForm = (validDefault: string): FormState => ({ lines: {}, total: "", days: "", valid: validDefault, company: "", mobile: "", pay: "", nonVat: false, whole: false, note: "", contact: "", email: "", vat: "" })

export const lineOf = (form: FormState, index: number): LineState => form.lines[index] ?? { price: "", per: null, skipped: false, war: null }

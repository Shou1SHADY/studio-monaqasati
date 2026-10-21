// Procurement 2.0 NFR-07 — bounded inputs: a price is positive, finite and under a ceiling; a duration is a whole number of
// days from 1 to 365; what is counted in pieces is counted in whole pieces. The zod schemas are for the API routes that take
// a price or a duration from outside (the guest link, the free supplier's quote); the plain functions are for the screens.

import { z } from "zod"

/** The most a single unit may cost, in riyals — beyond it a number is a slip of the keyboard. Proposal, awaiting the owner's confirmation. */
export const MAX_UNIT_PRICE = 10_000_000

export const DURATION_DAYS = { min: 1, max: 365 } as const

/** Units that are counted piece by piece: half a bag does not arrive. */
export const integerUnits: ReadonlySet<string> = new Set(["حبة", "قطعة", "كيس", "لفة", "برميل", "نقلة", "pc", "pcs", "piece", "bag", "roll", "drum", "trip"])

export const isIntegerUnit = (unit: string | null | undefined): boolean => integerUnits.has((unit || "").trim().toLowerCase())

export const unitPriceSchema = z.coerce.number().positive().finite().max(MAX_UNIT_PRICE)

export const durationDaysSchema = z.coerce.number().int().min(DURATION_DAYS.min).max(DURATION_DAYS.max)

/** An empty box is no duration at all; a filled one is held to `durationDaysSchema`. */
export const optionalDurationDays = z.preprocess((v) => (v === "" || v == null ? undefined : v), durationDaysSchema.optional())

export type QuantityIssue = "not_positive" | "not_whole"

export function quantityIssue(quantity: number, unit: string | null | undefined): QuantityIssue | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return "not_positive"
  if (isIntegerUnit(unit) && !Number.isInteger(quantity)) return "not_whole"
  return null
}

export function priceIssue(price: number): "not_positive" | "too_big" | null {
  if (!Number.isFinite(price) || price <= 0) return "not_positive"
  return price > MAX_UNIT_PRICE ? "too_big" : null
}

export function durationIssue(days: number): "not_whole" | "out_of_range" | null {
  if (!Number.isInteger(days)) return "not_whole"
  return days < DURATION_DAYS.min || days > DURATION_DAYS.max ? "out_of_range" : null
}

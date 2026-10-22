// The visitor's four mandatory fields and his prices, as one list of reasons (LNK-07): the page shows the first one and
// «و{n} غيرها»; the server runs the same function again and answers with the first. Pure.

import { DURATION_DAYS, MAX_UNIT_PRICE } from "./input-limits"
import { toAmount } from "./offer-calc"
import { linesNet } from "./link-pricing"
import { saudiMobileE164 } from "@/lib/supplier-free/phone-auth"

export type LinkIssueCode = "no_price" | "price_zero" | "price_big" | "total_missing" | "days" | "valid_missing" | "valid_before_close" | "company" | "mobile"

export interface LinkIssue {
  code: LinkIssueCode
  /** The material it is about (its index in the request), when it is about one. */
  index?: number
}

export interface LinkQuoteInput {
  pricing: "line" | "total"
  lines: Array<{ index: number; qty: number; price: unknown; per?: number | null; skipped?: boolean }>
  total?: unknown
  days: unknown
  valid: string
  /** The submission deadline's day (`YYYY-MM-DD`). */
  close: string | null
  company: string
  mobile: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const filled = (v: unknown) => !(v === null || v === undefined || String(v).trim() === "")

export function validateLinkQuote(input: LinkQuoteInput): { issues: LinkIssue[]; net: number } {
  const issues: LinkIssue[] = []
  let net = 0
  if (input.pricing === "total") {
    const total = toAmount(input.total)
    if (!filled(input.total) || !(total > 0)) issues.push({ code: "total_missing" })
    else net = total
  } else {
    let priced = 0
    for (const l of input.lines) {
      if (l.skipped || !filled(l.price)) continue
      if (!(toAmount(l.price) > 0)) {
        issues.push({ code: "price_zero", index: l.index })
        continue
      }
      priced += 1
    }
    if (!priced && !issues.length) issues.push({ code: "no_price" })
    net = linesNet(input.lines.map((l) => (filled(l.price) && toAmount(l.price) > 0 ? l : { ...l, skipped: true })))
  }
  const biggest = input.pricing === "total" ? toAmount(input.total) : Math.max(0, ...input.lines.filter((l) => !l.skipped && filled(l.price)).map((l) => toAmount(l.price)))
  if (biggest > MAX_UNIT_PRICE || net > MAX_UNIT_PRICE) issues.push({ code: "price_big" })

  const days = Number(String(input.days ?? "").trim())
  if (!filled(input.days) || !Number.isInteger(days) || days < DURATION_DAYS.min || days > DURATION_DAYS.max) issues.push({ code: "days" })
  if (!input.valid || !DAY.test(input.valid)) issues.push({ code: "valid_missing" })
  else if (input.close && input.valid < input.close) issues.push({ code: "valid_before_close" })
  if (input.company.trim().length < 2) issues.push({ code: "company" })
  if (!saudiMobileE164(input.mobile)) issues.push({ code: "mobile" })
  return { issues, net }
}

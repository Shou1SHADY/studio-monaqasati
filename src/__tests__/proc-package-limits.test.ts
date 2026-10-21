/**
 * Procurement 2.0 — bounded inputs (NFR-07), the audit trail's new actions (NFR-05) and the one material-request sequence
 * (REQ-04, Pipeline §4).
 */

import fs from "fs"
import path from "path"
import {
  DURATION_DAYS,
  MAX_UNIT_PRICE,
  durationDaysSchema,
  durationIssue,
  integerUnits,
  isIntegerUnit,
  optionalDurationDays,
  priceIssue,
  quantityIssue,
  unitPriceSchema,
} from "@/lib/procurement/input-limits"
import { RFQ_LOG_ACTIONS } from "@/lib/procurement/rfq-detail"
import { PO_LOG_ACTIONS } from "@/lib/procurement/po"
import { MATERIAL_REQUEST_DOC_TYPE } from "@/lib/procurement/numbering"
import { displayNeedRef, displayPoNumber, displayReceiptNumber, rfqDisplayNumber } from "@/lib/procurement/format"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"

describe("a price is positive, finite and under a ceiling", () => {
  it("accepts a real price and refuses zero, negatives, infinity, text and an absurd one", () => {
    expect(unitPriceSchema.safeParse(2750).success).toBe(true)
    expect(unitPriceSchema.safeParse("2,750".replace(",", "")).success).toBe(true)
    for (const bad of [0, -5, Infinity, "abc", MAX_UNIT_PRICE + 1, 1e12]) expect({ bad, ok: unitPriceSchema.safeParse(bad).success }).toEqual({ bad, ok: false })
    expect(unitPriceSchema.safeParse(MAX_UNIT_PRICE).success).toBe(true)
    expect(priceIssue(0)).toBe("not_positive")
    expect(priceIssue(MAX_UNIT_PRICE + 1)).toBe("too_big")
    expect(priceIssue(10)).toBeNull()
  })
})

describe("a duration is a whole number of days from 1 to 365", () => {
  it("«9,999 يوماً من الرابط» is a clear refusal", () => {
    expect(DURATION_DAYS).toEqual({ min: 1, max: 365 })
    expect(durationDaysSchema.safeParse(10).success).toBe(true)
    expect(durationDaysSchema.safeParse("45").success).toBe(true)
    for (const bad of [0, -3, 9999, 366, 2.5, "x"]) expect({ bad, ok: durationDaysSchema.safeParse(bad).success }).toEqual({ bad, ok: false })
    expect(durationIssue(9999)).toBe("out_of_range")
    expect(durationIssue(1.5)).toBe("not_whole")
    expect(durationIssue(365)).toBeNull()
  })

  it("an empty box is no duration; a filled one is held to the limits", () => {
    expect(optionalDurationDays.safeParse("").success).toBe(true)
    expect(optionalDurationDays.safeParse(undefined).success).toBe(true)
    expect(optionalDurationDays.safeParse("7").success).toBe(true)
    expect(optionalDurationDays.safeParse("9999").success).toBe(false)
  })
})

describe("what is counted in pieces is counted in whole pieces", () => {
  it("a bag, a piece, a roll are whole; a ton is not", () => {
    for (const u of ["كيس", "حبة", "لفة", "bag", "pc"]) expect({ u, whole: isIntegerUnit(u) }).toEqual({ u, whole: true })
    for (const u of ["طن", "م³", "كجم", "ton", "", null, undefined]) expect({ u, whole: isIntegerUnit(u as string) }).toEqual({ u, whole: false })
    expect(integerUnits.has("كيس")).toBe(true)
    expect(quantityIssue(2.5, "كيس")).toBe("not_whole")
    expect(quantityIssue(2.5, "طن")).toBeNull()
    expect(quantityIssue(0, "طن")).toBe("not_positive")
    expect(quantityIssue(Number.NaN, "طن")).toBe("not_positive")
  })
})

describe("the log's new actions have their words in both languages", () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), "messages", `${file}.json`), "utf8")
  it("every RFQ log action and the order conversation's message", () => {
    expect(RFQ_LOG_ACTIONS).toEqual(expect.arrayContaining(["published", "reopened", "shortlisted", "unshortlisted", "offer_versioned", "price_confirmed", "award_reason", "message"]))
    expect(PO_LOG_ACTIONS).toContain("message")
    for (const file of ["en", "ar"]) {
      const flat = read(file)
      for (const a of ["published", "reopened", "shortlisted", "unshortlisted", "offer_versioned", "price_confirmed", "award_reason", "message"]) expect({ file, a, has: flat.includes(`"${a}": "`) }).toEqual({ file, a, has: true })
    }
  })
})

describe("one sequence for the requests that reach Incoming without a project number (REQ-04)", () => {
  it("is MAT, stored Latin and shown «ط.م-2026/014»; a project's own request keeps «ط.م 03»", () => {
    expect(MATERIAL_REQUEST_DOC_TYPE).toBe("MAT")
    const stored = formatYearlyDocNumber(MATERIAL_REQUEST_DOC_TYPE, 2026, 14)
    expect(stored).toBe("MAT-2026/014")
    expect(displayNeedRef(stored, "ar")).toBe("ط.م-2026/014")
    expect(displayNeedRef(stored, "en")).toBe("MAT-2026/014")
    expect(displayNeedRef("MR 03", "ar")).toBe("ط.م 03")
  })

  it("the other documents show as the Pipeline lists them", () => {
    expect(displayPoNumber("PO-2026/014", "ar")).toBe("ط.ش-2026/014")
    expect(displayReceiptNumber("GR-2026/027", "ar")).toBe("ا.س-2026/027")
    expect(rfqDisplayNumber({ rfqNumber: "RFQ-2026/003" }, "ar")).toBe("RFQ-2026/003")
  })

  it("the team-request module no longer describes its number as MR-2026/…", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/procurement/team-requests.ts"), "utf8")
    expect(source).not.toMatch(/MR-2026\/014/)
    expect(source).toMatch(/MAT-2026\/014/)
  })
})

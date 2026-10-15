/**
 * Supplier 1.0 — what blocks a quote and an invoice (OFR-02, BIL-02, G-07), the formats (NFR-04) and the plan switch.
 * The same functions run in the form and on the server.
 */

import { invoiceBlocks, invoiceCap, type InvoiceFacts } from "@/lib/supplier-free/invoice-rules"
import { quoteBlocks, type QuoteValues } from "@/lib/supplier-free/quote-writes"
import { createDealLogic } from "@/lib/supplier-free/deal-logic"
import { fd, fmtM, makeFmt, normalizeMobile, isSaudiMobile } from "@/lib/supplier-free/format"
import { docState, isVerified, profileChecks, profilePct, profileFacts } from "@/lib/supplier-free/profile"
import { freePathAllowed, planOf } from "@/lib/supplier-plan"
import { canRegisterWarranty, warrantyEligible } from "@/lib/supplier-free/warranty"
import type { Deal } from "@/lib/supplier-free/types"

const L = createDealLogic("2026-10-11")

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "r1",
  rfq: "2026/031",
  c: "c1",
  title: "t",
  city: "الرياض",
  cat: "طوب وبلوك",
  channel: "public",
  posted: "2026-10-08",
  deadline: "2026-10-13",
  needBy: "2026-10-25",
  pricing: "item",
  items: [
    { id: "i1", name: "بلوك مفرغ", unit: "حبة", qty: 100, spec: "" },
    { id: "i2", name: "بلوك مصمت", unit: "حبة", qty: 50, spec: "" },
  ],
  files: [],
  qa: [],
  offer: null,
  po: null,
  ship: [],
  invs: [],
  pays: [],
  msgs: [],
  log: [],
  ...over,
})

const values = (over: Partial<QuoteValues> = {}): QuoteValues => ({ prices: { i1: "2.5", i2: "3" }, skip: {}, total: "", arrive: "", valid: "2026-10-27", note: "", ...over })

describe("what blocks a quote", () => {
  it("none: a price on every item, a validity, the deadline open — and the figures are computed", () => {
    const c = quoteBlocks(deal(), values(), "new", L)
    expect(c.blocks).toEqual([])
    expect(c.net).toBe(400)
    expect(c.vat).toBe(60)
    expect(c.gross).toBe(460)
  })

  it("no priced item, a zero price, an empty total, no validity, a passed deadline", () => {
    expect(quoteBlocks(deal(), values({ prices: {} }), "new", L).blocks[0].code).toBe("oneItem")
    expect(quoteBlocks(deal(), values({ prices: { i1: "0", i2: "3" } }), "new", L).blocks[0]).toMatchObject({ code: "zero", item: "بلوك مفرغ" })
    expect(quoteBlocks(deal({ pricing: "total" }), values({ total: "" }), "new", L).blocks[0].code).toBe("total")
    expect(quoteBlocks(deal(), values({ valid: "" }), "new", L).blocks.map((b) => b.code)).toContain("valid")
    expect(quoteBlocks(deal({ deadline: "2026-10-01" }), values(), "new", L).blocks.map((b) => b.code)).toContain("deadline")
  })

  it("an item can be skipped, but not all of them; a reply to a price cut ignores the passed deadline", () => {
    expect(quoteBlocks(deal(), values({ skip: { i2: true }, prices: { i1: "2" } }), "new", L).blocks).toEqual([])
    expect(quoteBlocks(deal(), values({ skip: { i1: true, i2: true } }), "new", L).blocks[0].code).toBe("oneItem")
    expect(quoteBlocks(deal({ deadline: "2026-10-01" }), values(), "reduce", L).blocks).toEqual([])
  })
})

describe("what blocks an invoice", () => {
  const facts = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
    today: "2026-10-11",
    receipts: [
      { id: "GR-1", day: "2026-10-05", net: 1000 },
      { id: "GR-2", day: "2026-10-08", net: 500 },
    ],
    billed: [],
    lumpTotalWhenComplete: null,
    usedNumbers: [],
    ...over,
  })
  const ok = { number: "ف-1", date: "2026-10-09", amountNet: 1000, hasFile: true, grns: ["GR-1"] }

  it("passes within what the contractor accepted, dated between the last receipt it covers and today, with its file", () => {
    expect(invoiceBlocks(facts(), ok)).toEqual([])
    expect(invoiceCap(facts(), ["GR-1", "GR-2"])).toBe(1500)
  })

  it("no number, a repeated number, no receipt, a receipt already billed, a zero amount, above the receipts, a date before the last receipt or in the future, no file", () => {
    expect(invoiceBlocks(facts(), { ...ok, number: " " })).toContain("number")
    expect(invoiceBlocks(facts({ usedNumbers: ["ف-1"] }), ok)).toContain("duplicate")
    expect(invoiceBlocks(facts(), { ...ok, grns: [] })).toContain("noReceipt")
    expect(invoiceBlocks(facts({ billed: ["GR-1"] }), ok)).toContain("billed")
    expect(invoiceBlocks(facts(), { ...ok, amountNet: 0 })).toContain("amount")
    expect(invoiceBlocks(facts(), { ...ok, amountNet: 1000.5 })).toContain("over")
    expect(invoiceBlocks(facts(), { ...ok, date: "2026-10-04" })).toContain("dateBefore")
    expect(invoiceBlocks(facts(), { ...ok, date: "2026-10-12" })).toContain("dateFuture")
    expect(invoiceBlocks(facts(), { ...ok, hasFile: false })).toContain("file")
  })

  it("a lump-sum order may be invoiced only once it is complete, and only for its total", () => {
    const lump = facts({ receipts: [{ id: "GR-1", day: "2026-10-05", net: null }], lumpTotalWhenComplete: null })
    expect(invoiceBlocks(lump, { ...ok, amountNet: 10 })).toContain("over")
    const done = facts({ receipts: [{ id: "GR-1", day: "2026-10-05", net: null }], lumpTotalWhenComplete: 900 })
    expect(invoiceBlocks(done, { ...ok, amountNet: 900 })).toEqual([])
  })
})

describe("how things are written", () => {
  const ar = makeFmt("ar", { cur: "ر.س", thousand: "ألف", million: "م" }, 2026)
  const en = makeFmt("en", { cur: "SAR", thousand: "K", million: "M" }, 2026)

  it("money: the unit after the figure in Arabic, before it in English, thousands separated, no decimals for whole riyals", () => {
    expect(ar.money(1234567)).toBe("1,234,567 ر.س")
    expect(en.money(1234.5)).toBe("SAR 1,234.50")
    expect(fmtM(15)).toBe("15")
  })

  it("short forms: 349 K · 1.86 M", () => {
    expect(en.kM(349000)).toBe("349 K")
    expect(en.kM(1860000)).toBe("1.86 M")
    expect(ar.kM(349000)).toBe("349 ألف")
  })

  it("dates carry the year only when it is not the data's year, in Western digits", () => {
    expect(fd("2026-10-11", "en", 2026)).toBe("11 Oct")
    expect(fd("2027-03-02", "en", 2026)).toBe("2 Mar 2027")
    expect(fd("2026-10-11", "ar", 2026)).toMatch(/^11 /)
    expect(fd("2026-10-11", "ar", 2026)).not.toMatch(/[٠-٩]/)
    expect(fd(null, "ar", 2026)).toBe("—")
  })

  it("a Saudi mobile is 05XXXXXXXX in either numeral set", () => {
    expect(normalizeMobile("٠٥٥١٢٣٤٧٨٠")).toBe("0551234780")
    expect(isSaudiMobile("05 5123 4780")).toBe(true)
    expect(isSaudiMobile("+971501234567")).toBe(false)
  })
})

describe("the company account", () => {
  const full = profileFacts({
    name: "Co",
    phone: "0551234780",
    crNumber: "1010",
    location: "الرياض",
    specializations: ["طوب وبلوك"],
    coverageCities: ["الرياض"],
    legalDocuments: { cr: { url: "u" }, addr: { url: "u" }, iban: { url: "u" } },
  })

  it("verified is the register, the national address and the IBAN letter; the VAT certificate is optional", () => {
    expect(isVerified(full)).toBe(true)
    expect(isVerified(profileFacts({ legalDocuments: { cr: { url: "u" }, addr: { url: "u" } } }))).toBe(false)
  })

  it("completion is seven checks; the VAT number is not one of them", () => {
    expect(profileChecks(full)).toHaveLength(7)
    expect(profilePct(full)).toBe(Math.round((5 / 7) * 100))
    expect(profilePct(profileFacts({}))).toBe(0)
  })

  it("a document's state follows its expiry", () => {
    expect(docState("2026-09-01", "2026-10-11")).toBe("expired")
    expect(docState("2026-11-01", "2026-10-11")).toBe("soon")
    expect(docState("2027-05-01", "2026-10-11")).toBe("valid")
    expect(docState(undefined, "2026-10-11")).toBe("none")
  })
})

describe("the free journey's boundary", () => {
  it("a company with no plan document is free; only an explicit 'full' is the full portal", () => {
    expect(planOf(null)).toBe("free")
    expect(planOf({ supplierPlan: "full" })).toBe("full")
    expect(planOf({ supplierPlan: "other" })).toBe("free")
  })

  it("the free account reaches its eight screens and nothing of the modules", () => {
    for (const p of ["/supplier", "/supplier/rfqs", "/supplier/offers", "/supplier/orders", "/supplier/invoices", "/supplier/connections", "/supplier/chats", "/supplier/profile", "/supplier/notifications", "/supplier/search", "/supplier/chat/abc"]) expect(freePathAllowed(p)).toBe(true)
    for (const p of ["/supplier/sales", "/supplier/crm/leads", "/supplier/accounting", "/supplier/hr", "/supplier/warehouses", "/supplier/manufacturing/orders", "/supplier/team"]) expect(freePathAllowed(p)).toBe(false)
  })

  it("a warranty is for insulation, doors, plumbing, electrical and finishes — after a receipt, once", () => {
    expect(warrantyEligible("عزل وأسقف")).toBe(true)
    expect(warrantyEligible("طوب وبلوك")).toBe(false)
    expect(canRegisterWarranty("عزل وأسقف", true, false)).toBe(true)
    expect(canRegisterWarranty("عزل وأسقف", false, false)).toBe(false)
    expect(canRegisterWarranty("عزل وأسقف", true, true)).toBe(false)
  })
})

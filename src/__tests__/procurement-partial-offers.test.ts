/**
 * Procurement 1.5, PUR-03 — «كل مورد يقدّم على ما يورّده، والترسية بنداً بنداً».
 *
 * A mixed-category RFQ is ONE request; a supplier prices the materials he supplies and marks the rest «not supplied».
 * Everything that turns an offer into money treats such a line as not covered — never as zero — and the award is
 * item by item. These are the rules for pricing, validating, comparing and awarding a partial offer.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import {
  faultNames,
  guestOfferPrice,
  isPartialOffer,
  offerCoverage,
  offerPricingFields,
  ownCoverage,
  priceOffer,
  pricedProducts,
  pricingFault,
  revisePrice,
} from "@/lib/procurement/offer-pricing"
import { offerMatrix } from "@/lib/procurement/offer-matrix"
import { awardSummary, bestOfferIds, coversAllLines, pickOffer } from "@/lib/procurement/rfq-award"
import { lowestOffer } from "@/lib/procurement/po"
import { DEFAULT_POLICIES, type ProcActor } from "@/lib/procurement/types"
import { buildPoLines, draftPurchaseOrder, ProcWriteError, type AwardOfferLike, type AwardRfqInput, type RfqLike } from "@/lib/procurement/writes"
import { awardRfq } from "@/test-utils/legacy-award-writes"
import { normalizeOfferPricing, SupplierOfferError } from "@/lib/supplier-offer-server"
import { quoteBlocks, versionOf, type QuoteValues } from "@/lib/supplier-free/quote-rules"

const rfq = (over: Record<string, unknown> = {}) => ({
  pricingMode: "line",
  products: [
    { name: "حديد 12مم", quantity: "10", unitOfMeasure: "طن" },
    { name: "أسمنت", quantity: 100, unitOfMeasure: "كيس" },
    { name: "رمل", quantity: 20, unitOfMeasure: "م3" },
  ],
  ...over,
})
const products = pricedProducts(rfq())

describe("pricing an offer where some materials are not supplied", () => {
  it("a fully priced offer is exactly what it was — no mark, no extra field", () => {
    const p = priceOffer(products, { 0: "2780", 1: "15.2", 2: "40" })
    expect(p).toMatchObject({ total: 29320 + 800, missing: [], skipped: [], conflicting: [], complete: true })
    expect(offerPricingFields(p)).toEqual({
      lines: [
        { rfqProductIndex: 0, unitPrice: 2780 },
        { rfqProductIndex: 1, unitPrice: 15.2 },
        { rfqProductIndex: 2, unitPrice: 40 },
      ],
      price: "30120",
    })
  })

  it("a line marked not-supplied is left out of the total — not counted as zero", () => {
    const p = priceOffer(products, { 0: "2780", 1: "15.2" }, [2])
    expect(p.complete).toBe(true)
    expect(p.total).toBe(29320)
    expect(p.skipped).toEqual([2])
    expect(p.lines.map((l) => l.rfqProductIndex)).toEqual([0, 1])
    expect(offerPricingFields(p)).toMatchObject({ price: "29320", skippedItems: [2] })
  })

  it("a line neither priced nor marked is still an error, and names the line", () => {
    const p = priceOffer(products, { 0: "2780" }, [2])
    expect(p.complete).toBe(false)
    expect(pricingFault(p)).toEqual({ code: "LINE_PRICES_INCOMPLETE", indexes: [1] })
    expect(faultNames(products, [1])).toBe("أسمنت")
  })

  it("nothing priced is an error, whether every line is marked or all are blank", () => {
    expect(pricingFault(priceOffer(products, {}, [0, 1, 2]))).toEqual({ code: "NO_LINE_PRICED", indexes: [] })
    expect(pricingFault(priceOffer(products, {}))).toEqual({ code: "LINE_PRICES_INCOMPLETE", indexes: [0, 1, 2] })
  })

  it("a price and a not-supplied mark on the same line contradict each other", () => {
    const p = priceOffer(products, { 0: "2780", 1: "15.2", 2: "40" }, [2])
    expect(p.complete).toBe(false)
    expect(p.conflicting).toEqual([2])
    expect(pricingFault(p)).toEqual({ code: "LINE_CONTRADICTORY", indexes: [2] })
  })

  it("a zero price is not a price — it is missing unless marked", () => {
    expect(priceOffer(products, { 0: "0", 1: "15.2", 2: "40" }).missing).toEqual([0])
    expect(priceOffer(products, { 0: "0", 1: "15.2", 2: "40" }, [0]).complete).toBe(true)
  })
})

describe("what a public endpoint stores for a partial guest quote", () => {
  const rates = [
    { rfqProductIndex: 0, unitPrice: 2780 },
    { rfqProductIndex: 1, unitPrice: 15.2 },
  ]
  it("computes the total of the covered lines and keeps the marks", () => {
    expect(guestOfferPrice(rfq(), rates, 1, [2])).toMatchObject({ ok: true, total: 29320, price: "29320", skippedItems: [2] })
  })

  it("refuses an unmarked blank line, as before", () => {
    expect(guestOfferPrice(rfq(), rates, 1)).toEqual({ ok: false, code: "LINE_PRICES_INCOMPLETE" })
  })

  it("refuses a contradictory line and an empty quote", () => {
    expect(guestOfferPrice(rfq(), rates, 1, [1, 2])).toEqual({ ok: false, code: "LINE_CONTRADICTORY" })
    expect(guestOfferPrice(rfq(), [], 1, [0, 1, 2])).toEqual({ ok: false, code: "NO_LINE_PRICED" })
  })

  it("a fully priced quote has no skippedItems at all", () => {
    const all = [...rates, { rfqProductIndex: 2, unitPrice: 40 }]
    const q = guestOfferPrice(rfq(), all, 1)
    expect(q.ok && "skippedItems" in q).toBe(false)
  })

  it("a total-priced request has no partial offers: marks are ignored, the posted total stands", () => {
    expect(guestOfferPrice(rfq({ pricingMode: "total" }), [], 5000, [1])).toEqual({ ok: true, total: 5000, price: "5000", lines: null })
  })
})

describe("the portal's server route recomputes and checks a per-material quote", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    supplierName: "Co",
    price: "999999",
    lines: [
      { rfqProductIndex: 0, unitPrice: 2780 },
      { rfqProductIndex: 1, unitPrice: 15.2 },
    ],
    skippedItems: [2],
    deliveryBatches: [{ location: "الرياض", deliveryDate: "2026-11-01", price: "999999", quantity: "130" }],
    ...over,
  })

  it("never trusts the posted total, and writes the batch at the real one", () => {
    const out = normalizeOfferPricing(rfq(), body())
    expect(out.price).toBe("29320")
    expect(out.skippedItems).toEqual([2])
    expect((out.deliveryBatches as Array<{ price: string }>)[0].price).toBe("29320")
  })

  it("refuses an unmarked blank line, a contradiction and an empty quote with their own codes", () => {
    expect(() => normalizeOfferPricing(rfq(), body({ skippedItems: [] }))).toThrow(expect.objectContaining({ code: "line_prices_incomplete", detail: "2" }))
    expect(() => normalizeOfferPricing(rfq(), body({ skippedItems: [1, 2] }))).toThrow(expect.objectContaining({ code: "line_contradictory" }))
    expect(() => normalizeOfferPricing(rfq(), body({ lines: [{ rfqProductIndex: 0, unitPrice: 0 }], skippedItems: [0, 1, 2] }))).toThrow(SupplierOfferError)
  })

  it("a fully priced quote comes out the same as it went in", () => {
    const full = body({ price: "30120", skippedItems: undefined, lines: [{ rfqProductIndex: 0, unitPrice: 2780 }, { rfqProductIndex: 1, unitPrice: 15.2 }, { rfqProductIndex: 2, unitPrice: 40 }], deliveryBatches: [{ location: "x", deliveryDate: "d", price: "30120", quantity: "130" }] })
    const out = normalizeOfferPricing(rfq(), full)
    expect(out).toEqual({ supplierName: "Co", price: "30120", lines: full.lines, deliveryBatches: full.deliveryBatches })
  })

  it("a total-priced request drops a stray mark, and a lump-sum body is left alone", () => {
    expect(normalizeOfferPricing(rfq({ pricingMode: "total" }), { price: "5000", skippedItems: [1] })).toEqual({ price: "5000" })
    expect(normalizeOfferPricing(rfq(), { price: "5000", note: "x" })).toEqual({ price: "5000", note: "x" })
  })
})

describe("revising a partial offer's price", () => {
  const partial = { price: "29320", lines: [{ rfqProductIndex: 0, unitPrice: 2780 }, { rfqProductIndex: 1, unitPrice: 15.2 }], skippedItems: [2] }

  it("keeps it partial when the form does not know about marks — what he left out stays out", () => {
    const r = revisePrice(partial, products, { rates: { 0: "2700", 1: "15" } })
    expect(r).toMatchObject({ ok: true, total: 28500, fields: { price: "28500", skippedItems: [2] } })
  })

  it("a rate typed on a line he had left out brings it in", () => {
    const r = revisePrice(partial, products, { rates: { 0: "2700", 1: "15", 2: "40" } })
    expect(r).toMatchObject({ ok: true, total: 29300, fields: { skippedItems: [] } })
  })

  it("a covered line left blank is still refused", () => {
    expect(revisePrice(partial, products, { rates: { 0: "2700" } })).toEqual({ ok: false, code: "LINE_PRICES_INCOMPLETE" })
  })

  it("an explicit mark is honoured", () => {
    const r = revisePrice({ ...partial, skippedItems: undefined, lines: [...partial.lines, { rfqProductIndex: 2, unitPrice: 40 }] }, products, { rates: { 0: "2700", 1: "15" }, skipped: [2] })
    expect(r).toMatchObject({ ok: true, total: 28500, fields: { skippedItems: [2] } })
  })

  it("a fully priced offer revised in full gets no skippedItems field", () => {
    const full = { price: "30120", lines: [{ rfqProductIndex: 0, unitPrice: 2780 }, { rfqProductIndex: 1, unitPrice: 15.2 }, { rfqProductIndex: 2, unitPrice: 40 }] }
    const r = revisePrice(full, products, { rates: { 0: "2700", 1: "15", 2: "40" } })
    expect(r.ok && "skippedItems" in r.fields).toBe(false)
  })
})

describe("how much of the request an offer covers", () => {
  it("counts the priced lines, and names the ones left out", () => {
    expect(offerCoverage(rfq(), { lines: [{ rfqProductIndex: 0, unitPrice: 5 }, { rfqProductIndex: 1, unitPrice: 5 }] })).toEqual({ covered: 2, of: 3, partial: true, uncovered: [2] })
  })

  it("a total offer, or a request priced as a total, covers everything", () => {
    expect(offerCoverage(rfq(), { price: "100" }).partial).toBe(false)
    expect(offerCoverage(rfq({ pricingMode: "total" }), { lines: [{ rfqProductIndex: 0, unitPrice: 5 }] }).partial).toBe(false)
  })

  it("still knows an offer is partial after its rates were dropped", () => {
    expect(offerCoverage(rfq(), { price: "100", skippedItems: [1] })).toMatchObject({ partial: true, uncovered: [1], covered: 2 })
    expect(isPartialOffer({ skippedItems: [1] })).toBe(true)
    expect(isPartialOffer({ skippedItems: [] })).toBe(false)
  })

  it("is readable from the offer alone for a list that never loaded the request", () => {
    expect(ownCoverage({ lines: [{ rfqProductIndex: 0, unitPrice: 5 }, { rfqProductIndex: 1, unitPrice: 5 }], skippedItems: [2] })).toEqual({ covered: 2, of: 3 })
    expect(ownCoverage({ lines: [{ rfqProductIndex: 0, unitPrice: 5 }] })).toBeNull()
  })
})

describe("comparing a partial offer with full ones", () => {
  const full = { id: "full", price: "32100", lines: [{ rfqProductIndex: 0, unitPrice: 2900 }, { rfqProductIndex: 1, unitPrice: 20 }, { rfqProductIndex: 2, unitPrice: 55 }] }
  const part = { id: "part", price: "29200", lines: [{ rfqProductIndex: 0, unitPrice: 2800 }, { rfqProductIndex: 1, unitPrice: 12 }], skippedItems: [2] }
  const full2 = { id: "full2", price: "32800", lines: [{ rfqProductIndex: 0, unitPrice: 3000 }, { rfqProductIndex: 1, unitPrice: 20 }, { rfqProductIndex: 2, unitPrice: 40 }] }

  it("never marks the partial offer's smaller total as the lowest — its rows still compete", () => {
    const m = offerMatrix(rfq(), [full, part, full2])
    expect(m.columns.find((c) => c.offerId === "part")).toMatchObject({ lowestTotal: false, partial: { covered: 2, of: 3 } })
    expect(m.columns.find((c) => c.offerId === "full")?.lowestTotal).toBe(true)
    const iron = m.rows[0].cells
    expect(iron.find((c) => c.offerId === "part")?.lowest).toBe(true)
  })

  it("an uncovered line is «not covered» in its cell, not zero and not «total only»", () => {
    const cell = offerMatrix(rfq(), [full, part]).rows[2].cells.find((c) => c.offerId === "part")
    expect(cell).toMatchObject({ unitPrice: null, lineTotal: null, notCovered: true })
  })

  it("the best-price badge goes to a full offer only", () => {
    expect([...bestOfferIds(rfq(), [full, part, full2], () => true)]).toEqual(["full"])
    expect(coversAllLines(rfq(), part)).toBe(false)
  })

  it("the order's «lowest offer» ignores a partial offer unless every offer is partial", () => {
    expect(lowestOffer([full, part, full2])?.id).toBe("full")
    expect(lowestOffer([part, { ...part, id: "part2", price: "29000" }])?.id).toBe("part2")
  })
})

describe("awarding line by line", () => {
  const full = { id: "full", price: "32100", lines: [{ rfqProductIndex: 0, unitPrice: 2900 }, { rfqProductIndex: 1, unitPrice: 20 }, { rfqProductIndex: 2, unitPrice: 55 }] }
  const part = { id: "part", price: "29200", lines: [{ rfqProductIndex: 0, unitPrice: 2800 }, { rfqProductIndex: 1, unitPrice: 12 }], skippedItems: [2] }

  it("accepting the partial offer picks only the lines it covers", () => {
    expect(pickOffer(rfq(), [full, part], "part", {})).toEqual({ 0: "part", 1: "part" })
  })

  it("the line nobody covers goes back to the needs; the covered ones are grouped under their supplier", () => {
    const s = awardSummary(rfq(), [full, part], { 0: "part", 1: "part", 2: "full" })
    expect(s.groups.map((g) => [g.offerId, g.lines.map((l) => l.rfqProductIndex)])).toEqual([
      ["part", [0, 1]],
      ["full", [2]],
    ])
    const only = awardSummary(rfq(), [part], { 0: "part", 1: "part" })
    expect(only.unpicked).toEqual([2])
    expect(only.total).toBe(29200)
  })

  it("a pick on a line a partial offer does not cover is dropped", () => {
    const s = awardSummary(rfq(), [part], { 2: "part" })
    expect(s.groups).toEqual([])
    expect(s.unpicked).toEqual([0, 1, 2])
  })
})

describe("the order made from a partial offer", () => {
  const r: RfqLike = { id: "r1", title: "Mixed", organizationId: "org", contractorId: "buyer", products: [{ name: "حديد", quantity: 10, unitOfMeasure: "طن" }, { name: "أسمنت", quantity: 100, unitOfMeasure: "كيس" }, { name: "رمل", quantity: 20, unitOfMeasure: "م3" }] }
  const partial: AwardOfferLike = { id: "p", price: "29200", supplierId: "u", organizationId: "o", lines: [{ rfqProductIndex: 0, unitPrice: 2800 }, { rfqProductIndex: 1, unitPrice: 12 }], skippedItems: [2] }

  it("carries only the materials he supplies, each at its rate", () => {
    const lines = buildPoLines(r, partial)
    expect(lines.map((l) => [l.rfqProductIndex, l.unitPrice])).toEqual([[0, 2800], [1, 12]])
  })

  it("a split award's order carries only the lines that supplier won, at the value he won", () => {
    const won = { ...partial, awardedLines: [1], awardedTotal: 1200 }
    const actor: ProcActor = { uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
    const draft = draftPurchaseOrder(actor, { rfq: r, offer: won, offers: [won], policies: DEFAULT_POLICIES })
    expect(draft.lines.map((l) => l.rfqProductIndex)).toEqual([1])
    expect(draft.totalExVat).toBe(1200)
  })

  it("an offer with no marks builds exactly the lines it always did", () => {
    const plain: AwardOfferLike = { id: "x", price: "30120", lines: [{ rfqProductIndex: 0, unitPrice: 2780 }, { rfqProductIndex: 1, unitPrice: 15.2 }, { rfqProductIndex: 2, unitPrice: 40 }] }
    expect(buildPoLines(r, plain).map((l) => l.rfqProductIndex)).toEqual([0, 1, 2])
  })
})

describe("the award write refuses a line the supplier does not supply", () => {
  const db = fakeFirestore as unknown as Firestore
  const buyer: ProcActor = { uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
  const rfqDoc: RfqLike = { id: "rfq1", title: "Mixed", organizationId: "org", contractorId: "buyer", city: "الرياض", products: [{ name: "حديد", quantity: 10, unitOfMeasure: "طن" }, { name: "رمل", quantity: 20, unitOfMeasure: "م3" }] }
  const partial: AwardOfferLike = { id: "P", price: "28000", supplierId: "u", organizationId: "o", companyName: "P Co", offerPdfUrl: "p.pdf", lines: [{ rfqProductIndex: 0, unitPrice: 2800 }] }
  const group = (lines: number[], total: number) => ({ offer: partial, lines: lines.map((i) => ({ rfqProductIndex: i, unitPrice: i === 0 ? 2800 : null })), total, requestedDeliveryDate: null, lowestForLines: null, offLowest: false })
  const input = (groups: AwardRfqInput["groups"]): AwardRfqInput => ({ rfq: rfqDoc, offers: [partial], groups, unpicked: [], awardReason: null, breakdown: false, policies: DEFAULT_POLICIES })

  beforeEach(() => {
    resetFakeDb()
    seed("users/org", { organizationId: "org" })
    seed("rfqs/rfq1", { ...rfqDoc, status: "New" })
    seed("offers/P", { ...partial, skippedItems: [1], status: "قيد المراجعة" })
  })

  it("a line he marked as not supplied cannot be awarded to him", async () => {
    await expect(awardRfq(db, buyer, input([group([0, 1], 28000)]))).rejects.toMatchObject({ code: "line_not_covered" })
    expect(readDoc<{ status: string }>("offers/P")?.status).toBe("قيد المراجعة")
  })

  it("the line he covers can, and the other goes back to the needs", async () => {
    const out = await awardRfq(db, buyer, { ...input([group([0], 28000)]), unpicked: [1] })
    expect(out).toHaveLength(1)
    expect(readDoc<{ status: string; awardedLines: number[] }>("offers/P")).toMatchObject({ status: "مقبول", awardedLines: [0] })
    expect(readDoc<{ unawardedLines: number[] }>("rfqs/rfq1")?.unawardedLines).toEqual([1])
  })

  it("is a real write error with its own code", () => {
    expect(new ProcWriteError("line_not_covered").code).toBe("line_not_covered")
  })
})

describe("the free journey's quote form", () => {
  const deal = { pricing: "item" as const, deadline: "2026-12-01", items: [{ id: "i1", name: "حديد", unit: "طن", qty: 10, spec: "" }, { id: "i2", name: "رمل", unit: "م3", qty: 20, spec: "" }] }
  const L = { daysTo: () => 5 }
  const v = (over: Partial<QuoteValues> = {}): QuoteValues => ({ prices: { i1: "2800" }, skip: {}, total: "", arrive: "", valid: "2026-12-10", note: "", ...over })

  it("a blank item that is not marked is named, not silently dropped", () => {
    expect(quoteBlocks(deal, v(), "new", L).blocks).toEqual([{ code: "unmarked", item: "رمل" }])
  })

  it("marked «not supplied», it goes — and the quote carries only the priced item", () => {
    const check = quoteBlocks(deal, v({ skip: { i2: true } }), "new", L)
    expect(check.blocks).toEqual([])
    expect(check.net).toBe(28000)
    expect(versionOf(deal, v({ skip: { i2: true } }), "2026-10-20").lines).toEqual([{ rfqProductIndex: 0, unitPrice: 2800 }])
  })

  it("nothing priced still says «price at least one» first", () => {
    expect(quoteBlocks(deal, v({ prices: {} }), "new", L).blocks[0].code).toBe("oneItem")
  })

  it("a fully priced quote has no extra block", () => {
    expect(quoteBlocks(deal, v({ prices: { i1: "2800", i2: "40" } }), "new", L).blocks).toEqual([])
  })
})

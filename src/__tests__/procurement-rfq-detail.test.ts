/**
 * One RFQ's page (R-01, R-05, R-07, R-08, R-12, R-14, R-15, R-41): the split
 * award's picks and grouping, the total-pricing breakdown, the comparison's
 * notes, the early close and the cancellation, who was invited and who hears
 * an answer — and the award's write: one order per supplier with his lines,
 * the RFQ awarded with its unawarded lines, all in one transaction.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { offersSealed } from "@/lib/procurement/award"
import { awardMode, awardSummary, bestPerLine, checkBreakdown, livePicks, lowestForLines, pickLowest, pickOffer, toggleWhole, togglePick } from "@/lib/procurement/rfq-award"
import { answerRecipients, manualOfferDoc, manualOfferRefusal, canAskReductionRound, canCancelRfq, canCloseEarly, earlyCloseFields, invitedRows, priceTrail, reductionTargets, rfqLog, rfqTakingOffers, unansweredCount } from "@/lib/procurement/rfq-detail"
import { rfqNotes, type NoteOffer, type NoteRfq } from "@/lib/procurement/rfq-notes"
import { cancelRfq, closeRfqNow, excludeOffer, recordManualOffer, requestReductionRound } from "@/lib/procurement/rfq-writes"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { awardRfq, draftSplitOrder, type AwardOfferLike, type AwardRfqInput, type RfqLike } from "@/lib/procurement/writes"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-22T09:00:00Z")
const ORG = "owner-uid"

const actor = (over: Partial<ProcActor> = {}): ProcActor => ({
  uid: "buyer",
  name: "Badr",
  isOwner: false,
  canApprove: false,
  canPrepare: true,
  canExpedite: true,
  canReceive: false,
  seesPrices: true,
  ...over,
})

const lineRfq = {
  pricingMode: "line",
  products: [
    { name: "حديد 12مم", quantity: 10, unitOfMeasure: "طن" },
    { name: "حديد 16مم", quantity: 5, unitOfMeasure: "طن" },
    { name: "أسمنت", quantity: 100, unitOfMeasure: "كيس" },
  ],
}
const A = { id: "A", price: "40500", lines: [{ rfqProductIndex: 0, unitPrice: 3000 }, { rfqProductIndex: 1, unitPrice: 2000 }, { rfqProductIndex: 2, unitPrice: 5 }] }
const B = { id: "B", price: "38650", lines: [{ rfqProductIndex: 0, unitPrice: 2800 }, { rfqProductIndex: 1, unitPrice: 2100 }, { rfqProductIndex: 2, unitPrice: 1.5 }] }
const C = { id: "C", price: "15000", lines: [{ rfqProductIndex: 0, unitPrice: 1500 }], status: "مرفوض" }

describe("award mode", () => {
  it("is per line when the RFQ asked for rates, or has one material", () => {
    expect(awardMode(lineRfq)).toBe("lines")
    expect(awardMode({ products: [{ name: "x", quantity: 2 }] })).toBe("lines")
  })
  it("is whole for a total over several materials, and for a legacy RFQ without products", () => {
    expect(awardMode({ ...lineRfq, pricingMode: "total" })).toBe("whole")
    expect(awardMode({ products: [] })).toBe("whole")
  })
})

describe("picks", () => {
  it("picks the lowest competing rate per line — an excluded offer never wins", () => {
    expect(bestPerLine(lineRfq, [A, B, C])).toEqual({ 0: { offerId: "B", unitPrice: 2800 }, 1: { offerId: "A", unitPrice: 2000 }, 2: { offerId: "B", unitPrice: 1.5 } })
    expect(pickLowest(lineRfq, [A, B, C])).toEqual({ 0: "B", 1: "A", 2: "B" })
  })
  it("a click picks a cell, a second click un-picks it", () => {
    const one = togglePick({}, 0, "A")
    expect(one).toEqual({ 0: "A" })
    expect(togglePick(one, 0, "B")).toEqual({ 0: "B" })
    expect(togglePick(one, 0, "A")).toEqual({})
  })
  it("whole pricing picks the lot and toggles it off", () => {
    const rfq = { ...lineRfq, pricingMode: "total" }
    const on = toggleWhole(rfq, {}, "A")
    expect(on).toEqual({ 0: "A", 1: "A", 2: "A" })
    expect(toggleWhole(rfq, on, "A")).toEqual({})
  })
  it("accepting one card takes every line it quoted, keeping other picks", () => {
    const partial = { id: "P", price: "100", lines: [{ rfqProductIndex: 2, unitPrice: 1 }] }
    expect(pickOffer(lineRfq, [A, partial], "P", { 0: "A" })).toEqual({ 0: "A", 2: "P" })
  })
  it("drops picks on an offer excluded since", () => {
    expect(livePicks(lineRfq, [A, B, { ...C }], { 0: "C", 1: "A" })).toEqual({ 1: "A" })
  })
})

describe("award summary — the split award", () => {
  it("groups the picks by supplier, counts n of m and the lines left over", () => {
    const s = awardSummary(lineRfq, [A, B], { 0: "B", 1: "A" })
    expect(s.picked).toBe(2)
    expect(s.of).toBe(3)
    expect(s.groups.map((g) => [g.offerId, g.lines.map((l) => l.rfqProductIndex), g.total])).toEqual([
      ["B", [0], 28000],
      ["A", [1], 10000],
    ])
    expect(s.total).toBe(38000)
    expect(s.unpicked).toEqual([2])
    expect(s.offLowest).toEqual([])
  })
  it("names the lines awarded above the lowest rate — they need a reason", () => {
    const s = awardSummary(lineRfq, [A, B], { 0: "A", 1: "A", 2: "A" })
    expect(s.offLowest).toEqual([0, 2])
    expect(lowestForLines(lineRfq, [A, B], s.groups[0].lines)).toBe(28000 + 10000 + 150)
  })
  it("whole pricing: one supplier, his total, no line prices yet", () => {
    const rfq = { ...lineRfq, pricingMode: "total" }
    const s = awardSummary(rfq, [{ id: "A", price: "40000" }, { id: "B", price: "39000" }], toggleWhole(rfq, {}, "A"))
    expect(s.groups).toHaveLength(1)
    expect(s.groups[0].total).toBe(40000)
    expect(s.groups[0].lines.every((l) => l.unitPrice === null)).toBe(true)
    expect(s.offLowest).toEqual([0, 1, 2])
  })
})

describe("the total-pricing breakdown (R-05)", () => {
  const products = [
    { rfqProductIndex: 0, name: "a", unit: "t", quantity: 10 },
    { rfqProductIndex: 1, name: "b", unit: "t", quantity: 5 },
  ]
  it("must price every line", () => {
    expect(checkBreakdown(products, { 0: "100" }, 1500)).toMatchObject({ ok: false, missing: [1] })
  })
  it("must equal the total within one riyal", () => {
    expect(checkBreakdown(products, { 0: "100", 1: "100" }, 1500).ok).toBe(true)
    expect(checkBreakdown(products, { 0: "100", 1: "100.2" }, 1500).ok).toBe(true)
    expect(checkBreakdown(products, { 0: "100", 1: "101" }, 1500)).toMatchObject({ ok: false, sum: 1505 })
  })
})

describe("the comparison's notes (R-07)", () => {
  const ctx = { lastPaidOf: () => null, onTimeOf: () => null, policies: { ...DEFAULT_POLICIES, minOffers: 2 }, now: NOW }
  const rfq: NoteRfq = { pricingMode: "line", status: "New", products: [{ name: "حديد", quantity: 10, unitOfMeasure: "طن", needBy: "2026-09-25" }, { name: "أسمنت", quantity: 10, unitOfMeasure: "كيس" }] }
  // The price is what the rates add up to, unless a test says otherwise.
  const o = (over: Partial<NoteOffer>): NoteOffer => {
    const lines = over.lines || [{ rfqProductIndex: 0, unitPrice: 100 }, { rfqProductIndex: 1, unitPrice: 10 }]
    const price = String(lines.reduce((s, l) => s + Number(l.unitPrice) * 10, 0))
    return { id: "x", companyName: "X", price, ...over, lines }
  }

  it("flags a price far below the average", () => {
    const notes = rfqNotes(rfq, [o({ id: "1" }), o({ id: "2" }), o({ id: "3", lines: [{ rfqProductIndex: 0, unitPrice: 40 }, { rfqProductIndex: 1, unitPrice: 10 }] })], ctx)
    expect(notes.find((n) => n.code === "outlier")?.params.line).toBe("حديد")
  })
  it("flags the best rate above our last price", () => {
    const notes = rfqNotes(rfq, [o({ id: "1" }), o({ id: "2" })], { ...ctx, lastPaidOf: (name: string) => (name === "حديد" ? { price: 90 } : null) })
    expect(notes.find((n) => n.code === "above_last")?.params).toMatchObject({ line: "حديد", best: 100, last: 90 })
  })
  it("says what an offer omits, when its lead misses the need, and a low on-time record", () => {
    const notes = rfqNotes(rfq, [o({ id: "1", companyName: "P", executionDuration: "5", lines: [{ rfqProductIndex: 0, unitPrice: 100 }] }), o({ id: "2", companyName: "Q" })], { ...ctx, onTimeOf: (x: NoteOffer) => (x.id === "2" ? 70 : null) })
    expect(notes.map((n) => n.code)).toEqual(expect.arrayContaining(["omits_lines", "lead_misses_need", "on_time_low"]))
    expect(notes.find((n) => n.code === "omits_lines")?.params).toEqual({ supplier: "P", count: 1 })
  })
  it("flags a guest asking cash in advance, ex-works, a late shipment and validity ending", () => {
    const notes = rfqNotes(
      rfq,
      [o({ id: "1", isGuestOffer: true, advancePercent: 100, priceBasis: "exw", deliveryBatches: [{ deliveryDate: "2026-10-01" }], validUntil: "2026-09-23" }), o({ id: "2" })],
      ctx
    )
    expect(notes.map((n) => n.code)).toEqual(expect.arrayContaining(["guest_cash_advance", "ex_works", "shipment_after_need", "validity_ending"]))
  })
  it("says the competition is short above the threshold — a guest does not count", () => {
    const notes = rfqNotes(rfq, [o({ id: "1", price: "50000" }), o({ id: "2", isGuestOffer: true, price: "60000" })], ctx)
    expect(notes.find((n) => n.code === "short_competition")?.params).toMatchObject({ count: 1 })
  })
  it("never more than six, and nothing without a competing offer", () => {
    expect(rfqNotes(rfq, [o({ id: "1", status: "مرفوض" })], ctx)).toEqual([])
  })
})

describe("early close, cancel, invitees (R-08, R-12, R-14, R-15)", () => {
  it("only the manager or the owner closes early", () => {
    expect(canCloseEarly(actor())).toBe(false)
    expect(canCloseEarly(actor({ canApprove: true }))).toBe(true)
    expect(canCloseEarly(actor({ isOwner: true }))).toBe(true)
  })
  it("an early close moves the deadline to yesterday, needs a reason, and unseals", () => {
    const rfq = { status: "New", deadline: "2026-09-30" }
    expect(earlyCloseFields(rfq, actor(), "  ", NOW)).toBeNull()
    const f = earlyCloseFields(rfq, actor(), "the rest declined", NOW)
    expect(f?.deadline).toBe("2026-09-21")
    expect(f?.closedEarly).toMatchObject({ reason: "the rest declined", originalDeadline: "2026-09-30", byName: "Badr" })
    const sealing = { ...DEFAULT_POLICIES, sealOffersUntilDeadline: true }
    expect(offersSealed(rfq, sealing, NOW)).toBe(true)
    expect(offersSealed({ ...rfq, closedEarly: f?.closedEarly }, sealing, NOW)).toBe(false)
    expect(offersSealed({ ...rfq, status: "Cancelled" }, sealing, NOW)).toBe(false)
  })
  it("a closed or awarded round takes no offers and cannot close again", () => {
    expect(rfqTakingOffers({ status: "New", deadline: "2026-09-21" }, NOW)).toBe(false)
    expect(earlyCloseFields({ status: "Awarded", deadline: "2026-09-30" }, actor(), "x", NOW)).toBeNull()
  })
  it("cancels only before an award", () => {
    expect(canCancelRfq({ status: "New" })).toBe(true)
    expect(canCancelRfq({ status: "Awarded" })).toBe(false)
    expect(canCancelRfq({ status: "Cancelled" })).toBe(false)
  })
  it("marks each invitee offered or not yet — guests are not invitees", () => {
    const rows = invitedRows({ allowedSupplierOrgIds: ["s1", "s2", "s3"] }, [{ organizationId: "s2" }, { supplierId: "guest", isGuestOffer: true }])
    expect(rows).toEqual([
      { orgId: "s2", offered: true },
      { orgId: "s1", offered: false },
      { orgId: "s3", offered: false },
    ])
  })
  it("an answer reaches every invitee, every registered bidder and the asker — never a guest or oneself", () => {
    expect(answerRecipients({ allowedSupplierOrgIds: ["s1", "s2"] }, [{ supplierId: "u9" }, { supplierId: "guest", isGuestOffer: true }], { userId: "u7" }, "buyer").sort()).toEqual(["s1", "s2", "u7", "u9"])
    expect(unansweredCount([{ reply: "" }, { reply: "yes" }, {}])).toBe(2)
  })
  it("the reduction round: once, open, unsealed, with at least one live offer; blank targets are no target", () => {
    expect(canAskReductionRound({ status: "New" }, 2, false)).toBe(true)
    expect(canAskReductionRound({ status: "New" }, 2, true)).toBe(false)
    expect(canAskReductionRound({ status: "New", reductionRound: { at: "", byId: "", byName: "", targets: [], offers: 2 } }, 2, false)).toBe(false)
    expect(reductionTargets({ 1: "2,900", 0: "", 2: "0" })).toEqual([{ rfqProductIndex: 1, unitPrice: 2900 }])
    expect(priceTrail({ priceHistory: [{ price: "40000", replacedAt: "2026-09-02" }, { price: "42000", replacedAt: "2026-09-01" }] })).toEqual([42000, 40000])
  })
  it("the log reads newest first", () => {
    expect(rfqLog([{ at: "2026-09-01", byId: "a", byName: "a", action: "awarded" }, { at: "2026-09-02", byId: "a", byName: "a", action: "cancelled" }]).map((e) => e.action)).toEqual(["cancelled", "awarded"])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The writes, against the in-memory Firestore
// ─────────────────────────────────────────────────────────────────────────────

const rfqDoc: RfqLike = {
  id: "rfq1",
  title: "حديد وأسمنت",
  organizationId: ORG,
  contractorId: "buyer",
  city: "الرياض",
  products: lineRfq.products,
}
const offerA: AwardOfferLike = { id: "A", price: "40500", supplierId: "ua", organizationId: "oa", companyName: "A Co", offerPdfUrl: "a.pdf", lines: A.lines }
const offerB: AwardOfferLike = { id: "B", price: "38650", supplierId: "ub", organizationId: "ob", companyName: "B Co", lines: B.lines }

function input(over: Partial<AwardRfqInput> = {}): AwardRfqInput {
  const s = awardSummary(lineRfq, [A, B], { 0: "B", 1: "A" })
  return {
    rfq: rfqDoc,
    offers: [offerA, offerB],
    groups: s.groups.map((g) => ({
      offer: g.offerId === "A" ? offerA : offerB,
      lines: g.lines.map((l) => ({ rfqProductIndex: l.rfqProductIndex, unitPrice: l.unitPrice })),
      total: g.total,
      requestedDeliveryDate: "2026-10-05",
      lowestForLines: lowestForLines(lineRfq, [A, B], g.lines),
      offLowest: false,
    })),
    unpicked: s.unpicked,
    awardReason: null,
    breakdown: false,
    policies: DEFAULT_POLICIES,
    ...over,
  }
}

describe("draftSplitOrder", () => {
  it("carries only the supplier's picked lines, their rates and the requested date", () => {
    const i = input()
    const po = draftSplitOrder(actor(), i, i.groups[0], NOW)
    expect(po.offerId).toBe("B")
    expect(po.lines).toEqual([expect.objectContaining({ id: "l1", name: "حديد 12مم", quantity: 10, unitPrice: 2800, rfqProductIndex: 0 })])
    expect(po.totalExVat).toBe(28000)
    expect(po.requestedDeliveryDate).toBe("2026-10-05")
    expect(po.lowestOfferTotal).toBe(28000)
    expect(po.awardReasonCode).toBeNull()
  })
})

describe("awardRfq", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("rfqs/rfq1", { ...rfqDoc, status: "New" })
    seed("offers/A", { ...offerA, status: "قيد المراجعة" })
    seed("offers/B", { ...offerB, status: "قيد المراجعة" })
    seed(`users/${ORG}`, { organizationId: ORG })
  })

  it("prepares one order per supplier, awards each offer its lines, and the RFQ keeps what nobody won", async () => {
    const out = await awardRfq(db, actor(), input(), { now: NOW })
    expect(out.map((o) => o.docNumber)).toEqual(["PO-2026/001", "PO-2026/002"])
    const orders = listCollection<PurchaseOrder>("purchaseOrders")
    expect(orders).toHaveLength(2)
    expect(orders.map((o) => o.lines.map((l) => l.rfqProductIndex))).toEqual(expect.arrayContaining([[1], [0]]))
    expect(readDoc<{ last: number }>(`mfgCounters/${ORG}__PO__2026`)?.last).toBe(2)
    const a = readDoc<{ status: string; awardedLines: number[]; awardedTotal: number; poNumber: string }>("offers/A")
    expect(a).toMatchObject({ status: "مقبول", awardedLines: [1], awardedTotal: 10000 })
    const r = readDoc<{ status: string; unawardedLines: number[]; awardSplit: boolean; log: Array<{ action: string }> }>("rfqs/rfq1")
    expect(r).toMatchObject({ status: "Awarded", unawardedLines: [2], awardSplit: true })
    expect(r?.log.map((e) => e.action)).toEqual(["awarded"])
  })

  it("refuses the whole award when an offer was excluded meanwhile", async () => {
    seed("offers/B", { ...offerB, status: "مرفوض" })
    await expect(awardRfq(db, actor(), input(), { now: NOW })).rejects.toMatchObject({ code: "offer_taken" })
    expect(listCollection("purchaseOrders")).toHaveLength(0)
    expect(readDoc<{ status: string }>("rfqs/rfq1")?.status).toBe("New")
  })

  it("refuses an RFQ no longer open, and a member who may not award", async () => {
    seed("rfqs/rfq1", { ...rfqDoc, status: "Cancelled" })
    await expect(awardRfq(db, actor(), input(), { now: NOW })).rejects.toMatchObject({ code: "rfq_not_open" })
    await expect(awardRfq(db, actor({ canPrepare: false }), input(), { now: NOW })).rejects.toMatchObject({ code: "no_permission" })
  })
})

describe("rfq writes", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("rfqs/rfq1", { ...rfqDoc, status: "New", deadline: "2026-09-30" })
    seed("offers/A", { ...offerA, status: "قيد المراجعة" })
  })

  it("closes early in the manager's name and logs it", async () => {
    await expect(closeRfqNow(db, actor(), "rfq1", "declined", NOW)).rejects.toMatchObject({ code: "no_permission" })
    await closeRfqNow(db, actor({ canApprove: true }), "rfq1", "the rest declined in writing", NOW)
    const r = readDoc<{ deadline: string; closedEarly: { reason: string }; log: Array<{ action: string; note: string }> }>("rfqs/rfq1")
    expect(r?.deadline).toBe("2026-09-21")
    expect(r?.closedEarly.reason).toBe("the rest declined in writing")
    expect(r?.log[0]).toMatchObject({ action: "closed_early", note: "the rest declined in writing" })
  })

  it("cancels with a reason — status Cancelled", async () => {
    await cancelRfq(db, actor(), "rfq1", "spec", NOW)
    expect(readDoc<{ status: string; cancellation: { code: string } }>("rfqs/rfq1")).toMatchObject({ status: "Cancelled", cancellation: { code: "spec" } })
    await expect(cancelRfq(db, actor(), "rfq1", "spec", NOW)).rejects.toMatchObject({ code: "rfq_not_open" })
  })

  it("excludes an offer only with one of the five reasons", async () => {
    await expect(excludeOffer(db, actor(), { rfqId: "rfq1", offerId: "A", supplierName: "A Co", code: "price" }, NOW)).rejects.toMatchObject({ code: "reason_required" })
    await excludeOffer(db, actor(), { rfqId: "rfq1", offerId: "A", supplierName: "A Co", code: "lead", note: "12 weeks" }, NOW)
    expect(readDoc<{ status: string; exclusion: { code: string; note: string } }>("offers/A")).toMatchObject({ status: "مرفوض", exclusion: { code: "lead", note: "12 weeks" } })
    expect(readDoc<{ log: Array<{ action: string }> }>("rfqs/rfq1")?.log[0].action).toBe("offer_excluded")
  })

  it("sends one reduction round to every live offer, and never a second", async () => {
    seed("offers/B", { ...offerB, status: "مرفوض" })
    const reached = await requestReductionRound(db, actor(), { rfqId: "rfq1", offerIds: ["A", "B"], targets: [{ rfqProductIndex: 0, unitPrice: 2900 }], message: "best and final" }, NOW)
    expect(reached).toEqual(["A"])
    expect(readDoc<{ status: string; reductionTargets: unknown[] }>("offers/A")).toMatchObject({ status: "مطلوب تخفيض", reductionTargets: [{ rfqProductIndex: 0, unitPrice: 2900 }] })
    expect(readDoc<{ status: string }>("offers/B")?.status).toBe("مرفوض")
    expect(readDoc<{ reductionRound: { offers: number } }>("rfqs/rfq1")?.reductionRound.offers).toBe(1)
    await expect(requestReductionRound(db, actor(), { rfqId: "rfq1", offerIds: ["A"], targets: [], message: "" }, NOW)).rejects.toMatchObject({ code: "rfq_not_open" })
  })

  it("records an off-platform offer in the buyer's name — an unknown company is a guest", async () => {
    const products = [{ rfqProductIndex: 0, quantity: 10 }, { rfqProductIndex: 1, quantity: 5 }, { rfqProductIndex: 2, quantity: 100 }]
    const base = { rfq: rfqDoc, supplier: { orgId: null, name: "Gulf Steel" }, rates: [{ rfqProductIndex: 0, unitPrice: 2700 }, { rfqProductIndex: 1, unitPrice: 0 }, { rfqProductIndex: 2, unitPrice: 0 }], total: null, leadDays: 7, validUntil: null, priceBasis: "site" as const, creditDays: 30, advancePercent: null, proofUrl: null, early: false }
    expect(manualOfferRefusal({ ...base, supplier: { orgId: null, name: " " } })).toBe("supplier_missing")
    expect(manualOfferRefusal({ ...base, rates: [{ rfqProductIndex: 0, unitPrice: 0 }] })).toBe("price_missing")
    const docData = manualOfferDoc(base, products, actor(), NOW.toISOString())
    expect(docData).toMatchObject({ supplierId: "guest", isGuestOffer: true, isManualOffer: true, recordedByName: "Badr", price: "27000", lines: [{ rfqProductIndex: 0, unitPrice: 2700 }], status: "قيد المراجعة" })
    const id = await recordManualOffer(db, actor(), base, products, NOW)
    expect(readDoc<{ companyName: string }>(`offers/${id}`)?.companyName).toBe("Gulf Steel")
    expect(readDoc<{ offersCount: number; log: Array<{ action: string }> }>("rfqs/rfq1")).toMatchObject({ offersCount: 1, log: [{ action: "offer_recorded" }] })
  })
})

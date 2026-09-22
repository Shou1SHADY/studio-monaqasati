/**
 * Procurement PRD 3.0 — the purchase order, derived (§5–§6): value and
 * commitment, delivery progress off the lines, lateness, who approves and
 * what blocks it, the predicates the UI and the writes share, the supplier's
 * computed record, offers and the last order day. Worked examples follow
 * demo-2 §16 where they map; dates are real, "today" is 2026-09-22.
 */

import {
  acceptedValue,
  applyReceiptToLines,
  approvalRefusal,
  awardNeedsReason,
  canCancelRemainder,
  canClose,
  canRate,
  canRecordAcceptance,
  canSend,
  canUpdateDate,
  dayParts,
  daysLate,
  isLowest,
  isSelfApproval,
  isShortCompetition,
  lastOrderDay,
  lineOutstanding,
  lowestOffer,
  offerPrice,
  poBlocks,
  poCommitment,
  poFacts,
  poLate,
  poLive,
  poOpenValue,
  poStatus,
  poValue,
  releaseHeld,
  requiredApprover,
  splitSiblings,
  supplierScore,
  todayOf,
} from "@/lib/procurement/po"
import { resolvePolicies } from "@/lib/procurement/policies"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T08:00:00Z")
const POL = DEFAULT_POLICIES

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/014",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "Rebar",
  offerId: "o1",
  projectId: "p1",
  projectName: "Tower A",
  supplierOrgId: "sup1",
  supplierUserId: "u-sup",
  supplierName: "Al-Hadid",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 280000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 280000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer",
  preparedByName: "Sara",
  createdAt: "2026-09-10T08:00:00Z",
  approverKind: "owner",
  supplierAcceptedAt: "2026-09-12T08:00:00Z",
  promisedDate: "2026-09-19",
  log: [],
  ...over,
})

const receipt = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "d1", status: "confirmed", poId: "po1", confirmedAt: "2026-09-18T10:00:00Z", lines: [{ poLineId: "l1", name: "Rebar 12 mm", unit: "t", noticeQuantity: 100, counted: 100, accepted: 100, rejected: 0, held: 0 }], ...over })

const actor = (over: Partial<ProcActor> = {}): ProcActor => ({ uid: "mgr", name: "Manager", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })

describe("policies · resolvePolicies", () => {
  it("falls back to the reference values and sanitises what it is given", () => {
    expect(resolvePolicies(null)).toEqual(POL)
    const r = resolvePolicies({ managerApprovalLimit: "200,000" as unknown as number, minOffers: 2.6, splitWindowDays: -3, directPurchaseCap: Number.NaN, sealOffersUntilDeadline: true })
    expect(r.managerApprovalLimit).toBe(200000)
    expect(r.minOffers).toBe(3)
    expect(r.splitWindowDays).toBe(30)
    expect(r.directPurchaseCap).toBe(5000)
    expect(r.sealOffersUntilDeadline).toBe(true)
  })
})

describe("lines and values — ex-VAT, net of cancellations", () => {
  it("outstanding = ordered − cancelled − accepted, never negative", () => {
    expect(lineOutstanding(line({ accepted: 30, cancelled: 10 }))).toBe(60)
    expect(lineOutstanding(line({ accepted: 105 }))).toBe(0)
  })

  it("value, open value, accepted value and the VAT-inclusive commitment", () => {
    const p = po({ lines: [line({ accepted: 40, cancelled: 10 }), line({ id: "l2", name: "Mesh", unit: "pc", quantity: 50, unitPrice: 100, accepted: 0 })] })
    expect(poValue(p)).toBe(90 * 2800 + 5000)
    expect(poOpenValue(p)).toBe(50 * 2800 + 5000)
    expect(acceptedValue(p)).toBe(40 * 2800)
    expect(poCommitment(p)).toBe(Math.round((90 * 2800 + 5000) * 1.15 * 100) / 100)
  })

  it("a lump-sum order is its total — and a part of it is null until the whole arrived", () => {
    const lump = po({ totalExVat: 50000, lines: [line({ unitPrice: null, accepted: 40 }), line({ id: "l2", unitPrice: null, quantity: 10 })] })
    expect(poValue(lump)).toBe(50000)
    expect(poOpenValue(lump)).toBe(50000)
    expect(acceptedValue(lump)).toBeNull()
    const done = po({ totalExVat: 50000, lines: [line({ unitPrice: null, accepted: 100 }), line({ id: "l2", unitPrice: null, quantity: 10, accepted: 10 })] })
    expect(acceptedValue(done)).toBe(50000)
    expect(poOpenValue(done)).toBe(0)
  })
})

describe("poStatus — stored unless accepted, then read off the lines", () => {
  it("stored states pass through", () => {
    for (const s of ["awaiting_approval", "approved", "sent", "closed", "cancelled"] as const) expect(poStatus(po({ status: s }))).toBe(s)
  })

  it("in delivery → part received → received, with the 0.995 edge", () => {
    expect(poStatus(po())).toBe("in_delivery")
    expect(poStatus(po({ lines: [line({ accepted: 1 })] }))).toBe("part_received")
    expect(poStatus(po({ lines: [line({ accepted: 99.5 })] }))).toBe("received")
    expect(poStatus(po({ lines: [line({ accepted: 99.4 })] }))).toBe("part_received")
    expect(poStatus(po({ lines: [line({ accepted: 60, cancelled: 40 })] }))).toBe("received")
  })

  it("every line must be complete — one open line keeps the order part received", () => {
    expect(poStatus(po({ lines: [line({ accepted: 100 }), line({ id: "l2", quantity: 10 })] }))).toBe("part_received")
  })
})

describe("lateness and liveness", () => {
  it("demo …/124: promised three days ago, nothing arrived → late by 3", () => {
    const p = po({ promisedDate: "2026-09-19" })
    expect(poLate(p, NOW)).toBe(true)
    expect(daysLate(p, NOW)).toBe(3)
  })

  it("not late before the date, when nothing is outstanding, or when the order is not yet accepted", () => {
    expect(poLate(po({ promisedDate: "2026-09-23" }), NOW)).toBe(false)
    expect(poLate(po({ lines: [line({ accepted: 100 })] }), NOW)).toBe(false)
    expect(poLate(po({ status: "sent" }), NOW)).toBe(false)
    expect(poLate(po({ promisedDate: null }), NOW)).toBe(false)
  })

  it("live = approved, sent, in delivery, part received", () => {
    expect(poLive(po({ status: "approved" }))).toBe(true)
    expect(poLive(po())).toBe(true)
    expect(poLive(po({ lines: [line({ accepted: 100 })] }))).toBe(false)
    expect(poLive(po({ status: "awaiting_approval" }))).toBe(false)
  })
})

describe("approval routing — the manager up to his limit, the owner above it", () => {
  it("demo …/144: 60 × 2,935 = 176,100 > 150,000 → owner; …/146: 3,400 → manager", () => {
    expect(requiredApprover(po({ lines: [line({ quantity: 60, unitPrice: 2935 })] }), POL)).toBe("owner")
    expect(requiredApprover(po({ basis: "direct", lines: [line({ quantity: 1, unitPrice: 3400 })] }), POL)).toBe("manager")
  })

  it("retroactive → owner; a solo owner's own order → owner; the limit compares ex-VAT", () => {
    expect(requiredApprover(po({ basis: "retroactive", lines: [line({ quantity: 1, unitPrice: 10 })] }), POL)).toBe("owner")
    expect(requiredApprover(po({ lines: [line({ quantity: 1, unitPrice: 10 })] }), POL, true)).toBe("owner")
    // 150,000 ex-VAT is exactly the limit: the manager's. With VAT it would be 172,500, but VAT does not count.
    expect(requiredApprover(po({ lines: [line({ quantity: 1, unitPrice: 150000 })] }), POL)).toBe("manager")
  })
})

describe("approvalRefusal — why THIS actor may not approve", () => {
  const waiting = po({ status: "awaiting_approval", lines: [line({ quantity: 10, unitPrice: 1000 })] })

  it("null when a manager with the permission may; the codes otherwise", () => {
    expect(approvalRefusal(waiting, actor(), POL)).toBeNull()
    expect(approvalRefusal(po(), actor(), POL)?.code).toBe("not_awaiting")
    expect(approvalRefusal(waiting, actor({ canApprove: false }), POL)?.code).toBe("no_permission")
    expect(approvalRefusal(waiting, actor({ uid: "buyer" }), POL)?.code).toBe("own_order")
    expect(approvalRefusal({ ...waiting, basis: "retroactive" }, actor(), POL)?.code).toBe("owner_only_retroactive")
    const big = approvalRefusal({ ...waiting, lines: [line({ quantity: 60, unitPrice: 2935 })] }, actor(), POL)
    expect(big).toEqual({ code: "above_limit", params: { value: 176100, limit: 150000 } })
  })

  it("the owner approves anything awaiting — even his own order, which is flagged, not refused", () => {
    const owner = actor({ uid: "buyer", isOwner: true, canApprove: false })
    expect(approvalRefusal(waiting, owner, POL)).toBeNull()
    expect(isSelfApproval(waiting, owner)).toBe(true)
    expect(approvalRefusal({ ...waiting, basis: "retroactive", lines: [line({ quantity: 100, unitPrice: 9999 })] }, owner, POL)).toBeNull()
    expect(approvalRefusal(po(), owner, POL)?.code).toBe("not_awaiting")
  })
})

describe("poBlocks — facts, not checkboxes", () => {
  const ctx = (over: Partial<Parameters<typeof poBlocks>[1]> = {}) => ({ supplier: null, otherOrders: [], policies: POL, now: NOW, ...over })

  it("supplier facts: no VAT, unverified, expired CR — unknown (null) never blocks", () => {
    const p = po({ status: "awaiting_approval" })
    expect(poBlocks(p, ctx({ supplier: { orgId: "sup1", hasVatNumber: null, verified: null, crExpiry: null } }))).toEqual([])
    const blocked = poBlocks(p, ctx({ supplier: { orgId: "sup1", hasVatNumber: false, verified: false, crExpiry: "2026-09-01" } }))
    expect(blocked.map((b) => b.code)).toEqual(["supplier_cr_expired", "supplier_unverified", "supplier_no_vat"])
    expect(blocked[0].params).toEqual({ date: "2026-09-01", daysAgo: 21 })
    expect(poBlocks(p, ctx({ supplier: { orgId: "sup1", hasVatNumber: true, verified: true, crExpiry: "2026-09-22" } }))).toEqual([])
  })

  it("a guest supplier never blocks on facts, even when facts are handed in", () => {
    const guest = po({ status: "awaiting_approval", isGuestSupplier: true, supplierOrgId: "guest" })
    expect(poBlocks(guest, ctx({ supplier: { orgId: "guest", hasVatNumber: false, verified: false, crExpiry: "2020-01-01" } }))).toEqual([])
  })

  it("split orders: direct orders to one supplier inside the window, before and after, above the cap", () => {
    const direct = (id: string, createdAt: string, price: number, over: Partial<PurchaseOrder> = {}) => po({ id, basis: "direct", createdAt, lines: [line({ quantity: 1, unitPrice: price })], ...over })
    const mine = direct("a", "2026-09-10T08:00:00Z", 3400, { status: "awaiting_approval" })
    // demo …/146: 3,400 alone → no block.
    expect(poBlocks(mine, ctx())).toEqual([])
    const before = direct("b", "2026-08-20T08:00:00Z", 1000)
    const after = direct("c", "2026-10-05T08:00:00Z", 1000)
    const outside = direct("d", "2026-08-01T08:00:00Z", 9000)
    const cancelled = direct("e", "2026-09-11T08:00:00Z", 9000, { status: "cancelled" })
    const other = direct("f", "2026-09-11T08:00:00Z", 9000, { supplierOrgId: "sup2" })
    const rfqBased = po({ id: "g", createdAt: "2026-09-11T08:00:00Z", lines: [line({ quantity: 1, unitPrice: 9000 })] })
    const sibs = splitSiblings(mine, [before, after, outside, cancelled, other, rfqBased, mine], POL)
    expect(sibs.map((s) => s.id).sort()).toEqual(["b", "c"])
    const blocks = poBlocks(mine, ctx({ otherOrders: [before, after, outside, cancelled, other, rfqBased, mine] }))
    expect(blocks).toEqual([{ code: "split_orders", params: { count: 3, total: 5400, cap: 5000, days: 30 } }])
    // Exactly at the cap is fine; a retroactive order is exempt.
    expect(poBlocks(direct("h", "2026-09-10T08:00:00Z", 3000, { status: "awaiting_approval" }), ctx({ otherOrders: [before, after] }))).toEqual([])
    expect(poBlocks({ ...mine, basis: "retroactive" }, ctx({ otherOrders: [before, after] }))).toEqual([])
  })

  it("guests are matched by name for the split check", () => {
    const g = (id: string, name: string, price: number) => po({ id, basis: "direct", isGuestSupplier: true, supplierOrgId: "guest", supplierName: name, createdAt: "2026-09-10T08:00:00Z", lines: [line({ quantity: 1, unitPrice: price })] })
    expect(poBlocks(g("a", "Abu Ali", 3000), ctx({ otherOrders: [g("b", "abu ali ", 3000), g("c", "Somebody else", 3000)] }))).toHaveLength(1)
  })
})

describe("the small predicates", () => {
  it("send · record acceptance · update date · cancel remainder · close", () => {
    expect(canSend(po({ status: "approved" }))).toBe(true)
    expect(canSend(po({ status: "sent" }))).toBe(false)
    expect(canRecordAcceptance(po({ status: "sent" }))).toBe(true)
    expect(canRecordAcceptance(po({ status: "approved" }))).toBe(false)
    expect(canUpdateDate(po())).toBe(true)
    expect(canUpdateDate(po({ lines: [line({ accepted: 100 })] }))).toBe(false)
    expect(canCancelRemainder(po({ lines: [line({ accepted: 40 })] }))).toBe(true)
    expect(canCancelRemainder(po({ status: "sent" }))).toBe(false)
  })

  it("close: a complete order closes by itself; an incomplete one only short, with a reason", () => {
    expect(canClose(po({ lines: [line({ accepted: 100 })] }))).toBe(true)
    expect(canClose(po())).toBe(false)
    expect(canClose(po(), "  ")).toBe(false)
    expect(canClose(po(), "Supplier out of stock")).toBe(true)
    expect(canClose(po({ status: "sent" }), "x")).toBe(false)
  })

  it("rate: received or closed, with a receipt, not yet rated", () => {
    const done = po({ lines: [line({ accepted: 100 })] })
    expect(canRate(done, [receipt()])).toBe(true)
    expect(canRate(done, [])).toBe(false)
    expect(canRate(done, [receipt({ status: "pending_confirmation" })])).toBe(false)
    expect(canRate({ ...done, rating: { onTime: true, lateByDays: 0, inFull: true, rejectPercent: 0, conformity: 5, cooperation: 5, publishAnonymously: false, byId: "x", byName: "x", at: "" } }, [receipt()])).toBe(false)
    expect(canRate(po({ status: "closed" }), [receipt()])).toBe(true)
    expect(canRate(po(), [receipt()])).toBe(false)
  })
})

describe("poFacts — the computed half of a rating", () => {
  it("on time is judged on the LAST receipt; in full at 99.5 %; rejects over everything counted; documents from the checklist", () => {
    const p = po({ promisedDate: "2026-09-15", lines: [line({ accepted: 95, rejected: 5 })] })
    const f = poFacts(p, [
      receipt({ id: "a", confirmedAt: "2026-09-14T10:00:00Z", checklist: ["delivery_note", "certificate"], lines: [{ poLineId: "l1", name: "", unit: "t", noticeQuantity: 50, counted: 50, accepted: 50, rejected: 0, held: 0 }] }),
      receipt({ id: "b", confirmedAt: "2026-09-17T10:00:00Z", checklist: ["delivery_note"], lines: [{ poLineId: "l1", name: "", unit: "t", noticeQuantity: 50, counted: 50, accepted: 45, rejected: 5, held: 0 }] }),
      receipt({ id: "other", poId: "elsewhere" }),
    ])
    expect(f.receipts).toBe(2)
    expect(f.lastReceiptDay).toBe("2026-09-17")
    expect(f.onTime).toBe(false)
    expect(f.lateByDays).toBe(2)
    expect(f.inFull).toBe(false)
    expect(f.rejectPercent).toBe(5)
    expect(f.docs).toBe(2)
    expect(f.certs).toBe(1)
  })

  it("without a receipt or a promise there is no verdict — null, not false", () => {
    expect(poFacts(po(), []).onTime).toBeNull()
    expect(poFacts(po({ promisedDate: null }), [receipt()]).onTime).toBeNull()
    expect(poFacts(po({ promisedDate: "2026-09-18" }), [receipt()]).onTime).toBe(true)
  })
})

describe("supplierScore — null is 'no record', never 0 or 100", () => {
  it("nothing accepted yet → every figure null", () => {
    expect(supplierScore([po({ supplierAcceptedAt: null, status: "sent" })], [], NOW)).toEqual({ orders: 0, onTimePercent: null, rejectPercent: null, responsePercent: null })
  })

  it("late by last receipt, by a passed promise with nothing received, or right now; rejects over accepted+rejected", () => {
    const a = po({ id: "a", promisedDate: "2026-09-15", lines: [line({ accepted: 100 })] }) // last receipt 18th → late
    const b = po({ id: "b", promisedDate: "2026-09-30", lines: [line({ accepted: 96, rejected: 4 })] }) // on time so far
    const c = po({ id: "c", promisedDate: "2026-09-19", lines: [line()] }) // promise passed, nothing came → late
    const d = po({ id: "d", promisedDate: "2026-09-10", status: "closed", lines: [line({ accepted: 100 })] }) // closed, no receipt on file, promise passed → late
    const s = supplierScore([a, b, c, d], [receipt({ poId: "a" })], NOW, { invited: 4, responded: 3 })
    expect(s.orders).toBe(4)
    expect(s.onTimePercent).toBe(25)
    expect(s.rejectPercent).toBe(1.33) // 4 of 300 counted (a 100, b 96+4, c nothing, d 100)
    expect(s.responsePercent).toBe(75)
  })

  it("invitations without a response record → response null; zero invitations → null", () => {
    expect(supplierScore([], [], NOW, { invited: 0, responded: 0 }).responsePercent).toBeNull()
  })
})

describe("offers — strings in Firestore, sometimes numbers", () => {
  const offers = [
    { id: "a", price: "12,500", status: "قيد المراجعة" },
    { id: "b", price: 11000, status: "مرفوض" },
    { id: "c", price: "12500.00", status: "مطلوب تخفيض" },
    { id: "d", price: "abc", status: "قيد المراجعة" },
    { id: "e", price: "13000", status: "قيد المراجعة" },
  ]
  it("parses defensively and ignores rejected offers", () => {
    expect(offerPrice({ price: "1,250.50" })).toBe(1250.5)
    expect(offerPrice({ price: null })).toBeNull()
    expect(offerPrice({ price: "abc" })).toBeNull()
    expect(lowestOffer(offers)?.id).toBe("a") // the rejected 11,000 does not count; a ties c and came first
    expect(isLowest(offers[2], offers)).toBe(true)
    expect(awardNeedsReason(offers[4], offers)).toBe(true)
    expect(awardNeedsReason(offers[0], offers)).toBe(false)
    expect(awardNeedsReason(offers[3], offers)).toBe(false)
  })

  it("short competition: above the threshold with fewer offers than policy", () => {
    expect(isShortCompetition(25000, 2, POL)).toBe(true)
    expect(isShortCompetition(25000, 3, POL)).toBe(false)
    expect(isShortCompetition(20000, 1, POL)).toBe(false)
    expect(isShortCompetition(null, 0, POL)).toBe(false)
  })
})

describe("last order day (§6.2) — need − lead − RFQ window − award cycle", () => {
  it("demo d8: need +9, lead 5, RFQ route → −1 (overdue); d13: need +10, lead 2, direct → +7", () => {
    const today = todayOf(NOW)
    expect(today).toBe("2026-09-22")
    expect(lastOrderDay("2026-10-01", 5, "rfq", POL)).toBe("2026-09-21")
    expect(lastOrderDay("2026-10-02", 2, "direct", POL)).toBe("2026-09-29")
    expect(dayParts("2026-10-01", 5, "rfq", POL)).toEqual({ need: "2026-10-01", lead: 5, rfq: 3, cycle: 2, lastDay: "2026-09-21" })
    expect(dayParts("2026-10-02", 2, "direct", POL)).toEqual({ need: "2026-10-02", lead: 2, rfq: 0, cycle: 1, lastDay: "2026-09-29" })
  })
})

describe("applyReceiptToLines / releaseHeld — pure, for the transaction", () => {
  it("adds accepted = counted − rejected − held, plus rejected and held, per line; untouched lines are copied", () => {
    const lines = [line({ accepted: 10 }), line({ id: "l2", quantity: 20 })]
    const out = applyReceiptToLines(lines, [{ poLineId: "l1", name: "", unit: "t", noticeQuantity: 50, counted: 50, rejected: 3, held: 2 }])
    expect(out[0]).toMatchObject({ accepted: 55, rejected: 3, held: 2 })
    expect(out[1]).toEqual(lines[1])
    expect(out[1]).not.toBe(lines[1])
    expect(lines[0].accepted).toBe(10) // the input is not mutated
  })

  it("releaseHeld moves a held quantity to accepted or rejected, capped at what is held", () => {
    const lines = [line({ accepted: 50, held: 5 })]
    expect(releaseHeld(lines, "l1", 3, "accept")[0]).toMatchObject({ accepted: 53, held: 2, rejected: 0 })
    expect(releaseHeld(lines, "l1", 9, "reject")[0]).toMatchObject({ accepted: 50, held: 0, rejected: 5 })
    expect(releaseHeld(lines, "nope", 3, "accept")[0]).toEqual(lines[0])
  })
})

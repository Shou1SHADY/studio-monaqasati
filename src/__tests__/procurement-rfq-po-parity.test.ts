/**
 * Procurement › RFQs & POs, prototype parity (R-16 … R-40): the RFQ list's
 * segments, filters and counts; a buyer's scope; the offer terms; the light
 * extension; and the order's second layer — trail, advance, revision,
 * self-issue, Projects' gates, who may act, the supplier's new date.
 */

import {
  deadlineTag,
  GENERAL_STOCK,
  inRfqSegment,
  isBuyer,
  optionCount,
  passesFilters,
  poInScope,
  rfqCategories,
  rfqInScope,
  rfqProjectKey,
  rfqStage,
  segmentCounts,
  WORKSHOP,
  type RfqListLike,
} from "@/lib/procurement/rfq-view"
import { orderTermsOf, parseOfferTerms } from "@/lib/procurement/offer-terms"
import { extendPatch, extendRefusal } from "@/lib/procurement/rfq-extend-writes"
import {
  advanceAmount,
  advanceNumber,
  advanceState,
  awaitsPmBudget,
  pmBudgetAsk,
  budgetOverrun,
  buyerSelfIssueLimit,
  dateMissesNeed,
  docTrail,
  financeBanner,
  lineInTransit,
  pmCancelOpen,
  poActs,
  poRevision,
  samplePending,
  selfIssueRefusal,
  type PurchaseOrderX,
} from "@/lib/procurement/po-extras"
import { paymentRefusal } from "@/lib/procurement/po-extra-writes"
import type { PoLine, ProcActor, PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"

const now = new Date("2026-09-28T10:00:00Z")

const rfq = (over: Partial<RfqListLike>): RfqListLike => ({ id: "r", status: "New", deadline: "2026-10-10", ...over })

describe("the RFQ list (R-33 … R-36)", () => {
  const list = [
    rfq({ id: "a", status: "Draft", projectId: "p1", city: "Riyadh", products: [{ category: "steel" }] }),
    rfq({ id: "b", status: "New", deadline: "2026-09-30", city: "Riyadh", products: [{ category: "steel" }, { category: "cement" }] }),
    rfq({ id: "c", status: "New", deadline: "2026-09-20", city: "Jeddah", purchaseSource: { kind: "mfg_purchase" }, category: "stone" }),
    rfq({ id: "d", status: "Awarded", projectId: "p1" }),
    rfq({ id: "e", status: "Cancelled", city: "Jeddah" }),
    rfq({ id: "f", status: "Awarded", directAward: true }),
  ]

  it("cancelled is its own stage and completed = awarded + cancelled", () => {
    expect(rfqStage({ status: "Cancelled" }, now)).toBe("cancelled")
    expect(list.filter((r) => inRfqSegment(r, "done")).map((r) => r.id)).toEqual(["d", "e", "f"])
    expect(segmentCounts(list, {}, now)).toEqual({ all: 6, draft: 1, open: 2, done: 3 })
  })

  it("chips count after the filters", () => {
    expect(segmentCounts(list, { city: "Jeddah" }, now)).toEqual({ all: 2, draft: 0, open: 1, done: 1 })
  })

  it("pseudo-projects: general stock and the workshop; categories come from the lines", () => {
    expect(rfqProjectKey(list[1])).toBe(GENERAL_STOCK)
    expect(rfqProjectKey(list[2])).toBe(WORKSHOP)
    expect(rfqProjectKey(list[0])).toBe("p1")
    expect(rfqCategories(list[1])).toEqual(["steel", "cement"])
    expect(rfqCategories(list[2])).toEqual(["stone"])
    expect(passesFilters(list[1], { category: "cement" }, now)).toBe(true)
  })

  it("the deadline filter: ≤3 days · more · passed awaiting award — open RFQs only", () => {
    expect(passesFilters(list[1], { deadline: "soon" }, now)).toBe(true)
    expect(passesFilters(list[2], { deadline: "past" }, now)).toBe(true)
    expect(passesFilters(list[3], { deadline: "past" }, now)).toBe(false)
    expect(passesFilters(rfq({ deadline: "2026-10-20" }), { deadline: "later" }, now)).toBe(true)
  })

  it("an option counts what it would leave inside the segment and the other filters", () => {
    expect(optionCount(list, "all", { city: "Riyadh" }, "category", "steel", now)).toBe(2)
    expect(optionCount(list, "open", { city: "Riyadh" }, "category", "steel", now)).toBe(1)
    // its own filter is ignored while counting its options
    expect(optionCount(list, "all", { city: "Riyadh" }, "city", "Jeddah", now)).toBe(2)
  })

  it("the deadline tag: n left always, amber at ≤2, passed, none on a direct award", () => {
    expect(deadlineTag(rfq({ deadline: "2026-09-30" }), now)).toEqual({ kind: "left", days: 2, urgent: true })
    expect(deadlineTag(rfq({ deadline: "2026-10-10" }), now)).toEqual({ kind: "left", days: 12, urgent: false })
    expect(deadlineTag(rfq({ deadline: "2026-09-20" }), now)).toEqual({ kind: "passed" })
    expect(deadlineTag(rfq({ directAward: true, status: "Awarded" }), now)).toEqual({ kind: "direct" })
  })
})

describe("a buyer's scope (R-18)", () => {
  const buyer = { uid: "u2", isOwner: false, canApprove: false, canPrepare: true }
  const manager = { uid: "u1", isOwner: false, canApprove: true, canPrepare: true }
  it("a buyer's RFQs are his own only; his orders include his categories'; a manager sees everything", () => {
    expect(isBuyer(buyer)).toBe(true)
    expect(rfqInScope({ createdByUserId: "u2" }, buyer)).toBe(true)
    expect(rfqInScope({ createdByUserId: "u9" }, buyer)).toBe(false)
    expect(rfqInScope({ createdByUserId: "u9" }, manager)).toBe(true)
    expect(poInScope({ preparedById: "u9", category: "steel" }, buyer, ["steel"])).toBe(true)
    expect(poInScope({ preparedById: "u9", category: "elec" }, buyer, ["steel"])).toBe(false)
  })
})

describe("an offer's terms (R-16)", () => {
  it("parses, validates and drops empties", () => {
    expect(parseOfferTerms({ priceBasis: "exw", validUntil: "2026-10-05", advancePercent: "30", creditDays: "60" }, "2026-09-28")).toEqual({ terms: { priceBasis: "exw", validUntil: "2026-10-05", advancePercent: 30, creditDays: 60 }, error: null })
    expect(parseOfferTerms({ priceBasis: "", validUntil: "", advancePercent: "", creditDays: "" }, "2026-09-28")).toEqual({ terms: {}, error: null })
    expect(parseOfferTerms({ validUntil: "2026-09-01" }, "2026-09-28").error).toBe("valid_past")
    expect(parseOfferTerms({ advancePercent: "120" }, "2026-09-28").error).toBe("advance_range")
    expect(parseOfferTerms({ creditDays: "1.5" }, "2026-09-28").error).toBe("credit_range")
  })
  it("the award carries advance, credit and basis onto the order", () => {
    expect(orderTermsOf({ advancePercent: "20", creditDays: 30, priceBasis: "site" })).toEqual({ advancePercent: 20, creditDays: 30, priceBasis: "site" })
    expect(orderTermsOf({})).toEqual({})
  })
})

describe("extend or add invitees (R-40)", () => {
  const owner = { isOwner: true, canPrepare: false }
  it("only an open RFQ asking for offers, and a date after today", () => {
    expect(extendRefusal({ status: "New" }, owner, { deadline: "2026-10-01", addSupplierOrgIds: [] }, "2026-09-28")).toBeNull()
    expect(extendRefusal({ status: "Awarded" }, owner, { deadline: "2026-10-01", addSupplierOrgIds: [] }, "2026-09-28")).toBe("rfq_not_open")
    expect(extendRefusal({ status: "New", directAward: true }, owner, { deadline: "2026-10-01", addSupplierOrgIds: [] }, "2026-09-28")).toBe("rfq_not_open")
    expect(extendRefusal({ status: "New" }, owner, { deadline: "2026-09-28", addSupplierOrgIds: [] }, "2026-09-28")).toBe("date_invalid")
    expect(extendRefusal({ status: "New" }, { isOwner: false, canPrepare: false }, { deadline: "2026-10-01", addSupplierOrgIds: [] }, "2026-09-28")).toBe("no_permission")
  })
  it("adds each new supplier once; a private RFQ's list grows too", () => {
    expect(extendPatch({ visibility: "private", allowedSupplierOrgIds: ["s1"], invitedSupplierOrgIds: [] }, { deadline: "2026-10-01", addSupplierOrgIds: ["s1", "s2", "s2"] })).toEqual({ deadline: "2026-10-01", allowedSupplierOrgIds: ["s1", "s2"], invitedSupplierOrgIds: ["s2"], added: 1 })
    expect(extendPatch({ visibility: "public" }, { deadline: "2026-10-01", addSupplierOrgIds: ["s3"] })).toEqual({ deadline: "2026-10-01", invitedSupplierOrgIds: ["s3"], added: 1 })
  })
})

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar", unit: "t", quantity: 10, unitPrice: 1000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrderX> = {}): PurchaseOrderX =>
  ({
    id: "po1",
    organizationId: "o",
    docNumber: "PO-2026/014",
    status: "awaiting_approval",
    basis: "rfq",
    rfqId: "r",
    rfqTitle: "",
    offerId: "of",
    projectId: "p1",
    supplierOrgId: "s",
    supplierUserId: null,
    supplierName: "S",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 10_000,
    vatRate: 0.15,
    offersCount: 3,
    lowestOfferTotal: 10_000,
    shortCompetition: false,
    noOfficialQuote: false,
    preparedById: "u2",
    preparedByName: "Turki",
    createdAt: "2026-09-20T08:00:00Z",
    approverKind: "manager",
    log: [],
    ...over,
  }) as PurchaseOrderX
const actor = (over: Partial<ProcActor> = {}): ProcActor => ({ uid: "u2", name: "Turki", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })

describe("the order's money and advance (R-21, R-24)", () => {
  it("no advance · pending before approval · requested once approved · paid", () => {
    expect(advanceState(po())).toBe("none")
    expect(advanceState(po({ advancePercent: 30 }))).toBe("pending")
    expect(advanceState(po({ advancePercent: 30, approvedAt: "2026-09-21" }))).toBe("requested")
    expect(advanceState(po({ advancePercent: 30, approvedAt: "2026-09-21", financePayments: [{ no: "P1", kind: "adv", amount: 3450, valueDate: "2026-09-22", reference: "x", byName: "F", at: "2026-09-22" }] }))).toBe("paid")
    expect(advanceAmount(po({ advancePercent: 30 }))).toBe(3450)
    expect(advanceNumber(po())).toBe("ADV-2026/014")
  })
  it("the banner: a held invoice wins over a payment", () => {
    const pay = { no: "P1", kind: "inv" as const, amount: 100, valueDate: "2026-09-22", reference: "x", byName: "F", at: "2026-09-22" }
    const hold = { id: "h1", invoiceNo: "INV-1", amount: 50, reason: "qty" as const, text: "t", need: "n", at: "", byName: "F", state: "open" as const }
    expect(financeBanner(po({ approvedAt: "x", financePayments: [pay], financeHolds: [hold] }))?.kind).toBe("hold")
    expect(financeBanner(po({ approvedAt: "x", financePayments: [pay] }))?.kind).toBe("paid")
    expect(financeBanner(po({ approvedAt: "x" }))?.kind).toBe("sent")
    expect(financeBanner(po())).toBeNull()
  })
  it("Finance records a payment only on an approved order, with a reference", () => {
    const input = { kind: "inv" as const, amount: 100, valueDate: "2026-09-22", reference: "TR-1" }
    expect(paymentRefusal(po(), input)).toBe("wrong_state")
    expect(paymentRefusal(po({ status: "accepted", approvedAt: "x" }), input)).toBeNull()
    expect(paymentRefusal(po({ status: "accepted", approvedAt: "x" }), { ...input, reference: " " })).toBe("reason_required")
  })
})

describe("the document trail (R-20)", () => {
  it("prepared → approved (now while waiting) … the advance step appears when agreed", () => {
    const steps = docTrail(po({ advancePercent: 20 }), [])
    expect(steps.map((s) => s.key)).toEqual(["prepared", "approved", "finance", "sent", "accepted", "advance", "notice", "receipt", "invoice"])
    expect(steps.find((s) => s.key === "approved")?.state).toBe("now")
    const sent = docTrail(po({ status: "sent", approvedAt: "2026-09-21", sentAt: "2026-09-21", sentByName: "B", sentChannel: null }), [])
    expect(sent.find((s) => s.key === "sent")?.flags).toEqual(["outside"])
    expect(sent.find((s) => s.key === "accepted")?.state).toBe("now")
  })
  it("the receipt step lists the goods receipts", () => {
    const d = { id: "d1", status: "confirmed", poId: "po1", docNumber: "GR-2026/001", confirmedAt: "2026-09-25T00:00:00Z", lines: [{ poLineId: "l1", name: "", unit: "", noticeQuantity: 4, accepted: 4 }] } as ReceiptFact & { poId: string }
    const steps = docTrail(po({ status: "accepted", approvedAt: "x", sentAt: "x", supplierAcceptedAt: "x", lines: [line({ accepted: 4 })] }), [d])
    expect(steps.find((s) => s.key === "receipt")).toMatchObject({ state: "now", who: ["GR-2026/001"], at: "2026-09-25" })
  })
})

describe("revision, transit, Projects' cancel (R-28, R-29)", () => {
  it("every reduction is a new revision under the same number", () => {
    const log = [
      { at: "", byId: "", byName: "", action: "remainder_cancelled" as const },
      { at: "", byId: "", byName: "", action: "reject_decided" as const, params: { decision: "reduce" } },
      { at: "", byId: "", byName: "", action: "reject_decided" as const, params: { decision: "replace" } },
    ]
    expect(poRevision({ log })).toBe(3)
    expect(poRevision({ log: [] })).toBe(1)
  })
  it("in transit = notified, not yet received — never more than is still to arrive", () => {
    const d = { id: "n", status: "pending_confirmation", poId: "po1", lines: [{ poLineId: "l1", name: "", unit: "", noticeQuantity: 20 }] } as ReceiptFact & { poId: string }
    expect(lineInTransit(po(), line({ accepted: 4 }), [d])).toBe(6)
  })
  it("Projects' cancel request is open while something is still to arrive", () => {
    const asked = po({ pmCancels: { l1: { reason: "closed" } } })
    expect(pmCancelOpen(asked, line())).toBe(true)
    expect(pmCancelOpen(asked, line({ cancelled: 10 }))).toBe(false)
    expect(pmCancelOpen(po(), line())).toBe(false)
  })
})

describe("who may act (R-26) and the buyer's self-issue (R-32)", () => {
  it("the owner reads somebody else's order; a buyer acts on his own only", () => {
    expect(poActs(po(), actor({ uid: "o", isOwner: true }))).toMatchObject({ ownerReadOnly: true, acts: false })
    expect(poActs(po({ preparedById: "o" }), actor({ uid: "o", isOwner: true })).acts).toBe(true)
    expect(poActs(po(), actor({ uid: "u3" }))).toMatchObject({ notMine: true, acts: false })
    expect(poActs(po(), actor({ uid: "u3", canPrepare: false }))).toMatchObject({ acts: true })
    expect(poActs(po(), actor({ uid: "u1", canApprove: true })).acts).toBe(true)
  })
  it("a buyer issues his own order at or under the limit, nothing blocking", () => {
    const small = po({ totalExVat: 1_800, basis: "direct" })
    expect(buyerSelfIssueLimit(null)).toBe(2_000)
    expect(buyerSelfIssueLimit({ buyerSelfIssueLimit: 5_000 })).toBe(5_000)
    expect(selfIssueRefusal(small, actor(), 2_000, 0)).toBeNull()
    expect(selfIssueRefusal(po({ basis: "direct" }), actor(), 2_000, 0)).toBe("over_limit")
    expect(selfIssueRefusal(po({ totalExVat: 1_800 }), actor(), 2_000, 0)).toBe("not_direct")
    expect(selfIssueRefusal(small, actor({ uid: "u3" }), 2_000, 0)).toBe("not_preparer")
    expect(selfIssueRefusal(small, actor(), 2_000, 1)).toBe("blocked")
    expect(selfIssueRefusal({ ...small, returnedReason: "fix" }, actor(), 2_000, 0)).toBe("returned")
  })
})

describe("Projects' gates (R-25)", () => {
  const items = [{ id: "b1", quantity: 10, estCost: 900, pmSample: true, pmSub: "sub" }, { id: "b2", quantity: 5, estCost: 0 }]
  const mine = po({ lines: [line({ boqItemId: "b1" })] })
  it("over the item's budget, counting the other live orders", () => {
    expect(budgetOverrun(mine, items, [])).toEqual([{ itemId: "b1", over: 1_000 }])
    const other = po({ id: "po2", status: "accepted", lines: [line({ boqItemId: "b1", quantity: 1 })] }) as PurchaseOrder
    expect(budgetOverrun(mine, items, [other])).toEqual([{ itemId: "b1", over: 2_000 }])
    // An overrun nobody referred does not wait (no dead end); a referred one waits until answered.
    expect(awaitsPmBudget(mine)).toBe(false)
    expect(pmBudgetAsk(mine, budgetOverrun(mine, items, []))).toBe(true)
    expect(awaitsPmBudget({ ...mine, pmBudget: { state: "pending" } })).toBe(true)
    expect(awaitsPmBudget({ ...mine, pmBudget: { state: "renegotiate" } })).toBe(true)
    expect(awaitsPmBudget({ ...mine, pmBudget: { state: "accepted" } })).toBe(false)
    expect(pmBudgetAsk({ ...mine, pmBudget: { state: "accepted" } }, budgetOverrun(mine, items, []))).toBe(false)
  })
  it("a line whose item needs an approved sample blocks", () => {
    expect(samplePending(mine, items).map((i) => i.id)).toEqual(["b1"])
    expect(samplePending(mine, [{ ...items[0], pmSub: "appA" }])).toEqual([])
  })
})

describe("the supplier's new date (R-31)", () => {
  it("warns when it falls after the date we asked for", () => {
    expect(dateMissesNeed({ requestedDeliveryDate: "2026-10-05" }, "2026-10-07")).toBe(true)
    expect(dateMissesNeed({ requestedDeliveryDate: "2026-10-05" }, "2026-10-05")).toBe(false)
    expect(dateMissesNeed({ requestedDeliveryDate: null }, "2026-10-07")).toBe(false)
  })
})

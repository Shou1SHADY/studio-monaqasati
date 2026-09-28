// The RFQ fix wave (prototype parity): one gate for running an RFQ, the
// buyer's own RFQs, the owner reading once he has staff, the whole list
// counted (not a page of 20), bulk acts that never erase a published RFQ or
// widen a private one, the queries deep link, «أفضل سعر» over full offers
// only, the guest supplier at the award, and the new-RFQ form's defaults.

import { actsOnRfq, awardsOnRfq, closesRfqEarly, hasProcurementStaff, isRfqBuyer, ownerReadsRfqs, rfqMine, runsRfqs, type RfqRunner } from "@/lib/procurement/rfq-access"
import { canCloseEarly, canRunRfq } from "@/lib/procurement/rfq-detail"
import { extendRefusal } from "@/lib/procurement/rfq-extend-writes"
import { bulkDeleteSplit, bulkPublishPatch, rfqFiles, rfqPage, rfqPageTab, rfqStage, segmentCounts, sortRfqs, type RfqListLike } from "@/lib/procurement/rfq-view"
import { bestOfferIds, coversAllLines, guestAwardRefusal, type OrderableOffer } from "@/lib/procurement/rfq-award"
import { DEFAULT_RFQ_PRICING, asksForOffers, effectivePricing, firstDeadline, isSaudiVat, showsPricingChoice, step3Refusals } from "@/lib/procurement/rfq-form"
import type { TeamGroup } from "@/lib/permissions"

const NOW = new Date("2026-09-28T09:00:00Z")
const who = (over: Partial<RfqRunner> = {}): RfqRunner => ({ uid: "u1", isOwner: false, canPrepare: false, canApprove: false, ...over })
const MANAGER = who({ uid: "mgr", canApprove: true, canPrepare: true })
const BUYER = who({ uid: "buyer", canPrepare: true })
const SUPPLY_CHAIN = who({ uid: "sc", managesRfqs: true })
const EXPEDITER = who({ uid: "exp" })
const OWNER_SOLO = who({ uid: "own", isOwner: true, canApprove: true, canPrepare: true })
const OWNER_TEAM = { ...OWNER_SOLO, ownerHasTeam: true }

describe("who runs an RFQ (rfq-access)", () => {
  it("maps the prototype roles onto permission ids", () => {
    expect(runsRfqs(MANAGER)).toBe(true)
    expect(runsRfqs(BUYER)).toBe(true)
    expect(runsRfqs(SUPPLY_CHAIN)).toBe(true)
    expect(runsRfqs(who({ managesRfqs: true }))).toBe(true)
    expect(runsRfqs(who({ canApprove: true }))).toBe(true)
    expect(runsRfqs(EXPEDITER)).toBe(false)
  })

  it("the owner runs RFQs alone, and reads them once he has procurement staff", () => {
    expect(runsRfqs(OWNER_SOLO)).toBe(true)
    expect(runsRfqs(OWNER_TEAM)).toBe(false)
    expect(ownerReadsRfqs(OWNER_TEAM)).toBe(true)
    expect(ownerReadsRfqs(OWNER_SOLO)).toBe(false)
    expect(canRunRfq(OWNER_TEAM)).toBe(false)
    expect(canCloseEarly(OWNER_TEAM)).toBe(false)
    expect(canCloseEarly(OWNER_SOLO)).toBe(true)
  })

  it("a buyer acts only on the RFQs he raised; the manager on every one", () => {
    const mine = { createdByUserId: "buyer" }
    const theirs = { createdByUserId: "someone" }
    expect(isRfqBuyer(BUYER)).toBe(true)
    expect(isRfqBuyer(MANAGER)).toBe(false)
    expect(rfqMine(mine, BUYER)).toBe(true)
    expect(rfqMine(theirs, BUYER)).toBe(false)
    expect(rfqMine({ contractorId: "buyer" }, BUYER)).toBe(true)
    expect(actsOnRfq(theirs, BUYER)).toBe(false)
    expect(actsOnRfq(theirs, MANAGER)).toBe(true)
    expect(actsOnRfq(mine, EXPEDITER)).toBe(false)
  })

  it("awarding needs offers.accept (it prepares orders); closing early is the manager's", () => {
    const mine = { createdByUserId: "sc" }
    expect(actsOnRfq(mine, SUPPLY_CHAIN)).toBe(true)
    expect(awardsOnRfq(mine, SUPPLY_CHAIN)).toBe(false)
    expect(awardsOnRfq({ createdByUserId: "buyer" }, BUYER)).toBe(true)
    expect(closesRfqEarly({ createdByUserId: "buyer" }, BUYER)).toBe(false)
    expect(closesRfqEarly({}, MANAGER)).toBe(true)
  })

  it("counts as staff the members who source or approve (as team.ts does)", () => {
    const groups = [
      { id: "g-fin", organizationId: "org", name: "Finance", permissions: ["offers.accept", "po.approve"] },
      { id: "g-sc", organizationId: "org", name: "Supply chain", permissions: ["rfq.manage", "po.expedite"] },
      { id: "g-exp", organizationId: "org", name: "Expediter", permissions: ["po.expedite"] },
      { id: "g-view", organizationId: "org", name: "Viewer", permissions: ["projects.view"] },
    ] as TeamGroup[]
    expect(hasProcurementStaff([{ id: "m3", organizationRole: "member", defaultGroupId: "g-sc" }], groups, "org")).toBe(true)
    expect(hasProcurementStaff([{ id: "m4", organizationRole: "member", defaultGroupId: "g-exp" }], groups, "org")).toBe(false)
    expect(hasProcurementStaff([{ id: "org", organizationRole: "owner" }], groups, "org")).toBe(false)
    expect(hasProcurementStaff([{ id: "org", organizationRole: "owner" }, { id: "m1", organizationRole: "member", defaultGroupId: "g-view" }], groups, "org")).toBe(false)
    expect(hasProcurementStaff([{ id: "m2", organizationRole: "member", defaultGroupId: "g-fin" }], groups, "org")).toBe(true)
  })

  it("the extend write refuses a buyer on someone else's RFQ and the reading owner", () => {
    const input = { deadline: "2026-10-05", addSupplierOrgIds: [] }
    expect(extendRefusal({ status: "New", createdByUserId: "buyer" }, BUYER, input, "2026-09-28")).toBeNull()
    expect(extendRefusal({ status: "New", createdByUserId: "other" }, BUYER, input, "2026-09-28")).toBe("no_permission")
    expect(extendRefusal({ status: "New" }, OWNER_TEAM, input, "2026-09-28")).toBe("no_permission")
    expect(extendRefusal({ status: "New" }, SUPPLY_CHAIN, input, "2026-09-28")).toBe("no_permission")
    expect(extendRefusal({ status: "New", createdByUserId: "sc" }, SUPPLY_CHAIN, input, "2026-09-28")).toBeNull()
  })
})

describe("the RFQ list (rfq-view)", () => {
  it("reads «إسناد مباشر» and «جاهز للمقارنة» like the prototype's RFST", () => {
    expect(rfqStage({ status: "Awarded", directAward: true }, NOW)).toBe("direct")
    expect(rfqStage({ status: "Awarded" }, NOW)).toBe("awarded")
    expect(rfqStage({ status: "New", deadline: "2026-10-05", offersCount: 2 }, NOW, true)).toBe("open")
    expect(rfqStage({ status: "New", deadline: "2026-10-05", offersCount: 2 }, NOW, false)).toBe("compare")
    expect(rfqStage({ status: "New", deadline: "2026-10-05", offersCount: 0 }, NOW, false)).toBe("open")
    expect(rfqStage({ status: "New", deadline: "2026-10-05", offersCount: 2 }, NOW)).toBe("open")
  })

  it("counts every RFQ of the org, not the first page of 20 (P0)", () => {
    const rows: RfqListLike[] = Array.from({ length: 45 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, status: i < 5 ? "Draft" : i < 30 ? "New" : "Awarded", deadline: "2026-10-10" }))
    expect(segmentCounts(rows, {}, NOW)).toEqual({ all: 45, draft: 5, open: 25, done: 15 })
    const first = rfqPage(rows, 1)
    expect(first.shown).toHaveLength(24)
    expect(first.hasMore).toBe(true)
    expect(rfqPage(rows, 2).hasMore).toBe(false)
    expect(rfqPage(rows, 2).shown).toHaveLength(45)
  })

  it("sorts newest first with a stable tie-break", () => {
    const rows = [
      { id: "b", createdAt: "2026-09-01T00:00:00Z" },
      { id: "a", createdAt: "2026-09-01T00:00:00Z" },
      { id: "c", createdAt: { seconds: Date.parse("2026-09-20T00:00:00Z") / 1000 } },
      { id: "d" },
    ]
    expect(sortRfqs(rows).map((r) => r.id)).toEqual(["c", "a", "b", "d"])
  })

  it("bulk delete erases drafts only — a published RFQ goes to «ألغِ الطلب»", () => {
    const split = bulkDeleteSplit([
      { id: "d", status: "Draft" },
      { id: "n", status: "New" },
      { id: "a", status: "Awarded" },
    ])
    expect(split.drafts.map((r) => r.id)).toEqual(["d"])
    expect(split.toCancel.map((r) => r.id)).toEqual(["n"])
    expect(split.skipped.map((r) => r.id)).toEqual(["a"])
  })

  it("bulk publish keeps a private draft private", () => {
    expect(bulkPublishPatch({ id: "p", status: "Draft", visibility: "private" }, "2026-09-28T09:00:00Z")).toEqual({ status: "New", visibility: "private", publishedAt: "2026-09-28T09:00:00Z" })
    expect(bulkPublishPatch({ id: "q", status: "Draft" }, "x")?.visibility).toBe("public")
    expect(bulkPublishPatch({ id: "r", status: "New", visibility: "private" }, "x")).toBeNull()
  })

  it("the card's «الاستفسارات» deep link opens the queries tab", () => {
    expect(rfqPageTab("inquiries")).toBe("inquiries")
    expect(rfqPageTab("qa")).toBe("inquiries")
    expect(rfqPageTab("details")).toBe("details")
    expect(rfqPageTab(null)).toBe("list")
    expect(rfqPageTab("nonsense")).toBe("list")
  })

  it("lists every attachment once, the legacy PDF included", () => {
    expect(rfqFiles({ attachments: [{ url: "u1", name: "spec.pdf" }, "u2", { url: "u1" }], pdfUrl: "u1" })).toEqual([
      { url: "u1", name: "spec.pdf" },
      { url: "u2", name: null },
    ])
    expect(rfqFiles({ pdfUrl: "legacy" })).toEqual([{ url: "legacy", name: null }])
  })
})

describe("«أفضل سعر» and the guest at the award (rfq-award)", () => {
  const RFQ = { pricingMode: "line", products: [{ name: "Steel", quantity: 10, unit: "t" }, { name: "Cement", quantity: 100, unit: "bag" }] }
  const offer = (id: string, lines: Array<[number, number]>, extra: Partial<OrderableOffer> = {}): OrderableOffer => ({
    id,
    status: "قيد المراجعة",
    price: lines.reduce((s, [i, r]) => s + r * (i === 0 ? 10 : 100), 0),
    lines: lines.map(([rfqProductIndex, unitPrice]) => ({ rfqProductIndex, unitPrice })),
    ...extra,
  })

  it("never calls a partial offer the best price", () => {
    const partial = offer("p", [[0, 100]])
    const full1 = offer("f1", [[0, 120], [1, 10]])
    const full2 = offer("f2", [[0, 110], [1, 12]])
    expect(coversAllLines(RFQ, partial)).toBe(false)
    expect(coversAllLines(RFQ, full1)).toBe(true)
    expect([...bestOfferIds(RFQ, [partial, full1, full2], () => true)]).toEqual(["f1"])
  })

  it("needs two full offers, and a supplier who can be given an order", () => {
    const full1 = offer("f1", [[0, 120], [1, 10]])
    const full2 = offer("f2", [[0, 110], [1, 12]])
    expect(bestOfferIds(RFQ, [full1, offer("p", [[0, 1]])], () => true).size).toBe(0)
    expect(bestOfferIds(RFQ, [full1, full2], (o) => o.id !== "f1").size).toBe(0)
    expect(bestOfferIds(RFQ, [full1, { ...full2, status: "مرفوض" }], () => true).size).toBe(0)
  })

  it("a guest blocks the award until he registers or the buyer accepts him explicitly", () => {
    expect(guestAwardRefusal([{ id: "g", isGuestOffer: true }], false)).toBe("guest_unregistered")
    expect(guestAwardRefusal([{ id: "g", isGuestOffer: true }], true)).toBeNull()
    expect(guestAwardRefusal([{ id: "r", isGuestOffer: false }], false)).toBeNull()
  })
})

describe("the new-RFQ form (rfq-form)", () => {
  it("prices per line by default, so a multi-line RFQ can be split", () => {
    expect(DEFAULT_RFQ_PRICING).toBe("line")
    expect(effectivePricing(DEFAULT_RFQ_PRICING, 3, true, "public")).toBe("line")
    expect(effectivePricing("total", 3, true, "private")).toBe("total")
    expect(effectivePricing("line", 3, false, "public")).toBe("total")
    expect(effectivePricing("total", 1, true, "public")).toBe("line")
    expect(effectivePricing("total", 3, true, "direct")).toBe("line")
  })

  it("offers the pricing choice only with more than one line and not for a direct award", () => {
    expect(showsPricingChoice(1, "public")).toBe(false)
    expect(showsPricingChoice(2, "public")).toBe(true)
    expect(showsPricingChoice(2, "direct")).toBe(false)
  })

  it("a direct award asks for no deadline; otherwise the deadline is after today", () => {
    expect(asksForOffers("direct")).toBe(false)
    expect(step3Refusals({ city: "Riyadh", deadline: "", audience: "direct", today: "2026-09-28" })).toEqual([])
    expect(step3Refusals({ city: "Riyadh", deadline: "", audience: "public", today: "2026-09-28" })).toEqual(["deadline"])
    expect(step3Refusals({ city: "Riyadh", deadline: "2026-09-28", audience: "private", today: "2026-09-28" })).toEqual(["deadline_past"])
    expect(step3Refusals({ city: "", deadline: "2026-09-29", audience: "public", today: "2026-09-28" })).toEqual(["city"])
    expect(firstDeadline("2026-09-30")).toBe("2026-10-01")
  })

  it("checks a Saudi VAT number the guest types", () => {
    expect(isSaudiVat("300000000000003")).toBe(true)
    expect(isSaudiVat("300000000000004")).toBe(false)
    expect(isSaudiVat("30000000000003")).toBe(false)
    expect(isSaudiVat("")).toBe(false)
  })
})

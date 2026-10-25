/**
 * Procurement 2.0 — what the RFQ page's offers tab shows, as numbers (RFQ-02/04/05/06, CMP-04, G-02, G-03, R-31): the worked
 * example RFQ-2026/011 of the PRD built into rows, the one lowest complete offer, the split award and its saving, filters with
 * counts, sort, the path's steps and the page's state, and an offer's own story.
 */

import { bestCards, buildOfferRows, filterCounts, matchesFilter, offerHistory, sortRows, visibleFilters, warrantyOf, type RowOffer } from "@/lib/procurement/rfq-offers-view"
import { pageState, pathModel, requestsOfRfq, stepClasses } from "@/lib/procurement/rfq-path"
import type { IncomingDoc } from "@/lib/procurement/incoming-state"
import type { PurchaseOrder } from "@/lib/procurement/types"

const TODAY = "2026-10-22"

const rfq = {
  pricingMode: "line",
  paymentTermsList: [{ pct: 100, days: 30 }],
  products: [
    { name: "زوايا حديد 50×50×5 مم", quantity: 175, unitOfMeasure: "م", warrantyMonths: 24 },
    { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
  ],
}

const offer = (id: string, name: string, lines: RowOffer["lines"], over: Partial<RowOffer> = {}): RowOffer =>
  ({ id, companyName: name, supplierId: id, organizationId: id, status: "قيد المراجعة", vatRegistered: true, leadDays: 5, validUntil: "2026-11-30", createdAt: "2026-10-21T08:00:00Z", offerPdfUrl: "https://x/q.pdf", creditDays: 30, advancePercent: 0, lines, ...over }) as RowOffer

const OFFERS: RowOffer[] = [
  offer("quality", "مصنع الجودة", [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }], { leadDays: 7 }),
  offer("east", "الشرق", [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12, warrantyMonths: 24 }, { rfqProductIndex: 1, unitPrice: 3.8 }], { leadDays: 4 }),
  offer("mid", "الوسطى", [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6, warrantyMonths: 12 }, { rfqProductIndex: 1, unitPrice: 3.9 }], { leadDays: 6, creditDays: 60 }),
  offer("horizon", "الأفق", [{ rfqProductIndex: 0, unitPrice: 12.9 }, { rfqProductIndex: 1, unitPrice: 3.7 }], { leadDays: 3 }),
  offer("hope", "الأمل", [{ rfqProductIndex: 0, unitPrice: 80, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 13.5, packLen: 4 }], { isGuestOffer: true, supplierId: "guest", organizationId: "guest", guestContact: { name: "سعد", phone: "0551112222" }, validUntil: "2026-10-24", createdAt: "2026-10-22T07:00:00Z", leadDays: 5 }),
  offer("modern", "البناء الحديث", [{ rfqProductIndex: 1, unitPrice: 14.2, packLen: 4 }], { skippedItems: [0], leadDays: 9 }),
]

const build = (decisions = {}, offers = OFFERS) => buildOfferRows({ rfq, offers, decisions, today: TODAY, tiePercent: 0.5 })
const hasRecord = () => true

describe("the worked example RFQ-2026/011 on the page (G-02, G-03, R-31)", () => {
  const { rows, ev } = build()
  const by = (id: string) => rows.find((r) => r.id === id)!

  it("the lowest complete offer is ONE figure: 3,840.43 — the same on the evaluation, row #1 and the best-of card", () => {
    const cards = bestCards({ rows, ev, rfq, limit: 3, hasRecord })
    expect(ev.lowestComplete?.id).toBe("quality")
    expect(by("quality").grossH).toBe(384043)
    expect(by("quality").rank).toBe(1)
    expect(cards.lowest?.grossH).toBe(384043)
    expect(cards.lowest?.id).toBe(sortRows(rows, "price")[0].id)
  })

  it("every offer's total includes VAT and carries its distance from the lowest; the partial one does not rank", () => {
    expect(by("hope").grossH).toBe(400200)
    expect(by("hope").ev.deltaPct).toBeCloseTo(4.21, 1)
    expect(by("modern").rank).toBeNull()
    expect(by("modern").ev.partial).toBe(true)
    expect(by("modern").coverage).toEqual({ covered: 1, of: 2, partial: true })
  })

  it("the tie on a line marks every supplier inside the 0.5 % band as «الأقل»: 12.50 and 12.51 both", () => {
    const line1 = ev.lines.find((l) => l.rfqProductIndex === 0)!
    expect(line1.lowestIds).toEqual(expect.arrayContaining(["quality", "east"]))
    expect(line1.lowestIds).not.toContain("mid")
  })

  it("splitting the award is cheaper by 82.80 with two suppliers, two orders — and says so only when it is worth saying", () => {
    const cards = bestCards({ rows, ev, rfq, limit: 3, hasRecord })
    expect(cards.split?.mix.grossH).toBe(375763)
    expect(cards.split?.mix.savingH).toBe(8280)
    expect(cards.split?.mix.suppliers).toBe(2)
    expect(cards.split?.orders).toBe(2)
    expect(cards.split?.newSupplier).toBe(false)
    expect(bestCards({ rows, ev, rfq, limit: 3, hasRecord: (r) => r.origin !== "guest" }).split?.newSupplier).toBe(true)
  })

  it("the fastest card is the fastest COMPLETE offer, and the competition card shows the thinnest line against the limit", () => {
    const cards = bestCards({ rows, ev, rfq, limit: 6, hasRecord })
    expect(cards.fastest).toMatchObject({ partial: false })
    expect(cards.fastest?.row.id).toBe("horizon")
    expect(cards.competition).toMatchObject({ live: 5, limit: 6 })
    expect(bestCards({ rows, ev, rfq, limit: 3, hasRecord }).competition).toBeNull()
  })

  it("an expired validity is flagged, a validity ending within two days is «ينتهي قريباً»", () => {
    expect(by("hope").validity).toBe("soon")
    expect(by("hope").tags.map((t) => t.code)).toContain("new_today")
    const out = build({}, [offer("old", "قديم", [{ rfqProductIndex: 0, unitPrice: 1 }, { rfqProductIndex: 1, unitPrice: 1 }], { validUntil: "2026-10-01" })])
    expect(out.rows[0].validity).toBe("expired")
    expect(out.rows[0].tags.map((t) => t.code)).toContain("expired")
  })

  it("warranty is read against what the line asks, and a payment term other than the RFQ's is flagged", () => {
    expect(warrantyOf(by("east").offer, rfq)).toEqual({ months: 24, short: false })
    expect(warrantyOf(by("mid").offer, rfq)).toEqual({ months: 12, short: true })
    expect(warrantyOf(by("quality").offer, rfq)).toBeNull()
    expect(by("mid").differsTerms).toBe(true)
    expect(by("quality").differsTerms).toBe(false)
  })
})

describe("filters, counts and sort (RFQ-06)", () => {
  const decisions = {
    horizon: { shortlist: { at: "x", byId: "u", byName: "n" }, exclusion: null },
    mid: { shortlist: null, exclusion: { code: "warranty" as const, text: null, at: "x", byId: "u", byName: "n" } },
  }
  const { rows } = build(decisions)

  it("counts every filter and hides one nobody matches except «الكل»", () => {
    const counts = filterCounts(rows)
    expect(counts).toMatchObject({ all: 6, complete: 4, partial: 1, shortlist: 1, offplatform: 1, excluded: 1 })
    expect(counts.terms_ok).toBe(5)
    expect(visibleFilters(counts, "all")).toEqual(["all", "complete", "partial", "shortlist", "terms_ok", "offplatform", "excluded"])
    expect(visibleFilters({ ...counts, shortlist: 0 }, "all")).not.toContain("shortlist")
    expect(visibleFilters({ ...counts, shortlist: 0 }, "shortlist")).toContain("shortlist")
  })

  it("an excluded offer leaves the live filters and the ranking but stays in «الكل» and «مستبعدة»", () => {
    const mid = rows.find((r) => r.id === "mid")!
    expect(matchesFilter(mid, "complete")).toBe(false)
    expect(matchesFilter(mid, "all")).toBe(true)
    expect(matchesFilter(mid, "excluded")).toBe(true)
    expect(mid.rank).toBeNull()
    expect(sortRows(rows, "price").at(-1)!.id).toBe("mid")
  })

  it("sorts by price, by lead time, by latest and by rating — the excluded always last", () => {
    expect(sortRows(rows, "price").map((r) => r.id)).toEqual(["quality", "east", "horizon", "hope", "modern", "mid"])
    expect(sortRows(rows, "fastest").map((r) => r.id).slice(0, 3)).toEqual(["horizon", "east", "hope"])
    expect(sortRows(rows, "latest")[0].id).toBe("hope")
    const rated = buildOfferRows({ rfq, offers: OFFERS, decisions, today: TODAY, ratingOf: (o) => ({ quality: 4.1, east: 4.8 } as Record<string, number>)[o.id] ?? null }).rows
    expect(sortRows(rated, "rating").slice(0, 2).map((r) => r.id)).toEqual(["east", "quality"])
  })

  it("a legacy offer excluded the old way (status مرفوض) is excluded too", () => {
    const legacy = build({}, [{ ...OFFERS[0], status: "مرفوض", exclusion: { code: "spec", note: "x", byId: "u", at: "x" } } as RowOffer])
    expect(legacy.rows[0].excluded).toBe(true)
    expect(legacy.ev.hasLive).toBe(false)
    expect(bestCards({ rows: legacy.rows, ev: legacy.ev, rfq, limit: 3, hasRecord }).noLive).toBe(true)
  })
})

describe("the page's state and its path (RFQ-01, FLW-03)", () => {
  it("is open until the deadline passes, comparing after it or after an order was cancelled for a re-award, then awarded or cancelled", () => {
    expect(pageState({ status: "New", deadline: "2026-10-22" }, TODAY).stage).toBe("open")
    expect(pageState({ status: "New", deadline: "2026-10-21" }, TODAY).stage).toBe("compare")
    expect(pageState({ status: "New", deadline: "2026-11-30", awardReopened: { at: "x" } }, TODAY).stage).toBe("compare")
    expect(pageState({ status: "Awarded", deadline: "2026-10-01", closedEarly: { at: "2026-10-18" } }, TODAY)).toMatchObject({ stage: "awarded", closedEarly: true })
    expect(pageState({ status: "Cancelled" }, TODAY).stage).toBe("cancelled")
    expect(pageState({ status: "Draft" }, TODAY).stage).toBe("draft")
    expect(pageState({ status: "New", directAward: true, deadline: "2026-10-01" }, TODAY)).toMatchObject({ stage: "open", direct: true })
  })

  const request = (over: Partial<IncomingDoc> = {}): IncomingDoc => ({ organizationId: "o", mrKey: "pm:P1:04", src: "pm", no: "MR 04", needBy: "2026-11-03", createdAt: "2026-10-10T00:00:00Z", requestedBy: { id: "u", name: "سالم" }, requestedFor: { kind: "member", name: "سالم القحطاني" }, lines: [{ no: 1, name: "حديد", unit: "م", qty: 175, rfqId: "R1", v: 1 }], ...over }) as IncomingDoc

  it("names the request, its source, who asked and the need date — or «من المشتريات مباشرة»", () => {
    const withRequest = pathModel({ rfq: { id: "R1", status: "New", deadline: "2026-10-30", createdAt: "2026-10-11T08:00:00Z" }, today: TODAY, offerCount: 3, requests: requestsOfRfq([request(), request({ mrKey: "x", lines: [{ no: 1, name: "z", unit: "u", qty: 1, rfqId: "R9", v: 1 }] })], "R1"), orders: [], awardWindowDays: 2 })
    expect(withRequest.request).toEqual({ refs: ["MR 04"], keys: ["pm:P1:04"], source: "pm", requester: "سالم القحطاني", needBy: "2026-11-03" })
    expect(withRequest.published).toBe("2026-10-11")
    expect(withRequest.award).toEqual({ kind: "can", before: "2026-10-30" })
    expect(withRequest.offers).toMatchObject({ count: 3, until: "2026-10-30", closed: false })
    const direct = pathModel({ rfq: { id: "R2", status: "New", deadline: "2026-10-30", needBy: "2026-11-09" }, today: TODAY, offerCount: 0, requests: [], orders: [], awardWindowDays: 2 })
    expect(direct.request).toMatchObject({ refs: [], source: null, needBy: "2026-11-09" })
    expect(direct.award).toEqual({ kind: "waiting" })
  })

  it("comparing: «رسِّ قبل» is the deadline plus the award window, and the steps and the current segment follow the orders", () => {
    const comparing = pathModel({ rfq: { id: "R1", status: "New", deadline: "2026-10-21" }, today: TODAY, offerCount: 6, requests: [], orders: [], awardWindowDays: 2 })
    expect(comparing.award).toEqual({ kind: "comparing", by: "2026-10-23", daysLeft: 1 })
    expect(comparing.offers).toMatchObject({ closed: true, closedOn: "2026-10-21" })
    expect(stepClasses(comparing, "compare")).toEqual({ published: "done", offers: "done", award: "can", orders: "", receipt: "" })

    const po = (status: string, lines: Array<Record<string, number>>) => ({ id: status, status, lines, log: [] }) as unknown as PurchaseOrder
    const awarded = pathModel({ rfq: { id: "R1", status: "Awarded", deadline: "2026-10-30", closedEarly: { at: "2026-10-18T09:00:00Z" } }, today: TODAY, offerCount: 6, requests: [], orders: [po("sent", [{ quantity: 10, accepted: 0 }]), po("cancelled", [])], awardWindowDays: 2 })
    expect(awarded.award).toEqual({ kind: "awarded", on: null, early: true })
    expect(awarded.offers).toMatchObject({ closedEarly: true, closedOn: "2026-10-18" })
    expect(awarded.orders).toBe(1)
    expect(awarded.current).toBe("supply")
    expect(stepClasses(awarded, "awarded")).toMatchObject({ award: "done", orders: "done", receipt: "on" })
  })

  it("a cancelled RFQ says why", () => {
    const p = pathModel({ rfq: { id: "R1", status: "Cancelled", cancellation: { code: "need" } }, today: TODAY, offerCount: 2, requests: [], orders: [], awardWindowDays: 2, reasonOf: (c) => `reason:${c}` })
    expect(p.award).toEqual({ kind: "cancelled", reason: "reason:need" })
    expect(stepClasses(p, "cancelled").award).toBe("")
  })
})

describe("«ما جرى» (RFQ-07)", () => {
  it("tells the offer's story oldest first: sent, updated, our ask, his cut, our decisions, the award", () => {
    const o = { ...OFFERS[0], createdAt: "2026-10-12T08:00:00Z", poId: "PO1", awardedAt: "2026-10-20T10:00:00Z", bafo: { at: "2026-10-14T08:00:00Z", byId: "u", byName: "n", replyBy: "2026-10-16", note: null, round: 1, answered: { at: "2026-10-15T08:00:00Z", n: 3, kind: "lowered" } }, versions: [{ n: 1, at: "2026-10-12", total: 4000 }, { n: 2, at: "2026-10-13", total: 3900 }, { n: 3, at: "2026-10-15", total: 3339.5, bafoReply: "lowered" }] } as unknown as RowOffer
    const { rows } = build({}, [o])
    const story = offerHistory(rows[0], [
      { kind: "shortlist", at: "2026-10-13T12:00:00Z", byName: "نورة" },
      { kind: "exclude", at: "2026-10-16T12:00:00Z", byName: "نورة", meta: { code: "warranty" } },
      { kind: "restore", at: "2026-10-17T12:00:00Z", byName: "نورة" },
    ])
    expect(story.map((e) => e.kind)).toEqual(["submitted", "updated", "shortlisted", "bafo_asked", "bafo_lowered", "excluded", "restored", "awarded"])
    expect(story.find((e) => e.kind === "bafo_lowered")?.params).toMatchObject({ n: 3, from: 3900 })
    expect(story.find((e) => e.kind === "excluded")?.params).toEqual({ reason: "warranty" })
  })

  it("a visitor's offer opens with the visitor-link line", () => {
    const { rows } = build()
    expect(offerHistory(rows.find((r) => r.id === "hope")!, [])[0].kind).toBe("submitted_link")
  })
})

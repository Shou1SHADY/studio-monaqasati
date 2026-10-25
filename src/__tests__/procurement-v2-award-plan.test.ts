/**
 * Procurement 2.0 — the award plan, pure (WP-S3-07): the groups per supplier × site (G-05, R-13), the reasons the numbers back (AW_OK, R-15,
 * G-04), thin competition per LINE (G-18, R-08), the pick pinned to the offer version (G-14, R-14), expiry (R-19), lump sums whole (R-17),
 * the approval class (R-07, R-36), arrival against the need date, the order document (pieces, R-20; no VAT, R-18), «آخر شراء» by
 * specification (CMP-05) and «اختر الأقل لكل بند».
 */

import { cellPickable, draftOrder, dropStale, pickAllOf, pickLowestPerLine, planAward, type AwardInput, type PlanContext, type PlanOffer, type PlanRfq } from "@/lib/procurement/award-plan"
import { lastPaidFor, specKeyOf } from "@/lib/procurement/prices"
import { resolvePolicies } from "@/lib/procurement/policies"

const policies = resolvePolicies(null)
const ctxOf = (over: Partial<PlanContext> = {}): PlanContext => ({
  today: "2026-10-22",
  policies,
  decisions: {},
  locked: {},
  liveOfferIds: new Set(),
  actor: { uid: "buyer", isOwner: false, canPrepare: true, canApprove: false },
  onTimeOf: () => null,
  hasRecord: () => true,
  ...over,
})
const prod = (name: string, quantity: number, over: Record<string, unknown> = {}) => ({ name, quantity, unitOfMeasure: "م", deliverySiteId: "s1", needBy: "2026-11-05", ...over })
const rfq = (over: Record<string, unknown> = {}): PlanRfq => ({ id: "r1", status: "New", deadline: "2026-10-30", pricingMode: "line", organizationId: "org", products: [prod("حديد", 175), prod("خشب", 320)], ...over }) as unknown as PlanRfq
const offer = (id: string, lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}): PlanOffer =>
  ({ id, companyName: id, organizationId: `org_${id}`, supplierId: `u_${id}`, status: "قيد المراجعة", lines, vatRegistered: true, vatRate: 0.15, leadDays: 5, validUntil: "2026-11-30", offerPdfUrl: `${id}.pdf`, versions: [{ n: 1 }], price: "0", ...over }) as unknown as PlanOffer
const pin = (li: number, offerId: string, rev = 1) => ({ li, offerId, rev })
const A = offer("A", [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }], { leadDays: 5 })
const B = offer("B", [{ rfqProductIndex: 0, unitPrice: 14 }, { rfqProductIndex: 1, unitPrice: 3.9 }], { leadDays: 2, offerPdfUrl: null })
const C = offer("C", [{ rfqProductIndex: 0, unitPrice: 15 }, { rfqProductIndex: 1, unitPrice: 4 }], { leadDays: 9 })
const plan = (input: Partial<AwardInput> & { picks: AwardInput["picks"] }, ctx = ctxOf(), offers = [A, B, C], r = rfq()) => planAward({ rfq: r, offers, ...input }, ctx)

describe("groups — one order per supplier × delivery site (G-05, R-13)", () => {
  it("one supplier on two sites is two groups; two suppliers on one site are two; the lines of a group are only its own", () => {
    const r = rfq({ products: [prod("حديد", 10, { deliverySiteId: "s1" }), prod("خشب", 20, { deliverySiteId: "s2" })] })
    const p = plan({ picks: [pin(0, "A"), pin(1, "A")] }, ctxOf(), [A], r)
    expect(p.groups).toHaveLength(2)
    expect(p.groups.map((g) => g.lines.map((l) => l.li))).toEqual([[0], [1]])
    expect(new Set(p.groups.map((g) => g.siteKey)).size).toBe(2)
    expect(plan({ picks: [pin(0, "A"), pin(1, "B")] }).groups).toHaveLength(2)
  })
  it("the lines nobody won (and no live order carries) return to «الواردة»; a locked line does not", () => {
    expect(plan({ picks: [pin(0, "A")] }).unawarded).toEqual([1])
    expect(plan({ picks: [pin(0, "A")] }, ctxOf({ locked: { 1: { poId: "p", poNumber: "PO-1" } } })).unawarded).toEqual([])
  })
})

describe("AW_OK — a structured reason only when the numbers back it (R-15, G-04)", () => {
  it("fastest: backed when he is faster on every passed-over line; refused otherwise", () => {
    const ok = plan({ picks: [pin(0, "B")], why: { code: "fastest" } })
    expect(ok.whyEligible.fastest).toBe(true)
    expect(ok.refusal).toBeNull()
    const no = plan({ picks: [pin(0, "C")], why: { code: "fastest" } })
    expect(no.whyEligible.fastest).toBe(false)
    expect(no.refusal).toBe("reason_untrue")
  })
  it("official_quote: the lowest has none and he has; warranty: the lowest fails the required months", () => {
    const quiet = offer("Q", [{ rfqProductIndex: 0, unitPrice: 9, warrantyMonths: 6 }, { rfqProductIndex: 1, unitPrice: 3 }], { offerPdfUrl: null })
    const r = rfq({ products: [prod("حديد", 175, { warrantyMonths: 12 }), prod("خشب", 320)] })
    const p = plan({ picks: [pin(0, "A")], why: { code: "official_quote" } }, ctxOf(), [A, quiet], r)
    expect(p.whyEligible.official_quote).toBe(true)
    expect(p.whyEligible.warranty).toBe(true)
    expect(p.refusal).toBeNull()
  })
  it("reliability needs a record that is better; one_supplier needs fewer suppliers than the cheapest split", () => {
    const withRecord = ctxOf({ onTimeOf: (o) => (o.id === "B" ? 95 : o.id === "A" ? 60 : null) })
    expect(plan({ picks: [pin(0, "B")] }, withRecord).whyEligible.reliability).toBe(true)
    expect(plan({ picks: [pin(0, "C")] }, withRecord).whyEligible.reliability).toBe(false)
    const cheapSplit = [offer("X", [{ rfqProductIndex: 0, unitPrice: 10 }, { rfqProductIndex: 1, unitPrice: 5 }]), offer("Y", [{ rfqProductIndex: 0, unitPrice: 11 }, { rfqProductIndex: 1, unitPrice: 4 }])]
    const one = plan({ picks: [pin(0, "X"), pin(1, "X")] }, ctxOf(), cheapSplit)
    expect(one.whyEligible.one_supplier).toBe(true)
  })
  it("«سبب آخر» is always open but needs its words (4 characters)", () => {
    expect(plan({ picks: [pin(0, "C")], why: { code: "other", text: "ab" } }).refusal).toBe("reason_text_short")
    expect(plan({ picks: [pin(0, "C")], why: { code: "other", text: "عميل قديم" } }).refusal).toBeNull()
    expect(plan({ picks: [pin(0, "C")] }).refusal).toBe("reason_required")
  })
  it("the lowest — and every tie within 0.5 % — needs no reason (R-31)", () => {
    const tie = offer("T", [{ rfqProductIndex: 0, unitPrice: 12.55 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
    expect(plan({ picks: [pin(0, "T")] }, ctxOf(), [A, tie]).refusal).toBeNull()
  })
})

describe("G-18 / R-08 — thin competition is counted per LINE and never blocks", () => {
  it("a line with two live offers of three asked for, above 20,000, asks a reason; with it the plan stands", () => {
    const r = rfq({ products: [prod("حديد", 1000)] })
    const two = [offer("A", [{ rfqProductIndex: 0, unitPrice: 30 }]), offer("B", [{ rfqProductIndex: 0, unitPrice: 31 }])]
    const need = plan({ picks: [pin(0, "A")] }, ctxOf(), two, r)
    expect(need.lowComp.required).toBe(true)
    expect(need.refusal).toBe("lowcomp_reason_required")
    const ok = plan({ picks: [pin(0, "A")], lowComp: { code: "urgent" } }, ctxOf(), two, r)
    expect(ok.refusal).toBeNull()
    expect(ok.groups[0].thinN).toBe(2)
  })
  it("an excluded offer does not count as competition", () => {
    const r = rfq({ products: [prod("حديد", 1000)] })
    const three = [offer("A", [{ rfqProductIndex: 0, unitPrice: 30 }]), offer("B", [{ rfqProductIndex: 0, unitPrice: 31 }]), offer("C", [{ rfqProductIndex: 0, unitPrice: 32 }])]
    expect(plan({ picks: [pin(0, "A")] }, ctxOf(), three, r).lowComp.required).toBe(false)
    const out = ctxOf({ decisions: { C: { shortlist: null, exclusion: { code: "spec", text: null, at: "x", byId: "u", byName: "u" } } } })
    expect(plan({ picks: [pin(0, "A")] }, out, three, r).lowComp.required).toBe(true)
  })
})

describe("G-14 / R-14 / R-19 — the pick is pinned to the version", () => {
  it("drops a pick whose offer was edited, excluded, expired or whose line is locked — each with its reason", () => {
    const edited = { ...A, versions: [{ n: 1 }, { n: 2 }] } as PlanOffer
    expect(plan({ picks: [pin(0, "A", 1)] }, ctxOf(), [edited]).dropped).toEqual([{ li: 0, offerId: "A", why: "changed" }])
    expect(plan({ picks: [pin(0, "A")] }, ctxOf({ decisions: { A: { shortlist: null, exclusion: { code: "spec", text: null, at: "x", byId: "u", byName: "u" } } } })).dropped[0].why).toBe("excluded")
    expect(plan({ picks: [pin(0, "A")] }, ctxOf(), [{ ...A, validUntil: "2026-10-21" } as PlanOffer]).dropped[0].why).toBe("expired")
    expect(plan({ picks: [pin(0, "A")] }, ctxOf({ liveOfferIds: new Set(["A"]) })).dropped).toEqual([])
    expect(plan({ picks: [pin(0, "A")] }, ctxOf({ locked: { 0: { poId: "p", poNumber: "PO-1" } } })).dropped[0].why).toBe("locked")
    expect(plan({ picks: [pin(1, "A")] }, ctxOf(), [offer("H", [{ rfqProductIndex: 0, unitPrice: 1 }])]).dropped[0].why).toBe("missing")
  })
  it("the last valid day is valid; the day after is not (R-19)", () => {
    expect(plan({ picks: [pin(0, "A")] }, ctxOf(), [{ ...A, validUntil: "2026-10-22" } as PlanOffer]).refusal).toBeNull()
    expect(plan({ picks: [pin(0, "A")] }, ctxOf(), [{ ...A, validUntil: "2026-10-21" } as PlanOffer]).refusal).toBe("offer_expired")
  })
  it("dropStale reports what the comparison removes from the selection and keeps the rest", () => {
    const edited = { ...A, versions: [{ n: 1 }, { n: 2 }] } as PlanOffer
    const ev = plan({ picks: [] }, ctxOf(), [edited, B]).evaluation
    const r = dropStale({ 0: { offerId: "A", rev: 1 }, 1: { offerId: "B", rev: 1 } }, [edited, B], ev, ctxOf())
    expect(r.picks).toEqual({ 1: { offerId: "B", rev: 1 } })
    expect(r.dropped).toEqual([{ li: 0, offerId: "A", why: "changed" }])
  })
})

describe("CMP-12 / R-17 — a lump sum is awarded whole, as one order of one value", () => {
  const r = rfq({ pricingMode: "total" })
  const L = offer("L", [], { lump: 5000, price: "5000" })
  it("some of its lines is refused; all of them is one order with no line prices", () => {
    expect(plan({ picks: [pin(0, "L")] }, ctxOf(), [L], r).refusal).toBe("lump_partial")
    const p = plan({ picks: [pin(0, "L"), pin(1, "L")] }, ctxOf(), [L], r)
    expect(p.refusal).toBeNull()
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]).toMatchObject({ lump: true, netH: 500000 })
  })
  it("a lump offer awards the lines the other orders do not carry", () => {
    const p = plan({ picks: [pin(1, "L")] }, ctxOf({ locked: { 0: { poId: "p", poNumber: "PO-1" } } }), [L], r)
    expect(p.refusal).toBeNull()
  })
  it("«للطلب كاملاً فقط»: every line to him or none", () => {
    const whole = offer("W", [{ rfqProductIndex: 0, unitPrice: 1 }, { rfqProductIndex: 1, unitPrice: 1 }], { whole: true })
    expect(plan({ picks: [pin(0, "W")] }, ctxOf(), [whole]).refusal).toBe("whole_partial")
    expect(plan({ picks: [pin(0, "W"), pin(1, "W")] }, ctxOf(), [whole]).refusal).toBeNull()
  })
})

describe("the approval class and the arrival (R-07, R-36, CMP-07)", () => {
  const big = offer("Big", [{ rfqProductIndex: 0, unitPrice: 800 }, { rfqProductIndex: 1, unitPrice: 400 }])
  it("within the limit a buyer's order is sent at once; above it only the owner may approve now, otherwise it waits", () => {
    expect(plan({ picks: [pin(0, "A")] }).groups[0]).toMatchObject({ approval: "sent", sendsNow: true })
    const above = plan({ picks: [pin(0, "Big"), pin(1, "Big")], lowComp: { code: "urgent" } }, ctxOf(), [big])
    expect(above.groups[0]).toMatchObject({ approval: "above_limit", sendsNow: false, approveNowAllowed: false })
    const owner = ctxOf({ actor: { uid: "o", isOwner: true, canPrepare: true, canApprove: true } })
    const key = above.groups[0].key
    const now = plan({ picks: [pin(0, "Big"), pin(1, "Big")], lowComp: { code: "urgent" }, approveNow: [key] }, owner, [big])
    expect(now.groups[0]).toMatchObject({ approveNowAllowed: true, sendsNow: true })
    expect(plan({ picks: [pin(0, "Big"), pin(1, "Big")], lowComp: { code: "urgent" }, approveNow: [key] }, ctxOf(), [big]).refusal).toBe("approve_not_owner")
  })
  it("the limit is compared INCLUDING VAT (G-18): 140,000 ex-VAT is 161,000 and goes above", () => {
    const edge = offer("E", [{ rfqProductIndex: 0, unitPrice: 800 }, { rfqProductIndex: 1, unitPrice: 0.0001 }])
    expect(plan({ picks: [pin(0, "E")], lowComp: { code: "urgent" } }, ctxOf(), [edge]).groups[0].approval).toBe("above_limit")
  })
  it("a manager who prepared it cannot approve it: it waits", () => {
    const mgr = ctxOf({ actor: { uid: "m", isOwner: false, canPrepare: true, canApprove: true } })
    expect(plan({ picks: [pin(0, "A")] }, mgr).groups[0]).toMatchObject({ approval: "prepared_by_approver", sendsNow: false })
  })
  it("arrival = today + the acceptance window + his lead time, against the need date", () => {
    const g = plan({ picks: [pin(0, "A")] }).groups[0]
    expect(g.arrival).toBe("2026-10-28")
    expect(g.late).toBe(false)
    const late = plan({ picks: [pin(0, "C")], why: { code: "other", text: "عميل قديم" } }, ctxOf(), [A, B, C], rfq({ products: [prod("حديد", 175, { needBy: "2026-10-25" }), prod("خشب", 320)] }))
    expect(late.groups[0].late).toBe(true)
  })
  it("a direct award above the cap is the owner's alone", () => {
    const d = plan({ picks: [pin(0, "Big")], lowComp: { code: "urgent" } }, ctxOf(), [big], rfq({ directAward: true }))
    expect(d.groups[0].approval).toBe("direct_over")
  })
})

describe("the order document (R-18, R-20, tags)", () => {
  const pieces = offer("P", [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6, packKey: "قطعة 6 م" }, { rfqProductIndex: 1, unitPrice: 3.6 }], { vatRegistered: false, vatRate: 0 })
  const draft = (picks: AwardInput["picks"], extra: Partial<Parameters<typeof draftOrder>[0]> = {}) => {
    const r = rfq({ products: [prod("زوايا", 175, { material: { nodeId: "n1", specs: [] } }), prod("خشب", 320)] })
    const pl = plan({ picks }, ctxOf(), [pieces], r)
    return draftOrder({ rfq: r, offer: pieces, group: pl.groups[0], plan: pl, offersCount: 1, lowestOfferTotal: null, whyText: null, lowCompText: null, preparer: { uid: "buyer", name: "ريم" }, actor: ctxOf().actor, policies, now: "2026-10-22T09:00:00Z", round: 1, site: null, ...extra })
  }
  it("a piece line counts pieces in the pack's name, keeps the requested quantity, and carries the specification key", () => {
    const d = draft([pin(0, "P")])
    expect(d.lines[0]).toMatchObject({ unit: "قطعة 6 م", quantity: 30, unitPrice: 74, pk: 6, need: 175, base: "م", rfqProductIndex: 0, materialId: "n1" })
    expect(d.lines[0].specKey).toMatch(/^spec:n1\|/)
    expect(d.totalExVat).toBe(2220)
  })
  it("PO-01: each order line copies its RFQ product's specification and tree path; a product with neither adds no key", () => {
    const r = rfq({
      products: [
        prod("أسياخ حديد", 175, { description: "القطر 16 مم · الدرجة G60", material: { nodeId: "n16", path: [{ ar: "الحديد", en: "Steel" }, { ar: "حديد التسليح", en: "Rebar" }, { ar: "أسياخ", en: "Bars" }], specs: [{ name: { ar: "القطر" }, value: { ar: "16 مم" } }] } }),
        prod("خشب", 320),
      ],
    })
    const both = offer("P", [{ rfqProductIndex: 0, unitPrice: 74 }, { rfqProductIndex: 1, unitPrice: 3.6 }], { vatRegistered: false, vatRate: 0 })
    const pl = plan({ picks: [pin(0, "P"), pin(1, "P")] }, ctxOf(), [both], r)
    const d = draftOrder({ rfq: r, offer: both, group: pl.groups[0], plan: pl, offersCount: 1, lowestOfferTotal: null, whyText: null, lowCompText: null, preparer: { uid: "buyer", name: "ريم" }, actor: ctxOf().actor, policies, now: "2026-10-22T09:00:00Z", round: 1, site: null })
    expect(d.lines[0]).toMatchObject({ spec: "القطر 16 مم · الدرجة G60", path: "الحديد › حديد التسليح" })
    expect(d.lines[1]).not.toHaveProperty("spec")
    expect(d.lines[1]).not.toHaveProperty("path")
  })
  it("a supplier who is not VAT-registered gets an order with no VAT", () => {
    expect(draft([pin(0, "P")])).toMatchObject({ vatRate: 0, noVat: true, siteKey: "org_P|s1", offerRev: 1, awardRound: 1, basis: "rfq", status: "awaiting_approval" })
  })
})

describe("«اختر الأقل لكل بند» and a whole supplier", () => {
  it("picks each line's cheapest cell with its version; skips locked lines; a safe filter limits to verified quotes", () => {
    const ev = plan({ picks: [] }).evaluation
    const byId = new Map([A, B, C].map((o) => [o.id, o]))
    expect(pickLowestPerLine(ev, byId, ctxOf())).toEqual({ 0: { offerId: "A", rev: 1 }, 1: { offerId: "A", rev: 1 } })
    expect(pickLowestPerLine(ev, byId, ctxOf({ locked: { 0: { poId: "p", poNumber: "n" } } }))).toEqual({ 1: { offerId: "A", rev: 1 } })
    expect(pickLowestPerLine(ev, byId, ctxOf(), { allow: (id) => id !== "A" })[0].offerId).toBe("B")
  })
  it("«رسِّ كل ما سعّره عليه» takes every open line he priced and nothing a locked line holds", () => {
    const ev = plan({ picks: [] }).evaluation
    expect(pickAllOf(ev, A, ctxOf())).toEqual({ 0: { offerId: "A", rev: 1 }, 1: { offerId: "A", rev: 1 } })
    expect(pickAllOf(ev, A, ctxOf({ locked: { 1: { poId: "p", poNumber: "n" } } }))).toEqual({ 0: { offerId: "A", rev: 1 } })
    expect(cellPickable(ev, "A", 1, ctxOf({ locked: { 1: { poId: "p", poNumber: "n" } } }))).toEqual({ ok: false, why: "locked" })
  })
})

describe("«آخر شراء» by specification (CMP-05)", () => {
  const spec = (size: string) => specKeyOf({ name: "زوايا", unitOfMeasure: "م", material: { nodeId: "n1", specs: [{ name: { ar: "المقاس" }, value: { ar: size } }] } }).specKey as string
  const row = (id: string, specKey: string | null, price: number, day: string) => ({ id, organizationId: "o", materialKey: "زوايا|م", specKey, name: "زوايا", unit: "م", supplierOrgId: "s", supplierName: "s", price, day, kind: "po" as const, poId: id, poNumber: `PO-${id}` })
  it("matches only the same specification, the latest first; a line with no key falls back to its name and unit", () => {
    const history = [row("a", spec("50"), 4, "2026-08-01"), row("b", spec("50"), 4.35, "2026-09-01"), row("c", spec("40"), 3, "2026-10-01")]
    expect(lastPaidFor(history, { specKey: spec("50"), name: "زوايا", unit: "م" })?.poNumber).toBe("PO-b")
    expect(lastPaidFor(history, { specKey: spec("60"), name: "زوايا", unit: "م" })).toBeNull()
    expect(lastPaidFor(history, { specKey: null, name: "زوايا", unit: "م" })?.poNumber).toBe("PO-c")
  })
  it("a material outside the list has no key", () => {
    expect(specKeyOf({ name: "x", unitOfMeasure: "م", material: null })).toEqual({ materialId: null, specKey: null })
  })
})

/**
 * Procurement 2.0, «طلبات العروض» (screens table, NFR-03, G-03, §8): the list is one pure method — states as the RFQ page derives them,
 * the prototype's filters (search · site · category · who it reaches · sort) with the counts each option would leave, 24 at a time and
 * «عرض N أخرى» over hundreds of RFQs, the lowest complete offer as the evaluation's own number, and ONE primary action per state.
 */

import { toCalcOffer } from "@/lib/procurement/award-plan"
import { displayDocNumber } from "@/lib/procurement/format"
import { lowestCompleteOffer } from "@/lib/procurement/offer-calc"
import { pageState } from "@/lib/procurement/rfq-path"
import { rfqReviewHref } from "@/lib/procurement/rfq-routes"
import {
  EMPTY_LIST_FILTER,
  RFQ_LIST_PAGE,
  actionHref,
  buildRfqRows,
  defaultView,
  listCounts,
  listFacets,
  listFilterActive,
  listRfqs,
  primaryAction,
  reachCountOf,
  reachOf,
  rfqCategoryKeys,
  rfqSiteKeys,
  sortRows,
  type ListOffer,
  type ListRfq,
  type RfqListFilter,
} from "@/lib/procurement/rfq-list"

const TODAY = "2026-10-22"
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const pad = (n: number) => String(n).padStart(3, "0")

const rfq = (over: Partial<ListRfq> & { id: string }): ListRfq => ({
  status: "New",
  title: `طلب ${over.id}`,
  rfqNumber: `RFQ-2026/${pad(Number(over.id.replace(/\D/g, "")) || 0)}`,
  deadline: day(3),
  audience: "public",
  reachedCount: 8,
  projectId: null,
  subCategoryIds: ["steel"],
  pricingMode: "line",
  createdAt: `${day(-5)}T08:00:00.000Z`,
  products: [{ name: "حديد 16", quantity: 10, unit: "طن", deliverySiteId: "site_a" }],
  ...over,
})

const offer = (id: string, rfqId: string, over: Partial<ListOffer> = {}): ListOffer =>
  ({ id, rfqId, status: "قيد المراجعة", companyName: `مورد ${id}`, supplierId: id, createdAt: `${day(-1)}T08:00:00.000Z`, ...over }) as ListOffer

const build = (rfqs: ListRfq[], offers: ListOffer[] = [], extra: Partial<Parameters<typeof buildRfqRows>[0]> = {}) =>
  buildRfqRows({
    rfqs,
    offers,
    decisions: {},
    orders: [],
    today: TODAY,
    tiePercent: 0.5,
    locale: "ar",
    siteLabel: (k) => `موقع ${k}`,
    categoryLabel: (k) => `فئة ${k}`,
    ...extra,
  })

const F = (over: Partial<RfqListFilter> = {}): RfqListFilter => ({ ...EMPTY_LIST_FILTER, ...over })

describe("a row's state is the RFQ page's own", () => {
  it("open until the deadline passes, then comparing; awarded, cancelled and a draft keep theirs", () => {
    const rows = build([
      rfq({ id: "o" }),
      rfq({ id: "c", deadline: day(-2) }),
      rfq({ id: "a", status: "Awarded", deadline: day(-9) }),
      rfq({ id: "x", status: "Cancelled" }),
      rfq({ id: "d", status: "Draft", rfqNumber: null }),
    ])
    expect(rows.map((r) => r.state)).toEqual(["open", "compare", "awarded", "cancelled", "draft"])
    for (const r of rows) expect(r.state).toBe(pageState(r.rfq, TODAY).stage)
  })

  it("an award before the deadline is «أُغلق مبكراً» and ends on the day it was closed", () => {
    const [r] = build([rfq({ id: "e", status: "Awarded", deadline: day(-1), closedEarly: { at: `${day(-2)}T10:00:00.000Z`, originalDeadline: day(4), reason: "award" } })])
    expect(r.state).toBe("awarded")
    expect(r.closedEarly).toBe(true)
    expect(r.endDay).toBe(day(-2))
  })

  it("keeps a legacy RFQ — no number, no audience, no reach count, no sub-categories — in the list", () => {
    const [r] = build([{ id: "old", status: "New", title: "قديم", deadline: day(1), category: "مواد بناء", visibility: "private", allowedSupplierOrgIds: ["s1", "s2"], products: [{ name: "اسمنت", quantity: 5 }] } as ListRfq])
    expect(r.number).toBeNull()
    expect(r.reach).toBe("private")
    expect(r.reachCount).toBe(2)
    expect(r.categoryKeys).toEqual(["مواد بناء"])
    expect(r.state).toBe("open")
    expect(r.daysLeft).toBe(1)
  })
})

describe("who it reaches, where it goes, what it is filed under", () => {
  it("reach is direct · private · public, with the count the card prints", () => {
    expect(reachOf({ directAward: true, audience: "private" })).toBe("direct")
    expect(reachOf({ audience: "direct" })).toBe("direct")
    expect(reachOf({ audience: "private" })).toBe("private")
    expect(reachOf({ visibility: "private" })).toBe("private")
    expect(reachOf({})).toBe("public")
    expect(reachCountOf({ directAward: true })).toBe(1)
    expect(reachCountOf({ audience: "private", allowedSupplierOrgIds: ["a", "b", "c"] })).toBe(3)
    expect(reachCountOf({ audience: "public", reachedCount: 8 })).toBe(8)
    expect(reachCountOf({ audience: "public" })).toBeNull()
  })

  it("a site is each line's delivery site, else its project's site, else general stock or the workshop", () => {
    expect(rfqSiteKeys({ projectId: null, products: [{ deliverySiteId: "a" }, { deliverySiteId: "b" }, { deliverySiteId: "a" }] })).toEqual(["a", "b"])
    expect(rfqSiteKeys({ projectId: "P1", products: [{ name: "x" }] })).toEqual(["prj_P1"])
    expect(rfqSiteKeys({ projectId: null, products: [{ projectId: "P2" }] })).toEqual(["prj_P2"])
    expect(rfqSiteKeys({ projectId: null, products: [] })).toEqual(["__gen"])
    expect(rfqSiteKeys({ projectId: null, purchaseSource: { kind: "mfg_purchase" }, products: [] })).toEqual(["__mfg"])
  })

  it("a category is the tree's sub-categories, or the old category names written before the tree", () => {
    expect(rfqCategoryKeys({ subCategoryIds: ["a", "b"], category: "x", products: [{ category: "y" }] })).toEqual(["a", "b"])
    expect(rfqCategoryKeys({ category: "مواد بناء", products: [] })).toEqual(["مواد بناء"])
  })
})

describe("the offers on a row", () => {
  const BASE = rfq({
    id: "q1",
    products: [
      { name: "حديد", quantity: 10, unit: "طن" },
      { name: "اسمنت", quantity: 100, unit: "كيس" },
    ],
  })
  const two = (a: number, b: number) => [{ rfqProductIndex: 0, unitPrice: a }, { rfqProductIndex: 1, unitPrice: b }]
  const EXCLUDE = { shortlist: null, exclusion: { code: "spec", text: null, at: "x", byId: "u", byName: "u" } } as never

  it("counts offers, the ones from off the platform and the live ones", () => {
    const offers = [offer("a", "q1", { lines: two(100, 10) }), offer("b", "q1", { lines: two(90, 12), isGuestOffer: true, supplierId: "guest" }), offer("c", "q1", { lines: two(80, 9), status: "مسحوب" })]
    const [r] = build([BASE], offers)
    expect(r.offers).toBe(3)
    expect(r.offPlatform).toBe(1)
    expect(r.live).toBe(2)
  })

  it("an RFQ with no offer documents shows the counter it carries", () => {
    const [r] = build([{ ...BASE, offersCount: 4 }], [])
    expect(r.offers).toBe(4)
    expect(r.live).toBe(0)
  })

  it("the lowest complete offer is the evaluation's own number — gross, with its basis (G-03)", () => {
    const offers = [offer("a", "q1", { lines: two(100, 10) }), offer("b", "q1", { lines: two(90, 12) }), offer("partial", "q1", { lines: [{ rfqProductIndex: 0, unitPrice: 50 }] })]
    const [r] = build([BASE], offers)
    const same = lowestCompleteOffer(BASE as never, offers.map((o) => toCalcOffer(o, undefined)), { tiePercent: 0.5, today: TODAY })
    expect(r.lowest?.grossH).toBe(same?.grossH)
    // a: 10×100 + 100×10 = 2,000 net; b: 10×90 + 100×12 = 2,100; the partial one does not rank. 15 % on top of the lowest.
    expect(r.lowest).toEqual({ grossH: 230_000, basis: "incl_vat" })
  })

  it("an offer the buyer excluded is out of the lowest; a supplier not registered for VAT shows its basis as no VAT", () => {
    const offers = [offer("a", "q1", { lines: two(100, 10) }), offer("b", "q1", { lines: two(100, 12), vatRegistered: false })]
    expect(build([BASE], offers)[0].lowest).toEqual({ grossH: 230_000, basis: "incl_vat" })
    const [out] = build([BASE], offers, { decisions: { a: EXCLUDE } })
    expect(out.lowest).toEqual({ grossH: 220_000, basis: "no_vat" })
    expect(out.live).toBe(1)
  })

  it("a withdrawn offer and a draft carry no lowest", () => {
    const [withdrawn] = build([BASE], [offer("a", "q1", { lines: two(100, 10), status: "مسحوب" })])
    expect(withdrawn.lowest).toBeNull()
    const [draft] = build([{ ...BASE, status: "Draft" }], [offer("a", "q1", { lines: two(100, 10) })])
    expect(draft.lowest).toBeNull()
  })

  it("orders the RFQ was awarded into are counted, a cancelled one is not", () => {
    const [r] = build([{ ...BASE, status: "Awarded" }], [], { orders: [{ rfqId: "q1", status: "sent" }, { rfqId: "q1", status: "cancelled" }, { rfqId: "other", status: "sent" }] })
    expect(r.orders).toBe(1)
  })
})

describe("«لا عرض حيّاً» and the one primary action (RFQ-15, WF-26)", () => {
  const two = (a: number, b: number) => [{ rfqProductIndex: 0, unitPrice: a }, { rfqProductIndex: 1, unitPrice: b }]
  const R = (over: Partial<ListRfq> & { id: string }) =>
    rfq({
      ...over,
      products: [
        { name: "حديد", quantity: 10, unit: "طن" },
        { name: "اسمنت", quantity: 100, unit: "كيس" },
      ],
    })
  const EXCLUDE = { shortlist: null, exclusion: { code: "spec", text: null, at: "x", byId: "u", byName: "u" } } as never

  it("a round that closed with nothing is «closed_empty»; one whose every offer was excluded is «all_excluded»; a live one is neither", () => {
    const [empty] = build([R({ id: "e", deadline: day(-1) })])
    expect(empty.noLive).toBe("closed_empty")
    const [waiting] = build([R({ id: "w", deadline: day(2) })])
    expect(waiting.noLive).toBeNull()
    const [none] = build([R({ id: "x", deadline: day(2) })], [offer("a", "x", { lines: two(1, 1) })], { decisions: { a: EXCLUDE } })
    expect(none.noLive).toBe("all_excluded")
    const [live] = build([R({ id: "l", deadline: day(-1) })], [offer("a", "l", { lines: two(1, 1) })])
    expect(live.noLive).toBeNull()
  })

  it("a draft finishes in the review step; live offers compare; nothing live reopens; everything else just opens", () => {
    const rows = build(
      [R({ id: "d", status: "Draft" }), R({ id: "c", deadline: day(2) }), R({ id: "n", deadline: day(2) }), R({ id: "z", deadline: day(-1) }), R({ id: "a", status: "Awarded", deadline: day(-4) }), R({ id: "k", status: "Cancelled" })],
      [offer("a", "c", { lines: two(1, 1) })],
    )
    const act = Object.fromEntries(rows.map((r) => [r.id, primaryAction(r, true)]))
    expect(act).toEqual({ d: "complete", c: "compare", n: "open", z: "reopen", a: "open", k: "open" })
    const [draft, compare, open, reopen] = rows
    expect(actionHref(draft, "complete", rfqReviewHref)).toBe(rfqReviewHref("d"))
    expect(actionHref(compare, "compare", rfqReviewHref)).toBe("/contractor/rfqs/c/offers?tab=compare")
    expect(actionHref(open, "open", rfqReviewHref)).toBe("/contractor/rfqs/n/offers")
    expect(actionHref(reopen, "reopen", rfqReviewHref)).toBeNull()
  })

  it("someone who does not run the RFQ cannot reopen it — he opens it", () => {
    const [z] = build([R({ id: "z", deadline: day(-1) })])
    expect(primaryAction(z, false)).toBe("open")
  })

  it("a round past its deadline with live offers is still «قارن ورسِّ»", () => {
    const [r] = build([R({ id: "p", deadline: day(-3) })], [offer("a", "p", { lines: two(1, 1) })])
    expect(r.state).toBe("compare")
    expect(primaryAction(r, true)).toBe("compare")
  })
})

// ---------------------------------------------------------------------------
// Hundreds of RFQs
// ---------------------------------------------------------------------------

const BIG = 300
function world() {
  const rfqs: ListRfq[] = []
  const offers: ListOffer[] = []
  for (let i = 0; i < BIG; i++) {
    const id = `r${i}`
    const kind = i % 6
    const status = kind === 5 ? "Draft" : kind === 2 ? "Awarded" : kind === 3 ? "Cancelled" : "New"
    rfqs.push(
      rfq({
        id,
        status,
        title: `طلب رقم ${i}`,
        rfqNumber: kind === 5 ? null : `RFQ-2026/${pad(i)}`,
        deadline: kind === 1 ? day(-1 - (i % 5)) : kind === 2 ? day(-10 - (i % 5)) : day(1 + (i % 9)),
        audience: kind === 4 ? "private" : "public",
        allowedSupplierOrgIds: kind === 4 ? ["s1", "s2", "s3"] : null,
        reachedCount: (i % 11) + 1,
        subCategoryIds: [`cat_${Math.floor(i / 6) % 3}`],
        createdAt: `${day(-(i % 40))}T08:00:00.000Z`,
        products: [{ name: i % 7 === 0 ? "بلك مصمت" : "حديد تسليح", quantity: 10, unit: "طن", deliverySiteId: `site_${Math.floor(i / 2) % 4}` }],
      }),
    )
    if (kind !== 5) for (let k = 0; k < i % 5; k++) offers.push(offer(`o${i}_${k}`, id, { companyName: i === 1 && k === 0 ? "مورد النخبة" : `مورد ${k}` }))
  }
  return { rfqs, offers, rows: build(rfqs, offers) }
}

describe("hundreds of RFQs (NFR-03)", () => {
  const W = world()

  it("every chip carries a count, drafts stay apart, and the counts partition the list", () => {
    const c = listCounts(W.rows, F())
    expect(c).toEqual({ open: 100, compare: 50, awarded: 50, cancelled: 50, all: 250, draft: 50 })
    expect(c.open + c.compare + c.awarded + c.cancelled).toBe(c.all)
  })

  it("the chip is the view: «الكل» leaves out drafts, «المسودات» is only drafts", () => {
    expect(listRfqs(W.rows, F({ view: "all" }), TODAY, 1000).matched).toBe(250)
    const drafts = listRfqs(W.rows, F({ view: "draft" }), TODAY, 1000)
    expect(drafts.matched).toBe(50)
    expect(drafts.rows.every((r) => r.state === "draft")).toBe(true)
    expect(listRfqs(W.rows, F({ view: "compare" }), TODAY, 1000).rows.every((r) => r.state === "compare")).toBe(true)
  })

  it("the first visit lands on open work, then rounds to compare, then everything", () => {
    expect(defaultView({ open: 3, compare: 2, awarded: 0, cancelled: 0, all: 5, draft: 0 })).toBe("open")
    expect(defaultView({ open: 0, compare: 2, awarded: 1, cancelled: 0, all: 3, draft: 0 })).toBe("compare")
    expect(defaultView({ open: 0, compare: 0, awarded: 1, cancelled: 0, all: 1, draft: 4 })).toBe("all")
  })

  it("shows 24 and offers «عرض N أخرى» until nothing is left", () => {
    const first = listRfqs(W.rows, F({ view: "all" }), TODAY)
    expect(first.rows).toHaveLength(RFQ_LIST_PAGE)
    expect(first.matched).toBe(250)
    expect(first.remaining).toBe(226)
    expect(first.more).toBe(24)
    const nearEnd = listRfqs(W.rows, F({ view: "all" }), TODAY, 240)
    expect(nearEnd.rows).toHaveLength(240)
    expect(nearEnd.more).toBe(10)
    const all = listRfqs(W.rows, F({ view: "all" }), TODAY, 250)
    expect(all.more).toBe(0)
    expect(new Set(all.rows.map((r) => r.id)).size).toBe(250)
  })

  it("«N من M»: M is every published RFQ (every draft in the drafts view; everything while searching)", () => {
    expect(listRfqs(W.rows, F({ view: "open", site: "site_0" }), TODAY).total).toBe(250)
    expect(listRfqs(W.rows, F({ view: "draft" }), TODAY).total).toBe(50)
    expect(listRfqs(W.rows, F({ q: "حديد" }), TODAY).total).toBe(300)
  })

  it("each filter narrows, and they work together", () => {
    const open = (over: Partial<RfqListFilter>) => listRfqs(W.rows, F({ view: "open", ...over }), TODAY, 1000)
    expect(open({ site: "site_1" }).rows.every((r) => r.siteKeys.includes("site_1"))).toBe(true)
    expect(open({ category: "cat_2" }).rows.every((r) => r.categoryKeys.includes("cat_2"))).toBe(true)
    expect(open({ reach: "private" }).rows.every((r) => r.reach === "private")).toBe(true)
    const both = open({ site: "site_1", reach: "public", category: "cat_1" })
    expect(both.matched).toBeLessThan(open({ site: "site_1" }).matched)
    expect(both.matched).toBeGreaterThan(0)
    expect(both.rows.every((r) => r.siteKeys.includes("site_1") && r.reach === "public" && r.categoryKeys.includes("cat_1"))).toBe(true)
  })

  it("the chips' counts follow the filters", () => {
    const c = listCounts(W.rows, F({ site: "site_0" }))
    expect(c.open + c.compare + c.awarded + c.cancelled).toBe(c.all)
    expect(c.all).toBe(W.rows.filter((r) => r.state !== "draft" && r.siteKeys.includes("site_0")).length)
    expect(c.all).toBeLessThan(250)
  })

  it("every facet option shows the count it would leave — choosing it never gives a different number", () => {
    const f = F({ view: "open", reach: "public" })
    const facets = listFacets(W.rows, f)
    expect(facets.sites.length).toBe(4)
    for (const [site, n] of facets.sites) expect(listRfqs(W.rows, { ...f, site }, TODAY, 1000).matched).toBe(n)
    for (const [category, n] of facets.categories) expect(listRfqs(W.rows, { ...f, category }, TODAY, 1000).matched).toBe(n)
    for (const [reach, n] of listFacets(W.rows, F({ view: "open" })).reaches) expect(listRfqs(W.rows, F({ view: "open", reach }), TODAY, 1000).matched).toBe(n)
  })

  it("a facet is counted after the OTHER filters only, so the picked option keeps its own number", () => {
    const picked = F({ view: "open", site: "site_1" })
    const facets = listFacets(W.rows, picked)
    expect(facets.sites.map(([k]) => k).sort()).toEqual(["site_0", "site_1", "site_2", "site_3"])
  })

  it("a search looks in every status — number (Latin or Arabic prefix), name, material, supplier — whatever chip is pressed", () => {
    const q = (s: string) => listRfqs(W.rows, F({ view: "awarded", q: s }), TODAY, 1000).rows.map((r) => r.id)
    expect(q("RFQ-2026/007")).toEqual(["r7"])
    expect(q(displayDocNumber("RFQ-2026/013", "ar"))).toEqual(["r13"])
    expect(q("طلب رقم 8")).toContain("r8")
    expect(q("النخبة")).toEqual(["r1"])
    const block = q("بلك مصمت")
    expect(block.length).toBeGreaterThan(20)
    expect(block.every((id) => Number(id.slice(1)) % 7 === 0)).toBe(true)
    expect(new Set(listRfqs(W.rows, F({ view: "awarded", q: "بلك مصمت" }), TODAY, 1000).rows.map((r) => r.state)).size).toBeGreaterThan(1)
  })

  it("a search narrows the chips' counts too", () => {
    const c = listCounts(W.rows, F({ q: "النخبة" }))
    expect(c).toEqual({ open: 0, compare: 1, awarded: 0, cancelled: 0, all: 1, draft: 0 })
  })

  it("the search folds Arabic (ة/ه, أ/ا, digits) and needs every word", () => {
    expect(listRfqs(W.rows, F({ view: "all", q: "مورد النخبه" }), TODAY).matched).toBe(1)
    expect(listRfqs(W.rows, F({ view: "all", q: "مورد النخبة غير موجود" }), TODAY).matched).toBe(0)
    expect(listRfqs(W.rows, F({ view: "all", q: "RFQ-٢٠٢٦/٠٠٧" }), TODAY).rows.map((r) => r.id)).toEqual(["r7"])
  })

  it("only a narrowing counts as an active filter — the chip and the sort do not", () => {
    expect(listFilterActive(F({ view: "awarded", sort: "offers" }))).toBe(false)
    for (const over of [{ q: "x" }, { site: "a" }, { category: "b" }, { reach: "direct" as const }]) expect(listFilterActive(F(over))).toBe(true)
  })
})

describe("the three sorts", () => {
  const rows = build([
    rfq({ id: "a", deadline: day(5), createdAt: `${day(-1)}T08:00:00.000Z` }),
    rfq({ id: "b", deadline: day(1), createdAt: `${day(-9)}T08:00:00.000Z` }),
    rfq({ id: "c", deadline: day(3), createdAt: `${day(-3)}T08:00:00.000Z` }),
  ], [offer("o1", "c"), offer("o2", "c"), offer("o3", "a")])
  const ids = (sort: "close" | "new" | "offers") => sortRows(rows, sort, TODAY).map((r) => r.id)

  it("closing soonest, newest published, most offers", () => {
    expect(ids("close")).toEqual(["b", "c", "a"])
    expect(ids("new")).toEqual(["a", "c", "b"])
    expect(ids("offers")).toEqual(["c", "a", "b"])
  })

  it("is the same order every time, ties broken by id", () => {
    const tied = build([rfq({ id: "z2" }), rfq({ id: "z1" }), rfq({ id: "z3" })])
    expect(sortRows(tied, "close", TODAY).map((r) => r.id)).toEqual(["z1", "z2", "z3"])
    expect(sortRows([...tied].reverse(), "close", TODAY).map((r) => r.id)).toEqual(["z1", "z2", "z3"])
  })

  it("«الأقرب إغلاقاً» ranks a round closed yesterday ahead of one that closes next week, as the prototype does", () => {
    const mixed = build([rfq({ id: "far", deadline: day(7) }), rfq({ id: "yesterday", deadline: day(-1) })])
    expect(sortRows(mixed, "close", TODAY).map((r) => r.id)).toEqual(["yesterday", "far"])
  })
})

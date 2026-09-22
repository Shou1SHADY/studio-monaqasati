/**
 * Procurement PRD 3.0 §4 — price agreements (`AGR`) and price history (`PH`).
 *
 * Both exist so a price can be argued about with evidence, which only works if
 * the arithmetic is defensible: which agreement covers a material when two do,
 * what "the last price" means on the day an order is approved, and what a
 * percentage over a zero base is (nothing).
 *
 * The reference prototype never read an agreement's start date, so one signed
 * for next quarter priced an order today. We honour it, and this pins that.
 */

import {
  AGREEMENT_EXPIRY_WINDOW_DAYS,
  OFFER_ABOVE_LAST_PERCENT,
  PRICE_TREND_POINTS,
  aboveLastPaid,
  agreementDaysLeft,
  agreementFor,
  agreementIsLive,
  agreementRows,
  agreementState,
  agreementsOfSupplier,
  historyRowsForApproval,
  lastPaid,
  materialKey,
  priceBefore,
  priceTrend,
  priceTrends,
  renewalUntil,
  sparkHeights,
  type PriceAgreement,
  type PriceHistoryEntry,
} from "@/lib/procurement/prices"
import { daysBetween } from "@/lib/procurement/po"
import type { PurchaseOrder } from "@/lib/procurement/types"

const TODAY = "2026-09-22"

const agreement = (over: Partial<PriceAgreement>): PriceAgreement =>
  ({
    id: "a1",
    organizationId: "org",
    docNumber: "AG-2026/001",
    supplierOrgId: "sup1",
    supplierName: "Al Rajhi",
    from: "2026-01-01",
    until: "2026-12-31",
    lines: [{ name: "حديد 12مم", unit: "طن", price: 2780 }],
    preparedById: "buyer",
    preparedByName: "Badr",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as PriceAgreement

const entry = (over: Partial<PriceHistoryEntry>): PriceHistoryEntry =>
  ({
    id: "h1",
    organizationId: "org",
    materialKey: materialKey("حديد 12مم", "طن"),
    name: "حديد 12مم",
    unit: "طن",
    supplierOrgId: "sup1",
    supplierName: "Al Rajhi",
    price: 2780,
    day: "2026-09-01",
    kind: "po",
    poId: "po1",
    poNumber: "PO-2026/001",
    ...over,
  }) as PriceHistoryEntry

describe("a material is a name and a unit, folded", () => {
  it("reads Arabic-Indic digits as the same steel", () => {
    expect(materialKey("حديد ١٢مم", "طن")).toBe(materialKey("حديد 12مم", "طن"))
  })

  it("ignores case, spacing and the alef's hats", () => {
    expect(materialKey("  Steel  Bar ", "TON")).toBe(materialKey("steel bar", "ton"))
    expect(materialKey("أسمنت", "كيس")).toBe(materialKey("اسمنت", "كيس"))
  })

  it("keeps the unit part of the identity — a tonne is not a bag", () => {
    expect(materialKey("حديد", "طن")).not.toBe(materialKey("حديد", "كيس"))
  })
})

describe("where an agreement stands", () => {
  it("counts days both ways", () => {
    expect(daysBetween(TODAY, "2026-09-25")).toBe(3)
    expect(daysBetween(TODAY, "2026-09-20")).toBe(-2)
    expect(daysBetween(TODAY, TODAY)).toBe(0)
  })

  it("is live in the middle of its window", () => {
    expect(agreementState(agreement({}), TODAY)).toBe("live")
  })

  it("can still be ordered on the day it ends", () => {
    expect(agreementState(agreement({ until: TODAY }), TODAY)).toBe("expiring")
    expect(agreementIsLive(agreement({ until: TODAY }), TODAY)).toBe(true)
    expect(agreementDaysLeft(agreement({ until: TODAY }), TODAY)).toBe(0)
  })

  it("is expired the day after", () => {
    expect(agreementState(agreement({ until: "2026-09-21" }), TODAY)).toBe("expired")
    expect(agreementIsLive(agreement({ until: "2026-09-21" }), TODAY)).toBe(false)
  })

  it("is NOT live before it starts — the prototype's own gap", () => {
    const next = agreement({ from: "2026-10-01", until: "2027-03-31" })
    expect(agreementState(next, TODAY)).toBe("upcoming")
    expect(agreementIsLive(next, TODAY)).toBe(false)
  })

  it("is expiring inside the renewal window and live outside it", () => {
    const edge = agreement({ until: daysFrom(TODAY, AGREEMENT_EXPIRY_WINDOW_DAYS) })
    expect(agreementState(edge, TODAY)).toBe("expiring")
    expect(agreementState(agreement({ until: daysFrom(TODAY, AGREEMENT_EXPIRY_WINDOW_DAYS + 1) }), TODAY)).toBe("live")
  })

  it("is expired once somebody ended it, whatever its date says", () => {
    expect(agreementState(agreement({ endedAt: "2026-09-10T00:00:00.000Z" }), TODAY)).toBe("expired")
  })
})

function daysFrom(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

describe("which agreement prices a material", () => {
  it("finds the live one covering it", () => {
    const m = agreementFor([agreement({})], "حديد 12مم", "طن", TODAY)
    expect(m?.price).toBe(2780)
    expect(m?.agreement.docNumber).toBe("AG-2026/001")
  })

  it("matches through folding", () => {
    expect(agreementFor([agreement({})], "حديد ١٢مم", " طن ", TODAY)?.price).toBe(2780)
  })

  it("takes the CHEAPEST when two live agreements cover it", () => {
    // The prototype took whichever came first in its array, which is no rule.
    const dear = agreement({ id: "a1", docNumber: "AG-2026/001", lines: [{ name: "حديد 12مم", unit: "طن", price: 2900 }] })
    const cheap = agreement({ id: "a2", docNumber: "AG-2026/002", supplierOrgId: "sup2", lines: [{ name: "حديد 12مم", unit: "طن", price: 2700 }] })
    expect(agreementFor([dear, cheap], "حديد 12مم", "طن", TODAY)?.agreement.id).toBe("a2")
    expect(agreementFor([cheap, dear], "حديد 12مم", "طن", TODAY)?.agreement.id).toBe("a2")
  })

  it("breaks a price tie on the one that runs longest, then the number", () => {
    const short = agreement({ id: "a1", docNumber: "AG-2026/001", until: "2026-10-31" })
    const long = agreement({ id: "a2", docNumber: "AG-2026/002", until: "2027-06-30" })
    expect(agreementFor([short, long], "حديد 12مم", "طن", TODAY)?.agreement.id).toBe("a2")
    const sameDay = agreement({ id: "a3", docNumber: "AG-2026/000", until: "2027-06-30" })
    expect(agreementFor([long, sameDay], "حديد 12مم", "طن", TODAY)?.agreement.id).toBe("a3")
  })

  it("ignores an expired one, so the material goes back to the market by itself", () => {
    expect(agreementFor([agreement({ until: "2026-08-01" })], "حديد 12مم", "طن", TODAY)).toBeNull()
  })

  it("ignores one that has not started", () => {
    expect(agreementFor([agreement({ from: "2026-12-01", until: "2027-06-30" })], "حديد 12مم", "طن", TODAY)).toBeNull()
  })

  it("ignores a line priced at nothing", () => {
    expect(agreementFor([agreement({ lines: [{ name: "حديد 12مم", unit: "طن", price: 0 }] })], "حديد 12مم", "طن", TODAY)).toBeNull()
  })

  it("says nothing about a material no agreement covers", () => {
    expect(agreementFor([agreement({})], "أسمنت", "كيس", TODAY)).toBeNull()
  })
})

describe("the lists the screens show", () => {
  it("puts what needs a decision first", () => {
    const rows = agreementRows(
      [
        agreement({ id: "live", until: "2027-01-01" }),
        agreement({ id: "gone", until: "2026-01-01" }),
        agreement({ id: "soon", until: "2026-09-28" }),
        agreement({ id: "later", from: "2026-11-01", until: "2027-01-01" }),
      ],
      TODAY
    )
    expect(rows.map((r) => r.id)).toEqual(["soon", "live", "later", "gone"])
    expect(rows[0].state).toBe("expiring")
    expect(rows[0].daysLeft).toBe(6)
  })

  it("lists a supplier's agreements, soonest to end first", () => {
    const list = agreementsOfSupplier([agreement({ id: "b", until: "2027-01-01" }), agreement({ id: "a", until: "2026-10-01" }), agreement({ id: "c", supplierOrgId: "other" })], "sup1")
    expect(list.map((a) => a.id)).toEqual(["a", "b"])
  })

  it("renews half a year past the current end, and from today for a lapsed one", () => {
    expect(renewalUntil({ until: "2026-12-31" }, TODAY)).toBe("2027-06-29")
    expect(renewalUntil({ until: "2026-01-01" }, TODAY)).toBe(daysFrom(TODAY, 180))
  })
})

describe("the price history", () => {
  const series = [
    entry({ id: "h1", day: "2026-04-01", price: 2700 }),
    entry({ id: "h2", day: "2026-06-01", price: 2740, supplierOrgId: "sup2", supplierName: "Other" }),
    entry({ id: "h3", day: "2026-09-01", price: 2780 }),
  ]

  it("reads the last price we committed to, with who and when", () => {
    const l = lastPaid(series, "حديد 12مم", "طن")
    expect(l).toMatchObject({ price: 2780, day: "2026-09-01", supplierName: "Al Rajhi" })
  })

  it("does not care what order the query came back in", () => {
    expect(lastPaid([series[2], series[0], series[1]], "حديد 12مم", "طن")?.price).toBe(2780)
  })

  it("knows nothing about a material it has never seen", () => {
    expect(lastPaid(series, "أسمنت", "كيس")).toBeNull()
    expect(priceTrend(series, "أسمنت", "كيس")).toBeNull()
  })

  it("compares an order against the price BEFORE its own day", () => {
    // Taking "the last price" on the approval day compares the order with itself.
    expect(priceBefore(series, "حديد 12مم", "طن", "2026-09-01")).toBe(2740)
    expect(priceBefore(series, "حديد 12مم", "طن", "2026-04-01")).toBeNull()
  })

  it("trends over the last points, with min, max and the change", () => {
    const t = priceTrend(series, "حديد 12مم", "طن")
    expect(t).toMatchObject({ first: 2700, last: 2780, min: 2700, max: 2780 })
    expect(t?.changePercent).toBe(2.96)
    expect(t?.rising).toBe(false)
  })

  it("flags a rise past the alarm", () => {
    const steep = [...series, entry({ id: "h4", day: "2026-09-20", price: 2900 })]
    const t = priceTrend(steep, "حديد 12مم", "طن")
    expect(t?.changePercent).toBe(7.41)
    expect(t?.rising).toBe(true)
  })

  it("shows only the last few points", () => {
    const many = Array.from({ length: 10 }, (_, i) => entry({ id: `h${i}`, day: `2026-0${(i % 9) + 1}-01`, price: 2700 + i }))
    expect(priceTrend(many, "حديد 12مم", "طن")?.points).toHaveLength(PRICE_TREND_POINTS)
  })

  it("refuses a percentage over a base of nothing", () => {
    const zero = [entry({ id: "z1", day: "2026-01-01", price: 0 }), entry({ id: "z2", day: "2026-02-01", price: 100 })]
    // A number that cannot be defended is worse than a missing one (SS6.2).
    expect(priceTrend(zero, "حديد 12مم", "طن")?.changePercent).toBeNull()
  })

  it("draws a flat series as flat, not as a wall", () => {
    const flat = [entry({ id: "f1", day: "2026-01-01", price: 100 }), entry({ id: "f2", day: "2026-02-01", price: 100 })]
    const t = priceTrend(flat, "حديد 12مم", "طن")!
    expect(sparkHeights(t)).toEqual([60, 60])
    const rising = priceTrend(series, "حديد 12مم", "طن")!
    expect(sparkHeights(rising)[0]).toBe(30)
    expect(sparkHeights(rising)[2]).toBe(100)
  })

  it("groups every material it has, the sharpest rise first", () => {
    const mixed = [
      ...series,
      entry({ id: "c1", materialKey: materialKey("أسمنت", "كيس"), name: "أسمنت", unit: "كيس", day: "2026-01-01", price: 10 }),
      entry({ id: "c2", materialKey: materialKey("أسمنت", "كيس"), name: "أسمنت", unit: "كيس", day: "2026-09-01", price: 20 }),
    ]
    const rows = priceTrends(mixed)
    expect(rows.map((r) => r.name)).toEqual(["أسمنت", "حديد 12مم"])
    expect(rows[0].changePercent).toBe(100)
  })
})

describe("an offer against the last price we paid", () => {
  it("names the percentage once it is past the threshold", () => {
    expect(aboveLastPaid(2900, 2780)).toBe(4.32)
    expect(OFFER_ABOVE_LAST_PERCENT).toBe(3)
  })

  it("says nothing about a rise inside it, or a fall", () => {
    expect(aboveLastPaid(2820, 2780)).toBeNull()
    expect(aboveLastPaid(2600, 2780)).toBeNull()
  })

  it("says nothing when there is nothing to compare with", () => {
    expect(aboveLastPaid(2900, null)).toBeNull()
    expect(aboveLastPaid(2900, 0)).toBeNull()
    expect(aboveLastPaid(null, 2780)).toBeNull()
  })
})

describe("what an approval records", () => {
  const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
    ({
      id: "po1",
      organizationId: "org",
      docNumber: "PO-2026/014",
      supplierOrgId: "sup1",
      supplierName: "Al Rajhi",
      lines: [
        { id: "l1", name: "حديد 12مم", unit: "طن", quantity: 10, unitPrice: 2780, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
        { id: "l2", name: "أسمنت", unit: "كيس", quantity: 100, unitPrice: 15.2, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
      ],
      ...over,
    }) as PurchaseOrder

  it("records one row per priced line, on the day of approval", () => {
    const rows = historyRowsForApproval(order(), "2026-09-22T09:00:00.000Z")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: "حديد 12مم", price: 2780, day: "2026-09-22", kind: "po", poId: "po1", poNumber: "PO-2026/014", supplierOrgId: "sup1" })
    expect(rows[0].materialKey).toBe(materialKey("حديد 12مم", "طن"))
  })

  it("gives each row the order's own line as its id, so a retry cannot double it", () => {
    const a = historyRowsForApproval(order(), "2026-09-22T09:00:00.000Z")
    const b = historyRowsForApproval(order(), "2026-09-22T11:00:00.000Z")
    expect(a.map((r) => r.id)).toEqual(["po1__l1", "po1__l2"])
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
  })

  it("records nothing for a lump-sum line — a total over a quantity is invented", () => {
    const lump = order({ lines: [{ id: "l1", name: "x", unit: "u", quantity: 1, unitPrice: null, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] } as Partial<PurchaseOrder>)
    expect(historyRowsForApproval(lump, "2026-09-22T09:00:00.000Z")).toEqual([])
  })

  it("records nothing for a line priced at zero", () => {
    const free = order({ lines: [{ id: "l1", name: "x", unit: "u", quantity: 1, unitPrice: 0, accepted: 0, rejected: 0, held: 0, cancelled: 0 }] } as Partial<PurchaseOrder>)
    expect(historyRowsForApproval(free, "2026-09-22T09:00:00.000Z")).toEqual([])
  })
})

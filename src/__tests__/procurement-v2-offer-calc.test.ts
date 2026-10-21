/**
 * Procurement 2.0 · WP-S3-01 — the offer calculation core.
 *
 * One module (offer-calc.ts) is where an offer becomes numbers: pieces, effective price, VAT by registration,
 * coverage, the lowest complete offer, the tie band, competition per line, expiry, arrival and the reasons the
 * numbers back. The PRD's worked example (RFQ-2026/011) and the prototype's G-02 / G-03 / G-18 / R-xx scenarios
 * are the fixtures.
 */

import {
  addDaysISO,
  arrivalEstimate,
  arrivalVsNeed,
  AWARD_WHY_CODES,
  awardNetH,
  awardReasonEligible,
  awardReasonRefusal,
  basisOf,
  calcOffer,
  evaluateOffers,
  fromHalalas,
  isExpired,
  isLowestPick,
  isTie,
  lineCalc,
  lineOf,
  lowCompetition,
  lowCompetitionReasonRefusal,
  lowestCompleteOffer,
  lowestOnLine,
  mulRound,
  nonLowestPicks,
  roundHalfUp,
  toHalalas,
  validityState,
  vatRateOf,
  withVat,
  type AwardPick,
  type CalcOffer,
  type NonLowestLine,
  type ReasonFacts,
} from "@/lib/procurement/offer-calc"
import { guestOfferPrice, offerCoverage, offerPricingFields, offerRates, priceOffer, pricedProducts, quotedRatesReconcile, ratesAboveLastPaid, revisePrice } from "@/lib/procurement/offer-pricing"
import { offerMatrix, type MatrixOffer } from "@/lib/procurement/offer-matrix"
import { aboveLastPaid } from "@/lib/procurement/prices"

const sar = fromHalalas

// RFQ-2026/011 — زوايا حديد 50×50×5 مم 175 م, خشب ألواح 320 م طولي
const rfq011 = {
  pricingMode: "line",
  products: [
    { name: "زوايا حديد 50×50×5 مم", quantity: 175, unitOfMeasure: "م" },
    { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
  ],
}

const jodah: CalcOffer = { id: "jodah", leadDays: 5, lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }] }
const sharq: CalcOffer = { id: "sharq", leadDays: 4, lines: [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }], skippedItems: [1] }
const wusta: CalcOffer = { id: "wusta", leadDays: 6, lines: [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6 }], skippedItems: [1] }
const ofuq: CalcOffer = { id: "ofuq", leadDays: 3, lines: [{ rfqProductIndex: 0, unitPrice: 12.9 }], skippedItems: [1] }
const amal: CalcOffer = { id: "amal", leadDays: 7, validUntil: "2026-10-25", lines: [{ rfqProductIndex: 0, unitPrice: 80, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 13.5, packLen: 4 }] }
const bina: CalcOffer = { id: "bina", leadDays: 8, lines: [{ rfqProductIndex: 1, unitPrice: 14.2, packLen: 4 }], skippedItems: [0] }
const all011 = [jodah, sharq, wusta, ofuq, amal, bina]

describe("halalas and rounding", () => {
  it("prices become integer halalas, however they were typed", () => {
    expect(toHalalas("12.50")).toBe(1250)
    expect(toHalalas(4.35)).toBe(435)
    expect(toHalalas("1,200.5")).toBe(120050)
    expect(toHalalas("٤٠٫٥")).toBe(toHalalas(0)) // an Arabic decimal separator is not a number: nothing, never a wrong price
    expect(toHalalas("٤٠")).toBe(4000)
    expect(toHalalas("abc")).toBe(0)
  })

  it("half-up, even where the double lands just under the half", () => {
    expect(roundHalfUp(337.5)).toBe(338)
    expect(roundHalfUp(8.345 * 100)).toBe(835)
    expect(roundHalfUp(1250)).toBe(1250)
    expect(mulRound(10, 115, 100)).toBe(12)
  })

  it("the PRD's 3,840.43 is exact, not luck: 3,339.50 × 1.15 is 3,840.4249999999997 as a double", () => {
    expect(3339.5 * 1.15).toBe(3840.4249999999997)
    expect(sar(withVat(333950))).toBe(3840.43)
  })

  it("where float maths rounds the wrong way (0.50 × 1.15 = 0.575 → 0.57), half-up gives 0.58", () => {
    expect(Math.round(0.5 * 1.15 * 100)).toBe(57)
    expect(sar(withVat(50))).toBe(0.58)
    expect(withVat(110)).toBe(127)
  })

  it("VAT is 15 % for a registered supplier and nothing for an unregistered one (CMP-19)", () => {
    expect(vatRateOf({})).toBe(0.15)
    expect(vatRateOf({ vatRegistered: true })).toBe(0.15)
    expect(vatRateOf({ vatRegistered: false })).toBe(0)
    expect(vatRateOf({ vatRegistered: false, vatRate: 0.15 })).toBe(0)
    expect(vatRateOf({ vatRate: 0 })).toBe(0)
    expect(withVat(100000, 0)).toBe(100000)
    expect(basisOf(0.15)).toBe("incl_vat")
    expect(basisOf(0)).toBe("no_vat")
  })
})

describe("one line, by the unit or by the piece (CMP-01, G-02)", () => {
  it("a per-unit rate: total = quantity × rate, the effective price is the rate", () => {
    const l = lineCalc(175, 12.5)
    expect(l).toMatchObject({ totalH: 218750, effH: 1250, pack: null })
  })

  it("by the piece: pieces = ⌈qty ÷ length⌉, total = pieces × piece price, surplus = pieces × length − qty", () => {
    const l = lineCalc(175, 146, 12)
    expect(l.pack).toMatchObject({ packLen: 12, pcs: 15, received: 180, extra: 5 })
    expect(sar(l.totalH)).toBe(2190)
    expect(sar(l.effH)).toBe(12.51)
    expect(sar(l.pack?.perReceivedH as number)).toBe(12.17)
  })

  it("the nominal 146 ÷ 12 = 12.17 is NOT the effective price; 12.17 is only «per metre received»", () => {
    const l = lineCalc(175, 146, 12)
    expect(sar(l.effH)).not.toBe(12.17)
    expect(sar(l.pack?.perReceivedH as number)).toBe(12.17)
  })

  it("an exact fit has no surplus and no «per metre received»", () => {
    const l = lineCalc(180, 74, 6)
    expect(l.pack).toMatchObject({ pcs: 30, extra: 0, perReceivedH: null })
    expect(sar(l.effH)).toBe(12.33)
  })

  it("R-20: 175 m by 6 m pieces is 30 pieces, 180 m received, 5 over, against 175 asked", () => {
    const l = lineCalc(175, 74, 6)
    expect(l.pack).toMatchObject({ pcs: 30, packLen: 6, received: 180, extra: 5 })
    expect(sar(l.totalH)).toBe(2220)
  })

  it("the effective price is half-up to the halala: 1,080 ÷ 320 = 3.375 → 3.38", () => {
    expect(sar(lineCalc(320, 13.5, 4).effH)).toBe(3.38)
  })

  it("G-02: for any quantity, length and price the identity holds", () => {
    const quantities = [1, 7, 12, 12.5, 100, 175, 320, 999.9]
    const lengths = [1, 2.5, 3, 4, 6, 12]
    const prices = [0.01, 1, 12.5, 74, 146, 1234.56]
    for (const qty of quantities)
      for (const len of lengths)
        for (const price of prices) {
          const l = lineCalc(qty, price, len)
          const pcs = Math.ceil(qty / len - 1e-9)
          expect(l.pack?.pcs).toBe(pcs)
          expect(l.totalH).toBe(pcs * toHalalas(price))
          expect(Math.abs(l.effExactH - l.totalH / qty)).toBeLessThan(1e-9)
          expect(l.pack?.extra).toBeCloseTo(pcs * len - qty, 2)
        }
  })

  it("a float that lands a hair above a whole number of pieces does not buy an extra piece", () => {
    expect(lineCalc(0.6, 10, 0.2).pack?.pcs).toBe(3)
    expect(lineCalc(0.7, 10, 0.1).pack?.pcs).toBe(7)
  })

  it("a zero or absent pack length is a per-unit rate", () => {
    expect(lineCalc(10, 5, 0).pack).toBeNull()
    expect(lineCalc(10, 5, null).pack).toBeNull()
    expect(lineCalc(10, 5, "").pack).toBeNull()
  })
})

describe("RFQ-2026/011 — the PRD's worked example", () => {
  const ev = evaluateOffers(rfq011, all011, { today: "2026-10-21" })
  const line1 = (id: string) => lineOf(ev.byId[id], 0)!

  it("line 1 totals, effective prices and «per metre received» are the PRD's table", () => {
    expect(sar(line1("jodah").totalH)).toBe(2187.5)
    expect(sar(line1("sharq").totalH)).toBe(2190)
    expect(sar(line1("wusta").totalH)).toBe(2220)
    expect(sar(line1("ofuq").totalH)).toBe(2257.5)
    expect(sar(line1("amal").totalH)).toBe(2400)
    expect([jodah, sharq, wusta, ofuq, amal].map((o) => sar(lineOf(ev.byId[o.id!], 0)!.effH))).toEqual([12.5, 12.51, 12.69, 12.9, 13.71])
    expect([sharq, wusta, amal].map((o) => sar(lineOf(ev.byId[o.id!], 0)!.pack!.perReceivedH as number))).toEqual([12.17, 12.33, 13.33])
  })

  it("R-31: 12.50 and 12.51 are both «الأقل» — the second is within 0.5 %; 12.69 is not", () => {
    expect(ev.lines[0].bestOfferId).toBe("jodah")
    expect(ev.lines[0].lowestIds).toEqual(["jodah", "sharq"])
    expect(2190 <= 2187.5 * 1.005).toBe(true)
  })

  it("line 2: الأمل 80 pieces × 4 m × 13.5 = 1,080 is the lowest at 3.38", () => {
    const l = lineOf(ev.byId.amal, 1)!
    expect(sar(l.totalH)).toBe(1080)
    expect(sar(l.effH)).toBe(3.38)
    expect(ev.lines[1].bestOfferId).toBe("amal")
    expect(ev.lines[1].lowestIds).toEqual(["amal"])
    expect(sar(lineOf(ev.byId.jodah, 1)!.totalH)).toBe(1152)
    expect(sar(lineOf(ev.byId.bina, 1)!.totalH)).toBe(1136)
  })

  it("the lowest COMPLETE offer is الجودة: (2,187.50 + 1,152.00) × 1.15 = 3,840.43 — partial offers never rank", () => {
    expect(ev.lowestComplete?.id).toBe("jodah")
    expect(sar(ev.lowestComplete!.netH as number)).toBe(3339.5)
    expect(sar(ev.lowestComplete!.grossH as number)).toBe(3840.43)
    expect(ev.byId.jodah.rank).toBe(1)
    expect(ev.byId.amal.rank).toBe(2)
    for (const id of ["sharq", "wusta", "ofuq", "bina"]) expect(ev.byId[id]).toMatchObject({ rank: null, complete: false, partial: true })
  })

  it("الأمل: 3,480 ex-VAT, 4,002 with VAT, +4.21 % over the lowest", () => {
    expect(sar(ev.byId.amal.netH as number)).toBe(3480)
    expect(sar(ev.byId.amal.grossH as number)).toBe(4002)
    expect(ev.byId.amal.deltaPct).toBe(4.21)
    expect(ev.byId.jodah.deltaPct).toBe(0)
    expect(ev.byId.sharq.deltaPct).toBeNull()
  })

  it("if split: the lowest per line comes to 3,267.50 ex-VAT, 3,757.63 with VAT, saving 82.80 (2.16 %) from two suppliers", () => {
    expect(ev.mix).toMatchObject({ suppliers: 2, offerIds: ["jodah", "amal"], worthSaying: true })
    expect(sar(ev.mix!.netH)).toBe(3267.5)
    expect(sar(ev.mix!.grossH)).toBe(3757.63)
    expect(sar(ev.mix!.savingH as number)).toBe(82.8)
    expect(ev.mix!.savingPct).toBe(2.16)
  })

  it("competition counts live offers PER LINE: 5 on the angles, 3 on the timber", () => {
    expect(ev.lines.map((l) => l.liveCount)).toEqual([5, 3])
    expect(ev.thinnest).toMatchObject({ rfqProductIndex: 1, liveCount: 3 })
  })

  it("the fastest offer is among the complete ones when any exists", () => {
    expect(ev.fastest?.id).toBe("jodah")
    const noFull = evaluateOffers(rfq011, [sharq, wusta, ofuq])
    expect(noFull.fastest?.id).toBe("ofuq")
    expect(noFull.lowestComplete).toBeNull()
    expect(noFull.mix).toBeNull()
  })

  it("expiry: valid until 25 Oct reads «soon» two days before, still valid on the last day, expired after (CMP-18)", () => {
    expect(validityState("2026-10-25", "2026-10-21")).toBe("ok")
    expect(validityState("2026-10-25", "2026-10-23")).toBe("soon")
    expect(validityState("2026-10-25", "2026-10-25")).toBe("soon")
    expect(isExpired("2026-10-25", "2026-10-25")).toBe(false)
    expect(isExpired("2026-10-25", "2026-10-26")).toBe(true)
    expect(validityState(null, "2026-10-26")).toBe("none")
    expect(evaluateOffers(rfq011, all011, { today: "2026-10-26" }).byId.amal.expired).toBe(true)
    expect(ev.byId.amal.expired).toBe(false)
  })
})

describe("G-03 — the lowest complete offer is one number", () => {
  it("the selector, the evaluation, the rank-1 row and the matrix mark agree", () => {
    const sel = lowestCompleteOffer(rfq011, all011)
    const ev = evaluateOffers(rfq011, all011)
    const m = offerMatrix(rfq011, all011.map((o) => ({ ...o, id: o.id as string, price: undefined })) as MatrixOffer[])
    expect(sel?.id).toBe(ev.offers.find((o) => o.rank === 1)?.id)
    expect(m.columns.filter((c) => c.lowestTotal).map((c) => c.offerId)).toEqual([sel!.id])
    expect(m.columns.find((c) => c.offerId === sel!.id)?.total).toBe(sar(sel!.netH as number))
    expect(sar(sel!.grossH as number)).toBe(3840.43)
  })

  it("does not move with the order the offers arrive in, except that the earlier one wins an exact tie", () => {
    const a: CalcOffer = { id: "a", lump: 1000 }
    const b: CalcOffer = { id: "b", lump: 1000 }
    expect(lowestCompleteOffer({ products: [{ name: "x", quantity: 1 }] }, [a, b])?.id).toBe("a")
    expect(lowestCompleteOffer({ products: [{ name: "x", quantity: 1 }] }, [b, a])?.id).toBe("b")
    expect(lowestCompleteOffer(rfq011, [...all011].reverse())?.id).toBe("jodah")
  })

  it("ranks before VAT: an unregistered supplier's higher net does not beat a cheaper registered one", () => {
    const rfq = { products: [{ name: "x", quantity: 1 }] }
    const reg: CalcOffer = { id: "reg", lump: 990 }
    const unreg: CalcOffer = { id: "unreg", lump: 1000, vatRegistered: false }
    const ev = evaluateOffers(rfq, [unreg, reg])
    expect(ev.lowestComplete?.id).toBe("reg")
    expect(sar(ev.byId.reg.grossH as number)).toBe(1138.5)
    expect(sar(ev.byId.unreg.grossH as number)).toBe(1000)
  })

  it("an excluded offer never becomes the lowest, and its price does not count as competition", () => {
    const out = { ...jodah, excluded: true }
    const ev = evaluateOffers(rfq011, [out, sharq, wusta, ofuq, amal, bina])
    expect(ev.lowestComplete?.id).toBe("amal")
    expect(ev.lines[0].lowestIds).toEqual(["sharq"])
    expect(ev.lines.map((l) => l.liveCount)).toEqual([4, 2])
    expect(ev.byId.jodah).toMatchObject({ live: false, rank: null })
  })

  it("no live offer: nothing is lowest, and the evaluation says so", () => {
    const ev = evaluateOffers(rfq011, [{ ...jodah, excluded: true }, { ...amal, excluded: true }])
    expect(ev).toMatchObject({ lowestComplete: null, hasLive: false, mix: null, fastest: null })
  })
})

describe("R-31 — the tie band", () => {
  it("exactly 0.5 % over is a tie; one halala more is not", () => {
    expect(isTie(100500, 100000)).toBe(true)
    expect(isTie(100501, 100000)).toBe(false)
    expect(isTie(100000, 100000)).toBe(true)
  })

  it("the band is the policy's: 0 % makes only an exact tie, 1 % widens it", () => {
    expect(isTie(100001, 100000, 0)).toBe(false)
    expect(isTie(100000, 100000, 0)).toBe(true)
    expect(isTie(101000, 100000, 1)).toBe(true)
    expect(isTie(101001, 100000, 1)).toBe(false)
    const rfq = { products: [{ name: "x", quantity: 1 }] }
    const offers: CalcOffer[] = [{ id: "a", lump: 1000 }, { id: "b", lump: 1008 }]
    expect(evaluateOffers(rfq, offers).offers.map((o) => o.isLowestComplete)).toEqual([true, false])
    expect(evaluateOffers(rfq, offers, { tiePercent: 1 }).offers.map((o) => o.isLowestComplete)).toEqual([true, true])
  })

  it("both tied offers are «lowest complete» and neither needs a reason when picked", () => {
    const rfq = { products: [{ name: "x", quantity: 1 }] }
    const ev = evaluateOffers(rfq, [{ id: "a", lump: 1000 }, { id: "b", lump: 1004 }, { id: "c", lump: 1020 }])
    expect(ev.offers.map((o) => o.isLowestComplete)).toEqual([true, true, false])
    expect(nonLowestPicks(ev, [{ rfqProductIndex: 0, offerId: "b" }])).toEqual([])
    expect(nonLowestPicks(ev, [{ rfqProductIndex: 0, offerId: "c" }])).toHaveLength(1)
  })

  it("the matrix marks the whole band on a line and on the totals", () => {
    const offers: MatrixOffer[] = [
      { id: "jodah", price: 3339.5, lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }] },
      { id: "sharq", price: 3342, lines: [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }, { rfqProductIndex: 1, unitPrice: 3.6 }] },
      { id: "wusta", price: 3372, lines: [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 3.6 }] },
    ]
    const m = offerMatrix(rfq011, offers)
    expect(m.rows[0].cells.filter((c) => c.lowest).map((c) => c.offerId)).toEqual(["jodah", "sharq"])
    expect(m.columns.filter((c) => c.lowestTotal).map((c) => c.offerId)).toEqual(["jodah", "sharq"])
    expect(m.rows[0].cells[1]).toMatchObject({ unitPrice: 12.51, lineTotal: 2190, quoted: true, pack: { pcs: 15, packLen: 12, extra: 5 } })
    expect(m.columns[1].total).toBe(sar(lineCalc(175, 146, 12).totalH + lineCalc(320, 3.6).totalH))
  })
})

describe("R-18 and G-18 — VAT by registration, one basis per amount", () => {
  it("an unregistered supplier's total carries no VAT: gross equals net", () => {
    const o = calcOffer({ products: [{ name: "a", quantity: 1 }, { name: "b", quantity: 1 }], pricingMode: "line" }, { id: "x", vatRegistered: false, lines: [{ rfqProductIndex: 0, unitPrice: 60 }, { rfqProductIndex: 1, unitPrice: 90 }] })
    expect(sar(o.netH as number)).toBe(150)
    expect(o.grossH).toBe(o.netH)
    expect(o.vatRate).toBe(0)
    expect(basisOf(o.vatRate)).toBe("no_vat")
  })

  it("a registered supplier's gross is net × 1.15 to the halala, and an older offer with no flag is registered", () => {
    const o = calcOffer(rfq011, jodah)
    expect(o.vatRate).toBe(0.15)
    expect(sar(o.grossH as number)).toBe(3840.43)
    expect(basisOf(o.vatRate)).toBe("incl_vat")
  })

  it("the rate a version stored wins over the default", () => {
    expect(calcOffer(rfq011, { ...jodah, vatRate: 0 }).grossH).toBe(calcOffer(rfq011, jodah).netH)
  })
})

describe("CMP-12 — a lump sum is one value", () => {
  const rfq = { pricingMode: "total", products: [{ name: "a", quantity: 10 }, { name: "b", quantity: 20 }, { name: "c", quantity: 5 }] }
  const offers: CalcOffer[] = [{ id: "l1", lump: 9000, leadDays: 3 }, { id: "l2", lump: 8800, leadDays: 6 }, { id: "l3", lump: 9500, vatRegistered: false }]
  const ev = evaluateOffers(rfq, offers)

  it("no line prices, no per-line best, no split", () => {
    expect(ev.offers.every((o) => o.kind === "lump" && o.lines.length === 0)).toBe(true)
    expect(ev.lines.every((l) => l.bestOfferId === null)).toBe(true)
    expect(ev.mix).toBeNull()
  })

  it("the lowest lump is the lowest complete offer; every lump counts as a live offer on every line", () => {
    expect(ev.lowestComplete?.id).toBe("l2")
    expect(ev.lines.map((l) => l.liveCount)).toEqual([3, 3, 3])
    expect(sar(ev.byId.l2.grossH as number)).toBe(10120)
    expect(sar(ev.byId.l1.grossH as number)).toBe(10350)
    expect(sar(ev.byId.l3.grossH as number)).toBe(9500)
  })

  it("awarding the lump counts its value once however many lines point at it", () => {
    const picks: AwardPick[] = [0, 1, 2].map((i) => ({ rfqProductIndex: i, offerId: "l1" }))
    expect(sar(awardNetH(ev, picks))).toBe(9000)
    expect(nonLowestPicks(ev, picks)).toHaveLength(3)
    expect(isLowestPick(ev, { rfqProductIndex: 0, offerId: "l2" })).toBe(true)
  })

  it("a total-priced offer of a single material is that material's rate, not a lump", () => {
    const one = calcOffer({ products: [{ name: "tiles", quantity: 100 }] }, { id: "t", price: 11800 })
    expect(one.kind).toBe("total")
    expect(sar(one.lines[0].effH)).toBe(118)
    expect(one.complete).toBe(true)
  })

  it("a legacy price-only offer over several materials is a lump, not an invented split", () => {
    const o = calcOffer(rfq011, { id: "legacy", price: "12,500" })
    expect(o).toMatchObject({ kind: "lump", lines: [], complete: true })
    expect(sar(o.netH as number)).toBe(12500)
  })
})

describe("coverage — partial offers never rank", () => {
  it("«covers 1 of 2» and the line that is not covered", () => {
    const o = calcOffer(rfq011, sharq)
    expect(o).toMatchObject({ covered: 1, of: 2, partial: true, uncovered: [1], complete: false })
    expect(offerCoverage(rfq011, sharq)).toEqual({ covered: 1, of: 2, partial: true, uncovered: [1] })
  })

  it("an offer whose rates went stale (a total revised on its own) is set aside for its total", () => {
    const steel = { pricingMode: "line", products: [{ name: "steel", quantity: 5, unitOfMeasure: "t" }] }
    const stale: CalcOffer = { id: "s", price: 14645, lines: [{ rfqProductIndex: 0, unitPrice: 3190 }] }
    expect(calcOffer(steel, stale)).toMatchObject({ kind: "total", netH: 1464500 })
    expect(sar(calcOffer(steel, stale).lines[0].effH)).toBe(2929)
  })

  it("rates in force reconcile pack-aware: 15 pieces × 146 is 2,190, not 175 × 146", () => {
    const products = pricedProducts({ pricingMode: "line", products: [{ name: "angles", quantity: 175, unitOfMeasure: "م" }] })
    expect(quotedRatesReconcile(products, { price: 2190, lines: [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }] })).toBe(true)
    expect(quotedRatesReconcile(products, { price: 25550, lines: [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }] })).toBe(false)
  })
})

describe("G-18 — competition is counted per line against the policy, and the 20,000 threshold is before VAT", () => {
  const ev = evaluateOffers(rfq011, [jodah, amal, bina])

  it("a thin line below the limit with a value over the threshold owes a reason — it never blocks", () => {
    const picks: AwardPick[] = [{ rfqProductIndex: 1, offerId: "amal" }]
    const low = lowCompetition(ev, picks, { limit: 3, thresholdSar: 1000 })
    expect(low.lines).toEqual([])
    const thin = evaluateOffers(rfq011, [jodah, amal])
    const low2 = lowCompetition(thin, [{ rfqProductIndex: 0, offerId: "jodah" }, { rfqProductIndex: 1, offerId: "amal" }], { limit: 3, thresholdSar: 1000 })
    expect(low2.lines).toEqual([{ rfqProductIndex: 0, liveCount: 2 }, { rfqProductIndex: 1, liveCount: 2 }])
    expect(low2.required).toBe(true)
  })

  it("under the threshold there is no reason even with one offer; the default is 20,000 ex-VAT and 3 offers", () => {
    const solo = evaluateOffers({ products: [{ name: "x", quantity: 1 }] }, [{ id: "a", lump: 19999.99 }])
    expect(lowCompetition(solo, [{ rfqProductIndex: 0, offerId: "a" }]).required).toBe(false)
    const over = evaluateOffers({ products: [{ name: "x", quantity: 1 }] }, [{ id: "a", lump: 20000.01 }])
    expect(lowCompetition(over, [{ rfqProductIndex: 0, offerId: "a" }]).required).toBe(true)
    const exact = evaluateOffers({ products: [{ name: "x", quantity: 1 }] }, [{ id: "a", lump: 20000 }])
    expect(lowCompetition(exact, [{ rfqProductIndex: 0, offerId: "a" }]).required).toBe(false)
  })

  it("the threshold is ex-VAT: 19,500 net is 22,425 with VAT and still owes nothing", () => {
    const e = evaluateOffers({ products: [{ name: "x", quantity: 1 }] }, [{ id: "a", lump: 19500 }])
    expect(sar(e.byId.a.grossH as number)).toBe(22425)
    expect(lowCompetition(e, [{ rfqProductIndex: 0, offerId: "a" }]).required).toBe(false)
  })

  it("only the lines being awarded count: a thin line left out of the award owes nothing", () => {
    const rfq = { pricingMode: "line", products: [{ name: "a", quantity: 1000 }, { name: "b", quantity: 1000 }] }
    const offers: CalcOffer[] = [
      { id: "x", lines: [{ rfqProductIndex: 0, unitPrice: 30 }, { rfqProductIndex: 1, unitPrice: 31 }] },
      { id: "y", lines: [{ rfqProductIndex: 0, unitPrice: 31 }], skippedItems: [1] },
      { id: "z", lines: [{ rfqProductIndex: 0, unitPrice: 32 }], skippedItems: [1] },
    ]
    const e = evaluateOffers(rfq, offers)
    expect(e.lines.map((l) => l.liveCount)).toEqual([3, 1])
    expect(lowCompetition(e, [{ rfqProductIndex: 0, offerId: "x" }]).required).toBe(false)
    expect(lowCompetition(e, [{ rfqProductIndex: 0, offerId: "x" }, { rfqProductIndex: 1, offerId: "x" }]).required).toBe(true)
  })

  it("R-08: the reason is a structured choice; «other» needs text; no reason owed means no refusal", () => {
    const owed = { lines: [{ rfqProductIndex: 0, liveCount: 1 }], netH: 5_000_000, required: true }
    expect(lowCompetitionReasonRefusal(null, owed)).toBe("lowcomp_reason_required")
    expect(lowCompetitionReasonRefusal({ code: "bogus" }, owed)).toBe("lowcomp_reason_required")
    expect(lowCompetitionReasonRefusal({ code: "other", text: "x" }, owed)).toBe("reason_text_short")
    expect(lowCompetitionReasonRefusal({ code: "urgent" }, owed)).toBeNull()
    expect(lowCompetitionReasonRefusal({ code: "other", text: "سبب مكتوب" }, owed)).toBeNull()
    expect(lowCompetitionReasonRefusal(null, { ...owed, required: false })).toBeNull()
  })
})

describe("CMP-08 / R-15 — a structured reason is available only when the numbers back it", () => {
  const facts = (over: Partial<ReasonFacts> = {}): ReasonFacts => ({ leadDays: 5, onTimeRate: null, hasOfficialQuote: true, warrantyMet: null, ...over })
  const line = (awarded: Partial<ReasonFacts>, lowest: Partial<ReasonFacts>): NonLowestLine => ({ awarded: facts(awarded), lowest: facts(lowest) })
  const ctx = { awardedSuppliers: 1, splitSuppliers: 1 }

  it("fastest: only when faster on every passed-over line", () => {
    expect(awardReasonEligible("fastest", [line({ leadDays: 3 }, { leadDays: 5 })], ctx)).toBe(true)
    expect(awardReasonEligible("fastest", [line({ leadDays: 5 }, { leadDays: 5 })], ctx)).toBe(false)
    expect(awardReasonEligible("fastest", [line({ leadDays: 3 }, { leadDays: 5 }), line({ leadDays: 6 }, { leadDays: 5 })], ctx)).toBe(false)
    expect(awardReasonEligible("fastest", [line({ leadDays: null }, { leadDays: 5 })], ctx)).toBe(false)
  })

  it("reliability: only when his on-time rate is higher; no record is not better", () => {
    expect(awardReasonEligible("reliability", [line({ onTimeRate: 96 }, { onTimeRate: 80 })], ctx)).toBe(true)
    expect(awardReasonEligible("reliability", [line({ onTimeRate: 96 }, { onTimeRate: null })], ctx)).toBe(true)
    expect(awardReasonEligible("reliability", [line({ onTimeRate: 80 }, { onTimeRate: 80 })], ctx)).toBe(false)
    expect(awardReasonEligible("reliability", [line({ onTimeRate: null }, { onTimeRate: 60 })], ctx)).toBe(false)
  })

  it("warranty: only when the lowest fails the requirement", () => {
    expect(awardReasonEligible("warranty", [line({ warrantyMet: true }, { warrantyMet: false })], ctx)).toBe(true)
    expect(awardReasonEligible("warranty", [line({ warrantyMet: true }, { warrantyMet: true })], ctx)).toBe(false)
    expect(awardReasonEligible("warranty", [line({}, { warrantyMet: null })], ctx)).toBe(false)
  })

  it("official quote: the lowest has none and he does", () => {
    expect(awardReasonEligible("official_quote", [line({ hasOfficialQuote: true }, { hasOfficialQuote: false })], ctx)).toBe(true)
    expect(awardReasonEligible("official_quote", [line({ hasOfficialQuote: true }, { hasOfficialQuote: true })], ctx)).toBe(false)
    expect(awardReasonEligible("official_quote", [line({ hasOfficialQuote: false }, { hasOfficialQuote: false })], ctx)).toBe(false)
  })

  it("one supplier: only when the award uses fewer suppliers than the cheapest split", () => {
    expect(awardReasonEligible("one_supplier", [line({}, {})], { awardedSuppliers: 1, splitSuppliers: 3 })).toBe(true)
    expect(awardReasonEligible("one_supplier", [line({}, {})], { awardedSuppliers: 2, splitSuppliers: 2 })).toBe(false)
  })

  it("«other» is always open but must be written", () => {
    expect(awardReasonEligible("other", [line({}, {})], ctx)).toBe(true)
    expect(awardReasonRefusal({ code: "other", text: "x" }, [line({}, {})], ctx)).toBe("reason_text_short")
    expect(awardReasonRefusal({ code: "other", text: "سبب مكتوب" }, [line({}, {})], ctx)).toBeNull()
  })

  it("G-04: a non-lowest award with no reason, an unknown code or an untrue one is refused; the lowest needs none", () => {
    const l = [line({ leadDays: 6 }, { leadDays: 5 })]
    expect(awardReasonRefusal(null, l, ctx)).toBe("reason_required")
    expect(awardReasonRefusal({ code: "nope" }, l, ctx)).toBe("reason_required")
    expect(awardReasonRefusal({ code: "fastest" }, l, ctx)).toBe("reason_untrue")
    expect(awardReasonRefusal({ code: "other", text: "نقل مجاني للموقع" }, l, ctx)).toBeNull()
    expect(awardReasonRefusal(null, [], ctx)).toBeNull()
    expect(AWARD_WHY_CODES).toContain("fastest")
  })

  it("the passed-over lines are found from the evaluation, ties excluded", () => {
    const ev = evaluateOffers(rfq011, all011)
    const picks: AwardPick[] = [{ rfqProductIndex: 0, offerId: "sharq" }, { rfqProductIndex: 1, offerId: "bina" }]
    expect(nonLowestPicks(ev, picks)).toEqual([{ rfqProductIndex: 1, offerId: "bina" }])
    expect(isLowestPick(ev, { rfqProductIndex: 0, offerId: "wusta" })).toBe(false)
  })

  it("«lowest from the verified with an official quote» is the same call with a filter", () => {
    const ev = evaluateOffers(rfq011, all011)
    const withQuote = new Set(["sharq", "wusta"])
    expect(lowestOnLine(ev, 0)?.id).toBe("jodah")
    expect(lowestOnLine(ev, 0, (o) => withQuote.has(o.id))?.id).toBe("sharq")
    expect(lowestOnLine(ev, 1, (o) => withQuote.has(o.id))).toBeNull()
  })
})

describe("CMP-18 and arrival", () => {
  it("«يصل نحو» is today + the acceptance window + the offer's lead days", () => {
    expect(arrivalEstimate("2026-10-21", 1, 5)).toBe("2026-10-27")
    expect(arrivalEstimate("2026-10-30", 1, 5)).toBe("2026-11-05")
    expect(arrivalEstimate("2026-10-21", 1, null)).toBeNull()
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01")
  })

  it("late only when it lands after the need date", () => {
    expect(arrivalVsNeed("2026-10-27", "2026-10-26")).toEqual({ late: true, daysLate: 1 })
    expect(arrivalVsNeed("2026-10-27", "2026-10-27")).toEqual({ late: false, daysLate: 0 })
    expect(arrivalVsNeed("2026-10-27", null)).toBeNull()
  })

  it("R-19: a confirmed price (a new validity) makes an expired offer eligible again", () => {
    const expired = evaluateOffers(rfq011, [{ ...amal, validUntil: "2026-10-20" }], { today: "2026-10-21" })
    expect(expired.byId.amal).toMatchObject({ expired: true, validity: "expired" })
    const reval = evaluateOffers(rfq011, [{ ...amal, validUntil: "2026-11-20" }], { today: "2026-10-21" })
    expect(reval.byId.amal).toMatchObject({ expired: false, validity: "ok" })
  })
})

describe("the existing helpers delegate to it", () => {
  const rfq = { pricingMode: "line", products: [{ name: "angles", quantity: 175, unitOfMeasure: "م" }] }
  const products = pricedProducts(rfq)

  it("priceOffer prices a per-piece rate by the pieces and stores the pack beside the rate", () => {
    const p = priceOffer(products, { 0: "146" }, [], { 0: 12 })
    expect(p.total).toBe(2190)
    expect(offerPricingFields(p)).toEqual({ lines: [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }], price: "2190" })
  })

  it("a per-unit offer is exactly what it was: no packLen key at all", () => {
    expect(offerPricingFields(priceOffer(products, { 0: "12.5" }))).toEqual({ lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }], price: "2187.5" })
  })

  it("the public endpoint recomputes a per-piece quote from the pieces and ignores a posted total", () => {
    expect(guestOfferPrice(rfq, [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6 }], 1)).toMatchObject({ ok: true, total: 2220, price: "2220" })
  })

  it("offerRates compares per-piece lines by their EFFECTIVE price, and ratesAboveLastPaid uses it", () => {
    const [r] = offerRates(rfq, { price: 2190, lines: [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }] })
    expect(r).toMatchObject({ unitPrice: 12.51, lineTotal: 2190, quoted: true })
    expect(r.pack).toMatchObject({ pcs: 15, extra: 5 })
    const [cmp] = ratesAboveLastPaid([r], () => ({ price: 12 }))
    expect(cmp.percent).toBe(aboveLastPaid(12.51, 12))
  })

  it("a price revision keeps the pieces: 74 → 70 per 6 m piece is 30 × 70 = 2,100", () => {
    const rev = revisePrice({ price: 2220, lines: [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6 }] }, products, { rates: { 0: 70 } })
    expect(rev).toMatchObject({ ok: true, total: 2100 })
    expect(rev.ok && rev.fields.lines).toEqual([{ rfqProductIndex: 0, unitPrice: 70, packLen: 6 }])
  })

  it("coverage through offer-pricing is the calc's coverage", () => {
    expect(offerCoverage(rfq011, jodah)).toMatchObject({ partial: false })
    expect(offerCoverage(rfq011, ofuq)).toMatchObject({ partial: true, uncovered: [1] })
  })
})

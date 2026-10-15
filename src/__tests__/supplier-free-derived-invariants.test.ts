/**
 * Supplier 1.0 — the invariants G-01 … G-12 over a world DERIVED from stored documents (the invariants test runs them
 * over the prototype's fixture): requests, quotes, orders with partial, rejected, held and discounted receipts, invoices
 * per receipt and transfers — each of the stored shapes the screens will meet. Whatever documents say, the same rules hold.
 */

import { deriveWorld, type RawWorld } from "@/lib/supplier-free/derive"
import { createWorldLogic } from "@/lib/supplier-free/world-logic"
import { STAGES, addDaysTo } from "@/lib/supplier-free/deal-logic"
import type { Deal } from "@/lib/supplier-free/types"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ME = "sup1"
const TODAY = "2026-10-20"

const rfq = (id: string, n: number, over: Record<string, unknown> = {}) => ({
  id,
  organizationId: "con1",
  contractorId: "con1",
  rfqNumber: `RFQ-2026/0${n}`,
  title: `طلب ${n}`,
  category: "طوب وبلوك",
  city: "الرياض",
  status: "New",
  visibility: "public",
  createdAt: "2026-10-01T08:00:00.000Z",
  deadline: "2026-10-30",
  needBy: "2026-11-10",
  products: [{ name: "بلوك", quantity: 100, unitOfMeasure: "حبة", description: "" }],
  ...over,
})

const offer = (id: string, rfqId: string, over: Record<string, unknown> = {}) => ({
  id,
  rfqId,
  organizationId: ME,
  status: "قيد المراجعة",
  price: "200",
  lines: [{ rfqProductIndex: 0, unitPrice: 2 }],
  validUntil: "2026-11-10",
  deliveryBatches: [{ location: "x", deliveryDate: "2026-10-25", price: "200", quantity: "100" }],
  createdAt: "2026-10-02T08:00:00.000Z",
  updatedAt: "2026-10-02T08:00:00.000Z",
  ...over,
})

const po = (id: string, rfqId: string, offerId: string, n: number, line: Record<string, unknown>, over: Record<string, unknown> = {}): PurchaseOrder =>
  ({
    id,
    organizationId: "con1",
    docNumber: `PO-2026/0${n}`,
    status: "accepted",
    basis: "rfq",
    rfqId,
    rfqTitle: "x",
    offerId,
    supplierOrgId: ME,
    supplierUserId: ME,
    supplierName: "S",
    isGuestSupplier: false,
    lines: [{ id: "l1", name: "بلوك", unit: "حبة", quantity: 100, unitPrice: 2, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0, ...line }],
    totalExVat: 200,
    vatRate: 0.15,
    preparedById: "buyer1",
    preparedByName: "B",
    createdAt: "2026-10-03T08:00:00.000Z",
    sentAt: "2026-10-03T09:00:00.000Z",
    supplierAcceptedAt: "2026-10-04T08:00:00.000Z",
    promisedDate: "2026-10-12",
    requestedDeliveryDate: "2026-10-12",
    termsList: [{ pct: 50, days: 15 }, { pct: 50, days: 30 }],
    approverKind: "manager",
    log: [],
    ...over,
  }) as unknown as PurchaseOrder

const grn = (id: string, poId: string, no: string, day: string, accepted: number, extra: Record<string, unknown> = {}) => ({
  id,
  poId,
  status: "confirmed",
  docNumber: no,
  deliveryDate: day,
  confirmedAt: `${day}T08:00:00.000Z`,
  confirmedByName: "خالد",
  lines: [{ poLineId: "l1", counted: accepted, rejected: 0, held: 0, accepted, ...extra }],
})

const raw = (): RawWorld => {
  const pos = [
    // p2: accepted, nothing received yet, promised date passed
    po("p2", "r2", "o2", 2, {}),
    // p3: part received (60 of 100), the rest left and late
    po("p3", "r3", "o3", 3, { accepted: 60 }),
    // p4: 60 received, 40 rejected and the contractor chose to replace them by a later date
    po("p4", "r4", "o4", 4, { accepted: 60, rejected: 40, rejectDecision: "replace", rejectReplaceBy: "2026-10-30" }),
    // p5: 60 received, 40 rejected, kept at a discount and released: billable at the discounted price
    po("p5", "r5", "o5", 5, { accepted: 100, rejected: 40, rejectDecision: "discount", rejectDiscountPrice: 1.5, rejectDiscountState: "released" }, { log: [{ at: "2026-10-15T08:00:00.000Z", byId: "u", byName: "u", action: "reject_discount_released", note: null, params: { lineId: "l1" } }] }),
    // p6: all received and invoiced, one transfer confirmed, one missing
    po("p6", "r6", "o6", 6, { accepted: 100 }),
    // p7: 30 on hold after being received
    po("p7", "r7", "o7", 7, { accepted: 60, held: 30 }),
  ]
  return {
    today: TODAY,
    myOrgId: ME,
    myUid: ME,
    rfqs: [rfq("r1", 1), rfq("r2", 2), rfq("r3", 3), rfq("r4", 4), rfq("r5", 5), rfq("r6", 6), rfq("r7", 7), rfq("r8", 8, { visibility: "private", allowedSupplierOrgIds: [ME] })],
    offers: [
      offer("o1", "r1"),
      offer("o2", "r2", { status: "مقبول", poId: "p2" }),
      offer("o3", "r3", { status: "مقبول", poId: "p3" }),
      offer("o4", "r4", { status: "مقبول", poId: "p4" }),
      offer("o5", "r5", { status: "مقبول", poId: "p5" }),
      offer("o6", "r6", { status: "مقبول", poId: "p6" }),
      offer("o7", "r7", { status: "مقبول", poId: "p7" }),
    ],
    pos,
    deliveries: [
      grn("d3", "p3", "GR-2026/031", "2026-10-10", 60),
      grn("d4", "p4", "GR-2026/041", "2026-10-10", 60),
      grn("d5", "p5", "GR-2026/051", "2026-10-10", 60),
      grn("d6", "p6", "GR-2026/061", "2026-10-11", 100),
      grn("d7", "p7", "GR-2026/071", "2026-10-10", 60),
    ],
    invoices: [{ id: "iv6", poId: "p6", number: "ف-6", date: "2026-10-12", amountNet: 200, vat: 0.15, file: { name: "a.pdf", url: "https://x/a.pdf" }, grns: ["GR-2026/061"] }],
    transfers: [
      { id: "t1", poId: "p6", amount: 115, bank: "الراجحي", ref: "T1", reportedAt: "2026-10-14T00:00:00.000Z", state: "ok", confirmedAt: "2026-10-15T00:00:00.000Z" },
      { id: "t2", poId: "p6", amount: 115, bank: "الراجحي", ref: "T2", reportedAt: "2026-10-16T00:00:00.000Z", state: "miss", confirmedAt: "2026-10-17T00:00:00.000Z" },
    ],
    warranties: [],
    chats: [],
    contractors: { con1: { companyName: "آفاق فنية", city: "الرياض", isVerified: true } },
    links: [],
    invitations: [],
    archived: {},
    seen: {},
    declined: {},
    questions: {},
  }
}

const world = deriveWorld(raw())
const L = createWorldLogic(TODAY, world)
const deal = (rfqId: string): Deal => world.deals.find((d) => d.id === rfqId) as Deal

describe("the derived world", () => {
  it("has a deal for every request the supplier may see", () => {
    expect(world.deals.map((d) => d.id).sort()).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"])
  })

  it("G-01 every deal is in exactly one of the five stages", () => {
    expect(world.deals.filter((d) => !(STAGES as readonly string[]).includes(L.stage(d)))).toHaveLength(0)
    expect(L.segCounts().reduce((s, x) => s + x[1], 0)).toBe(world.deals.length)
  })

  it("G-02 ordered = accepted + cancelled + left on every line", () => {
    for (const d of world.deals.filter((x) => x.po)) {
      for (const l of d.po!.lines) {
        const s = L.lineSt(l)
        expect(s.got + s.can + s.left).toBe(s.ord)
      }
    }
  })

  it("G-05 lateness: nothing received and past the promise is late; a replacement is late only after its own date; goods on hold and a discount waiting are not his to deliver", () => {
    expect(L.isLate(deal("r2"))).toBe(true)
    expect(L.isLate(deal("r3"))).toBe(true)
    expect(L.isLate(deal("r4"))).toBe(false)
    expect(L.isLate(deal("r7"))).toBe(true) // 100 − 60 − 30 held = 10 still owed
    expect(L.isLate(deal("r6"))).toBe(false)
  })

  it("G-07 an invoice never exceeds what was received, and a released discount is a receipt of its own at the discounted price", () => {
    const d5 = deal("r5")
    const disc = d5.ship.filter((s) => s.st === "ok" && s.grn === "DISC-l1")
    expect(disc).toHaveLength(1)
    expect(L.receiptNet(d5, disc[0] as never)).toBe(60)
    for (const d of world.deals.filter((x) => x.po)) {
      const received = d.ship.filter((s) => s.st === "ok").reduce((sum, s) => sum + L.receiptNet(d, s as never), 0)
      const invoiced = d.invs.reduce((sum, i) => sum + i.amt, 0)
      expect(invoiced).toBeLessThanOrEqual(received + 0.01)
    }
  })

  it("G-08 every order's terms add up to 100% and each instalment sums to its invoice", () => {
    for (const d of world.deals.filter((x) => x.po)) expect(d.po!.terms.reduce((s, t) => s + t.pct, 0)).toBe(100)
    const d6 = deal("r6")
    const inv = d6.invs[0]
    const sched = L.sched(d6, inv)
    expect(sched.map((x) => x.due)).toEqual(d6.po!.terms.map((t) => addDaysTo(inv.date, t.days)))
    expect(sched.reduce((sum, x) => sum + x.amt, 0)).toBeCloseTo(L.invGross(inv), 1)
  })

  it("G-09 a missing transfer is never counted as paid", () => {
    expect(L.paidOk(deal("r6"))).toBe(115)
  })

  it("G-10 no document code stands in for a word: numbers are bare", () => {
    for (const d of world.deals) {
      expect(d.rfq).toMatch(/^\d{4}\/\d+$/)
      if (d.po) expect(d.po.no).toMatch(/^\d{4}\/\d+$/)
    }
  })

  it("G-11 a deal waiting on the contractor has no delivery task", () => {
    const acts = L.allActs()
    for (const d of world.deals) {
      const waitingReport = d.ship.some((s) => s.st === "wait")
      if (waitingReport) expect(acts.some((a) => a.deal === d.id && a.kind === "aShipSoon")).toBe(false)
    }
  })

  it("G-12 tasks come out in the order the rule gives, overdue first", () => {
    const acts = L.allActs()
    expect(acts.length).toBeGreaterThan(0)
    const lateIdx = acts.findIndex((a) => a.kind === "aLate")
    if (lateIdx >= 0) expect(acts.slice(0, lateIdx).every((a) => a.kind === "aLate" || a.kind === "aInviteRfq" || a.kind === "aReduce" || a.kind === "aSample")).toBe(true)
  })
})

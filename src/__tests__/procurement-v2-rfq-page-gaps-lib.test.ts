/** @jest-environment node */
/**
 * Procurement 2.0 — the RFQ page's remaining prototype gaps, the pure parts and the one server route:
 * our experience of a supplier with its last rejection and what is late now (RQ-16), the line total before his latest version
 * (RQ-13), the warranty a line asks against what he gives (RQ-14), the piece names and «أكّد سعره» of a row (RQ-08, RQ-10), the
 * per-piece rule of the details (RQ-21), and the supplier-portal view counted once per company on the server (RQ-04) — never a
 * made-up number.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (t.startsWith("tok:")) return { uid: t.slice(4) }
      throw new Error("bad")
    },
  }),
  getAdminFirestore: () => mockDb,
}))

import { buildCompareModel, experienceFrom, previousLineTotalH } from "@/lib/procurement/compare-model"
import type { PlanOffer, PlanRfq } from "@/lib/procurement/award-plan"
import { resolvePolicies } from "@/lib/procurement/policies"
import { piecePackNames, priceConfirmed, type RowOffer } from "@/lib/procurement/rfq-offers-view"
import { countPortalView, portalViewDocId, portalViewRefusal, RFQ_PORTAL_VIEWS } from "@/lib/procurement/portal-views"
import { pieceRules } from "@/lib/procurement/rfq-detail"
import type { PurchaseOrder, ReceiptFact } from "@/lib/procurement/types"
import { POST as countView } from "@/app/api/supplier/rfq-view/route"

const NOW = new Date("2026-10-25T09:00:00Z")

const po = (id: string, over: Record<string, unknown> = {}): PurchaseOrder =>
  ({
    id,
    docNumber: `PO-2026/${id}`,
    status: "accepted",
    supplierOrgId: "sup",
    supplierName: "Sharq",
    isGuestSupplier: false,
    supplierAcceptedAt: "2026-09-01",
    promisedDate: "2026-09-20",
    lines: [{ id: "l1", name: "Rebar", unit: "t", quantity: 10, accepted: 10, rejected: 0 }],
    ...over,
  }) as unknown as PurchaseOrder

describe("RQ-16 — «تجربتنا» from our orders and receipts", () => {
  it("averages our own stars, names the LATEST rejection with its reason and order, and counts what is late now", () => {
    const rated = po("011", { rating: { conformity: 4, cooperation: 5 } })
    const rated2 = po("012", { rating: { conformity: 3, cooperation: 3 } })
    const late = po("013", { promisedDate: "2026-10-01", lines: [{ id: "l1", name: "Rebar", unit: "t", quantity: 10, accepted: 2, rejected: 0 }] })
    const cancelled = po("014", { status: "cancelled", rating: { conformity: 1, cooperation: 1 } })
    const receipts = [
      { id: "g1", status: "confirmed", poId: "011", poNumber: "PO-2026/011", confirmedAt: "2026-09-10", lines: [{ poLineId: "l1", name: "Rebar", unit: "t", noticeQuantity: 10, rejected: 1, rejectReason: "damaged" }] },
      { id: "g2", status: "confirmed", poId: "012", poNumber: "PO-2026/012", confirmedAt: "2026-09-18", lines: [{ poLineId: "l1", name: "Rebar", unit: "t", noticeQuantity: 10, rejected: 3, rejectReason: "wrong_spec" }] },
      { id: "g3", status: "pending_confirmation", poId: "011", confirmedAt: "2026-09-30", lines: [{ poLineId: "l1", name: "Rebar", unit: "t", noticeQuantity: 10, rejected: 9 }] },
    ] as unknown as ReceiptFact[]
    const e = experienceFrom([rated, rated2, late, cancelled], receipts, NOW)
    expect(e.rating).toBe(3.8)
    expect(e.lastReject).toEqual({ qty: 3, unit: "t", reason: "wrong_spec", poNo: "PO-2026/012" })
    expect(e.lateNow).toBe(1)
    expect(e.orders).toBe(3)
  })

  it("a supplier with no rating, no rejection and nothing late says only his score", () => {
    const e = experienceFrom([po("021")], [], NOW)
    expect(e).toMatchObject({ rating: null, lastReject: null, lateNow: 0 })
  })
})

const rfq = { id: "r1", status: "New", pricingMode: "line", products: [{ name: "Angles", quantity: 175, unitOfMeasure: "m", warrantyMonths: 24 }, { name: "Timber", quantity: 320, unitOfMeasure: "m" }] } as unknown as PlanRfq
const offer = (id: string, lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) =>
  ({ id, companyName: id, organizationId: `org_${id}`, supplierId: `u_${id}`, status: "قيد المراجعة", lines, vatRegistered: true, leadDays: 5, validUntil: "2026-11-30", price: "0", ...over }) as unknown as PlanOffer
const model = (offers: PlanOffer[]) =>
  buildCompareModel({ rfq, offers, ctx: { today: "2026-10-25", policies: resolvePolicies(null), decisions: {}, locked: {}, liveOfferIds: new Set() }, picks: {}, history: [], experienceOf: () => null, verifiedOf: () => true })

describe("RQ-13 / RQ-14 — the cell keeps the old total struck and flags a short warranty", () => {
  it("the previous version's line total shows only when it changed", () => {
    const o = offer("A", [{ rfqProductIndex: 0, unitPrice: 12.5, warrantyMonths: 12 }, { rfqProductIndex: 1, unitPrice: 3.6 }], {
      versions: [
        { n: 1, lines: [{ rfqProductIndex: 0, unitPrice: 13 }, { rfqProductIndex: 1, unitPrice: 3.6 }] },
        { n: 2, lines: [{ rfqProductIndex: 0, unitPrice: 12.5 }, { rfqProductIndex: 1, unitPrice: 3.6 }] },
      ],
    })
    const m = model([o])
    expect(m.rows[0].cells.A.previousTotalH).toBe(227500)
    expect(m.rows[1].cells.A.previousTotalH).toBeNull()
    expect(previousLineTotalH(offer("B", [], { versions: [{ n: 1 }] }), 0, 175, 1)).toBeNull()
  })

  it("a piece-priced previous version is totalled in whole pieces", () => {
    const o = offer("S", [], { versions: [{ n: 1, lines: [{ rfqProductIndex: 0, unitPrice: 150, packLen: 12 }] }, { n: 2, lines: [] }] })
    expect(previousLineTotalH(o, 0, 175, 1)).toBe(15 * 15000)
  })

  it("the line asks 24 months: 12 is short, the row carries what is asked, a line asking nothing is never short", () => {
    const m = model([offer("A", [{ rfqProductIndex: 0, unitPrice: 12.5, warrantyMonths: 12 }, { rfqProductIndex: 1, unitPrice: 3.6, warrantyMonths: 0 }])])
    expect(m.rows[0].warrantyAsked).toBe(24)
    expect(m.rows[0].cells.A.warrantyShort).toBe(true)
    expect(m.rows[1].warrantyAsked).toBeNull()
    expect(m.rows[1].cells.A.warrantyShort).toBe(false)
  })
})

describe("RQ-08 / RQ-10 / RQ-21 — the row's piece names, «أكّد سعره», the details' piece rule", () => {
  it("names the pieces once each, by the request's name, else by their length", () => {
    const o = { id: "x", lines: [{ rfqProductIndex: 0, unitPrice: 1, packLen: 6, packKey: "قطعة 6 م" }, { rfqProductIndex: 1, unitPrice: 1, packLen: 6, packKey: "قطعة 6 م" }, { rfqProductIndex: 2, unitPrice: 1, packLen: 4 }, { rfqProductIndex: 3, unitPrice: 1 }] } as unknown as RowOffer
    expect(piecePackNames(o)).toEqual(["قطعة 6 م", "× 4"])
  })

  it("«أكّد سعره» only when his current version answered our confirmation request", () => {
    expect(priceConfirmed({ id: "a", versions: [{ n: 1 }, { n: 2, reval: true }] } as unknown as RowOffer)).toBe(true)
    expect(priceConfirmed({ id: "a", versions: [{ n: 1, reval: true }, { n: 2 }] } as unknown as RowOffer)).toBe(false)
    expect(priceConfirmed({ id: "a" } as unknown as RowOffer)).toBe(false)
  })

  it("lists the lines a supplier may price per piece with their pieces in the reader's language", () => {
    const r = { products: [{ name: "زوايا", saleUnits: [{ ar: "قطعة 6 م", en: "6 m piece", lengthM: 6 }, { ar: "قطعة 12 م", en: "12 m piece", lengthM: 12 }] }, { name: "خشب" }] }
    expect(pieceRules(r as never, "ar")).toEqual([{ name: "زوايا", units: ["قطعة 6 م", "قطعة 12 م"] }])
    expect(pieceRules(r as never, "en")[0].units).toEqual(["6 m piece", "12 m piece"])
  })
})

describe("RQ-04 — a registered supplier's open counts once per company, on the server", () => {
  beforeEach(() => {
    mockDb.docs.clear()
    mockDb.seed("rfqs/R1", { organizationId: "buyer", contractorId: "buyer", status: "New", visibility: "public", viewsCount: 7 })
    mockDb.seed("rfqs/RP", { organizationId: "buyer", status: "New", visibility: "private", invitedSupplierOrgIds: ["supA"], viewsCount: 0 })
    mockDb.seed("users/supA", { role: "Supplier", organizationId: "supA" })
    mockDb.seed("users/supA2", { role: "Supplier", organizationId: "supA" })
    mockDb.seed("users/supB", { role: "Supplier", organizationId: "supB" })
    mockDb.seed("users/buyer", { role: "Contractor", organizationId: "buyer" })
  })
  const post = (token: string | null, body: unknown) => countView(new NextRequest("http://localhost/api/supplier/rfq-view", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }))

  it("the first open of a company counts; his colleague and his second open do not; another company does", async () => {
    expect((await (await post("tok:supA", { rfqId: "R1" })).json()).data).toEqual({ counted: true })
    expect((await (await post("tok:supA2", { rfqId: "R1" })).json()).data).toEqual({ counted: false })
    expect((await (await post("tok:supA", { rfqId: "R1" })).json()).data).toEqual({ counted: false })
    expect((await (await post("tok:supB", { rfqId: "R1" })).json()).data).toEqual({ counted: true })
    expect(mockDb.get("rfqs/R1")?.viewsCount).toBe(9)
    expect(mockDb.get(`${RFQ_PORTAL_VIEWS}/${portalViewDocId("R1", "supA")}`)).toMatchObject({ rfqId: "R1", orgId: "supA", rfqOrganizationId: "buyer" })
  })

  it("a private RFQ counts only the invited; the buyer, a guest without a token and a missing RFQ count nothing", async () => {
    expect((await (await post("tok:supB", { rfqId: "RP" })).json()).data).toEqual({ counted: false })
    expect((await (await post("tok:supA", { rfqId: "RP" })).json()).data).toEqual({ counted: true })
    expect((await post("tok:buyer", { rfqId: "R1" })).status).toBe(403)
    expect((await post(null, { rfqId: "R1" })).status).toBe(401)
    expect((await post("tok:supA", { rfqId: "nope" })).status).toBe(404)
    expect((await post("tok:supA", {})).status).toBe(400)
    expect(mockDb.get("rfqs/R1")?.viewsCount).toBe(7)
  })

  it("refuses a draft and the company's own RFQ", async () => {
    expect(portalViewRefusal({ status: "Draft" }, "x")).toBe("draft")
    expect(portalViewRefusal({ status: "New", organizationId: "x" }, "x")).toBe("own_rfq")
    expect(portalViewRefusal({ status: "New", directAward: true, allowedSupplierOrgIds: ["x"] }, "x")).toBeNull()
    expect(portalViewRefusal(null, "x")).toBe("not_found")
    expect(await countPortalView(mockDb as never, "R1", "buyer")).toEqual({ counted: false, refusal: "own_rfq" })
  })
})

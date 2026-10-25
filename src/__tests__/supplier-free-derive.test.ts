/**
 * Supplier 1.0 — from the stored documents to the supplier's deals: what the free journey writes (`versions`, `outcome`,
 * `supplierDecline`, `deliveryReports`, `termsList`) and what every older document carries both read the same way.
 */

import { deriveWorld, fileNameOf, bareNumber, shortTitle, type RawWorld } from "@/lib/supplier-free/derive"
import { createWorldLogic } from "@/lib/supplier-free/world-logic"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ME = "sup1"
const TODAY = "2026-10-11"

const rfq = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  organizationId: "con1",
  contractorId: "con1",
  rfqNumber: "RFQ-2026/031",
  title: "بلوك لفيلا حي الملقا",
  category: "طوب وبلوك",
  city: "الرياض",
  district: "الملقا",
  status: "New",
  visibility: "public",
  pricingMode: "line",
  createdAt: "2026-10-08T08:00:00.000Z",
  deadline: "2026-10-13",
  needBy: "2026-10-25",
  products: [
    { name: "بلوك مفرغ 20 سم", quantity: 12000, unitOfMeasure: "حبة", description: "" },
    { name: "بلوك مصمت 20 سم", quantity: 2500, unitOfMeasure: "حبة", description: "للأعتاب" },
  ],
  ...over,
})

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: "p1",
    organizationId: "con1",
    docNumber: "PO-2026/044",
    status: "accepted",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "x",
    offerId: "o1",
    supplierOrgId: ME,
    supplierUserId: ME,
    supplierName: "S",
    isGuestSupplier: false,
    lines: [
      { id: "l1", name: "بلوك مفرغ 20 سم", unit: "حبة", quantity: 12000, unitPrice: 2.8, accepted: 5940, rejected: 60, held: 0, cancelled: 0, rfqProductIndex: 0 },
      { id: "l2", name: "بلوك مصمت 20 سم", unit: "حبة", quantity: 2500, unitPrice: 3.2, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 1 },
    ],
    totalExVat: 41600,
    vatRate: 0.15,
    preparedById: "buyer1",
    preparedByName: "B",
    createdAt: "2026-10-09T08:00:00.000Z",
    sentAt: "2026-10-09T09:00:00.000Z",
    supplierAcceptedAt: "2026-10-09T12:00:00.000Z",
    promisedDate: "2026-10-19",
    requestedDeliveryDate: "2026-10-19",
    termsList: [{ pct: 50, days: 15 }, { pct: 50, days: 30 }],
    deliveryLocation: "فيلا القيروان",
    approverKind: "manager",
    offersCount: 1,
    lowestOfferTotal: 41600,
    shortCompetition: false,
    noOfficialQuote: false,
    log: [],
    ...over,
  }) as unknown as PurchaseOrder

const base = (over: Partial<RawWorld> = {}): RawWorld => ({
  today: TODAY,
  myOrgId: ME,
  myUid: ME,
  rfqs: [rfq()],
  offers: [],
  pos: [],
  deliveries: [],
  invoices: [],
  transfers: [],
  warranties: [],
  chats: [],
  contractors: { con1: { companyName: "آفاق فنية", city: "الرياض", isVerified: true } },
  links: [],
  invitations: [],
  archived: {},
  seen: {},
  declined: {},
  questions: {},
  ...over,
})

describe("a request the supplier has not quoted", () => {
  it("is an open request with items, a short title and the contractor's number as a bare number", () => {
    const w = deriveWorld(base())
    const d = w.deals[0]
    expect(d.rfq).toBe("2026/031")
    expect(d.items.map((i) => i.id)).toEqual(["i1", "i2"])
    expect(d.items[1].spec).toBe("للأعتاب")
    expect(d.city).toBe("الرياض — الملقا")
    expect(d.channel).toBe("public")
    expect(d.offer).toBeNull()
    expect(w.contractors.con1.name).toBe("آفاق فنية")
  })

  it("a request that names him is an invitation", () => {
    const w = deriveWorld(base({ rfqs: [rfq({ visibility: "private", allowedSupplierOrgIds: [ME] })] }))
    expect(w.deals[0].channel).toBe("invite")
  })

  it("carries the buyer's delivery options per place into his request (ED-19); none when none were set", () => {
    const w = deriveWorld(base({ rfqs: [rfq({ deliveryOptions: { s1: { unload: "supplier", slot: "am", note: " البوابة الشمالية " }, s2: { bogus: 1 } } })] }))
    expect(w.deals[0].delivery).toEqual([{ unload: "supplier", slot: "am", note: "البوابة الشمالية" }])
    expect(deriveWorld(base()).deals[0].delivery).toBeUndefined()
  })

  it("one that closed without a quote is not his to see", () => {
    expect(deriveWorld(base({ rfqs: [rfq({ status: "Cancelled" })] })).deals).toHaveLength(0)
  })

  it("an invitation he declined to quote closes as declined and leaves the open list — and is no quote (RFQ-13)", () => {
    const w = deriveWorld(base({ declined: { r1: { at: "2026-10-10", note: "x" } } }))
    const L = createWorldLogic(TODAY, w)
    expect(w.deals[0].closed).toEqual({ k: "noquote", at: "2026-10-10" })
    expect(L.opps({})).toHaveLength(0)
    // No 0-riyal card in My quotes, not counted in any of its groups.
    expect(w.deals[0].offer).toBeNull()
    expect(L.offerSeg(w.deals[0])).toBeNull()
  })
})

describe("a quote", () => {
  const offer = (over: Record<string, unknown> = {}) => ({
    id: "o1",
    rfqId: "r1",
    organizationId: ME,
    status: "قيد المراجعة",
    price: "35600",
    lines: [{ rfqProductIndex: 0, unitPrice: 2.8 }, { rfqProductIndex: 1, unitPrice: 3.2 }],
    validUntil: "2026-10-25",
    deliveryBatches: [{ location: "x", deliveryDate: "2026-10-19", price: "41600", quantity: "14500" }],
    createdAt: "2026-10-09T08:00:00.000Z",
    updatedAt: "2026-10-09T08:00:00.000Z",
    ...over,
  })

  it("reads versions when it has them and the replaced prices when it does not", () => {
    const legacy = deriveWorld(base({ offers: [offer({ priceHistory: [{ price: "40000", replacedAt: "2026-10-09T07:00:00.000Z" }] })] })).deals[0]
    expect(legacy.offer?.v).toHaveLength(2)
    expect(legacy.offer?.v[1].prices).toEqual({ i1: 2.8, i2: 3.2 })
    const v = deriveWorld(base({ offers: [offer({ versions: [{ at: "2026-10-09", lines: [{ rfqProductIndex: 0, unitPrice: 3 }], arrive: "2026-10-20", valid: "2026-10-26", note: "n" }] })] })).deals[0]
    expect(v.offer?.v).toHaveLength(1)
    expect(v.offer?.v[0].prices).toEqual({ i1: 3, i2: null })
    expect(v.offer?.v[0].note).toBe("n")
  })

  it("a price cut and a sample request become states with a reply-by date", () => {
    const cut = deriveWorld(base({ offers: [offer({ status: "مطلوب تخفيض", targetPrice: "30000", reductionNote: "قريب", reductionAt: "2026-10-09T08:00:00.000Z" })] })).deals[0]
    expect(cut.offer?.status).toBe("reduce")
    expect(cut.offer?.reduce?.target).toBe(30000)
    expect(cut.offer?.reduce?.by).toBe("2026-10-12")
    const smp = deriveWorld(base({ offers: [offer({ sampleStatus: "مطلوبة", sampleWhat: "10 حبات", sampleRequestedAt: "2026-10-09T08:00:00.000Z", sampleBy: "2026-10-14" })] })).deals[0]
    expect(smp.offer?.status).toBe("sample")
    expect(smp.offer?.sample?.by).toBe("2026-10-14")
  })

  it("a quote ends in a result: awarded to another, or closed with no award — a buyer's exclusion is not one (G-15)", () => {
    const excluded = deriveWorld(base({ offers: [offer({ status: "مرفوض", exclusion: { code: "price", at: "2026-10-12T00:00:00.000Z" } })] })).deals[0]
    expect(excluded.offer?.status).toBe("review")
    expect(excluded.offer?.out).toBeUndefined()
    const other = deriveWorld(base({ rfqs: [rfq({ status: "Awarded", awardedAt: "2026-10-12T00:00:00.000Z" })], offers: [offer()] })).deals[0]
    expect(other.offer?.status).toBe("lost")
    const none = deriveWorld(base({ rfqs: [rfq({ status: "Cancelled" })], offers: [offer()] })).deals[0]
    expect(none.offer?.status).toBe("noaward")
    expect(none.offer?.out?.why).toBe("cancelled")
    const written = deriveWorld(base({ offers: [offer({ outcome: { k: "lost", at: "2026-10-12", why: "time" } })] })).deals[0]
    expect(written.offer?.out?.why).toBe("time")
  })

  it("a withdrawn quote is closed", () => {
    expect(deriveWorld(base({ offers: [offer({ withdrawnAt: "2026-10-10T00:00:00.000Z" })] })).deals[0].closed?.k).toBe("withdrawn")
  })

  it("an award the contractor has not sent yet is not announced to him", () => {
    const hidden = deriveWorld(base({ offers: [offer({ status: "مقبول", poId: "p1" })], pos: [po({ status: "awaiting_approval" })] })).deals[0]
    expect(hidden.offer?.status).toBe("review")
    expect(hidden.po).toBeNull()
  })
})

describe("an order, its receipts, report, invoice and transfers", () => {
  const raw = (over: Partial<RawWorld> = {}) =>
    base({
      offers: [{ id: "o1", rfqId: "r1", organizationId: ME, status: "مقبول", poId: "p1", price: "41600", createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" }],
      pos: [po()],
      deliveries: [
        {
          id: "d1",
          poId: "p1",
          status: "confirmed",
          docNumber: "GR-2026/187",
          deliveryDate: "2026-10-12",
          confirmedAt: "2026-10-12T06:50:00.000Z",
          confirmedByName: "خالد",
          lines: [{ poLineId: "l1", counted: 6000, rejected: 60, held: 0, accepted: 5940, rejectNote: "مكسورة" }],
          checklist: ["photos"],
        },
      ],
      ...over,
    })

  it("maps the order's lines onto the request's items and the receipt onto what arrived and what was accepted", () => {
    const d = deriveWorld(raw()).deals[0]
    expect(d.po?.no).toBe("2026/044")
    expect(d.po?.terms).toEqual([{ pct: 50, days: 15 }, { pct: 50, days: 30 }])
    expect(d.po?.lines[0]).toMatchObject({ it: "i1", qty: 12000, got: 5940, rej: 60 })
    const r = d.ship[0]
    expect(r).toMatchObject({ st: "ok", grn: "GR-2026/187", date: "2026-10-12", okAt: "2026-10-12", t: "09:50", chk: ["ph"] })
    if (r.st === "ok") {
      expect(r.items).toEqual({ i1: 6000 })
      expect(r.got).toEqual({ i1: 5940 })
      expect(r.why).toEqual({ i1: "مكسورة" })
    }
  })

  it("the receiver's attachments open from the supplier's receipt, by their own names (ORD-12)", () => {
    const url = "https://firebasestorage.googleapis.com/v0/b/x/o/deliveries%2Freceipts%2Fd1%2F1760000000000_0_scale-ticket.pdf?alt=media&token=t"
    const d = deriveWorld(raw({ deliveries: [{ ...(raw().deliveries[0] as Record<string, unknown>), attachmentUrls: [url] } as never] })).deals[0]
    const r = d.ship[0]
    expect(r.st === "ok" && r.files).toEqual([{ n: "scale-ticket.pdf", s: "", url }])
    expect(fileNameOf("https://x/y/1760000000000_photo.jpg")).toBe("photo.jpg")
  })

  it("terms from before frozen terms come from the advance and the credit days", () => {
    const legacy = { ...po(), termsList: undefined, advancePercent: 30, creditDays: 45 } as unknown as PurchaseOrder
    expect(deriveWorld(raw({ pos: [legacy] })).deals[0].po?.terms).toEqual([{ pct: 30, days: 0 }, { pct: 70, days: 45 }])
  })

  it("a delivery report waits for the receipt; a closed one does not", () => {
    const waiting = po({ deliveryReports: [{ id: "r1", at: "2026-10-13T00:00:00.000Z", date: "2026-10-13", note: "n", byId: ME, byName: "S", reminders: ["2026-10-14T00:00:00.000Z"], closedAt: null }] })
    const d = deriveWorld(raw({ pos: [waiting] })).deals[0]
    const reports = d.ship.filter((s) => s.st === "wait")
    expect(reports).toHaveLength(1)
    const closed = po({ deliveryReports: [{ id: "r1", at: "2026-10-13T00:00:00.000Z", date: "2026-10-13", note: null, byId: ME, byName: "S", reminders: [], closedAt: "2026-10-14T00:00:00.000Z" }] })
    expect(deriveWorld(raw({ pos: [closed] })).deals[0].ship.filter((s) => s.st === "wait")).toHaveLength(0)
  })

  it("a declined order closes the deal as declined with its reason", () => {
    const declined = po({ status: "cancelled", sentAt: "2026-10-09T09:00:00.000Z", supplierAcceptedAt: undefined, promisedDate: undefined, supplierDecline: { at: "2026-10-10T00:00:00.000Z", reason: "stock", note: "x", byId: ME, byName: "S" } })
    const d = deriveWorld(raw({ pos: [declined], deliveries: [] })).deals[0]
    expect(d.closed?.k).toBe("declined")
    expect(d.po?.decl?.why).toBe("stock")
  })

  it("invoices name the receipts they cover, transfers carry their state, and a fully paid order is finished", () => {
    const complete = po({ lines: [{ id: "l1", name: "بلوك", unit: "حبة", quantity: 100, unitPrice: 10, accepted: 100, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }], totalExVat: 1000 })
    const w = deriveWorld(
      raw({
        pos: [complete],
        invoices: [{ id: "i1", poId: "p1", number: "ف-1", date: "2026-10-13", amountNet: 1000, file: { name: "a.pdf", url: "https://x/a.pdf" }, grns: ["GR-2026/187"] }],
        transfers: [{ id: "t1", poId: "p1", amount: 1150, bank: "الراجحي", ref: "TRF1", reportedAt: "2026-10-14T00:00:00.000Z", state: "ok", confirmedAt: "2026-10-15T00:00:00.000Z" }],
      })
    )
    const d = w.deals[0]
    expect(d.invs[0]).toMatchObject({ no: "ف-1", amt: 1000, grns: ["GR-2026/187"], file: "a.pdf" })
    expect(d.pays[0]).toMatchObject({ st: "ok", amt: 1150, ref: "TRF1" })
    expect(d.closed?.k).toBe("paid")
  })

  it("an order the contractor has not sent is not shown", () => {
    expect(deriveWorld(raw({ pos: [po({ status: "approved", sentAt: null })] })).deals[0].po).toBeNull()
  })
})

describe("connections and the conversation", () => {
  it("an active link marks the contractor connected; a pending request is listed; invitations are carried with their id", () => {
    const w = deriveWorld(
      base({
        links: [{ contractorOrgId: "con1", status: "active", createdAt: "2026-09-02T00:00:00.000Z" }, { contractorOrgId: "con2", status: "pending", requestedBy: "supplier", requestedAt: "2026-10-05T00:00:00.000Z" }],
        invitations: [{ id: "iv1", type: "supplier_invite", status: "pending", contractorOrgId: "con3", message: "hi", createdAt: "2026-10-07T00:00:00.000Z" }],
      })
    )
    expect(w.contractors.con1.conn).toBe("2026-09-02")
    expect(w.requests).toEqual([{ c: "con2", at: "2026-10-05" }])
    expect(w.invites[0]).toMatchObject({ id: "iv1", at: "2026-10-07", note: "hi" })
  })

  it("the unread counter is the signed-in user's own", () => {
    const w = deriveWorld(
      base({
        offers: [{ id: "o1", rfqId: "r1", organizationId: ME, status: "قيد المراجعة", price: "1", createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" }],
        chats: [{ id: "o1", lastMessage: "hello", updatedAt: "2026-10-10T00:00:00.000Z", unreadCounts: { [ME]: 2, other: 5 } }],
      })
    )
    expect(w.deals[0].chat).toMatchObject({ last: "hello", unread: 2, chatId: "o1" })
  })
})

describe("small mappings", () => {
  it("a contractor's number is read as a bare number", () => {
    expect(bareNumber("RFQ-2026/031")).toBe("2026/031")
    expect(bareNumber("PO-2026/044")).toBe("2026/044")
    expect(bareNumber("GR-2026/187")).toBe("2026/187")
  })
  it("a long specification is not a title", () => {
    const long = "بند 1: توريد وتركيب بلوك أسمنتي مفرغ مقاس 20 سم مع جميع المواصفات والاشتراطات الفنية الواردة في المخططات"
    expect(shortTitle(`${long}\nبند 2`, [{ id: "i1", name: "بلوك", unit: "حبة", qty: 1, spec: "" }]).length).toBeLessThanOrEqual(90)
    expect(shortTitle("", [{ id: "i1", name: "بلوك", unit: "حبة", qty: 1, spec: "" }])).toBe("بلوك")
  })
})

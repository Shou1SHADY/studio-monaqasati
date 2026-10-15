/**
 * Supplier 1.0 — the quote package's fixes against the PRD (audit of 15 Oct 2026): what the supplier reads of a
 * winner whose order waits for approval, of a cancelled or excluded request, of a price cut and a sample the
 * contractor asked for; his declined invitation is no quote; the request's payment terms and number; the rules no
 * longer let a supplier set what the buying side owns; and RFQ numbering.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import type { Firestore } from "firebase/firestore"
import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { deriveWorld, type RawWorld } from "@/lib/supplier-free/derive"
import { createWorldLogic } from "@/lib/supplier-free/world-logic"
import { competingOffers } from "@/lib/procurement/award"
import { losingOfferIds } from "@/lib/procurement/writes"
import { createRfqWithNumber, reductionTargetTotal, updateRfqNumbered } from "@/lib/procurement/rfq-writes"
import { RFQ_DOC_TYPE } from "@/lib/procurement/numbering"
import { planRfqNumbers } from "@/lib/procurement/rfq-number-backfill"
import { termsListOf, termsRefusal } from "@/lib/procurement/terms-freeze"
import { legacyVersionOf, nextVersions, replyByOf, requestReaches } from "@/lib/supplier-free/quote-rules"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ME = "sup1"
const TODAY = "2026-10-15"

const rfq = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  organizationId: "con1",
  contractorId: "con1",
  rfqNumber: "RFQ-2026/031",
  title: "بلوك لفيلا حي الملقا",
  category: "طوب وبلوك",
  city: "الرياض",
  status: "New",
  visibility: "public",
  pricingMode: "line",
  createdAt: "2026-10-08T08:00:00.000Z",
  deadline: "2026-10-16",
  products: [
    { name: "بلوك مفرغ", quantity: 1000, unitOfMeasure: "حبة" },
    { name: "بلوك مصمت", quantity: 500, unitOfMeasure: "حبة" },
  ],
  ...over,
})
const offer = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  rfqId: "r1",
  organizationId: ME,
  status: "قيد المراجعة",
  price: "4000",
  lines: [{ rfqProductIndex: 0, unitPrice: 2.5 }, { rfqProductIndex: 1, unitPrice: 3 }],
  validUntil: "2026-10-30",
  createdAt: "2026-10-09T08:00:00.000Z",
  updatedAt: "2026-10-09T08:00:00.000Z",
  ...over,
})
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
  contractors: { con1: { companyName: "آفاق" } },
  links: [],
  invitations: [],
  archived: {},
  seen: {},
  declined: {},
  questions: {},
  ...over,
})
const deal = (over: Partial<RawWorld> = {}) => deriveWorld(base(over)).deals[0]

describe("the winner while his order waits for approval (OFR-07, G-06)", () => {
  it("is not 'awarded to another' — his quote still waits, and nothing new is announced", () => {
    const d = deal({ rfqs: [rfq({ status: "Awarded", awardedAt: "2026-10-14T08:00:00.000Z" })], offers: [offer({ status: "مقبول", poId: "p1", awaitingOrderApproval: true })], pos: [{ id: "p1", status: "awaiting_approval", supplierOrgId: ME, rfqId: "r1" } as unknown as PurchaseOrder] })
    expect(d.offer?.status).toBe("review")
    expect(d.closed).toBeUndefined()
  })

  it("an order Finance refused before sending closes it without an award; a pre-PO award stays won", () => {
    const refused = deal({ rfqs: [rfq({ status: "Awarded" })], offers: [offer({ status: "مقبول", poId: "p1" })], pos: [{ id: "p1", status: "cancelled", supplierOrgId: ME, rfqId: "r1", closedAt: "2026-10-14T08:00:00.000Z", log: [] } as unknown as PurchaseOrder] })
    expect(refused.offer?.status).toBe("noaward")
    const legacy = deal({ rfqs: [rfq({ status: "Awarded" })], offers: [offer({ status: "مقبول", decidedAt: "2026-10-12T08:00:00.000Z" })] })
    expect(legacy.offer?.status).toBe("won")
  })

  it("the losers read the reason the award gave them", () => {
    const d = deal({ rfqs: [rfq({ status: "Awarded" })], offers: [offer({ outcome: { k: "lost", at: "2026-10-14T08:00:00.000Z", why: "spec" } })] })
    expect(d.offer?.status).toBe("lost")
    expect(d.offer?.out).toEqual({ at: "2026-10-14", why: "spec" })
  })
})

describe("why a request closed (OFR-07)", () => {
  it("a cancellation carries its own reason, not always 'cancelled'", () => {
    expect(deal({ rfqs: [rfq({ status: "Cancelled", cancellation: { code: "need", at: "2026-10-14T08:00:00.000Z" } })], offers: [offer()] }).offer?.out?.why).toBe("need")
    expect(deal({ rfqs: [rfq({ status: "Cancelled", cancellation: { code: "reissue" } })], offers: [offer()] }).offer?.out?.why).toBe("reissue")
    expect(deal({ rfqs: [rfq({ status: "Cancelled", cancellation: { code: "spec" } })], offers: [offer()] }).offer?.out?.why).toBe("spec")
    expect(deal({ rfqs: [rfq({ status: "Cancelled" })], offers: [offer()] }).offer?.out?.why).toBe("cancelled")
  })

  it("today's exclusion reasons all read as a reason", () => {
    for (const [code, why] of [["incomplete", "incomplete"], ["documents", "docs"], ["other", "other"], ["lead", "time"]]) {
      expect(deal({ offers: [offer({ status: "مرفوض", exclusion: { code } })] }).offer?.out?.why).toBe(why)
    }
  })
})

describe("a withdrawn quote (OFR-04)", () => {
  it("closes on the day he withdrew it, not today", () => {
    const d = deal({ offers: [offer({ status: "مسحوب", withdrawnAt: "2026-10-11T08:00:00.000Z" })] })
    expect(d.offer?.status).toBe("withdrawn")
    expect(d.closed).toEqual({ k: "withdrawn", at: "2026-10-11" })
  })

  it("leaves the contractor's comparison and is never told it lost", () => {
    expect(competingOffers([{ id: "a", status: "مسحوب" }, { id: "b", status: "قيد المراجعة", withdrawnAt: "x" } as { id: string; status: string }, { id: "c", status: "قيد المراجعة" }]).map((o) => o.id)).toEqual(["c"])
    expect(losingOfferIds([{ id: "a", status: "مسحوب" }, { id: "b", status: "قيد المراجعة" }, { id: "c", status: "مرفوض" }, { id: "w", status: "قيد المراجعة" }], ["w"])).toEqual(["b"])
  })
})

describe("a price cut and a sample the contractor asked for (OFR-05, OFR-06)", () => {
  it("reads the target, the asked day and the reply-by the contractor wrote", () => {
    const d = deal({ offers: [offer({ status: "مطلوب تخفيض", targetPrice: 3500, reductionAt: "2026-10-14T08:00:00.000Z", reductionBy: "2026-10-18", reductionNote: "أفضل سعر" })] })
    expect(d.offer?.reduce).toEqual({ at: "2026-10-14", target: 3500, by: "2026-10-18", note: "أفضل سعر" })
  })

  it("a round written before targets were totalled: the line targets × quantities, from the day it was decided", () => {
    const d = deal({ offers: [offer({ status: "مطلوب تخفيض", reductionTargets: [{ rfqProductIndex: 0, unitPrice: 2 }, { rfqProductIndex: 1, unitPrice: 2.8 }], decidedAt: "2026-10-13T08:00:00.000Z", updatedAt: "2026-10-15T08:00:00.000Z" })] })
    expect(d.offer?.reduce?.target).toBe(3400)
    expect(d.offer?.reduce?.at).toBe("2026-10-13")
    expect(d.offer?.reduce?.by).toBe("2026-10-16")
    expect(replyByOf({ decidedAt: "2026-10-13T08:00:00.000Z" })).toBe("2026-10-16")
  })

  it("the contractor's total target wins over the lines; none named is no target", () => {
    expect(reductionTargetTotal(3000, [{ rfqProductIndex: 0, unitPrice: 2 }], [{ quantity: 1000 }])).toBe(3000)
    expect(reductionTargetTotal(null, [{ rfqProductIndex: 0, unitPrice: 2 }, { rfqProductIndex: 1, unitPrice: 2.8 }], [{ quantity: 1000 }, { quantity: 500 }])).toBe(3400)
    expect(reductionTargetTotal(null, [], [{ quantity: 1000 }])).toBeNull()
  })

  it("a sent sample keeps the supplier's note", () => {
    const d = deal({ offers: [offer({ sampleStatus: "تم الإرسال", sampleWhat: "حبتان", samplePlace: "الموقع", sampleBy: "2026-10-18", sampleSentAt: "2026-10-14", sampleNote: "مع السائق" })] })
    expect(d.offer?.sample).toMatchObject({ what: "حبتان", place: "الموقع", by: "2026-10-18", sentAt: "2026-10-14", note: "مع السائق" })
  })
})

describe("a declined invitation is no quote (RFQ-13, WF-02)", () => {
  it("closes the request without a 0-riyal quote in My quotes", () => {
    const w = deriveWorld(base({ declined: { r1: { at: "2026-10-14" } } }))
    const L = createWorldLogic(TODAY, w)
    expect(w.deals[0].offer).toBeNull()
    expect(w.deals[0].closed?.k).toBe("noquote")
    expect(L.offerSeg(w.deals[0])).toBeNull()
  })
})

describe("the request's payment terms and number (RFQ-11, NAV-08)", () => {
  it("the supplier reads the contractor's terms before quoting", () => {
    expect(deal({ rfqs: [rfq({ paymentTermsList: [{ pct: 30, days: 0 }, { pct: 70, days: 60 }] })] }).terms).toEqual([{ pct: 30, days: 0 }, { pct: 70, days: 60 }])
    expect(deal({ rfqs: [rfq({ paymentTermsList: [{ pct: 30, days: 0 }] })] }).terms).toBeUndefined()
  })

  it("an unnumbered request reads by its title, never an id fragment", () => {
    const d = deal({ rfqs: [rfq({ id: "AbCdEfGhIj", rfqNumber: undefined })] })
    expect(d.rfq).toBe("بلوك لفيلا حي الملقا")
    expect(d.rfq).not.toContain("AbCdEf")
  })

  it("the picker's rows: shares above 0 that make 100%, whole days 0–365", () => {
    expect(termsRefusal([{ pct: "100", days: "30" }])).toBeNull()
    expect(termsRefusal([{ pct: "50", days: "0" }, { pct: "40", days: "30" }])).toBe("sum")
    expect(termsRefusal([{ pct: "100", days: "400" }])).toBe("row")
    expect(termsRefusal([{ pct: "0", days: "30" }, { pct: "100", days: "30" }])).toBe("row")
    expect(termsListOf([{ pct: 33.33, days: 0 }, { pct: 33.33, days: 30 }, { pct: 33.34, days: 60 }])).toHaveLength(3)
  })
})

describe("RFQ numbering (NAV-08, G-10)", () => {
  const db = fakeFirestore as unknown as Firestore
  beforeEach(() => resetFakeDb())

  it("a new RFQ draws RFQ-yyyy/NNN in the same transaction, per company and year", async () => {
    const a = await createRfqWithNumber(db, { organizationId: "con1", title: "a" }, new Date("2026-10-15T08:00:00Z"))
    const b = await createRfqWithNumber(db, { organizationId: "con1", title: "b" }, new Date("2026-10-15T09:00:00Z"))
    const c = await createRfqWithNumber(db, { organizationId: "con2", title: "c" }, new Date("2026-10-15T09:00:00Z"))
    expect([a.rfqNumber, b.rfqNumber, c.rfqNumber]).toEqual(["RFQ-2026/001", "RFQ-2026/002", "RFQ-2026/001"])
    expect(readDoc<{ rfqNumber: string }>(`rfqs/${b.id}`)?.rfqNumber).toBe("RFQ-2026/002")
    expect(readDoc<{ last: number }>(`mfgCounters/con1__${RFQ_DOC_TYPE}__2026`)?.last).toBe(2)
  })

  it("an edit numbers a draft saved before numbering, and never renumbers one", async () => {
    seed("rfqs/old", { organizationId: "con1", title: "old", status: "Draft" })
    expect(await updateRfqNumbered(db, "old", { status: "New" }, new Date("2026-10-15T08:00:00Z"))).toBe("RFQ-2026/001")
    expect(await updateRfqNumbered(db, "old", { title: "x" }, new Date("2026-10-15T08:00:00Z"))).toBe("RFQ-2026/001")
    expect(readDoc<{ rfqNumber: string; title: string }>("rfqs/old")).toMatchObject({ rfqNumber: "RFQ-2026/001", title: "x" })
  })

  it("the backfill numbers old RFQs oldest first after what the year's counter holds, and keeps numbered ones", () => {
    const plan = planRfqNumbers(
      [
        { id: "b", organizationId: "con1", createdAt: "2026-03-02T00:00:00.000Z" },
        { id: "a", organizationId: "con1", createdAt: "2026-01-05T00:00:00.000Z" },
        { id: "n", organizationId: "con1", createdAt: "2026-02-01T00:00:00.000Z", rfqNumber: "RFQ-2026/009" },
        { id: "z", contractorId: "con2", createdAt: "2025-12-30T00:00:00.000Z" },
      ],
      { "con1__RFQ__2026": 4 },
      2026
    )
    expect(plan.map((g) => [g.counterId, g.from, g.assign])).toEqual([
      ["con1__RFQ__2026", 4, [{ id: "a", rfqNumber: "RFQ-2026/005" }, { id: "b", rfqNumber: "RFQ-2026/006" }]],
      ["con2__RFQ__2025", 0, [{ id: "z", rfqNumber: "RFQ-2025/001" }]],
    ])
  })
})

describe("versions keep the legacy quote (OFR-03)", () => {
  it("a quote without versions becomes v1 before the edit is v2; each n is its own", () => {
    const legacy = offer({ deliveryBatches: [{ deliveryDate: "2026-10-20" }] })
    expect(legacyVersionOf(legacy)).toMatchObject({ n: 1, total: 4000, arrive: "2026-10-20", valid: "2026-10-30" })
    const next = nextVersions(legacy, { n: 0, at: TODAY, arrive: null, valid: "2026-10-30", note: "", fileUrl: null, total: 3800 })
    expect(next.map((v) => [v.n, v.total])).toEqual([
      [1, 4000],
      [2, 3800],
    ])
    const stored = { versions: [{ n: 1, total: 1 }, { n: 2, total: 2 }] }
    expect(nextVersions(stored, { n: 0, at: TODAY, arrive: null, valid: "x", note: "", fileUrl: null, total: 3 }).map((v) => v.n)).toEqual([1, 2, 3])
  })
})

describe("who a request reaches (RFQ-01)", () => {
  it("invited by name, or public in his specialty and city — a request with no city is nationwide", () => {
    const field = { specs: ["طوب وبلوك"], cities: ["الرياض"] }
    expect(requestReaches(rfq(), ME, field)).toBe(true)
    expect(requestReaches(rfq({ city: "جدة" }), ME, field)).toBe(false)
    expect(requestReaches(rfq({ city: "" }), ME, field)).toBe(true)
    expect(requestReaches(rfq({ visibility: "private" }), ME, field)).toBe(false)
    expect(requestReaches(rfq({ visibility: "private", allowedSupplierOrgIds: [ME], category: "حديد" }), ME, field)).toBe(true)
  })
})

describe("the offers rules (NFR-08)", () => {
  const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")
  const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "")
  const block = (() => {
    const start = rules.indexOf("match /offers/{offerId} {")
    const end = rules.indexOf("match /notification_queue/")
    return strip(rules.slice(start, end))
  })()
  const keys = strip(rules).match(/function buyerOfferKeys\(\) \{\s*return \[([^\]]*)\]/)?.[1] || ""

  it("names every key the buying side owns", () => {
    for (const k of ["outcome", "poId", "awardedTotal", "exclusion", "targetPrice", "reductionBy", "sampleWhat", "sampleBy", "withdrawnAt", "versions", "awaitingOrderApproval"]) expect(keys).toContain(`'${k}'`)
  })

  it("a supplier's own update never touches those keys or who the offer belongs to, and moves status only back to review", () => {
    const update = block.match(/allow update: if ([\s\S]*?);\n/)?.[1] || ""
    expect(update).toContain("resource.data.supplierId == request.auth.uid || ownsDoc()")
    expect(update).toContain("!changedKeys().hasAny(buyerOfferKeys().concat(['supplierId', 'organizationId', 'rfqId', 'contractorId', 'contractorOrgId']))")
    expect(update).toContain("rd().status == 'قيد المراجعة'")
    // Status and price move only under review / a price cut — and only while the RFQ is open (a closed RFQ's price is
    // the server act's), so a direct write after the deadline cannot skip the act.
    const flat = update.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ")
    expect(flat).toContain(
      "(!changedKeys().hasAny(['status', 'price', 'lines', 'deliveryBatches', 'totalBatchesPrice', 'validUntil']) || (resource.data.get('status', '') in ['قيد المراجعة', 'مطلوب تخفيض'] && (!changedKeys().hasAny(['status']) || rd().status == 'قيد المراجعة') && rfqData(resource.data.rfqId).status == 'New'))"
    )
    // The old unconditional supplier branch is gone.
    expect(update).not.toMatch(/\(isSignedIn\(\) && resource\.data\.supplierId == request\.auth\.uid\)\s*\|\|/)
  })

  it("a supplier's new offer is born under review on an open RFQ, carrying none of those keys", () => {
    const create = block.match(/allow create: if ([\s\S]*?);\n/)?.[1] || ""
    expect(create).toContain("rd().get('status', '') == 'قيد المراجعة'")
    expect(create).toContain("!rd().keys().hasAny(buyerOfferKeys())")
    expect(create).toContain("rfqData(rd().rfqId).status == 'New'")
    expect(create).not.toMatch(/\|\|\s*isSupplier\(\)\s*\|\|/)
    // The direct-award and manual branches compare the incoming contractorOrgId (a broken `request.isContractorOrg()` never matched).
    expect(block).not.toContain("request.isContractorOrg()")
    expect(create.match(/rd\(\)\.contractorOrgId == getOrganizationId\(\)/g)).toHaveLength(2)
  })
})

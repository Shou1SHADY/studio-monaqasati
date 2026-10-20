/**
 * Supplier 1.0 audit, 15 Oct 2026 — the contractor's side of the free supplier's journey:
 * a free supplier verified by his documents and without a VAT number can be ordered from (B-11, decision 9);
 * Al-Kharj is a city; one lateness rule on both sides (conflict 2, SUP-05); an order the supplier declined can be
 * awarded again (DEC); every quote is told its result (OFR-07); terms freeze RFQ › offer › default (G-08); RFQ
 * numbers and guest deadlines follow the Riyadh day; the free account never says «التحصيل» (B-06).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/firebaseAdmin", () => ({ getAdminFirestore: () => null }))

import fs from "fs"
import path from "path"
import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"
import { CITIES_BY_COUNTRY, CITIES_EN, SAUDI_CITIES } from "@/lib/constants"
import { reviewAward, supplierFactsFromProfile, supplierVerified } from "@/lib/procurement/award"
import { PROC_EVENT_COPY_AR, PROC_EVENT_PARAM_COPY_AR, type ProcEvent } from "@/lib/procurement/events"
import { deadlineEnd } from "@/lib/procurement/guest-supplier"
import { daysLate, poBlocks, poLate, poWarnings } from "@/lib/procurement/po"
import { incomingRows } from "@/lib/procurement/receipt-desk"
import { rfqOutcomeEvent } from "@/lib/procurement/rfq-outcome"
import { cancelRfq, createRfqWithNumber, reopenAwardRefusal } from "@/lib/procurement/rfq-writes"
import { frozenTermsOf, rfqTermsToStore } from "@/lib/procurement/terms-freeze"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { awardRfq, retroactivePurchaseOrder, type AwardOfferLike } from "@/lib/procurement/writes"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { isRfqDeadlinePassed } from "@/lib/rfq-share"
import { createDealLogic } from "@/lib/supplier-free/deal-logic"
import { deriveWorld, type RawWorld } from "@/lib/supplier-free/derive"

const db = fakeFirestore as unknown as Firestore
const ORG = "con1"
const SUP = "sup1"
const NOW = new Date("2026-10-15T09:00:00Z")

const actor = (over: Partial<ProcActor> = {}): ProcActor => ({ uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })
const owner = actor({ uid: ORG, name: "Owner", isOwner: true, canApprove: true })

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: "p1",
    organizationId: ORG,
    docNumber: "PO-2026/044",
    status: "accepted",
    basis: "rfq",
    rfqId: "r1",
    rfqTitle: "x",
    offerId: "o1",
    supplierOrgId: SUP,
    supplierUserId: SUP,
    supplierName: "S",
    isGuestSupplier: false,
    lines: [{ id: "l1", name: "بلوك", unit: "حبة", quantity: 100, unitPrice: 3, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }],
    totalExVat: 300,
    vatRate: 0.15,
    preparedById: "buyer",
    preparedByName: "B",
    createdAt: "2026-10-01T08:00:00.000Z",
    sentAt: "2026-10-01T09:00:00.000Z",
    supplierAcceptedAt: "2026-10-01T12:00:00.000Z",
    promisedDate: "2026-10-10",
    termsList: [{ pct: 100, days: 30 }],
    approverKind: "manager",
    offersCount: 1,
    lowestOfferTotal: 300,
    shortCompetition: false,
    noOfficialQuote: false,
    log: [],
    ...over,
  }) as unknown as PurchaseOrder

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Verified by documents; no VAT is a warning
// ─────────────────────────────────────────────────────────────────────────────

describe("a free supplier can be ordered from (B-11, decision 9)", () => {
  const docs = { cr: { url: "https://x/cr.pdf" }, addr: { url: "https://x/addr.pdf" }, iban: { url: "https://x/iban.pdf" } }

  it("is verified for the approval by the register, the national address and the IBAN letter — or by the admin", () => {
    expect(supplierVerified({ isVerified: false, legalDocuments: docs })).toBe(true)
    expect(supplierVerified({ isVerified: false, legalDocuments: { cr: docs.cr, addr: docs.addr } })).toBe(false)
    expect(supplierVerified({ isVerified: true })).toBe(true)
    expect(supplierVerified({})).toBe(false)
    // The users/{uid} document as the phone sign-in leaves it, after he uploaded the three documents.
    const facts = supplierFactsFromProfile(SUP, { isVerified: false, taxNumber: "", legalDocuments: docs })
    expect(facts).toMatchObject({ verified: true, hasVatNumber: false })
  })

  it("his order is not blocked: no VAT number is said beside the approval, never in its way", () => {
    const facts = supplierFactsFromProfile(SUP, { isVerified: false, legalDocuments: docs })
    const order = po({ status: "awaiting_approval" })
    expect(poBlocks(order, { supplier: facts, otherOrders: [], policies: DEFAULT_POLICIES, now: NOW })).toEqual([])
    expect(poWarnings(order, { supplier: facts }).map((w) => w.code)).toEqual(["supplier_no_vat"])
    const review = reviewAward({ id: "o1", price: 300, supplierId: SUP, organizationId: SUP }, [{ id: "o1", price: 300 }], DEFAULT_POLICIES, facts, NOW)
    expect(review.blocks).toEqual([])
    expect(review.warnings.map((w) => w.code)).toEqual(["supplier_no_vat"])
    // Without the documents and without the admin, he still waits for verification.
    const bare = supplierFactsFromProfile(SUP, { isVerified: false })
    expect(poBlocks(order, { supplier: bare, otherOrders: [], policies: DEFAULT_POLICIES, now: NOW }).map((b) => b.code)).toEqual(["supplier_unverified"])
  })

  it("the warning reads in both languages", () => {
    const P = (l: typeof ar) => (l as unknown as { Portal: { Procurement: { warnings: Record<string, string>; blocks: Record<string, string> } } }).Portal.Procurement
    expect(P(ar).warnings.supplier_no_vat).toBeTruthy()
    expect(P(en).warnings.supplier_no_vat).toBeTruthy()
    expect(P(ar).blocks.supplier_no_vat).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Al-Kharj
// ─────────────────────────────────────────────────────────────────────────────

describe("cities", () => {
  it("Al-Kharj (the prototype's second city) is a Saudi city with an English name", () => {
    expect(SAUDI_CITIES).toContain("الخرج")
    expect(CITIES_BY_COUNTRY.SA).toContain("الخرج")
    expect(CITIES_EN["الخرج"]).toBe("Al Kharj")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3 · One lateness rule on both sides (conflict 2, SUP-05)
// ─────────────────────────────────────────────────────────────────────────────

describe("lateness: the contractor and the supplier read the same order the same way", () => {
  const TODAY = "2026-10-14"
  const now = new Date(`${TODAY}T09:00:00Z`)
  const report = (date: string, closedAt: string | null = null) => ({ id: "r1", at: `${date}T08:00:00.000Z`, date, note: null, byId: SUP, byName: "S", reminders: [], closedAt })
  const raw = (order: PurchaseOrder): RawWorld => ({
    today: TODAY,
    myOrgId: SUP,
    myUid: SUP,
    rfqs: [{ id: "r1", organizationId: ORG, contractorId: ORG, rfqNumber: "RFQ-2026/031", title: "بلوك", status: "Awarded", visibility: "public", pricingMode: "line", createdAt: "2026-09-28T08:00:00.000Z", deadline: "2026-09-30", products: [{ name: "بلوك", quantity: 100, unitOfMeasure: "حبة" }] }],
    offers: [{ id: "o1", rfqId: "r1", organizationId: SUP, status: "مقبول", poId: "p1", price: "300", createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z" }],
    pos: [order],
    deliveries: [],
    invoices: [],
    transfers: [],
    warranties: [],
    chats: [],
    contractors: { [ORG]: { companyName: "آفاق" } },
    links: [],
    invitations: [],
    archived: {},
    seen: {},
    declined: {},
    questions: {},
  }) as unknown as RawWorld
  const supplierLate = (order: PurchaseOrder) => {
    const deal = deriveWorld(raw(order)).deals[0]
    return createDealLogic(TODAY).isLate(deal)
  }

  it.each([
    ["no report", po(), true],
    ["an open report dated on the promised day", po({ deliveryReports: [report("2026-10-10")] }), false],
    ["an open report dated before it", po({ deliveryReports: [report("2026-10-08")] }), false],
    ["an open report dated after it", po({ deliveryReports: [report("2026-10-12")] }), true],
    ["a report a receipt already answered", po({ deliveryReports: [report("2026-10-09", "2026-10-11T00:00:00.000Z")] }), true],
  ])("%s", (_label, order, late) => {
    expect(poLate(order, now)).toBe(late)
    expect(daysLate(order, now) > 0).toBe(late)
    expect(supplierLate(order)).toBe(late)
  })

  it("the receipt desk's due row agrees", () => {
    const rows = incomingRows([], [po({ deliveryReports: [report("2026-10-09")] })], now)
    expect(rows).toEqual([expect.objectContaining({ kind: "due", daysLate: 0 })])
    expect(incomingRows([], [po()], now)).toEqual([expect.objectContaining({ kind: "due", daysLate: 4 })])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Re-award after the supplier declined the order (DEC)
// ─────────────────────────────────────────────────────────────────────────────

const seedPo = (id: string, over: Partial<PurchaseOrder>) => {
  const { id: _drop, ...data } = po(over)
  void _drop
  seed(`purchaseOrders/${id}`, data as unknown as Record<string, unknown>)
}

describe("re-award after the supplier declined", () => {
  const declined = { at: "2026-10-14T10:00:00.000Z", reason: "stock", note: "", byId: SUP, byName: "S" }
  const rfq = { id: "r1", organizationId: ORG, contractorId: "buyer", createdByUserId: "buyer", title: "بلوك", rfqNumber: "RFQ-2026/031", status: "Awarded", products: [{ name: "بلوك", quantity: 100, unitOfMeasure: "حبة" }], log: [] }

  beforeEach(() => {
    resetFakeDb()
    seed("rfqs/r1", rfq)
    seedPo("p1", { status: "cancelled", supplierDecline: declined as never, cancelledReason: "نفد المخزون", supplierAcceptedAt: null, promisedDate: null })
    seed("offers/o1", { rfqId: "r1", supplierId: SUP, organizationId: SUP, status: "مقبول", price: "300", poId: "p1", poNumber: "PO-2026/044", awaitingOrderApproval: true })
    seed("offers/o2", { rfqId: "r1", supplierId: "sup2", organizationId: "sup2", status: "قيد المراجعة", price: "320", outcome: { k: "lost", at: "2026-10-12T00:00:00.000Z", why: "price" } })
    seed("offers/o3", { rfqId: "r1", supplierId: "sup3", organizationId: "sup3", status: "مرفوض", price: "500", exclusion: { code: "spec" } })
  })

  it("is refused for an order nobody declined, an RFQ no longer awarded, or a buyer without the award's permission", () => {
    const a = actor()
    expect(reopenAwardRefusal(po({ status: "cancelled" }), rfq, a)).toBe("not_declined")
    expect(reopenAwardRefusal(po({ status: "cancelled", supplierDecline: declined as never }), { ...rfq, status: "New" }, a)).toBe("rfq_not_awarded")
    expect(reopenAwardRefusal(po({ status: "cancelled", supplierDecline: declined as never }), rfq, actor({ canPrepare: false }))).toBe("no_permission")
    expect(reopenAwardRefusal(po({ status: "cancelled", supplierDecline: declined as never }), { ...rfq, createdByUserId: "other", contractorId: "other" }, a)).toBe("not_your_rfq")
    expect(reopenAwardRefusal(po({ status: "cancelled", supplierDecline: declined as never }), rfq, a)).toBeNull()
  })

  // The reopening itself runs on the server — supplier-free-reaward-server.test.ts.

  it("names the PRD's state in both languages and logs the reopening", () => {
    const C = (l: typeof ar) => (l as unknown as { Portal: { Contractor: Record<string, string>; Procurement: Record<string, string> & { rfqd: { log: Record<string, string> } } } }).Portal
    for (const l of [ar, en]) {
      expect(C(l).Contractor.offers_status_order_declined).toBeTruthy()
      expect(C(l).Procurement.rfqd.log.award_reopened).toContain("{supplier}")
      for (const k of ["not_declined", "rfq_not_awarded", "award_split_live"]) expect(C(l).Procurement[`err_${k}`]).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Every quote is told its result (OFR-07)
// ─────────────────────────────────────────────────────────────────────────────

describe("rfq_outcome — told to each supplier", () => {
  type Note = { type: string; title: string; message: string; i18n: { params: Record<string, string> }; link: string; organizationId: string }
  const notes = (uid: string) => listCollection<Note>(`users/${uid}/notifications`).filter((n) => n.type === "rfq_outcome")

  beforeEach(() => {
    resetFakeDb()
    seed("rfqs/r1", { organizationId: ORG, contractorId: "buyer", createdByUserId: "buyer", title: "بلوك", rfqNumber: "RFQ-2026/031", status: "New", products: [{ name: "بلوك", quantity: 100, unitOfMeasure: "حبة" }], log: [] })
    seed("offers/o1", { rfqId: "r1", supplierId: "s1", organizationId: "s1", status: "قيد المراجعة", price: "300" })
    seed("offers/o2", { rfqId: "r1", supplierId: "s2", organizationId: "s2", status: "قيد المراجعة", price: "320" })
    seed("offers/o3", { rfqId: "r1", supplierId: "guest", isGuestOffer: true, status: "قيد المراجعة", price: "330" })
    seed("offers/o4", { rfqId: "r1", supplierId: "s4", organizationId: "s4", status: "مسحوب", withdrawnAt: "2026-10-10T00:00:00.000Z", price: "250" })
  })

  it("at the award: the others hear «awarded to another» with the reason, the contractor named first and the number bare; the winner hears with his order", async () => {
    const o1: AwardOfferLike = { id: "o1", price: "300", supplierId: "s1", organizationId: "s1", status: "قيد المراجعة" }
    const others = [{ id: "o2", price: "320", status: "قيد المراجعة" }, { id: "o3", price: "330", status: "قيد المراجعة", isGuestOffer: true, supplierId: "guest" }] as AwardOfferLike[]
    await awardRfq(
      db,
      actor(),
      { rfq: { id: "r1", title: "بلوك", organizationId: ORG, products: [{ name: "بلوك", quantity: 100, unitOfMeasure: "حبة" }] }, offers: [o1, ...others], groups: [{ offer: o1, lines: [{ rfqProductIndex: 0, unitPrice: 3 }], total: 300, requestedDeliveryDate: "2026-10-25", lowestForLines: 300, offLowest: false }], unpicked: [], awardReason: null, breakdown: false, policies: DEFAULT_POLICIES, lossReason: "time" },
      { now: NOW, orgName: "آفاق فنية" }
    )
    const [n] = notes("s2")
    expect(n.i18n.params).toMatchObject({ contractor: "آفاق فنية", rfq: "2026/031", result: "@pn_rfq_outcome_lost", reason: "@pn_rfq_outcome_why_time" })
    expect(n.title.startsWith("آفاق فنية")).toBe(true)
    expect(n.title).not.toContain("RFQ-")
    expect(n.message).toBe(`${PROC_EVENT_PARAM_COPY_AR.pn_rfq_outcome_lost}${PROC_EVENT_PARAM_COPY_AR.pn_rfq_outcome_why_time}`)
    expect(n.organizationId).toBe("s2")
    expect(n.link).toBe("/supplier/offers")
    expect(notes("s1")).toHaveLength(0) // won: told with the order once it is approved and sent (po_sent)
    expect(notes("s4")).toHaveLength(0) // withdrawn: his own result
  })

  it("a loss with no reason says none (the reason is optional)", () => {
    const e = rfqOutcomeEvent({ id: "o2", supplierId: "s2", organizationId: "s2" }, { organizationId: ORG, rfqId: "r1", rfqNumber: "RFQ-2026/031", contractor: "آفاق", result: "lost", why: null }) as ProcEvent
    expect(e.params?.reason).toBe("")
    expect(rfqOutcomeEvent({ id: "g", supplierId: "guest", isGuestOffer: true }, { organizationId: ORG, rfqId: "r1", contractor: "آفاق", result: "lost" })).toBeNull()
  })

  it("at the cancellation: every live quote closes with no award, with the cancellation's reason", async () => {
    const a = { ...actor(), managesRfqs: true, ownerHasTeam: false } as RfqWriteActor
    await cancelRfq(db, a, "r1", "need", NOW, { orgName: "آفاق فنية" })
    for (const uid of ["s1", "s2"]) {
      const [n] = notes(uid)
      expect(n.i18n.params).toMatchObject({ contractor: "آفاق فنية", rfq: "2026/031", result: "@pn_rfq_outcome_noaward", reason: "@pn_rfq_outcome_why_need" })
    }
    expect(notes("s4")).toHaveLength(0)
  })

  it("its copy is the same in the Arabic table and the messages, and every reason has words in both languages", () => {
    const S = (l: typeof ar) => (l as unknown as { Portal: { Shared: Record<string, string> } }).Portal.Shared
    expect(S(ar).pn_rfq_outcome_title).toBe(PROC_EVENT_COPY_AR.rfq_outcome.title)
    expect(S(ar).pn_rfq_outcome).toBe(PROC_EVENT_COPY_AR.rfq_outcome.message)
    expect(PROC_EVENT_COPY_AR.rfq_outcome.title.startsWith("{contractor}")).toBe(true)
    for (const k of ["lost", "noaward", "why_price", "why_time", "why_spec", "why_need", "why_reissue"]) {
      expect(S(ar)[`pn_rfq_outcome_${k}`]).toBe(PROC_EVENT_PARAM_COPY_AR[`pn_rfq_outcome_${k}`])
      expect(S(en)[`pn_rfq_outcome_${k}`]).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6 · Terms: RFQ (only when set) › offer › default; every order carries them
// ─────────────────────────────────────────────────────────────────────────────

describe("payment terms freeze (G-08)", () => {
  it("an RFQ stores terms only when the buyer set them — so the offer's own terms reach the order", () => {
    const shown = [{ pct: "100", days: "30" }]
    expect(rfqTermsToStore(shown, false)).toBeNull()
    expect(rfqTermsToStore([{ pct: "30", days: "0" }, { pct: "70", days: "60" }], true)).toEqual([{ pct: 30, days: 0 }, { pct: 70, days: 60 }])
    const offer = { advancePercent: 20, creditDays: 45 }
    expect(frozenTermsOf(offer, { paymentTermsList: rfqTermsToStore(shown, false) }).termsList).toEqual([{ pct: 20, days: 0 }, { pct: 80, days: 45 }])
    expect(frozenTermsOf({}, { paymentTermsList: rfqTermsToStore(shown, false) }).termsList).toEqual([{ pct: 100, days: 30 }])
  })

  it("the RFQ form writes the picker's rows only through that rule", () => {
    // The rows editor (PUR-02) replaced the card form: its RFQ and its direct award's order.
    const src = fs.readFileSync(path.join(__dirname, "../components/procurement/rfq-editor/RfqEditor.tsx"), "utf8")
    expect(src).not.toMatch(/DEFAULT_TERMS/)
    expect(src.match(/paymentTermsList: rfqTermsToStore\(values\.terms, values\.termsSet\)/g)).toHaveLength(2)
  })

  it("a retroactive order carries terms too", async () => {
    resetFakeDb()
    const r = await retroactivePurchaseOrder(db, owner, { organizationId: ORG, rfqTitle: "شراء نقدي", supplierName: "مستودع", lines: [{ name: "أسمنت", unit: "كيس", quantity: 4, unitPrice: 18 }], totalExVat: 72, reason: "حاجة عاجلة" }, { now: NOW })
    expect(readDoc<{ termsList: unknown }>(`purchaseOrders/${r.id}`)?.termsList).toEqual([{ pct: 100, days: 30 }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7 · 8 · The Riyadh day: RFQ numbers and guest deadlines
// ─────────────────────────────────────────────────────────────────────────────

describe("the Riyadh day", () => {
  it("an RFQ raised at 1 AM on 1 January in Riyadh is numbered in the new year", async () => {
    resetFakeDb()
    const r = await createRfqWithNumber(db, { organizationId: ORG, title: "x" }, new Date("2026-12-31T22:30:00Z"))
    expect(r.rfqNumber).toBe("RFQ-2027/001")
  })

  it("a guest link closes at the end of the deadline's day in Riyadh, not the server's", () => {
    expect(deadlineEnd("2026-10-15")).toBe("2026-10-15T20:59:59.999Z")
    const rfq = { deadline: "2026-10-15" }
    expect(isRfqDeadlinePassed(rfq, new Date("2026-10-15T20:30:00Z"))).toBe(false)
    expect(isRfqDeadlinePassed(rfq, new Date("2026-10-15T21:30:00Z"))).toBe(true)
    expect(isRfqDeadlinePassed({}, new Date("2030-01-01T00:00:00Z"))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9 · No «التحصيل» in the free account (B-06)
// ─────────────────────────────────────────────────────────────────────────────

describe("the free account's words (B-06)", () => {
  it("no string says «collection»", () => {
    const A = (ar as unknown as { SupplierFree: Record<string, string> }).SupplierFree
    const E = (en as unknown as { SupplierFree: Record<string, string> }).SupplierFree
    for (const v of Object.values(A)) expect(String(v)).not.toMatch(/تحصيل|تحصّل|التحصيل/)
    for (const v of Object.values(E)) expect(String(v)).not.toMatch(/\bcollection\b/i)
  })
})

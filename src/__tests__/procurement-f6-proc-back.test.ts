/**
 * Fix wave F — V6-proc-back (the Procurement back office against the
 * prototype): the PO closes on Finance's payment (02), each hold decision's
 * first consequence (10), the PO print only once approved and only for price
 * holders (13), the send form keeps the typed contact on our supplier record
 * (14), and when/how a delivery notice was sent (15).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { canPrintOrder } from "@/components/procurement/PoModel"
import { recordFinancePayment } from "@/lib/procurement/po-extra-writes"
import { closedByPayment, closesOnPayment, holdEffectKeys, noticeSent, paidInFull, type PoFinancePayment, type PurchaseOrderX } from "@/lib/procurement/po-extras"
import { closePurchaseOrder, sendContactPatch, sendPurchaseOrder } from "@/lib/procurement/writes"
import type { PoLine, ProcActor } from "@/lib/procurement/types"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-22T09:00:00Z")

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Cement", unit: "bag", quantity: 100, unitPrice: 20, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrderX> = {}): PurchaseOrderX => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/014",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "Foundations",
  offerId: "o1",
  projectId: "p1",
  projectName: "Tower",
  supplierOrgId: "sup-org",
  supplierUserId: "sup-user",
  supplierName: "Al-Ufuq",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 2000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 2000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer",
  preparedByName: "Badr",
  createdAt: "2026-09-01T08:00:00.000Z",
  approverKind: "manager",
  approvedById: "mgr",
  approvedByName: "Noura",
  approvedAt: "2026-09-02T08:00:00.000Z",
  promisedDate: "2026-09-30",
  log: [],
  ...over,
})
const pay = (amount: number, over: Partial<PoFinancePayment> = {}): PoFinancePayment => ({ no: "PAY-1", kind: "inv", amount, valueDate: "2026-09-20", reference: "TRX", byName: "Fin", at: "2026-09-20T08:00:00Z", ...over })
const actor = (over: Partial<ProcActor> = {}): ProcActor => ({ uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true, ...over })
const finance = actor({ uid: "fin", name: "Fin", canPrepare: false, canExpedite: false })
const store = (p: PurchaseOrderX) => {
  const { id, ...rest } = p
  seed(`purchaseOrders/${id}`, rest)
}
const stored = (id = "po1") => readDoc<PurchaseOrderX>(`purchaseOrders/${id}`) as PurchaseOrderX

beforeEach(() => resetFakeDb())

describe("02 · a PO is closed by Finance's payment (prototype «أقفلته المالية بالسداد»)", () => {
  const received = [line({ accepted: 100 })]

  it("paid in full = the payments cover the commitment, VAT included", () => {
    expect(paidInFull(po({ financePayments: [pay(2300)] }))).toBe(true)
    expect(paidInFull(po({ financePayments: [pay(1000), pay(1300, { no: "PAY-2" })] }))).toBe(true)
    expect(paidInFull(po({ financePayments: [pay(2000)] }))).toBe(false)
    expect(paidInFull(po())).toBe(false)
  })

  it("closes on payment only once everything was received; an old paid-and-received order reads closed", () => {
    expect(closesOnPayment(po({ lines: received, financePayments: [pay(2300)] }))).toBe(true)
    expect(closesOnPayment(po({ financePayments: [pay(2300)] }))).toBe(false)
    expect(closedByPayment(po({ lines: received, financePayments: [pay(2300)] }))).toBe(true)
    expect(closedByPayment(po({ status: "closed", closedShort: true, lines: [line({ accepted: 40 })] }))).toBe(false)
    expect(closedByPayment(po({ status: "closed", closedByPayment: true, lines: received }))).toBe(true)
  })

  it("the payment that covers a received order closes it in the same write, and logs it", async () => {
    store(po({ lines: received }))
    await recordFinancePayment(db, finance, true, "po1", { kind: "inv", amount: 2300, valueDate: "2026-09-21", reference: "TRX-9" }, NOW)
    expect(stored()).toMatchObject({ status: "closed", closedByPayment: true, closedShort: false, closedAt: NOW.toISOString() })
    expect(stored().financePayments).toHaveLength(1)
    expect(stored().log[stored().log.length - 1]).toMatchObject({ action: "closed", byName: "Fin", params: { byPayment: 1 } })
  })

  it("a partial payment leaves it open; so does a full payment before the goods are in", async () => {
    store(po({ lines: received }))
    await recordFinancePayment(db, finance, true, "po1", { kind: "part", amount: 1000, valueDate: "2026-09-21", reference: "TRX-1" }, NOW)
    expect(stored()).toMatchObject({ status: "accepted" })
    expect(stored().closedByPayment).toBeUndefined()
    await recordFinancePayment(db, finance, true, "po1", { kind: "inv", amount: 1300, valueDate: "2026-09-22", reference: "TRX-2" }, NOW)
    expect(stored()).toMatchObject({ status: "closed", closedByPayment: true })

    store(po({ id: "po2" }))
    await recordFinancePayment(db, finance, true, "po2", { kind: "adv", amount: 2300, valueDate: "2026-09-21", reference: "TRX-3" }, NOW)
    expect(stored("po2").status).toBe("accepted")
  })

  it("Procurement still closes an incomplete order short, never a complete one", async () => {
    store(po({ lines: [line({ accepted: 40 })] }))
    await closePurchaseOrder(db, actor(), "po1", { reason: "Supplier stopped" }, { now: NOW })
    expect(stored()).toMatchObject({ status: "closed", closedShort: true, closeReason: "Supplier stopped" })
    store(po({ id: "po2", lines: received }))
    await expect(closePurchaseOrder(db, actor(), "po2", {}, { now: NOW })).rejects.toMatchObject({ code: "wrong_state" })
  })
})

describe("10 · the hold decision leads with what the decision does next (prototype FROPT)", () => {
  it("per decision, else the default; price holds keep their own pair", () => {
    expect(holdEffectKeys("qty", "credit", false)).toEqual(["first.credit", "effect_1", "effect_2"])
    expect(holdEffectKeys("qty", "supply", false)[0]).toBe("first.supply")
    expect(holdEffectKeys("iban", "fix", false)[0]).toBe("first.fix")
    expect(holdEffectKeys("iban", "stop", false)[0]).toBe("first.default")
    expect(holdEffectKeys("vat", "", false)[0]).toBe("first.default")
    expect(holdEffectKeys("price", "po_price", false)).toEqual(["first.po_price", "effect_history"])
    expect(holdEffectKeys("price", "new_price", true)).toEqual(["effect_now", "effect_history"])
    expect(holdEffectKeys("price", "inv_price", false)).toEqual(["effect_approver", "effect_history"])
  })
})

describe("13 · «أمر الشراء PDF» once approved, and only for whoever sees prices", () => {
  it("never a draft, never the expediter", () => {
    expect(canPrintOrder(po(), actor())).toBe(true)
    expect(canPrintOrder(po({ approvedAt: null }), actor())).toBe(false)
    expect(canPrintOrder(po(), actor({ seesPrices: false }))).toBe(false)
  })
})

describe("14 · the send form keeps the typed contact on our supplier record", () => {
  it("only the channel used, only when typed", () => {
    const at = NOW.toISOString()
    expect(sendContactPatch("whatsapp", { phone: " 0550000000 ", email: "a@b.sa" }, actor(), at)).toEqual({ contactPhone: "0550000000", contactSavedAt: at, contactSavedByName: "Badr" })
    expect(sendContactPatch("email", { phone: "055", email: "a@b.sa" }, actor(), at)).toEqual({ contactEmail: "a@b.sa", contactSavedAt: at, contactSavedByName: "Badr" })
    expect(sendContactPatch("portal", { phone: "055" }, actor(), at)).toBeNull()
    expect(sendContactPatch("whatsapp", { phone: "  " }, actor(), at)).toBeNull()
  })

  it("sending saves it — creating our record when there is none, updating it when there is; a guest has none", async () => {
    const approved = po({ status: "approved", promisedDate: null })
    store(approved)
    await sendPurchaseOrder(db, actor(), "po1", "whatsapp", { now: NOW }, { phone: "0551112222" })
    expect(stored().status).toBe("sent")
    expect(readDoc("supplierRecords/org__sup-org")).toMatchObject({ organizationId: "org", supplierOrgId: "sup-org", supplierName: "Al-Ufuq", contactPhone: "0551112222", contactSavedByName: "Badr" })

    seed("supplierRecords/org__sup-org", { organizationId: "org", supplierOrgId: "sup-org", supplierName: "Al-Ufuq", vatNumber: "300", contactPhone: "0551112222" })
    store(po({ id: "po2", status: "approved", promisedDate: null }))
    await sendPurchaseOrder(db, actor(), "po2", "email", { now: NOW }, { email: "sales@ufuq.sa" })
    expect(readDoc("supplierRecords/org__sup-org")).toMatchObject({ vatNumber: "300", contactPhone: "0551112222", contactEmail: "sales@ufuq.sa" })

    store(po({ id: "po3", status: "approved", promisedDate: null, isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null }))
    await sendPurchaseOrder(db, actor(), "po3", "whatsapp", { now: NOW }, { phone: "0553334444" })
    expect(readDoc("supplierRecords/org__guest")).toBeNull()
  })
})

describe("15 · when and how the supplier sent a delivery notice (poAsnSec)", () => {
  it("from the order's link (a guest) or from the portal, with his note", () => {
    expect(noticeSent({ createdAt: "2026-09-20T10:00:00Z", isGuestDelivery: true, notes: " crane needed " })).toEqual({ at: "2026-09-20T10:00:00Z", via: "link", note: "crane needed" })
    expect(noticeSent({ createdAt: { toDate: () => new Date("2026-09-21T06:00:00Z") } })).toEqual({ at: "2026-09-21T06:00:00.000Z", via: "portal", note: null })
    expect(noticeSent({})).toEqual({ at: null, via: "portal", note: null })
  })
})


/**
 * Procurement PRD 3.0 — writing a price agreement, and the price history an
 * approval leaves behind. Runs against the in-memory Firestore, so the yearly
 * number is really drawn from `mfgCounters` inside the transaction and a refused
 * step is shown to have written nothing.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { cleanAgreementLines, createPriceAgreement, endPriceAgreement, renewPriceAgreement } from "@/lib/procurement/agreement-writes"
import { PRICE_AGREEMENTS, PRICE_HISTORY, materialKey, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { ProcWriteError } from "@/lib/procurement/writes"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { approvePurchaseOrder } from "@/lib/procurement/writes"

const db = fakeFirestore as unknown as Firestore
const ORG = "owner-uid"
const NOW = new Date("2026-09-22T09:00:00.000Z")

const actorOf = (over: Partial<ProcActor>): ProcActor => ({
  uid: "buyer",
  name: "Badr",
  isOwner: false,
  canApprove: false,
  canPrepare: true,
  canExpedite: true,
  canReceive: false,
  seesPrices: true,
  ...over,
})
const buyer = actorOf({})
const approver = actorOf({ uid: "fin", name: "Noura", canApprove: true, canPrepare: false })
const bystander = actorOf({ uid: "gate", name: "Salma", canPrepare: false, canApprove: false, canExpedite: false })

const input = {
  organizationId: ORG,
  supplierOrgId: "sup-org",
  supplierName: "شركة الحديد",
  from: "2026-09-01",
  until: "2027-03-31",
  lines: [{ name: "حديد 12مم", unit: "طن", price: "2,780" }],
  note: " الضخّ مشمول ",
}

const agreements = () => listCollection<PriceAgreement>(PRICE_AGREEMENTS)
const history = () => listCollection<PriceHistoryEntry>(PRICE_HISTORY)

beforeEach(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, name: "Owner" })
  seed("users/buyer", { organizationId: ORG, organizationRole: "member" })
})

describe("the lines as typed", () => {
  it("keeps what is real, drops what is not", () => {
    expect(
      cleanAgreementLines([
        { name: " حديد 12مم ", unit: " طن ", price: "2,780.50" },
        { name: "", unit: "طن", price: 10 },
        { name: "أسمنت", unit: "", price: 10 },
        { name: "أسمنت", unit: "كيس", price: 0 },
        { name: "أسمنت", unit: "كيس", price: "abc" },
      ])
    ).toEqual([{ name: "حديد 12مم", unit: "طن", price: 2780.5 }])
  })

  it("keeps one price per material — the folded pair decides", () => {
    const lines = cleanAgreementLines([
      { name: "حديد ١٢مم", unit: "طن", price: 2780 },
      { name: "حديد 12مم", unit: " طن ", price: 2900 },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].price).toBe(2780)
  })
})

describe("signing an agreement", () => {
  it("draws the yearly number, freezes the facts and logs it", async () => {
    const r = await createPriceAgreement(db, buyer, input, { now: NOW })
    expect(r.docNumber).toBe("AG-2026/001")
    const a = readDoc<PriceAgreement>(`${PRICE_AGREEMENTS}/${r.id}`) as PriceAgreement
    expect(a).toMatchObject({
      organizationId: ORG,
      docNumber: "AG-2026/001",
      supplierOrgId: "sup-org",
      supplierName: "شركة الحديد",
      from: "2026-09-01",
      until: "2027-03-31",
      note: "الضخّ مشمول",
      preparedById: "buyer",
      preparedByName: "Badr",
      endedAt: null,
    })
    expect(a.lines).toEqual([{ name: "حديد 12مم", unit: "طن", price: 2780 }])
    expect(a.log?.[0]).toMatchObject({ action: "created", byId: "buyer", params: { number: "AG-2026/001", lines: 1 } })
  })

  it("numbers the next one in sequence", async () => {
    await createPriceAgreement(db, buyer, input, { now: NOW })
    const second = await createPriceAgreement(db, approver, { ...input, supplierOrgId: "other" }, { now: NOW })
    expect(second.docNumber).toBe("AG-2026/002")
  })

  it("is the hand that awards or approves, nobody else", async () => {
    await expect(createPriceAgreement(db, bystander, input, { now: NOW })).rejects.toMatchObject({ code: "no_permission" })
    expect(agreements()).toHaveLength(0)
    await expect(createPriceAgreement(db, approver, input, { now: NOW })).resolves.toMatchObject({ docNumber: "AG-2026/001" })
  })

  it("refuses a window that runs backwards, or one already over", async () => {
    await expect(createPriceAgreement(db, buyer, { ...input, from: "2027-01-01", until: "2026-12-01" }, { now: NOW })).rejects.toMatchObject({ code: "date_invalid" })
    await expect(createPriceAgreement(db, buyer, { ...input, from: "2026-01-01", until: "2026-09-21" }, { now: NOW })).rejects.toMatchObject({ code: "date_invalid" })
    await expect(createPriceAgreement(db, buyer, { ...input, until: "" }, { now: NOW })).rejects.toMatchObject({ code: "date_invalid" })
    expect(agreements()).toHaveLength(0)
  })

  it("accepts one that ends today and one that starts later", async () => {
    await expect(createPriceAgreement(db, buyer, { ...input, until: "2026-09-22" }, { now: NOW })).resolves.toBeTruthy()
    await expect(createPriceAgreement(db, buyer, { ...input, from: "2026-12-01", until: "2027-06-30" }, { now: NOW })).resolves.toBeTruthy()
  })

  it("refuses an agreement with no supplier and one with no priced material", async () => {
    await expect(createPriceAgreement(db, buyer, { ...input, supplierOrgId: "" }, { now: NOW })).rejects.toMatchObject({ code: "supplier_missing" })
    await expect(createPriceAgreement(db, buyer, { ...input, lines: [{ name: "x", unit: "u", price: 0 }] }, { now: NOW })).rejects.toMatchObject({ code: "no_lines" })
    expect(agreements()).toHaveLength(0)
  })
})

describe("renewing one", () => {
  const twoLines = { ...input, lines: [{ name: "حديد 12مم", unit: "طن", price: 2780 }, { name: "أسمنت", unit: "كيس", price: 15.2 }] }

  it("moves the end date and reprices only what was typed", async () => {
    const { id } = await createPriceAgreement(db, buyer, twoLines, { now: NOW })
    const a = await renewPriceAgreement(db, approver, id, { until: "2027-12-31", prices: { [materialKey("حديد 12مم", "طن")]: "2,900" } }, { now: NOW })
    expect(a.until).toBe("2027-12-31")
    expect(a.lines).toEqual([{ name: "حديد 12مم", unit: "طن", price: 2900 }, { name: "أسمنت", unit: "كيس", price: 15.2 }])
    expect(a.log?.[1]).toMatchObject({ action: "renewed", byId: "fin", params: { until: "2027-12-31", repriced: 1 } })
  })

  it("keeps every price when none is typed", async () => {
    const { id } = await createPriceAgreement(db, buyer, twoLines, { now: NOW })
    const a = await renewPriceAgreement(db, buyer, id, { until: "2027-12-31", prices: { [materialKey("حديد 12مم", "طن")]: "" } }, { now: NOW })
    expect(a.lines.map((l) => l.price)).toEqual([2780, 15.2])
    expect(a.log?.[1]).toMatchObject({ params: { repriced: 0 } })
  })

  it("refuses a new end date that is not in the future", async () => {
    const { id } = await createPriceAgreement(db, buyer, twoLines, { now: NOW })
    await expect(renewPriceAgreement(db, buyer, id, { until: "2026-09-22" }, { now: NOW })).rejects.toMatchObject({ code: "date_invalid" })
    await expect(renewPriceAgreement(db, buyer, id, { until: "2026-09-01" }, { now: NOW })).rejects.toMatchObject({ code: "date_invalid" })
    expect(readDoc<PriceAgreement>(`${PRICE_AGREEMENTS}/${id}`)?.until).toBe("2027-03-31")
  })

  it("brings a lapsed one back, and writes nothing to the price history", async () => {
    const { id } = await createPriceAgreement(db, buyer, { ...twoLines, until: "2026-09-22" }, { now: NOW })
    const a = await renewPriceAgreement(db, buyer, id, { until: "2027-06-30" }, { now: NOW })
    expect(a.endedAt).toBeNull()
    // Nobody has bought anything at the new price yet.
    expect(history()).toHaveLength(0)
  })

  it("refuses a stranger and a missing agreement", async () => {
    const { id } = await createPriceAgreement(db, buyer, twoLines, { now: NOW })
    await expect(renewPriceAgreement(db, bystander, id, { until: "2027-12-31" }, { now: NOW })).rejects.toMatchObject({ code: "no_permission" })
    await expect(renewPriceAgreement(db, buyer, "nope", { until: "2027-12-31" }, { now: NOW })).rejects.toMatchObject({ code: "order_missing" })
  })
})

describe("ending one early", () => {
  it("records the reason and the day", async () => {
    const { id } = await createPriceAgreement(db, buyer, input, { now: NOW })
    const a = await endPriceAgreement(db, approver, id, " المورد رفع السعر ", { now: NOW })
    expect(a.endedAt).toBe(NOW.toISOString())
    expect(a.log?.[1]).toMatchObject({ action: "ended", byId: "fin", params: { reason: "المورد رفع السعر" } })
  })

  it("cancels one that has not started — it must not switch itself on (UAT, 23 Sep)", async () => {
    const { id } = await createPriceAgreement(db, buyer, { ...input, from: "2026-10-15", until: "2027-03-31" }, { now: NOW })
    const a = await endPriceAgreement(db, buyer, id, "الصفقة لم تتم", { now: NOW })
    expect(a.endedAt).toBe(NOW.toISOString())
  })

  it("has nothing to end once its date has passed", async () => {
    const { id } = await createPriceAgreement(db, buyer, { ...input, from: "2026-09-01", until: "2026-09-30" }, { now: NOW })
    await expect(endPriceAgreement(db, buyer, id, "late", { now: new Date("2026-10-05T09:00:00Z") })).rejects.toMatchObject({ code: "wrong_state" })
  })

  it("needs a reason, and cannot end twice", async () => {
    const { id } = await createPriceAgreement(db, buyer, input, { now: NOW })
    await expect(endPriceAgreement(db, buyer, id, "  ", { now: NOW })).rejects.toMatchObject({ code: "reason_required" })
    await endPriceAgreement(db, buyer, id, "سبب", { now: NOW })
    await expect(endPriceAgreement(db, buyer, id, "again", { now: NOW })).rejects.toMatchObject({ code: "wrong_state" })
  })
})

describe("the price history an approval leaves", () => {
  const order = (over: Partial<PurchaseOrder> = {}): Omit<PurchaseOrder, "id"> =>
    ({
      organizationId: ORG,
      docNumber: "PO-2026/014",
      status: "awaiting_approval",
      basis: "rfq",
      rfqId: "rfq1",
      rfqTitle: "حديد",
      offerId: "of1",
      projectId: null,
      supplierOrgId: "sup-org",
      supplierUserId: "sup-user",
      supplierName: "شركة الحديد",
      isGuestSupplier: false,
      lines: [
        { id: "l1", name: "حديد 12مم", unit: "طن", quantity: 10, unitPrice: 2780, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
        { id: "l2", name: "لحام", unit: "خدمة", quantity: 1, unitPrice: null, accepted: 0, rejected: 0, held: 0, cancelled: 0 },
      ],
      totalExVat: 27800,
      vatRate: 0.15,
      offersCount: 3,
      lowestOfferTotal: 27800,
      shortCompetition: false,
      noOfficialQuote: false,
      preparedById: "buyer",
      preparedByName: "Badr",
      createdAt: "2026-09-20T09:00:00.000Z",
      approverKind: "manager",
      log: [],
      ...over,
    }) as Omit<PurchaseOrder, "id">

  it("records the priced lines at approval, not before", async () => {
    seed("purchaseOrders/po1", order())
    expect(history()).toHaveLength(0)
    await approvePurchaseOrder(db, approver, "po1", { policies: DEFAULT_POLICIES }, { now: NOW })
    const rows = history()
    // The lump-sum line has no unit price, so it records nothing.
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: "po1__l1",
      organizationId: ORG,
      name: "حديد 12مم",
      unit: "طن",
      price: 2780,
      day: "2026-09-22",
      kind: "po",
      poId: "po1",
      poNumber: "PO-2026/014",
      supplierOrgId: "sup-org",
      supplierName: "شركة الحديد",
    })
    expect(rows[0].materialKey).toBe(materialKey("حديد 12مم", "طن"))
  })

  it("records nothing when the approval is refused", async () => {
    seed("purchaseOrders/po1", order())
    // The preparer may not approve his own order.
    await expect(approvePurchaseOrder(db, buyer, "po1", { policies: DEFAULT_POLICIES }, { now: NOW })).rejects.toBeInstanceOf(ProcWriteError)
    expect(history()).toHaveLength(0)
  })
})

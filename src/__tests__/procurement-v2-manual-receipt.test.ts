/** @jest-environment node */
/**
 * Procurement 2.0 — the manual receipt v2 (RCV-05, WF-20, WP-S5-03b). Something bought OUTSIDE the platform: a free-text supplier, a
 * delivery location, a day, the invoice number and value, the same material rows, what comes next (a later order · a cash expense) and the
 * attachments. It is tagged «يدوي» and listed under «بلا أمر شراء». At a PROJECT's store it lands at once and is charged to the site; at a
 * MAIN warehouse it reaches the storekeeper as a DRAFT (`proc:GRN:<no>:MAN`) and no stock moves before he confirms. Ported: qa_flows WF-20
 * (record → in the receipts as manual, listed under No PO).
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))

import { POST as recordRoute } from "@/app/api/procurement/manual-receipt/route"
import { POST as answerRoute } from "@/app/api/procurement/manual-receipt/confirm/route"
import { manualFormToBody, manualReceiptBody, manualReceiptSchema, type ManualReceiptValues } from "@/lib/procurement/manual-receipt-form"
import { ManualReceiptRefusal, answerManualDraft, createManualReceipt } from "@/lib/procurement/manual-receipt-server"
import { isNoPo, receiptSegment, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import { receiptState } from "@/lib/procurement/receipts"

const ORG = "org1"
const NOW = new Date("2026-10-21T09:00:00Z")
const asDb = mockDb as never
const buyer = { uid: "buyer", name: "بدر", orgId: ORG }
const body = (over: Record<string, unknown> = {}) => ({
  supplierName: "مؤسسة البناء السريع",
  supplierOrgId: null,
  deliveryDate: "2026-10-20",
  warehouseId: "wh-p1",
  invoiceNumber: "INV-778",
  invoiceValue: 1200,
  after: "later" as const,
  notes: null,
  items: [{ name: "زوايا حديد 50 مم", quantity: 40, unit: "حبة", unitPrice: 30 }],
  attachments: [{ name: "invoice.jpg", url: "https://firebasestorage.googleapis.com/v0/b/x/o/i.jpg?alt=media" }],
  ...over,
})
const doc = (id: string) => mockDb.get(`deliveries/${id}`) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockDb.seed("users/org1", { organizationId: ORG, name: "المالك" })
  mockDb.seed("users/buyer", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy", name: "بدر" })
  mockDb.seed("users/fin", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-fin" })
  mockDb.seed("users/keeper", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-keep", name: "أمين المستودع" })
  mockDb.seed("users/rando", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-none" })
  mockDb.seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
  mockDb.seed("teamGroups/g-fin", { organizationId: ORG, permissions: ["invoices.manage"] })
  mockDb.seed("teamGroups/g-keep", { organizationId: ORG, permissions: ["warehouses.receive"] })
  mockDb.seed("teamGroups/g-none", { organizationId: ORG, permissions: ["rfq.create"] })
  mockDb.seed("warehouses/wh-p1", { organizationId: ORG, name: "مستودع البرج", projectId: "p1" })
  mockDb.seed("warehouses/wh-main", { organizationId: ORG, name: "المستودع الرئيسي", projectId: null })
  mockDb.seed("warehouses/wh-other", { organizationId: "other", name: "غريب", projectId: null })
})

describe("the server's body is exactly what the form says — and nothing it does not read", () => {
  it("takes the v2 fields, strictly: no order, no receiver, no signature, no CR/VAT", () => {
    expect(manualReceiptBody.safeParse(body()).success).toBe(true)
    for (const extra of [{ poId: "po1" }, { receiverName: "x" }, { supplierSignatureData: "data:image/png;base64,AA" }, { supplierCrNumber: "1" }, { warehouseId: undefined }]) {
      expect(manualReceiptBody.safeParse(body(extra)).success).toBe(false)
    }
    expect(manualReceiptBody.safeParse(body({ attachments: [{ name: "x", url: "https://evil.example/x.jpg" }] })).success).toBe(false)
    expect(manualReceiptBody.safeParse(body({ items: [{ name: "x", quantity: 0, unit: "حبة" }] })).success).toBe(false)
  })

  it("the browser's form: supplier, site, a date no later than today, an invoice value that is a number, each line described and counted", () => {
    const schema = manualReceiptSchema("2026-10-21")
    const ok: ManualReceiptValues = { supplierName: "محل الحي", supplierOrgId: "", deliveryDate: "2026-10-21", warehouseId: "wh-p1", invoiceNumber: "", invoiceValue: "", after: "later", notes: "", rows: [{ inventoryItemId: "", itemName: "مسامير", quantity: "٣٠٠", unit: "", unitPrice: "" }] }
    expect(schema.safeParse(ok).success).toBe(true)
    const bad = schema.safeParse({ ...ok, supplierName: " ", warehouseId: "", deliveryDate: "2026-10-22", invoiceValue: "abc", rows: [{ ...ok.rows[0], itemName: "", quantity: "0" }] })
    expect(bad.success).toBe(false)
    const codes = new Set(!bad.success ? bad.error.issues.map((i) => i.message) : [])
    expect([...codes].sort()).toEqual(["errDate", "errInvoiceValue", "errLineDesc", "errLineQty", "errSite", "errSupplier"])
  })

  it("prices and the invoice value travel only for a reader who sees prices; a blank unit takes the default", () => {
    const v: ManualReceiptValues = { supplierName: "محل", supplierOrgId: "", deliveryDate: "2026-10-20", warehouseId: "wh-p1", invoiceNumber: " INV ", invoiceValue: "1,200", after: "cash", notes: "", rows: [{ inventoryItemId: "", itemName: "مسامير", quantity: "10", unit: "", unitPrice: "3" }] }
    expect(manualFormToBody(v, [], { seesPrices: true, unitDefault: "وحدة" })).toMatchObject({ invoiceNumber: "INV", invoiceValue: 1200, after: "cash", items: [{ unit: "وحدة", unitPrice: 3 }] })
    expect(manualFormToBody(v, [], { seesPrices: false, unitDefault: "وحدة" })).toMatchObject({ invoiceValue: null, items: [{ unitPrice: null }] })
  })
})

describe("at a PROJECT's store: it lands at once, recorded by the buyer, charged to the site", () => {
  it("numbers it, tags it manual, lands the stock, leaves proc:GRN:<no>:MAN, tells Finance", async () => {
    const r = await createManualReceipt(asDb, buyer, body(), NOW)
    expect(r).toMatchObject({ docNumber: "GR-2026/001", draft: false, stockLanded: true })
    expect(doc(r.deliveryId)).toMatchObject({ status: "confirmed", source: "manual", recordedBy: "procurement_manual", receiverModule: "projects", landedWarehouseId: "wh-p1", projectId: "p1", invoiceNumber: "INV-778", invoiceValue: 1200, after: "later", supplierName: "مؤسسة البناء السريع" })
    expect(doc(r.deliveryId)).not.toHaveProperty("manualDraft")
    expect(mockDb.list("warehouses/wh-p1/inventoryItems")).toEqual([expect.objectContaining({ name: "زوايا حديد 50 مم", quantity: 40, unitCost: 30 })])
    expect(mockDb.get("procEvents/org1__proc:GRN:GR-2026_001:MAN")).toMatchObject({ id: "receipt_manual", key: "proc:GRN:GR-2026/001:MAN" })
    expect(mockDb.list("users/fin/notifications").map((n) => n.type)).toEqual(["receipt_manual"])
    expect(mockDb.list("users/keeper/notifications")).toHaveLength(0)
  })

  it("is tagged manual and lives under «بلا أمر شراء» in the receipts", async () => {
    const r = await createManualReceipt(asDb, buyer, body(), NOW)
    const d = { id: r.deliveryId, ...doc(r.deliveryId) } as unknown as DeskDelivery
    expect(isNoPo(d)).toBe(true)
    expect(receiptSegment(d)).toBe("nopo")
    expect(receiptState(d, NOW)).toBe("manual_no_po")
  })
})

describe("at a MAIN warehouse: a draft the storekeeper confirms; nothing enters stock before", () => {
  it("is born a draft: no landed store, no inventory, the storekeeper is told, and it waits under «بلا أمر شراء»", async () => {
    const r = await createManualReceipt(asDb, buyer, body({ warehouseId: "wh-main" }), NOW)
    expect(r).toMatchObject({ draft: true, stockLanded: false })
    expect(doc(r.deliveryId)).toMatchObject({ landedWarehouseId: null, warehouseId: "wh-main", receiverModule: "inventory", manualDraft: { state: "draft", warehouseId: "wh-main", byId: "buyer" } })
    expect(mockDb.list("warehouses/wh-main/inventoryItems")).toHaveLength(0)
    expect(mockDb.list("users/keeper/notifications").map((n) => n.type)).toEqual(["receipt_manual"])
  })

  it("the storekeeper's confirmation lands the stock and tells the buyer; a second answer is refused", async () => {
    const r = await createManualReceipt(asDb, buyer, body({ warehouseId: "wh-main" }), NOW)
    const out = await answerManualDraft(asDb, { uid: "keeper", name: "أمين المستودع", orgId: ORG }, { deliveryId: r.deliveryId, answer: "confirm" }, NOW)
    expect(out).toMatchObject({ state: "confirmed", stockLanded: true })
    expect(doc(r.deliveryId)).toMatchObject({ landedWarehouseId: "wh-main", manualDraft: { state: "confirmed", confirmedById: "keeper" } })
    expect(mockDb.list("warehouses/wh-main/inventoryItems")).toEqual([expect.objectContaining({ quantity: 40 })])
    expect(mockDb.list("users/buyer/notifications").map((n) => n.type)).toEqual(["receipt_manual"])
    await expect(answerManualDraft(asDb, { uid: "keeper", name: "أمين", orgId: ORG }, { deliveryId: r.deliveryId, answer: "confirm" })).rejects.toMatchObject({ code: "not_a_draft" })
    expect(mockDb.list("warehouses/wh-main/inventoryItems")[0].quantity).toBe(40)
  })

  it("declining moves nothing and records who and why", async () => {
    const r = await createManualReceipt(asDb, buyer, body({ warehouseId: "wh-main" }), NOW)
    const out = await answerManualDraft(asDb, { uid: "keeper", name: "أمين", orgId: ORG }, { deliveryId: r.deliveryId, answer: "decline", note: "لم تصل" }, NOW)
    expect(out).toMatchObject({ state: "declined", stockLanded: false })
    expect(doc(r.deliveryId)).toMatchObject({ landedWarehouseId: null, manualDraft: { state: "declined", note: "لم تصل" } })
    expect(mockDb.list("warehouses/wh-main/inventoryItems")).toHaveLength(0)
  })

  it("another company's receipt is not his to answer", async () => {
    const r = await createManualReceipt(asDb, buyer, body({ warehouseId: "wh-main" }), NOW)
    await expect(answerManualDraft(asDb, { uid: "x", name: "x", orgId: "other" }, { deliveryId: r.deliveryId, answer: "confirm" })).rejects.toMatchObject({ code: "not_yours" })
  })
})

describe("what comes next and where it was delivered", () => {
  it("«مصروف نقدي بلا أمر» is ruled an expense at once and Finance hears of it", async () => {
    const r = await createManualReceipt(asDb, buyer, body({ after: "cash" }), NOW)
    expect(doc(r.deliveryId)).toMatchObject({ after: "cash", regularisation: "expense", regularisedById: "buyer" })
    expect(mockDb.list("users/fin/notifications").map((n) => n.type).sort()).toEqual(["receipt_expensed", "receipt_manual"])
  })

  it("the central store is made the first time it is chosen; a future day and another company's store are refused", async () => {
    const r = await createManualReceipt(asDb, buyer, body({ warehouseId: "central_org1" }), NOW)
    expect(r.draft).toBe(true)
    expect(mockDb.get("warehouses/central_org1")).toMatchObject({ isCentral: true, organizationId: ORG })
    await expect(createManualReceipt(asDb, buyer, body({ deliveryDate: "2026-10-22" }), NOW)).rejects.toMatchObject({ code: "date_future" })
    await expect(createManualReceipt(asDb, buyer, body({ warehouseId: "wh-other" }), NOW)).rejects.toBeInstanceOf(ManualReceiptRefusal)
    await expect(createManualReceipt(asDb, buyer, body({ warehouseId: "nowhere" }), NOW)).rejects.toMatchObject({ code: "site_missing" })
  })
})

describe("the routes", () => {
  const post = async (route: (r: NextRequest) => Promise<Response>, user: string, payload: unknown) => {
    const res = await route(new NextRequest("http://localhost/api/procurement/manual-receipt", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(payload) }))
    return { status: res.status, json: (await res.json()) as { data?: { docNumber: string; draft: boolean }; code?: string } }
  }

  it("a buyer records it; a member who neither prepares nor approves orders may not (403); a malformed body is 400", async () => {
    jest.useFakeTimers().setSystemTime(NOW)
    const ok = await post(recordRoute, "buyer", body())
    expect([ok.status, ok.json.data?.docNumber]).toEqual([200, "GR-2026/001"])
    expect((await post(recordRoute, "rando", body())).status).toBe(403)
    expect((await post(recordRoute, "buyer", { ...body(), poId: "po1" })).status).toBe(400)
    jest.useRealTimers()
  })

  it("the storekeeper confirms; the buyer cannot confirm stock; declining needs its reason", async () => {
    jest.useFakeTimers().setSystemTime(NOW)
    const made = await post(recordRoute, "buyer", body({ warehouseId: "wh-main" }))
    const id = mockDb.list("deliveries")[0].id
    expect(made.json.data?.draft).toBe(true)
    expect((await post(answerRoute, "buyer", { deliveryId: id, answer: "confirm" })).status).toBe(403)
    expect((await post(answerRoute, "keeper", { deliveryId: id, answer: "decline" })).json.code).toBe("REASON_REQUIRED")
    expect((await post(answerRoute, "keeper", { deliveryId: id, answer: "confirm" })).status).toBe(200)
    expect((await post(answerRoute, "keeper", { deliveryId: id, answer: "confirm" })).json.code).toBe("NOT_A_DRAFT")
    jest.useRealTimers()
  })
})

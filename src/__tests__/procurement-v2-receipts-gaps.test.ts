/** @jest-environment node */
/**
 * Procurement 2.0 prototype gaps — receipts (RC-03 … RC-06) and the supplier avatar (SP-04).
 * RC-03: the manual receipt's row is the material row used everywhere (the tree's material and specs) and its priced rows join the price
 * history as «يدوي». RC-04: it can be delivered to a WORK SITE with no warehouse — a record of what arrived, no stock. RC-05: the desk
 * narrows to one delivery site in every package. RC-06: the receiver's page says where and when. SP-04: two initials that tell
 * «مصنع …» from «مصنع …».
 */

import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))

import { manualFormToBody, manualPlaces, manualReceiptBody, type ManualReceiptValues } from "@/lib/procurement/manual-receipt-form"
import { ManualReceiptRefusal, createManualReceipt } from "@/lib/procurement/manual-receipt-server"
import { receiptRowMatches, receiptRows, segmentCounts, siteFilterOf, siteMatches, type DeskDelivery } from "@/lib/procurement/receipt-desk"
import { receiptEffects } from "@/lib/procurement/receipt-effects"
import { exportRows } from "@/lib/procurement/receipt-export"
import { priceSeries, materialKey, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { buyerCompanyName, receiveNoticeNumber, receivePlace } from "@/lib/procurement/receive-view"
import { supplierInitials } from "@/lib/procurement/supplier-list"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { MaterialPick } from "@/lib/materials/types"

const ORG = "org1"
const NOW = new Date("2026-10-21T09:00:00Z")
const asDb = mockDb as never
const buyer = { uid: "buyer", name: "بدر", orgId: ORG }
const block: MaterialPick = {
  nodeId: "blk-20",
  subId: "blocks",
  rootId: "build",
  path: [
    { ar: "مواد بناء", en: "Building" },
    { ar: "بلوك", en: "Blocks" },
    { ar: "بلوك أسمنتي", en: "Cement block" },
  ],
  specs: [{ name: { ar: "المقاس", en: "Size" }, value: { ar: "20 سم", en: "20 cm" } }],
}
const body = (over: Record<string, unknown> = {}) => ({
  supplierName: "محل الحي",
  supplierOrgId: null,
  deliveryDate: "2026-10-20",
  warehouseId: "wh-p1",
  invoiceNumber: null,
  invoiceValue: null,
  after: "cash" as const,
  notes: null,
  items: [{ name: "بلوك أسمنتي", quantity: 200, unit: "حبة", unitPrice: 3.5, material: block, invoiceName: "بلك ٢٠" }],
  attachments: [],
  ...over,
})
const doc = (id: string) => mockDb.get(`deliveries/${id}`) as Record<string, unknown>

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockDb.seed("users/org1", { organizationId: ORG, name: "المالك" })
  mockDb.seed("warehouses/wh-p1", { organizationId: ORG, name: "مستودع البرج", projectId: "p1" })
  mockDb.seed("warehouses/wh-main", { organizationId: ORG, name: "المستودع الرئيسي", projectId: null })
  mockDb.seed("procurementSettings/org1", {
    deliverySites: [
      { id: "site_malqa", kind: "site", name: "فيلا الملقا", city: "الرياض", district: "الملقا", address: "", receiverId: null },
      { id: "site_old", kind: "site", name: "موقع قديم", city: "", district: "", address: "", receiverId: null, retired: true },
      { id: "wh_wh-main", kind: "warehouse", name: "المستودع الرئيسي", city: "", district: "", address: "", receiverId: null, warehouseId: "wh-main" },
    ],
  })
})

describe("RC-04: a manual purchase delivered to a work site with no warehouse is a RECORD — no stock moves", () => {
  it("the body takes a site instead of a warehouse — exactly one of the two", () => {
    expect(manualReceiptBody.safeParse(body({ warehouseId: undefined, siteId: "site_malqa" })).success).toBe(true)
    expect(manualReceiptBody.safeParse(body({ siteId: "site_malqa" })).success).toBe(false)
    expect(manualReceiptBody.safeParse(body({ warehouseId: undefined })).success).toBe(false)
  })

  it("records it at the site: no warehouse, no draft, no stock, the site's name kept for the drawer, the print and the export", async () => {
    const r = await createManualReceipt(asDb, buyer, manualReceiptBody.parse(body({ warehouseId: undefined, siteId: "site_malqa" })), NOW)
    expect(r).toMatchObject({ draft: false, stockLanded: false })
    expect(doc(r.deliveryId)).toMatchObject({ source: "manual", warehouseId: null, landedWarehouseId: null, deliverySiteId: "site_malqa", deliverySiteName: "فيلا الملقا", recordOnly: true })
    expect(doc(r.deliveryId)).not.toHaveProperty("manualDraft")
    expect(mockDb.list("warehouses/wh-main/inventoryItems")).toHaveLength(0)
    const d = { id: r.deliveryId, ...doc(r.deliveryId) } as unknown as DeskDelivery
    const words = { recordedIn: { procurement: "المشتريات", projects: "المشاريع", inventory: "المخزون" }, kind: { manual: "يدوي", noNotice: "بلا إشعار", receipt: "سند" }, noPo: "بلا أمر" } as never
    expect(exportRows([d], [], () => "", words, false)[0]).toContain("فيلا الملقا")
  })

  it("a retired or unknown site is refused; a stored site that IS a store is that store", async () => {
    await expect(createManualReceipt(asDb, buyer, manualReceiptBody.parse(body({ warehouseId: undefined, siteId: "site_old" })), NOW)).rejects.toBeInstanceOf(ManualReceiptRefusal)
    await expect(createManualReceipt(asDb, buyer, manualReceiptBody.parse(body({ warehouseId: undefined, siteId: "nowhere" })), NOW)).rejects.toMatchObject({ code: "site_missing" })
    const r = await createManualReceipt(asDb, buyer, manualReceiptBody.parse(body({ warehouseId: undefined, siteId: "wh_wh-main" })), NOW)
    expect(doc(r.deliveryId)).toMatchObject({ warehouseId: "wh-main", manualDraft: { state: "draft" } })
  })

  it("the picker lists the central store first, every live site (a site with no store as a record place), and stores no site names", () => {
    const places = manualPlaces({
      sites: [
        { id: "site_malqa", kind: "site", name: "فيلا الملقا" },
        { id: "site_old", kind: "site", name: "موقع قديم", retired: true },
        { id: "prj_p1", kind: "project", name: "برج النخيل", projectId: "p1" },
        { id: "ws", kind: "workshop", name: "مستودع الورشة" },
      ],
      warehouses: [
        { id: "wh-p1", name: "مستودع البرج", projectId: "p1" },
        { id: "wh-legacy", name: "مستودع قديم", projectId: null },
      ],
      orgId: ORG,
      centralName: "المستودع المركزي",
      mfgOn: false,
    })
    expect(places.map((p) => [p.id, p.warehouseId, p.siteId])).toEqual([
      ["wh_central_org1", "central_org1", null],
      ["site_malqa", null, "site_malqa"],
      ["prj_p1", "wh-p1", null],
      ["wh_wh-legacy", "wh-legacy", null],
    ])
  })

  it("the form sends the picked place: its store when it has one, else its site", () => {
    const v: ManualReceiptValues = { supplierName: "محل", supplierOrgId: "", deliveryDate: "2026-10-20", warehouseId: "site_malqa", invoiceNumber: "", invoiceValue: "", after: "cash", notes: "", rows: [{ inventoryItemId: "", itemName: "مسامير", quantity: "10", unit: "", unitPrice: "" }] }
    const site = { id: "site_malqa", name: "فيلا الملقا", warehouseId: null, siteId: "site_malqa", projectId: null, kind: "site" as const }
    expect(manualFormToBody(v, [], { seesPrices: false, unitDefault: "وحدة", place: site })).toMatchObject({ siteId: "site_malqa" })
    expect(manualFormToBody(v, [], { seesPrices: false, unitDefault: "وحدة", place: site })).not.toHaveProperty("warehouseId")
    expect(manualFormToBody(v, [], { seesPrices: false, unitDefault: "وحدة", place: { ...site, warehouseId: "wh-p1", siteId: null } })).toMatchObject({ warehouseId: "wh-p1" })
  })

  it("«أين ذهب أثر السند» says it is a record only", () => {
    expect(receiptEffects({ dest: null, workshop: false, pmOn: false, mfgOn: false, finOn: false, recordOnly: true }).map((e) => e.key)).toEqual(["core", "site", "fin_off"])
    expect(receiptEffects({ dest: null, workshop: false, pmOn: false, mfgOn: false, finOn: false }).map((e) => e.key)).toEqual(["core", "fin_off"])
  })
})

describe("RC-03: the manual row is the material row — it carries the tree's material, and its price joins the history as «يدوي»", () => {
  it("stores the material, its specification key and the invoice's words on the items and lines", async () => {
    const r = await createManualReceipt(asDb, buyer, manualReceiptBody.parse(body()), NOW)
    const d = doc(r.deliveryId) as { items: Array<Record<string, unknown>>; lines: Array<Record<string, unknown>> }
    expect(d.items[0]).toMatchObject({ name: "بلوك أسمنتي", material: { nodeId: "blk-20" }, materialId: "blk-20", invoiceName: "بلك ٢٠" })
    expect(String(d.items[0].specKey)).toMatch(/^spec:blk-20\|/)
    expect(d.lines[0]).toMatchObject({ materialId: "blk-20", specKey: d.items[0].specKey })
  })

  it("writes one «manual» price row per priced line, keyed by the receipt's line (a retry overwrites it)", async () => {
    const r = await createManualReceipt(asDb, buyer, manualReceiptBody.parse(body({ items: [...body().items, { name: "مسامير", quantity: 5, unit: "كجم", unitPrice: null }] })), NOW)
    const rows = mockDb.list("priceHistory")
    expect(rows).toHaveLength(1)
    expect(mockDb.get(`priceHistory/${r.deliveryId}__i1`)).toMatchObject({ organizationId: ORG, kind: "manual", price: 3.5, day: "2026-10-20", supplierName: "محل الحي", receiptId: r.deliveryId, receiptNumber: r.docNumber, materialKey: materialKey("بلوك أسمنتي", "حبة") })
  })

  it("the price history reads a manual row as its own source, a price we paid, named by its receipt", () => {
    const h: PriceHistoryEntry = { id: "d1__i1", organizationId: ORG, materialKey: materialKey("بلوك", "حبة"), name: "بلوك", unit: "حبة", supplierOrgId: "", supplierName: "محل الحي", price: 3.5, day: "2026-10-20", kind: "manual", poId: null, poNumber: null, receiptId: "d1", receiptNumber: "GR-2026/004" }
    expect(priceSeries(materialKey("بلوك", "حبة"), { history: [h] })).toEqual([expect.objectContaining({ source: "manual", awarded: true, price: 3.5, poNo: "GR-2026/004", receiptId: "d1", supplierKey: "محل الحي" })])
  })
})

describe("RC-05: the desk narrows to one delivery site, in every package", () => {
  const po = (id: string, site: string | null, projectId: string | null = null) => ({ id, docNumber: `PO-2026/0${id}`, projectId, site: site ? { id: site, name: site } : null, lines: [], supplierName: "س" }) as unknown as PurchaseOrder
  const rec = (id: string, over: Partial<DeskDelivery>) => ({ id, status: "confirmed", docNumber: `GR-2026/0${id}`, confirmedAt: "2026-10-20T08:00:00Z", lines: [], ...over }) as DeskDelivery
  const orders = [po("1", "site_malqa"), po("2", null, "p1")]
  const desk = [
    rec("a", { poId: "1" }),
    rec("b", { poId: "2" }),
    rec("c", { source: "manual", deliverySiteId: "site_malqa", deliverySiteName: "فيلا الملقا" }),
    rec("d", { source: "manual", landedWarehouseId: "wh-main" }),
  ]
  const malqa = siteFilterOf({ id: "site_malqa" }, [])
  const project = siteFilterOf({ id: "prj_p1", projectId: "p1" }, [{ id: "wh-p1", projectId: "p1" }])
  const main = siteFilterOf({ id: "wh_wh-main", warehouseId: "wh-main" }, [])

  it("an order's frozen site, a manual receipt's site, a store and a project each find their receipts", () => {
    expect(desk.filter((d) => siteMatches(d, orders.find((o) => o.id === d.poId) || null, malqa)).map((d) => d.id)).toEqual(["a", "c"])
    expect(desk.filter((d) => siteMatches(d, orders.find((o) => o.id === d.poId) || null, project)).map((d) => d.id)).toEqual(["b"])
    expect(desk.filter((d) => siteMatches(d, orders.find((o) => o.id === d.poId) || null, main)).map((d) => d.id)).toEqual(["d"])
    expect(project.warehouseIds).toEqual(["wh-p1"])
  })

  it("the rows and the segment counts follow the site filter", () => {
    const f = { term: "", projectId: null, site: malqa }
    const recs = receiptRows(desk, orders, "recs", NOW).filter((r) => receiptRowMatches(r, f)).map((r) => r.delivery.id)
    const nopo = receiptRows(desk, orders, "nopo", NOW).filter((r) => receiptRowMatches(r, f)).map((r) => r.delivery.id)
    expect([...recs, ...nopo].sort()).toEqual(["a", "c"])
    const counts = segmentCounts(desk, orders, f, NOW)
    expect(counts.recs + counts.nopo).toBe(2)
  })
})

describe("RC-06: the receiver's page says where the goods go, when, and for whom", () => {
  it("the order's frozen site first — its name, city and district, its map link; else the store or the project", () => {
    expect(receivePlace({ site: { name: "فيلا الملقا", city: "الرياض", district: "الملقا", mapUrl: "https://maps.example/x" }, warehouse: { name: "المركزي" } })).toEqual({ placeName: "فيلا الملقا", address: "الرياض — الملقا", mapUrl: "https://maps.example/x" })
    expect(receivePlace({ site: null, warehouse: { name: "مستودع البرج", location: "حي الياسمين" } })).toEqual({ placeName: "مستودع البرج", address: "حي الياسمين", mapUrl: null })
    expect(receivePlace({ site: { name: "س", mapUrl: "javascript:alert(1)" } }).mapUrl).toBeNull()
  })

  it("the notice's number when its ordinal is stored, and the company's name from its own identity", () => {
    expect(receiveNoticeNumber("PO-2026/021", 2)).toBe("ASN-2026/021-2")
    expect(receiveNoticeNumber("PO-2026/021", null)).toBeNull()
    expect(buyerCompanyName({ companyName: "الفرع الثاني" }, { companyName: "شركة البناء" })).toBe("الفرع الثاني")
    expect(buyerCompanyName(null, { companyName: "شركة البناء" })).toBe("شركة البناء")
  })
})

describe("SP-04: two initials from the meaningful words", () => {
  it("skips «مصنع/مؤسسة/شركة» and the article", () => {
    expect(supplierInitials("مصنع الجودة للخرسانة")).toBe("جخ")
    expect(supplierInitials("مؤسسة البناء السريع")).toBe("بس")
    expect(supplierInitials("شركة الراجحي")).toBe("ر")
    expect(supplierInitials("Gulf Steel Co.")).toBe("GS")
    expect(supplierInitials("مصنع")).toBe("مص")
    expect(supplierInitials("")).toBe("—")
  })
})

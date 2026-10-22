/** @jest-environment node */
/**
 * Procurement 2.0 — the delivery notice is a DATE and a NOTE everywhere (G-08, decision 08, WP-S4-11 / WP-S5-02): the registered
 * supplier's route, the buyer recording what a phone call said, the order link and the old guest-offer action all go through one
 * core that numbers the notice per order (two trucks in a day are two notices — REP1, REP2) and refuses any quantity, driver,
 * plate or paper. Old notices that still carry quantities keep rendering.
 */

import fs from "node:fs"
import path from "node:path"
import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCallers: Record<string, unknown> = {}

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => (t === "bad" ? Promise.reject(new Error("bad")) : { uid: t }) }),
  getAdminFirestore: () => mockDb,
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: async (_db: unknown, uid: string) => mockCallers[uid] ?? null }))

import { POST as supplierNotice } from "@/app/api/procurement/notice/route"
import { POST as recordNotice } from "@/app/api/procurement/record-notice/route"
import { linesForReceipt } from "@/lib/procurement/receipts"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/021",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد",
  offerId: "o1",
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
  totalExVat: 30000,
  vatRate: 0.15,
  preparedById: "prep",
  preparedByName: "سعد",
  createdAt: "2026-10-10T08:00:00Z",
  approverKind: "manager",
  approvedAt: "2026-10-11T08:00:00Z",
  sentAt: "2026-10-12T08:00:00Z",
  supplierAcceptedAt: "2026-10-13T08:00:00Z",
  promisedDate: "2026-10-30",
  log: [],
  ...over,
})
const day = (offset: number) => new Date(Date.now() + 3 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10)

const call = async (route: (r: NextRequest) => Promise<Response>, user: string, body: unknown) => {
  const res = await route(new NextRequest("http://localhost/api/procurement/x", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
  return { status: res.status, json: (await res.json()) as { data?: { deliveryId: string; seq: number }; code?: string } }
}
const notices = () => mockDb.list("deliveries")

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  for (const k of Object.keys(mockCallers)) delete mockCallers[k]
  Object.assign(mockCallers, {
    su1: { uid: "su1", orgId: "sup1", name: "سامر", can: () => true },
    other: { uid: "other", orgId: "sup9", name: "آخر", can: () => true },
    clerk: { uid: "clerk", orgId: ORG, name: "ريم", can: (p: string) => p === "po.expedite" },
    nobody: { uid: "nobody", orgId: ORG, name: "قارئ", can: () => false },
  })
  mockDb.seed("purchaseOrders/po1", order())
})

describe("the registered supplier's notice", () => {
  it("is a day and a note: stored beside the order, numbered 1 then 2 on the same day, with the REP events", async () => {
    const a = await call(supplierNotice, "su1", { poId: "po1", deliveryDate: day(0), note: "شاحنة أولى" })
    const b = await call(supplierNotice, "su1", { poId: "po1", deliveryDate: day(0) })
    expect([a.status, a.json.data?.seq, b.status, b.json.data?.seq]).toEqual([200, 1, 200, 2])
    expect(notices().map((n) => [n.seq, n.reportedBy, n.status, n.notes ?? null])).toEqual([[1, "supplier", "pending_confirmation", "شاحنة أولى"], [2, "supplier", "pending_confirmation", null]])
    expect(mockDb.list("procEvents").map((e) => e.key).sort()).toEqual(["proc:PO:PO-2026/021:REP1", "proc:PO:PO-2026/021:REP2"])
    expect((mockDb.get("purchaseOrders/po1") as { noticeSeq: number }).noticeSeq).toBe(2)
    expect(mockDb.list("users/prep/notifications").map((n) => n.type)).toEqual(["delivery_notice", "delivery_notice"])
  })

  it("refuses every quantity-like key (G-08), a past day, an unaccepted order and another supplier's order", async () => {
    for (const extra of [{ lines: [{ poLineId: "l1", quantity: 5 }] }, { quantity: 5 }, { driverName: "سالم" }, { vehiclePlate: "ABC" }, { qualityPapers: ["mill"] }, { deliveryWindow: "morning" }]) {
      expect((await call(supplierNotice, "su1", { poId: "po1", deliveryDate: day(0), ...extra })).status).toBe(400)
    }
    expect((await call(supplierNotice, "su1", { poId: "po1", deliveryDate: day(-1) })).json.code).toBe("DATE_PAST")
    mockDb.seed("purchaseOrders/po2", order({ status: "sent", supplierAcceptedAt: null }))
    expect((await call(supplierNotice, "su1", { poId: "po2", deliveryDate: day(0) })).json.code).toBe("NOT_ACCEPTED")
    expect((await call(supplierNotice, "other", { poId: "po1", deliveryDate: day(0) })).status).toBe(403)
    expect(notices()).toHaveLength(0)
  })
})

describe("the buyer recording what a phone call said (an off-platform supplier)", () => {
  beforeEach(() => mockDb.seed("purchaseOrders/po1", order({ supplierOrgId: "guest", supplierUserId: null, isGuestSupplier: true })))

  it("writes the same notice, marked on his behalf, to be forwarded like any notice", async () => {
    const res = await call(recordNotice, "clerk", { poId: "po1", deliveryDate: day(1), note: "اتصل السائق" })
    expect(res.status).toBe(200)
    expect(notices()[0]).toMatchObject({ reportedBy: "onBehalf", isGuestDelivery: true, status: "pending_confirmation", seq: 1, recordedOnBehalf: { byId: "clerk" } })
  })

  it("takes no lines, no driver; a member who follows no orders is refused; a registered supplier sends his own", async () => {
    expect((await call(recordNotice, "clerk", { poId: "po1", deliveryDate: day(0), lines: [{ poLineId: "l1", quantity: 5 }] })).status).toBe(400)
    expect((await call(recordNotice, "clerk", { poId: "po1", deliveryDate: day(0), driverName: "سالم" })).status).toBe(400)
    expect((await call(recordNotice, "nobody", { poId: "po1", deliveryDate: day(0) })).status).toBe(403)
    mockDb.seed("purchaseOrders/po3", order())
    expect((await call(recordNotice, "clerk", { poId: "po3", deliveryDate: day(0) })).json.code).toBe("SUPPLIER_ON_PLATFORM")
  })
})

describe("old notices still render", () => {
  it("a notice with no lines takes the order's open lines with no notice figure; a legacy one keeps its quantities", () => {
    const po = order() as unknown as PurchaseOrder
    expect(linesForReceipt({}, po)).toEqual([{ poLineId: "l1", name: "حديد", unit: "طن", noticeQuantity: 0 }])
    expect(linesForReceipt({ lines: [{ poLineId: "l1", name: "حديد", unit: "طن", noticeQuantity: 6 }] }, po)[0].noticeQuantity).toBe(6)
  })
})

describe("G-08 — no writer of a supplier notice carries goods", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")
  const FORBIDDEN = /driverName|driverPhone|vehiclePlate|qualityPapers|paperNoteNumber|deliveryWindow|noticeQuantity|defaultNoticeLines|noticeDeliveryLines/

  it.each([
    "src/app/api/procurement/notice/route.ts",
    "src/app/api/procurement/record-notice/route.ts",
    "src/lib/procurement/notice-server.ts",
    "src/components/procurement/RecordNoticeDialog.tsx",
    "src/lib/procurement/supplier.ts",
  ])("%s", (file) => {
    const code = read(file)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n")
    expect(code).not.toMatch(FORBIDDEN)
  })

  it("the supplier's page and the guest-offer action send a day and a note only", () => {
    const page = read("src/app/[locale]/(supplier)/supplier/orders/page.tsx")
    expect(page).not.toMatch(/driverName|vehiclePlate|qualityPapers|paperNoteNumber|deliveryWindow|defaultNoticeLines|buildDeliveryNotice\(/)
    const action = read("src/app/api/guest-offer/[token]/action/route.ts")
    const notice = action.slice(action.indexOf("// --- Delivery notice on an awarded offer ---"))
    expect(notice).not.toMatch(/driverName|deliveryPersonName(?!: null)|items: Array|rfq\??\.products|handoverRecipientName(?!: null)/)
  })
})

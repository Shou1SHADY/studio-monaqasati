/** @jest-environment node */
/**
 * Procurement 2.0 — «صدّر سندات الاستلام» (RCV-06, WP-S5-03a): a table for a period and a location (Excel or CSV), and a zip with one
 * print-ready document per receipt and — when asked — the receipts' own attachments in a folder each. Without Finance it can be sent to the
 * accountant's address. The table carries no money for a reader who does not see prices.
 */

import { NextRequest } from "next/server"
import { unzipSync, strFromU8 } from "fflate"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const sent: Array<{ to: string; subject: string; attachments?: Array<{ filename: string; content: string }> }> = []
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({}),
  getStorageBucketName: () => "b",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
jest.mock("@/lib/email", () => ({ sendEmail: async (m: { to: string; subject: string; attachments?: Array<{ filename: string; content: string }> }) => (sent.push(m), { sent: true }) }))

import { POST as exportRoute } from "@/app/api/procurement/receipt-export/route"
import {
  ALL_PLACES,
  attachmentUrlsOf,
  defaultPeriod,
  exportColumns,
  exportCounts,
  exportCsv,
  exportMatrix,
  exportRows,
  exportedReceipts,
  receiptsZip,
  voucherFile,
  type ExportWords,
} from "@/lib/procurement/receipt-export"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import type { PurchaseOrder } from "@/lib/procurement/types"

const ORG = "org1"
const words: ExportWords = {
  headers: { receipt: "R", date: "D", supplier: "S", po: "PO", material: "M", unit: "U", counted: "C", accepted: "A", rejected: "X", reason: "WHY", place: "P", receiver: "RC", recordedIn: "IN", invoice_no: "INV", invoice_value: "VAL", kind: "K" },
  recordedIn: { procurement: "Procurement", inventory: "Inventory", projects: "Projects" },
  kind: { receipt: "receipt", manual: "manual", noNotice: "no notice" },
  reasons: (c) => `reason:${c}`,
  noPo: "no PO",
}
const place = (id: string) => ({ "wh-a": "Store A", "wh-b": "Store B" })[id] || ""

const rcpt = (id: string, over: Record<string, unknown> = {}): DeskDelivery =>
  ({
    id,
    status: "confirmed",
    docNumber: `GR-2026/00${id.slice(-1)}`,
    poId: "po1",
    poNumber: "PO-2026/021",
    supplierName: "مصنع الجودة",
    receivedByName: "سامي",
    confirmedAt: "2026-10-12T09:00:00Z",
    landedWarehouseId: "wh-a",
    receiverModule: "inventory",
    lines: [{ poLineId: "l1", name: "حديد 12 مم", unit: "طن", noticeQuantity: 0, counted: 3, rejected: 1, rejectReason: "damaged", accepted: 2 }],
    ...over,
  }) as DeskDelivery
const all = [
  rcpt("r1"),
  rcpt("r2", { confirmedAt: "2026-10-15T09:00:00Z", landedWarehouseId: "wh-b", noNotice: true }),
  rcpt("r3", { confirmedAt: "2026-09-30T09:00:00Z" }),
  rcpt("r4", { confirmedAt: "2026-10-16T09:00:00Z", source: "manual", poId: null, poNumber: null, supplierName: "محل الحي", items: [{ name: "مسامير", quantity: 5, unit: "كجم" }], lines: [], invoiceNumber: "INV-9", invoiceValue: 250 }),
  { ...rcpt("p1"), status: "pending_confirmation" } as DeskDelivery,
]
const orders = [{ id: "po1", docNumber: "PO-2026/021", supplierName: "مصنع الجودة", lines: [] } as unknown as PurchaseOrder]

describe("the period and the location", () => {
  it("takes confirmed receipts inside the period (both ends), oldest first; a location narrows it; a pending notice is never a receipt", () => {
    const oct = { from: "2026-10-01", to: "2026-10-31", place: ALL_PLACES }
    expect(exportedReceipts(all, oct).map((d) => d.id)).toEqual(["r1", "r2", "r4"])
    expect(exportedReceipts(all, { ...oct, place: "wh-b" }).map((d) => d.id)).toEqual(["r2"])
    expect(exportedReceipts(all, { from: "2026-09-30", to: "2026-10-12", place: ALL_PLACES }).map((d) => d.id)).toEqual(["r3", "r1"])
    expect(exportCounts(all, oct)).toEqual({ total: 3, manual: 1 })
    expect(exportCounts(all, { ...oct, from: "2026-11-01", to: "2026-11-02" })).toEqual({ total: 0, manual: 0 })
  })

  it("opens on the Riyadh month so far", () => {
    expect(defaultPeriod(new Date("2026-10-21T22:30:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-22" })
  })
})

describe("the table", () => {
  const chosen = exportedReceipts(all, { from: "2026-10-01", to: "2026-10-31", place: ALL_PLACES })

  it("one row per receipt line, fixed columns; a reader who sees no prices gets no invoice value column", () => {
    const rows = exportRows(chosen, orders, place, words, false)
    const matrix = exportMatrix(rows, words, false)
    expect(matrix[0]).toEqual(exportColumns(false).map((c) => words.headers[c]))
    expect(matrix[0]).not.toContain("VAL")
    expect(matrix[1]).toEqual(["GR-2026/001", "2026-10-12", "مصنع الجودة", "PO-2026/021", "حديد 12 مم", "طن", "3", "2", "1", "reason:damaged", "Store A", "سامي", "Inventory", "", "receipt"])
    expect(JSON.stringify(matrix)).not.toContain("250")
  })

  it("a price reader also gets a manual receipt's invoice number and value; a manual row is tagged and sits under no PO", () => {
    const matrix = exportMatrix(exportRows(chosen, orders, place, words, true), words, true)
    expect(matrix[0]).toContain("VAL")
    const manual = matrix.find((r) => r.includes("manual"))
    expect(manual).toEqual(expect.arrayContaining(["GR-2026/004", "محل الحي", "no PO", "Procurement", "INV-9", "250", "manual"]))
    expect(matrix.find((r) => r.includes("no notice"))).toBeTruthy()
  })

  it("CSV is UTF-8 with a BOM, every cell quoted, quotes doubled", () => {
    const csv = exportCsv([["a", 'he said "hi"'], ["1", "2"]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('"a","he said ""hi"""\r\n"1","2"')
  })
})

describe("the zip", () => {
  it("holds the table, one document per receipt and the attachments in a folder named for the receipt", () => {
    expect(voucherFile("GR-2026/031", "x")).toBe("GR-2026-031")
    expect(voucherFile(null, "abcdef123456")).toBe("DEL-abcdef12")
    const bytes = receiptsZip({
      table: { filename: "receipts.xlsx", bytes: new Uint8Array([1, 2, 3]) },
      documents: [{ name: "GR-2026-001", html: "<html>ا.س</html>" }],
      attachments: [{ path: "GR-2026-001/1.jpg", bytes: new Uint8Array([9]) }],
    })
    const files = unzipSync(bytes)
    expect(Object.keys(files).sort()).toEqual(["GR-2026-001.html", "GR-2026-001/1.jpg", "receipts.xlsx"])
    expect(strFromU8(files["GR-2026-001.html"])).toBe("<html>ا.س</html>")
  })

  it("a receipt's attachments are its own files and the ones the receiver attached, once each", () => {
    expect(attachmentUrlsOf({ attachmentUrls: ["u1", "u2"], receiverReport: { files: [{ name: "n", url: "u2", kind: "photo" }, { name: "m", url: "u3", kind: "ticket" }] } as never })).toEqual(["u1", "u2", "u3"])
  })
})

describe("the route", () => {
  const OWN = "https://firebasestorage.googleapis.com/v0/b/b/o/receipts%2Fr1.jpg?alt=media"
  const post = async (user: string, payload: unknown) => {
    const res = await exportRoute(new NextRequest("http://localhost/api/procurement/receipt-export", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(payload) }))
    return res
  }
  beforeEach(() => {
    mockDb.docs.clear()
    sent.length = 0
    mockDb.seed("users/org1", { organizationId: ORG, companyName: "شركة المقاول", name: "المالك" })
    mockDb.seed("users/exp", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-exp", name: "ريم" })
    mockDb.seed("users/none", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-none" })
    mockDb.seed("teamGroups/g-exp", { organizationId: ORG, permissions: ["po.expedite"] })
    mockDb.seed("teamGroups/g-none", { organizationId: ORG, permissions: ["rfq.create"] })
    mockDb.seed("deliveries/r1", { contractorOrgId: ORG, status: "confirmed", docNumber: "GR-2026/001", attachmentUrls: [OWN, "https://evil.example/x.jpg"] })
    mockDb.seed("deliveries/x1", { contractorOrgId: "other", status: "confirmed", docNumber: "GR-2026/009", attachmentUrls: [OWN] })
    global.fetch = jest.fn(async () => new Response(new Uint8Array([7, 7]), { status: 200 })) as never
  })

  it("adds each own receipt's attachments from the receipt itself (never an address the browser names), skips another company's receipt", async () => {
    const res = await post("exp", {
      action: "zip",
      ids: ["r1", "x1"],
      documents: [
        { id: "r1", name: "GR-2026-001", html: "<p>1</p>" },
        { id: "x1", name: "GR-2026-009", html: "<p>9</p>" },
      ],
      table: { filename: "receipts.csv", base64: Buffer.from("a,b").toString("base64") },
      withFiles: true,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/zip")
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(["GR-2026-001.html", "GR-2026-001/1.jpg", "receipts.csv"])
    expect((global.fetch as jest.Mock).mock.calls.map((c) => c[0])).toEqual([OWN])
  })

  it("without the attachments nothing is fetched; a member with no follow-up permission is refused", async () => {
    const ok = await post("exp", { action: "zip", ids: ["r1"], documents: [{ id: "r1", name: "GR-2026-001", html: "<p>1</p>" }], withFiles: false })
    expect(Object.keys(unzipSync(new Uint8Array(await ok.arrayBuffer())))).toEqual(["GR-2026-001.html"])
    expect(global.fetch).not.toHaveBeenCalled()
    expect((await post("none", { action: "zip", ids: ["r1"], documents: [], withFiles: false })).status).toBe(403)
  })

  it("«أرسله إلى المحاسب»: only without Finance, and with an address set in the policies", async () => {
    const body = { action: "send", filename: "receipts-2026-10-01_2026-10-31.xlsx", base64: "AAAA", period: "2026-10-01 → 2026-10-31" }
    expect(((await post("exp", body).then((r) => r.json())) as { code: string }).code).toBe("FINANCE_ON")
    mockDb.seed("companyModules/org1", { off: ["payments"] })
    expect(((await post("exp", body).then((r) => r.json())) as { code: string }).code).toBe("NO_ACCOUNTANT")
    mockDb.seed("procurementSettings/org1", { accountantEmail: "acc@firm.sa" })
    const ok = await post("exp", body)
    expect(ok.status).toBe(200)
    expect(sent).toEqual([expect.objectContaining({ to: "acc@firm.sa", attachments: [{ filename: body.filename, content: "AAAA" }] })])
  })
})

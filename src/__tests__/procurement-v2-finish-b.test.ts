/** @jest-environment node */
/**
 * Procurement 2.0 finish pass, group B — the order and receiving side: the next step's detail lines, the receipt's
 * connector effects per package state, the printed receipt's banners and the three lines, the trail's owners, the
 * receiver's «where it goes» line, the accounting export with the invoice files, and the prototype's words.
 */

import { NextRequest } from "next/server"
import { unzipSync } from "fflate"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => ({ uid: t }) }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({}),
  getStorageBucketName: () => "b",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
jest.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }))

import { POST as exportRoute } from "@/app/api/procurement/receipt-export/route"
import { GET as receiptLinkRoute } from "@/app/api/receipt-links/[token]/route"
import { receiptEffects } from "@/lib/procurement/receipt-effects"
import { deliveryStep } from "@/lib/procurement/next-step"
import { asX, docTrail } from "@/lib/procurement/po-extras"
import { accountantExport } from "@/lib/procurement/accountant-export"
import { buildReceiptPrintHtml, type ReceiptPrintInput } from "@/lib/procurement/receipt-print"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import type { PurchaseOrder } from "@/lib/procurement/types"

const at = (root: unknown, path: string): string => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], root) as string

describe("the receipt's effect in each module (grnFx)", () => {
  const on = { dest: "inv" as const, workshop: false, pmOn: true, mfgOn: true, finOn: true }
  it("Procurement always; Inventory where the goods landed in a store; Finance's second match leg with Finance", () => {
    expect(receiptEffects(on).map((e) => e.key)).toEqual(["core", "inv", "fin"])
  })
  it("a project's store tells Projects only while Projects is in the package", () => {
    expect(receiptEffects({ ...on, dest: "prj" }).map((e) => e.key)).toEqual(["core", "pm", "fin"])
    expect(receiptEffects({ ...on, dest: "prj", pmOn: false }).map((e) => e.key)).toEqual(["core", "fin"])
  })
  it("a workshop purchase reaches the workshop store only with Manufacturing; no Finance means the accounting export", () => {
    expect(receiptEffects({ ...on, workshop: true }).map((e) => e.key)).toEqual(["core", "mfg", "fin"])
    expect(receiptEffects({ ...on, workshop: true, mfgOn: false, finOn: false }).map((e) => e.key)).toEqual(["core", "fin_off"])
    expect(receiptEffects({ ...on, finOn: false }).at(-1)).toEqual({ module: "core", key: "fin_off" })
  })
})

describe("the next step's detail lines", () => {
  const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
    ({ id: "po1", status: "accepted", promisedDate: "2026-11-05", isGuestSupplier: false, supplierName: "x", lines: [{ id: "l1", name: "h", unit: "t", quantity: 10, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], ...over }) as unknown as PurchaseOrder
  it("a notice forwarded by the system says so, one forwarded by hand says when", () => {
    const now = new Date("2026-10-19T09:00:00Z")
    const base = { id: "d1", poId: "po1", status: "pending_confirmation" as const, deliveryDate: "2026-11-05" }
    expect(deliveryStep(po(), [{ ...base, forwardedTo: { name: "A", auto: true, at: "2026-10-18T07:00:00Z" } }], now)).toMatchObject({ kind: "in_transit", auto: true, forwardedDay: "2026-10-18" })
    expect(deliveryStep(po(), [{ ...base, forwardedTo: { name: "A", at: "2026-10-17T07:00:00Z" } }], now)).toMatchObject({ kind: "in_transit", auto: false, forwardedDay: "2026-10-17" })
  })
})

describe("the document trail names who owns what is still to come", () => {
  const order = (over: Record<string, unknown> = {}) => asX({ id: "po1", status: "accepted", createdAt: "2026-10-01", preparedByName: "B", lines: [], ...over } as unknown as PurchaseOrder)
  it("without Finance the last step is the optional payment status, not Finance's invoice", () => {
    const noFin = docTrail(order(), [], false).map((s) => s.key)
    expect(noFin.at(-1)).toBe("payment")
    expect(noFin).not.toContain("invoice")
    expect(docTrail(order(), [], true).map((s) => s.key)).not.toContain("payment")
  })
  it("a payment marked paid closes that step", () => {
    const paid = docTrail(order({ paymentMark: { state: "paid", day: "2026-10-12" } }), [], false).find((s) => s.key === "payment")
    expect(paid).toMatchObject({ state: "ok", at: "2026-10-12" })
  })
})

describe("the printed receipt (the prototype's grnDocHTML)", () => {
  const t = (k: string, p?: Record<string, string | number>) => `[${k}${p ? `:${Object.values(p).join(",")}` : ""}]`
  const input = (d: Partial<DeskDelivery> = {}, withPo = true): ReceiptPrintInput => ({
    delivery: { id: "r1", status: "confirmed", docNumber: "GR-2026/001", poId: withPo ? "po1" : null, poNumber: "PO-1", supplierName: "المورد", receivedByName: "سامي", confirmedAt: "2026-10-21T08:30:00Z", deliveryDate: "2026-10-20", confirmedVia: "login", lines: [{ poLineId: "l1", name: "حديد", unit: "طن", noticeQuantity: 0, counted: 3, rejected: 0, accepted: 3 }], ...d } as DeskDelivery,
    po: withPo ? ({ id: "po1", supplierName: "المورد", preparedByName: "المشتري", lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 3, accepted: 3, rejected: 0, held: 0, cancelled: 0, unitPrice: 10 }] } as unknown as PurchaseOrder) : null,
    company: { name: "شركة" },
    placeName: "مستودع",
    projectName: null,
    displayNumber: "1",
    displayPoNumber: "1",
    withPrices: true,
    locale: "ar",
    t,
    tp: t,
    now: new Date("2026-10-22T00:00:00Z"),
  })
  it("matched in full: «received as ordered» then the final record; with a rejection: the rejection's banner leads", () => {
    expect(buildReceiptPrintHtml(input())).toContain("[status_matched] — [status_final]")
    const rej = buildReceiptPrintHtml(input({ lines: [{ poLineId: "l1", name: "حديد", unit: "طن", noticeQuantity: 0, counted: 3, rejected: 1, rejectReason: "damaged", accepted: 2 }] as DeskDelivery["lines"] }))
    expect(rej).toContain("[status_rejected]")
    expect(rej).not.toContain("[status_matched]")
  })
  it("the three lines: the receiver, the buyer who reviewed it, the supplier who gets a copy — and the confirmation is the signature", () => {
    const html = buildReceiptPrintHtml(input())
    expect(html).toContain("[sig_confirmed]")
    expect(html).toContain("[sig_buyer]")
    expect(html).toContain("المشتري")
    expect(html).toContain("[sig_reviewed]")
    expect(html).toContain("[sig_copy]")
    expect(html).toContain("[no_signature_note]")
  })
  it("a manual receipt: supplier notice / invoice names what comes next; the typed invoice value is printed", () => {
    const manual = { source: "manual", after: "later", invoiceNumber: "INV-9", invoiceValue: 250, items: [{ name: "مسامير", quantity: 5, unit: "كجم" }], lines: [] } as Partial<DeskDelivery>
    const later = buildReceiptPrintHtml(input(manual, false))
    expect(later).toContain("[notice_or_invoice]")
    expect(later).toContain("INV-9")
    expect(later).toContain("[after_later]")
    expect(later).toContain("[invoice_as_received]")
    expect(later).toContain("250")
    expect(buildReceiptPrintHtml(input({ ...manual, after: "cash" }, false))).toContain("[after_cash]")
  })
})

describe("the accounting export carries the ids of its orders", () => {
  it("poIds are the approved orders of the period, in the export's order", () => {
    const po = (id: string, no: string, approvedAt: string) => ({ id, docNumber: no, status: "accepted", approvedAt, supplierName: "s", totalExVat: 100, vatRate: 0.15, lines: [] }) as never
    const r = accountantExport([po("b", "PO-2", "2026-10-05"), po("a", "PO-1", "2026-10-04"), po("z", "PO-9", "2026-09-01")], [], { from: "2026-10-01", to: "2026-10-31" }, (s) => s)
    expect(r.poIds).toEqual(["a", "b"])
  })
})

describe("the routes", () => {
  const OWN = "https://firebasestorage.googleapis.com/v0/b/b/o/inv%2Fa.pdf?alt=media"
  const post = (user: string, payload: unknown) => exportRoute(new NextRequest("http://localhost/api/procurement/receipt-export", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(payload) }))
  beforeEach(() => {
    mockDb.docs.clear()
    mockDb.seed("users/org1", { organizationId: "org1", name: "المالك" })
    mockDb.seed("users/none", { organizationId: "org1", organizationRole: "member", defaultGroupId: "g-none" })
    mockDb.seed("teamGroups/g-none", { organizationId: "org1", permissions: ["rfq.create"] })
    mockDb.seed("purchaseOrders/p1", { organizationId: "org1", docNumber: "PO-2026/001", invoiceFiles: [{ url: OWN }, { url: "https://evil.example/x.pdf" }] })
    mockDb.seed("purchaseOrders/p2", { organizationId: "other", docNumber: "PO-2026/009", invoiceFiles: [{ url: OWN }] })
    mockDb.seed("supplierInvoices/i1", { buyerOrgId: "org1", poId: "p1", file: { url: "https://firebasestorage.googleapis.com/v0/b/b/o/inv%2Fb.pdf?alt=media" } })
    global.fetch = jest.fn(async () => new Response(new Uint8Array([7]), { status: 200 })) as never
  })
  it("the invoice zip holds the table and each own order's invoice files — never an address the browser names or another company's order", async () => {
    const res = await post("org1", { action: "invoices", poIds: ["p1", "p2"], table: { filename: "procurement.csv", base64: Buffer.from("a").toString("base64") } })
    expect(res.status).toBe(200)
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(["invoices/PO-2026-001/1.pdf", "invoices/PO-2026-001/2.pdf", "procurement.csv"])
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2)
    expect((await post("none", { action: "invoices", poIds: ["p1"] })).status).toBe(403)
    expect((await post("org1", { action: "invoices", poIds: ["p2"] })).status).toBe(404)
  })

  const token = "a".repeat(64)
  const link = (modulesOff: string[]) => {
    mockDb.seed("companyModules/org1", { off: modulesOff })
    mockDb.seed("receiptLinks/l1", { token, deliveryId: "d1", organizationId: "org1", receiver: { kind: "person", userId: null, name: "سالم", phone: "+966501234567" }, status: "open", createdById: "org1", createdByName: "المالك", createdAt: "2026-10-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" })
    mockDb.seed("deliveries/d1", { contractorOrgId: "org1", status: "pending_confirmation", supplierName: "المورد", projectId: "pj1", lines: [{ poLineId: "l1", name: "حديد", unit: "طن" }] })
    mockDb.seed("projects/pj1", { warehouseId: "wh-pj" })
    mockDb.seed("warehouses/wh-pj", { projectId: "pj1", organizationId: "org1" })
  }
  const where = async () => ((await (await receiptLinkRoute(new NextRequest("http://localhost/api/receipt-links/x"), { params: Promise.resolve({ token }) })).json()) as { data: { where: string } }).data.where
  it("the receiver's page says «charged to the site» when Projects is not in the package, «the project» when it is", async () => {
    link([])
    expect(await where()).toBe("project")
    link(["project-management"])
    expect(await where()).toBe("site")
  })
})

describe("the prototype's words (both languages)", () => {
  const pairs: Array<[string, string, string]> = [
    ["Portal.ProcOrders.next2.in_transit_auto", "حُوّل تلقائياً", "Auto-forwarded"],
    ["Portal.ProcOrders.next2.part_sub", "الباقي عند المورد", "The rest is with the supplier"],
    ["Portal.ProcOrders.next2.rejected_sub", "سجّله المستلم في السند", "Recorded by the receiver in the receipt"],
    ["Portal.ProcOrders.next2.guest_due", "هل وصلت الشحنة؟ المورد خارج المنصة", "Did the shipment arrive? The supplier is off-platform"],
    ["Portal.ProcOrders.next2.call", "اتصل بالمورد", "Call supplier"],
    ["Portal.ProcOrders.next2.to_forward", "وصل إشعار التسليم — حوّله للمستلم", "Delivery notice arrived — forward it to the receiver"],
    ["Portal.ProcOrders.toast.approver_reminded", "ذُكّر مدير المشتريات في «مهامي».", "The procurement manager was reminded in My tasks."],
    ["Portal.ProcOrders.toast.reminded_rest", "ذُكّر المورد بالكمية الباقية.", "The supplier was reminded about the remaining quantity."],
    ["Portal.ProcOrders.toast.finance_reminded", "ذُكّرت المالية بطلب الدفعة المقدّمة.", "Finance was reminded about the advance."],
    ["Portal.ProcOrders.toast.advance_approved", "اعتمدتَ الدفعة المقدّمة، وطُلبت الآن.", "You approved the advance; it is now requested."],
    ["Portal.ProcOrders.toast.reject_replace", "طُلب استبدال المرفوض: يبقى في الأمر حتى يصل البديل.", "Replacement requested: it stays on the order until it arrives."],
    ["Portal.ProcOrders.toast.reject_discount", "طُلب خصم على المرفوض، وأُبلغ المورد.", "A discount was requested; supplier told."],
    ["Portal.ProcOrders.toast.reject_return", "يُرجَع المرفوض للمورد، ويُقفل بنده بالمقبول.", "Returned to the supplier; the line closes at the accepted quantity."],
    ["Portal.ProcOrders.toast.hold_sent", "أُرسل قرار «أوقف صرف فاتورة» للمالية بسببه.", "“Hold an invoice” was sent to Finance with its reason."],
    ["Portal.ProcOrders.toast.closed_short", "أُقفل الأمر ناقصاً بما استُلم، وأُبلغ المورد والمشروع.", "Closed short at what was received; supplier and project told."],
    ["Portal.ProcOrders.pay.order_closed", "الأمر مُقفل", "order closed"],
    ["Portal.ProcOrders.pay.upload_short", "ارفعها", "Upload"],
    ["Portal.ProcOrders.export.what_inv", "فواتير الموردين · ملفات PDF في ملف مضغوط", "Supplier invoices · PDFs in a zip"],
    ["Portal.ProcOrders.export.downloaded", "نُزّل ملف المحاسبة وملفات الفواتير.", "Accounting file and invoices downloaded."],
    ["Portal.Procurement.rfqpo.po.money.hold_cap", "القرار للمشتريات، والصرف للمالية. لا «سجّل دفعة» هنا.", "Our decision; Finance pays. No “Record payment” here."],
    ["Portal.Procurement.rfqpo.po.trail.approver_role", "مدير المشتريات أو المالك", "Procurement manager or owner"],
    ["Portal.Procurement.rfqpo.po.trail.receiver_role", "يسجّله المستلم في سند", "The receiver records a receipt"],
    ["Portal.ProcReceipts.fx.core", "المشتريات: تحدّث الأمر و«الخطوة التالية»", "Procurement: updates the PO and its next step"],
    ["Portal.ProcReceipts.fx.fin_off", "بلا المالية: يدخل ملف «صدّر للمحاسبة» للفترة", "Without Finance: goes into the period’s accounting export"],
    ["Portal.ProcReceipts.print.status_matched", "استُلم مطابقاً", "Received as ordered"],
    ["Portal.ProcReceipts.print.col_rejected", "المرفوض وسببه", "Rejected and why"],
    ["Portal.ProcReceipts.print.sig_copy", "تصله نسخته", "Gets a copy"],
    ["Portal.ProcReceipts.manual.qtyHint", "الكمية هنا هي ما استُلم فعلاً، بصف المادة نفسه في كل مكان.", "Quantity here is what was actually received, with the same material row as everywhere."],
    ["Portal.ProcReceipts.export.exportedZip", "نُزّلت ملفات PDF للسندات في ملف مضغوط.", "Receipt PDFs downloaded as a zip."],
    ["Portal.ProcReports.csv_done", "صُدّر التقرير CSV.", "Report exported as CSV."],
    ["ReceiveLink.where_site", "يُصرف على الموقع عند تأكيده", "Charged to the site on confirmation"],
    ["ReceiveLink.code_scope", "الرمز صلاحية هذه الشحنة وحدها، وينتهي بتأكيد السند.", "The code covers this shipment only and ends when the receipt is confirmed."],
    ["PoLink.map_hint", "يُفتح الموقع على الخرائط من جوالك.", "The location opens in Maps on your phone."],
    ["PoLink.done_decline", "وصل اعتذارك إلى المشتري، ويعيد ترسية الأمر.", "Your decline reached the buyer; he will re-award the order."],
    ["Portal.Shared.tr_sent_team", "أُرسل طلبك {number} إلى المشتريات. تابعه هنا.", "Your request {number} went to Procurement. Follow it here."],
  ]
  it.each(pairs)("%s", (key, a, e) => {
    expect(at(ar, key)).toBe(a)
    expect(at(en, key)).toBe(e)
  })
})

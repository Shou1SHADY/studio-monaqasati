/**
 * Supplier 1.0 — the acts the server runs on a document the other company owns (NFR-08): who may ask, the state each
 * needs, what it writes (one transaction, the order's log appended — NFR-06) and who is told. Runs the real handlers
 * over an in-memory Admin Firestore.
 */

import { ActError, actSchema, isBuyerAct, runBuyerAct, runSupplierAct, type Act } from "@/lib/supplier-free/server-acts"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { callerOf } from "@/lib/receipt-links"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1) }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: jest.fn() }))

type Doc = Record<string, unknown>
type Log = { action: string; byId: string; params?: Doc | null; note?: string | null }

const NOW = new Date("2026-10-12T09:00:00Z")
const SUP = { uid: "su", name: "Sami", orgId: "sup", company: "Al Noor" }
const line = { id: "l1", name: "Block", unit: "pc", quantity: 100, unitPrice: 2, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }
const po = (over: Doc = {}): Doc => ({ organizationId: "buyer", supplierOrgId: "sup", supplierUserId: "sup", status: "sent", docNumber: "PO-2026/001", rfqId: "r1", offerId: "o1", preparedById: "p1", approvedById: "a1", sentById: "s1", lines: [line], log: [], totalExVat: 200, ...over })

const withDb = (seed: Record<string, Doc>) => {
  const db = new FakeAdminDb()
  for (const [k, v] of Object.entries(seed)) db.seed(k, v)
  return db
}
const run = (db: FakeAdminDb, act: Record<string, unknown>) => runSupplierAct(db as never, SUP, actSchema.parse(act) as Act, NOW)
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ActError ? e.code : String(e)))
const logOf = (db: FakeAdminDb, id = "po1") => ((db.get(`purchaseOrders/${id}`) as Doc).log || []) as Log[]
const lastNotice = () => (notifyNamed as jest.Mock).mock.calls[(notifyNamed as jest.Mock).mock.calls.length - 1]

beforeEach(() => jest.clearAllMocks())

describe("po.accept (WF-07, ORD-02) — on the server, for the free account and the full portal alike", () => {
  it("accepts a SENT order with the date he commits to, logs it and tells the buyer", async () => {
    const db = withDb({ "purchaseOrders/po1": po() })
    await run(db, { action: "po.accept", poId: "po1", promisedDate: "2026-10-20", note: "From the Riyadh yard" })
    expect(db.get("purchaseOrders/po1")).toMatchObject({ status: "accepted", promisedDate: "2026-10-20", acceptanceRecordedBy: "supplier", supplierAcceptedAt: NOW.toISOString(), supplierAcceptNote: "From the Riyadh yard" })
    expect(logOf(db)).toEqual([expect.objectContaining({ action: "supplier_accepted", byId: "su", params: { date: "2026-10-20", recordedBy: "supplier" } })])
    expect(lastNotice()[2]).toMatchObject({ kind: "po_supplier_accepted", params: { date: "2026-10-20", supplier: "Al Noor" } })
  })

  it("never a day before today in Riyadh, never a malformed date, never twice, never another's order", async () => {
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po() }), { action: "po.accept", poId: "po1", promisedDate: "2026-10-11" }))).toBe("date_past")
    expect(actSchema.safeParse({ action: "po.accept", poId: "po1", promisedDate: "20/10/2026" }).success).toBe(false)
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ status: "accepted" }) }), { action: "po.accept", poId: "po1", promisedDate: "2026-10-20" }))).toBe("wrong_state")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "other" }) }), { action: "po.accept", poId: "po1", promisedDate: "2026-10-20" }))).toBe("not_yours")
    // Today itself is fine.
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po() }), { action: "po.accept", poId: "po1", promisedDate: "2026-10-12" }))).toBeNull()
  })
})

describe("po.decline", () => {
  it("cancels a SENT order with his reason, logs it, says why in the conversation and tells the contractor", async () => {
    const db = withDb({ "purchaseOrders/po1": po(), "offers/o1": { contractorId: "c-user", rfqTitle: "Blocks", organizationId: "sup" } })
    await run(db, { action: "po.decline", poId: "po1", reason: "stock", reasonText: "Not in stock", note: "sorry", message: "Not in stock — sorry" })
    expect(db.get("purchaseOrders/po1")).toMatchObject({ status: "cancelled", cancelledReason: "Not in stock", supplierDecline: { reason: "stock", note: "sorry", byId: "su" } })
    expect(logOf(db).map((l) => l.action)).toEqual(["supplier_declined"])
    expect(db.list("chats/o1/messages")).toEqual([expect.objectContaining({ senderId: "su", text: "Not in stock — sorry" })])
    expect(notifyNamed).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ kind: "po_supplier_declined", organizationId: "buyer" }), ["p1", "a1", "s1"], undefined)
  })

  it("not once accepted, not another supplier's, not a guest's", async () => {
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ status: "accepted" }) }), { action: "po.decline", poId: "po1", reason: "price", reasonText: "x" }))).toBe("wrong_state")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "other" }) }), { action: "po.decline", poId: "po1", reason: "price", reasonText: "x" }))).toBe("not_yours")
    expect(await refusal(run(withDb({}), { action: "po.decline", poId: "nope", reason: "price", reasonText: "x" }))).toBe("order_missing")
  })
})

describe("po.report and po.remind", () => {
  const accepted = (over: Doc = {}) => withDb({ "purchaseOrders/po1": po({ status: "accepted", promisedDate: "2026-10-20", ...over }), "offers/o1": { contractorId: "c-user", rfqTitle: "Blocks" } })

  it("reports a delivery with a date and a note; one waiting blocks a second; the receivers are told", async () => {
    const db = accepted()
    await run(db, { action: "po.report", poId: "po1", date: "2026-10-11", note: "On site" })
    const saved = db.get("purchaseOrders/po1") as Doc & { deliveryReports: { date: string; note: string; closedAt: unknown }[] }
    expect(saved.deliveryReports).toHaveLength(1)
    expect(saved.deliveryReports[0]).toMatchObject({ date: "2026-10-11", note: "On site", closedAt: null })
    expect(lastNotice()[2]).toMatchObject({ kind: "po_delivery_reported" })
    expect(lastNotice()[4]).toEqual({ permissions: ["deliveries.confirm"] })
    expect(await refusal(run(db, { action: "po.report", poId: "po1", date: "2026-10-12" }))).toBe("already_reported")
  })

  it("what is left is measured line by line (ORD-07): 99.6% received still leaves 4 to deliver", async () => {
    const db = accepted({ lines: [{ ...line, quantity: 1000, accepted: 996 }] })
    expect(await refusal(run(db, { action: "po.report", poId: "po1", date: "2026-10-11" }))).toBeNull()
  })

  it("never a date in the future, never before accepting, never when nothing is left", async () => {
    expect(await refusal(run(accepted(), { action: "po.report", poId: "po1", date: "2026-10-30" }))).toBe("date_future")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po() }), { action: "po.report", poId: "po1", date: "2026-10-11" }))).toBe("wrong_state")
    expect(await refusal(run(accepted({ lines: [{ ...line, accepted: 100 }] }), { action: "po.report", poId: "po1", date: "2026-10-11" }))).toBe("nothing_left")
  })

  it("reminds once a day about the report that waits — in the conversation, and the receivers are told (ORD-09)", async () => {
    const db = accepted()
    expect(await refusal(run(db, { action: "po.remind", poId: "po1" }))).toBe("no_report")
    await run(db, { action: "po.report", poId: "po1", date: "2026-10-11" })
    await run(db, { action: "po.remind", poId: "po1", message: "تذكير: سلّمت 11 أكتوبر، وأرجو تسجيل الاستلام." })
    expect(db.list("chats/o1/messages").map((m) => m.text)).toEqual(["تذكير: سلّمت 11 أكتوبر، وأرجو تسجيل الاستلام."])
    expect(db.get("chats/o1")).toMatchObject({ lastMessage: "تذكير: سلّمت 11 أكتوبر، وأرجو تسجيل الاستلام.", unreadFor: ["c-user"], "unreadCounts.c-user": 1 })
    expect(db.list("users/c-user/notifications")).toEqual([expect.objectContaining({ type: "new_chat_message", chatId: "o1" })])
    expect(lastNotice()[2]).toMatchObject({ kind: "po_delivery_reminder", params: { date: "2026-10-11" } })
    expect(lastNotice()[4]).toEqual({ permissions: ["deliveries.confirm"] })
    expect(await refusal(run(db, { action: "po.remind", poId: "po1" }))).toBe("reminded_today")
  })
})

describe("transfer.answer (WF-13, BIL-04)", () => {
  const transfer = (state: string) =>
    withDb({ "supplierTransfers/t1": { poId: "po1", supplierOrgId: "sup", state, amount: 1150, bank: "Rajhi", ref: "T9", reportedById: "fin1" }, "purchaseOrders/po1": po({ status: "accepted" }) })

  it("confirms a sent one in the order's log; Finance — who reported it, and invoices.manage — is told, the amount as a fact", async () => {
    const a = transfer("sent")
    await run(a, { action: "transfer.answer", transferId: "t1", answer: "ok" })
    expect(a.get("supplierTransfers/t1")).toMatchObject({ state: "ok", confirmedById: "su", answers: [expect.objectContaining({ answer: "ok", byId: "su" })] })
    expect(logOf(a)).toEqual([expect.objectContaining({ action: "transfer_confirmed", byId: "su", params: { ref: "T9", amount: 1150 } })])
    const [, , e, users, opts] = lastNotice()
    expect(e).toMatchObject({ kind: "po_payment_confirmed", params: { amount: "sar:1150", ref: "T9", bank: "Rajhi" } })
    expect(users).toEqual(["p1", "a1", "s1", "fin1"])
    expect(opts).toEqual({ permissions: ["invoices.manage"] })
  })

  it("'arrived later' keeps who said 'not received' and when — every answer is appended, none overwritten", async () => {
    const b = transfer("sent")
    await run(b, { action: "transfer.answer", transferId: "t1", answer: "miss", note: "Not on the statement" })
    expect(b.get("supplierTransfers/t1")).toMatchObject({ state: "miss", note: "Not on the statement", missedById: "su", missedAt: NOW.toISOString() })
    expect(lastNotice()[2]).toMatchObject({ kind: "po_payment_missing" })
    expect(lastNotice()[3]).toContain("fin1")
    await run(b, { action: "transfer.answer", transferId: "t1", answer: "later" })
    const t = b.get("supplierTransfers/t1") as Doc & { answers: { answer: string }[] }
    expect(t).toMatchObject({ state: "ok", arrivedLater: true, missedById: "su", missedAt: NOW.toISOString(), note: "Not on the statement" })
    expect(t.answers.map((x) => x.answer)).toEqual(["miss", "later"])
    expect(logOf(b).map((l) => l.action)).toEqual(["transfer_missing", "transfer_arrived_later"])
  })

  it("a confirmed one is final; 'missing' needs a note; it must be his", async () => {
    expect(await refusal(run(transfer("ok"), { action: "transfer.answer", transferId: "t1", answer: "miss", note: "x" }))).toBe("wrong_state")
    expect(await refusal(run(transfer("sent"), { action: "transfer.answer", transferId: "t1", answer: "miss" }))).toBe("invalid")
    expect(await refusal(run(transfer("sent"), { action: "transfer.answer", transferId: "t1", answer: "later" }))).toBe("wrong_state")
    const other = withDb({ "supplierTransfers/t1": { poId: "po1", supplierOrgId: "someone", state: "sent" } })
    expect(await refusal(run(other, { action: "transfer.answer", transferId: "t1", answer: "ok" }))).toBe("not_yours")
  })
})

describe("warranty.register (ORD-14, WF-15)", () => {
  const input = { action: "warranty.register", poId: "po1", itemId: "i1", until: "2027-10-12", file: { name: "w.pdf", url: "https://x.test/w.pdf" } }
  const receipt = (accepted: number) => ({ poId: "po1", status: "confirmed", docNumber: "GR-2026/004", lines: [{ poLineId: "l1", counted: accepted, accepted }] })
  const world = (category: string, rc: Doc | null = receipt(40)) =>
    withDb({ "purchaseOrders/po1": po({ status: "accepted" }), "rfqs/r1": { category }, ...(rc ? { "deliveries/d1": rc } : {}) })

  it("registers one for a warranty material the contractor received — the item's name from the order — logged, once per order", async () => {
    const db = world("عزل وأسقف")
    const r = await run(db, { ...input, itemName: "anything the screen says", category: "عزل وأسقف" })
    expect(db.get(`supplierWarranties/${String(r.id)}`)).toMatchObject({ state: "wait", supplierOrgId: "sup", buyerOrgId: "buyer", until: "2027-10-12", itemName: "Block", category: "عزل وأسقف", itemId: "i1" })
    expect(logOf(db)).toEqual([expect.objectContaining({ action: "warranty_registered", params: { item: "Block", date: "2027-10-12" } })])
    expect(await refusal(run(db, input))).toBe("wrong_state")
  })

  it("the category is the REQUEST's, never the screen's: a block order is refused even when the screen says insulation", async () => {
    expect(await refusal(run(world("طوب وبلوك"), { ...input, category: "عزل وأسقف" }))).toBe("invalid")
  })

  it("only after a receipt that accepted the item, only for an item on the order", async () => {
    expect(await refusal(run(world("عزل وأسقف", null), input))).toBe("no_receipt")
    expect(await refusal(run(world("عزل وأسقف", receipt(0)), input))).toBe("no_receipt")
    expect(await refusal(run(world("عزل وأسقف"), { ...input, itemId: "i9" }))).toBe("invalid")
  })

  it("not ending today or before, not on someone else's order", async () => {
    expect(await refusal(run(world("عزل وأسقف"), { ...input, until: "2026-10-12" }))).toBe("invalid")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "other" }) }), input))).toBe("not_yours")
  })
})

describe("po.rate (B-09, ORD-15)", () => {
  const paidWorld = (paid: number) =>
    withDb({
      "purchaseOrders/po1": po({ status: "accepted", lines: [{ ...line, accepted: 100 }] }),
      "deliveries/d1": { poId: "po1", status: "confirmed", docNumber: "GR-2026/004" },
      // An invoice BELOW the receipt (it closes the receipt all the same) from a supplier with no tax number: gross = net.
      "supplierInvoices/i1": { poId: "po1", amountNet: 180, vat: 0, grns: ["GR-2026/004"] },
      "supplierTransfers/t1": { poId: "po1", state: "ok", amount: paid },
      "offers/o1": { contractorId: "c-user" },
      "users/buyer": { companyName: "Binaa Co" },
    })

  it("rates once the order is received, every receipt invoiced and paid — one review per order, with the order and its material", async () => {
    const db = paidWorld(180)
    await run(db, { action: "po.rate", poId: "po1", stars: 4, text: "Paid on time" })
    expect(db.get("reviews/po_po1_supplier")).toMatchObject({ poId: "po1", poNumber: "PO-2026/001", material: "Block", reviewerId: "su", reviewerRole: "Supplier", revieweeId: "buyer", revieweeName: "Binaa Co", revieweeRole: "Contractor", rating: 4, comment: "Paid on time" })
    expect(db.get("offers/o1")).toMatchObject({ supplierRated: true, supplierRating: { stars: 4, text: "Paid on time" } })
    expect(logOf(db)).toEqual([expect.objectContaining({ action: "supplier_rated", params: { stars: 4 } })])
    expect(lastNotice()[2]).toMatchObject({ kind: "po_supplier_rated", params: { stars: 4 } })
    expect(await refusal(run(db, { action: "po.rate", poId: "po1", stars: 5 }))).toBe("already_rated")
  })

  it("not before full payment, not on another's order, stars 1–5 only", async () => {
    expect(await refusal(run(paidWorld(100), { action: "po.rate", poId: "po1", stars: 4 }))).toBe("not_paid")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "x" }) }), { action: "po.rate", poId: "po1", stars: 4 }))).toBe("not_yours")
    expect(actSchema.safeParse({ action: "po.rate", poId: "po1", stars: 6 }).success).toBe(false)
  })
})

describe("the contractor's acts", () => {
  const caller = (perms: string[], orgId = "buyer") => (callerOf as jest.Mock).mockResolvedValue({ uid: "bu", name: "Badr", orgId, can: (p: string) => perms.includes(p) })
  const report = actSchema.parse({ action: "transfer.report", poId: "po1", amount: 1150, bank: "Rajhi", reference: "T9", valueDate: "2026-10-12" })

  it("Finance reports a transfer; the supplier alone is told, by the company's name, the amount as a fact", async () => {
    caller(["invoices.manage"])
    const db = withDb({ "purchaseOrders/po1": po({ status: "accepted" }), "users/buyer": { companyName: "Binaa Co" } })
    const r = await runBuyerAct(db as never, "bu", report, NOW)
    expect(db.get(`supplierTransfers/${String(r.id)}`)).toMatchObject({ poId: "po1", supplierOrgId: "sup", buyerOrgId: "buyer", amount: 1150, state: "sent", reportedById: "bu", answers: [] })
    expect(notifyNamed).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ kind: "po_payment_reported", params: expect.objectContaining({ contractor: "Binaa Co", amount: "sar:1150" }) }), ["sup", "sup"], { owner: false })
  })

  it("not without the permission, not on another company's order, not for a guest supplier", async () => {
    caller(["offers.accept"])
    expect(await refusal(runBuyerAct(withDb({ "purchaseOrders/po1": po() }) as never, "bu", report, NOW))).toBe("no_permission")
    caller(["invoices.manage"], "elsewhere")
    expect(await refusal(runBuyerAct(withDb({ "purchaseOrders/po1": po() }) as never, "bu", report, NOW))).toBe("not_found")
    caller(["invoices.manage"])
    expect(await refusal(runBuyerAct(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "guest" }) }) as never, "bu", report, NOW))).toBe("wrong_state")
  })

  it("a buyer accepts a waiting warranty, once, in the order's log", async () => {
    caller(["offers.accept"])
    const accept = actSchema.parse({ action: "warranty.accept", warrantyId: "w1" })
    const db = withDb({ "supplierWarranties/w1": { poId: "po1", buyerOrgId: "buyer", state: "wait", itemName: "Roof" }, "purchaseOrders/po1": po({ status: "accepted" }) })
    await runBuyerAct(db as never, "bu", accept, NOW)
    expect(db.get("supplierWarranties/w1")).toMatchObject({ state: "ok", acceptedById: "bu" })
    expect(logOf(db)).toEqual([expect.objectContaining({ action: "warranty_accepted", byId: "bu", params: { item: "Roof" } })])
    expect(await refusal(runBuyerAct(db as never, "bu", accept, NOW))).toBe("wrong_state")
    caller([])
    expect(await refusal(runBuyerAct(withDb({}) as never, "bu", accept, NOW))).toBe("no_permission")
  })
})

describe("the request itself", () => {
  it("only the known acts, with their fields, parse; the buyer's two are told apart", () => {
    expect(actSchema.safeParse({ action: "po.decline", poId: "p", reason: "mood", reasonText: "x" }).success).toBe(false)
    expect(actSchema.safeParse({ action: "po.report", poId: "p", date: "tomorrow" }).success).toBe(false)
    expect(actSchema.safeParse({ action: "transfer.report", poId: "p", amount: 0, bank: "b", reference: "r", valueDate: "2026-10-12" }).success).toBe(false)
    expect(actSchema.safeParse({ action: "delete.everything" }).success).toBe(false)
    expect(isBuyerAct(actSchema.parse({ action: "warranty.accept", warrantyId: "w" }))).toBe(true)
    expect(isBuyerAct(actSchema.parse({ action: "po.remind", poId: "p" }))).toBe(false)
    expect(isBuyerAct(actSchema.parse({ action: "po.accept", poId: "p", promisedDate: "2026-10-20" }))).toBe(false)
  })
})

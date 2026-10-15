/**
 * Supplier 1.0 — the acts the server runs on a document the other company owns (NFR-08): who may ask, the state each
 * needs, what it writes and who is told. Runs the real handlers over an in-memory Admin Firestore.
 */

import { ActError, actSchema, isBuyerAct, runBuyerAct, runSupplierAct, type Act } from "@/lib/supplier-free/server-acts"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { callerOf } from "@/lib/receipt-links"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))
jest.mock("@/lib/supplier-free/server-notify", () => ({ notifyNamed: jest.fn(async () => 1) }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: jest.fn() }))

type Doc = Record<string, unknown>

class FakeDb {
  docs = new Map<string, Doc>()
  private n = 0
  seed(path: string, data: Doc) {
    this.docs.set(path, data)
  }
  collection(name: string) {
    const ref = (id: string) => ({
      path: `${name}/${id}`,
      id,
      get: async () => ({ exists: this.docs.has(`${name}/${id}`), id, data: () => this.docs.get(`${name}/${id}`) }),
      update: async (patch: Doc) => {
        this.docs.set(`${name}/${id}`, { ...(this.docs.get(`${name}/${id}`) || {}), ...patch })
      },
    })
    const query = (filters: [string, unknown][]) => ({
      limit: () => query(filters),
      get: async () => {
        const rows = [...this.docs].filter(([k, d]) => k.startsWith(`${name}/`) && filters.every(([f, v]) => d[f] === v))
        return { empty: rows.length === 0, docs: rows.map(([k, d]) => ({ id: k.split("/")[1], data: () => d })) }
      },
    })
    return {
      doc: ref,
      add: async (data: Doc) => {
        const id = `n${++this.n}`
        this.docs.set(`${name}/${id}`, data)
        return { id }
      },
      where: (f: string, _op: string, v: unknown) => query([[f, v]]),
    }
  }
  async runTransaction<T>(fn: (tx: { get: (r: { get: () => Promise<unknown> }) => Promise<unknown>; update: (r: { update: (p: Doc) => Promise<void> }, p: Doc) => void }) => Promise<T>): Promise<T> {
    return fn({ get: (r) => r.get(), update: (r, p) => void r.update(p) })
  }
}

const NOW = new Date("2026-10-12T09:00:00Z")
const SUP = { uid: "su", name: "Sami", orgId: "sup", company: "Al Noor" }
const line = { id: "l1", name: "Block", unit: "pc", quantity: 100, unitPrice: 2, accepted: 0, rejected: 0, held: 0, cancelled: 0 }
const po = (over: Doc = {}): Doc => ({ organizationId: "buyer", supplierOrgId: "sup", supplierUserId: "sup", status: "sent", docNumber: "PO-2026/001", rfqId: "r1", offerId: "o1", preparedById: "p1", approvedById: "a1", sentById: "s1", lines: [line], log: [], totalExVat: 200, ...over })

const withDb = (seed: Record<string, Doc>) => {
  const db = new FakeDb()
  for (const [k, v] of Object.entries(seed)) db.seed(k, v)
  return db
}
const run = (db: FakeDb, act: Record<string, unknown>) => runSupplierAct(db as never, SUP, actSchema.parse(act) as Act, NOW)
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ActError ? e.code : String(e)))

beforeEach(() => jest.clearAllMocks())

describe("po.decline", () => {
  it("cancels a SENT order with his reason, logs it and tells the contractor", async () => {
    const db = withDb({ "purchaseOrders/po1": po() })
    await run(db, { action: "po.decline", poId: "po1", reason: "stock", reasonText: "Not in stock", note: "sorry" })
    const saved = db.docs.get("purchaseOrders/po1") as Doc & { log: { action: string }[] }
    expect(saved).toMatchObject({ status: "cancelled", cancelledReason: "Not in stock", supplierDecline: { reason: "stock", note: "sorry", byId: "su" } })
    expect(saved.log.map((l) => l.action)).toEqual(["supplier_declined"])
    expect(notifyNamed).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ kind: "po_supplier_declined", organizationId: "buyer" }), ["p1", "a1", "s1"])
  })

  it("not once accepted, not another supplier's, not a guest's", async () => {
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ status: "accepted" }) }), { action: "po.decline", poId: "po1", reason: "price", reasonText: "x" }))).toBe("wrong_state")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "other" }) }), { action: "po.decline", poId: "po1", reason: "price", reasonText: "x" }))).toBe("not_yours")
    expect(await refusal(run(withDb({}), { action: "po.decline", poId: "nope", reason: "price", reasonText: "x" }))).toBe("order_missing")
  })
})

describe("po.report and po.remind", () => {
  const accepted = () => withDb({ "purchaseOrders/po1": po({ status: "accepted", promisedDate: "2026-10-20" }) })

  it("reports a delivery with a date and a note; one waiting blocks a second", async () => {
    const db = accepted()
    await run(db, { action: "po.report", poId: "po1", date: "2026-10-11", note: "On site" })
    const saved = db.docs.get("purchaseOrders/po1") as Doc & { deliveryReports: { date: string; note: string; closedAt: unknown }[] }
    expect(saved.deliveryReports).toHaveLength(1)
    expect(saved.deliveryReports[0]).toMatchObject({ date: "2026-10-11", note: "On site", closedAt: null })
    expect(await refusal(run(db, { action: "po.report", poId: "po1", date: "2026-10-12" }))).toBe("already_reported")
  })

  it("never a date in the future, never before accepting, never when nothing is left", async () => {
    expect(await refusal(run(accepted(), { action: "po.report", poId: "po1", date: "2026-10-30" }))).toBe("date_future")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po() }), { action: "po.report", poId: "po1", date: "2026-10-11" }))).toBe("wrong_state")
    const done = withDb({ "purchaseOrders/po1": po({ status: "accepted", lines: [{ ...line, accepted: 100 }] }) })
    expect(await refusal(run(done, { action: "po.report", poId: "po1", date: "2026-10-11" }))).toBe("wrong_state")
  })

  it("reminds once a day about the report that waits", async () => {
    const db = accepted()
    expect(await refusal(run(db, { action: "po.remind", poId: "po1" }))).toBe("no_report")
    await run(db, { action: "po.report", poId: "po1", date: "2026-10-11" })
    await run(db, { action: "po.remind", poId: "po1" })
    expect(await refusal(run(db, { action: "po.remind", poId: "po1" }))).toBe("reminded_today")
  })
})

describe("transfer.answer", () => {
  const transfer = (state: string) => withDb({ "supplierTransfers/t1": { poId: "po1", supplierOrgId: "sup", state, amount: 1150, bank: "Rajhi", ref: "T9" }, "purchaseOrders/po1": po({ status: "accepted" }) })

  it("confirms a sent one, says a sent one did not arrive (with a note), and closes a missing one that arrived later", async () => {
    const a = transfer("sent")
    await run(a, { action: "transfer.answer", transferId: "t1", answer: "ok" })
    expect(a.docs.get("supplierTransfers/t1")).toMatchObject({ state: "ok", confirmedById: "su" })
    expect(notifyNamed).toHaveBeenLastCalledWith(a, expect.anything(), expect.objectContaining({ kind: "po_payment_confirmed" }), expect.anything())

    const b = transfer("sent")
    await run(b, { action: "transfer.answer", transferId: "t1", answer: "miss", note: "Not on the statement" })
    expect(b.docs.get("supplierTransfers/t1")).toMatchObject({ state: "miss", note: "Not on the statement" })

    await run(b, { action: "transfer.answer", transferId: "t1", answer: "later" })
    expect(b.docs.get("supplierTransfers/t1")).toMatchObject({ state: "ok", arrivedLater: true })
  })

  it("a confirmed one is final; 'missing' needs a note; it must be his", async () => {
    expect(await refusal(run(transfer("ok"), { action: "transfer.answer", transferId: "t1", answer: "miss", note: "x" }))).toBe("wrong_state")
    expect(await refusal(run(transfer("sent"), { action: "transfer.answer", transferId: "t1", answer: "miss" }))).toBe("invalid")
    expect(await refusal(run(transfer("sent"), { action: "transfer.answer", transferId: "t1", answer: "later" }))).toBe("wrong_state")
    const other = withDb({ "supplierTransfers/t1": { poId: "po1", supplierOrgId: "someone", state: "sent" } })
    expect(await refusal(run(other, { action: "transfer.answer", transferId: "t1", answer: "ok" }))).toBe("not_yours")
  })
})

describe("warranty.register", () => {
  const input = { action: "warranty.register", poId: "po1", itemId: "l1", itemName: "Roof membrane", category: "عزل وأسقف", until: "2027-10-12", file: { name: "w.pdf", url: "https://x.test/w.pdf" } }

  it("registers one for a warranty material, ending in the future, once per order", async () => {
    const db = withDb({ "purchaseOrders/po1": po({ status: "accepted" }) })
    const r = await run(db, input)
    expect(db.docs.get(`supplierWarranties/${String(r.id)}`)).toMatchObject({ state: "wait", supplierOrgId: "sup", buyerOrgId: "buyer", until: "2027-10-12" })
    expect(await refusal(run(db, input))).toBe("wrong_state")
  })

  it("not for another category, not ending today or before, not on someone else's order", async () => {
    const fresh = () => withDb({ "purchaseOrders/po1": po({ status: "accepted" }) })
    expect(await refusal(run(fresh(), { ...input, category: "طوب وبلوك" }))).toBe("invalid")
    expect(await refusal(run(fresh(), { ...input, until: "2026-10-12" }))).toBe("invalid")
    expect(await refusal(run(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "other" }) }), input))).toBe("not_yours")
  })
})

describe("the contractor's acts", () => {
  const caller = (perms: string[], orgId = "buyer") => (callerOf as jest.Mock).mockResolvedValue({ uid: "bu", name: "Buyer Co", orgId, can: (p: string) => perms.includes(p) })
  const report = actSchema.parse({ action: "transfer.report", poId: "po1", amount: 1150, bank: "Rajhi", reference: "T9", valueDate: "2026-10-12" })

  it("Finance reports a transfer; the supplier alone is told", async () => {
    caller(["invoices.manage"])
    const db = withDb({ "purchaseOrders/po1": po({ status: "accepted" }) })
    const r = await runBuyerAct(db as never, "bu", report, NOW)
    expect(db.docs.get(`supplierTransfers/${String(r.id)}`)).toMatchObject({ poId: "po1", supplierOrgId: "sup", buyerOrgId: "buyer", amount: 1150, state: "sent", reportedById: "bu" })
    expect(notifyNamed).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ kind: "po_payment_reported" }), ["sup", "sup"], { owner: false })
  })

  it("not without the permission, not on another company's order, not for a guest supplier", async () => {
    caller(["offers.accept"])
    expect(await refusal(runBuyerAct(withDb({ "purchaseOrders/po1": po() }) as never, "bu", report, NOW))).toBe("no_permission")
    caller(["invoices.manage"], "elsewhere")
    expect(await refusal(runBuyerAct(withDb({ "purchaseOrders/po1": po() }) as never, "bu", report, NOW))).toBe("not_found")
    caller(["invoices.manage"])
    expect(await refusal(runBuyerAct(withDb({ "purchaseOrders/po1": po({ supplierOrgId: "guest" }) }) as never, "bu", report, NOW))).toBe("wrong_state")
  })

  it("a buyer accepts a waiting warranty, once", async () => {
    caller(["offers.accept"])
    const accept = actSchema.parse({ action: "warranty.accept", warrantyId: "w1" })
    const db = withDb({ "supplierWarranties/w1": { poId: "po1", buyerOrgId: "buyer", state: "wait", itemName: "Roof" }, "purchaseOrders/po1": po({ status: "accepted" }) })
    await runBuyerAct(db as never, "bu", accept, NOW)
    expect(db.docs.get("supplierWarranties/w1")).toMatchObject({ state: "ok", acceptedById: "bu" })
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
  })
})

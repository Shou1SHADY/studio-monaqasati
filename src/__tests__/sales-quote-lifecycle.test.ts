/**
 * The quotation's lifecycle on the in-memory Firestore (Sales PRD §5 T2–T9,
 * D6, D7, D8; scenarios S1, S2, S3): numbered on first save, issued behind its
 * blocks, sent with validity from the send date, converted into an order in
 * one atomic write, lost with a reason, revised under the base number.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/accounting/hooks", () => ({
  onQuotationPaymentRecorded: jest.fn(),
  onSalesCreditNoteIssued: jest.fn(),
  onSalesDelivered: jest.fn(),
  onSalesInvoiceIssued: jest.fn(),
  onSalesInvoicePaid: jest.fn(),
}))

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { advanceInstallment, isAdvanceInstallment, type CrmQuotation, type QuotationInstallment } from "@/lib/crm"
import { amountInArabicWords, amountInEnglishWords } from "@/lib/amount-in-words"
import { baseDocNumber, displayDocNumber, formatSalesDocNumber, revisionDocNumber, revisionOfNumber } from "@/lib/sales-numbering"
import {
  closeQuotationLost,
  convertBlocks,
  createQuotation,
  daysToExpiry,
  extendQuotation,
  inSalesScope,
  issueBlocks,
  issueQuotation,
  logQuotationSent,
  madeToOrderLines,
  quoteActions,
  quoteEditable,
  quoteLifecycle,
  reviseQuotation,
  validUntilFrom,
  withAdvance,
  type IssueContext,
} from "@/lib/sales-quotes"
import { paymentFromQuotation } from "@/lib/sales-order-writes"
import { shouldReleaseOrder } from "@/lib/sales-transfers"
import { runQuotationAcceptance } from "@/lib/sales"
import type { SalesOrder } from "@/lib/sales-orders"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-17T08:00:00.000Z")
const TODAY = "2026-09-17"
const ORG = "org1"
const REEM = { id: "reem", name: "Reem" }

const DOOR = "HDF door"
const CANOPY = "Steel canopy"

/** Doors are stocked; canopies are made to order. Reem is a rep: 3% cap. */
const ctx = (over: Partial<IssueContext> = {}): IssueContext => ({
  priceItems: [
    { name: DOOR, unitPrice: 1200, cost: 900 },
    { name: CANOPY, unitPrice: 17000, cost: 12000 },
  ],
  capPercent: 3,
  manufacturedNames: [CANOPY],
  stockByName: new Map([[DOOR, 100]]),
  ...over,
})

const STD: QuotationInstallment[] = [
  { id: "deposit", label: "Advance", percent: 30, beforeProduction: true },
  { id: "balance", label: "On delivery", percent: 70, beforeProduction: false },
]
const AFTER_DELIVERY: QuotationInstallment[] = [{ id: "full", label: "After delivery", percent: 100, beforeProduction: false }]

const draftData = (over: Record<string, unknown> = {}) => ({
  contactId: "c1",
  contactName: "Al-Diyar",
  amount: 36000,
  items: [{ name: DOOR, quantity: 30, unit: "pc", unitPrice: 1200 }],
  installments: STD,
  validityDays: 14,
  // A draft has no end date: validity runs from the send date (QC-09).
  validUntil: null,
  status: "draft",
  date: TODAY,
  ...over,
})
const quote = (id: string) => readDoc<CrmQuotation>(`crmQuotations/${id}`)!

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
})
afterAll(() => jest.useRealTimers())
beforeEach(() => {
  resetFakeDb()
  jest.setSystemTime(NOW)
})

describe("QC-14 · the amount in words is computed, never typed", () => {
  it("reads the PRD's own example in Arabic, with the counted noun following the number", () => {
    expect(amountInArabicWords(150765)).toBe("فقط مائة وخمسون ألفاً وسبعمائة وخمسة وستون ريالاً لا غير")
    expect(amountInArabicWords(1)).toBe("فقط ريال واحد لا غير")
    expect(amountInArabicWords(2)).toBe("فقط ريالان لا غير")
    expect(amountInArabicWords(10)).toBe("فقط عشرة ريالات لا غير")
    expect(amountInArabicWords(2000)).toBe("فقط ألفا ريال لا غير")
    expect(amountInArabicWords(3000)).toBe("فقط ثلاثة آلاف ريال لا غير")
    expect(amountInArabicWords(71208)).toBe("فقط واحد وسبعون ألفاً ومائتان وثمانية ريالات لا غير")
    expect(amountInArabicWords(1000000)).toBe("فقط مليون ريال لا غير")
    expect(amountInArabicWords(100.5)).toBe("فقط مائة ريال وخمسون هللة لا غير")
  })

  it("and in English for the English document", () => {
    expect(amountInEnglishWords(150765)).toBe("Only one hundred and fifty thousand seven hundred and sixty-five Saudi riyals.")
    expect(amountInEnglishWords(1005)).toBe("Only one thousand and five Saudi riyals.")
    expect(amountInEnglishWords(100.5)).toBe("Only one hundred Saudi riyals and fifty halalas.")
    expect(amountInEnglishWords(0)).toBe("Only zero Saudi riyals.")
  })
})

describe("QC-15 · numbering", () => {
  it("formats per type and year, and revisions carry the base number and a suffix", () => {
    expect(formatSalesDocNumber("QT", 2026, 7)).toBe("QT-2026/007")
    expect(revisionDocNumber("QT-2026/066", 1)).toBe("QT-2026/066")
    expect(revisionDocNumber("QT-2026/066", 2)).toBe("QT-2026/066-2")
    expect(revisionDocNumber("QT-2026/066-2", 3)).toBe("QT-2026/066-3")
    expect(baseDocNumber("QT-2026/066-3")).toBe("QT-2026/066")
    expect(revisionOfNumber("QT-2026/066-3")).toBe(3)
    expect(revisionOfNumber("QT-2026/066")).toBe(1)
    // A number from before the sequence is its own base.
    expect(baseDocNumber("Q-AB12CD")).toBe("Q-AB12CD")
  })

  it("S10 · the prefix follows the language; the digits never change", () => {
    expect(displayDocNumber("QT-2026/070", "ar")).toBe("ع.س-2026/070")
    expect(displayDocNumber("QT-2026/066-2", "ar")).toBe("ع.س-2026/066-2")
    expect(displayDocNumber("TN-2026/056", "ar")).toBe("إ.ح-2026/056")
    expect(displayDocNumber("MR-2026/087", "ar")).toBe("طت-2026/087")
    expect(displayDocNumber("QT-2026/070", "en")).toBe("QT-2026/070")
    expect(displayDocNumber("Q-AB12CD", "ar")).toBe("Q-AB12CD")
    expect(displayDocNumber(null, "ar")).toBe("")
  })

  it("is drawn on the first save, sequentially, with its author — and never reused", async () => {
    const a = await createQuotation(db, { organizationId: ORG, data: draftData(), actor: REEM })
    const b = await createQuotation(db, { organizationId: ORG, data: draftData(), actor: REEM })
    expect([a.quotationNumber, b.quotationNumber]).toEqual(["QT-2026/001", "QT-2026/002"])
    expect(quote(a.id)).toMatchObject({ status: "draft", revision: 1, createdByUserId: "reem", createdByUserName: "Reem", organizationId: ORG })
    // Another company has its own sequence.
    const other = await createQuotation(db, { organizationId: "org2", data: draftData(), actor: REEM })
    expect(other.quotationNumber).toBe("QT-2026/001")
  })
})

describe("the state is computed, never typed (INV-04)", () => {
  const q = (over: Partial<CrmQuotation>) => ({ status: "draft", validUntil: null, supersededById: null, ...over }) as CrmQuotation

  it("derives expired and superseded; stored status gives the rest", () => {
    expect(quoteLifecycle(q({}), TODAY)).toBe("draft")
    expect(quoteLifecycle(q({ status: "issued" }), TODAY)).toBe("issued")
    expect(quoteLifecycle(q({ status: "sent", validUntil: "2026-09-17" }), TODAY)).toBe("sent") // valid through its last day
    expect(quoteLifecycle(q({ status: "sent", validUntil: "2026-09-16" }), TODAY)).toBe("expired")
    expect(quoteLifecycle(q({ status: "accepted" }), TODAY)).toBe("won")
    expect(quoteLifecycle(q({ status: "rejected" }), TODAY)).toBe("lost")
    expect(quoteLifecycle(q({ status: "sent", supersededById: "x" }), TODAY)).toBe("superseded")
    expect(daysToExpiry(q({ status: "sent", validUntil: "2026-09-20" }), TODAY)).toBe(3)
    expect(daysToExpiry(q({ status: "sent", validUntil: "2026-09-15" }), TODAY)).toBe(-2)
    expect(daysToExpiry(q({ status: "issued", validUntil: "2026-09-20" }), TODAY)).toBeNull()
  })

  it("D6 · issue locks the figures, sending locks the document", () => {
    expect(quoteEditable(q({}), TODAY)).toBe("all")
    expect(quoteEditable(q({ status: "issued" }), TODAY)).toBe("texts")
    expect(quoteEditable(q({ status: "sent", validUntil: "2026-12-01" }), TODAY)).toBe("none")
    expect(quoteEditable(q({ status: "accepted" }), TODAY)).toBe("none")
  })

  it("offers one step at a time", () => {
    expect(quoteActions(q({}), TODAY)).toEqual(["issue"])
    expect(quoteActions(q({ status: "issued" }), TODAY)).toEqual(["log_sent", "revise"])
    expect(quoteActions(q({ status: "sent", validUntil: "2026-12-01" }), TODAY)).toEqual(["convert", "close_lost", "revise"])
    expect(quoteActions(q({ status: "sent", validUntil: "2026-01-01" }), TODAY)).toEqual(["extend", "revise", "close_lost"])
    expect(quoteActions(q({ status: "accepted" }), TODAY)).toEqual([])
    expect(quoteActions(q({ status: "rejected" }), TODAY)).toEqual([])
  })

  it("QC-09 · validity counts from the send date", () => {
    expect(validUntilFrom("2026-09-17T08:00:00.000Z", 14)).toBe("2026-10-01")
    expect(validUntilFrom("2026-09-17T08:00:00.000Z", null)).toBe("2026-10-01")
    expect(validUntilFrom("2026-09-17", 7)).toBe("2026-09-24")
  })
})

describe("T4 · what blocks Issue", () => {
  const base = { contactId: "c1", items: [{ name: DOOR, quantity: 30, unit: "pc", unitPrice: 1200 }], installments: STD, validityDays: 14 }

  it("a sound quote has none", () => {
    expect(issueBlocks(base, ctx())).toEqual([])
  })

  it("client · a line · 100% · validity", () => {
    const kinds = (q: Parameters<typeof issueBlocks>[0]) => issueBlocks(q, ctx()).map((b) => b.kind)
    expect(kinds({ ...base, contactId: "" })).toEqual(["client_required"])
    expect(kinds({ ...base, items: [] })).toEqual(["lines_required"])
    expect(kinds({ ...base, validityDays: 0 })).toEqual(["validity_required"])
    expect(kinds({ ...base, installments: [{ ...STD[0] }, { ...STD[1], percent: 60 }] })).toEqual(["schedule_not_100"])
    expect(kinds({ ...base, installments: [{ ...STD[0], label: " " }, STD[1]] })).toEqual(["schedule_invalid"])
  })

  it("S2 · a rep's 5% is over his 3% cap; 2% passes; below cost is blocked for everyone and never states the cost", () => {
    const at = (unitPrice: number, capPercent: number | null = 3) => issueBlocks({ ...base, items: [{ ...base.items[0], unitPrice }] }, ctx({ capPercent }))
    expect(at(1140)).toEqual([{ kind: "over_cap", name: DOOR, discountPercent: 5, capPercent: 3 }])
    expect(at(1176)).toEqual([])
    expect(at(1140, 8)).toEqual([]) // the manager's cap
    expect(at(1000, null)).toEqual([]) // the owner has none…
    expect(at(899, null)).toEqual([{ kind: "below_cost", name: DOOR }]) // …but below cost stops everyone
    expect(JSON.stringify(at(899, null))).not.toContain("900")
  })

  it("S3 · QC-13 · made to order needs a before-production instalment", () => {
    const canopies = { ...base, items: [{ name: CANOPY, quantity: 4, unit: "pc", unitPrice: 17000 }], installments: AFTER_DELIVERY }
    expect(madeToOrderLines(canopies.items, ctx())).toEqual([CANOPY])
    expect(issueBlocks(canopies, ctx())).toEqual([{ kind: "advance_required", names: [CANOPY] }])
    // Stock that covers the quantity lifts it; a stocked door never needed one.
    expect(issueBlocks(canopies, ctx({ stockByName: new Map([[CANOPY, 4]]) }))).toEqual([])
    expect(issueBlocks({ ...base, installments: AFTER_DELIVERY }, ctx())).toEqual([])
    // A 0% "advance" is not an advance.
    expect(issueBlocks({ ...canopies, installments: [{ id: "a", label: "Advance", percent: 0, beforeProduction: true }, { id: "b", label: "Rest", percent: 100 }] }, ctx()).map((b) => b.kind)).toContain("advance_required")
  })

  it("the one button: 100% becomes 30% + the rest; an existing schedule flags its first row", () => {
    let n = 0
    const id = () => `new${++n}`
    expect(withAdvance(AFTER_DELIVERY, { advance: "Advance", balance: "Balance" }, id)).toEqual([
      { id: "new1", label: "Advance", percent: 30, beforeProduction: true },
      { id: "full", label: "After delivery", percent: 70, beforeProduction: false },
    ])
    const two = [{ id: "a", label: "First", percent: 40, beforeProduction: false }, { id: "b", label: "Second", percent: 60, beforeProduction: false }]
    expect(withAdvance(two, { advance: "A", balance: "B" }, id).map((i) => i.beforeProduction)).toEqual([true, false])
    expect(withAdvance(STD, { advance: "A", balance: "B" }, id)).toBe(STD)
  })
})

describe("the advance is a flag, not a magic id", () => {
  it("the flag decides; a schedule from before it falls back to the default row's id", () => {
    expect(isAdvanceInstallment({ id: "inst_x1", beforeProduction: true })).toBe(true)
    expect(isAdvanceInstallment({ id: "deposit", beforeProduction: false })).toBe(false)
    expect(isAdvanceInstallment({ id: "deposit" })).toBe(true)
    expect(isAdvanceInstallment({ id: "inst_x1" })).toBe(false)
    expect(advanceInstallment(null)).toBeNull()
  })

  it("a seller's own advance row gates the order, and only ITS confirmation in full releases it", () => {
    const own: QuotationInstallment[] = [{ id: "inst_q7", label: "Advance", percent: 40, beforeProduction: true }, { id: "inst_q8", label: "Rest", percent: 60 }]
    const payment = paymentFromQuotation({ installments: own })
    expect(payment).toEqual({ kind: "deposit", depositPercent: 40, depositPaid: false, advanceInstallmentId: "inst_q7" })
    expect(paymentFromQuotation({ installments: AFTER_DELIVERY })).toEqual({ kind: "credit", creditDays: 30 })
    // A 100% advance gates too.
    expect(paymentFromQuotation({ installments: [{ id: "all", label: "All upfront", percent: 100, beforeProduction: true }] }).kind).toBe("deposit")

    const order = { status: "awaiting_deposit", payment } as Pick<SalesOrder, "status" | "payment">
    expect(shouldReleaseOrder(order, "inst_q7", true)).toBe(true)
    expect(shouldReleaseOrder(order, "inst_q7", false)).toBe(false) // 1,000 of 19,734 releases nothing
    expect(shouldReleaseOrder(order, "inst_q8", true)).toBe(false)
    expect(shouldReleaseOrder(order, "deposit", true)).toBe(false)
  })
})

describe("S1 · draft → issued → sent, on the real writes", () => {
  it("figures lock on issue, the document on sending, and validity starts on the send date", async () => {
    seed("salesQuoteRequests/rq1", { organizationId: ORG, requestNumber: "RQ-2026/031", contactId: "c1", status: "new", lines: [], requestedByUserId: "crm", requestedByUserName: "Huda", requestedAt: NOW.toISOString(), draftQuotationId: null })
    const { id } = await createQuotation(db, { organizationId: ORG, data: draftData({ requestId: "rq1" }), actor: REEM })

    await expect(logQuotationSent(db, { quotationId: id, actor: REEM })).rejects.toThrow("not_issued")
    await expect(issueQuotation(db, { quotationId: id, context: ctx({ capPercent: 0 }), actor: REEM })).resolves.toBeTruthy()

    let q = quote(id)
    expect(q).toMatchObject({ status: "issued", issuedByUserName: "Reem", issuedAt: NOW.toISOString(), validUntil: null })
    // Issuing is what answers the request.
    expect(readDoc<{ status: string; quotationId: string }>("salesQuoteRequests/rq1")).toMatchObject({ status: "quoted", quotationId: id, quotationNumber: "QT-2026/001" })
    await expect(issueQuotation(db, { quotationId: id, context: ctx(), actor: REEM })).rejects.toThrow("not_draft")

    jest.setSystemTime(new Date("2026-09-20T09:00:00.000Z"))
    await logQuotationSent(db, { quotationId: id, actor: REEM })
    q = quote(id)
    expect(q).toMatchObject({ status: "sent", sentByUserName: "Reem", validityDays: 14, validUntil: "2026-10-04" })
    expect(quoteEditable(q, "2026-09-20")).toBe("none")
  })

  it("a blocked quote is refused by the write too, and nothing changes", async () => {
    const { id } = await createQuotation(db, { organizationId: ORG, data: draftData({ items: [{ name: DOOR, quantity: 30, unit: "pc", unitPrice: 1140 }] }), actor: REEM })
    await expect(issueQuotation(db, { quotationId: id, context: ctx(), actor: REEM })).rejects.toThrow("blocked:over_cap")
    expect(quote(id).status).toBe("draft")
  })
})

describe("T6 · T7 · T8 — revision, expiry, loss", () => {
  async function sent(over: Record<string, unknown> = {}): Promise<string> {
    const { id } = await createQuotation(db, { organizationId: ORG, data: draftData(over), actor: REEM })
    await issueQuotation(db, { quotationId: id, context: ctx(), actor: REEM })
    await logQuotationSent(db, { quotationId: id, actor: REEM })
    return id
  }

  it("a revision is a NEW draft with the base number and a suffix; the original stays, superseded", async () => {
    const id = await sent({ requestId: "rq9", opportunityId: "opp1", terms: "Standard" })
    const rev = await reviseQuotation(db, { quotationId: id, today: TODAY, actor: REEM })
    expect(quote(rev)).toMatchObject({ status: "draft", quotationNumber: "QT-2026/001-2", revision: 2, revisionOf: id, requestId: "rq9", opportunityId: "opp1", terms: "Standard", validUntil: null, createdByUserName: "Reem" })
    expect(quote(rev).items).toEqual(quote(id).items)
    expect(quote(id)).toMatchObject({ status: "sent", supersededById: rev, supersededAt: NOW.toISOString() })
    expect(quoteLifecycle(quote(id), TODAY)).toBe("superseded")
    await expect(reviseQuotation(db, { quotationId: id, today: TODAY, actor: REEM })).rejects.toThrow("cannot_revise")
    await expect(closeQuotationLost(db, { quotationId: id, reason: "x", actor: REEM })).rejects.toThrow("not_sent")

    // …then -3, still under the original.
    await issueQuotation(db, { quotationId: rev, context: ctx(), actor: REEM })
    const third = await reviseQuotation(db, { quotationId: rev, today: TODAY, actor: REEM })
    expect(quote(third)).toMatchObject({ quotationNumber: "QT-2026/001-3", revision: 3, revisionOf: id })
    // A revision consumes no new number.
    const next = await createQuotation(db, { organizationId: ORG, data: draftData(), actor: REEM })
    expect(next.quotationNumber).toBe("QT-2026/002")
  })

  it("a draft cannot be revised — it is simply edited", async () => {
    const { id } = await createQuotation(db, { organizationId: ORG, data: draftData(), actor: REEM })
    await expect(reviseQuotation(db, { quotationId: id, today: TODAY, actor: REEM })).rejects.toThrow("cannot_revise")
  })

  it("an expired quote is extended 14 days at the same prices, or lost — with a written reason", async () => {
    const id = await sent()
    await expect(extendQuotation(db, { quotationId: id, today: TODAY, actor: REEM })).rejects.toThrow("not_expired")
    const later = "2026-10-05"
    expect(quoteLifecycle(quote(id), later)).toBe("expired")
    await extendQuotation(db, { quotationId: id, today: later, actor: REEM })
    expect(quote(id)).toMatchObject({ validUntil: "2026-10-19", amount: 36000 })
    expect(quoteLifecycle(quote(id), later)).toBe("sent")

    await expect(closeQuotationLost(db, { quotationId: id, reason: "  ", actor: REEM })).rejects.toThrow("reason_required")
    await closeQuotationLost(db, { quotationId: id, reason: "Price — a competitor was 6% lower", actor: REEM })
    expect(quote(id)).toMatchObject({ status: "rejected", lostReason: "Price — a competitor was 6% lower", rejectedAt: NOW.toISOString() })
    expect(quoteActions(quote(id), later)).toEqual([])
  })
})

describe("T9 · conversion", () => {
  const live = (over: Partial<CrmQuotation> = {}) =>
    ({ id: "q", status: "sent", validUntil: "2026-10-01", contactId: "c1", items: [{ name: DOOR, quantity: 30, unit: "pc", unitPrice: 1200 }], installments: STD, ...over }) as CrmQuotation

  it("SO-01 · SO-03 · only a sent, still-valid quote for a CRM client", () => {
    expect(convertBlocks(live(), TODAY, ctx())).toEqual([])
    expect(convertBlocks(live({ status: "issued" }), TODAY, ctx())).toEqual(["not_sent"])
    expect(convertBlocks(live({ status: "draft" }), TODAY, ctx())).toEqual(["not_sent"])
    expect(convertBlocks(live({ validUntil: "2026-09-01" }), TODAY, ctx())).toEqual(["expired"])
    expect(convertBlocks(live({ supersededById: "r2" }), TODAY, ctx())).toEqual(["superseded"])
    expect(convertBlocks(live({ contactId: "" }), TODAY, ctx())).toEqual(["client_required"])
  })

  it("SO-04 · stock that covered the line at quote time and ran out blocks the conversion", () => {
    const q = live({ items: [{ name: CANOPY, quantity: 4, unit: "pc", unitPrice: 17000 }], installments: AFTER_DELIVERY })
    expect(convertBlocks(q, TODAY, ctx({ stockByName: new Map([[CANOPY, 4]]) }))).toEqual([])
    expect(convertBlocks(q, TODAY, ctx({ stockByName: new Map([[CANOPY, 1]]) }))).toEqual(["advance_required"])
  })

  it("the order and the 'won' flip land together; a made-to-order quote opens NO work order; pressing again is safe", async () => {
    seed("mfgProducts/p1", { organizationId: ORG, name: CANOPY })
    const { id } = await createQuotation(db, { organizationId: ORG, data: draftData({ items: [{ name: CANOPY, quantity: 4, unit: "pc", unitPrice: 17000 }], amount: 68000 }), actor: REEM })
    const q = quote(id)
    const input = {
      orgId: ORG,
      user: REEM,
      promiseDate: "2026-11-01",
      quotation: { id, quotationNumber: q.quotationNumber, contactId: "c1", contactName: "Al-Diyar", amount: 68000, items: q.items ?? null, installments: STD, phase: "pre_manufacturing" as const, workOrderId: null, vatPercent: 15 },
      notification: { title: "t", message: () => "m" },
    }
    const result = await runQuotationAcceptance(db, input)
    expect(result.salesOrderId).toBeTruthy()
    expect(result.workOrderId).toBeNull()
    expect(listCollection("workOrders")).toEqual([])

    const order = readDoc<SalesOrder>(`salesOrders/${result.salesOrderId}`)!
    expect(order).toMatchObject({ status: "awaiting_deposit", quotationId: id, promiseDate: "2026-11-01", paymentSchedule: STD, payment: { kind: "deposit", depositPercent: 30, advanceInstallmentId: "deposit" } })
    expect(order.log?.[0]).toMatchObject({ kind: "created", by: "Reem" })
    expect(quote(id)).toMatchObject({ status: "accepted", salesOrderId: result.salesOrderId, acceptedAt: NOW.toISOString() })

    await runQuotationAcceptance(db, input)
    expect(listCollection("salesOrders")).toHaveLength(1)
  })
})

describe("D10 · a rep sees only his own clients", () => {
  it("by the client's owner in CRM; an unowned client is everybody's; what he wrote is his", () => {
    const rep = { userId: "reem", seesAll: false }
    expect(inSalesScope(rep, { contactOwnerId: "reem" })).toBe(true)
    expect(inSalesScope(rep, { contactOwnerId: "majed" })).toBe(false)
    expect(inSalesScope(rep, { contactOwnerId: null })).toBe(true)
    expect(inSalesScope(rep, { contactOwnerId: "majed", createdByUserId: "reem" })).toBe(true)
    expect(inSalesScope({ userId: "majed", seesAll: true }, { contactOwnerId: "reem" })).toBe(true)
  })
})

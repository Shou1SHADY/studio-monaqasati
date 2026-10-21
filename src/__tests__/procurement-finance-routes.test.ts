/** @jest-environment node */
/**
 * Procurement 1.5, PUR-10 — the server's side of a company without Finance: the payment mark takes an optional copy of
 * the transfer (PDF or image, size-limited, checked against the caller's company), and the invoice file and the
 * accountant's e-mail exist only there — with Finance in the package they are refused (409), like the payment mark.
 */

import { NextRequest } from "next/server"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
const mockCaller = jest.fn()
const mockSaved: Array<{ path: string; size: number; contentType: string }> = []
const mockSendEmail = jest.fn(async (_m: { to: string }) => ({ sent: true }))

jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async (t: string) => { if (t !== "good") throw new Error("bad"); return { uid: "u1" } } }),
  getAdminFirestore: () => mockDb,
  getAdminStorage: () => ({ bucket: () => ({ file: (path: string) => ({ save: async (buf: Buffer, opts: { contentType: string }) => void mockSaved.push({ path, size: buf.length, contentType: opts.contentType }) }) }) }),
  getStorageBucketName: () => "bkt",
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { arrayUnion: (...xs: unknown[]) => ({ union: xs }), serverTimestamp: () => "TS" } }))
jest.mock("@/lib/receipt-links", () => ({ callerOf: (...a: unknown[]) => mockCaller(...a) }))
jest.mock("@/lib/email", () => ({ sendEmail: (m: { to: string }) => mockSendEmail(m) }))

import { POST as paymentMark } from "@/app/api/procurement/payment-mark/route"
import { POST as invoiceFile } from "@/app/api/procurement/invoice-file/route"
import { POST as toAccountant } from "@/app/api/procurement/to-accountant/route"

const ORG = "org1"
const order = () => ({ organizationId: ORG, docNumber: "PO-2026/001", supplierName: "S", status: "accepted", approvedAt: "2026-10-01T08:00:00Z", totalExVat: 1000, vatRate: 0.15, lines: [], leadTimeDays: 10, promisedDate: "2026-10-05", invoiceFiles: [] })
const approver = { uid: "u1", orgId: ORG, name: "Noura", can: (p: string) => p === "po.approve" || p === "offers.accept" }

const headers = { authorization: "Bearer good" }
const multipart = (url: string, fields: Record<string, string>, file?: File) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (file) fd.append("file", file)
  return new NextRequest(`http://localhost${url}`, { method: "POST", headers, body: fd })
}
const jsonReq = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) })
const png = (size = 10, name = "transfer.png", type = "image/png") => new File([new Uint8Array(size)], name, { type })
const lastPatch = () => mockDb.writes.filter(([p]) => p === "purchaseOrders/po1").at(-1)?.[1] as Record<string, unknown> | undefined

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.writes.length = 0
  mockSaved.length = 0
  mockSendEmail.mockClear()
  mockCaller.mockReset()
  mockCaller.mockResolvedValue(approver)
  mockDb.seed("purchaseOrders/po1", order())
  mockDb.seed("procurementSettings/org1", { accountantEmail: "acc@company.sa" })
})

const financeOff = () => mockDb.seed(`companyModules/${ORG}`, { off: ["payments"] })

describe("the payment mark carries an optional copy of the transfer", () => {
  it("a PNG goes to the order's folder and is read back on the mark", async () => {
    financeOff()
    const res = await paymentMark(multipart("/api/procurement/payment-mark", { poId: "po1", kind: "status", state: "part", day: "2026-10-10", amount: "500", reference: "R-77" }, png()))
    expect(res.status).toBe(200)
    expect(mockSaved).toHaveLength(1)
    expect(mockSaved[0].path).toMatch(/^purchase-orders\/org1\/po1\/transfers\/\d+-transfer\.png$/)
    const body = (await res.json()) as { data: { file: { name: string; url: string } } }
    expect(body.data.file).toMatchObject({ name: "transfer.png" })
    const patch = lastPatch() as { paymentMark: { state: string; amount: number; reference: string; file: { name: string; url: string } } }
    expect(patch.paymentMark).toMatchObject({ state: "part", amount: 500, reference: "R-77", file: { name: "transfer.png" } })
    expect(patch.paymentMark.file.url).toContain("firebasestorage.googleapis.com/v0/b/bkt/o/")
  })

  it("the advance marked paid keeps its copy too, and still moves the supplier's date", async () => {
    financeOff()
    await paymentMark(multipart("/api/procurement/payment-mark", { poId: "po1", kind: "advance", day: "2026-10-12" }, png()))
    expect(lastPatch()).toMatchObject({ advancePaidDay: "2026-10-12", advanceFile: { name: "transfer.png" }, promisedDate: "2026-10-22" })
  })

  it("no copy is needed — a plain JSON mark works as before", async () => {
    financeOff()
    const res = await paymentMark(jsonReq("/api/procurement/payment-mark", { poId: "po1", kind: "status", state: "paid", day: "2026-10-10" }))
    expect(res.status).toBe(200)
    expect(mockSaved).toHaveLength(0)
    expect((lastPatch() as { paymentMark: Record<string, unknown> }).paymentMark).not.toHaveProperty("file")
  })

  it("only a PDF or an image, within the limit — nothing is stored otherwise", async () => {
    financeOff()
    const exe = await paymentMark(multipart("/api/procurement/payment-mark", { poId: "po1", kind: "status", state: "paid", day: "2026-10-10" }, png(10, "x.exe", "application/octet-stream")))
    expect(exe.status).toBe(400)
    expect(((await exe.json()) as { code: string }).code).toBe("BAD_TYPE")
    const big = await paymentMark(multipart("/api/procurement/payment-mark", { poId: "po1", kind: "status", state: "paid", day: "2026-10-10" }, png(5 * 1024 * 1024)))
    expect(((await big.json()) as { code: string }).code).toBe("TOO_BIG")
    expect(mockSaved).toHaveLength(0)
    expect(lastPatch()).toBeUndefined()
  })

  it("another company's order is not found, and a copy is not stored for it", async () => {
    financeOff()
    mockDb.seed("purchaseOrders/po1", { ...order(), organizationId: "someone-else" })
    const res = await paymentMark(multipart("/api/procurement/payment-mark", { poId: "po1", kind: "status", state: "paid", day: "2026-10-10" }, png()))
    expect(res.status).toBe(404)
    expect(mockSaved).toHaveLength(0)
  })

  it("with Finance in the package it is refused", async () => {
    const res = await paymentMark(multipart("/api/procurement/payment-mark", { poId: "po1", kind: "status", state: "paid", day: "2026-10-10" }, png()))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe("FINANCE_ON")
  })
})

describe("the accountant path exists only without Finance", () => {
  it("the supplier's invoice file is refused with Finance, accepted without", async () => {
    const withFinance = await invoiceFile(multipart("/api/procurement/invoice-file", { poId: "po1", number: "INV-1" }, png(10, "inv.pdf", "application/pdf")))
    expect(withFinance.status).toBe(409)
    expect(((await withFinance.json()) as { code: string }).code).toBe("FINANCE_ON")
    expect(mockSaved).toHaveLength(0)

    financeOff()
    const without = await invoiceFile(multipart("/api/procurement/invoice-file", { poId: "po1", number: "INV-1" }, png(10, "inv.pdf", "application/pdf")))
    expect(without.status).toBe(200)
    expect(mockSaved[0].path).toContain("/invoices/")
  })

  it("«أرسلها للمحاسب» and the period's export are refused with Finance", async () => {
    const invoice = await toAccountant(jsonReq("/api/procurement/to-accountant", { kind: "invoice", poId: "po1", url: "https://x/f.pdf", name: "f.pdf" }))
    expect(invoice.status).toBe(409)
    const exp = await toAccountant(jsonReq("/api/procurement/to-accountant", { kind: "export", filename: "orders.csv", content: "a,b", period: "Sep" }))
    expect(exp.status).toBe(409)
    expect(mockSendEmail).not.toHaveBeenCalled()

    financeOff()
    const ok = await toAccountant(jsonReq("/api/procurement/to-accountant", { kind: "export", filename: "orders.csv", content: "a,b", period: "Sep" }))
    expect(ok.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "acc@company.sa" }))
  })
})

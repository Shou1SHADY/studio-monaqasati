/**
 * Supplier 1.0, contractor side — Finance tells the supplier about a transfer, the buyer accepts a warranty (both are
 * asked of the server), a buyer answers a supplier's request to connect, and the order freezes the offer's terms.
 */

import { updateDoc } from "firebase/firestore"
import { ActRefused, callAct } from "@/lib/supplier-free/act-client"
import { emitProcEvent } from "@/lib/procurement/events"
import { acceptSupplierWarranty, answerConnectionRequest, reportTransferToSupplier } from "@/lib/procurement/supplier-acts-writes"
import { frozenTermsOf } from "@/lib/procurement/terms-freeze"
import { ProcWriteError } from "@/lib/procurement/writes"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"

jest.mock("@/lib/supplier-free/act-client", () => {
  class ActRefused extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return { ActRefused, callAct: jest.fn(async () => ({ id: "tr1" })) }
})
jest.mock("firebase/firestore", () => ({
  updateDoc: jest.fn(async () => undefined),
  collection: jest.fn((_db: unknown, name: string) => ({ name })),
  doc: jest.fn((_db: unknown, name: string, id: string) => ({ name, id })),
  serverTimestamp: jest.fn(() => "TS"),
}))
jest.mock("@/lib/procurement/events", () => ({
  emitProcEvent: jest.fn(async () => 1),
  sarText: (n: number) => `${n} SAR`,
}))

const db = {} as never
const actor = (over: Partial<ProcActor> = {}): ProcActor => ({ uid: "u1", name: "Finance", isOwner: false, canApprove: false, canPrepare: false, canExpedite: false, canReceive: false, seesPrices: true, ...over })
const po = { id: "po1", organizationId: "buyer", rfqId: "r1", offerId: "o1", docNumber: "PO-2026/001", supplierOrgId: "sup", supplierUserId: "supUser" } as unknown as PurchaseOrder
const input = { amount: 1150, bank: " Al Rajhi ", reference: " TX-9 ", valueDate: "2026-10-12" }

beforeEach(() => jest.clearAllMocks())

describe("reportTransferToSupplier", () => {
  it("asks the server to record it, with the figures trimmed", async () => {
    const id = await reportTransferToSupplier(db, actor(), true, po, input)
    expect(id).toBe("tr1")
    expect(callAct).toHaveBeenCalledWith({ action: "transfer.report", poId: "po1", amount: 1150, bank: "Al Rajhi", reference: "TX-9", valueDate: "2026-10-12" })
  })

  it("refuses someone who is not Finance, a zero amount and an off-platform supplier before asking", async () => {
    await expect(reportTransferToSupplier(db, actor(), false, po, input)).rejects.toMatchObject({ code: "no_permission" })
    await expect(reportTransferToSupplier(db, actor(), true, po, { ...input, amount: 0 })).rejects.toBeInstanceOf(ProcWriteError)
    await expect(reportTransferToSupplier(db, actor(), true, { ...po, supplierOrgId: "guest" } as PurchaseOrder, input)).rejects.toMatchObject({ code: "wrong_state" })
    expect(callAct).not.toHaveBeenCalled()
  })

  it("a refusal from the server is said the way the drawer says write errors", async () => {
    ;(callAct as jest.Mock).mockRejectedValueOnce(new ActRefused("no_permission"))
    await expect(reportTransferToSupplier(db, actor(), true, po, input)).rejects.toMatchObject({ code: "no_permission" })
    ;(callAct as jest.Mock).mockRejectedValueOnce(new ActRefused("wrong_state"))
    await expect(reportTransferToSupplier(db, actor(), true, po, input)).rejects.toMatchObject({ code: "wrong_state" })
  })
})

describe("acceptSupplierWarranty", () => {
  it("asks the server to accept it", async () => {
    await acceptSupplierWarranty(db, actor({ canPrepare: true }), po, { id: "w1", itemName: "Roof membrane" })
    expect(callAct).toHaveBeenCalledWith({ action: "warranty.accept", warrantyId: "w1" })
  })

  it("is for the owner, a buyer or an approver only", async () => {
    await expect(acceptSupplierWarranty(db, actor(), po, { id: "w1", itemName: "x" })).rejects.toMatchObject({ code: "no_permission" })
    expect(callAct).not.toHaveBeenCalled()
  })
})

describe("answerConnectionRequest", () => {
  const req = { id: "l1", supplierOrgId: "sup", supplierName: "Supplier Co" }

  it("accepting activates the link and tells the supplier his request was accepted", async () => {
    await answerConnectionRequest(db, actor({ isOwner: true }), true, "buyer", req, true, { orgName: "Buyer Co" })
    expect(updateDoc).toHaveBeenCalledWith({ name: "contractorSupplierLinks", id: "l1" }, expect.objectContaining({ status: "active" }))
    expect(emitProcEvent).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ kind: "sup_request_accepted", to: [{ users: ["sup"] }], link: "/supplier/connections" }))
  })

  it("declining rejects the link and tells him", async () => {
    await answerConnectionRequest(db, actor({ isOwner: true }), true, "buyer", req, false)
    expect(updateDoc).toHaveBeenCalledWith({ name: "contractorSupplierLinks", id: "l1" }, expect.objectContaining({ status: "rejected" }))
    expect(emitProcEvent).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ kind: "sup_request_declined" }))
  })

  it("is for the managers only", async () => {
    await expect(answerConnectionRequest(db, actor(), false, "buyer", req, true)).rejects.toMatchObject({ code: "no_permission" })
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe("frozenTermsOf", () => {
  it("an advance splits the schedule: the advance now, the rest on the credit period", () => {
    expect(frozenTermsOf({ advancePercent: 30, creditDays: 45 })).toEqual({ termsList: [{ pct: 30, days: 0 }, { pct: 70, days: 45 }] })
    expect(frozenTermsOf({ advancePercent: "25" })).toEqual({ termsList: [{ pct: 25, days: 0 }, { pct: 75, days: 30 }] })
  })

  it("credit alone is one instalment; nothing stated freezes nothing", () => {
    expect(frozenTermsOf({ creditDays: 60 })).toEqual({ termsList: [{ pct: 100, days: 60 }] })
    expect(frozenTermsOf({})).toEqual({})
    expect(frozenTermsOf({ advancePercent: 100 })).toEqual({})
  })
})

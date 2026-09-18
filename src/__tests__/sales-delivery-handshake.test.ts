/**
 * The customer delivery, end to end on the in-memory Firestore (Sales PRD
 * DLV-01…05, T16–T21, INV-09, scenario S6): Sales requests, Inventory
 * authorises against stock it truly has, the client signs for what actually
 * arrived — and only then does stock leave, at that quantity. A hold is
 * Finance's; a return is the manager's to approve and Finance's to settle.
 *
 * Every write here is the real one a screen calls.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/accounting/hooks", () => ({
  onSalesCreditNoteIssued: jest.fn(),
  onSalesDelivered: jest.fn(),
  onSalesInvoiceIssued: jest.fn(),
  onSalesInvoicePaid: jest.fn(),
}))

import type { Firestore } from "firebase/firestore"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { onSalesDelivered } from "@/lib/accounting/hooks"
import {
  claimedFromWarehouse,
  deliveredSales,
  deliveryNoteValue,
  deliveryShortfalls,
  orderLineProgress,
  returnableQty,
  signedLines,
  trulyAvailable,
  validateSignature,
  type SalesDeliveryNote,
  type SalesOrder,
  type SalesReturn,
} from "@/lib/sales-orders"
import {
  authorizeDelivery,
  confirmDelivery,
  decideReturn,
  holdDelivery,
  issueCreditNote,
  releaseDelivery,
  requestDeliveryRelease,
  requestReturn,
  scheduleBlock,
  scheduleDelivery,
} from "@/lib/sales-order-writes"

const db = fakeFirestore as unknown as Firestore
const NOW = new Date("2026-09-17T08:00:00.000Z")
const ORG = "org1"
const REEM = { id: "reem", name: "Reem" } // sales rep
const MAJED = { id: "majed", name: "Majed" } // sales manager
const SALEM = { id: "salem", name: "Salem" } // storekeeper
const NOURA = { id: "noura", name: "Noura" } // finance

const DOOR = "HDF door"

function seedOrder(over: Partial<SalesOrder> = {}): SalesOrder {
  seed("salesOrders/so1", {
    organizationId: ORG,
    orderNumber: 40,
    type: "standard",
    status: "running",
    contactId: "c1",
    contactName: "Al-Diyar",
    payment: { kind: "credit", creditDays: 30 },
    vatPercent: 15,
    lines: [{ name: DOOR, unit: "pc", quantity: 120, unitPrice: 1180, unitCost: 900 }],
    createdByUserId: REEM.id,
    createdByUserName: REEM.name,
    ...over,
  })
  return readDoc<SalesOrder>("salesOrders/so1")!
}

const seedStock = (quantity: number) => seed("warehouses/wh1/inventoryItems/row1", { name: DOOR, quantity })
const stockRows = () => listCollection<{ name: string; quantity: number }>("warehouses/wh1/inventoryItems")
const onHand = () => readDoc<{ quantity: number }>("warehouses/wh1/inventoryItems/row1")!.quantity
const notes = () => listCollection<SalesDeliveryNote>("salesDeliveryNotes")
const note = (id: string) => readDoc<SalesDeliveryNote>(`salesDeliveryNotes/${id}`)!
const order = () => readDoc<SalesOrder>("salesOrders/so1")!

const schedule = (quantity: number) =>
  scheduleDelivery(db, { order: order(), lines: [{ name: DOOR, quantity }], warehouseId: "wh1", warehouseName: "Main", receiverName: null, stockRows: stockRows(), allNotes: notes(), actor: REEM })
const authorize = (id: string) => authorizeDelivery(db, { note: note(id), stockRows: stockRows(), allNotes: notes(), actor: SALEM })
const sign = (id: string, signerName: string, quantity?: number) =>
  confirmDelivery(db, { note: note(id), order: order(), allNotes: notes(), stockRows: stockRows(), signerName, signed: quantity == null ? [] : [{ name: DOOR, quantity }], actor: REEM })

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
})
afterAll(() => jest.useRealTimers())
beforeEach(() => {
  resetFakeDb()
  jest.clearAllMocks()
  jest.setSystemTime(NOW)
})

describe("what the warehouse can truly give", () => {
  const open = (id: string, status: SalesDeliveryNote["status"], quantity: number, warehouseId = "wh1") =>
    ({ id, status, warehouseId, lines: [{ name: DOOR, quantity }] }) as SalesDeliveryNote

  it("on hand, less what other open notes already claim — held ones too, delivered ones not", () => {
    const all = [open("a", "requested", 30), open("b", "authorized", 20), open("c", "held", 10), open("d", "delivered", 99), open("e", "requested", 50, "wh2")]
    expect(claimedFromWarehouse(all, "wh1", DOOR)).toBe(60)
    expect(claimedFromWarehouse(all, "wh1", DOOR, "a")).toBe(30) // a note never competes with itself
    expect(claimedFromWarehouse(all, "wh1", "  hdf DOOR ")).toBe(60)
    expect(trulyAvailable(100, 60)).toBe(40)
    expect(trulyAvailable(10, 60)).toBe(0)
  })

  it("names the lines that ask for more", () => {
    const all = [open("a", "requested", 30)]
    expect(deliveryShortfalls([{ name: DOOR, quantity: 70 }], "wh1", [{ name: DOOR, quantity: 100 }], all)).toEqual([])
    expect(deliveryShortfalls([{ name: DOOR, quantity: 71 }], "wh1", [{ name: DOOR, quantity: 100 }], all)).toEqual([{ name: DOOR, wanted: 71, available: 70 }])
    expect(deliveryShortfalls([{ name: "Unknown", quantity: 1 }], "wh1", [], [])).toEqual([{ name: "Unknown", wanted: 1, available: 0 }])
  })
})

describe("the signature", () => {
  const n = { lines: [{ name: DOOR, quantity: 120 }] }

  it("needs a name, something received, and never more than was sent", () => {
    expect(validateSignature(n, "  ", [])).toBe("signer_required")
    expect(validateSignature(n, "Fahad", [{ name: DOOR, quantity: 0 }])).toBe("nothing_received")
    expect(validateSignature(n, "Fahad", [{ name: DOOR, quantity: 121 }])).toBe("over_requested")
    expect(validateSignature(n, "Fahad", [{ name: DOOR, quantity: -1 }])).toBe("invalid_quantity")
    expect(validateSignature(n, "Fahad", [{ name: DOOR, quantity: NaN }])).toBe("invalid_quantity")
    expect(validateSignature(n, "Fahad", [])).toBeNull() // signs for all of it
    expect(validateSignature(n, "Fahad", [{ name: DOOR, quantity: 118 }])).toBeNull()
  })

  it("keeps the requested quantity beside the received one only when they differ", () => {
    expect(signedLines(n, [])).toEqual([{ name: DOOR, quantity: 120 }])
    expect(signedLines(n, [{ name: DOOR, quantity: 118 }])).toEqual([{ name: DOOR, quantity: 118, requestedQuantity: 120 }])
  })
})

describe("DLV-01 · scheduling", () => {
  it("only an order in progress ships, never above what is open or what the shelf truly holds", async () => {
    seedStock(100)
    const running = seedOrder()
    const base = { order: running, warehouseId: "wh1", stockRows: stockRows(), allNotes: [] as SalesDeliveryNote[] }
    expect(scheduleBlock({ ...base, lines: [{ name: DOOR, quantity: 100 }] })).toBeNull()
    expect(scheduleBlock({ ...base, lines: [{ name: DOOR, quantity: 101 }] })).toBe("insufficient_stock")
    expect(scheduleBlock({ ...base, lines: [{ name: DOOR, quantity: 121 }] })).toBe("over_open")
    expect(scheduleBlock({ ...base, lines: [{ name: DOOR, quantity: 0 }] })).toBe("lines_required")
    expect(scheduleBlock({ ...base, order: { ...running, status: "awaiting_deposit" }, lines: [{ name: DOOR, quantity: 10 }] })).toBe("order_not_running")

    await expect(schedule(101)).rejects.toThrow("insufficient_stock")
    expect(notes()).toEqual([])

    // A second note competes with the first for the same shelf.
    await schedule(70)
    await expect(schedule(40)).rejects.toThrow("insufficient_stock")
    await schedule(30)
    expect(notes().map((x) => x.status)).toEqual(["requested", "requested"])
    expect(onHand()).toBe(100) // nothing has moved
  })
})

describe("S6 · the three-step handshake", () => {
  it("Inventory authorises, the client signs for 118 of 120, and value, stock and what is owed follow the signature", async () => {
    seedStock(150)
    seedOrder()
    const id = await schedule(120)

    // Step 3 cannot come before step 2.
    await expect(sign(id, "Fahad Al-Harbi", 118)).rejects.toThrow("not_authorized")

    await authorize(id)
    expect(note(id)).toMatchObject({ status: "authorized", authorizedByUserId: SALEM.id, authorizedByUserName: SALEM.name, authorizedAt: NOW.toISOString() })
    await expect(authorize(id)).rejects.toThrow("not_requested")
    expect(onHand()).toBe(150) // authorising reserves nothing on the shelf itself

    await expect(sign(id, "", 118)).rejects.toThrow("signer_required")
    await expect(sign(id, "Fahad Al-Harbi", 121)).rejects.toThrow("over_requested")
    expect(note(id).status).toBe("authorized")

    await sign(id, "Fahad Al-Harbi", 118)
    const signed = note(id)
    expect(signed).toMatchObject({ status: "delivered", signerName: "Fahad Al-Harbi", signedAt: NOW.toISOString(), deliveredByUserId: REEM.id })
    expect(signed.lines).toEqual([{ name: DOOR, quantity: 118, requestedQuantity: 120 }])

    // Stock left at the signed quantity; the value counts 118; two are still owed.
    expect(onHand()).toBe(32)
    expect(deliveryNoteValue(signed, order())).toBe(118 * 1180)
    expect(orderLineProgress(order(), notes())[0]).toMatchObject({ delivered: 118, remaining: 2, open: 2 })
    expect(order().status).toBe("running")
    expect(deliveredSales(notes(), [order()], "2026-09-01", "2026-09-30").external).toBe(118 * 1180)
    expect(onSalesDelivered).toHaveBeenCalledWith(db, expect.anything(), expect.objectContaining({ cost: 118 * 900 }))

    // The last two units close the order.
    const last = await schedule(2)
    await authorize(last)
    await sign(last, "Fahad Al-Harbi")
    expect(order()).toMatchObject({ status: "closed", closedAt: NOW.toISOString() })
    expect(onHand()).toBe(30)
    await expect(sign(last, "Fahad Al-Harbi")).rejects.toThrow("not_authorized") // never twice
  })

  it("INV-09 · stock that vanished between authorising and signing blocks the issue — and writes nothing", async () => {
    seedStock(50)
    seedOrder()
    const id = await schedule(50)
    await authorize(id)
    seedStock(40) // someone else drew from the shelf
    await expect(sign(id, "Fahad", 50)).rejects.toThrow("insufficient_stock")
    expect(note(id).status).toBe("authorized")
    expect(onHand()).toBe(40)
    await sign(id, "Fahad", 40)
    expect(onHand()).toBe(0)
  })

  it("Inventory refuses to authorise above what the shelf truly holds", async () => {
    seedStock(50)
    seedOrder()
    const id = await schedule(50)
    seedStock(20)
    await expect(authorize(id)).rejects.toThrow("insufficient_stock")
    expect(note(id).status).toBe("requested")
  })
})

describe("DLV-03 · a hold is Finance's, and nothing leaves while it stands", () => {
  it("held from either step, blocked at both, released to where it stood — the seller only asks", async () => {
    seedStock(100)
    seedOrder()
    const id = await schedule(60)
    await authorize(id)

    await expect(holdDelivery(db, { noteId: id, reason: " ", actor: NOURA })).rejects.toThrow("reason_required")
    await holdDelivery(db, { noteId: id, reason: "Overdue balance", actor: NOURA })
    expect(note(id)).toMatchObject({ status: "held", heldFrom: "authorized", holdReason: "Overdue balance", heldByUserName: NOURA.name })

    // The one-click bypass is gone.
    await expect(sign(id, "Fahad")).rejects.toThrow("held")
    await expect(authorize(id)).rejects.toThrow("held")
    expect(onHand()).toBe(100)
    // Held goods are still spoken for.
    expect(claimedFromWarehouse(notes(), "wh1", DOOR)).toBe(60)

    await requestDeliveryRelease(db, { noteId: id, actor: REEM })
    expect(note(id)).toMatchObject({ status: "held", releaseRequestedByUserName: REEM.name, releaseRequestedAt: NOW.toISOString() })

    await releaseDelivery(db, { noteId: id, actor: NOURA })
    expect(note(id)).toMatchObject({ status: "authorized", heldFrom: null, releasedByUserName: NOURA.name })
    await expect(releaseDelivery(db, { noteId: id, actor: NOURA })).rejects.toThrow("not_held")
    await expect(requestDeliveryRelease(db, { noteId: id, actor: REEM })).rejects.toThrow("not_held")

    await sign(id, "Fahad")
    await expect(holdDelivery(db, { noteId: id, reason: "too late", actor: NOURA })).rejects.toThrow("not_requested")
  })

  it("a note held before Inventory touched it returns to 'requested'", async () => {
    seedStock(100)
    seedOrder()
    const id = await schedule(10)
    await holdDelivery(db, { noteId: id, reason: "x", actor: NOURA })
    await releaseDelivery(db, { noteId: id, actor: NOURA })
    expect(note(id).status).toBe("requested")
  })
})

describe("DLV-05 · returns", () => {
  async function delivered(quantity: number, received?: number): Promise<SalesDeliveryNote> {
    seedStock(200)
    seedOrder()
    const id = await schedule(quantity)
    await authorize(id)
    await sign(id, "Fahad", received)
    return note(id)
  }
  const returns = () => listCollection<SalesReturn>("salesReturns")
  const ask = (n: SalesDeliveryNote, quantity: number, reason = "Scratched") =>
    requestReturn(db, { order: order(), deliveryNote: n, lines: [{ name: DOOR, quantity }], reason, existingReturns: returns(), actor: REEM })

  it("no return on a shipment the client never signed for", async () => {
    seedStock(200)
    seedOrder()
    const id = await schedule(10)
    await expect(ask(note(id), 1)).rejects.toThrow("not_delivered")
    await authorize(id)
    await expect(ask(note(id), 1)).rejects.toThrow("not_delivered")
  })

  it("never more than was signed for, counting earlier returns that were not rejected", async () => {
    const n = await delivered(120, 118)
    expect(returnableQty(n, DOOR, [])).toBe(118)
    await expect(ask(n, 119)).rejects.toThrow("over_delivered")
    await expect(ask(n, 5, "  ")).rejects.toThrow("reason_required")

    const first = await ask(n, 100)
    expect(returnableQty(n, DOOR, returns())).toBe(18)
    await expect(ask(n, 19)).rejects.toThrow("over_delivered")

    // A rejected return frees its quantity again.
    await decideReturn(db, { salesReturn: readDoc<SalesReturn>(`salesReturns/${first}`)!, approve: false, actor: MAJED })
    expect(returnableQty(n, DOOR, returns())).toBe(118)
  })

  it("the manager approves with a disposition; Finance settles; scrap never goes back on the shelf", async () => {
    const n = await delivered(20)
    expect(onHand()).toBe(180)
    const get = (id: string) => readDoc<SalesReturn>(`salesReturns/${id}`)!

    const toStock = await ask(n, 5)
    await expect(decideReturn(db, { salesReturn: get(toStock), approve: true, actor: MAJED })).rejects.toThrow("disposition_required")
    await expect(issueCreditNote(db, { salesReturn: get(toStock), order: order(), stockRows: [], warehouseId: "wh1", actor: NOURA })).rejects.toThrow("not_approved")
    await decideReturn(db, { salesReturn: get(toStock), approve: true, disposition: "stock", actor: MAJED })
    expect(get(toStock)).toMatchObject({ status: "approved", disposition: "stock", decidedByUserName: MAJED.name })
    await expect(decideReturn(db, { salesReturn: get(toStock), approve: false, actor: MAJED })).rejects.toThrow("already_decided")

    const rows = () => listCollection<{ id: string; name: string; quantity: number }>("warehouses/wh1/inventoryItems")
    await issueCreditNote(db, { salesReturn: get(toStock), order: order(), stockRows: rows(), warehouseId: "wh1", actor: NOURA })
    expect(get(toStock)).toMatchObject({ status: "credit_note_issued", creditNoteByUserName: NOURA.name })
    expect(onHand()).toBe(185)

    const scrapped = await ask(n, 3, "Shattered on site")
    await decideReturn(db, { salesReturn: get(scrapped), approve: true, disposition: "scrap", actor: MAJED })
    await issueCreditNote(db, { salesReturn: get(scrapped), order: order(), stockRows: rows(), warehouseId: "wh1", actor: NOURA })
    expect(get(scrapped).status).toBe("credit_note_issued")
    expect(onHand()).toBe(185)
  })
})

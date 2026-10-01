/**
 * PM supply — a line is served in portions (what a main store issued, and what
 * is bought), and a receipt arrives against ONE of them (STK-09, REQ-04, the
 * edge case «stopping a line whose material is in transit»). What is on the way
 * from the store is capped at what the store issued, however much the supplier
 * delivered; an order still awaiting approval, or cancelled, brings nothing.
 * A line closes "full" only when the requested quantity is in (within 0.005).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { materialKeyOf, storeIdOf, type PmStoreLine } from "@/lib/pm/store"
import {
  lineInTransit,
  lineOut,
  linePortions,
  procurementItems,
  receivable,
  receivablePortions,
  receivedLine,
  reqState,
  requestOf,
  stopBlocks,
  type PmMaterialRequest,
  type ReqLine,
} from "@/lib/pm/supply"
import { PmSupplyError, receiveOnProject, stopLine } from "@/lib/pm/supply-writes"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const siteActor = { uid: "se1", name: "Site" }
const pmActor = { uid: "pm1", name: "PM" }

const cement = materialKeyOf("Cement", "bag")
const line = (over: Partial<ReqLine> = {}): ReqLine => ({ itemId: "i1", code: "04-02-01", key: cement, name: "Cement", unit: "bag", qty: 100, receipts: [], ...over })
const req = (l: ReqLine, over: Partial<PmMaterialRequest> = {}): PmMaterialRequest => ({ id: "01", pm: true, seq: 1, title: "Cement", lines: [l], status: "approved", requestedByUserId: "se1", ...over })
const part = line({ inv: { k: "issue", q: 40, kept: 60, on: "2026-09-20" } })
const rc = (q: number, src?: "stk" | "buy", short = false) => ({ grn: "G", q, rej: 0, on: "2026-09-22", by: "se1", ...(src ? { src } : {}), ...(short ? { short } : {}) })

describe("portions", () => {
  it("a part issue leaves two portions: the store's and the one to buy", () => {
    expect(linePortions(part).map((p) => [p.k, p.q, p.left])).toEqual([
      ["stk", 40, 40],
      ["buy", 60, 60],
    ])
    expect(linePortions(line()).map((p) => [p.k, p.q])).toEqual([["buy", 100]])
  })

  it("with no order yet only what the store issued can be received — 40, not 100", () => {
    const r = req(part)
    expect(receivablePortions(r, r.lines[0]).map((p) => [p.k, p.left])).toEqual([["stk", 40]])
  })

  it("the supplier's 60 in first leaves the store's 40 on the road: still in transit, and the line cannot be stopped", () => {
    const l = { ...part, receipts: [rc(60, "buy")] }
    expect(lineInTransit(l)).toBe(40)
    expect(lineOut(l)).toBe(40)
    expect(stopBlocks({ archived: false, request: req(l, { poId: "po1" }), line: l, why: null, whyNote: null })).toContain("in_transit")
  })

  it("an order awaiting approval, or cancelled, brings nothing; one approved, sent or accepted does", () => {
    const r = req(line(), { poId: "po1" })
    expect(receivable(r, r.lines[0], { status: "awaiting_approval" })).toBe(false)
    expect(receivable(r, r.lines[0], { status: "cancelled" })).toBe(false)
    expect(receivable(r, r.lines[0], { status: "sent" })).toBe(true)
    expect(receivable(r, r.lines[0], { status: "accepted" })).toBe(true)
    // An award older than purchase orders has no order document: the offer was the order.
    expect(receivable(r, r.lines[0], null)).toBe(true)
  })

  it("the store's portion stays receivable while the order waits for its approval", () => {
    const r = req(part, { poId: "po1" })
    expect(receivablePortions(r, r.lines[0], { status: "awaiting_approval" }).map((p) => p.k)).toEqual(["stk"])
    expect(receivablePortions(r, r.lines[0], { status: "accepted" }).map((p) => p.k)).toEqual(["stk", "buy"])
  })

  it("a receipt recorded before portions were kept is read as the store's issue first", () => {
    const l = { ...part, receipts: [rc(50)] }
    expect(linePortions(l).map((p) => [p.k, p.got])).toEqual([
      ["stk", 40],
      ["buy", 10],
    ])
  })
})

describe("closing on receipt", () => {
  it("19,900 of 20,000 leaves the line open: the last 100 can still be received and Procurement's quantity stands", () => {
    const big = line({ qty: 20000 })
    const next = receivedLine(big, rc(19900, "buy"), "2026-09-22", "se1")
    expect(next.cl ?? null).toBeNull()
    expect(lineOut(next)).toBe(100)
    expect(procurementItems({ lines: [next] })[0].quantity).toBe(20000)
    expect(reqState(req(next))).toBe("go")
  })

  it("full once the requested quantity is in, within 0.005", () => {
    expect(receivedLine(line(), rc(99.996, "buy"), "d", "u").cl?.t).toBe("full")
    expect(receivedLine(line(), rc(99.99, "buy"), "d", "u").cl ?? null).toBeNull()
  })

  it("«the rest will not arrive» closes the line short, and says the receiver said so", () => {
    const next = receivedLine(line({ qty: 20000 }), rc(19900, "buy", true), "2026-09-22", "se1")
    expect(next.cl).toMatchObject({ t: "short", why: "rcv", by: "se1" })
    expect(procurementItems({ lines: [next] })[0].quantity).toBe(19900)
  })

  it("shutting one portion leaves the other expected: the line stays open for it", () => {
    const next = receivedLine(part, rc(30, "stk", true), "2026-09-22", "se1")
    expect(next.cl ?? null).toBeNull()
    expect(lineInTransit(next)).toBe(0)
    expect(lineOut(next)).toBe(60)
    const done = receivedLine(next, rc(60, "buy"), "2026-09-25", "se1")
    expect(done.cl).toMatchObject({ t: "short" })
  })
})

describe("writes", () => {
  const P = "projects/p1"
  const R = `${P}/purchaseRequests/01`
  const stored = () => requestOf({ id: "01", ...(readDoc<Record<string, unknown>>(R) as Record<string, unknown>) })
  beforeEach(() => {
    resetFakeDb()
    seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed(`${P}/boqItems/i1`, { itemNo: "04-02-01", descriptionAr: "لياسة", unit: "m2", quantity: 10000, executedQuantity: 2000 })
    seed(`${P}/pmStore/${storeIdOf(cement)}`, { key: cement, name: "Cement", unit: "bag", rates: { i1: { r: 0.2, w: 5, ex0: 1000, src: "rate" } }, moves: [] })
    seed(R, { pm: true, seq: 1, title: "Cement", status: "approved", requestedByUserId: "se1", lines: [{ ...part, inv: { ...part.inv, warehouseName: "Main store" } }], items: [{ name: "Cement", quantity: 100, unit: "bag", itemId: "i1" }] })
  })

  it("no order yet: 100 is refused, the 40 the store issued is received against the store's portion", async () => {
    await expect(receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 100, rej: 0, dn: null, note: null, short: false })).rejects.toMatchObject({ blocks: ["over_remaining"] })
    await receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 40, rej: 0, dn: "DN-1", note: null, short: false })
    const l = stored().lines[0]
    expect(l.receipts?.[0]).toMatchObject({ q: 40, src: "stk" })
    expect(l.cl ?? null).toBeNull()
    expect(readDoc<PmStoreLine>(`${P}/pmStore/${storeIdOf(cement)}`)?.moves.at(-1)).toMatchObject({ t: "rc", q: 40, source: "Main store" })
    // Nothing more is coming until the 60 is ordered.
    await expect(receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 10, rej: 0, dn: null, note: null, short: false })).rejects.toMatchObject({ blocks: ["not_receivable"] })
  })

  it("an order awaiting approval is not received against; once sent it is, and the receiver says which portion arrived", async () => {
    seed(R, { ...(readDoc<Record<string, unknown>>(R) as Record<string, unknown>), poId: "po1", poNumber: "PO-2026/001" })
    seed("purchaseOrders/po1", { organizationId: "org", status: "awaiting_approval", projectId: "p1", docNumber: "PO-2026/001", lines: [{ id: "l1", name: "Cement", unit: "bag", quantity: 60, unitPrice: 20, accepted: 0, rejected: 0, held: 0, cancelled: 0 }], log: [] })
    await expect(receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 60, rej: 0, dn: null, note: null, short: false, portion: "buy" })).rejects.toMatchObject({ blocks: ["not_receivable"] })
    seed("purchaseOrders/po1", { ...(readDoc<Record<string, unknown>>("purchaseOrders/po1") as Record<string, unknown>), status: "accepted" })
    // Both portions are on their way: the receiver must say which one this note is.
    await expect(receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 60, rej: 0, dn: null, note: null, short: false })).rejects.toMatchObject({ blocks: ["no_source"] })
    await receiveOnProject(db, site, "p1", siteActor, "01", 0, { acc: 60, rej: 0, dn: "DN-9", note: null, short: false, portion: "buy" })
    const l = stored().lines[0]
    expect(l.receipts?.[0]).toMatchObject({ q: 60, src: "buy" })
    expect(lineInTransit(l)).toBe(40)
    expect(readDoc<PmStoreLine>(`${P}/pmStore/${storeIdOf(cement)}`)?.moves.at(-1)).toMatchObject({ source: "PO-2026/001" })
    // The store's 40 is on the road: the line is not stopped under it.
    const stop = stopLine(db, pm, "p1", pmActor, "01", 0, "need", null)
    await expect(stop).rejects.toBeInstanceOf(PmSupplyError)
    await expect(stop).rejects.toMatchObject({ blocks: ["in_transit"] })
    expect(stored().lines[0].cl ?? null).toBeNull()
  })
})

describe("a line sourced apart from its request", () => {
  it("a late line's need on the desk opens its own row, not its request's", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { needKeyOfSource } = require("@/lib/procurement/rfq-view") as typeof import("@/lib/procurement/rfq-view")
    expect(needKeyOfSource({ kind: "project_request", projectId: "p", purchaseRequestId: "r" })).toBe("project:p:r")
    expect(needKeyOfSource({ kind: "project_request", projectId: "p", purchaseRequestId: "r", line: 2 })).toBe("project:p:r:L2")
  })
})

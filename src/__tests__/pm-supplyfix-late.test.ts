/**
 * A change line decided AFTER the request was sourced (REQ-01, the prototype's
 * planLate): it is a new line to buy. It never rides the order the request
 * already has — on the project it is "with Procurement", not receivable; on
 * Procurement's desk it is its own need, sourced and linked on its own.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { materialKeyOf, storeIdOf } from "@/lib/pm/store"
import { linePhase, receivable, requestOf } from "@/lib/pm/supply"
import { decideChange } from "@/lib/pm/supply-writes"
import { needSourceParam, parseNeedSource, projectNeed, returnedNeeds, type Need, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { linkNeed, unlinkNeedsFromRfq } from "@/lib/procurement/needs-writes"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const pmActor = { uid: "pm1", name: "PM" }
const P = "projects/p1"
const R = `${P}/purchaseRequests/07`
const cement = materialKeyOf("Cement", "bag")
const mesh = materialKeyOf("Mesh", "m2")

const raw = () => readDoc<Record<string, unknown>>(R) as Record<string, unknown>
const stored = () => requestOf({ id: "07", ...raw() })
const desk = (): Need[] => {
  const n = projectNeed({ id: "p1", name: "Villas" }, { id: "07", ...raw() } as ProjectRequestDoc, "PR-07")
  return [n, ...returnedNeeds([n], [])]
}

beforeEach(() => {
  resetFakeDb()
  seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
  seed(`${P}/boqItems/i1`, { itemNo: "04-02-01", descriptionAr: "لياسة", unit: "m2", quantity: 10000, executedQuantity: 2000 })
  seed(`${P}/pmStore/${storeIdOf(cement)}`, { key: cement, name: "Cement", unit: "bag", rates: { i1: { r: 0.2, w: 5, ex0: 1000, src: "rate" } }, moves: [] })
  seed(R, {
    pm: true,
    seq: 7,
    title: "Cement",
    status: "approved",
    requestedByUserId: "se1",
    poId: "po1",
    poNumber: "PO-2026/001",
    rfqId: "rfq1",
    createdAt: "2026-09-20T08:00:00.000Z",
    lines: [
      { itemId: "i1", code: "04-02-01", key: cement, name: "Cement", unit: "bag", qty: 100, receipts: [] },
      { itemId: "i1", code: "04-02-01", key: mesh, name: "Mesh", unit: "m2", qty: 60, receipts: [], chg: { st: "wait", why: "consultant" } },
    ],
    items: [{ name: "Cement", quantity: 100, unit: "bag", itemId: "i1" }],
  })
})

describe("a change decided after the request was sourced", () => {
  it("does not inherit the request's order on the project: with Procurement, and not receivable", async () => {
    await decideChange(db, pm, "p1", pmActor, "07", 1, { st: "us" })
    const r = stored()
    expect(r.lines[1].late).toBeTruthy()
    expect(linePhase(r, r.lines[1])).toBe("ask")
    expect(receivable(r, r.lines[1], { status: "accepted" })).toBe(false)
    // The line the order was raised for is untouched.
    expect(linePhase(r, r.lines[0])).toBe("po")
    expect(receivable(r, r.lines[0], { status: "accepted" })).toBe(true)
  })

  it("surfaces on Procurement's desk as a new line to buy, apart from the request's order", async () => {
    await decideChange(db, pm, "p1", pmActor, "07", 1, { st: "us" })
    const [main, ...rest] = desk()
    expect(main).toMatchObject({ state: "order", poId: "po1", lines: [{ name: "Cement", quantity: 100 }] })
    expect(rest).toHaveLength(1)
    expect(rest[0]).toMatchObject({
      key: "project:p1:07:L1",
      state: "action",
      rfqId: null,
      poId: null,
      lines: [{ name: "Mesh", unit: "m2", quantity: 60, itemId: "i1" }],
      source: { kind: "project_request", projectId: "p1", purchaseRequestId: "07", line: 1 },
    })
  })

  it("is sourced on its own: its RFQ, then its order, are recorded on the line — the request's links never move", async () => {
    await decideChange(db, pm, "p1", pmActor, "07", 1, { st: "us" })
    const late = desk()[1]
    expect(parseNeedSource(needSourceParam(late.source))).toEqual(late.source)

    await linkNeed(db, late.source, { rfqId: "rfq2", rfqNumber: "RFQ-2" }, "Badr")
    expect(raw()).toMatchObject({ rfqId: "rfq1", poId: "po1", poNumber: "PO-2026/001" })
    expect(desk()[1]).toMatchObject({ state: "rfq", rfqId: "rfq2" })
    const out = stored()
    expect(linePhase(out, out.lines[1])).toBe("rfq")

    await linkNeed(db, late.source, { poId: "po2", poNumber: "PO-2026/002" }, "Badr")
    expect(raw()).toMatchObject({ rfqId: "rfq1", poId: "po1", poNumber: "PO-2026/001" })
    expect(desk()[1]).toMatchObject({ state: "order", poId: "po2", poNumber: "PO-2026/002" })
    const r = stored()
    expect(linePhase(r, r.lines[1])).toBe("po")
    expect(receivable(r, r.lines[1], { status: "accepted" })).toBe(true)
  })

  it("a deleted draft RFQ hands the late line back to the desk, and only it", async () => {
    await decideChange(db, pm, "p1", pmActor, "07", 1, { st: "us" })
    const late = desk()[1]
    await linkNeed(db, late.source, { rfqId: "rfq2", rfqNumber: null }, "Badr")
    expect(await unlinkNeedsFromRfq(db, "rfq2", [late.source as Parameters<typeof unlinkNeedsFromRfq>[2][number]])).toBe(0)
    expect(desk()[1]).toMatchObject({ state: "action", rfqId: null })
    expect(raw()).toMatchObject({ rfqId: "rfq1", poId: "po1" })
  })

  it("a change decided before anyone sourced the request simply joins it", async () => {
    seed(R, { ...raw(), poId: null, poNumber: null, rfqId: null })
    await decideChange(db, pm, "p1", pmActor, "07", 1, { st: "us" })
    const r = stored()
    expect(r.lines[1].late ?? null).toBeNull()
    expect(desk()).toHaveLength(1)
    expect(desk()[0]).toMatchObject({ state: "action", lines: [{ name: "Cement" }, { name: "Mesh", quantity: 60 }] })
  })
})

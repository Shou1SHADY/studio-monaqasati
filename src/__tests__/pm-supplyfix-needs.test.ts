/**
 * Procurement's needs desk at the PM boundary:
 *   · a PM request reaches the desk only once the project manager approved it
 *     technically (REQ-02) — `pending` there is not "waiting on the warehouse";
 *   · Inventory's reply is read per request LINE, so two lines of one material
 *     on two BOQ items never borrow each other's reply.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { materialKeyOf } from "@/lib/pm/store"
import { procurementItems, type ReqLine } from "@/lib/pm/supply"
import { recordNeedDecision } from "@/lib/procurement/need-decision-writes"
import { projectNeed, type ProjectRequestDoc } from "@/lib/procurement/needs"
import type { ProcActor } from "@/lib/procurement/types"

const db = fakeFirestore as unknown as Firestore
const project = { id: "p1", name: "Villas" }
const cement = materialKeyOf("Cement", "bag")
const line = (over: Partial<ReqLine> = {}): ReqLine => ({ itemId: "A", code: "04-01", key: cement, name: "Cement", unit: "bag", qty: 100, receipts: [], ...over })
const doc = (lines: ReqLine[], over: Partial<ProjectRequestDoc> = {}): ProjectRequestDoc => ({ id: "01", pm: true, status: "approved", title: "Cement", lines, items: procurementItems({ lines }), createdAt: "2026-09-20T08:00:00.000Z", ...over })
const buyer: ProcActor = { uid: "buyer", name: "Badr", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }

describe("a PM request the manager has not approved (REQ-02)", () => {
  it("is not on Procurement's desk — however old it is", () => {
    const n = projectNeed(project, doc([line()], { status: "pending" }), "PR-01")
    expect(n.lines).toEqual([])
    // Not even when someone had already «proceeded» on it under the old reading.
    const proceeded = projectNeed(project, doc([line()], { status: "pending", procDecision: { kind: "proceed_full", at: "2026-09-25T08:00:00.000Z", byName: "Badr" } }), "PR-01")
    expect(proceeded.lines).toEqual([])
    expect(proceeded.state).not.toBe("action")
  })

  it("reaches the desk as Purchasing's move once approved; a legacy request still waits on the warehouse", () => {
    expect(projectNeed(project, doc([line()]), "PR-01")).toMatchObject({ state: "action", lines: [{ name: "Cement", quantity: 100 }] })
    const legacy = projectNeed(project, { id: "x", status: "pending", items: [{ name: "Nails", quantity: 3, unit: "kg" }] }, "PR-x")
    expect(legacy).toMatchObject({ state: "waiting", waitingOn: "warehouse", lines: [{ name: "Nails", quantity: 3 }] })
  })

  describe("recordNeedDecision", () => {
    const R = "projects/p1/purchaseRequests/01"
    const now = new Date("2026-09-30T08:00:00.000Z")
    beforeEach(() => {
      resetFakeDb()
      seed("projects/p1", { organizationId: "org", name: "Villas" })
    })

    it("refuses to proceed with buying on a pending PM request, with its own code", async () => {
      seed(R, { pm: true, status: "pending", lines: [line()], items: [{ name: "Cement", quantity: 100, unit: "bag" }], createdAt: "2026-09-20T08:00:00.000Z" })
      await expect(recordNeedDecision(db, buyer, { projectId: "p1", requestId: "01", kind: "proceed_full" }, { now })).rejects.toMatchObject({ code: "need_awaits_pm" })
      await expect(recordNeedDecision(db, buyer, { projectId: "p1", requestId: "01", kind: "proceed_short", cover: [40] }, { now })).rejects.toMatchObject({ code: "need_awaits_pm" })
      expect(readDoc<{ procDecision?: unknown }>(R)?.procDecision).toBeUndefined()
    })

    it("still proceeds on a legacy request the warehouse did not answer in time", async () => {
      seed(R, { status: "pending", items: [{ name: "Nails", quantity: 3, unit: "kg" }], createdAt: "2026-09-20T08:00:00.000Z" })
      await recordNeedDecision(db, buyer, { projectId: "p1", requestId: "01", kind: "proceed_full" }, { now })
      expect(readDoc<{ procDecision?: { kind: string } }>(R)?.procDecision?.kind).toBe("proceed_full")
    })
  })
})

describe("Inventory's reply is read per request line", () => {
  const onA = (inv?: ReqLine["inv"]) => line({ itemId: "A", qty: 100, ...(inv ? { inv } : {}) })
  const onB = (inv?: ReqLine["inv"]) => line({ itemId: "B", code: "04-02", qty: 50, ...(inv ? { inv } : {}) })

  it("A issued in full, B unanswered: B's 50 is still to buy", () => {
    const n = projectNeed(project, doc([onA({ k: "issue", q: 100, kept: 0, on: "2026-09-21" }), onB()]), "PR-01")
    expect(n.lines).toEqual([{ name: "Cement", unit: "bag", quantity: 50, itemId: "B" }])
  })

  it("A issued in full, B kept 30: 30 is bought — not 60", () => {
    const n = projectNeed(project, doc([onA({ k: "issue", q: 100, kept: 0, on: "2026-09-21" }), onB({ k: "issue", q: 20, kept: 30, on: "2026-09-21" })]), "PR-01")
    expect(n.lines).toEqual([{ name: "Cement", unit: "bag", quantity: 30, itemId: "B" }])
    expect(n.lines.reduce((a, l) => a + l.quantity, 0)).toBe(30)
  })

  it("a refused change in between does not shift the reply onto its neighbour", () => {
    const lines = [line({ itemId: "A", qty: 10, chg: { st: "no" } }), onA({ k: "issue", q: 100, kept: 0, on: "2026-09-21" }), line({ itemId: "A", qty: 25 })]
    const n = projectNeed(project, doc(lines), "PR-01")
    expect(n.lines).toEqual([{ name: "Cement", unit: "bag", quantity: 25, itemId: "A" }])
  })
})

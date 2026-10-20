// PUR-01: the request, not the line — one card per request, one state.
import { draftFor, inRequestSegment, requestCards, requestSegmentCounts, requestState, sortCards } from "@/lib/procurement/incoming-requests"
import type { LineState, NeedRow } from "@/lib/procurement/need-desk"
import type { Need } from "@/lib/procurement/needs"

const need = (key: string, over: Partial<Need> = {}): Need =>
  ({ key, kind: "project", state: "action", lines: [], needBy: "2026-11-10", requestedBy: "م. فهد", at: "", refLabel: "MR 03", context: "", note: null, rfqId: null, rfqNumber: null, poId: null, poNumber: null, endNote: null, endKind: null, waitingOn: null, projectId: "P1", projectName: "مجمع الياسمين", source: { kind: "project_request", projectId: "P1", purchaseRequestId: key }, stock: null, ownerId: "P1", mfgRequestId: null, decision: null, ...over }) as Need
const row = (n: Need, i: number, state: LineState, lastOrderIn: number | null = 7): NeedRow =>
  ({ key: `${n.key}#${i}`, needKey: n.key, need: n, index: i, name: `m${i}`, unit: "كيس", total: 10, open: 10, state, path: null, route: null, needBy: n.needBy, leadDays: 10, lastOrderDay: "2026-10-26", lastOrderIn, unitEstimate: null, estimate: null, category: null, samplePending: false, itemId: null, onHand: null, selectable: true }) as NeedRow

describe("the request's state", () => {
  it("is new while every line waits on us, prepared once a draft names it", () => {
    const n = need("03")
    expect(requestState([row(n, 0, "open"), row(n, 1, "late")], null)).toBe("new")
    expect(requestState([row(n, 0, "open")], "d1")).toBe("prepared")
  })
  it("says part of it is in an RFQ, all of it, in an order, done", () => {
    const n = need("03")
    expect(requestState([row(n, 0, "rfq"), row(n, 1, "open")], null)).toBe("partial")
    expect(requestState([row(n, 0, "rfq"), row(n, 1, "rfq")], null)).toBe("rfq")
    expect(requestState([row(n, 0, "po"), row(n, 1, "done")], null)).toBe("order")
    expect(requestState([row(n, 0, "done"), row(n, 1, "stk")], null)).toBe("done")
    expect(requestState([row(need("x", { endKind: "refused" }), 0, "cx")], null)).toBe("failed")
  })
})

describe("one card per request", () => {
  const a = need("03")
  const b = need("04", { needBy: "2026-11-05" })
  const cards = requestCards([row(a, 0, "open", 7), row(a, 1, "open", 7), row(a, 2, "open", 7), row(b, 0, "open", 2)], [{ id: "d1", status: "Draft", needSources: [b.source] }])
  it("groups the lines of a request under it, with the draft it was prepared into", () => {
    expect(cards.map((c) => [c.key, c.rows.length, c.state, c.draftId])).toEqual([
      ["03", 3, "new", null],
      ["04", 1, "prepared", "d1"],
    ])
  })
  it("sorts by the last day to order, and counts by segment", () => {
    expect(sortCards(cards).map((c) => c.key)).toEqual(["04", "03"])
    expect(requestSegmentCounts(cards)).toMatchObject({ new: 1, prepared: 1, all: 2 })
    expect(inRequestSegment({ state: "partial" }, "rfq")).toBe(true)
  })
  it("finds no draft in a published RFQ", () => {
    expect(draftFor(a, [{ id: "r1", status: "New", needSources: [a.source] }])).toBeNull()
  })
})

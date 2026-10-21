// PUR-01 (kept) and Procurement 2.0 INC-02: the request, not the line — one card per request, one state, one segment; a request
// with something left to buy stays in «جديدة» (the 1.5 rule «partly in an RFQ ⇒ the RFQ segment» is deliberately reversed).
import { cardSegment, draftFor, incomingCardCounts, inRequestSegment, requestCards, requestSegmentCounts, sortCards, REQUEST_SEGMENTS } from "@/lib/procurement/incoming-requests"
import type { LineState, NeedRow } from "@/lib/procurement/need-desk"
import type { Need } from "@/lib/procurement/needs"

const need = (key: string, over: Partial<Need> = {}): Need =>
  ({ key, kind: "stock", state: "action", lines: [], needBy: "2026-11-10", requestedBy: "م. فهد", at: "", refLabel: "MR 03", context: "", note: null, rfqId: null, rfqNumber: null, poId: null, poNumber: null, endNote: null, endKind: null, waitingOn: null, projectId: "P1", projectName: "مجمع الياسمين", source: { kind: "project_request", projectId: "P1", purchaseRequestId: key }, stock: null, ownerId: "P1", mfgRequestId: null, decision: null, ...over }) as Need
const row = (n: Need, i: number, state: LineState, lastOrderIn: number | null = 7): NeedRow =>
  ({ key: `${n.key}#${i}`, needKey: n.key, need: n, index: i, name: `m${i}`, unit: "كيس", total: 10, open: 10, state, path: null, route: null, needBy: n.needBy, leadDays: 10, lastOrderDay: "2026-10-26", lastOrderIn, unitEstimate: null, estimate: null, category: null, samplePending: false, itemId: null, onHand: null, selectable: true }) as NeedRow
const stateOf = (rows: NeedRow[], draft: string | null = null) => requestCards(rows, draft ? [{ id: draft, status: "Draft", needSources: [rows[0].need.source] }] : [])[0].state

describe("the request's state (read from its rows when nothing is stored — a stock gap)", () => {
  it("is new while every line waits on us, prepared once a draft names it", () => {
    const n = need("03")
    expect(stateOf([row(n, 0, "open"), row(n, 1, "open")])).toBe("new")
    expect(stateOf([row(n, 0, "open")], "d1")).toBe("prepared")
  })
  it("says part of it is in an RFQ or an order, all of it, in an order, done", () => {
    const n = need("03")
    expect(stateOf([row(n, 0, "rfq"), row(n, 1, "open")])).toBe("partial")
    expect(stateOf([row(n, 0, "rfq"), row(n, 1, "rfq")])).toBe("rfq")
    expect(stateOf([row(n, 0, "po"), row(n, 1, "done")])).toBe("order")
    expect(stateOf([row(n, 0, "done"), row(n, 1, "stk")])).toBe("done")
    expect(stateOf([row(need("x", { endKind: "refused" }), 0, "cx")])).toBe("failed")
    expect(stateOf([row(need("y", { endKind: "withdrawn" }), 0, "cx")])).toBe("withdrawn")
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
  it("sorts by the last day to order, and counts by segment (قادمة is an empty shell, عند غيرنا is gone)", () => {
    expect(sortCards(cards).map((c) => c.key)).toEqual(["04", "03"])
    expect(requestSegmentCounts(cards)).toMatchObject({ upcoming: 0, new: 1, prepared: 1, all: 2 })
    expect(REQUEST_SEGMENTS).toEqual(["upcoming", "new", "prepared", "rfq", "order", "done", "ended", "all"])
  })
  it("finds no draft in a published RFQ", () => {
    expect(draftFor(a, [{ id: "r1", status: "New", needSources: [a.source] }])).toBeNull()
  })
})

describe("a partly handled request stays in «جديدة» while something is left to buy (INC-02, INC-10)", () => {
  const n = need("05")
  const [part] = requestCards([row(n, 0, "rfq"), row(n, 1, "open"), row(n, 2, "open")], [])
  it("is partial, tagged as the remainder, selectable, and counted as new — not as in an RFQ", () => {
    expect(part).toMatchObject({ state: "partial", buyLines: 2, remainder: true, selectable: true })
    expect(cardSegment(part)).toBe("new")
    expect(inRequestSegment(part, "new")).toBe(true)
    expect(inRequestSegment(part, "rfq")).toBe(false)
    expect(requestSegmentCounts([part])).toMatchObject({ new: 1, rfq: 0, all: 1 })
  })
  it("once nothing is left to buy it follows what is in hand", () => {
    const [handled] = requestCards([row(n, 0, "rfq"), row(n, 1, "po")], [])
    expect(handled).toMatchObject({ state: "rfq", buyLines: 0, remainder: false })
    expect(inRequestSegment(handled, "rfq")).toBe(true)
    expect(inRequestSegment({ state: "partial", buyLines: 0 }, "rfq")).toBe(true)
  })
  it("failed and withdrawn requests are «انتهت»; a finished one is «اكتملت»", () => {
    expect(inRequestSegment({ state: "failed", buyLines: 0 }, "ended")).toBe(true)
    expect(inRequestSegment({ state: "withdrawn", buyLines: 0 }, "ended")).toBe(true)
    expect(inRequestSegment({ state: "done", buyLines: 0 }, "done")).toBe(true)
    expect(inRequestSegment({ state: "failed", buyLines: 0 }, "done")).toBe(false)
  })
})

describe("the frame's «جديدة» count", () => {
  it("counts the requests in the new segment — a remainder included, a prepared or handled one not", () => {
    const n = need("07")
    const cards = requestCards([row(n, 0, "open"), row(need("08"), 0, "rfq"), row(need("09"), 0, "rfq"), row(need("09"), 1, "open")], [{ id: "d", status: "Draft", needSources: [n.source] }])
    expect(cards.map((c) => c.state).sort()).toEqual(["partial", "prepared", "rfq"])
    expect(incomingCardCounts(cards)).toEqual({ new: 1, open: 3 })
  })
})

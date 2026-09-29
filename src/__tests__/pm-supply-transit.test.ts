/**
 * PM supply — what a main store issued is on the way until it is received on
 * the project: it can be received there, and the line cannot be stopped while
 * it travels («في الطريق X — لا يُلغى ما خرج من المستودع»).
 */

import { lineInTransit, receivable, stopBlocks, type PmMaterialRequest, type ReqLine } from "@/lib/pm/supply"

const line = (over: Partial<ReqLine> = {}): ReqLine => ({ itemId: "i1", code: "01", key: "cement|bag", name: "Cement", unit: "bag", qty: 100, ...over })
const request = (l: ReqLine): Pick<PmMaterialRequest, "status" | "withdrawn" | "lines" | "rfqId" | "poId" | "mfgRequestId"> => ({ status: "approved", withdrawn: false, lines: [l], rfqId: null, poId: null, mfgRequestId: null })

it("an issued quantity is in transit until it arrives, and can be received on the project", () => {
  const issued = line({ inv: { k: "issue", q: 60, on: "2026-09-20" } })
  expect(lineInTransit(issued)).toBe(60)
  expect(receivable(request(issued), issued)).toBe(true)
  const half = line({ inv: { k: "issue", q: 60, on: "2026-09-20" }, receipts: [{ grn: "G1", q: 40, rej: 0, on: "2026-09-22", by: "u" }] })
  expect(lineInTransit(half)).toBe(20)
  expect(lineInTransit(line({ inv: { k: "none", on: "2026-09-20" } }))).toBe(0)
  expect(receivable(request(line()), line())).toBe(false)
})

it("a line cannot be stopped while quantity is on the way", () => {
  const issued = line({ inv: { k: "issue", q: 60, on: "2026-09-20" } })
  expect(stopBlocks({ archived: false, request: request(issued), line: issued, why: null, whyNote: null })).toContain("in_transit")
  expect(stopBlocks({ archived: false, request: request(line()), line: line(), why: null, whyNote: null })).not.toContain("in_transit")
})

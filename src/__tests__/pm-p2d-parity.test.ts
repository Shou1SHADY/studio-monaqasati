/**
 * P2D parity with the PM 1.0 prototype: decision sub-lines name their facts,
 * the reconciliation waits on the approver, a hold burns indirect cost toward
 * an extension claim; waits split by the module holding them; an item's
 * commitments; the match knows its request; the section census; both
 * directions of the boundary log; one closeout count for tab and panel.
 */

import { DECISION_GROUP, projectDecisions, type DecisionFacts } from "@/lib/pm/decisions"
import { defaultTerms } from "@/lib/pm/terms"
import { requestWaitRows, storeWaitRows } from "@/lib/pm/pulse"
import { itemCommitments } from "@/lib/pm/item-commitments"
import { matchRows } from "@/lib/pm/match"
import { SECTION_LOSS, sectionCensus } from "@/lib/pm/sections-governance"
import { boundaryRows, incomingEntries } from "@/lib/pm/boundary"
import { openCloseRows, shownCloseRows } from "@/lib/pm/closeout-view"
import type { PmEvent } from "@/lib/pm/events"

const TODAY = "2026-09-27"
const base: DecisionFacts = {
  lifecycle: "live",
  managerless: false,
  startOn: "2026-01-01",
  plannedStart: "2026-01-01",
  durationDays: 300,
  baseValue: 1_000_000,
  terms: defaultTerms(),
  acceptances: {},
  items: [{ quantity: 100, rate: 10_000, executed: 90, billed: 90 }],
  sheets: [],
  addenda: [],
  certificates: [],
  punch: [],
  variations: [],
  claims: [],
  eac: { on: "2026-09-20" },
  today: TODAY,
}
const find = (f: Partial<DecisionFacts>, k: string) => projectDecisions({ ...base, ...f }).find((d) => d.kind === k)
const viewer = (keys: string[]) => ({ uid: "u1", has: (k: string) => keys.includes(k) })

describe("decision sub-lines carry the prototype's facts", () => {
  it("a certificate awaiting internal approval names who prepared it", () => {
    const d = find({ certificates: [{ status: "int", net: 5000, prep: "u2", prepName: "Khalid", prepOn: "2026-09-20" }] }, "cert_internal")
    expect(d).toMatchObject({ detail: "detail_by", vars: { name: "Khalid" } })
    expect(find({ certificates: [{ status: "int", net: 5000, prep: "u2", prepOn: "2026-09-20" }] }, "cert_internal")?.detail).toBeUndefined()
  })

  it("a claim past its notice names the earliest event and its day", () => {
    const d = find({ claims: [{ status: "draft", eventOn: "2026-08-01", cause: "Late drawings" }, { status: "draft", eventOn: "2026-08-10", cause: "Rain" }] }, "claim_notice_late")
    expect(d).toMatchObject({ detail: "detail_event", vars: { cause: "Late drawings", date: "2026-08-01" } })
  })

  it("an overdue collection names who Finance chases", () => {
    expect(find({ payer: "Ministry", certificates: [{ status: "appr", net: 50_000, dueOn: "2026-09-10", collected: 0 }] }, "collection_overdue")).toMatchObject({ detail: "detail_payer", vars: { payer: "Ministry" } })
  })

  it("damages say the pace, the rate and the cap — and when they exceed the margin", () => {
    const terms = { ...defaultTerms(), damages: { on: true, weeklyRate: 0.005, cap: 0.1 } }
    const f = { terms, items: [{ quantity: 100, rate: 10_000, executed: 20, billed: 20 }] }
    const d = find({ ...f, margin: 1_000_000 }, "damages")
    expect(d).toMatchObject({ detail: "detail_pace", vars: { rate: 0.5, cap: 10 } })
    expect((d?.vars?.points ?? 0) > 0).toBe(true)
    expect(find({ ...f, margin: 1 }, "damages")).toMatchObject({ severity: "red", detail: "detail_pace_over" })
  })

  it("a hold shows the indirect spend and leads to the extension claim", () => {
    const hold = { lifecycle: "hold", holdSince: "2026-09-01", holdWhy: "Client funding", indirectSpent: 42_000 }
    expect(find(hold, "hold")).toMatchObject({ amount: 42_000, tab: "pmClaims", detail: "detail_why", act: "act_log", vars: { why: "Client funding" } })
    expect(find({ ...hold, claims: [{ status: "notice", kind: "time", eventOn: "2026-09-01" }] }, "hold")).toMatchObject({ act: "act_follow" })
    expect(find({ ...hold, holdWhy: null, sections: ["contract", "procure", "vo"] }, "hold")).toMatchObject({ tab: "info", detail: "detail_burn", act: undefined })
  })

  it("the monthly reconciliation waits on the approver, money or not", () => {
    expect(DECISION_GROUP.cvr_stale).toBe("appr")
    expect(find({ eac: null, viewer: viewer(["approve"]) }, "cvr_stale")).toBeDefined()
    expect(find({ eac: null, viewer: viewer(["money"]) }, "cvr_stale")).toBeUndefined()
  })
})

describe("waiting rows follow the module that holds them", () => {
  const line = (over: Record<string, unknown> = {}) => ({ itemId: null, code: null, key: "k", name: "Cement", unit: "bag", qty: 10, ...over })

  it("a PM request line Inventory has not answered waits on the store; what is left to buy on Procurement", () => {
    const r = { id: "r1", pm: true, title: "Cement", status: "approved", approvedOn: TODAY, lines: [line(), line({ key: "s", name: "Sand", inv: { k: "none", on: TODAY } }), line({ key: "b", name: "Blocks", inv: { k: "issue", q: 10, kept: 0, on: TODAY } })] }
    const rows = requestWaitRows([r], "p1", TODAY)
    expect(rows.map((x) => [x.module, x.kind, x.sub.params.count])).toEqual([
      ["inv", "request_inv", 1],
      ["proc", "request", 1],
    ])
  })

  it("non-conforming material going back to the supplier waits on Procurement", () => {
    const store = { id: "s1", name: "Tiles", unit: "m2", moves: [{ t: "sret", q: 5, on: TODAY, st: "wait" }, { t: "ret", q: 2, on: TODAY, st: "wait", warehouseName: "Main" }] }
    expect(storeWaitRows([store], "p1", TODAY).map((x) => [x.module, x.kind])).toEqual([
      ["proc", "store_sret"],
      ["inv", "store_return"],
    ])
  })
})

describe("an item's commitments", () => {
  it("lists POs and subcontracts with date, value and received share, and the scope they cover", () => {
    const c = itemCommitments({
      itemId: "i1",
      budget: 100_000,
      quantity: 100,
      subs: [{ id: "c1", seq: 2, party: { name: "Sub Co" }, on: "2026-05-01", startOn: "2026-05-03", lines: [{ itemId: "i1", qty: 40, value: 40_000, certified: 0.5 }] }],
      pos: [
        { id: "p1", docNumber: "PO-2026/001", supplierName: "Steel Co", status: "sent", createdAt: "2026-04-01", sentAt: "2026-04-02", lines: [{ name: "Rebar", unit: "t", quantity: 10, unitPrice: 2000, accepted: 5, cancelled: 0, boqItemId: "i1" }] },
        { id: "p2", docNumber: "PO-2026/002", supplierName: "Cement Co", status: "sent", createdAt: "2026-06-01", lines: [{ name: "Cement", unit: "bag", quantity: 100, unitPrice: 20, accepted: 0, cancelled: 0 }] },
        { id: "p3", docNumber: "PO-2026/003", supplierName: "X", status: "cancelled", createdAt: "2026-06-01", lines: [{ name: "Rebar", unit: "t", quantity: 1, unitPrice: 1, accepted: 0, cancelled: 0, boqItemId: "i1" }] },
      ],
      requestLines: [{ poId: "p2", name: "cement ", unit: "BAG" }],
    })
    expect(c.rows.map((r) => [r.kind, r.no, r.day, r.value, r.recv])).toEqual([
      ["po", "PO-2026/001", "2026-04-02", 20_000, 0.5],
      ["sub", 2, "2026-05-03", 40_000, 0.5],
      ["po", "PO-2026/002", "2026-06-01", 2_000, 0],
    ])
    expect(c.value).toBe(62_000)
    expect(c.share).toBeCloseTo(0.62)
  })

  it("with no budget, a subcontract's quantity is the share; nothing at all is 0", () => {
    expect(itemCommitments({ itemId: "i1", budget: 0, quantity: 100, subs: [{ id: "c", seq: 1, party: { name: "S" }, on: "2026-01-01", lines: [{ itemId: "i1", qty: 25, value: 0, certified: 0 }] }], pos: [] }).share).toBe(0.25)
    expect(itemCommitments({ itemId: "i1", budget: 0, quantity: 100, subs: [], pos: [] }).share).toBe(0)
  })
})

describe("the match names the request an order came from", () => {
  it("reads purchaseSource on the order", () => {
    const po = { id: "p1", docNumber: "PO-1", status: "sent", supplierName: "S", totalExVat: 100, lines: [{ id: "l1", name: "Rebar", unit: "t", quantity: 1, unitPrice: 100, accepted: 1, cancelled: 0 }] }
    expect(matchRows([{ ...po, purchaseSource: { kind: "project_request", purchaseRequestId: "r9" } }], [])[0].requestId).toBe("r9")
    expect(matchRows([po], [])[0].requestId).toBeNull()
  })
})

describe("the section census covers every section the prototype counts", () => {
  it("counts schedule, look-ahead, samples, cash, letters and closeout", () => {
    const f = { storeLines: 0, uncollected: 0, activities: 12, lookaheadBlocked: 3, weeks: 2, samplesWithConsultant: 2, samplesRequired: 5, pettyMoves: 7, lettersOpen: 1, closeOpen: 4 }
    expect(sectionCensus("sched", f)).toEqual([{ key: "activities", value: 12, money: false, level: "" }])
    expect(sectionCensus("wwp", f).map((r) => [r.key, r.level])).toEqual([["weeks", ""], ["lookahead_blocked", "w"]])
    expect(sectionCensus("subm", f).map((r) => r.key)).toEqual(["samples_with_consultant", "samples_required"])
    expect(sectionCensus("petty", f)[0].key).toBe("petty_moves")
    expect(sectionCensus("corr", f)[0]).toMatchObject({ key: "letters_open", level: "w" })
    expect(sectionCensus("close", f)[0]).toMatchObject({ key: "close_open", value: 4 })
    for (const id of ["subm", "sched", "corr", "close", "petty"] as const) expect(SECTION_LOSS.has(id)).toBe(true)
  })
})

describe("the boundary log shows both directions", () => {
  it("merges what we sent with what other modules did, newest first", () => {
    const events = [{ key: "prj:HND:PJ-1:final", kind: "HND", projectId: "p1", amount: 9000, params: { stage: "final" }, at: "2026-09-01T10:00:00Z" }] as unknown as PmEvent[]
    const incoming = incomingEntries({
      pos: [
        { id: "po1", docNumber: "PO-1", supplierName: "S", status: "sent", createdAt: "2026-08-01", sentAt: "2026-08-03", totalExVat: 500 },
        { id: "po2", docNumber: "PO-2", supplierName: "S", status: "awaiting_approval", createdAt: "2026-08-05" },
      ],
      certificates: [{ seq: 1, collections: [{ on: "2026-09-10", amount: 1000 }] }],
      releases: [{ sourceId: "prj:HND:PJ-1:final", date: "2026-09-12" }, { sourceId: "other", date: "2026-09-13" }],
      hndDocIds: new Set(["prj:HND:PJ-1:final"]),
      requests: [{ id: "r1", title: "Cement", lines: [{ name: "Cement", inv: { k: "issue", on: "2026-08-20" } }, { name: "Sand" }] }],
      stores: [{ id: "s1", name: "Cement", unit: "bag", moves: [{ t: "ret", q: 3, invOn: "2026-09-05", warehouseName: "Main" }] }],
    })
    expect(incoming.map((e) => [e.module, e.kind])).toEqual([
      ["procurement", "po"],
      ["payments", "collection"],
      ["payments", "retention"],
      ["warehouses", "inv_reply"],
      ["warehouses", "return_in"],
    ])
    const rows = boundaryRows(events, incoming)
    expect(rows.map((r) => r.dir)).toEqual(["in", "in", "in", "out", "in", "in"])
    expect(rows[0].at).toBe("2026-09-12")
  })
})

describe("the closeout tab and panel count by one rule", () => {
  const rows = [
    { key: "punch" as const, ok: false },
    { key: "unbilled" as const, ok: false },
    { key: "vo_pending" as const, ok: false },
    { key: "final" as const, ok: true },
  ]
  it("hides the client-money rows from whoever does not see the client side; a pending VO is open money, not a row", () => {
    expect(openCloseRows(rows, true)).toBe(2)
    expect(openCloseRows(rows, false)).toBe(1)
    expect(shownCloseRows(rows, false).map((r) => r.key)).toEqual(["punch", "final"])
  })
})

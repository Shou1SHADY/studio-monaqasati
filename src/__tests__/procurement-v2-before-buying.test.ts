/** @jest-environment node */
/**
 * Procurement 2.0 — «قبل الشراء» (WP-S2-04, INC-07/08/09, ED-09, WF-04, WF-05, B-04, B-05): the stores are asked for every material
 * of a request when it arrives; what they issue is not bought; a material waiting for an answer is not published; the window is a
 * day and never beyond the last day to order; after it the line fails open — bought in full, with no button — and a late answer
 * never takes the material back. The workshop is asked only for stone, by tree id, and only with Manufacturing in the package.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  WORKSHOP_MAKE_SUBS,
  applyStockReply,
  applyWorkshopReply,
  askStock,
  askWorkshop,
  beforeBuying,
  beforeSummary,
  canAskWorkshop,
  closeWorkshopQuestions,
  isMakeMaterial,
  proceedLapsed,
  settleReplies,
  stockDeadline,
  waitingLines,
  type CheckContext,
} from "@/lib/procurement/stock-check"
import { DEFAULT_RESOLVED_POLICIES } from "@/lib/procurement/policies"
import { lineBuyQty, lineHeld, lineKind, replyClockOf, settle, type IncomingDoc, type IncomingLine } from "@/lib/procurement/incoming-state"
import { newTeamRequest } from "@/lib/procurement/incoming-ingest"
import type { MaterialPick } from "@/lib/materials/types"

const DAY = 86_400_000
const T0 = new Date("2026-10-21T08:00:00.000Z")
const at = (n: number) => new Date(T0.getTime() + n * DAY)
const policies = { ...DEFAULT_RESOLVED_POLICIES }
const ctx = (now = T0): CheckContext => ({ now, policies })
const clockAt = (n: number) => replyClockOf(at(n), policies)

const stone = (subId: string): MaterialPick => ({ nodeId: subId, subId, rootId: "floors", path: [{ ar: "الارضيات والجدران", en: "Floors and walls" }], specs: [] })
const MARBLE = WORKSHOP_MAKE_SUBS[0]

const request = (lines: Array<{ name: string; unit: string; quantity: number; material?: MaterialPick }>, over: Partial<IncomingDoc> = {}, src: IncomingDoc["src"] = "team"): IncomingDoc => ({
  ...newTeamRequest({
    organizationId: "o1",
    id: "r1",
    no: "MAT-2026/014",
    seq: 14,
    lines,
    needBy: "2026-11-22",
    place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
    requestedBy: { id: "u1", name: "م. فهد" },
    requestedFor: { kind: "member", id: "u1", name: "م. فهد" },
    at: T0.toISOString(),
  }),
  src,
  ...over,
})

const asked = (doc: IncomingDoc, now = T0): IncomingDoc => {
  const res = askStock(doc, ctx(now))
  if (typeof res === "string") throw new Error(res)
  return { ...doc, lines: res.lines }
}

const WH = { id: "w1", name: "المستودع المركزي" }

describe("which materials the workshop cuts (B-04, B-05): by tree id, never by name", () => {
  it("the three ids are the shipped tree's الرخام · جرانيت · الأحجار الطبيعية", () => {
    const tree = JSON.parse(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")) as { roots: Array<{ id: string; ar: string; children: unknown[] }> }
    const names = new Map<string, string>()
    const walk = (n: { id: string; ar: string; children?: unknown[] }) => {
      names.set(n.id, n.ar)
      ;(n.children as Array<{ id: string; ar: string; children?: unknown[] }> | undefined)?.forEach(walk)
    }
    tree.roots.forEach(walk)
    expect(WORKSHOP_MAKE_SUBS.map((id) => names.get(id)).sort()).toEqual(["الأحجار الطبيعية", "الرخام", "جرانيت"].sort())
  })

  it("a line is stone by its sub-category id; a look-alike name or another id is not", () => {
    expect(isMakeMaterial(stone(MARBLE))).toBe(true)
    expect(isMakeMaterial({ subId: "not-an-id" })).toBe(false)
    expect(isMakeMaterial(null)).toBe(false)
    const named = request([{ name: "رخام بيج", unit: "م²", quantity: 20 }])
    expect(canAskWorkshop(named, named.lines[0], true)).toBe(false)
  })

  it("B-05: without the Manufacturing connector there is no «اسأل الورشة»; with it, only on a request the workshop did not raise", () => {
    const doc = request([{ name: "رخام", unit: "م²", quantity: 22, material: stone(MARBLE) }])
    expect(canAskWorkshop(doc, doc.lines[0], false)).toBe(false)
    expect(canAskWorkshop(doc, doc.lines[0], true)).toBe(true)
    expect(canAskWorkshop({ ...doc, src: "mfg" }, doc.lines[0], true)).toBe(false)
    expect(canAskWorkshop({ ...doc, st: "rfq" }, doc.lines[0], true)).toBe(false)
    expect(askWorkshop(doc, { lines: [1] }, { now: T0, clock: clockAt(0), by: "المشتري", mfgOn: false })).toBe("connector_off")
  })
})

describe("the window of Inventory's reply (INC-07): a day, never beyond the last day to order, never before today", () => {
  it("is the day asked + the policy's days", () => {
    expect(stockDeadline("2026-11-22", ctx())).toBe("2026-10-22")
  })

  it("is cut to the last day to order — need date − 10 − 3 − 2", () => {
    expect(stockDeadline("2026-11-06", ctx())).toBe("2026-10-22")
    expect(stockDeadline("2026-11-05", ctx())).toBe("2026-10-21")
    expect(stockDeadline("2026-11-04", ctx())).toBe("2026-10-21")
  })

  it("is never before today, however late the request is", () => {
    expect(stockDeadline("2026-10-25", ctx())).toBe("2026-10-21")
  })

  it("a request is asked about when it arrives: every material line waits, with the day the window ends", () => {
    const doc = asked(request([{ name: "بلك", unit: "حبة", quantity: 2000 }, { name: "اسمنت", unit: "كيس", quantity: 150 }]))
    for (const l of doc.lines) expect(l.stk).toMatchObject({ st: "wait", src: "proc", until: "2026-10-22" })
    expect(doc.lines.map((l) => lineKind(l, clockAt(0)))).toEqual(["wait", "wait"])
    expect(doc.lines.map((l) => lineBuyQty(l, clockAt(0)))).toEqual([0, 0])
  })

  it("only the team's and the projects' requests are asked: a workshop shortfall and a stock gap are not", () => {
    expect(askStock(request([{ name: "x", unit: "u", quantity: 1 }], {}, "mfg"), ctx())).toMatchObject({ asked: [] })
    expect(askStock(request([{ name: "x", unit: "u", quantity: 1 }], {}, "inv"), ctx())).toMatchObject({ asked: [] })
    expect((askStock(request([{ name: "x", unit: "u", quantity: 1 }], {}, "pm"), ctx()) as { asked: unknown[] }).asked).toHaveLength(1)
  })

  it("a line the source already has an answer for is not asked again", () => {
    const doc = request([{ name: "x", unit: "u", quantity: 10 }])
    const answered = { ...doc, lines: [{ ...doc.lines[0], stk: { st: "none" as const, at: "2026-10-20" } }] }
    expect((askStock(answered, ctx()) as { asked: unknown[] }).asked).toHaveLength(0)
    expect(askStock(answered, ctx(), [1])).toBe("already_asked")
  })
})

describe("WF-04 — the stores issue what they have and it is not bought", () => {
  const block = () => asked(request([{ name: "البلك الاسمنتي", unit: "حبة", quantity: 2000 }, { name: "الاسمنت العادي", unit: "كيس", quantity: 200 }]))

  it("2,000 blocks, the stores issue 500: 1,500 are published — «يُشترى 1,500 من 2,000»", () => {
    const doc = block()
    const res = applyStockReply(doc, { line: 1, kind: "part", give: 500, warehouse: WH }, { now: at(0), clock: clockAt(0), by: "أمين المستودع" })
    if (typeof res === "string") throw new Error(res)
    expect(res.line.stk).toMatchObject({ st: "part", give: 500, rv: 1, wh: WH, src: "proc" })
    expect(lineBuyQty(res.line, clockAt(0))).toBe(1500)
    const view = beforeBuying(doc, res.line, clockAt(0), false)
    expect(view.stock).toEqual({ kind: "part", give: 500, warehouse: "المستودع المركزي" })
    expect(view.buy).toEqual({ kind: "buy", qty: 1500, of: 2000 })
  })

  it("issuing it all leaves nothing to buy; «لا رصيد» and «مرتبط بغرض آخر» leave all of it", () => {
    const doc = block()
    const clock = clockAt(0)
    const run = (kind: "issue" | "none" | "tied", extra: { why?: string } = {}) => {
      const r = applyStockReply(doc, { line: 2, kind, warehouse: kind === "issue" ? WH : null, ...extra }, { now: at(0), clock, by: "أ" })
      if (typeof r === "string") throw new Error(r)
      return r.line
    }
    expect(lineBuyQty(run("issue"), clock)).toBe(0)
    expect(lineKind(run("issue"), clock)).toBe("covered")
    expect(lineBuyQty(run("none"), clock)).toBe(200)
    const tied = run("tied", { why: "محجوز لبرج العليا" })
    expect(lineBuyQty(tied, clock)).toBe(200)
    expect(beforeBuying(doc, tied, clock, false).stock).toEqual({ kind: "tied", why: "محجوز لبرج العليا" })
  })

  it("a reply needs what its kind needs: a partial quantity below the asked one, a warehouse when something is issued, a reason when tied", () => {
    const doc = block()
    const go = (input: Parameters<typeof applyStockReply>[1]) => applyStockReply(doc, input, { now: at(0), clock: clockAt(0), by: "أ" })
    expect(go({ line: 1, kind: "part", give: 0, warehouse: WH })).toBe("bad_qty")
    expect(go({ line: 1, kind: "part", give: 2000, warehouse: WH })).toBe("bad_qty")
    expect(go({ line: 1, kind: "part", give: 500, warehouse: null })).toBe("no_warehouse")
    expect(go({ line: 1, kind: "issue" })).toBe("no_warehouse")
    expect(go({ line: 1, kind: "tied", why: " " })).toBe("no_reason")
    expect(go({ line: 9, kind: "none" })).toBe("no_line")
  })

  it("only a line Procurement asked about is answered through this act; a line in hand is not changed", () => {
    const plain = request([{ name: "x", unit: "u", quantity: 10 }])
    expect(applyStockReply(plain, { line: 1, kind: "none" }, { now: at(0), clock: clockAt(0), by: "أ" })).toBe("not_asked")
    const doc = block()
    const inRfq = { ...doc, lines: doc.lines.map((l) => ({ ...l, ps: "rfq" as const, rfqId: "q1" })) }
    expect(applyStockReply(inRfq, { line: 1, kind: "none" }, { now: at(0), clock: clockAt(0), by: "أ" })).toBe("already_in_hand")
  })

  it("an answer can be corrected before the line is in hand: V2", () => {
    const doc = block()
    const first = applyStockReply(doc, { line: 1, kind: "none" }, { now: at(0), clock: clockAt(0), by: "أ" })
    if (typeof first === "string") throw new Error(first)
    const second = applyStockReply({ ...doc, lines: first.lines }, { line: 1, kind: "part", give: 100, warehouse: WH }, { now: at(0), clock: clockAt(0), by: "أ" })
    if (typeof second === "string") throw new Error(second)
    expect(second.line.stk?.rv).toBe(2)
  })
})

describe("it fails open (R-xx): after the window the whole quantity is bought, with no button, and a late answer never takes it back", () => {
  it("held inside the window, bought in full the day after it", () => {
    const doc = asked(request([{ name: "بلك", unit: "حبة", quantity: 2000 }]))
    expect(lineHeld(doc.lines[0], clockAt(1))).toBe("stock")
    expect(lineHeld(doc.lines[0], clockAt(2))).toBeNull()
    expect(lineBuyQty(doc.lines[0], clockAt(2))).toBe(2000)
    expect(settle(doc, { rfqs: [], orders: [] }, clockAt(2)).st).toBe("new")
  })

  it("the window ends at the last day to order when that is sooner", () => {
    const doc = asked(request([{ name: "بلك", unit: "حبة", quantity: 10 }], { needBy: "2026-11-03" }))
    expect(doc.lines[0].stk?.until).toBe("2026-10-21")
    expect(lineHeld(doc.lines[0], clockAt(0))).toBe("stock")
    expect(lineHeld(doc.lines[0], clockAt(1))).toBeNull()
  })

  it("`proceed` writes the lapse down: «none» marked automatic, the line's version moves, nothing else does", () => {
    const doc = asked(request([{ name: "بلك", unit: "حبة", quantity: 2000 }, { name: "اسمنت", unit: "كيس", quantity: 5 }]))
    const early = proceedLapsed(doc.lines, clockAt(1))
    expect(early.closed).toEqual([])
    const lapsed = proceedLapsed(doc.lines, clockAt(3))
    expect(lapsed.closed).toEqual([1, 2])
    expect(lapsed.lines[0]).toMatchObject({ stk: { st: "none", auto: "timeout" }, v: doc.lines[0].v + 1 })
    expect(lineBuyQty(lapsed.lines[0], clockAt(3))).toBe(2000)
    expect(beforeBuying(doc, lapsed.lines[0], clockAt(3), false).stock).toEqual({ kind: "timeout" })
  })

  it("a late reply is refused; a source that answers late does not change a closed question", () => {
    const doc = asked(request([{ name: "بلك", unit: "حبة", quantity: 2000 }]))
    expect(applyStockReply(doc, { line: 1, kind: "part", give: 500, warehouse: WH }, { now: at(3), clock: clockAt(3), by: "أ" })).toBe("window_lapsed")
    const closed = { ...doc, lines: proceedLapsed(doc.lines, clockAt(3)).lines }
    expect(applyStockReply(closed, { line: 1, kind: "issue", warehouse: WH }, { now: at(3), clock: clockAt(3), by: "أ" })).toBe("window_lapsed")
    const fromSource = closed.lines.map((l) => ({ ...l, stk: { st: "issue" as const, give: 2000, at: "2026-10-24" }, v: l.v + 1 }))
    const kept = settleReplies(closed.lines, fromSource)
    expect(kept[0].stk).toMatchObject({ st: "none", auto: "timeout" })
    expect(lineBuyQty(kept[0], clockAt(3))).toBe(2000)
    expect(kept[0].v).toBe(closed.lines[0].v)
  })

  it("an answer Procurement holds stands over a source that has none; a source's own answer wins over a question still waiting", () => {
    const doc = asked(request([{ name: "بلك", unit: "حبة", quantity: 2000 }, { name: "اسمنت", unit: "كيس", quantity: 100 }]))
    const answered = applyStockReply(doc, { line: 1, kind: "part", give: 500, warehouse: WH }, { now: at(0), clock: clockAt(0), by: "أ" })
    if (typeof answered === "string") throw new Error(answered)
    const withoutSource = answered.lines.map((l) => ({ ...l, stk: null }))
    const merged = settleReplies(answered.lines, withoutSource)
    expect(merged[0].stk).toMatchObject({ st: "part", give: 500 })
    expect(merged[1].stk).toMatchObject({ st: "wait", src: "proc" })
    const sourceAnswer = answered.lines.map((l, i) => (i === 1 ? { ...l, stk: { st: "none" as const, at: "2026-10-21" } } : { ...l, stk: null }))
    const second = settleReplies(answered.lines, sourceAnswer)
    expect(second[1].stk).toMatchObject({ st: "none" })
    expect(second[1].stk?.src).toBeUndefined()
  })
})

describe("WF-05 — «نصنّع أم نشتري؟»: the workshop makes what it can, the rest is bought", () => {
  const rukham = () => {
    const doc = request([{ name: "أرضيات رخام بيج للمداخل", unit: "م²", quantity: 380, material: stone(MARBLE) }], {}, "pm")
    return asked(doc)
  }
  const none = (doc: IncomingDoc): IncomingDoc => {
    const r = applyStockReply(doc, { line: 1, kind: "none" }, { now: at(0), clock: clockAt(0), by: "أ" })
    if (typeof r === "string") throw new Error(r)
    return { ...doc, lines: r.lines }
  }
  const ask = (doc: IncomingDoc, now = at(0), note?: string): IncomingDoc => {
    const r = askWorkshop(doc, { lines: [1], note, refs: { 1: { price: 285, po: "ط.ش-2025/188", day: "2025-06-02" } } }, { now, clock: replyClockOf(now, policies), by: "المشتري", mfgOn: true })
    if (typeof r === "string") throw new Error(r)
    return { ...doc, lines: r.lines }
  }

  it("B-04: asking marks the line «سُئلت» with the reference price, and the line is not published until it answers", () => {
    const doc = ask(none(rukham()), at(0), "الدرج 14 قائمة")
    expect(doc.lines[0].mk).toMatchObject({ st: "ask", src: "proc", note: "الدرج 14 قائمة", ref: { price: 285, po: "ط.ش-2025/188" } })
    expect(lineHeld(doc.lines[0], clockAt(0))).toBe("workshop")
    expect(lineBuyQty(doc.lines[0], clockAt(0))).toBe(0)
    expect(askWorkshop(doc, { lines: [1] }, { now: at(0), clock: clockAt(0), by: "ب", mfgOn: true })).toBe("already_asked")
  })

  it("the workshop makes 300 of 380 under a work order: 80 are bought", () => {
    const doc = ask(none(rukham()))
    const res = applyWorkshopReply(doc, { line: 1, kind: "part", make: 300, wo: "أت-2026/061", why: "طاقة القص تكفي 300 م²" }, { now: at(0), clock: clockAt(0), by: "قائد الورشة" })
    if (typeof res === "string") throw new Error(res)
    expect(res.line.mk).toMatchObject({ st: "part", make: 300, wo: "أت-2026/061", rv: 1 })
    expect(lineBuyQty(res.line, clockAt(0))).toBe(80)
    expect(beforeBuying(doc, res.line, clockAt(0), true)).toMatchObject({ workshop: { kind: "part", make: 300, wo: "أت-2026/061" }, buy: { kind: "buy", qty: 80, of: 380 } })
  })

  it("makes it all: nothing is bought; what the stores issue first comes off what the workshop makes", () => {
    const stocked = applyStockReply(rukham(), { line: 1, kind: "part", give: 80, warehouse: WH }, { now: at(0), clock: clockAt(0), by: "أ" })
    if (typeof stocked === "string") throw new Error(stocked)
    const doc = ask({ ...rukham(), lines: stocked.lines })
    const res = applyWorkshopReply(doc, { line: 1, kind: "make", wo: "أت-2026/062" }, { now: at(0), clock: clockAt(0), by: "ق" })
    if (typeof res === "string") throw new Error(res)
    expect(res.line.mk?.make).toBe(300)
    expect(lineBuyQty(res.line, clockAt(0))).toBe(0)
  })

  it("«يُشترى» needs a reason; making needs a work order number; part needs less than all", () => {
    const doc = ask(none(rukham()))
    const go = (input: Parameters<typeof applyWorkshopReply>[1]) => applyWorkshopReply(doc, input, { now: at(0), clock: clockAt(0), by: "ق" })
    expect(go({ line: 1, kind: "buy" })).toBe("no_reason")
    expect(go({ line: 1, kind: "make" })).toBe("no_work_order")
    expect(go({ line: 1, kind: "part", make: 380, wo: "أت-1" })).toBe("bad_qty")
    const buy = go({ line: 1, kind: "buy", why: "لا تتوفر ألواح بهذا السمك" })
    if (typeof buy === "string") throw new Error(buy)
    expect(lineBuyQty(buy.line, clockAt(0))).toBe(380)
    expect(beforeBuying(doc, buy.line, clockAt(0), true).workshop).toEqual({ kind: "buy", why: "لا تتوفر ألواح بهذا السمك" })
  })

  it("after a day with no answer the decision returns to the buyer; a late answer is refused", () => {
    const doc = ask(none(rukham()))
    expect(lineHeld(doc.lines[0], clockAt(1))).toBe("workshop")
    expect(lineHeld(doc.lines[0], clockAt(3))).toBeNull()
    expect(lineBuyQty(doc.lines[0], clockAt(3))).toBe(380)
    expect(applyWorkshopReply(doc, { line: 1, kind: "make", wo: "أت-1" }, { now: at(3), clock: clockAt(3), by: "ق" })).toBe("window_lapsed")
    const closed = proceedLapsed(doc.lines, clockAt(3))
    expect(closed.lines[0].mk).toMatchObject({ st: "buy", auto: "timeout" })
    expect(beforeBuying(doc, closed.lines[0], clockAt(3), true).workshop).toEqual({ kind: "timeout" })
  })

  it("NFR-08: closing the Manufacturing connector returns an unanswered question to the buyer but never reverts an answer that has a work order", () => {
    const doc = request(
      [
        { name: "رخام أ", unit: "م²", quantity: 100, material: stone(MARBLE) },
        { name: "رخام ب", unit: "م²", quantity: 100, material: stone(MARBLE) },
      ],
      {},
      "pm"
    )
    const stocked = asked(doc)
    const both = askWorkshop(stocked, { lines: [1, 2] }, { now: at(0), clock: clockAt(0), by: "المشتري", mfgOn: true })
    if (typeof both === "string") throw new Error(both)
    const answered = applyWorkshopReply({ ...stocked, lines: both.lines }, { line: 1, kind: "part", make: 40, wo: "أت-2026/070" }, { now: at(0), clock: clockAt(0), by: "ق" })
    if (typeof answered === "string") throw new Error(answered)
    const closed = closeWorkshopQuestions(answered.lines, clockAt(0))
    expect(closed.closed).toEqual([2])
    expect(closed.lines[0].mk).toMatchObject({ st: "part", make: 40, wo: "أت-2026/070" })
    expect(closed.lines[1].mk).toMatchObject({ st: "buy", auto: "closed" })
    expect(beforeBuying(stocked, closed.lines[1], clockAt(0), false).workshop).toEqual({ kind: "closed" })
  })
})

describe("what the screens read before buying", () => {
  const stoneLine = (): IncomingLine => ({ no: 1, name: "رخام", unit: "م²", qty: 22, material: stone(MARBLE), v: 1 })

  it("the card's summary counts waiting, issuing, making and askable lines; a closed request has none", () => {
    const doc = asked(request([{ name: "بلك", unit: "حبة", quantity: 10 }, { name: "رخام", unit: "م²", quantity: 22, material: stone(MARBLE) }]))
    expect(beforeSummary(doc, clockAt(0), true)).toEqual({ waitingStock: 2, waitingWorkshop: 0, issues: 0, makes: 0, askable: 1 })
    expect(beforeSummary(doc, clockAt(0), false).askable).toBe(0)
    expect(beforeSummary({ ...doc, st: "done" }, clockAt(0), true)).toEqual({ waitingStock: 0, waitingWorkshop: 0, issues: 0, makes: 0, askable: 0 })
  })

  it("«ننتظره من غيرنا»: every held line with the day its window ends, soonest first", () => {
    const a = asked(request([{ name: "بلك", unit: "حبة", quantity: 10 }]))
    const b = asked({ ...request([{ name: "رخام", unit: "م²", quantity: 5, material: stone(MARBLE) }]), mrKey: "team:r2", no: "MAT-2026/015" }, at(1))
    const rows = waitingLines([b, a], clockAt(1))
    expect(rows.map((r) => [r.no, r.who, r.until])).toEqual([["MAT-2026/014", "inventory", "2026-10-22"], ["MAT-2026/015", "inventory", "2026-10-23"]])
    expect(waitingLines([a], clockAt(5))).toEqual([])
  })

  it("a line in an RFQ or an order reads its place; a stone line without a reply offers the question", () => {
    const doc = request([{ name: "رخام", unit: "م²", quantity: 22, material: stone(MARBLE) }])
    const view = beforeBuying(doc, stoneLine(), clockAt(0), true)
    expect(view).toMatchObject({ stock: null, workshop: null, canAsk: true, buy: { kind: "buy", qty: 22, of: 22 } })
    const inRfq = { ...stoneLine(), ps: "rfq" as const, rfqNumber: "RFQ-2026/002" }
    expect(beforeBuying(doc, inRfq, clockAt(0), true)).toMatchObject({ canAsk: false, buy: { kind: "in_hand", qty: 0 } })
  })
})

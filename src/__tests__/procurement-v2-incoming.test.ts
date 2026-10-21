/**
 * Procurement 2.0 — «الطلب الوارد» as a stored entity whose LINES carry their place (WP-S2-03/05/08). Ported from the prototype's
 * QA: G-01 (a request is in one segment), G-13 (a line is in one place), R-10 (what an award leaves out comes back), R-12 (a
 * cancelled RFQ hands its lines back), R-29/WF-27 (could-not-buy closes what is left to buy only), B-13 (a closed connector hides
 * nothing), WF-01/WF-03 (the team's request and the project's whole request).
 */

import { displayNeedRef } from "@/lib/procurement/format"
import { matchesTemplate, requestStatusKey, workshopStatusKey } from "@/lib/procurement/event-keys"
import { fromPmRequest, fromTeamLegacy, newTeamRequest, refreshFromSource } from "@/lib/procurement/incoming-ingest"
import { incomingNeed, incomingNeeds, needKeyOfMr, sourceOfMr, toLinkWorld } from "@/lib/procurement/incoming-need"
import { REQUEST_SEGMENTS, cardSegment, inRequestSegment, requestCards, requestSegmentCounts } from "@/lib/procurement/incoming-requests"
import {
  FAIL_REASONS,
  INCOMING_SEGMENTS,
  REQUESTER_STEPS,
  buyLineIndexes,
  deriveRequest,
  eventRefOf,
  failLines,
  incomingCounts,
  incomingSegmentCounts,
  lineHeld,
  lineKind,
  linkPoLines,
  linkRfqLines,
  mrKeyParts,
  overlayLinks,
  releaseLines,
  replyClockOf,
  requesterStep,
  settle,
  type IncomingDoc,
  type IncomingLine,
  type LinkOrder,
  type LinkRfq,
  type RequestSt,
} from "@/lib/procurement/incoming-state"
import { procFactsOf } from "@/lib/pm/proc-state"
import { linePhase } from "@/lib/pm/supply"
import * as needsModule from "@/lib/procurement/needs"
import { needSourceParam, parseNeedSource } from "@/lib/procurement/needs"
import { buildNeedRows } from "@/lib/procurement/need-desk"
import { DEFAULT_RESOLVED_POLICIES } from "@/lib/procurement/policies"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"

const NOW = new Date("2026-10-21T08:00:00.000Z")
const clock = replyClockOf(NOW, { inventoryReplyDays: 1, workshopReplyDays: 1 })

const team = (over: Partial<IncomingDoc> = {}, lines = 3): IncomingDoc => ({
  ...newTeamRequest({
    organizationId: "org",
    id: "t1",
    no: "MAT-2026/014",
    seq: 14,
    lines: [
      { name: "الاسمنت العادي", unit: "كيس", quantity: 200 },
      { name: "حديد 16", unit: "طن", quantity: 12 },
      { name: "رمل لياسة", unit: "م³", quantity: 30 },
    ].slice(0, lines),
    needBy: "2026-11-10",
    siteId: "site1",
    place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
    requestedBy: { id: "u1", name: "فهد" },
    requestedFor: { kind: "member", id: "u1", name: "فهد" },
    at: "2026-10-20T08:00:00.000Z",
  }),
  ...over,
})

const src = (id = "t1") => ({ kind: "team_request", purchaseRequestId: id })
const rfq = (id: string, products: Array<{ name: string; unit: string; line: number }>, over: Partial<LinkRfq> = {}): LinkRfq => ({
  id,
  status: "New",
  rfqNumber: `RFQ-2026/${id}`,
  products: products.map((p) => ({ name: p.name, unit: p.unit, needSource: src(), needLine: p.line })),
  ...over,
})
const order = (id: string, rfqId: string, indexes: number[], over: Partial<LinkOrder> = {}): LinkOrder => ({
  id,
  status: "accepted",
  docNumber: `PO-2026/${id}`,
  rfqId,
  lines: indexes.map((i) => ({ rfqProductIndex: i, quantity: 1 })),
  ...over,
})
const ALL3 = [
  { name: "الاسمنت العادي", unit: "كيس", line: 0 },
  { name: "حديد 16", unit: "طن", line: 1 },
  { name: "رمل لياسة", unit: "م³", line: 2 },
]
const kinds = (d: IncomingDoc) => d.lines.map((l) => lineKind(l, clock))
const world = (rfqs: LinkRfq[] = [], orders: LinkOrder[] = []) => ({ rfqs, orders })

describe("a team's request is born whole, new, numbered MAT (WF-01)", () => {
  it("src team, state new, three lines to buy, the requester can read it", () => {
    const d = team()
    expect(d).toMatchObject({ src: "team", st: "new", status: "open", no: "MAT-2026/014", mrKey: "team:t1", requestedById: "u1", requesterIds: ["u1"] })
    expect(kinds(d)).toEqual(["buy", "buy", "buy"])
    expect(buyLineIndexes(d.lines, clock)).toEqual([0, 1, 2])
  })
  it("raised on behalf of a receiver with no account: only the buyer who raised it reads it as his", () => {
    const d = team({ requestedFor: { kind: "receiver", id: "r1", name: "سالم", phone: "+966500000001" }, requestedBy: { id: "buyer", name: "المشتري" } })
    const again = newTeamRequest({ organizationId: "org", id: "t2", no: "MAT-2026/015", seq: 15, lines: [{ name: "اسمنت", unit: "كيس", quantity: 1 }], needBy: "2026-11-10", place: { label: "x", city: "y", district: "" }, requestedBy: { id: "buyer", name: "المشتري" }, requestedFor: d.requestedFor, at: "2026-10-20T08:00:00.000Z" })
    expect(again.requesterIds).toEqual(["buyer"])
    expect(again.requestedFor).toMatchObject({ kind: "receiver", name: "سالم", phone: "+966500000001" })
  })
  it("English reads MR-2026/014, Arabic ط.م-2026/014 — one counter, MAT", () => {
    expect(displayNeedRef("MAT-2026/014", "en")).toBe("MR-2026/014")
    expect(displayNeedRef("MAT-2026/014", "ar")).toBe("ط.م-2026/014")
    expect(displayNeedRef("MR 03", "en")).toBe("MR 03")
  })
})

describe("G-13 — a line is in one place, and a partial award loses no material (R-10)", () => {
  it("published whole: every line is in the RFQ, the request is «في عروض»", () => {
    const d = settle(team(), world([rfq("1", ALL3)]), clock)
    expect(kinds(d)).toEqual(["rfq", "rfq", "rfq"])
    expect(d.st).toBe("rfq")
  })

  it("one of three awarded: that line is in the order, the other two come back to be bought — the request is partly handled and stays in «جديدة» (R-10)", () => {
    const rfqs = [rfq("1", ALL3, { status: "Awarded", unawardedLines: [1, 2] })]
    const d = settle(team(), world(rfqs, [order("9", "1", [0])]), clock)
    expect(kinds(d)).toEqual(["po", "buy", "buy"])
    expect(d.st).toBe("part")
    expect(d.lines[0]).toMatchObject({ ps: "po", poId: "9", poNumber: "PO-2026/9" })
    expect(buyLineIndexes(d.lines, clock)).toEqual([1, 2])
    const cards = requestCards(buildNeedRows([incomingNeed(d, clock)], { now: NOW, policies: DEFAULT_RESOLVED_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} }), [])
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ state: "partial", buyLines: 2, remainder: true })
    expect(cardSegment(cards[0])).toBe("new")
    expect(inRequestSegment(cards[0], "new")).toBe(true)
    expect(inRequestSegment(cards[0], "rfq")).toBe(false)
  })

  it("an award that gave the RFQ's two lines to two orders puts the request «في أمر»", () => {
    const rfqs = [rfq("1", ALL3.slice(0, 2), { status: "Awarded" })]
    const d = settle(team({}, 2), world(rfqs, [order("9", "1", [0]), order("8", "1", [1])]), clock)
    expect(kinds(d)).toEqual(["po", "po"])
    expect(d.st).toBe("po")
  })

  it("a row deleted from the draft before publishing stays to buy — the old behaviour linked the whole request and lost it", () => {
    const d = settle(team(), world([rfq("1", [ALL3[0], ALL3[2]])]), clock)
    expect(kinds(d)).toEqual(["rfq", "buy", "rfq"])
    expect(d.st).toBe("part")
    expect(buyLineIndexes(d.lines, clock)).toEqual([1])
  })

  it("never a line in two places: every combination of the world leaves one kind per line", () => {
    const worlds = [world(), world([rfq("1", ALL3)]), world([rfq("1", ALL3, { status: "Cancelled" })]), world([rfq("1", ALL3, { status: "Draft" })]), world([rfq("1", ALL3), rfq("2", ALL3)], [order("9", "1", [0, 1])])]
    for (const w of worlds) {
      const d = settle(team(), w, clock)
      for (const l of d.lines) {
        const places = [lineKind(l, clock) === "buy" || lineKind(l, clock) === "wait", l.ps === "rfq", l.ps === "po", l.ps === "fail"].filter(Boolean).length
        expect(places).toBe(1)
        if (l.ps === "rfq") expect(w.rfqs.some((r) => r.id === l.rfqId)).toBe(true)
        if (l.ps === "po") expect(w.orders.some((o) => o.id === l.poId)).toBe(true)
      }
    }
  })

  it("an order that arrived completes the request", () => {
    const rfqs = [rfq("1", ALL3.slice(0, 1), { status: "Awarded" })]
    const d = settle(team({}, 1), world(rfqs, [order("9", "1", [0], { derived: "received" })]), clock)
    expect(kinds(d)).toEqual(["done"])
    expect(d.st).toBe("done")
    expect(d.status).toBe("closed")
  })
})

describe("R-12 — a cancelled RFQ hands its lines back; a draft makes the request «مُجهَّز»", () => {
  it("cancelled: all three are to buy, the request is new again", () => {
    const published = settle(team(), world([rfq("1", ALL3)]), clock)
    expect(published.st).toBe("rfq")
    const back = settle(published, world([rfq("1", ALL3, { status: "Cancelled" })]), clock)
    expect(kinds(back)).toEqual(["buy", "buy", "buy"])
    expect(back.st).toBe("new")
    expect(buyLineIndexes(back.lines, clock)).toHaveLength(3)
    expect(back.lines.every((l) => !l.ps && !l.rfqId)).toBe(true)
  })

  it("a draft that names it: prepared, and it is still entirely to buy", () => {
    const d = settle(team(), world([rfq("1", ALL3, { status: "Draft" })]), clock)
    expect(d.st).toBe("prep")
    expect(kinds(d)).toEqual(["buy", "buy", "buy"])
  })

  it("an explicit release is not undone by the RFQ that still names the line", () => {
    const published = settle(team(), world([rfq("1", ALL3)]), clock)
    const released = releaseLines(published.lines, [1], "1")
    expect(released[1]).toMatchObject({ ps: null, rel: ["1"] })
    const again = settle({ ...published, lines: released }, world([rfq("1", ALL3)]), clock)
    expect(kinds(again)).toEqual(["rfq", "buy", "rfq"])
  })
})

describe("explicit acts on the lines (link-rfq · release · link-po)", () => {
  it("link-rfq refuses a line already in hand — never bought twice", () => {
    const d = team()
    const first = linkRfqLines(d.lines, [0, 1], { id: "1", number: "RFQ-2026/001" })
    expect(typeof first).not.toBe("string")
    const lines = (first as { lines: IncomingLine[] }).lines
    expect(linkRfqLines(lines, [1], { id: "2", number: "RFQ-2026/002" })).toBe("already_in_hand")
    expect(linkRfqLines(lines, [2], { id: "2", number: "RFQ-2026/002" })).toMatchObject({ lines: expect.any(Array) })
  })
  it("link-po moves a line from its RFQ into the order; a line of another order is refused", () => {
    const d = settle(team(), world([rfq("1", ALL3)]), clock)
    const res = linkPoLines(d.lines, [0], { id: "9", number: "PO-2026/009" }) as { lines: IncomingLine[] }
    expect(res.lines[0]).toMatchObject({ ps: "po", poId: "9" })
    expect(linkPoLines(res.lines, [0], { id: "8", number: "PO-2026/008" })).toBe("already_in_hand")
  })
  it("release returns only an RFQ's lines; an order is not taken back", () => {
    const d = team()
    const a = (linkRfqLines(d.lines, [0], { id: "1", number: "x" }) as { lines: IncomingLine[] }).lines
    const b = (linkPoLines(a, [1], { id: "9", number: "p" }) as { lines: IncomingLine[] }).lines
    const out = releaseLines(b, [0, 1], null)
    expect(out.map((l) => l.ps ?? null)).toEqual([null, "po", null])
  })
})

describe("R-29 / WF-27 — «تعذّر الشراء» closes what is left to buy and only that", () => {
  const at = "2026-10-21T08:00:00.000Z"
  it("the three lines: one in an RFQ carries on, the other two are closed with the reason and the alternative", () => {
    const d = settle(team(), world([rfq("1", [ALL3[0]])]), clock)
    const res = failLines(d.lines, { code: "avail", why: "المادة غير متوفرة في السوق", alt: "مكافئ من الخرج", at, by: "سارة" }, clock)
    expect(typeof res).not.toBe("string")
    const out = res as { lines: IncomingLine[]; closed: number[] }
    expect(out.closed).toEqual([1, 2])
    expect(out.lines.map((l) => l.ps)).toEqual(["rfq", "fail", "fail"])
    expect(out.lines[1].fail).toEqual({ code: "avail", why: "المادة غير متوفرة في السوق", alt: "مكافئ من الخرج", at, by: "سارة" })
    const settled = settle({ ...d, lines: out.lines }, world([rfq("1", [ALL3[0]])]), clock)
    expect(settled.st).toBe("rfq")
    expect(settled.lines[1].ps).toBe("fail")
  })
  it("a request with nothing in hand ends «تعذّر الشراء», and a failed line is never reopened by an RFQ", () => {
    const d = team({}, 2)
    const out = failLines(d.lines, { code: "nooff", why: "لا عروض حتى الموعد", alt: "", at, by: "سارة" }, clock) as { lines: IncomingLine[] }
    const settled = settle({ ...d, lines: out.lines }, world([rfq("1", ALL3.slice(0, 2))]), clock)
    expect(settled.st).toBe("fail")
    expect(settled.status).toBe("closed")
    expect(requesterStep(settled.st)).toBe("failed")
  })
  it("«سبب آخر» needs a reason of at least four characters; the others carry their own sentence", () => {
    const lines = team().lines
    expect(failLines(lines, { code: "other", why: "xyz", at, by: "s" }, clock)).toBe("reason")
    expect(failLines(lines, { code: "other", why: "تعذّر التوريد", at, by: "s" }, clock)).toMatchObject({ closed: [0, 1, 2] })
    expect(failLines(lines, { code: "price", why: "", at, by: "s" }, clock)).toBe("reason")
    expect(FAIL_REASONS).toEqual(["nooff", "price", "avail", "other"])
  })
  it("nothing to close when every line is in hand or waiting for a reply", () => {
    const d = settle(team({}, 1), world([rfq("1", ALL3.slice(0, 1))]), clock)
    expect(failLines(d.lines, { code: "nooff", why: "لا عروض", at, by: "s" }, clock)).toBe("nothing_to_close")
  })
})

describe("before buying — a line waiting for an answer is not published; it fails open after its window", () => {
  const waiting = (asked: string): IncomingDoc => {
    const d = team({}, 2)
    return { ...d, lines: d.lines.map((l, i) => (i === 0 ? { ...l, stk: { st: "wait" as const, at: asked } } : l)) }
  }
  it("inside the window it is held and the request still has its other line to buy", () => {
    const d = waiting("2026-10-21T06:00:00.000Z")
    expect(lineHeld(d.lines[0], clock)).toBe("stock")
    expect(kinds(d)).toEqual(["wait", "buy"])
    expect(buyLineIndexes(d.lines, clock)).toEqual([1])
    expect(deriveRequest(d.lines, { clock })).toBe("new")
  })
  it("after its window (a day) it is bought in full — no button", () => {
    const d = waiting("2026-10-19T06:00:00.000Z")
    expect(lineHeld(d.lines[0], clock)).toBeNull()
    expect(kinds(d)).toEqual(["buy", "buy"])
  })
  it("what the stores give is not bought: 500 of 2,000 leaves 1,500 to publish; fully given the line is covered", () => {
    const d = team({}, 1)
    const part = { ...d.lines[0], qty: 2000, stk: { st: "part" as const, give: 500, at: "2026-10-21T00:00:00Z" } }
    const need = incomingNeed({ ...d, lines: [part] }, clock)
    expect(need.lines[0]).toMatchObject({ quantity: 1500, asked: 2000, give: 500, lineKind: "buy" })
    const all = { ...d.lines[0], qty: 500, stk: { st: "issue" as const, give: 500, at: "2026-10-21T00:00:00Z" } }
    expect(lineKind(all, clock)).toBe("covered")
    expect(deriveRequest([all], { clock })).toBe("done")
  })
})

describe("G-01 — a request is in one segment, whatever its state", () => {
  const states: RequestSt[] = ["new", "prep", "part", "rfq", "po", "done", "fail", "wd"]
  it("the eight states land in six segments and every one counts once", () => {
    const facts = states.flatMap((st) => [{ st, buyLines: 0 }, ...(st === "part" ? [{ st, buyLines: 2 }] : [])])
    const counts = incomingSegmentCounts(facts, 0)
    const sum = INCOMING_SEGMENTS.filter((s) => s !== "all").reduce((a, s) => a + counts[s], 0)
    expect(sum).toBe(counts.all)
    expect(counts).toMatchObject({ upcoming: 0, new: 2, prepared: 1, rfq: 2, order: 1, done: 1, ended: 2, all: 9 })
  })
  it("the cards sum the same way, «قادمة» is a shell with no data, and «عند غيرنا» is gone", () => {
    const docs: IncomingDoc[] = [team({}, 1), team({ mrKey: "team:t2", no: "MAT-2026/015" }, 1), team({ mrKey: "team:t3", no: "MAT-2026/016" }, 2)]
    const needs = incomingNeeds(docs, toLinkWorld([], []), clock)
    const rows = buildNeedRows(needs, { now: NOW, policies: DEFAULT_RESOLVED_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} })
    const cards = requestCards(rows, [])
    const counts = requestSegmentCounts(cards)
    expect(REQUEST_SEGMENTS).toEqual(["upcoming", "new", "prepared", "rfq", "order", "done", "ended", "all"])
    expect(counts.all).toBe(3)
    expect(REQUEST_SEGMENTS.filter((s) => s !== "all").reduce((a, s) => a + counts[s], 0)).toBe(3)
    expect(counts.upcoming).toBe(0)
    expect(REQUEST_SEGMENTS as string[]).not.toContain("elsewhere")
  })
  it("the frame counts the new ones — a remainder is new again", () => {
    expect(incomingCounts([{ st: "new", buyLines: 3 }, { st: "part", buyLines: 1 }, { st: "part", buyLines: 0 }, { st: "rfq", buyLines: 0 }])).toEqual({ new: 2, open: 4 })
  })
})

describe("the desk reads the stored request line by line", () => {
  const facts = { now: NOW, policies: DEFAULT_RESOLVED_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} }
  it("keeps the request's own line numbers, offers only the lines to buy, and states the others", () => {
    const rfqs = [rfq("1", ALL3, { status: "Awarded", unawardedLines: [2] })]
    const d = settle(team(), world(rfqs, [order("9", "1", [0])]), clock)
    d.lines[1] = { ...d.lines[1], ps: "fail", fail: { code: "price", why: "x", alt: "", at: "", by: "" }, v: 3 }
    const need = incomingNeed(d, clock)
    expect(need.key).toBe("team:t1")
    expect(need.lines.map((l) => [l.lineKind, l.requestLine, Boolean(l.link)])).toEqual([["po", 0, true], ["fail", 1, true], ["buy", 2, false]])
    const rows = buildNeedRows([need], facts)
    expect(rows.map((r) => [r.index, r.state, r.open])).toEqual([[0, "po", 0], [1, "cx", 0], [2, "open", 30]])
    expect(rows[0].link).toMatchObject({ poId: "9" })
    expect(rows[2].selectable).toBe(true)
    expect(rows[0].selectable).toBe(false)
  })
  it("a request waiting only on a reply is not «جديدة» work: it has nothing selectable", () => {
    const d = team({}, 1)
    const held = { ...d, lines: [{ ...d.lines[0], stk: { st: "wait" as const, at: "2026-10-21T06:00:00Z" } }] }
    const rows = buildNeedRows([incomingNeed(held, clock)], facts)
    expect(rows[0]).toMatchObject({ state: "chk", open: 0, selectable: false })
    const workshop = { ...d, lines: [{ ...d.lines[0], mk: { st: "ask" as const, at: "2026-10-21T06:00:00Z" } }] }
    expect(buildNeedRows([incomingNeed(workshop, clock)], facts)[0].state).toBe("mfgw")
  })
})

describe("B-13 / NFR-08 — a closed connector hides nothing that is open", () => {
  it("no read-time filter by module exists any more: a project's request stays whatever the switches say", () => {
    expect((needsModule as Record<string, unknown>).needsForModules).toBeUndefined()
    expect((needsModule as Record<string, unknown>).ALL_NEED_MODULES).toBeUndefined()
  })
})

describe("a project's request arrives whole and unsplit (WF-03)", () => {
  const pr = (over: Record<string, unknown> = {}) =>
    ({
      id: "03",
      pm: true,
      seq: 3,
      title: "بلوك الدور الثاني",
      status: "approved",
      needBy: "2026-11-11",
      requestedByUserId: "eng1",
      requestedByUserName: "م. فهد العتيبي",
      approvedByName: "م. خالد",
      approvedOn: "2026-10-20",
      createdAt: "2026-10-19T08:00:00.000Z",
      lines: [
        { itemId: "i1", code: "04-01-01", key: "k1", name: "بلك اسمنتي مفرغ 20", unit: "حبة", qty: 2000 },
        { itemId: "i1", code: "04-01-01", key: "k2", name: "اسمنت عادي", unit: "كيس", qty: 150 },
      ],
      items: [{ name: "بلك اسمنتي مفرغ 20", unit: "حبة", quantity: 2000, category: "مواد البناء", itemId: "i1" }, { name: "اسمنت عادي", unit: "كيس", quantity: 150, itemId: "i1" }],
      ...over,
    }) as unknown as Parameters<typeof fromPmRequest>[2]
  const project = { id: "P1", name: "مجمع الياسمين" }

  it("one document for the whole request: the project's number, its project, its approval, its lines in order", () => {
    const d = fromPmRequest("org", project, pr(), {}, { siteId: "prj_P1", label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" })
    expect(d).toMatchObject({ mrKey: "pm:P1:03", src: "pm", no: "MR 03", seq: 3, projectId: "P1", approvedBy: { name: "م. خالد", on: "2026-10-20" }, st: "new", status: "open" })
    expect(d.lines.map((l) => [l.no, l.name, l.qty, l.boqItemId])).toEqual([[1, "بلك اسمنتي مفرغ 20", 2000, "i1"], [2, "اسمنت عادي", 150, "i1"]])
    expect(d.lines[0].category).toBe("مواد البناء")
    expect(needKeyOfMr(d.mrKey)).toBe("project:P1:03")
    expect(displayNeedRef(d.no, "ar")).toBe("ط.م 03")
  })

  it("Inventory's reply on the project's line: 500 issued from stock leaves 1,500 to buy (WF-04 shape)", () => {
    const d = fromPmRequest("org", project, pr({ lines: [{ itemId: "i1", code: "x", key: "k1", name: "بلك اسمنتي مفرغ 20", unit: "حبة", qty: 2000, inv: { k: "issue", q: 500, kept: 1500, on: "2026-10-20" } }] }))
    expect(d.lines[0].stk).toMatchObject({ st: "part", give: 500 })
    expect(incomingNeed(d, clock).lines[0]).toMatchObject({ quantity: 1500, asked: 2000 })
  })

  it("the project stops a line after approval: it is gone, the rest is bought; stopping every line withdraws the request", () => {
    const stopped = { itemId: "i1", code: "x", key: "k1", name: "بلك", unit: "حبة", qty: 100, cl: { t: "cancel", on: "2026-10-22", by: "u", byName: "م. فهد" } }
    const one = fromPmRequest("org", project, pr({ lines: [stopped, { itemId: "i1", code: "x", key: "k2", name: "اسمنت", unit: "كيس", qty: 5 }] }))
    expect(one.lines[0].gone).toMatchObject({ kind: "withdrawn" })
    expect(kinds(one)).toEqual(["gone", "buy"])
    expect(one.changes?.[0]).toMatchObject({ kind: "withdrawn" })
    const all = settle(fromPmRequest("org", project, pr({ lines: [stopped] })), world(), clock)
    expect(all.st).toBe("wd")
    expect(all.withdrawal).toMatchObject({ byName: "م. فهد" })
  })

  it("re-reading the source keeps Procurement's marks and moves only what the project owns", () => {
    const first = settle(fromPmRequest("org", project, pr()), world([{ id: "1", status: "New", rfqNumber: "RFQ-2026/001", products: [{ name: "بلك اسمنتي مفرغ 20", unit: "حبة", needSource: { kind: "project_request", projectId: "P1", purchaseRequestId: "03" }, needLine: 0 }] }]), clock)
    expect(kinds(first)).toEqual(["rfq", "buy"])
    const failed = { ...first, lines: first.lines.map((l, i) => (i === 1 ? { ...l, ps: "fail" as const, fail: { code: "nooff" as const, why: "w", alt: "", at: "", by: "" }, v: l.v + 1 } : l)) }
    const fresh = fromPmRequest("org", project, pr({ lines: [{ itemId: "i1", code: "x", key: "k1", name: "بلك اسمنتي مفرغ 20", unit: "حبة", qty: 2200 }, { itemId: "i1", code: "x", key: "k2", name: "اسمنت عادي", unit: "كيس", qty: 150 }] }))
    const merged = refreshFromSource(failed, fresh)
    expect(merged.lines[0]).toMatchObject({ qty: 2200, ps: "rfq", rfqId: "1" })
    expect(merged.lines[0].v).toBe(failed.lines[0].v + 1)
    expect(merged.lines[1]).toMatchObject({ ps: "fail", v: failed.lines[1].v })
  })
})

describe("a legacy team request moves across as it was", () => {
  it("open, declined and withdrawn keep their meaning; the notice it carried follows", () => {
    const base = { id: "L1", organizationId: "org", number: "MAT-2026/009", lines: [{ name: "اسمنت", unit: "كيس", quantity: 5 }], needBy: "2026-11-01", place: { label: "المستودع", city: "الرياض", district: "" }, requestedById: "u1", requestedByName: "فهد", createdAt: "2026-10-01T00:00:00Z" }
    const open = fromTeamLegacy({ ...base, status: "open", notifiedState: "rfq", stateAt: "2026-10-02T00:00:00Z" } as Parameters<typeof fromTeamLegacy>[0])
    expect(open).toMatchObject({ st: "new", mrKey: "team:L1", legacyId: "L1", notifiedState: "rfq", requestedById: "u1" })
    const declined = fromTeamLegacy({ ...base, status: "declined", declinedReason: "غير متوفر", declinedByName: "سارة" } as Parameters<typeof fromTeamLegacy>[0])
    expect(declined.st).toBe("fail")
    expect(declined.lines[0].fail).toMatchObject({ why: "غير متوفر", by: "سارة" })
    const withdrawn = settle(fromTeamLegacy({ ...base, status: "withdrawn" } as Parameters<typeof fromTeamLegacy>[0]), world(), clock)
    expect(withdrawn.st).toBe("wd")
  })
})

describe("the contract of the key and the event", () => {
  it("each need key maps both ways: mrKey → need key → source param → mrKey", () => {
    for (const mrKey of ["pm:P1:03", "team:abc", "mfg:WO1:PRQ9"]) {
      const need = needKeyOfMr(mrKey)
      expect(mrKeyParts(mrKey)).not.toBeNull()
      const source = sourceOfMr(mrKey)
      expect(parseNeedSource(needSourceParam(source))).toEqual(source)
      expect(need.split(":")[0]).toBe(mrKey.startsWith("pm") ? "project" : mrKey.split(":")[0])
    }
  })
  it("the status of a line goes out as proc:ST:<request>:<line>:V<n>, a project's and a workshop's alike", () => {
    expect(eventRefOf("pm:P1:03")).toBe("pm.P1.03")
    expect(requestStatusKey(eventRefOf("pm:P1:03"), 2, 3)).toBe("proc:ST:pm.P1.03:2:V3")
    expect(matchesTemplate("pm_status", requestStatusKey(eventRefOf("pm:P1:03"), 2, 3))).toBe(true)
    expect(matchesTemplate("mfg_status", workshopStatusKey(eventRefOf("mfg:WO1:PRQ9"), 1, 2))).toBe(true)
  })
  it("the requester's four steps", () => {
    expect(REQUESTER_STEPS).toEqual(["placed", "rfq", "order", "arrived"])
    expect((["new", "prep", "part", "rfq", "po", "done", "fail", "wd"] as RequestSt[]).map(requesterStep)).toEqual(["placed", "placed", "placed", "rfq", "order", "arrived", "failed", "withdrawn"])
  })
  it("the policies the clock reads are the defaults of 1.5: a day for Inventory, a day for the workshop", () => {
    expect(DEFAULT_POLICIES.inventoryReplyDays).toBe(1)
    expect(DEFAULT_POLICIES.workshopReplyDays).toBe(1)
  })
})

describe("overlay is stable: reading the same world twice changes nothing", () => {
  it("returns the same lines (no version bump) when nothing moved", () => {
    const w = world([rfq("1", ALL3)], [order("9", "1", [0])])
    const once = settle(team(), w, clock)
    const twice = overlayLinks(once, w)
    expect(twice).toEqual(once.lines)
    expect(twice.map((l) => l.v)).toEqual(once.lines.map((l) => l.v))
  })
})

describe("a request its requester took back has nothing left to buy", () => {
  it("the desk reads every line as gone: no card offers «انشره», no «تعذّر الشراء», the card is in «انتهت»", () => {
    const d = settle({ ...team(), withdrawn: { at: "2026-10-21T08:00:00Z", by: "u1", name: "فهد" } }, world(), clock)
    expect(d.st).toBe("wd")
    const need = incomingNeed(d, clock)
    expect(need.lines.every((l) => l.lineKind === "gone" && l.link)).toBe(true)
    const rows = buildNeedRows([need], { now: NOW, policies: DEFAULT_RESOLVED_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} })
    const [card] = requestCards(rows, [])
    expect(card).toMatchObject({ state: "withdrawn", buyLines: 0, selectable: false })
    expect(inRequestSegment(card, "ended")).toBe(true)
  })
})

describe("Projects reads «تعذّر الشراء» from the stored request (WP-S2-08)", () => {
  const stored = (over: Partial<IncomingDoc> = {}) => ({ ...team(), src: "pm" as const, mrKey: "pm:P1:03", projectId: "P1", ...over })
  it("only a failed line of a project's own request carries the reason and the alternative, by its place in the request", () => {
    const failed = failLines(stored().lines, { code: "price", why: "الأسعار فوق الميزانية بكثير", alt: "مورد في الخرج", at: "2026-10-21T08:00:00Z", by: "بدر" }, clock) as { lines: IncomingLine[] }
    const facts = procFactsOf([stored({ lines: [failed.lines[0], stored().lines[1], failed.lines[2]] }), stored({ mrKey: "pm:P2:03", projectId: "P2" }), stored({ mrKey: "team:x", src: "team" })], "P1")
    expect([...facts.keys()]).toEqual(["03"])
    expect(facts.get("03")).toEqual([{ fail: { why: "الأسعار فوق الميزانية بكثير", alt: "مورد في الخرج" } }, {}, { fail: { why: "الأسعار فوق الميزانية بكثير", alt: "مورد في الخرج" } }])
  })
  it("the line's phase becomes «fail» — after what has arrived, before what is out with the supplier", () => {
    const r = { status: "approved", withdrawn: false, rfqId: null, poId: "po1", mfgRequestId: null } as unknown as Parameters<typeof linePhase>[0]
    const line = { itemId: null, code: null, key: "k", name: "x", unit: "u", qty: 10 } as unknown as Parameters<typeof linePhase>[1]
    expect(linePhase(r, line)).toBe("po")
    expect(linePhase(r, line, { fail: { why: "w", alt: "" } })).toBe("fail")
    expect(linePhase(r, { ...line, receipts: [{ grn: "g", q: 10, rej: 0, on: "2026-10-01", by: "u" }] } as unknown as typeof line, { fail: { why: "w", alt: "" } })).toBe("done")
  })
})

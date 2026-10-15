/**
 * Supplier 1.0 — the invariants that must always hold (PRD G-01 … G-12), run over the
 * prototype's 144-deal demo world. These are the QA "guards" pack as automated tests;
 * the difference from the prototype is decision 1 (one invoice per receipt).
 */

import { createWorldLogic } from "@/lib/supplier-free/world-logic"
import { STAGES, OFFER_SEG, addDaysTo } from "@/lib/supplier-free/deal-logic"
import type { Deal, World } from "@/lib/supplier-free/types"
import { protoWorld } from "@/test-utils/supplier-free-world"

const { today, world } = protoWorld()
const W = createWorldLogic(today, world)
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))
const ids = (l: Deal[]) => l.slice(0, 4).map((d) => d.id).join(", ")

describe("the demo world", () => {
  it("has the prototype's volume", () => {
    expect(world.deals).toHaveLength(144)
    expect(W.opps({}).length).toBe(62)
  })
})

describe("G-01 every deal is in exactly one stage", () => {
  it("is in one of the five stages and they sum to the deals", () => {
    expect(world.deals.filter((d) => !(STAGES as readonly string[]).includes(W.stage(d)))).toHaveLength(0)
    const one = (d: Deal) =>
      [
        !!d.closed,
        !d.closed && !d.offer,
        !d.closed && !!d.offer && !d.po,
        !d.closed && !!d.po && (!d.po.acc || !W.allGot(d)),
        !d.closed && !!d.po && !!d.po.acc && W.allGot(d),
      ].filter(Boolean).length === 1
    expect(world.deals.filter((d) => !one(d))).toHaveLength(0)
    expect(W.segCounts().reduce((s, x) => s + x[1], 0)).toBe(world.deals.length)
    expect(new Set(world.deals.map((d) => d.id)).size).toBe(world.deals.length)
  })
})

describe("G-02 every quantity is in one place", () => {
  it("ordered = accepted + cancelled + left on every line", () => {
    const bad: string[] = []
    for (const d of world.deals.filter((x) => x.po)) {
      for (const l of (d.po as NonNullable<Deal["po"]>).lines) {
        const s = W.lineSt(l)
        if (s.got + s.can + s.left !== s.ord) bad.push(`${d.id}/${l.it}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("a rejected quantity returns to left unless the contractor cancels it", () => {
    const d = clone(world.deals.find((x) => x.po && x.ship.some((s) => s.st === "ok")) as Deal)
    const l = (d.po as NonNullable<Deal["po"]>).lines[0]
    l.can = 0
    l.got = l.qty
    l.rej = 0
    const left0 = W.lineSt(l).left
    l.got = l.qty - 1
    l.rej = 1
    expect(W.lineSt(l).left).toBe(left0 + 1)
    l.can = 1
    expect(W.lineSt(l).left).toBe(left0)
  })
})

describe("G-03 quantities come only from the contractor's receipt", () => {
  it("a delivery report is a date and a note", () => {
    const reports = world.deals.flatMap((d) => d.ship.filter((s) => s.st !== "ok"))
    expect(reports.length).toBeGreaterThan(0)
    for (const r of reports) expect(Object.keys(r).every((k) => ["st", "at", "date", "note", "reminders"].includes(k))).toBe(true)
  })

  it("a receipt carries the contractor's number, who recorded it, its date and its items", () => {
    for (const d of world.deals) {
      for (const r of W.receipts(d)) {
        expect(r.grn && r.by && r.okAt && r.date && Object.keys(r.items).length).toBeTruthy()
      }
    }
  })

  it("reporting delivery moves no quantity", () => {
    const d = clone(world.deals.find((x) => x.po && x.po.acc) as Deal)
    const lines = JSON.stringify(d.po?.lines.map((l) => W.lineSt(l)))
    const got = W.gotValue(d)
    const unsent = W.unsentValue(d)
    d.ship.push({ st: "wait", at: today, date: today })
    expect(JSON.stringify(d.po?.lines.map((l) => W.lineSt(l)))).toBe(lines)
    expect(W.gotValue(d)).toBe(got)
    expect(W.unsentValue(d)).toBe(unsent)
  })
})

describe("G-04 one figure, one definition", () => {
  const k = W.dashK()
  const kp = W.kpis()
  const b = W.badges()
  it("yours to deliver is the same value everywhere", () => {
    expect(kp.unsent).toBe(W.kpis().unsent)
    expect(k.accUnsent).toBe(
      Math.round(world.deals.filter((d) => W.poSt(d) === "supply").reduce((s, d) => s + W.unsentValue(d), 0) * 100) / 100
    )
  })
  it("owed to you is invoices incl. VAT less confirmed transfers", () => {
    const expected = world.deals
      .filter((d) => d.invs.length)
      .reduce((s, d) => s + Math.max(0, W.grossTotal(d) - W.paidOk(d)), 0)
    expect(k.owed).toBeCloseTo(expected, 1)
    expect(kp.owed).toBe(k.owed)
  })
  it("open requests equal the list a page shows", () => {
    expect(k.opps).toBe(W.opps({}).length)
  })
  it("every sidebar badge equals what its page shows", () => {
    expect(b.opps.n).toBe(W.opps({ tab: "new" }).length)
    expect(b.offers.n).toBe(W.myOffers({ seg: "reply" }).length)
    expect(b.home.n).toBe(W.allActs().length)
    expect(b.invoices.n).toBe(W.invoiceRows().filter((r) => W.INV_WHO[r.st] === "you").length)
    expect(b.orders.n).toBe(world.deals.filter((d) => W.WHO[W.poSt(d) as string] === "you").length)
    expect(b.connections.n).toBe(world.invites.length)
  })
})

describe("G-05 lateness is one rule", () => {
  const late = world.deals.filter(W.isLate)

  it("late deals are what is left after the committed date with no on-time report", () => {
    const due = world.deals.filter((d) => d.po && d.po.acc && !d.closed && W.unsentValue(d) > 0 && W.daysTo(d.po.acc.date) < 0)
    const unreported = due.filter((d) => !W.waiting(d).some((s) => W.daysTo(s.date, (d.po as NonNullable<Deal["po"]>).acc!.date) <= 0))
    expect(unreported.every(W.isLate)).toBe(true)
    expect(late.every((d) => unreported.includes(d))).toBe(true)
  })

  it("late tasks are exactly the late deals with no pending report", () => {
    const tk = W.allActs().filter((x) => x.kind === "aLate").map((x) => x.deal).sort().join()
    expect(tk).toBe(late.filter((d) => !W.waiting(d).length).map((d) => d.id).sort().join())
  })

  it("an order is late, on-time-reported, late-reported, then received", () => {
    const base = clone(world.deals.find((x) => x.po) as Deal)
    delete base.closed
    base.ship = []
    const po = base.po as NonNullable<Deal["po"]>
    po.lines.forEach((l) => {
      l.got = 0
      l.rej = 0
      l.can = 0
    })
    po.acc = { at: addDaysTo(today, -10), date: addDaysTo(today, -2) }
    const none = W.isLate(base)
    base.ship = [{ st: "wait", at: today, date: addDaysTo(today, -2) }]
    const onTime = W.isLate(base)
    base.ship = [{ st: "wait", at: today, date: addDaysTo(today, -1) }]
    const after = W.isLate(base)
    const all = Object.fromEntries(po.lines.map((l) => [l.it, l.qty]))
    base.ship = [{ st: "ok", date: addDaysTo(today, -1), okAt: today, items: all, got: all, grn: "QA", by: "QA", t: "09:00" }]
    po.lines.forEach((l) => (l.got = l.qty))
    expect([none, onTime, after, W.isLate(base)]).toEqual([true, false, true, false])
  })
})

describe("G-06 every quote is in one group and ends with a result", () => {
  const offs = world.deals.filter((d) => d.offer)
  it("is in exactly one group", () => {
    const bad = offs.filter((d) => Object.values(OFFER_SEG).filter((v) => (v as readonly string[]).includes(W.offerSt(d) as string)).length !== 1)
    expect(ids(bad)).toBe("")
    expect(W.myOffers({}).length).toBe(offs.length)
  })
  it("results come after the deadline and a withdrawal before it", () => {
    const early = offs.filter((d) => ["won", "lost", "noaward"].includes(W.offerSt(d) as string) && W.daysTo(W.offAt(d), d.deadline) <= 0)
    expect(ids(early)).toBe("")
    const wl = offs.filter((d) => W.offerSt(d) === "withdrawn" && !(d.closed && W.daysTo(d.closed.at, d.deadline) <= 0))
    expect(ids(wl)).toBe("")
  })
  it("a closed quote is never in an open group", () => {
    expect(offs.filter((d) => d.closed).every((d) => ["won", "lost"].includes(W.offerSeg(d) as string))).toBe(true)
  })
})

describe("G-07 an invoice never exceeds what the contractor received", () => {
  const withInv = world.deals.filter((d) => d.invs.length)
  it("is below the accepted value, dated after the last receipt it covers and not in the future, with a file", () => {
    for (const d of withInv) {
      expect(W.invoicedNet(d)).toBeLessThanOrEqual(W.gotValue(d) + 0.009)
      for (const i of d.invs) {
        expect(i.file).toBeTruthy()
        const covered = W.receipts(d).filter((r) => (i.grns || []).includes(r.grn))
        expect(covered.length).toBeGreaterThan(0)
        const last = covered.map((r) => r.okAt).sort().pop() as string
        expect(W.daysTo(i.date, last)).toBeGreaterThanOrEqual(0)
        expect(W.daysTo(i.date)).toBeLessThanOrEqual(0)
      }
    }
  })
  it("billing is open for received-and-unbilled value, one receipt at a time", () => {
    const d = clone(world.deals.find((x) => x.po && x.po.acc && W.receipts(x).length > 0 && !x.invs.length) as Deal)
    expect(W.canInvoice(d)).toBe(true)
    expect(W.uninvoicedReceipts(d).length).toBe(W.receipts(d).length)
    const first = W.receipts(d)[0]
    d.invs = [{ no: "T-1", date: today, amt: W.receiptNet(d, first), file: "t.pdf", grns: [first.grn] }]
    expect(W.uninvoicedReceipts(d).some((r) => r.grn === first.grn)).toBe(false)
  })
})

describe("G-08 instalments come from the terms frozen on the order", () => {
  const pos = world.deals.filter((d) => d.po)
  it("every order has terms that add up to 100%", () => {
    expect(pos.filter((d) => !d.po?.terms.length || Math.abs((d.po as NonNullable<Deal["po"]>).terms.reduce((s, x) => s + x.pct, 0) - 100) > 0.001)).toHaveLength(0)
  })
  it("each instalment is due on the invoice date plus the term's days and they add up to the invoice", () => {
    for (const d of world.deals.filter((x) => x.invs.length)) {
      for (const i of d.invs) {
        const s = W.sched(d, i)
        const terms = (d.po as NonNullable<Deal["po"]>).terms
        expect(s.map((x) => x.due)).toEqual(terms.map((t) => addDaysTo(i.date, t.days)))
        expect(s.reduce((t, x) => t + x.amt, 0)).toBeCloseTo(W.invGross(i), 1)
      }
    }
  })
  it("changing the contractor's terms later does not touch an order already issued", () => {
    const d = clone(world.deals.find((x) => x.invs.length) as Deal)
    const before = JSON.stringify(d.invs.map((i) => W.sched(d, i)))
    d.terms = [{ pct: 100, days: 90 }]
    expect(JSON.stringify(d.invs.map((i) => W.sched(d, i)))).toBe(before)
  })
})

describe("G-09 a missing transfer is settled by any later one", () => {
  it("'not received' stays open only while it is the last transfer", () => {
    const d = clone(world.deals.find((x) => x.invs.length) as Deal)
    delete d.closed
    d.pays = []
    const P = (ref: string, st: "sent" | "ok" | "miss") => d.pays.push({ at: today, amt: 1, bank: "QA", ref, st })
    P("Q1", "miss")
    const o1 = W.payIssue(d)
    P("Q2", "miss")
    const o2 = W.payIssue(d)
    P("Q3", "sent")
    const o3 = W.payIssue(d)
    const e = clone(world.deals.find((x) => x.invs.length) as Deal)
    e.pays = [{ at: today, amt: 1, bank: "QA", ref: "Q4", st: "miss" }]
    const o4 = W.payIssue(e)
    e.pays[0].st = "ok"
    expect([o1, o2, o3, o4, W.payIssue(e)]).toEqual([true, true, false, true, false])
  })
  it("a missing transfer is never counted as paid", () => {
    for (const d of world.deals) {
      expect(W.paidOk(d) + W.paidSent(d)).toBeCloseTo(d.pays.filter((p) => p.st !== "miss").reduce((s, p) => s + p.amt, 0), 1)
    }
  })
})

describe("G-11 no task on you while you wait for the contractor", () => {
  it("a deal waiting on the contractor has no delivery or quote task", () => {
    const acts = W.allActs()
    const wt = world.deals.filter((d) => W.poSt(d) === "wait" || W.offerSeg(d) === "wait")
    const hit = wt.filter((d) => acts.some((x) => x.deal === d.id && !["aInvoice", "aPaySent"].includes(x.kind)))
    expect(ids(hit)).toBe("")
  })
  it("after reporting delivery, no delivery task shows", () => {
    const d = clone(world.deals.find((x) => x.po && x.po.acc && !x.closed && !W.waiting(x).length && W.unsentValue(x) > 0) as Deal)
    d.ship.push({ st: "wait", at: today, date: today })
    expect(W.dealActs(d).filter((x) => ["aLate", "aShipSoon"].includes(x.kind))).toHaveLength(0)
  })
  it("while a quote awaits the decision, no task shows", () => {
    const o = clone(world.deals.find((x) => ["reduce", "sample"].includes(W.offerSt(x) as string)) as Deal)
    ;(o.offer as NonNullable<Deal["offer"]>).status = o.offer?.status === "sample" ? "sampleSent" : "review"
    expect(W.dealActs(o)).toHaveLength(0)
  })
})

describe("G-12 tasks keep one order", () => {
  it("overdue, today or tomorrow, accept/invoice, within 3 days, transfers, later, connections", () => {
    const acts = W.allActs()
    const tier = (x: (typeof acts)[number]) => {
      const n = x.due ? W.daysTo(x.due) : null
      if (x.kind === "aConnInvite") return 6
      if (n !== null && n < 0) return 0
      if (n !== null && n <= 1) return 1
      if (["aAcceptPO", "aInvoice"].includes(x.kind)) return 2
      if (n !== null && n <= 3) return 3
      if (x.kind === "aPaySent") return 4
      return 5
    }
    const tr = acts.map(tier)
    expect(tr.every((x, i) => !i || x >= tr[i - 1])).toBe(true)
    expect(acts.every((x, i) => !i || tr[i] !== tr[i - 1] || !x.due || !acts[i - 1].due || x.due >= (acts[i - 1].due as string))).toBe(true)
  })
})

describe("page figures", () => {
  it("'new' is posted within two days and not opened; opening clears it", () => {
    const w: World = clone(world)
    const L = createWorldLogic(today, w)
    const n = L.opps({ tab: "new" })
    expect(n.length).toBeGreaterThan(0)
    w.seen[n[0].id] = 1
    expect(createWorldLogic(today, w).opps({ tab: "new" })).toHaveLength(n.length - 1)
  })
  it("received % is accepted value over the order less what was cancelled", () => {
    const d = world.deals.find((x) => x.po && W.receipts(x).length && !W.allGot(x)) as Deal
    expect(W.deliveredPct(d)).toBeGreaterThan(0)
    expect(W.deliveredPct(d)).toBeLessThan(100)
  })
})

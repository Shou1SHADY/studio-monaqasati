// The supplier's lists, tasks and page figures over his whole world (PRD §7–§8). One
// function per figure, so "Today", its page and the sidebar badge read the same value
// (G-04): a number is never recomputed in a screen.

import { createDealLogic, dayNum, OFFER_ORDER, r2, type OfferSeg } from "./deal-logic"
import type { Deal, World } from "./types"

export type TaskKind = "aInviteRfq" | "aReduce" | "aSample" | "aAcceptPO" | "aLate" | "aShipSoon" | "aInvoice" | "aPaySent" | "aConnInvite"
export type TaskDomain = "offers" | "supply" | "money" | "links"

export interface Task {
  kind: TaskKind
  deal?: string
  /** The contractor, for a connection invitation. */
  c?: string
  due: string | null
  tier?: 2 | 4
}

export const TASK_DOMAIN: Record<TaskKind, TaskDomain> = {
  aInviteRfq: "offers",
  aReduce: "offers",
  aSample: "offers",
  aAcceptPO: "supply",
  aLate: "supply",
  aShipSoon: "supply",
  aInvoice: "money",
  aPaySent: "money",
  aConnInvite: "links",
}

export type InvoiceRowState = "toinv" | "sent" | "due" | "paid"

/** One row of Invoices & transfers: an invoice of an order, or what is still to be invoiced on it (one invoice per receipt). */
export interface InvoiceRow {
  key: string
  deal: Deal
  kind: "toinv" | "inv"
  /** Index into `deal.invs` for an invoice row. */
  n: number | null
  st: InvoiceRowState
  /** Including VAT: the invoice's total, or the estimate of what is left to bill. */
  gross: number
  /** What is still owed on it (an estimate for "to invoice"). */
  left: number
  late: boolean
  /** The last transfer was reported "not received". */
  issue: boolean
}

export const NEW_WINDOW_DAYS = 2
export const PAGE_SIZE = 24

export interface OppFilter {
  tab?: "all" | "arch" | "invite" | "field" | "new"
  cat?: string
  city?: string
  c?: string
  due?: "3" | "7" | ""
  q?: string
  sort?: "new" | ""
}

export interface OfferFilter {
  seg?: "all" | OfferSeg
  c?: string
  cat?: string
  q?: string
  sort?: "value" | ""
}

export function createWorldLogic(today: string, world: World, vatRate?: number) {
  const L = createDealLogic(today, vatRate)
  const { daysTo, stage, offerSt, offerSeg, offAt, offDue, poSt } = L
  const { deals, contractors } = world

  const cityOf = (d: Deal) => d.city.split(" — ")[0]
  const C = (id: string) => contractors[id]

  function matchQ(d: Deal, q: string): boolean {
    const needle = String(q).toLowerCase()
    const c = C(d.c)
    return [d.title, c && c.name, d.rfq, d.po && d.po.no, d.city, ...d.items.map((i) => i.name)].some((x) => x && String(x).toLowerCase().includes(needle))
  }

  // ---- New requests and results ("new" until opened) ----------------------------------

  const isNewReq = (d: Deal) => !world.seen[d.id] && daysTo(d.posted) >= -NEW_WINDOW_DAYS
  const isNewResult = (d: Deal) => ["won", "lost", "noaward"].includes(offerSt(d) as string) && daysTo(offAt(d)) >= -NEW_WINDOW_DAYS && !world.seen[d.id]

  // ---- Quote requests (the open ones: not quoted, not past the deadline, not archived) --

  const isOpenReq = (d: Deal) => stage(d) === "new" && daysTo(d.deadline) >= 0 && !world.arch[d.id]
  const isArchivedReq = (d: Deal) => stage(d) === "new" && daysTo(d.deadline) >= 0 && !!world.arch[d.id]

  function opps(f: OppFilter = {}): Deal[] {
    return deals
      .filter(
        (d) =>
          stage(d) === "new" &&
          daysTo(d.deadline) >= 0 &&
          (f.tab === "arch" ? !!world.arch[d.id] : !world.arch[d.id]) &&
          (f.tab === "invite" ? d.channel === "invite" : f.tab === "field" ? d.channel !== "invite" : f.tab === "new" ? isNewReq(d) : true) &&
          (!f.cat || d.cat === f.cat) &&
          (!f.city || cityOf(d) === f.city) &&
          (!f.c || d.c === f.c) &&
          (!f.due || (f.due === "3" ? daysTo(d.deadline) <= 3 : daysTo(d.deadline) <= 7)) &&
          (!f.q || matchQ(d, f.q))
      )
      .sort((a, b) => (f.sort === "new" ? dayNum(b.posted) - dayNum(a.posted) : daysTo(a.deadline) - daysTo(b.deadline)))
  }

  /** Deadline groups (RFQ-05): counted over the whole list, not the visible page. */
  function deadlineGroup(d: Deal): "soon" | "week" | "later" {
    const n = daysTo(d.deadline)
    return n <= 1 ? "soon" : n <= 7 ? "week" : "later"
  }

  // ---- My quotes ----------------------------------------------------------------------

  function myOffers(f: OfferFilter = {}): Deal[] {
    const q = (f.q || "").trim()
    return deals
      .filter((d) => d.offer && offerSeg(d) && (!f.seg || f.seg === "all" || offerSeg(d) === f.seg) && (!f.c || d.c === f.c) && (!f.cat || d.cat === f.cat) && (!q || matchQ(d, q)))
      .sort((a, b) => {
        const ga = OFFER_ORDER.indexOf(offerSeg(a) as OfferSeg)
        const gb = OFFER_ORDER.indexOf(offerSeg(b) as OfferSeg)
        if (ga !== gb) return ga - gb
        if (f.sort === "value") return L.offerTotal(b) - L.offerTotal(a)
        if (ga === 0) return dayNum(offDue(a) as string) - dayNum(offDue(b) as string)
        return dayNum(offAt(b)) - dayNum(offAt(a))
      })
  }

  // ---- Tasks: what a named contractor asked, or what stalls without the supplier -----

  function dealActs(d: Deal): Task[] {
    const st = stage(d)
    const o = d.offer
    const a: Omit<Task, "deal">[] = []
    if (st === "new" && d.channel === "invite" && daysTo(d.deadline) >= 0 && !world.arch[d.id]) a.push({ kind: "aInviteRfq", due: d.deadline })
    if (st === "offered" && o && o.status === "reduce" && o.reduce) a.push({ kind: "aReduce", due: o.reduce.by })
    if (st === "offered" && o && o.status === "sample" && o.sample) a.push({ kind: "aSample", due: o.sample.by })
    if (st === "deliver" && d.po) {
      if (!d.po.acc) a.push({ kind: "aAcceptPO", due: null, tier: 2 })
      else if (L.waiting(d).length) {
        /* reported: the move is the contractor's, no task on the supplier (G-11) */
      } else if (L.isLate(d)) a.push({ kind: "aLate", due: d.po.acc.date })
      else if (daysTo(d.po.acc.date) <= 3) a.push({ kind: "aShipSoon", due: d.po.acc.date })
    }
    if (d.po && d.po.acc && !(d.closed && d.closed.k === "declined")) {
      if (L.canInvoice(d)) a.push({ kind: "aInvoice", due: null, tier: 2 })
      if (L.paidSent(d) > 0) a.push({ kind: "aPaySent", due: null, tier: 2 })
    }
    return a.map((x) => ({ deal: d.id, ...x }))
  }

  /** Overdue → today or tomorrow → accept an order / upload an invoice → within 3 days →
   * confirm a transfer → later → connections (G-12). */
  function taskKey(x: Task): [number, number] {
    const n = x.due ? daysTo(x.due) : null
    if (n != null && n < 0) return [0, n]
    if (n != null && n <= 1) return [1, n]
    if (x.kind === "aAcceptPO" || x.kind === "aInvoice") return [2, 0]
    if (n != null && n <= 3) return [3, n]
    if (x.kind === "aPaySent") return [4, 0]
    if (n != null) return [5, n]
    return [6, 0]
  }

  function allActs(): Task[] {
    const list: Task[] = []
    deals.forEach((d) => list.push(...dealActs(d)))
    world.invites.forEach((iv) => list.push({ kind: "aConnInvite", c: iv.c, due: null, tier: 4 }))
    return list.sort((a, b) => {
      const ka = taskKey(a)
      const kb = taskKey(b)
      return ka[0] - kb[0] || ka[1] - kb[1]
    })
  }

  // ---- Page figures ---------------------------------------------------------------------

  function kpis() {
    const acts = allActs()
    const late = acts.filter((a) => a.due && daysTo(a.due) < 0).length
    const soon = acts.filter((a) => a.due && daysTo(a.due) >= 0 && daysTo(a.due) <= 3).length
    const dl = deals.filter((d) => ["new", "supply"].includes(poSt(d) as string))
    const withInv = deals.filter((d) => d.invs.length > 0 && !(d.closed && d.closed.k === "declined"))
    return {
      acts: acts.length,
      late,
      soon,
      unsent: r2(dl.reduce((s, d) => s + L.unsentValue(d), 0)),
      poCount: dl.length,
      lateV: r2(dl.filter(L.isLate).reduce((s, d) => s + L.unsentValue(d), 0)),
      owed: r2(withInv.reduce((s, d) => s + L.owed(d), 0)),
      invCount: withInv.filter((d) => L.owed(d) > 0.01).length,
      sent: r2(withInv.reduce((s, d) => s + L.paidSent(d), 0)),
    }
  }

  function dashK() {
    const op = opps({})
    const inv = deals.filter((d) => ["due", "sent"].includes(L.invSt(d) as string))
    const waitOffers = deals.filter((d) => offerSeg(d) === "wait")
    const supplyDeals = deals.filter((d) => ["new", "supply"].includes(poSt(d) as string))
    return {
      opps: op.length,
      oppsInvite: op.filter((d) => d.channel === "invite").length,
      oppsSoon: op.filter((d) => daysTo(d.deadline) <= 3).length,
      oppsNew: op.filter(isNewReq).length,
      wait: waitOffers.length,
      waitValue: r2(waitOffers.reduce((s, d) => s + L.offerTotal(d), 0)),
      reply: deals.filter((d) => offerSeg(d) === "reply").length,
      supply: supplyDeals.length,
      supplyV: r2(supplyDeals.reduce((s, d) => s + L.unsentValue(d), 0)),
      accUnsent: r2(deals.filter((d) => poSt(d) === "supply").reduce((s, d) => s + L.unsentValue(d), 0)),
      late: deals.filter(L.isLate).length,
      owed: r2(
        deals
          .filter((d) => d.invs.length > 0 && !(d.closed && d.closed.k === "declined"))
          .reduce((s, d) => s + L.owed(d), 0)
      ),
      invN: inv.length,
      sent: r2(inv.reduce((s, d) => s + L.paidSent(d), 0)),
    }
  }

  /** Every invoice and every "to invoice" of the supplier's orders — the one list Invoices & transfers, Today and the sidebar read. */
  function invoiceRows(): InvoiceRow[] {
    const rows: InvoiceRow[] = []
    for (const d of deals) {
      if (!d.po || !d.po.acc || (d.closed && d.closed.k === "declined")) continue
      if (L.canInvoice(d)) rows.push({ key: `${d.id}:toinv`, deal: d, kind: "toinv", n: null, st: "toinv", gross: L.uninvoicedGross(d), left: L.uninvoicedGross(d), late: false, issue: false })
      const nd = L.nextDue(d)
      for (const a of L.invAlloc(d)) {
        const overdue = !!nd && nd.inv === a.n && L.daysTo(nd.due) < 0
        rows.push({ key: `${d.id}:inv${a.n}`, deal: d, kind: "inv", n: a.n, st: a.st, gross: a.gross, left: a.left, late: a.st === "due" && overdue, issue: a.st === "due" && L.payIssue(d) })
      }
    }
    return rows
  }

  /** The sidebar's counters, two colours, each equal to the number its page shows (NAV-03):
   * red = awaits the supplier, blue = information. Today turns red only when a task is overdue; connection
   * invitations and messages are information (the prototype's sidebar). */
  function badges() {
    const acts = allActs()
    const k = dashK()
    const late = acts.some((a) => a.due && daysTo(a.due) < 0)
    const ordersYou = deals.filter((d) => ["new", "supply"].includes(poSt(d) as string)).length
    const invoicesYou = invoiceRows().filter((r) => r.st === "toinv" || r.st === "sent").length
    const unreadMsgs = deals.reduce((s, d) => s + (d.chat ? d.chat.unread : 0), 0)
    return {
      home: { n: acts.length, tone: late ? ("red" as const) : ("blue" as const) },
      opps: { n: k.oppsNew, tone: "blue" as const },
      offers: { n: k.reply, tone: "red" as const },
      orders: { n: ordersYou, tone: "red" as const },
      invoices: { n: invoicesYou, tone: "red" as const },
      connections: { n: world.invites.length, tone: "blue" as const },
      messages: { n: unreadMsgs, tone: "blue" as const },
    }
  }

  const segCounts = () => (["new", "offered", "deliver", "collect", "done"] as const).map((s) => [s, deals.filter((d) => stage(d) === s).length] as const)

  /** Who holds the move on an order: used by the segments of Orders & delivery. */
  const WHO: Record<string, "you" | "them" | "done"> = { new: "you", supply: "you", wait: "them", done: "done" }
  /** Same for invoices. */
  const INV_WHO: Record<string, "you" | "due" | "paid"> = { toinv: "you", sent: "you", due: "due", paid: "paid" }

  return {
    ...L,
    deals,
    cityOf,
    C,
    matchQ,
    isNewReq,
    isNewResult,
    isOpenReq,
    isArchivedReq,
    opps,
    deadlineGroup,
    myOffers,
    dealActs,
    allActs,
    taskKey,
    kpis,
    dashK,
    badges,
    invoiceRows,
    segCounts,
    WHO,
    INV_WHO,
  }
}

export type WorldLogic = ReturnType<typeof createWorldLogic>

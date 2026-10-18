/**
 * The UAT demo of the free supplier account (scripts/seed-supplier-free-demo.ts → src/lib/supplier-free/demo-seed.ts):
 * the documents it writes, read back the way FreeWorldProvider reads them, must show EVERY state of the free journey —
 * each stage, each Today task, each group of quotes, orders and invoices — hold the PRD invariants G-01…G-12, show
 * numbers as words, and be documents the server acts accept (an invoice on a receipt, accepting an order, rating, …).
 */

import { CATEGORIES_DATA, SAUDI_CITIES } from "@/lib/constants"
import { addDaysTo, OFFER_ORDER, STAGES } from "@/lib/supplier-free/deal-logic"
import { deriveWorld } from "@/lib/supplier-free/derive"
import { buildSupplierFreeDemo, DEMO_CITIES, DEMO_PREFIX, DEMO_SPECS, rawWorldOf, type DemoDoc, type DocStore } from "@/lib/supplier-free/demo-seed"
import { createSupplierInvoice, issuedByBuyer } from "@/lib/supplier-free/invoice-server"
import { actSchema, runBuyerAct, runSupplierAct, type Act } from "@/lib/supplier-free/server-acts"
import { quoteActSchema, runQuoteAct, type QuoteAct } from "@/lib/supplier-free/server-quote-acts"
import { supplierCompanyOf } from "@/lib/supplier-free/supplier-company"
import { createWorldLogic, PAGE_SIZE, TASK_DOMAIN, type TaskKind } from "@/lib/supplier-free/world-logic"
import type { Deal } from "@/lib/supplier-free/types"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) } }))

type Rec = Record<string, unknown>
const TODAY = "2026-10-15"
const NOW = new Date("2026-10-15T09:00:00Z")
const IDS = { supplier: "uSupplier01", contractorA: "uContractorA", receiverA: "uReceiverA", contractorB: "uContractorB" }
const { docs, keys } = buildSupplierFreeDemo(IDS, TODAY, { inviteToken: "test-token" })
const rid = (key: string) => `${DEMO_PREFIX}rfq_${key}`
const pid = (key: string) => `${DEMO_PREFIX}po_${key}`

/** The demo written into the fake Admin Firestore (counters raised, create-only docs created) — as the script writes it. */
function seeded(): FakeAdminDb {
  const db = new FakeAdminDb()
  for (const d of docs as DemoDoc[]) {
    const prev = db.get(d.path)
    if (d.mode === "create" && prev) continue
    if (d.mode === "max") db.seed(d.path, { ...d.data, last: Math.max(Number(prev?.last) || 0, Number(d.data.last) || 0) })
    else db.seed(d.path, d.mode === "merge" ? { ...(prev || {}), ...d.data } : d.data)
  }
  return db
}
const storeOf = (db: FakeAdminDb): DocStore => ({ get: (p) => db.get(p), list: (c) => db.list(c) })
const db0 = seeded()
const raw = rawWorldOf(storeOf(db0), IDS.supplier, TODAY)
const world = deriveWorld(raw)
const W = createWorldLogic(TODAY, world, 0.15)
const deal = (key: string) => world.deals.find((d) => d.id === rid(key)) as Deal
const ids = (l: Deal[]) => l.map((d) => keys[d.id] || d.id).join(" | ")

describe("the demo's documents", () => {
  it("are all the demo's own: an sfdemo_ id or a demo account's key", () => {
    const own = [DEMO_PREFIX, ...Object.values(IDS)]
    expect(docs.filter((d) => !own.some((k) => d.path.includes(k))).map((d) => d.path)).toEqual([])
    expect(new Set(docs.map((d) => d.path)).size).toBe(docs.length)
  })
  it("give the supplier a field from the platform's own lists, so public requests match", () => {
    expect(DEMO_SPECS.every((c) => c in CATEGORIES_DATA)).toBe(true)
    expect(DEMO_CITIES.every((c) => (SAUDI_CITIES as readonly string[]).includes(c))).toBe(true)
    for (const r of db0.list("rfqs")) {
      expect(DEMO_SPECS as readonly string[]).toContain(r.category)
      expect(r.city === "" || (SAUDI_CITIES as readonly string[]).includes(String(r.city))).toBe(true)
    }
  })
  it("leave the supplier free, ~70% complete, and approved (it has the CR and the tax certificate — onboarding)", () => {
    expect(db0.get(`companyPlans/${IDS.supplier}`)?.supplierPlan).toBe("free")
    const u = db0.get(`users/${IDS.supplier}`) as Rec
    expect(u.isVerified).toBe(true)
    expect(u.organizationRole).toBe("owner")
    expect(u.organizationId).toBe(IDS.supplier)
    expect(String(u.phone)).toMatch(/^05\d{8}$/)
    expect(Object.keys(u.legalDocuments as Rec).sort()).toEqual(["addr", "cr", "vat"])
  })
  it("raise every counter past the numbers used", () => {
    for (const [col, field] of [["rfqs", "rfqNumber"], ["purchaseOrders", "docNumber"], ["deliveries", "docNumber"]] as const) {
      for (const d of db0.list(col)) {
        const no = String(d[field])
        const [type, rest] = no.split("-")
        const org = String(d.organizationId || d.contractorOrgId)
        const counter = db0.get(`mfgCounters/${org}__${type}__2026`)
        expect(Number(counter?.last)).toBeGreaterThanOrEqual(Number(rest.split("/")[1]))
      }
    }
  })
  it("are confirmed only by a member of the buying company (B-01)", () => {
    const receipts = db0.list("deliveries").filter((d) => d.status === "confirmed")
    expect(receipts.length).toBeGreaterThan(5)
    for (const r of receipts) {
      const po = db0.get(`purchaseOrders/${r.poId}`) as Rec
      const confirmer = db0.get(`users/${r.confirmedByUserId}`) as Rec
      expect(issuedByBuyer(String(confirmer.organizationId), String(po.organizationId))).toBe(true)
    }
  })
  it("keep every order's lines equal to its receipts", () => {
    for (const p of db0.list("purchaseOrders")) {
      const rs = db0.list("deliveries").filter((d) => d.poId === p.id)
      for (const l of p.lines as Rec[]) {
        const acc = rs.flatMap((r) => r.lines as Rec[]).filter((x) => x.poLineId === l.id).reduce((s, x) => s + Number(x.accepted), 0)
        expect(l.accepted).toBe(acc)
      }
    }
  })
})

describe("the supplier's world", () => {
  it("derives every deal without throwing, and every figure computes", () => {
    for (const d of world.deals) {
      expect(() => {
        W.stage(d)
        W.offerSt(d)
        W.poSt(d)
        W.invSt(d)
        W.dealActs(d)
        W.offerTotal(d)
        W.nextDue(d)
        W.invAlloc(d)
        W.deliveredPct(d)
        W.isLate(d)
        W.payLateness(d)
        W.uninvoicedGross(d)
      }).not.toThrow()
    }
  })
  it("has every stage", () => {
    const counts = Object.fromEntries(W.segCounts())
    for (const s of STAGES) expect(counts[s]).toBeGreaterThan(0)
  })
  it("has more open requests than a page, some new, two invitations and one archived", () => {
    expect(W.opps({}).length).toBeGreaterThan(PAGE_SIZE)
    expect(W.opps({ tab: "new" }).length).toBeGreaterThanOrEqual(6)
    expect(W.opps({ tab: "invite" }).map((d) => d.id).sort()).toEqual([rid("invite_1"), rid("invite_2")])
    expect(W.opps({ tab: "arch" }).map((d) => d.id)).toEqual([rid("archived")])
    expect(deal("invite_declined").closed?.k).toBe("noquote")
    expect(new Set(W.opps({}).map((d) => d.c)).size).toBe(2)
    expect(new Set(W.opps({}).map(W.deadlineGroup))).toEqual(new Set(["soon", "week", "later"]))
  })
  it("has every Today task kind, in each domain, one overdue", () => {
    const acts = W.allActs()
    const kinds = new Set(acts.map((a) => a.kind))
    for (const k of Object.keys(TASK_DOMAIN) as TaskKind[]) expect([k, kinds.has(k)]).toEqual([k, true])
    expect(new Set(acts.map((a) => TASK_DOMAIN[a.kind]))).toEqual(new Set(["offers", "supply", "money", "links"]))
    expect(acts.some((a) => a.due && W.daysTo(a.due) < 0)).toBe(true)
    expect(acts.length).toBeGreaterThan(3)
  })
  it("has every group of My quotes and every quote state", () => {
    for (const seg of OFFER_ORDER) expect([seg, W.myOffers({ seg }).length > 0]).toEqual([seg, true])
    const states = new Set(world.deals.map(W.offerSt))
    for (const s of ["review", "reduce", "sample", "sampleSent", "won", "lost", "noaward", "withdrawn", "declinedPo"]) expect([s, states.has(s as never)]).toEqual([s, true])
    // Won, its order not yet approved: still awaiting the decision.
    expect(W.offerSt(deal("q_won_pending"))).toBe("review")
    expect(deal("q_review_v2").offer?.v).toHaveLength(2)
    expect(deal("q_reduce").offer?.reduce).toMatchObject({ target: 24800, by: addDaysTo(TODAY, 2) })
    expect(deal("q_lost").offer?.out?.why).toBe("price")
  })
  it("has every segment and state of Orders & delivery", () => {
    const base = world.deals.filter((d) => d.po && W.poSt(d) !== "declined")
    for (const seg of ["you", "them", "done"]) expect([seg, base.filter((d) => W.WHO[W.poSt(d) as string] === seg).length > 0]).toEqual([seg, true])
    const st = new Set(world.deals.map(W.poSt))
    for (const s of ["new", "supply", "wait", "done", "declined"]) expect([s, st.has(s as never)]).toEqual([s, true])
    const late = deal("o_late")
    expect(W.isLate(late) && W.daysTo((late.po as NonNullable<Deal["po"]>).acc!.date)).toBe(-2)
    expect(W.shipOnTime(deal("o_reported"), W.waiting(deal("o_reported"))[0])).toBe(true)
    const partial = deal("o_partial")
    expect(W.deliveredPct(partial)).toBeGreaterThan(0)
    expect(W.deliveredPct(partial)).toBeLessThan(100)
    const diff = deal("o_difference")
    expect(W.receipts(diff)[0].why).toBeTruthy()
    expect(W.lineSt(diff.po!.lines[0]).left).toBe(40)
    expect(W.isLump(deal("o_ship_soon").po!)).toBe(true)
  })
  it("has every segment of Invoices & transfers: to invoice, to confirm, due (one overdue, one not received), paid", () => {
    const rows = W.invoiceRows()
    for (const s of ["toinv", "sent", "due", "paid"]) expect([s, rows.some((r) => r.st === s)]).toEqual([s, true])
    for (const seg of ["you", "due", "paid"]) expect([seg, rows.some((r) => W.INV_WHO[r.st] === seg)]).toEqual([seg, true])
    expect(rows.find((r) => r.deal.id === rid("m_overdue"))?.late).toBe(true)
    expect(deal("m_overdue").po?.terms).toEqual([{ pct: 50, days: 0 }, { pct: 50, days: 30 }])
    expect(rows.find((r) => r.deal.id === rid("m_transfer_missing"))?.issue).toBe(true)
    expect(W.invSt(deal("m_transfer_sent"))).toBe("sent")
  })
  it("has a rating owed and one given, a warranty waiting and one accepted", () => {
    const paid = world.deals.filter(W.isFullyPaid)
    expect(paid.map((d) => d.id).sort()).toEqual([rid("o_paid_rate"), rid("o_rated")])
    expect(deal("o_paid_rate").rated).toBeUndefined()
    expect(deal("o_rated").rated?.stars).toBe(5)
    expect(deal("m_transfer_sent").war?.st).toBe("wait")
    expect(deal("o_rated").war?.st).toBe("ok")
  })
  it("has one connected contractor, one invitation to connect, and unread conversations", () => {
    expect(world.contractors[IDS.contractorA].conn).toBeTruthy()
    expect(world.contractors[IDS.contractorB].conn).toBeNull()
    expect(world.invites.map((i) => i.c)).toEqual([IDS.contractorB])
    expect(W.badges().messages.n).toBe(3)
    expect(world.deals.filter((d) => d.chat?.last).length).toBe(4)
  })
  it("shows numbers as words, never codes or document ids", () => {
    const leaks = (s: string | undefined) => !!s && (s.includes(DEMO_PREFIX) || Object.values(IDS).some((u) => s.includes(u)) || /^(RFQ|PO|GR)-/.test(s))
    for (const d of world.deals) {
      expect(d.rfq).toMatch(/^\d{4}\/\d{3}$/)
      if (d.po) expect(d.po.no).toMatch(/^\d{4}\/\d{3}$/)
      expect([d.rfq, d.title, d.po?.no, d.city].filter(leaks)).toEqual([])
    }
    const notes = db0.list(`users/${IDS.supplier}/notifications`)
    expect(notes.length).toBeGreaterThanOrEqual(10)
    expect(notes.filter((n) => !n.read).length).toBeGreaterThanOrEqual(5)
    for (const n of notes) {
      expect(n.rfqId || n.poId || n.chatId || n.type === "supplier_invite_received").toBeTruthy()
      expect(String(n.title || "") + String(n.message || "")).not.toMatch(/\b(PO|GR|RFQ)-\d/)
      const params = ((n.i18n as Rec | undefined)?.params || {}) as Rec
      for (const k of ["number", "receipt", "rfq"]) if (params[k]) expect(String(params[k])).toMatch(/^\d{4}\/\d{3}$/)
    }
  })
})

describe("the PRD invariants over the demo (supplier-free-invariants.test.ts, where they apply)", () => {
  it("G-01 every deal is in exactly one stage", () => {
    expect(W.segCounts().reduce((s, x) => s + x[1], 0)).toBe(world.deals.length)
    expect(new Set(world.deals.map((d) => d.id)).size).toBe(world.deals.length)
  })
  it("G-02 ordered = accepted + cancelled + left", () => {
    for (const d of world.deals.filter((x) => x.po)) for (const l of d.po!.lines) {
      const s = W.lineSt(l)
      expect(s.got + s.can + s.left).toBe(s.ord)
    }
  })
  it("G-03 a report is a date and a note; a receipt carries number, who, date, items", () => {
    const reports = world.deals.flatMap((d) => d.ship.filter((s) => s.st !== "ok"))
    expect(reports.length).toBe(1)
    for (const r of reports) expect(Object.keys(r).every((k) => ["st", "at", "date", "note", "reminders"].includes(k))).toBe(true)
    for (const d of world.deals) for (const r of W.receipts(d)) expect(r.grn && r.no && r.by && r.okAt && r.date && Object.keys(r.items).length).toBeTruthy()
  })
  it("G-04 every sidebar badge equals what its page shows", () => {
    const b = W.badges()
    const k = W.dashK()
    expect(k.opps).toBe(W.opps({}).length)
    expect(b.opps.n).toBe(W.opps({ tab: "new" }).length)
    expect(b.offers.n).toBe(W.myOffers({ seg: "reply" }).length)
    expect(b.home.n).toBe(W.allActs().length)
    expect(b.home.tone).toBe("red")
    expect(b.invoices.n).toBe(W.invoiceRows().filter((r) => W.INV_WHO[r.st] === "you").length)
    expect(b.orders.n).toBe(world.deals.filter((d) => W.WHO[W.poSt(d) as string] === "you").length)
    expect(b.connections.n).toBe(world.invites.length)
  })
  it("G-05 late tasks are exactly the late deals with no pending report", () => {
    const late = world.deals.filter(W.isLate)
    expect(late.map((d) => d.id)).toEqual([rid("o_late")])
    expect(W.allActs().filter((x) => x.kind === "aLate").map((x) => x.deal)).toEqual(late.map((d) => d.id))
  })
  it("G-06 each quote is in one group; results after the deadline, a withdrawal before it", () => {
    const offs = world.deals.filter((d) => d.offer)
    expect(W.myOffers({}).length).toBe(offs.length)
    const early = offs.filter((d) => ["won", "lost", "noaward"].includes(W.offerSt(d) as string) && W.daysTo(W.offAt(d), d.deadline) <= 0)
    expect(ids(early)).toBe("")
    const wl = offs.filter((d) => W.offerSt(d) === "withdrawn" && !(d.closed && W.daysTo(d.closed.at, d.deadline) <= 0))
    expect(ids(wl)).toBe("")
    expect(offs.filter((d) => d.closed).every((d) => ["won", "lost"].includes(W.offerSeg(d) as string))).toBe(true)
  })
  it("G-07 an invoice never exceeds what was received, is dated after its receipts and not in the future, with a file", () => {
    const withInv = world.deals.filter((d) => d.invs.length)
    expect(withInv.length).toBe(6)
    for (const d of withInv) {
      expect(W.invoicedNet(d)).toBeLessThanOrEqual(W.gotValue(d) + 0.009)
      for (const i of d.invs) {
        expect(i.file).toBeTruthy()
        const covered = W.receipts(d).filter((r) => (i.grns || []).includes(r.grn))
        expect(covered.length).toBeGreaterThan(0)
        expect(W.daysTo(i.date, covered.map((r) => r.okAt).sort().pop() as string)).toBeGreaterThanOrEqual(0)
        expect(W.daysTo(i.date)).toBeLessThanOrEqual(0)
      }
    }
  })
  it("G-08 every order's terms add up to 100% and instalments follow them", () => {
    for (const d of world.deals.filter((x) => x.po)) expect(d.po!.terms.reduce((s, x) => s + x.pct, 0)).toBe(100)
    for (const d of world.deals.filter((x) => x.invs.length)) for (const i of d.invs) {
      const s = W.sched(d, i)
      expect(s.map((x) => x.due)).toEqual(d.po!.terms.map((t) => addDaysTo(i.date, t.days)))
      expect(s.reduce((t, x) => t + x.amt, 0)).toBeCloseTo(W.invGross(i), 1)
    }
  })
  it("G-09 a missing transfer is never counted as paid", () => {
    for (const d of world.deals) expect(W.paidOk(d) + W.paidSent(d)).toBeCloseTo(d.pays.filter((p) => p.st !== "miss").reduce((s, p) => s + p.amt, 0), 1)
  })
  it("G-11 no task on him while he waits for the contractor", () => {
    const acts = W.allActs()
    const wt = world.deals.filter((d) => W.poSt(d) === "wait" || W.offerSeg(d) === "wait")
    expect(ids(wt.filter((d) => acts.some((x) => x.deal === d.id && !["aInvoice", "aPaySent"].includes(x.kind))))).toBe("")
  })
  it("G-12 tasks keep one order", () => {
    const acts = W.allActs()
    const tiers = acts.map((x) => W.taskKey(x)[0])
    expect(tiers.every((x, i) => !i || x >= tiers[i - 1])).toBe(true)
  })
})

describe("the server acts accept the demo's documents", () => {
  const supplier = async (db: FakeAdminDb) => supplierCompanyOf(db as never, IDS.supplier, db.get(`users/${IDS.supplier}`) as Rec)
  const act = async (a: Record<string, unknown>) => {
    const db = seeded()
    await runSupplierAct(db as never, await supplier(db), actSchema.parse(a) as Act, NOW)
    return db
  }
  const refusal = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code || String(e))

  it("reads the supplier's company as VAT-registered, in his field", async () => {
    const s = await supplier(seeded())
    expect(s).toMatchObject({ orgId: IDS.supplier, hasVat: true, vatRate: 0.15, company: "مؤسسة الركائز لمواد البناء" })
    expect(s.field.specs).toEqual([...DEMO_SPECS])
  })
  it("an invoice on the fully received order's receipt", async () => {
    const db = seeded()
    const po = db.get(`purchaseOrders/${pid("o_to_invoice")}`) as unknown as PurchaseOrder
    const gr = db.list("deliveries").find((d) => d.poId === pid("o_to_invoice")) as Rec
    const net = po.lines.reduce((s, l) => s + l.accepted * (l.unitPrice as number), 0)
    const s = await supplier(db)
    const r = await createSupplierInvoice(db as never, { ...s, vatRate: s.vatRate }, { poId: pid("o_to_invoice"), grns: [String(gr.docNumber)], number: "INV-3001", date: TODAY, amountNet: net, fileName: "f.pdf", fileUrl: "https://example.com/f.pdf" }, NOW)
    expect(r.id).toBeTruthy()
    // The partly received order's first receipt is already billed.
    const billed = db.list("deliveries").find((d) => d.poId === pid("o_partial")) as Rec
    expect(await refusal(createSupplierInvoice(db as never, s, { poId: pid("o_partial"), grns: [String(billed.docNumber)], number: "INV-3002", date: TODAY, amountNet: 10, fileName: "f.pdf", fileUrl: "https://example.com/f.pdf" }, NOW))).toBe("INVOICE_BLOCKED")
  })
  it("accepting the sent order, reporting a delivery, confirming a transfer", async () => {
    const db = await act({ action: "po.accept", poId: pid("o_to_accept"), promisedDate: addDaysTo(TODAY, 5) })
    expect(db.get(`purchaseOrders/${pid("o_to_accept")}`)?.status).toBe("accepted")
    expect(await refusal(act({ action: "po.report", poId: pid("o_supply_later"), date: TODAY }))).toBe("ok")
    expect(await refusal(act({ action: "po.report", poId: pid("o_reported"), date: TODAY }))).toBe("already_reported")
    const t = seeded().list("supplierTransfers").find((x) => x.poId === pid("m_transfer_sent")) as Rec
    expect(await refusal(act({ action: "transfer.answer", transferId: t.id, answer: "ok" }))).toBe("ok")
    const miss = seeded().list("supplierTransfers").find((x) => x.state === "miss") as Rec
    expect(await refusal(act({ action: "transfer.answer", transferId: miss.id, answer: "later" }))).toBe("ok")
  })
  it("rating only the fully paid order, once", async () => {
    expect(await refusal(act({ action: "po.rate", poId: pid("o_paid_rate"), stars: 4 }))).toBe("ok")
    expect(await refusal(act({ action: "po.rate", poId: pid("o_rated"), stars: 4 }))).toBe("already_rated")
    expect(await refusal(act({ action: "po.rate", poId: pid("m_overdue"), stars: 4 }))).toBe("not_paid")
  })
  it("the contractor accepting the waiting warranty", async () => {
    const db = seeded()
    await runBuyerAct(db as never, IDS.contractorB, actSchema.parse({ action: "warranty.accept", warrantyId: pid("m_transfer_sent") }) as Act, NOW)
    expect(db.get(`supplierWarranties/${pid("m_transfer_sent")}`)?.state).toBe("ok")
  })
  it("a new quote on an open public request, and declining an invitation", async () => {
    const quote = async (a: Record<string, unknown>) => {
      const db = seeded()
      return runQuoteAct(db as never, await supplier(db), quoteActSchema.parse(a) as QuoteAct, NOW)
    }
    const valid = addDaysTo(TODAY, 30)
    expect(await refusal(quote({ action: "quote.new", rfqId: rid("open_01"), values: { prices: { i1: "3.1" }, valid, arrive: addDaysTo(TODAY, 5) } }))).toBe("ok")
    expect(await refusal(quote({ action: "quote.new", rfqId: rid("q_review_open"), values: { prices: { i1: "3", i2: "3.5" }, valid } }))).toBe("already_quoted")
    expect(await refusal(quote({ action: "quote.decline", rfqId: rid("invite_2"), note: "خارج نطاقنا" }))).toBe("ok")
  })
})

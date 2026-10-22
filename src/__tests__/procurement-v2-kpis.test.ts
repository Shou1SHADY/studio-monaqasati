/**
 * Procurement 2.0 — the three numbers (NAV-03, PRD §9, G-18, R-25, R-26, R-28). The same three tiles for every role; each ONE definition:
 *  1. «احتياج بلا أمر شراء» — LINES, with the requests past their last day as its note;
 *  2. «ملتزم لم يصل» — Σ (ordered − accepted) × price × 1.15 over the approved incomplete orders (no VAT for an unregistered
 *     supplier, a lump sum × the share not received), INCLUDING VAT;
 *  3. «فرق السعر عن آخر شراء — 30 يوماً» — Σ (price − last of the SAME specification before the order) × qty ÷ Σ last × qty, orders of
 *     the last 30 days, lump sums and piece lines left out, shown as a percent.
 * The expediter (no prices) is shown the same three as counts.
 */

import { buildNeedRows, type DeskFacts } from "@/lib/procurement/need-desk"
import { projectNeed, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { committedInclVat, priceDriftPercent, remainingExVat, remainingInclVat, todayKpis, KPI_IDS } from "@/lib/procurement/kpis"
import { poSeg, type PoStateCtx } from "@/lib/procurement/po-state"
import { poStatus } from "@/lib/procurement/po"
import type { ProcWorld } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"

const NOW = new Date("2026-10-22T08:00:00Z")
const iso = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()
const day = (n: number) => iso(n).slice(0, 10)

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 10, unitPrice: 1000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/001",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "Rebar",
  offerId: "o1",
  projectId: "p1",
  supplierOrgId: "sup1",
  supplierUserId: null,
  supplierName: "Al-Hadid",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 10000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 10000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer",
  preparedByName: "Sara",
  createdAt: iso(-40),
  approverKind: "manager",
  approvedAt: iso(-39),
  sentAt: iso(-39),
  supplierAcceptedAt: iso(-38),
  promisedDate: day(8),
  log: [],
  ...over,
})

const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })
const MANAGER: ProcActor = { uid: "mgr", name: "Manager", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const OWNER: ProcActor = { uid: "owner", name: "Owner", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const BUYER: ProcActor = { ...MANAGER, uid: "buyer", canApprove: false }
const EXPEDITER: ProcActor = { uid: "exp", name: "Exp", isOwner: false, canApprove: false, canPrepare: false, canExpedite: true, canReceive: false, seesPrices: false }
const ctx: PoStateCtx = { notices: [], financeOn: true, acceptanceDays: 1, now: NOW }

describe("NAV-03 · the same three tiles for every role", () => {
  it("needs · committed · drift, in that order, for the owner, the manager, the buyer and the expediter", () => {
    expect(KPI_IDS).toEqual(["needs", "committed", "drift"])
    for (const a of [OWNER, MANAGER, BUYER, EXPEDITER]) expect(todayKpis(world(), a, NOW).tiles.map((t) => t.id)).toEqual(["needs", "committed", "drift"])
  })

  it("none of the per-role variants survives (my approval · Finance's dues · late lines · with suppliers · sent not accepted)", () => {
    const ids = new Set<string>()
    for (const a of [OWNER, MANAGER, BUYER, EXPEDITER]) for (const t of todayKpis(world({ ownerHasTeam: true }), a, NOW).tiles) ids.add(t.id)
    expect([...ids].sort()).toEqual(["committed", "drift", "needs"])
  })
})

describe("«ملتزم لم يصل» · committed, INCLUDING VAT (R-26)", () => {
  const priced = po({ id: "a", lines: [line({ quantity: 100, unitPrice: 2800, accepted: 40 })] }) // 60 × 2,800 = 168,000
  // A lump sum: the order's one figure, its lines only counted. Half of them arrived: half of 100,000 is still owed.
  const lump = po({ id: "b", totalExVat: 100000, lines: [line({ id: "x", unitPrice: null, quantity: 10, accepted: 10 }), line({ id: "y", unitPrice: null, quantity: 10, accepted: 0 })] })
  const noVat = po({ id: "c", noVat: true, vatRate: 0, lines: [line({ quantity: 10, unitPrice: 1000 })] }) // an unregistered supplier: 10,000, no VAT
  const received = po({ id: "d", lines: [line({ quantity: 5, accepted: 5 })] })
  const waiting = po({ id: "e", status: "awaiting_approval", approvedAt: undefined, sentAt: undefined })
  const gone = po({ id: "f", status: "cancelled" })
  const orders = [priced, lump, noVat, received, waiting, gone]

  it("Σ remaining × 1.15 — a lump sum × the share not received, no VAT for an unregistered supplier", () => {
    expect(remainingExVat(priced)).toBe(168000)
    expect(remainingInclVat(priced)).toBe(193200)
    expect(remainingExVat(lump)).toBe(50000)
    expect(remainingInclVat(lump)).toBe(57500)
    expect(remainingInclVat(noVat)).toBe(10000)
    const c = committedInclVat(orders, ctx)
    expect(c.total).toBe(193200 + 57500 + 10000)
    expect(c.orders).toBe(3)
  })

  it("R-26: it equals Σ ex-VAT remaining × 1.15 over the VAT-registered ones, to the riyal", () => {
    const live = orders.filter((o) => ["approved", "sent", "in_delivery", "part_received"].includes(poStatus(o)))
    const vat = live.filter((o) => !o.noVat)
    const exVat = vat.reduce((s, o) => s + remainingExVat(o), 0)
    const k = todayKpis(world({ orders }), MANAGER, NOW).tiles[1]
    expect(Math.abs(k.value - (exVat * 1.15 + 10000))).toBeLessThan(1)
    expect(k).toMatchObject({ unit: "money", basis: "incl", href: "/contractor/rfqs/orders?filter=all" })
  })

  it("R-25: the note's late count is the orders list's «متأخرة» — one definition of late", () => {
    const late = po({ id: "z", promisedDate: day(-3), lines: [line({ quantity: 10, unitPrice: 100 })] })
    const all = [...orders, late]
    const k = todayKpis(world({ orders: all }), MANAGER, NOW).tiles[1]
    expect(k).toMatchObject({ noteKey: "kpi.committed.note_late", noteParams: { count: 1 }, tone: "bad" })
    expect(committedInclVat(all, ctx).late).toBe(all.filter((o) => poSeg(o, ctx) === "late").length)
    expect(todayKpis(world({ orders }), MANAGER, NOW).tiles[1]).toMatchObject({ noteKey: "kpi.committed.note_none", tone: "good" })
  })
})

describe("«فرق السعر عن آخر شراء — 30 يوماً» · the percent (R-28)", () => {
  // 12 mm and 16 mm bars are one tree node and two specifications: a price for one is no evidence for the other.
  const S12 = "spec:rebar|12mm||t"
  const S16 = "spec:rebar|16mm||t"
  const earlier = po({ id: "o1", sentAt: iso(-60), lines: [line({ id: "a", name: "Rebar 12 mm", specKey: S12, quantity: 10, unitPrice: 2850 }), line({ id: "b", name: "Rebar 16 mm", specKey: S16, quantity: 10, unitPrice: 2780 })] })
  const recent = po({ id: "o2", sentAt: iso(-5), lines: [line({ id: "a", name: "Rebar 12 mm", specKey: S12, quantity: 10, unitPrice: 2800 }), line({ id: "b", name: "Rebar 16 mm", specKey: S16, quantity: 10, unitPrice: 2780 })] })

  it("(2,800 − 2,850) × 10 + 0 over (2,850 + 2,780) × 10 = −0.9 %, each specification against its own last price", () => {
    const d = priceDriftPercent([earlier, recent], NOW)
    expect(d).toMatchObject({ lines: 2, up: 0, base: 56300, diff: -500, percent: -0.9 })
    const dearer = { ...recent, lines: [recent.lines[0], { ...recent.lines[1], unitPrice: 3000 }] }
    expect(priceDriftPercent([earlier, dearer], NOW)).toMatchObject({ up: 1, diff: -500 + 2200, percent: 3 })
  })

  it("a lump-sum order, a piece line and a cancelled or unsent order are on neither side; an order older than 30 days is no numerator", () => {
    const lump = po({ id: "l", sentAt: iso(-3), totalExVat: 99999, lines: [line({ id: "a", specKey: S12, unitPrice: null })] })
    const piece = po({ id: "p", sentAt: iso(-3), lines: [line({ id: "a", specKey: S12, unitPrice: 9999, pk: 6 })] })
    const cancelled = po({ id: "c", status: "cancelled", sentAt: iso(-3), lines: [line({ id: "a", specKey: S12, unitPrice: 9999 })] })
    const unsent = po({ id: "u", status: "approved", sentAt: null, lines: [line({ id: "a", specKey: S12, unitPrice: 9999 })] })
    expect(priceDriftPercent([earlier, recent, lump, piece, cancelled, unsent], NOW)).toMatchObject({ lines: 2, percent: -0.9 })
    // The recent order is itself 40 days old here: nothing to report, though it differs from the older one.
    const old = { ...recent, sentAt: iso(-40) }
    expect(priceDriftPercent([earlier, old], NOW)).toMatchObject({ lines: 0, percent: 0 })
  })

  it("a line outside the material list compares by name and unit; one with a specification never compares with another's", () => {
    const named = (id: string, at: number, price: number) => po({ id, sentAt: iso(at), lines: [line({ id: "a", name: "Nails", unit: "kg", quantity: 10, unitPrice: price })] })
    expect(priceDriftPercent([named("n1", -20, 10), named("n2", -2, 11)], NOW)).toMatchObject({ lines: 1, up: 1, percent: 10 })
    const spec = (id: string, at: number, key: string, price: number) => po({ id, sentAt: iso(at), lines: [line({ id: "a", specKey: key, quantity: 10, unitPrice: price })] })
    expect(priceDriftPercent([spec("s1", -20, S12, 10), spec("s2", -2, S16, 99)], NOW).lines).toBe(0)
  })

  it("the tile: a signed percent, «أعلى من آخر سعر في N بنود» when something rose, tone follows", () => {
    const k = todayKpis(world({ orders: [earlier, recent] }), MANAGER, NOW).tiles[2]
    expect(k).toMatchObject({ unit: "percent", value: -0.9, noteKey: "kpi.drift.note_none", tone: "good", href: "/contractor/rfqs/reports?report=drift&period=30" })
    const up = todayKpis(world({ orders: [earlier, { ...recent, lines: [{ ...recent.lines[0], unitPrice: 3000 }, recent.lines[1]] }] }), MANAGER, NOW).tiles[2]
    expect(up).toMatchObject({ noteKey: "kpi.drift.note_up", noteParams: { count: 1 }, tone: "warn" })
    expect(up.value).toBeGreaterThan(0)
  })
})

describe("«احتياج بلا أمر شراء» · lines", () => {
  const facts = (): DeskFacts => ({ now: NOW, policies: DEFAULT_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} })
  const project = { id: "p1", name: "Villas" }
  const request = (id: string, needBy: string, items: number, over: Partial<ProjectRequestDoc> = {}): ProjectRequestDoc => ({ id, title: id, items: Array.from({ length: items }, (_, i) => ({ name: `M${i}`, quantity: 1, unit: "t" })), status: "approved", needBy, requestedByUserName: "Y", createdAt: iso(-2), ...over })
  const rows = buildNeedRows([projectNeed(project, request("a", "2026-10-30", 3), "PR-A"), projectNeed(project, request("b", "2026-12-30", 2), "PR-B"), projectNeed(project, request("c", "2026-12-30", 4, { poId: "po" }), "PR-C")], facts())

  it("a request of three materials is three lines; the ones already in an order are not; the requests past their last day are the note", () => {
    const k = todayKpis(world({ needDesk: { rows, buyers: [], viewerCategories: null } }), MANAGER, NOW).tiles[0]
    // a: need 30 Oct − 15 days = 15 Oct, passed 7 days ago → overdue.
    expect(k).toMatchObject({ id: "needs", value: 5, unit: "lines", noteKey: "kpi.needs.note_overdue", noteParams: { count: 1 }, tone: "bad", href: "/contractor/rfqs/requests?seg=new" })
    const calm = todayKpis(world({ needDesk: { rows: rows.filter((r) => r.needKey.includes(":b")), buyers: [], viewerCategories: null } }), MANAGER, NOW).tiles[0]
    expect(calm).toMatchObject({ value: 2, noteKey: "kpi.needs.note_none", tone: "good" })
  })

  it("the same figure for the manager, the owner and the expediter; a buyer sees his own categories", () => {
    const w = world({ needDesk: { rows, buyers: [], viewerCategories: null } })
    for (const a of [MANAGER, OWNER, EXPEDITER]) expect(todayKpis(w, a, NOW).tiles[0].value).toBe(5)
    expect(todayKpis(world({ needDesk: { rows, buyers: [], viewerCategories: ["steel"] } }), BUYER, NOW).tiles[0].value).toBe(5)
  })
})

describe("the viewer who sees no prices (the expediter): the same three, as counts", () => {
  const orders = [po({ id: "a", lines: [line({ quantity: 10, accepted: 4 })] }), po({ id: "b", promisedDate: day(-3) }), po({ id: "c", status: "sent" })]
  it("tile 2 = how many orders have not arrived; tile 3 = how many lines rose; no amount and no percentage anywhere", () => {
    const earlier = po({ id: "e", sentAt: iso(-60), lines: [line({ id: "a", specKey: "S", unitPrice: 10 })] })
    const rose = po({ id: "r", sentAt: iso(-2), lines: [line({ id: "a", specKey: "S", unitPrice: 12 })] })
    const t = todayKpis(world({ orders: [...orders, earlier, rose] }), EXPEDITER, NOW).tiles
    expect(t.map((x) => [x.id, x.unit, x.basis])).toEqual([["needs", "lines", null], ["committed", "count", null], ["drift", "count", null]])
    expect(t[1]).toMatchObject({ value: 5, noteKey: "kpi.committed.note_late", noteParams: { count: 1 } })
    expect(t[2]).toMatchObject({ value: 1, tone: "neutral", noteKey: "kpi.drift.note_up" })
    // The seeing viewer, over the same orders, is handed money and a percent.
    expect(todayKpis(world({ orders: [...orders, earlier, rose] }), MANAGER, NOW).tiles.map((x) => x.unit)).toEqual(["lines", "money", "percent"])
  })
})

/**
 * Procurement 2.0 — Today, the rewrite (TDY-01…05, NAV-03's queue half, G-03, G-18, R-24): RED first then the nearest date; requests whose
 * last day is over a week away fold into ONE line; the four RFQ rows (closed with live offers · no live offer · can award now ·
 * an unanswered inquiry); the waits tagged with who holds them, with their dates; the escalation of an uncounted delivery; the route
 * strip; the supplier invitations. Ports qa_review R-24, qa_flows WF-26, qa_guards G-03 / G-18.
 */

import { cardSegment, requestCards } from "@/lib/procurement/incoming-requests"
import { askStock, type CheckContext } from "@/lib/procurement/stock-check"
import { newTeamRequest } from "@/lib/procurement/incoming-ingest"
import { DEFAULT_RESOLVED_POLICIES } from "@/lib/procurement/policies"
import { buildNeedRows, type DeskFacts } from "@/lib/procurement/need-desk"
import { projectNeed, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { evaluatePlanOffers, type PlanOffer } from "@/lib/procurement/award-plan"
import { fromHalalas } from "@/lib/procurement/offer-calc"
import { FAR_REQUEST_DAYS, chipCounts, foldFarRequests, todayFlow, todayInvitations, todayTasks, todayWaits, type InvitationFact, type OfferFact, type ProcWorld, type RfqFact, type Task } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"
import { sarLtr } from "@/lib/riyal"

const NOW = new Date("2026-09-22T08:00:00Z")
const T0 = NOW
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10)
const iso = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  organizationId: "org",
  docNumber: "PO-2026/014",
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
  totalExVat: 280000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 280000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: "buyer",
  preparedByName: "Sara",
  createdAt: iso(-12),
  approverKind: "manager",
  approvedAt: iso(-11),
  sentAt: iso(-11),
  supplierAcceptedAt: iso(-10),
  promisedDate: day(8),
  log: [],
  ...over,
})
const notice = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({ id: "n1", status: "pending_confirmation", poId: "po1", poNumber: "PO-2026/014", supplierName: "Al-Hadid", deliveryDate: day(2), ...over })
const rfq = (over: Partial<RfqFact> = {}): RfqFact => ({ id: "r1", status: "New", deadline: day(-1), title: "Rebar for Tower A", number: "RFQ-2026/011", offersCount: 3, products: [{ name: "Rebar 12 mm", quantity: 100, unit: "t" }], ...over })
const offer = (id: string, price: string, over: Partial<OfferFact> = {}): OfferFact => ({ id, rfqId: "r1", status: "قيد المراجعة", price, ...over })
const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })

const MANAGER: ProcActor = { uid: "mgr", name: "Manager", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const BUYER: ProcActor = { uid: "buyer", name: "Sara", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const OWNER: ProcActor = { uid: "owner", name: "Owner", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }
const EXPEDITER: ProcActor = { uid: "exp", name: "Exp", isOwner: false, canApprove: false, canPrepare: false, canExpedite: true, canReceive: false, seesPrices: false }

const kinds = (w: ProcWorld, a: ProcActor = MANAGER) => todayTasks(w, a, NOW).map((t) => t.kind)

// ---------------------------------------------------------------------------
// Requests: the desk's rows → one row per request, the far ones folded
// ---------------------------------------------------------------------------

const deskFacts = (over: Partial<DeskFacts> = {}): DeskFacts => ({ now: NOW, policies: DEFAULT_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {}, ...over })
const project = { id: "p1", name: "Villas" }
const request = (id: string, needBy: string, items = 2): ProjectRequestDoc => ({
  id,
  title: id,
  items: Array.from({ length: items }, (_, i) => ({ name: `Item ${i + 1}`, quantity: 5, unit: "t" })),
  status: "approved",
  needBy,
  requestedByUserName: "Yasser",
  createdAt: iso(-2),
})
const deskOf = (...docs: ProjectRequestDoc[]) => ({ rows: buildNeedRows(docs.map((d) => projectNeed(project, d, `PR-${d.id.toUpperCase()}`)), deskFacts()), buyers: [], viewerCategories: null })

describe("foldFarRequests — more than a week away is one line (TDY-02)", () => {
  it("the boundary is the 7th day; a request with no date folds too; the nearest of the folded is named", () => {
    const items = [{ lastIn: -3 }, { lastIn: 0 }, { lastIn: FAR_REQUEST_DAYS }, { lastIn: FAR_REQUEST_DAYS + 1 }, { lastIn: 30 }, { lastIn: null }]
    const { near, far, nearest } = foldFarRequests(items)
    expect(near.map((i) => i.lastIn)).toEqual([-3, 0, 7])
    expect(far.map((i) => i.lastIn)).toEqual([8, 30, null])
    expect(nearest).toBe(8)
    expect(foldFarRequests([{ lastIn: null }]).nearest).toBeNull()
  })
})

describe("TDY-02 / R-24 — requests as rows, red first, far ones folded", () => {
  // lead 10 + RFQ cycle 3 + award 2 = 15 days before the need: 07 Oct → today, 12 Oct → +5, 30 Nov and 15 Dec → far.
  const desk = deskOf(request("a", "2026-10-07"), request("b", "2026-10-12", 1), request("c", "2026-11-30"), request("d", "2026-12-15"))
  const w = world({ needDesk: desk, orders: [po({ id: "late", promisedDate: day(-4) })] })

  it("each near request is one row «ط.م · المكان» with its material count, its last day, «انشره» and «جهّزه»", () => {
    const t = todayTasks(w, BUYER, NOW).filter((x) => x.chip === "req")
    expect(t.map((x) => [x.kind, x.severity, x.due])).toEqual([
      ["need_request", "red", 0],
      ["need_request", "amber", 5],
      ["need_far", "blue", 54],
    ])
    expect(t[0]).toMatchObject({
      id: expect.stringContaining("project:p1:a"),
      titleParams: { ref: "PR-A", place: "Villas", remainder: 0 },
      subKey: "task.need_request.sub",
      subParams: { count: 2, date: "2026-09-22", when: "today", n: 0 },
      actionKey: "actions.publishRequest",
      href: "/contractor/rfqs/requests?publish=project%3Ap1%3Aa",
      secondary: { actionKey: "actions.prepare", href: "/contractor/rfqs/new?requests=project%3Ap1%3Aa" },
    })
    expect(t[1].subParams).toMatchObject({ count: 1, when: "future", n: 5 })
  })

  it("the far ones are ONE line: how many, the nearest of them, and «افتح الواردة»", () => {
    const far = todayTasks(w, BUYER, NOW).find((x) => x.kind === "need_far")
    expect(far).toMatchObject({ chip: "req", titleParams: { count: 2 }, subParams: { date: "2026-11-15", when: "future", n: 54 }, actionKey: "actions.openIncoming", href: "/contractor/rfqs/requests?seg=new" })
  })

  it("R-24: no red after the first non-red; the far line exists; every near request is within a week", () => {
    const t = todayTasks(w, BUYER, NOW)
    const firstNonRed = t.findIndex((x) => x.tier !== "red")
    expect(firstNonRed).toBeGreaterThan(0)
    expect(t.slice(firstNonRed).some((x) => x.tier === "red")).toBe(false)
    expect(t.some((x) => x.kind === "need_far")).toBe(true)
    expect(t.filter((x) => x.kind === "need_request").every((x) => x.due <= FAR_REQUEST_DAYS)).toBe(true)
    // Red by date: the late order (-4) before the request due today (0).
    expect(t.slice(0, 2).map((x) => x.kind)).toEqual(["late", "need_request"])
  })

  it("a request in a draft RFQ («مُجهَّزة») is not a row — it is the draft's", () => {
    const cards = requestCards(desk.rows, [{ id: "dr", status: "Draft", needSources: [desk.rows[0].need.source] }])
    expect(cards.filter((c) => cardSegment(c) === "new")).toHaveLength(3)
    const t = todayTasks({ ...w, rfqs: [rfq({ id: "dr", status: "Draft", deadline: null, createdByUserId: "buyer", needSources: [desk.rows[0].need.source] } as RfqFact)] }, BUYER, NOW)
    expect(t.filter((x) => x.kind === "need_request")).toHaveLength(1)
    expect(t.find((x) => x.kind === "rfq_draft")).toBeDefined()
  })

  it("the expediter has no requests (he does not source)", () => {
    expect(todayTasks(w, EXPEDITER, NOW).filter((x) => x.chip === "req")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// TDY-03 · the RFQ rows
// ---------------------------------------------------------------------------

describe("TDY-03 · RFQ rows", () => {
  it("closed with live offers: «قارن ورسِّ», red when the award window ends tomorrow, with the lowest complete offer incl. VAT", () => {
    const w = world({ rfqs: [rfq({ deadline: day(-1) })], offers: [offer("a", "10,000"), offer("b", "11,000"), offer("c", "9,000")], decisions: { c: { shortlist: null, exclusion: { code: "spec", text: null, at: iso(-1), byId: "x", byName: "X" } } } })
    const t = todayTasks(w, MANAGER, NOW).filter((x) => x.chip === "rfq")
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({
      kind: "rfq_award",
      tier: "red",
      due: 1,
      titleParams: { ref: "RFQ-2026/011", count: 2 },
      subParams: { title: "Rebar for Tower A", date: day(1), when: "future", n: 1 },
      amount: 11500,
      basis: "incl",
      actionKey: "actions.compareAward",
      href: "/contractor/rfqs/r1/offers",
    })
  })

  it("a longer award window (policy) leaves it amber until the day before it ends", () => {
    const w = world({ policies: { ...DEFAULT_POLICIES, awardCycleDays: 5 }, rfqs: [rfq({ deadline: day(-1) })], offers: [offer("a", "10,000"), offer("b", "11,000")] })
    expect(todayTasks(w, MANAGER, NOW)[0]).toMatchObject({ kind: "rfq_award", severity: "amber", tier: "normal", due: 4 })
  })

  it("no live offer is RED, due now, with its two exits on the RFQ page — both for «all excluded» and «closed with none» (WF-26)", () => {
    const excluded = { code: "spec" as const, text: null, at: iso(-1), byId: "x", byName: "X" }
    const allOut = world({ rfqs: [rfq()], offers: [offer("a", "10,000"), offer("b", "11,000")], decisions: { a: { shortlist: null, exclusion: excluded }, b: { shortlist: null, exclusion: excluded } } })
    const empty = world({ rfqs: [rfq({ offersCount: 0 })] })
    for (const w of [allOut, empty]) {
      const t = todayTasks(w, MANAGER, NOW).filter((x) => x.chip === "rfq")
      expect(t).toMatchObject([{ kind: "rfq_no_live", tier: "red", due: 0, titleParams: { ref: "RFQ-2026/011" }, subKey: "task.rfq_no_live.sub", actionKey: "actions.openRfq", href: "/contractor/rfqs/r1/offers" }])
    }
    // Still open and empty: nothing to decide yet.
    expect(kinds(world({ rfqs: [rfq({ deadline: day(3), offersCount: 0 })] }))).toEqual([])
  })

  it("open, with every item at the competition limit: «تستطيع الترسية الآن» — blue, with the same lowest complete figure the comparison shows (G-03)", () => {
    const offers = [offer("a", "10,000"), offer("b", "11,000"), offer("c", "12,000")]
    const open = rfq({ deadline: day(3) })
    const w = world({ rfqs: [open], offers })
    const t = todayTasks(w, MANAGER, NOW).filter((x) => x.chip === "rfq")
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ kind: "rfq_can_award", severity: "blue", tier: "normal", due: 3, titleParams: { ref: "RFQ-2026/011", count: 3 }, actionKey: "actions.compare" })
    const ev = evaluatePlanOffers(open as never, offers as PlanOffer[], {}, { today: "2026-09-22", policies: DEFAULT_POLICIES })
    const lowest = fromHalalas(ev.lowestComplete?.grossH ?? 0)
    expect(lowest).toBe(11500)
    expect(t[0].subParams).toMatchObject({ hasLowest: 1, lowest, vat: 1 })
    // Below the limit: no row. A viewer without prices is told «can award» but handed no figure.
    expect(kinds(world({ rfqs: [open], offers: offers.slice(0, 2) }))).toEqual([])
    expect(todayTasks(w, { ...MANAGER, seesPrices: false }, NOW).find((x) => x.kind === "rfq_can_award")?.subParams).toMatchObject({ hasLowest: 0 })
  })

  it("an offer that quotes no price for an item does not count for that item (the competition is per item, G-18)", () => {
    const two = rfq({ deadline: day(3), products: [{ name: "Rebar", quantity: 10, unit: "t" }, { name: "Mesh", quantity: 5, unit: "pc" }] })
    const priced = (id: string, rebar: number, mesh: number | null): OfferFact =>
      offer(id, String(rebar * 10 + (mesh ?? 0) * 5), { lines: [{ rfqProductIndex: 0, unitPrice: rebar }, ...(mesh == null ? [] : [{ rfqProductIndex: 1, unitPrice: mesh }])], skippedItems: mesh == null ? [1] : null })
    expect(kinds(world({ rfqs: [two], offers: [priced("a", 10, 4), priced("b", 11, 5), priced("c", 12, null)] }))).toEqual([])
    expect(kinds(world({ rfqs: [two], offers: [priced("a", 10, 4), priced("b", 11, 5), priced("c", 12, 6)] }))).toEqual(["rfq_can_award"])
  })

  it("an unanswered inquiry on an open or a closed RFQ: «أجب»", () => {
    const queries = [{ id: "q1", rfqId: "r1", question: "Which grade?", answered: false }, { id: "q2", rfqId: "r1", question: "Done", answered: true }]
    const open = todayTasks(world({ rfqs: [rfq({ deadline: day(4) })], rfqQueries: queries }), MANAGER, NOW).filter((x) => x.kind === "rfq_query")
    expect(open).toMatchObject([{ chip: "rfq", severity: "amber", due: 4, titleParams: { ref: "RFQ-2026/011", count: 1 }, subParams: { closed: 0, question: "Which grade?" }, actionKey: "actions.answer", href: "/contractor/rfqs/r1/offers?tab=inquiries" }])
    const closed = todayTasks(world({ rfqs: [rfq({ deadline: day(-3), offersCount: 1 })], offers: [offer("a", "10,000")], rfqQueries: queries }), MANAGER, NOW).filter((x) => x.kind === "rfq_query")
    expect(closed[0].subParams).toMatchObject({ closed: 1 })
  })

  it("the reading owner and the expediter have no RFQ rows; a draft is the buyer's", () => {
    const w = world({ rfqs: [rfq({ deadline: day(-1) }), rfq({ id: "dr", status: "Draft", deadline: null })], offers: [offer("a", "10,000")] })
    expect(todayTasks({ ...w, ownerHasTeam: true }, OWNER, NOW).filter((x) => x.chip === "rfq")).toEqual([])
    expect(todayTasks(w, EXPEDITER, NOW).filter((x) => x.chip === "rfq")).toEqual([])
    expect(todayTasks(w, MANAGER, NOW).filter((x) => x.chip === "rfq").map((x) => x.kind).sort()).toEqual(["rfq_award", "rfq_draft"])
  })
})

// ---------------------------------------------------------------------------
// TDY-05 · uncounted deliveries
// ---------------------------------------------------------------------------

describe("TDY-05 · a delivery nobody counted", () => {
  const order = po({ id: "po1" })
  const fwd = (over: Partial<ReceiptFact> = {}) => notice({ forwardedTo: { name: "م. سامي الدوسري", at: iso(-30), userId: "u9" } as never, ...over })

  it("past the policy window (2 days) it is a RED row with «صعّد» — on the notice, not on a page", () => {
    const t = todayTasks(world({ orders: [order], receipts: [fwd({ deliveryDate: day(-25) })] }), MANAGER, NOW).filter((x) => x.kind === "count_escalated")
    expect(t).toMatchObject([{ chip: "rcv", tier: "red", severity: "red", due: 0, titleParams: { number: "PO-2026/014", supplier: "Al-Hadid" }, subKey: "task.count_escalated.sub", subParams: { name: "م. سامي الدوسري", days: 25, limit: 2 }, actionKey: "actions.escalate", act: { kind: "escalate", deliveryId: "n1" } }])
  })

  it("inside the window it only waits on the receiver, and a delivery already escalated is no row", () => {
    const within = world({ orders: [order], receipts: [fwd({ deliveryDate: day(-2) })] })
    expect(kinds(within)).toEqual([])
    expect(todayWaits(within, MANAGER, NOW).filter((x) => x.kind === "receiver_count")).toMatchObject([{ module: "receiver", subKey: "wait.receiver_count.sub", subParams: { name: "م. سامي الدوسري", days: 2 } }])
    const done = world({ orders: [order], receipts: [fwd({ deliveryDate: day(-25), escalation: { at: iso(-1), byId: "m", byName: "M", toKind: "owner", toUid: "o" } } as never)] })
    expect(kinds(done)).toEqual([])
    expect(todayWaits(done, MANAGER, NOW).some((x) => x.kind === "receiver_count")).toBe(true)
  })

  it("a stricter or looser window follows the policy; the owner reading and the one who cannot chase see no button", () => {
    const w = world({ orders: [order], receipts: [fwd({ deliveryDate: day(-4) })], policies: { ...DEFAULT_POLICIES, escalateAfterDays: 5 } })
    expect(kinds(w)).toEqual([])
    expect(kinds({ ...w, policies: { ...DEFAULT_POLICIES, escalateAfterDays: 3 } })).toEqual(["count_escalated"])
    expect(kinds({ ...w, ownerHasTeam: true, policies: DEFAULT_POLICIES }, OWNER)).toEqual([])
    expect(kinds({ ...w, policies: DEFAULT_POLICIES }, { ...MANAGER, canExpedite: false })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// TDY-04 · what we wait on others for
// ---------------------------------------------------------------------------

describe("TDY-04 · «ننتظره من غيرنا» — who holds it, and until when", () => {
  const policies = { ...DEFAULT_RESOLVED_POLICIES }
  const ctx: CheckContext = { now: T0, policies }
  const doc = () => {
    const base = newTeamRequest({
      organizationId: "org",
      id: "r1",
      no: "MAT-2026/014",
      seq: 14,
      lines: [{ name: "حديد 16 مم", unit: "طن", quantity: 12 }, { name: "جرانيت أسود", unit: "م²", quantity: 8 }],
      needBy: "2026-11-22",
      place: { label: "برج العليا", city: "الرياض", district: "العليا" },
      requestedBy: { id: "u1", name: "م. فهد" },
      requestedFor: { kind: "member", id: "u1", name: "م. فهد" },
      at: T0.toISOString(),
    })
    const asked = askStock(base, ctx)
    if (typeof asked === "string") throw new Error(asked)
    const lines = asked.lines.map((l, i) => (i === 1 ? { ...l, stk: null, mk: { st: "ask" as const, at: T0.toISOString() } } : l))
    return { ...base, lines }
  }

  it("Inventory and the workshop first, each with the day their window ends", () => {
    const waits = todayWaits(world({ incomingDocs: [doc()] }), BUYER, NOW)
    expect(waits.map((x) => [x.kind, x.module])).toEqual([
      ["stock_reply", "inventory"],
      ["workshop_ask", "manufacturing"],
    ])
    expect(waits[0]).toMatchObject({ titleKey: "wait.request_line.title", titleParams: { place: "برج العليا", ref: "MAT-2026/014", name: "حديد 16 مم" }, subKey: "wait.stock_reply.sub", subParams: { date: "2026-09-23" } })
    expect(waits[1].subParams).toMatchObject({ date: "2026-09-23" })
  })

  it("the stock window never reaches past the request's last day to order; it never starts before today", () => {
    const tight = { ...doc(), needBy: "2026-10-08" }
    // Asked with the last day to order at the 23rd: the stores answer by then.
    const asked = askStock({ ...tight, lines: tight.lines.map((l) => ({ ...l, stk: null })) }, { now: T0, policies })
    if (typeof asked === "string") throw new Error(asked)
    const waits = todayWaits(world({ incomingDocs: [{ ...tight, lines: asked.lines }] }), BUYER, NOW)
    expect(waits.find((x) => x.kind === "stock_reply")?.subParams.date).toBe("2026-09-23")
  })

  it("an expired window is no wait — the line is bought in full; without Manufacturing the workshop is not waited on", () => {
    const later = new Date(NOW.getTime() + 3 * 86_400_000)
    expect(todayWaits(world({ incomingDocs: [doc()] }), BUYER, later)).toEqual([])
    expect(todayWaits(world({ incomingDocs: [doc()], workshopOn: false }), BUYER, NOW).map((x) => x.kind)).toEqual(["stock_reply"])
  })

  it("after them: the supplier, the receiver and Finance — in the order's own words, with the tag", () => {
    const orders = [
      po({ id: "s", docNumber: "PO-2026/004", status: "sent", sentAt: iso(-3) }),
      po({ id: "a", docNumber: "PO-2026/005", advancePercent: 30, approvedAt: iso(-3), supplierAcceptedAt: undefined, status: "accepted" } as Partial<PurchaseOrder>),
      po({ id: "u", docNumber: "PO-2026/006", lines: [line({ accepted: 100 })] }),
      po({ id: "t", docNumber: "PO-2026/007", promisedDate: day(8) }),
    ]
    const receipts = [notice({ id: "nt", poId: "t", forwardedTo: { name: "أحمد", at: iso(-1), userId: "x" } as never, deliveryDate: day(2) })]
    const waits = todayWaits(world({ orders, receipts }), MANAGER, NOW)
    const by = (id: string) => waits.find((x) => x.id === id)
    expect(by("w_po:s")).toMatchObject({ module: "supplier", subKey: "step.nacc" })
    expect(by("w_po:a")).toMatchObject({ module: "finance", subKey: "step.adv" })
    expect(by("w_po:u")).toMatchObject({ module: "finance", subKey: "step.unpaid" })
    // On its way (forwarded, the day ahead) nobody waits: the route strip counts it.
    expect(by("w_po:t")).toBeUndefined()
    // Without Finance the advance and the payment are no waits on «المالية».
    const noFin = todayWaits(world({ orders, receipts, financeOn: false }), MANAGER, NOW)
    expect(noFin.some((x) => x.module === "finance")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The rows only the owner / the preparer holds
// ---------------------------------------------------------------------------

describe("the advance to a supplier with no record is the owner's row", () => {
  const advance = po({ id: "adv", advancePercent: 30, advanceOwner: { required: true }, approvedAt: iso(-1), supplierAcceptedAt: iso(-1) } as Partial<PurchaseOrder>)
  it("the owner gets «اعتمد الدفعة» with the advance incl. VAT; nobody else does", () => {
    const t = todayTasks(world({ orders: [advance] }), OWNER, NOW).filter((x) => x.kind === "advance_owner")
    expect(t).toMatchObject([{ chip: "po", severity: "amber", subKey: "step.adv_owner", amount: 96600, basis: "incl", actionKey: "actions.approveAdvance" }])
    expect(kinds(world({ orders: [advance] }), MANAGER)).not.toContain("advance_owner")
    expect(todayWaits(world({ orders: [advance] }), MANAGER, NOW).find((x) => x.id === "w_po:adv")).toBeUndefined()
  })
})

describe("the supplier asked to change the order", () => {
  it("is the buyer's row until he answers in the conversation", () => {
    const asked = { ...po({ id: "ch" }), changeAsked: { at: iso(-1), seq: 3, text: "Delay by a week" }, chat: { seq: 3, usSeq: 1, supSeq: 3, lastAt: null, lastText: null, lastBy: "sup", lastFile: false, readBy: {}, supReadSeq: 0 } } as PurchaseOrder
    expect(todayTasks(world({ orders: [asked] }), MANAGER, NOW).find((x) => x.kind === "change_ask")).toMatchObject({ chip: "po", severity: "amber", subKey: "task.change_ask.sub", subParams: { text: "Delay by a week" }, actionKey: "actions.reply" })
    const answered = { ...asked, chat: { ...(asked as unknown as { chat: object }).chat, usSeq: 4 } } as PurchaseOrder
    expect(kinds(world({ orders: [answered] }))).not.toContain("change_ask")
  })
})

// ---------------------------------------------------------------------------
// TDY-01 · the route strip
// ---------------------------------------------------------------------------

describe("TDY-01 · the route strip", () => {
  const orders = [
    po({ id: "appr", docNumber: "PO-1", status: "awaiting_approval", lines: [line({ quantity: 10, unitPrice: 1000 })] }), // 10,000 + VAT
    po({ id: "live", docNumber: "PO-2", lines: [line({ quantity: 10, unitPrice: 2000 })] }), // 20,000 + VAT
    po({ id: "nov", docNumber: "PO-3", noVat: true, vatRate: 0, lines: [line({ quantity: 1, unitPrice: 5000 })] }), // 5,000, no VAT
    po({ id: "done", docNumber: "PO-4", status: "closed", closedAt: iso(-2), lines: [line({ accepted: 100 })] }),
    po({ id: "old", docNumber: "PO-5", status: "closed", closedAt: "2026-08-10T08:00:00Z", lines: [line({ accepted: 100 })] }),
    po({ id: "gone", docNumber: "PO-6", status: "cancelled" }),
  ]
  const w = world({
    orders,
    rfqs: [rfq({ id: "x1", deadline: day(3) }), rfq({ id: "x2", deadline: day(-2) }), rfq({ id: "x3", status: "Awarded" }), rfq({ id: "x4", status: "Draft" })],
    receipts: [notice({ id: "n1", poId: "live" }), notice({ id: "n2", poId: "nov", forwardedTo: { name: "X" } as never }), notice({ id: "n3", status: "confirmed" })],
    needDesk: deskOf(request("a", "2026-10-07"), request("c", "2026-11-30", 1)),
  })

  it("five tiles, each opening its page: new incoming · in RFQs · in orders (incl. VAT) · on the way · completed this month", () => {
    const tiles = todayFlow(w, MANAGER, NOW)
    expect(tiles.map((t) => [t.id, t.count])).toEqual([["inc", 2], ["rfq", 2], ["po", 3], ["rcv", 2], ["done", 1]])
    expect(tiles.map((t) => t.href)).toEqual(["/contractor/rfqs/requests?seg=new", "/contractor/rfqs", "/contractor/rfqs/orders?filter=all", "/contractor/goods-received", "/contractor/rfqs/orders?filter=done"])
    expect(tiles[2]).toMatchObject({ subKey: "flow.po.sub_value", amount: 10000 * 1.15 + 20000 * 1.15 + 5000 })
  })

  it("without Finance, or for a viewer who sees no prices, the orders tile says «مفتوحة» and carries no amount", () => {
    expect(todayFlow({ ...w, financeOn: false }, MANAGER, NOW)[2]).toMatchObject({ subKey: "flow.po.sub_open", amount: null })
    expect(todayFlow(w, EXPEDITER, NOW)[2]).toMatchObject({ subKey: "flow.po.sub_open", amount: null })
  })
})

// ---------------------------------------------------------------------------
// WF-23 · the invitations strip
// ---------------------------------------------------------------------------

describe("the supplier invitations on Today", () => {
  const inv = (id: string, over: Partial<InvitationFact> = {}): InvitationFact => ({ id, companyName: `Co ${id}`, status: "pending", createdAt: "2026-10-20T08:00:00Z", sentChannel: "wa", ...over })
  // Invitations count their 30 days from 20 Oct 2026 at the earliest (INVITE_EXPIRY_SINCE): the one sent in September ended on 19 Nov.
  const now = new Date("2026-11-19T12:00:00Z")

  it("newest first, with the derived state — sent · opened · joined (verified or not) · expired — and a cancelled one left out", () => {
    const rows = todayInvitations(
      [
        inv("a", { createdAt: "2026-10-21T08:00:00Z" }),
        inv("b", { createdAt: "2026-10-21T07:00:00Z", openedAt: "2026-10-21T09:00:00Z" }),
        inv("c", { status: "accepted", acceptedSupplierOrgId: "s1", createdAt: "2026-10-10T08:00:00Z" }),
        inv("d", { status: "accepted", acceptedSupplierOrgId: "s2", createdAt: "2026-10-09T08:00:00Z" }),
        inv("e", { createdAt: "2026-09-16T08:00:00Z" }),
        inv("f", { status: "cancelled" }),
      ],
      [{ supplierOrgId: "s1", supplierName: "S1", verified: true }, { supplierOrgId: "s2", supplierName: "S2", verified: false }],
      now
    )
    expect(rows.map((r) => [r.id, r.state, r.verified])).toEqual([
      ["a", "sent", false],
      ["b", "opened", false],
      ["c", "joined", true],
      ["d", "joined", false],
      ["e", "expired", false],
    ])
    expect(rows[0]).toMatchObject({ name: "Co a", sentDay: "2026-10-21", channel: "wa" })
  })
})

// ---------------------------------------------------------------------------
// G-18 · every amount says its basis
// ---------------------------------------------------------------------------

describe("G-18 · an amount on a row carries the basis it is told in", () => {
  it("orders are incl. VAT (or «بلا ضريبة» for a supplier who charges none); no amount without a basis; none for the expediter", () => {
    const w = world({
      orders: [po({ id: "a", status: "awaiting_approval", lines: [line({ quantity: 1, unitPrice: 1000 })] }), po({ id: "b", status: "awaiting_approval", noVat: true, vatRate: 0, lines: [line({ quantity: 1, unitPrice: 1000 })] }), po({ id: "late", promisedDate: day(-2) })],
      rfqs: [rfq()],
      offers: [offer("o", "10,000")],
    })
    const rows = todayTasks(w, OWNER, NOW)
    const withAmount = rows.filter((x) => x.amount != null)
    expect(withAmount.length).toBeGreaterThanOrEqual(3)
    expect(withAmount.every((x) => x.basis === "incl" || x.basis === "none")).toBe(true)
    expect(rows.find((x) => x.id === "approve:a")).toMatchObject({ amount: 1150, basis: "incl" })
    expect(rows.find((x) => x.id === "approve:b")).toMatchObject({ amount: 1000, basis: "none" })
    expect(rows.filter((x) => x.amount == null).every((x) => x.basis === null)).toBe(true)
    expect(todayTasks(w, EXPEDITER, NOW).every((x) => x.amount === null)).toBe(true)
    expect(sarLtr("1")).toMatch(/1/)
  })
})

describe("chips — all five always count, and they add up", () => {
  it("req · rfq · po · rcv, plus «الكل»", () => {
    const w = world({
      orders: [po({ id: "late", promisedDate: day(-4) })],
      receipts: [notice({ id: "n", poId: "other", deliveryDate: day(0) })],
      rfqs: [rfq({ deadline: day(-1) })],
      offers: [offer("a", "10,000")],
      needDesk: deskOf(request("a", "2026-10-07")),
    })
    const t: Task[] = todayTasks(w, MANAGER, NOW)
    const c = chipCounts(t)
    expect(c).toEqual({ all: t.length, req: 1, rfq: 1, po: 1, rcv: 1 })
  })
})

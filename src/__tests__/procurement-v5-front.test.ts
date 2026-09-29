/**
 * The final parity check of Procurement's front (V5-proc-front 02–07, 10):
 * prices sealed until the deadline by default (01, the owner's decision),
 * a buyer's RFQs and Today are his own, an unsealed round with offers asks
 * for the award before its deadline, the draft names its number and says its
 * lines are held, the owner's roll-up opens the needs, the sample wait names
 * the sample, and a buyer's workshop shortfalls follow his categories.
 */

import { projectNeed, type ProjectRequestDoc } from "@/lib/procurement/needs"
import { buildNeedRows, latestSampleNo, materialInScope, type DeskFacts } from "@/lib/procurement/need-desk"
import { isBuyer, poInScope, rfqInScope, rfqStage } from "@/lib/procurement/rfq-view"
import { offersSealed } from "@/lib/procurement/award"
import { resolvePolicies } from "@/lib/procurement/policies"
import { rfqPrintModel, writeRfqPrint } from "@/components/procurement/RfqPrint"
import { todayTasks, todayWaits, type OfferFact, type ProcWorld, type RfqFact } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PoLine, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"

const NOW = new Date("2026-09-22T08:00:00Z")

const line = (over: Partial<PoLine> = {}): PoLine => ({ id: "l1", name: "Rebar 12 mm", unit: "t", quantity: 100, unitPrice: 2800, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/014",
    status: "approved",
    approvedAt: "2026-09-20T08:00:00Z",
    basis: "rfq",
    rfqId: "r1",
    offerId: "o1",
    projectId: "p1",
    supplierOrgId: "sup1",
    supplierName: "Al-Hadid",
    isGuestSupplier: false,
    lines: [line()],
    totalExVat: 280000,
    vatRate: 0.15,
    preparedById: "other",
    preparedByName: "Nora",
    category: "steel",
    createdAt: "2026-09-10T08:00:00Z",
    approverKind: "manager",
    log: [],
    ...over,
  }) as PurchaseOrder
const rfq = (over: Partial<RfqFact> = {}): RfqFact => ({ id: "r1", status: "New", deadline: "2026-09-25", title: "Rebar", offersCount: 1, createdByUserId: "buyer", category: "steel", ...over })
const offer = (over: Partial<OfferFact> = {}): OfferFact => ({ id: "o1", rfqId: "r1", status: "قيد المراجعة", price: "12,500", ...over })
const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, needDesk: { rows: [], buyers: [], viewerCategories: ["steel"] }, ...over })

const BUYER: ProcActor = { uid: "buyer", name: "Sara", isOwner: false, canApprove: false, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const MANAGER: ProcActor = { ...BUYER, uid: "mgr", canApprove: true }
const OWNER: ProcActor = { ...MANAGER, uid: "owner", isOwner: true }

describe("V5-02 · a buyer's RFQs are the ones he raised — his categories do not widen them", () => {
  it("the list's scope", () => {
    expect(isBuyer(BUYER)).toBe(true)
    expect(rfqInScope({ createdByUserId: "buyer" }, BUYER)).toBe(true)
    expect(rfqInScope({ createdByUserId: "other" }, BUYER)).toBe(false)
    expect(rfqInScope({ createdByUserId: "other" }, MANAGER)).toBe(true)
  })

  it("Today: no task on a colleague's RFQ in his category; the manager has it", () => {
    const w = world({ rfqs: [rfq({ id: "mine", status: "Draft" }), rfq({ id: "theirs", status: "Draft", createdByUserId: "other" })] })
    expect(todayTasks(w, BUYER, NOW).filter((t) => t.kind === "rfq_draft").map((t) => t.id)).toEqual(["rfq_draft:mine"])
    expect(todayTasks(w, MANAGER, NOW).filter((t) => t.kind === "rfq_draft")).toHaveLength(2)
  })
})

describe("V5-03 · a buyer's order rows on Today are the orders he prepared", () => {
  it("an order in his category that a colleague prepared is in his list, not in his Today", () => {
    const theirs = po()
    expect(poInScope(theirs, BUYER, ["steel"])).toBe(true)
    expect(todayTasks(world({ orders: [theirs] }), BUYER, NOW).map((t) => t.kind)).toEqual([])
    expect(todayTasks(world({ orders: [po({ preparedById: "buyer" })] }), BUYER, NOW).map((t) => t.kind)).toEqual(["send"])
    expect(todayTasks(world({ orders: [theirs] }), MANAGER, NOW).map((t) => t.kind)).toEqual(["send"])
  })
})

describe("V5-04 · compare and award as soon as the prices are open", () => {
  const w = (seal: boolean) => world({ rfqs: [rfq()], offers: [offer()], policies: { ...DEFAULT_POLICIES, sealOffersUntilDeadline: seal } })

  it("unsealed: offers before the deadline raise the task, saying the round is still open", () => {
    const t = todayTasks(w(false), BUYER, NOW).find((x) => x.kind === "rfq_award")
    expect(t).toMatchObject({ severity: "amber", subKey: "task.rfq_award.sub_open", subParams: { inDays: 3, hasDate: 1 }, actionKey: "actions.compare" })
  })

  it("sealed: nothing until the deadline passes", () => {
    expect(todayTasks(w(true), BUYER, NOW).some((x) => x.kind === "rfq_award")).toBe(false)
    const closed = world({ rfqs: [rfq({ deadline: "2026-09-20" })], offers: [offer()], policies: { ...DEFAULT_POLICIES, sealOffersUntilDeadline: true } })
    expect(todayTasks(closed, BUYER, NOW).find((x) => x.kind === "rfq_award")).toMatchObject({ subKey: "task.rfq_award.sub", subParams: { ago: 2 } })
  })

  it("a manager's early close opens a sealed round", () => {
    const early = world({ rfqs: [rfq({ closedEarly: { at: "2026-09-21" } })], offers: [offer()], policies: { ...DEFAULT_POLICIES, sealOffersUntilDeadline: true } })
    expect(todayTasks(early, BUYER, NOW).some((x) => x.kind === "rfq_award")).toBe(true)
  })
})

describe("V5-01 · prices are sealed until the deadline by default (owner's decision; switchable)", () => {
  const open = rfq({ offersCount: 1 })
  it("the default and a settings document without the field both seal; the switch still opens them", () => {
    expect(DEFAULT_POLICIES.sealOffersUntilDeadline).toBe(true)
    expect(resolvePolicies(null).sealOffersUntilDeadline).toBe(true)
    expect(resolvePolicies({}).sealOffersUntilDeadline).toBe(true)
    expect(resolvePolicies({ sealOffersUntilDeadline: false }).sealOffersUntilDeadline).toBe(false)
  })

  it("the list pill: «مفتوحة للتقديم — الأسعار مغلقة» before the deadline, ready to compare after it", () => {
    expect(offersSealed(open, DEFAULT_POLICIES, NOW)).toBe(true)
    expect(rfqStage(open, NOW, offersSealed(open, DEFAULT_POLICIES, NOW))).toBe("open")
    const passed = rfq({ deadline: "2026-09-20", offersCount: 1 })
    expect(rfqStage(passed, NOW, offersSealed(passed, DEFAULT_POLICIES, NOW))).toBe("compare")
  })

  it("Today under the default: no award before the deadline, then «قارن وأرسِ»", () => {
    expect(todayTasks(world({ rfqs: [open], offers: [offer()] }), BUYER, NOW).some((t) => t.kind === "rfq_award")).toBe(false)
    const passed = world({ rfqs: [rfq({ deadline: "2026-09-21" })], offers: [offer()] })
    expect(todayTasks(passed, BUYER, NOW).find((t) => t.kind === "rfq_award")).toMatchObject({ subKey: "task.rfq_award.sub", subParams: { ago: 1 } })
  })

  it("the printed RFQ promises sealed prices only when the policy seals, and never on a direct award", () => {
    const stored = { id: "r1", title: "Rebar", deadline: "2026-09-25", products: [] }
    expect(rfqPrintModel(stored, { name: "Co", vat: null, cr: null }, "RFQ-1", "Riyadh", DEFAULT_POLICIES).sealed).toBe(true)
    expect(rfqPrintModel(stored, { name: "Co", vat: null, cr: null }, "RFQ-1", "Riyadh", { sealOffersUntilDeadline: false }).sealed).toBe(false)
    expect(rfqPrintModel({ ...stored, directAward: true }, { name: "Co", vat: null, cr: null }, "RFQ-1", "Riyadh", DEFAULT_POLICIES).sealed).toBe(false)
    const written: string[] = []
    const w = { document: { write: (s: string) => void written.push(s), close: () => undefined } } as unknown as Window
    const t = (k: string, p?: Record<string, string | number>) => (k === "how_to_quote" ? `how:${p?.sealed}` : k)
    writeRfqPrint(w, rfqPrintModel(stored, { name: "Co", vat: null, cr: null }, "RFQ-1", "Riyadh", { sealOffersUntilDeadline: false }), "ar", t, NOW)
    expect(written[0]).toContain("how:0")
  })
})

describe("V5-05 · the draft names its number", () => {
  it("passes the RFQ number to «… · لم تصل أي مورد — أسطرها محجوزة لها»", () => {
    const [t] = todayTasks(world({ rfqs: [rfq({ status: "Draft", number: "RFQ-2026/007" })] }), BUYER, NOW)
    expect(t).toMatchObject({ kind: "rfq_draft", subKey: "task.rfq_draft.sub", subParams: { number: "RFQ-2026/007", hasNumber: 1 } })
    const [none] = todayTasks(world({ rfqs: [rfq({ status: "Draft" })] }), BUYER, NOW)
    expect(none.subParams).toEqual({ number: "", hasNumber: 0 })
  })
})

const facts: DeskFacts = { now: NOW, policies: DEFAULT_POLICIES, agreements: [], history: [], orders: [], rfqs: [], onHand: () => null, makeable: () => false, mfgRequests: {} }
const pr = (over: Partial<ProjectRequestDoc> = {}): ProjectRequestDoc => ({ id: "pr1", title: "L2", items: [{ name: "Steel", quantity: 1, unit: "t", category: "steel", samplePending: true, itemId: "b1" }], status: "approved", needBy: "2026-10-10", requestedByUserName: "Yasser", createdAt: "2026-09-22T06:00:00Z", ...over })
const rows = buildNeedRows([projectNeed({ id: "p1", name: "Villas" }, pr(), "PR-1")], facts)

describe("V5-06 · the per-buyer roll-up opens the needs, for the owner too", () => {
  it("«افتح الاحتياج» for the reading owner and the manager alike", () => {
    const w = world({ ownerHasTeam: true, needDesk: { rows, buyers: [{ uid: "u2", name: "Turki", categories: ["steel"] }], viewerCategories: null } })
    for (const actor of [OWNER, MANAGER]) {
      const rollups = todayTasks(w, actor, NOW).filter((t) => t.kind === "need_rollup")
      expect(rollups.length).toBeGreaterThan(0)
      expect(rollups.every((t) => t.actionKey === "actions.openNeeds")).toBe(true)
    }
  })
})

describe("V5-07 · the sample wait names the sample", () => {
  it("the latest submittal's number — the highest revision, then sequence", () => {
    expect(latestSampleNo([])).toBeNull()
    expect(latestSampleNo([{ seq: 3, rev: 1 }, { seq: 5, rev: 2 }, { seq: 4, rev: 2 }])).toBe("05")
  })

  it("carries {no} when the number is known, and says none otherwise", () => {
    const base = world({ needDesk: { rows, buyers: [], viewerCategories: null } })
    const wait = (w: ProcWorld) => todayWaits(w, BUYER, NOW).find((x) => x.kind === "sample_approval")
    expect(wait({ ...base, sampleNos: { [rows[0].key]: "02" } })?.titleParams).toEqual({ name: "Steel", no: "02", hasNo: 1 })
    expect(wait(base)?.titleParams).toEqual({ name: "Steel", no: "", hasNo: 0 })
  })
})

describe("V5-10 · a buyer's workshop shortfalls follow his categories", () => {
  const desk = { orders: [po({ lines: [line({ name: "Rebar 12 mm", unit: "t" })], category: "steel" })], rfqs: [{ category: "electrical", createdAt: "2026-09-01", products: [{ name: "Cable 4 mm", unit: "m" }] }] }
  it("in his category, uncategorised, or no categories set: shown; another buyer's: not", () => {
    expect(materialInScope("Rebar 12 mm", "t", ["steel"], desk)).toBe(true)
    expect(materialInScope("Cable 4 mm", "m", ["steel"], desk)).toBe(false)
    expect(materialInScope("Zinc sheet", "pc", ["steel"], desk)).toBe(true)
    expect(materialInScope("Cable 4 mm", "m", null, desk)).toBe(true)
  })
})

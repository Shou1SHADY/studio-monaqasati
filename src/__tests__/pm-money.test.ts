/**
 * PM 1.0 — the Money group: certificate period / collection / late days and
 * totals (IPC-04), approved variations on a certificate (IPC-01, VO-03), the
 * cost roll-up (CST-01…03), the three-way match (STK-07) and the approved
 * estimate at completion (CVR-01 → prj:BUD).
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import {
  certificatePeriods,
  certificateTotals,
  certificateVoLines,
  collectionFigures,
  lateDays,
  voClaimable,
  voRisk,
  type CertificateFacts,
  type ClaimableVariation,
} from "@/lib/pm/certificate"
import { prepareCertificate, withdrawCertificate, type PmCertificate } from "@/lib/pm/certificate-writes"
import { bleeding, itemCosts, liveIssues, poLineCommitted, poLinePrice, projectCost, sectionRows, type CostItem, type CostPo } from "@/lib/pm/cost"
import { approveReconciliation } from "@/lib/pm/cvr-writes"
import { matchRows } from "@/lib/pm/match"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }

const cert = (over: Partial<CertificateFacts>): CertificateFacts => ({ seq: 1, status: "appr", gross: 100_000, net: 90_000, vat: 12_000, retention: 10_000, recovery: 10_000, prepOn: "2026-06-01", ...over })

describe("certificates — period, collection, lateness, totals (IPC-04)", () => {
  it("late days count from the due date only while money is out", () => {
    expect(lateDays(cert({ dueOn: "2026-09-01", collected: 0.5 }), "2026-09-28")).toBe(27)
    expect(lateDays(cert({ dueOn: "2026-09-01", status: "paid" }), "2026-09-28")).toBe(0)
    expect(lateDays(cert({ dueOn: "2026-10-01" }), "2026-09-28")).toBe(0)
    expect(lateDays(cert({ dueOn: "2026-09-01", status: "sub" }), "2026-09-28")).toBe(0)
  })

  it("periods run from the start, then from each live certificate; void certificates are out of the totals", () => {
    const cs = [cert({ seq: 1, prepOn: "2026-05-01" }), cert({ seq: 2, prepOn: "2026-06-01", status: "void" }), cert({ seq: 3, prepOn: "2026-07-01", status: "int" })]
    const p = certificatePeriods(cs, "2026-03-01")
    expect(p.get(1)).toEqual({ from: "2026-03-01", to: "2026-05-01" })
    expect(p.get(3)).toEqual({ from: "2026-05-01", to: "2026-07-01" })
    expect(certificateTotals(cs).gross).toBe(200_000)
  })

  it("collection: outstanding, overdue, cash in without VAT, advance left, retention held", () => {
    const cs = [cert({ seq: 1, status: "paid", collected: 1 }), cert({ seq: 2, dueOn: "2026-09-01", collected: 0 }), cert({ seq: 3, status: "int" })]
    const f = collectionFigures({ certs: cs, today: "2026-09-28", contractValue: 1_000_000, advance: 0.1, started: true, retentionReleased: false })
    expect(f.outstanding).toBe(90_000)
    expect(f.overdue).toBe(90_000)
    expect(f.late).toEqual([{ seq: 2, days: 27, amount: 90_000 }])
    expect(f.cashIn).toBe(100_000 + 90_000 - 12_000)
    expect(f.advanceLeft).toBe(100_000 - 30_000)
    expect(f.retentionHeld).toBe(20_000)
  })
})

describe("approved variations on a certificate (IPC-01, VO-03)", () => {
  const vos: ClaimableVariation[] = [
    { id: "v1", seq: 1, title: "Extra slab", status: "appr", value: 100_000, executedPct: 0.6, billedPct: 0.2 },
    { id: "v2", seq: 2, title: "Pending", status: "wait", value: 50_000, executedPct: 0.4 },
    { id: "v3", seq: 3, title: "Billed", status: "appr", value: 10_000, executedPct: 1, billedPct: 1 },
  ]
  it("only approved, for the share executed since last billed; unapproved work is risk", () => {
    expect(voClaimable(vos).map((v) => v.id)).toEqual(["v1"])
    expect(certificateVoLines(vos, new Set(["v1", "v2"]))).toEqual([{ voId: "v1", seq: 1, title: "Extra slab", value: 100_000, from: 0.2, to: 0.6, amount: 40_000 }])
    expect(voRisk(vos)).toBe(20_000)
  })

  const terms: ContractTerms = { ...defaultTerms({ advance: 0, retention: 0 }) }
  beforeEach(() => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", budget: 1_000_000, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/009", lifecycle: "live", terms, original: terms, lastIpcOn: "2026-08-01" } })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "100", unitPrice: "100", executedQuantity: 10, billedQuantity: 0 })
    seed("projects/p1/pmVariations/01", { seq: 1, title: "Extra slab", status: "appr", value: 100_000, cost: 80_000, executedPct: 0.5, billedPct: 0.1 })
  })

  it("prepare bills the variation, records the period and checklist; withdraw undoes it", async () => {
    const r = await prepareCertificate(db, qs, "p1", { uid: "qs1", name: "Huda" }, { itemIds: ["i1"], voIds: ["01"], checks: ["sig", "sig", "ph"] })
    expect(r.amounts.gross).toBe(1000 + 40_000)
    const c = readDoc<PmCertificate>("projects/p1/pmCertificates/01") as PmCertificate
    expect(c.periodFrom).toBe("2026-08-01")
    expect(c.checks).toEqual(["sig", "ph"])
    expect(c.voLines?.[0]).toMatchObject({ voId: "01", from: 0.1, to: 0.5, amount: 40_000 })
    expect((readDoc<Record<string, number>>("projects/p1/pmVariations/01") as Record<string, number>).billedPct).toBe(0.5)
    expect((readDoc<Record<string, { lastIpcOn: string }>>("projects/p1") as Record<string, { lastIpcOn: string }>).pm.lastIpcOn).toBe(c.prepOn)

    await withdrawCertificate(db, qs, "p1", { uid: "qs1", name: "Huda" }, 1)
    expect((readDoc<Record<string, number>>("projects/p1/pmVariations/01") as Record<string, number>).billedPct).toBe(0.1)
  })
})

const items: CostItem[] = [
  { id: "a", code: "03-01", description: "Concrete", division: "Concrete", quantity: 100, rate: 500, executed: 50, estCost: 400 },
  { id: "b", code: "03-02", description: "Rebar", division: "Concrete", quantity: 10, rate: 3000, executed: 0, estCost: 2500 },
  { id: "c", code: "09-01", description: "Paint", division: "Finishes", quantity: 200, rate: 40, executed: 100, estCost: 0 },
]
const po = (over: Partial<CostPo>): CostPo => ({ id: "po1", docNumber: "PO-2026/001", status: "sent", supplierName: "S", rfqId: "r1", totalExVat: 0, lines: [], ...over })

describe("cost (CST-01…03)", () => {
  it("a lump-sum order's unpriced lines share its total; commitment is the open quantity until closed", () => {
    const p = po({ totalExVat: 1000, lines: [{ id: "l1", name: "X", unit: "m", quantity: 10, unitPrice: 50, accepted: 0, cancelled: 0 }, { id: "l2", name: "Y", unit: "m", quantity: 5, unitPrice: null, accepted: 0, cancelled: 0 }] })
    expect(poLinePrice(p, p.lines[1])).toBe(100)
    expect(poLineCommitted(p, { ...p.lines[0], cancelled: 4 })).toBe(300)
    expect(poLineCommitted({ ...p, status: "closed" }, { ...p.lines[0], accepted: 2 })).toBe(100)
    expect(poLineCommitted({ ...p, status: "awaiting_approval" }, p.lines[0])).toBe(0)
  })

  it("issues from the project's own store and reversed issues are not counted again", () => {
    const live = liveIssues(
      [
        { id: "1", quantityTaken: 1, warehouseId: "main" },
        { id: "2", quantityTaken: 1, warehouseId: "site" },
        { id: "3", quantityTaken: 1, warehouseId: "main" },
        { id: "4", type: "reversal", reversesRecordId: "3", quantityTaken: 1 },
      ],
      "site"
    )
    expect(live.map((i) => i.id)).toEqual(["1"])
  })

  it("budget → committed → actual → paid per line; leaks over 2%; sections and the roll-up", () => {
    const r = itemCosts({
      items,
      projectWarehouseId: null,
      pos: [po({ lines: [{ id: "l1", name: "Concrete", unit: "m3", quantity: 60, unitPrice: 420, accepted: 50, cancelled: 0, boqItemId: "a" }, { id: "l2", name: "Misc", unit: "ls", quantity: 1, unitPrice: 500, accepted: 1, cancelled: 0 }] })],
      issues: [{ id: "w1", boqItemId: "a", quantityTaken: 10, unitCost: 100, warehouseId: "main" }],
      subcontracts: [{ value: 10_000, paid: 2000, lines: [{ itemId: "c", value: 10_000, certified: 0.4 }] }],
    })
    const a = r.items.get("a")!
    expect(a.budget).toBe(40_000)
    expect(a.budgetExecuted).toBe(20_000)
    expect(a.actual).toBe(21_000 + 1000)
    expect(a.committed).toBe(25_200 + 1000)
    expect(a.leak).toBe(true)
    expect(a.deviation).toBe(2000)
    expect(a.forecast).toBe(44_000)
    const c = r.items.get("c")!
    expect(c.budget).toBeNull()
    expect(c.actual).toBe(4000)
    expect(c.paid).toBe(2000)
    expect(r.unassigned.actual).toBe(500)
    expect(bleeding(items, r.items).map((x) => x.item.id)).toEqual(["a"])

    const rows = sectionRows(items, r.items)
    expect(rows.map((s) => s.section)).toEqual(["Concrete", "Finishes"])
    expect(rows[0]).toMatchObject({ n: 2, budget: 65_000, budgetExecuted: 20_000, actual: 22_000 })

    const total = projectCost({ items, costs: r.items, unassigned: r.unassigned, variations: [{ status: "appr", value: 10_000, cost: 8000, executedPct: 0.5 }], baseValue: 0, penalty: 1000 })
    expect(total.contract).toBe(50_000 + 30_000 + 8000 + 10_000)
    expect(total.earned).toBe(25_000 + 4000 + 5000)
    expect(total.budget).toBe(65_000 + 8000)
    expect(total.actual).toBe(22_000 + 4000 + 500)
    expect(total.forecastCost).toBe(44_000 + 25_000 + 4000 + 8000 + 500)
    expect(total.forecastMargin).toBe(98_000 - 81_500 - 1000)
    expect(total.unestimated).toBe(1)
    expect(Math.round(total.cpi * 1000) / 1000).toBe(Math.round((20_000 / 22_000) * 1000) / 1000)
  })
})

describe("three-way match (STK-07)", () => {
  it("ordered × received × invoiced, by order or RFQ, by material name", () => {
    const orders = [
      po({ id: "po1", rfqId: "r1", lines: [{ id: "l1", name: "Cement", unit: "bag", quantity: 100, unitPrice: 20, accepted: 80, cancelled: 0 }, { id: "l2", name: "Sand", unit: "m3", quantity: 10, unitPrice: 50, accepted: 10, cancelled: 0 }] }),
      po({ id: "po2", rfqId: null, lines: [{ id: "l1", name: "Tiles", unit: "m2", quantity: 50, unitPrice: 30, accepted: 50, cancelled: 0 }] }),
      po({ id: "po3", status: "awaiting_approval", lines: [{ id: "l1", name: "X", unit: "u", quantity: 1, unitPrice: 1, accepted: 0, cancelled: 0 }] }),
    ]
    const rows = matchRows(orders, [
      { id: "i1", no: "INV-1", date: "2026-09-01", rfqId: "r1", lines: [{ name: "cement", quantity: 90, unitPrice: 20 }, { name: "Sand", quantity: 10, unitPrice: 50 }] },
      { id: "i2", no: "INV-2", date: "2026-09-02", poId: "po2", lines: [{ name: "Ceramic", quantity: 40, unitPrice: 30 }] },
    ])
    expect(rows.map((r) => r.state)).toEqual(["over", "ok", "under"])
    expect(rows[0]).toMatchObject({ invoiced: 90, invoicedAmount: 1800, invoice: { no: "INV-1", date: "2026-09-01" } })
  })
})

describe("approving the reconciliation (CVR-01 → prj:BUD)", () => {
  beforeEach(() => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/009", lifecycle: "live", terms: defaultTerms() } })
  })

  it("keeps the estimate on the project and appends one event per approval", async () => {
    const cost = { forecastCost: 800_000, contract: 1_000_000, actual: 300_000, forecastMargin: 200_000, estimatedLines: 4 }
    await approveReconciliation(db, pm, "p1", { uid: "pm1", name: "Abdullah" }, cost)
    await approveReconciliation(db, pm, "p1", { uid: "pm1", name: "Abdullah" }, { ...cost, forecastCost: 820_000 })
    const block = (readDoc<Record<string, { eac: { v: number; rev: number }; budCount: number }>>("projects/p1") as Record<string, { eac: { v: number; rev: number }; budCount: number }>).pm
    expect(block.budCount).toBe(2)
    expect(block.eac).toMatchObject({ v: 820_000, rev: 2 })
    expect(readDoc("pmEvents/prj:BUD:PJ-2026_009:1")).toMatchObject({ kind: "BUD", amount: 800_000 })
    expect(readDoc("pmEvents/prj:BUD:PJ-2026_009:2")).toMatchObject({ amount: 820_000 })
  })

  it("only approve may approve it", async () => {
    await expect(approveReconciliation(db, qs, "p1", { uid: "qs1", name: "Huda" }, { forecastCost: 1, contract: 1, actual: 0, forecastMargin: 0, estimatedLines: 1 })).rejects.toBeInstanceOf(PmAccessError)
  })

  it("refuses an estimate when no BOQ line carries an estimated cost (UAT click-through)", async () => {
    await expect(approveReconciliation(db, pm, "p1", { uid: "pm1", name: "Abdullah" }, { forecastCost: 62_000, contract: 1, actual: 62_000, forecastMargin: 0, estimatedLines: 0 })).rejects.toMatchObject({ blocks: ["no_budget"] })
  })
})

/**
 * With Project Management (or Manufacturing) switched off, the core modules stop offering what only
 * exists because of it: Procurement's needs desk and Today, the merge hint, Finance's source links and
 * HR's workplace types. Everything defaults to on.
 */

import * as needsModule from "@/lib/procurement/needs"
import { stockNeeds } from "@/lib/procurement/needs"
import { fromMfgRequest, fromPmRequest } from "@/lib/procurement/incoming-ingest"
import { incomingNeeds, toLinkWorld } from "@/lib/procurement/incoming-need"
import { replyClockOf } from "@/lib/procurement/incoming-state"
import { mergeHint, type NeedRow } from "@/lib/procurement/need-desk"
import { todayTasks, todayWaits, type ProcWorld, type TodayActor, type PmBoundaryFact } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type PurchaseOrder } from "@/lib/procurement/types"
import { sourceDocumentPath } from "@/lib/accounting/source-links"
import { defaultSiteType, siteTypesFor } from "@/lib/hr/sites"
import type { PurchaseRequestRecord } from "@/lib/manufacturing-engine"
import type { OptionalModule } from "@/lib/company-modules"

const req = (over: Partial<PurchaseRequestRecord> = {}): PurchaseRequestRecord => ({ id: "r1", itemName: "Epoxy", unit: "can", quantity: 4, needBy: "2026-10-01", note: null, by: "Workshop", at: "2026-09-20T08:00:00.000Z", state: "sent", ...over })
const pr = { id: "pr1", pm: true, title: "Level 2", status: "approved", needBy: "2026-11-01", requestedByUserId: "u1", requestedByUserName: "Ali", lines: [{ itemId: null, code: null, key: "k", name: "Rebar", unit: "t", qty: 3 }] } as unknown as Parameters<typeof fromPmRequest>[2]

// A company that closes Projects or Manufacturing AFTER its requests exist keeps them: they continue by their own state (NFR-08, B-13).
const clock = replyClockOf(new Date("2026-09-29T09:00:00Z"), { inventoryReplyDays: 1, workshopReplyDays: 1 })
const stored = [fromMfgRequest("org", { id: "wo1", ref: "WO-2026/004", context: "Marble" }, req(), { number: "MAT-2026/001", seq: 1 }), fromPmRequest("org", { id: "p1", name: "Villas" }, pr)]
const stock = stockNeeds([{ id: "i1", warehouseId: "w1", warehouseName: "Main", name: "Cement", unit: "bag", quantity: 2, minStockLevel: 10 }], { rfqs: [], orders: [] })

describe("the needs desk with modules off (NFR-08: a closed connector hides no open request)", () => {
  it("the read-time module filter is gone", () => {
    expect((needsModule as Record<string, unknown>).needsForModules).toBeUndefined()
    expect((needsModule as Record<string, unknown>).ALL_NEED_MODULES).toBeUndefined()
  })

  it("a project's request and a workshop's shortfall read as needs whatever the package says — the desk is not told the switches", () => {
    const needs = incomingNeeds(stored, toLinkWorld([], []), clock)
    expect(needs.map((n) => n.kind).sort()).toEqual(["mfg", "project"])
    expect(needs.every((n) => n.state === "action")).toBe(true)
  })

  it("the stock gap stays computed beside them", () => {
    expect(stock.map((n) => n.kind)).toEqual(["stock"])
  })
})

describe("the merge hint", () => {
  const row = (key: string, project: string | null): NeedRow =>
    ({ key, needKey: key, state: "open", path: "rfq", selectable: true, category: null, need: { projectName: project } }) as unknown as NeedRow
  const rows = [row("a", "Villas"), row("b", "Villas")]
  it("offers 'same project' while Projects is on and not when it is off", () => {
    expect(mergeHint(rows, new Set())).toMatchObject({ by: "project", label: "Villas", lines: 2 })
    expect(mergeHint(rows, new Set(), { project: false })).toBeNull()
  })
})

describe("Procurement's Today with Projects off", () => {
  const NOW = new Date("2026-09-29T09:00:00Z")
  const actor: TodayActor = { uid: "m", name: "M", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
  const events: PmBoundaryFact[] = [{ key: "prj:SRET:1", kind: "SRET", projectId: "p1", projectNo: "PJ-2026/001", amount: 900, params: { material: "Block", unit: "pc", qty: 30, why: "nc" }, at: "2026-09-27T08:00:00Z" }]
  const budgetPo = {
    id: "po1",
    organizationId: "org",
    docNumber: "PO-2026/014",
    status: "awaiting_approval",
    projectId: "p1",
    supplierName: "Al-Hadid",
    lines: [{ id: "l1", name: "Rebar", unit: "t", quantity: 1, unitPrice: 1, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
    pmBudget: { state: "pending", over: 500 },
    createdAt: "2026-09-10T08:00:00Z",
    log: [],
  } as unknown as PurchaseOrder
  const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [budgetPo], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, pmEvents: events, ...over })

  it("shows the project events and the wait on the project's budget decision while Projects is on", () => {
    expect(todayTasks(world(), actor, NOW).some((t) => t.kind === "pm_supplier_return")).toBe(true)
    expect(todayWaits(world(), actor, NOW).map((w) => w.kind)).toContain("pm_budget")
  })

  it("shows neither when Projects is off", () => {
    expect(todayTasks(world({ projectsOn: false }), actor, NOW).some((t) => t.kind.startsWith("pm_"))).toBe(false)
    expect(todayWaits(world({ projectsOn: false }), actor, NOW).map((w) => w.kind)).not.toContain("pm_budget")
  })
})

describe("Finance's 'open the source document'", () => {
  const entry = (sourceType: string, sourceId: string, project?: string) =>
    ({ sourceType, sourceId, lines: [{ project: project ?? null }] }) as unknown as Parameters<typeof sourceDocumentPath>[0]
  const noPm = new Set<OptionalModule>(["project-management"])
  it("has no page for a project certificate, retention or PM posting when Projects is off", () => {
    expect(sourceDocumentPath(entry("ipc_claim", "c1", "p9"), "contractor")).toBe("projects/p9")
    expect(sourceDocumentPath(entry("ipc_claim", "c1", "p9"), "contractor", noPm)).toBeNull()
    expect(sourceDocumentPath(entry("retention_release", "c1", "p9"), "contractor", noPm)).toBeNull()
    expect(sourceDocumentPath(entry("pm_cash", "c1", "p9"), "contractor", noPm)).toBeNull()
  })
  it("still opens a core document, and a module's own page only while that module is on", () => {
    expect(sourceDocumentPath(entry("sales_quotation", "q1"), "contractor", noPm)).toBe("sales/quotations/q1")
    expect(sourceDocumentPath(entry("goods_receipt", "d1"), "contractor", noPm)).toBe("goods-received?delivery=d1")
    expect(sourceDocumentPath(entry("hr_pay", "m1"), "contractor")).toBe("accounting/hr-desk")
    expect(sourceDocumentPath(entry("hr_pay", "m1"), "contractor", new Set<OptionalModule>(["hr"]))).toBeNull()
    expect(sourceDocumentPath(entry("mfg_scrap", "s1"), "contractor", new Set<OptionalModule>(["manufacturing"]))).toBeNull()
  })
})

describe("HR workplace types", () => {
  it("offers every type, project first, while Projects is on", () => {
    expect(siteTypesFor(true)[0]).toBe("project")
    expect(defaultSiteType(true)).toBe("project")
  })
  it("offers no new project site when Projects is off, so the form can always be saved", () => {
    expect(siteTypesFor(false)).not.toContain("project")
    expect(defaultSiteType(false)).toBe("workshop")
  })
  it("lets a site that already is a project site keep its type", () => {
    expect(siteTypesFor(false, "project")).toContain("project")
  })
})

/**
 * Manufacturing scenarios — PRD 1.2's "Full flows" driven end to end through
 * the REAL write layers (manufacturing-writes, sales-order-writes) against an
 * in-memory Firestore, with the marble workshop of the reference prototype:
 * stations design → slab sign-off → bridge saw → profiling → polishing → QC &
 * packing, Crema Marfil / Statuario / Beige Sahel slabs lotted by block, and
 * Finance's scrap limit of 3,000 SAR.
 *
 * After EVERY write the whole world is re-read and checked (BD-02): every unit
 * in exactly one place, no negative balance hidden by clamping, nothing closed
 * beyond the quality release or shipped beyond the close, one non-negative WIP,
 * and zero leaks — no step owned by another module is ever a manufacturing
 * user's to press. A refused write must leave the store byte-for-byte as it was.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)
jest.mock("@/lib/accounting/hooks", () => ({
  onMfgMaterialsReceived: jest.fn(),
  onMfgRemnantReceived: jest.fn(),
  onMfgScrapApproved: jest.fn(),
  onWorkOrderDelivered: jest.fn(),
  onSalesCreditNoteIssued: jest.fn(),
  onSalesDelivered: jest.fn(),
  onSalesInvoiceIssued: jest.fn(),
  onSalesInvoicePaid: jest.fn(),
}))

import fs from "fs"
import path from "path"
import type { Firestore } from "firebase/firestore"
import { dumpDb, fakeFirestore, firestoreModule, listCollection, listCollectionGroup, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { onMfgMaterialsReceived, onMfgRemnantReceived, onMfgScrapApproved, onWorkOrderDelivered } from "@/lib/accounting/hooks"
import {
  answerCostingRequest,
  answerMakeRequest,
  applyOrderChange,
  calcOf,
  clarifyScrap,
  closeProduction,
  confirmMaterialReceipt,
  createCostingRequest,
  createMfgProduct,
  createStockWorkOrder,
  declineRequest,
  decideRemake,
  isV2Order,
  issueDeliveryNote,
  issueWithdrawal,
  markBlockClaimRaised,
  markBlockQuarantined,
  markPurchaseArrived,
  qcDecide,
  raiseBlockNotice,
  receiveDeliveryNote,
  receiveRemnant,
  recordDrawingResult,
  recordOutput,
  recordQuoteStatus,
  recordStop,
  recordSurvey,
  releaseOrder,
  requestOrderChange,
  requestPurchase,
  requestStationMaterials,
  reviewScrap,
  reviewVariance,
  routeNeedToManufacturing,
  sendCostStatement,
  signOffSlab,
  submitDrawing,
  toNoteSlice,
  type Actor,
  type MfgBlockNotice,
  type MfgStop,
  type OutputInput,
  type QcDecisionInput,
  salesOrderOfWorkOrder,
  type WorkOrderV2,
} from "@/lib/manufacturing-writes"
import { clientDrawingsDue, workshopGatesFor } from "@/lib/manufacturing-view"
import { createManufacturingRequest, markDepositPaid } from "@/lib/sales-order-writes"
import {
  CAUSE_MATERIAL,
  DEFAULT_MFG_SETTINGS,
  allocateStock,
  candidates,
  conditionOf,
  conservationGap,
  hourVariance,
  isQcStation,
  itemKey,
  lotFree,
  mainMaterial,
  materialNeed,
  materialOpen,
  materialReceived,
  materialState,
  minQuantity,
  needRemain,
  nextStep,
  normalizeMfgSettings,
  orderCost,
  ownsCandidate,
  r1,
  releaseBlocks,
  round2,
  roundNeed,
  scheduleOrders,
  shortages,
  standardCost,
  unitSunkCost,
  wasteFactor,
  type Actor as RoleActor,
  type Allocation,
  type CandidateContext,
  type CandidateKey,
  type DefectKind,
  type ApproverOrg,
  type LostHours,
  type MfgBomLine,
  type MfgCostEstimate,
  type MfgNoteSlice,
  type MfgProduct,
  type MfgRouteStep,
  type MfgSettings,
  type OrderCalc,
  type StockIndex,
} from "@/lib/manufacturing-engine"
import type { MfgDepartment } from "@/lib/manufacturing"
import type { DeliveryNote } from "@/lib/delivery-notes"
import type { ManufacturingRequest, SalesOrder } from "@/lib/sales-orders"

// ---------------------------------------------------------------------------
// The workshop (mirrors the prototype's seed — "today" is 13 Sep 2026)
// ---------------------------------------------------------------------------

const ORG = "org1"
const TODAY = "2026-09-13"
const NOW = new Date(`${TODAY}T08:00:00.000Z`)
const db = fakeFirestore as unknown as Firestore

const A = {
  badr: { id: "u-badr", name: "Badr Al-Otaibi" }, // workshop manager
  sami: { id: "u-sami", name: "Abu Sami" }, // bridge-saw lead
  ammar: { id: "u-ammar", name: "Abu Ammar" }, // profiling lead
  faisal: { id: "u-faisal", name: "Abu Faisal" }, // polishing lead
  lama: { id: "u-lama", name: "Eng. Lama" }, // quality
  noura: { id: "u-noura", name: "Noura Al-Zamil" }, // cost controller
  store: { id: "u-store", name: "Storekeeper Hamad" }, // inventory
  reem: { id: "u-reem", name: "Reem (Sales)" },
  huda: { id: "u-huda", name: "Huda (Procurement)" },
  pm: { id: "u-pm", name: "Eng. Fahad (Projects)" },
} satisfies Record<string, Actor>

const MANAGER: RoleActor = { uid: A.badr.id, manage: true, work: false, qc: false, cost: false, view: false }
const COST: RoleActor = { uid: A.noura.id, manage: false, work: false, qc: false, cost: true, view: false }
/** Every manufacturing role at once — still owns nothing that is another module's. */
const EVERY_ROLE: RoleActor = { uid: "u-all", manage: true, work: true, qc: true, cost: true, view: true }
const MFG_ROLES: RoleActor[] = [
  EVERY_ROLE,
  MANAGER,
  COST,
  { uid: A.sami.id, manage: false, work: true, qc: false, cost: false, view: false },
  { uid: A.lama.id, manage: false, work: false, qc: true, cost: false, view: false },
  { uid: "u-mgmt", manage: false, work: false, qc: false, cost: false, view: true },
]
/** Steps other modules own (payment, issue, drawing approval, purchase, receipt, remnant receipt). */
const EXTERNAL_KEYS = new Set<CandidateKey>(["down_payment", "issue_wait", "drawing_wait", "purchase_wait", "receipt_wait", "remnant_wait"])

const STATIONS: MfgDepartment[] = [
  { id: "s1", organizationId: ORG, name: "Design & nesting", order: 1, workers: 2, hoursPerDay: 8, hourlyRate: 85, gate: "drawing", qcStation: false, leadUserId: null },
  { id: "s6", organizationId: ORG, name: "Slab selection & sign-off", order: 2, workers: 1, hoursPerDay: 8, hourlyRate: 65, gate: "slab", qcStation: false, leadUserId: null },
  { id: "s7", organizationId: ORG, name: "Bridge-saw cutting", order: 3, workers: 2, hoursPerDay: 8, hourlyRate: 70, gate: null, qcStation: false, leadUserId: A.sami.id },
  { id: "s8", organizationId: ORG, name: "Profiling & edges", order: 4, workers: 3, hoursPerDay: 8, hourlyRate: 60, gate: null, qcStation: false, leadUserId: A.ammar.id },
  { id: "s9", organizationId: ORG, name: "Cut-outs & drilling", order: 5, workers: 1, hoursPerDay: 8, hourlyRate: 65, gate: null, qcStation: false, leadUserId: null },
  { id: "s10", organizationId: ORG, name: "Polishing & sealing", order: 6, workers: 2, hoursPerDay: 8, hourlyRate: 58, gate: null, qcStation: false, leadUserId: A.faisal.id },
  { id: "s5", organizationId: ORG, name: "QC & packing", order: 7, workers: 2, hoursPerDay: 8, hourlyRate: 45, gate: null, qcStation: true, leadUserId: null },
]
const LEAD_OF: Record<string, Actor> = { s7: A.sami, s8: A.ammar, s10: A.faisal, s5: A.lama }

interface Material {
  itemName: string
  unit: string
  unitCost: number
}
const CREMA: Material = { itemName: "Crema Marfil slab", unit: "m²", unitCost: 320 }
const STATUARIO: Material = { itemName: "Statuario slab", unit: "m²", unitCost: 690 }
const BEIGE: Material = { itemName: "Beige Sahel slab", unit: "m²", unitCost: 245 }
const QUARTZ: Material = { itemName: "Engineered quartz", unit: "m²", unitCost: 480 }
const BLADES: Material = { itemName: "Diamond blades", unit: "pc", unitCost: 340 }
const PADS: Material = { itemName: "Polishing pads", unit: "set", unitCost: 260 }
const EPOXY: Material = { itemName: "Stone epoxy adhesive", unit: "pail", unitCost: 95 }
const SEALER: Material = { itemName: "Stone sealer", unit: "L", unitCost: 140 }
const CRATE: Material = { itemName: "Timber shipping crate", unit: "crate", unitCost: 85 }

const slabLine = (m: Material, qtyPerUnit: number, departmentId: string): MfgBomLine => ({ ...m, qtyPerUnit, departmentId, withWaste: true, lotted: true, custody: false })
const custodyLine = (m: Material, qtyPerUnit: number, departmentId: string): MfgBomLine => ({ ...m, qtyPerUnit, departmentId, withWaste: false, lotted: false, custody: true })
const step = (departmentId: string, hoursPerUnit: number | null): MfgRouteStep => ({ departmentId, departmentName: STATIONS.find((s) => s.id === departmentId)!.name, hoursPerUnit })

type ProductInput = Omit<MfgProduct, "id" | "organizationId">
const PRODUCT_INPUTS = {
  skirting: {
    name: "Marble skirting 10 cm",
    unit: "m",
    family: "stone",
    requiresMeasurement: false,
    requiresDrawingApproval: false,
    requiresSlabApproval: false,
    wastePercent: 15,
    referenceBuyPrice: 70,
    route: [step("s7", 0.06), step("s8", 0.07), step("s10", 0.05), step("s5", 0.02)],
    bom: [slabLine(BEIGE, 0.12, "s7"), custodyLine(BLADES, 0.003, "s7"), custodyLine(PADS, 0.004, "s10"), custodyLine(CRATE, 0.01, "s5")],
  },
  stair: {
    name: "Marble stair — tread & riser",
    unit: "m",
    family: "stone",
    requiresMeasurement: true,
    requiresDrawingApproval: true,
    requiresSlabApproval: true,
    wastePercent: 35,
    referenceBuyPrice: 620,
    route: [step("s1", 0.12), step("s6", 0.08), step("s7", 0.3), step("s8", 0.45), step("s10", 0.28), step("s5", 0.1)],
    bom: [slabLine(CREMA, 0.85, "s7"), custodyLine(BLADES, 0.018, "s7"), custodyLine(EPOXY, 0.09, "s8"), custodyLine(PADS, 0.024, "s10"), custodyLine(SEALER, 0.08, "s10"), custodyLine(CRATE, 0.07, "s5")],
  },
  cladding: {
    name: "External cladding — Statuario",
    unit: "m²",
    family: "stone",
    requiresMeasurement: true,
    requiresDrawingApproval: true,
    requiresSlabApproval: true,
    wastePercent: 30,
    referenceBuyPrice: 1250,
    route: [step("s1", 0.14), step("s6", 0.09), step("s7", 0.4), step("s8", 0.36), step("s10", 0.26), step("s5", 0.11)],
    bom: [slabLine(STATUARIO, 1, "s7"), custodyLine(BLADES, 0.02, "s7"), custodyLine(EPOXY, 0.12, "s8"), custodyLine(PADS, 0.02, "s10"), custodyLine(SEALER, 0.1, "s10"), custodyLine(CRATE, 0.08, "s5")],
  },
  vanity: {
    name: "Quartz vanity tops",
    unit: "m²",
    family: "stone",
    requiresMeasurement: true,
    requiresDrawingApproval: true,
    requiresSlabApproval: true,
    wastePercent: 22,
    referenceBuyPrice: 980,
    // Cut-outs has no standard time yet — a cost statement cannot be sent (REQ-09).
    route: [step("s1", 0.1), step("s6", 0.06), step("s7", 0.3), step("s8", 0.38), step("s9", null), step("s10", 0.22), step("s5", 0.09)],
    bom: [slabLine(QUARTZ, 1, "s7"), custodyLine(BLADES, 0.018, "s7"), custodyLine(EPOXY, 0.08, "s8"), custodyLine(PADS, 0.02, "s10"), custodyLine(CRATE, 0.06, "s5")],
  },
} satisfies Record<string, ProductInput>
type ProductKey = keyof typeof PRODUCT_INPUTS

let P: Record<ProductKey, MfgProduct>

interface StockRow {
  organizationId: string
  warehouseId: string
  name: string
  quantity: number
  unit: string
  unitCost: number | null
  lot?: string | null
  remnant?: boolean
  isManufactured?: boolean
  sourceWorkOrderId?: string
}

const VEHICLE = { id: "v1", label: "Saeed Al-Harthi — truck 4471", driverName: "Saeed Al-Harthi", plate: "4471" }
const FILE = { url: "https://files.test/doc.pdf", name: "doc.pdf" }

function stockRow(warehouseId: string, rowId: string, m: Material, quantity: number, lot: string | null): void {
  seed(`warehouses/${warehouseId}/inventoryItems/${rowId}`, { organizationId: ORG, warehouseId, name: m.itemName, quantity, unit: m.unit, unitCost: m.unitCost, lot })
}

function seedWorld(): void {
  for (const { id, ...station } of STATIONS) seed(`manufacturingDepartments/${id}`, { ...station })
  seed(`manufacturingSettings/${ORG}`, { organizationId: ORG, ...DEFAULT_MFG_SETTINGS })
  seed("warehouses/wh-main", { organizationId: ORG, name: "Main store", kind: "central" })
  seed("warehouses/wh-fg", { organizationId: ORG, name: "Finished goods", kind: "central" })
  stockRow("wh-main", "row-crm-4471", CREMA, 96, "BLK-4471")
  stockRow("wh-main", "row-crm-4479", CREMA, 52, "BLK-4479")
  stockRow("wh-main", "row-sta-7712", STATUARIO, 22, "BLK-7712")
  stockRow("wh-main", "row-bsc-2210", BEIGE, 260, "BLK-2210")
  stockRow("wh-main", "row-bsc-2244", BEIGE, 160, "BLK-2244")
  stockRow("wh-main", "row-qtz-88", QUARTZ, 38, "LOT-QZ88")
}

/** The yearly WO sequence continues after the prototype's imported numbers. */
function seedCounter(last: number): void {
  seed(`mfgCounters/${ORG}__WO__0`, { organizationId: ORG, type: "WO", year: 0, last })
  seed(`mfgCounters/${ORG}__WO__2026`, { organizationId: ORG, type: "WO", year: 2026, last })
}

function seedSalesOrder(id: string, orderNumber: number, depositPaid: boolean): SalesOrder {
  seed(`salesOrders/${id}`, {
    organizationId: ORG,
    orderNumber,
    type: "standard",
    status: depositPaid ? "running" : "awaiting_deposit",
    contactId: "cl3",
    contactName: "Al-Ofuq Contracting",
    projectId: null,
    projectName: null,
    quotationId: "q44",
    quotationNumber: "Q-9RT2KD",
    frameworkId: null,
    frameworkCap: null,
    frameworkValidUntil: null,
    payment: { kind: "deposit", depositPercent: 40, depositPaid },
    promiseDate: "2026-10-07",
    vatPercent: 15,
    lines: [{ name: P.skirting.name, unit: "m", quantity: 400, unitPrice: 92, unitCost: null }],
    measurementRecordedAt: null,
    approvalStatus: "not_required",
    createdByUserId: A.reem.id,
    createdByUserName: A.reem.name,
    closedAt: null,
  })
  return readDoc<SalesOrder>(`salesOrders/${id}`)!
}

// ---------------------------------------------------------------------------
// Reading the world back
// ---------------------------------------------------------------------------

const departments = (): MfgDepartment[] => listCollection<MfgDepartment>("manufacturingDepartments")
const settings = (): MfgSettings => normalizeMfgSettings(readDoc<MfgSettings>(`manufacturingSettings/${ORG}`))
const stationOf = (id: string): MfgDepartment => departments().find((d) => d.id === id)!

interface Loaded {
  order: WorkOrderV2
  product: MfgProduct
  departments: MfgDepartment[]
  notes: DeliveryNote[]
  noteSlices: MfgNoteSlice[]
  salesOrder: SalesOrder | null
  calc: OrderCalc
}

function load(orderId: string): Loaded {
  const order = readDoc<WorkOrderV2>(`workOrders/${orderId}`)
  if (!order) throw new Error(`no order ${orderId}`)
  const product = readDoc<MfgProduct>(`mfgProducts/${order.productId}`)!
  const depts = departments()
  const notes = listCollection<DeliveryNote>("deliveryNotes").filter((n) => n.source.workOrderId === orderId)
  const noteSlices = notes.map(toNoteSlice)
  const salesOrder = order.salesOrderId ? readDoc<SalesOrder>(`salesOrders/${order.salesOrderId}`) : null
  return { order, product, departments: depts, notes, noteSlices, salesOrder, calc: calcOf(order, product, depts, noteSlices, salesOrder) }
}

const orderIds = (): string[] => listCollection<WorkOrderV2>("workOrders").filter(isV2Order).map((o) => o.id)
const worldCalcs = (): OrderCalc[] => orderIds().map((id) => load(id).calc)

function stockIndex(quarantined: Set<string> = new Set()): StockIndex {
  const onHand = new Map<string, number>()
  const lots: StockIndex["lots"] = []
  for (const r of listCollectionGroup<StockRow>("inventoryItems")) {
    if (r.isManufactured || (r.lot && quarantined.has(r.lot))) continue
    onHand.set(itemKey(r.name), round2((onHand.get(itemKey(r.name)) || 0) + r.quantity))
    if (r.lot) lots.push({ itemName: r.name, lot: r.lot, quantity: r.quantity, remnant: !!r.remnant })
  }
  return { onHand, lots }
}

const allocate = (): Allocation => allocateStock(worldCalcs(), stockIndex())
const ctx = (alloc: Allocation | null = allocate()): CandidateContext => ({ settings: settings(), alloc, today: TODAY, nowMs: Date.now() })

function lostHours(): LostHours {
  const lost = new Map<string, number>()
  for (const s of listCollection<MfgStop>("mfgStops")) if (s.date === TODAY) lost.set(s.departmentId, round2((lost.get(s.departmentId) || 0) + s.hours))
  return lost
}

const stockRows = (warehouseId: string) => listCollection<StockRow>(`warehouses/${warehouseId}/inventoryItems`).map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, unitCost: r.unitCost, lot: r.lot ?? null }))

/** The Block-notice form's rule: live orders signed off on, consenting to, or drawing from the block. */
function liveOrdersOnLot(lot: string): string[] {
  return worldCalcs()
    .filter((c) => c.live && (c.slice.slabApproval?.lot === lot || c.slice.slabApproval?.alternativeLot?.lot === lot || c.slice.materials.some((m) => m.lot === lot && m.state !== "received")))
    .map((c) => c.slice.id)
    .sort()
}

// ---------------------------------------------------------------------------
// Invariants after every event (BD-02)
// ---------------------------------------------------------------------------

function invariantProblems(orderId: string, alloc: Allocation): string[] {
  const w = load(orderId)
  const c = w.calc
  const s = settings()
  const ref = w.order.docNumber || orderId
  const out: string[] = []
  const gap = conservationGap(c)
  if (Math.abs(gap) > 1e-6) out.push(`${ref}: conservation gap ${gap}`)
  if (c.released && !c.cancelled) {
    // quantity entering the route = done-out + scrapped + in-station (the engine's placement)
    const entered = round2(c.slice.quantity + c.slice.remade)
    const placed = round2(c.wip + c.rejected + c.scrapAll + c.toClose + c.ready + c.shipped + c.delivered + c.broken)
    if (Math.abs(entered - placed) > 1e-6) out.push(`${ref}: ${entered} entered, ${placed} placed`)
    c.route.forEach((r, i) => {
      const p = c.slice.progress[i]
      const raw = round2(c.inAt[i] - c.done[i] - (p?.rejected || 0) - c.scrapAt[i] - (p?.back || 0))
      if (raw < -1e-6) out.push(`${ref}: ${r.departmentId} holds ${raw} before clamping`)
    })
  }
  if (c.closed > c.finished + 1e-6) out.push(`${ref}: closed ${c.closed} > finished ${c.finished}`)
  const last = c.route[c.lastI]
  if (last && c.slice.closures && isQcStation(c.stations[c.lastI] || { name: last.departmentName })) {
    const released = round2(c.slice.qcReleases.reduce((a, x) => a + x.quantity, 0))
    if (c.closed > released + 1e-6) out.push(`${ref}: closed ${c.closed} beyond the quality release ${released}`)
    if (released > c.finished + 1e-6) out.push(`${ref}: released ${released} > finished ${c.finished}`)
  }
  if (c.out > c.closed + 1e-6) out.push(`${ref}: shipped ${c.out} beyond closed ${c.closed}`)
  const shippedQ = Number(w.order.shippedQuantity) || 0
  if (Math.abs(shippedQ - c.out) > 1e-6) out.push(`${ref}: shippedQuantity ${shippedQ} ≠ notes ${c.out}`)
  const cost = orderCost(c, w.departments, s)
  if (!Number.isFinite(cost.wip) || cost.wip < 0) out.push(`${ref}: WIP ${cost.wip}`)
  if (w.order.status === "done" && !c.done_) out.push(`${ref}: stored done, computed ${c.stage}`)
  if ((w.order.status === "cancelled") !== c.cancelled) out.push(`${ref}: status ${w.order.status} vs cancelled ${c.cancelled}`)
  for (const x of candidates(c, ctx(alloc))) {
    if (EXTERNAL_KEYS.has(x.key) && x.owner.kind !== "external") out.push(`${ref}: leak — ${x.key} owned by ${x.owner.kind}`)
    if (x.owner.kind === "external" && MFG_ROLES.some((r) => ownsCandidate(x, r, w.departments, s))) out.push(`${ref}: leak — ${x.key} pressable in Manufacturing`)
  }
  return out
}

function worldProblems(): string[] {
  const alloc = allocate()
  const problems = orderIds().flatMap((id) => invariantProblems(id, alloc))
  for (const r of listCollectionGroup<StockRow>("inventoryItems")) if (r.quantity < -1e-9) problems.push(`stock ${r.path} is ${r.quantity}`)
  return problems
}

function expectWorldInvariants(after: string): void {
  expect({ after, problems: worldProblems() }).toEqual({ after, problems: [] })
}

/** Run a write and check the whole world afterwards. */
// ---------------------------------------------------------------------------
// Rules conformance — every act writes only the work-order fields firestore.rules
// grants the role that performs it (a role scoped by `woChanged().hasOnly`)
// ---------------------------------------------------------------------------

type RuleRole = "work" | "qc" | "cost" | "warehouses" | "owner_module" | "procurement"

const RULES_SRC = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8")

/** The field list of the workOrders update branch that follows `anchor`. */
function ruleFields(anchor: RegExp): Set<string> {
  const block = RULES_SRC.slice(RULES_SRC.indexOf("match /workOrders/{orderId}"))
  const m = block.match(new RegExp(`${anchor.source}[\\s\\S]*?woChanged\\(\\)\\.hasOnly\\(\\[([^\\]]*)\\]\\)`))
  if (!m) throw new Error(`rules branch not found: ${anchor}`)
  return new Set(Array.from(m[1].matchAll(/'([^']+)'/g), (x) => x[1]))
}

const RULE_FIELDS: Record<RuleRole, Set<string>> = {
  work: ruleFields(/hasOrgPermission\('manufacturing\.work'\)/),
  qc: ruleFields(/hasOrgPermission\('manufacturing\.qc'\)/),
  cost: ruleFields(/hasOrgPermission\('manufacturing\.cost'\)/),
  warehouses: ruleFields(/hasOrgPermission\('warehouses\.receive'\)\)/),
  owner_module: ruleFields(/hasProjectPermission\(resource\.data\.projectId, 'projects\.edit'\)\)\)/),
  procurement: ruleFields(/hasOrgPermission\('rfq\.create'\)/),
}
/** Branches that may only move the status between open and done. */
const STATUS_BOUNDED: RuleRole[] = ["cost", "warehouses", "owner_module"]

/** Who performs each act outside the workshop manager (who is unrestricted).
 * Several roles = any one of them may perform it, so each must be allowed. */
const ACT_ROLES: Record<string, RuleRole[][]> = {
  recordOutput: [["work"], ["qc"]], // a station lead, or Quality at QC & packing — either branch must hold
  requestStationMaterials: [["work"]],
  confirmMaterialReceipt: [["work"]],
  submitDrawing: [["work"]],
  qcDecide: [["qc"]],
  signOffSlab: [["qc"]],
  clarifyScrap: [["qc"]],
  reviewScrap: [["cost"]],
  reviewVariance: [["cost"]],
  issueWithdrawal: [["warehouses"]],
  receiveRemnant: [["warehouses"]],
  receiveDeliveryNote: [["warehouses", "owner_module"]],
  recordDrawingResult: [["owner_module"]],
  requestOrderChange: [["owner_module"]],
  markPurchaseArrived: [["procurement"]],
}

function rulesViolation(roles: RuleRole[], changed: string[], status: unknown): string | null {
  for (const role of roles) {
    const extra = changed.filter((k) => !RULE_FIELDS[role].has(k))
    if (extra.length) return `${role} may not write ${extra.join(", ")}`
    if (STATUS_BOUNDED.includes(role) && changed.includes("status") && !["open", "done"].includes(String(status))) return `${role} may not set status ${String(status)}`
  }
  return null
}

function changedWorkOrderKeys(before: Map<string, Record<string, unknown>>): Array<{ id: string; keys: string[]; status: unknown }> {
  const out: Array<{ id: string; keys: string[]; status: unknown }> = []
  for (const after of listCollection<Record<string, unknown>>("workOrders")) {
    const prev = before.get(after.id)
    if (!prev) continue // a create is the manager's act
    const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(after)])).filter((k) => k !== "id" && JSON.stringify(prev[k]) !== JSON.stringify(after[k]))
    if (keys.length) out.push({ id: after.id, keys, status: after.status })
  }
  return out
}

/** Acts whose work-order writes were checked against the rules — each mapped act must be. */
const RULES_CHECKED = new Set<string>()

async function act<T>(label: string, write: Promise<T>): Promise<T> {
  const name = label.split(/[\s[(]/)[0]
  const before = new Map(listCollection<Record<string, unknown>>("workOrders").map((o) => [o.id, o]))
  const result = await write
  const roleSets = ACT_ROLES[name]
  if (roleSets) {
    for (const change of changedWorkOrderKeys(before)) {
      RULES_CHECKED.add(name)
      // recordOutput: the lead's branch or Quality's — the one matching the station must hold.
      const verdicts = roleSets.map((roles) => rulesViolation(roles, change.keys, change.status))
      const ok = name === "recordOutput" ? verdicts.some((v) => v === null) : verdicts.every((v) => v === null)
      expect({ act: label, rules: ok ? null : verdicts.filter(Boolean).join(" | ") }).toEqual({ act: label, rules: null })
    }
  }
  expectWorldInvariants(label)
  return result
}

/** The write is refused with exactly this code and writes nothing. */
async function refused(label: string, write: () => Promise<unknown>, code: string): Promise<void> {
  const before = dumpDb()
  await expect(write()).rejects.toThrow(new RegExp(`^${code}$`))
  expect({ refused: label, unchanged: dumpDb() === before }).toEqual({ refused: label, unchanged: true })
  expectWorldInvariants(`${label} (refused)`)
}

// ---------------------------------------------------------------------------
// Acts — each one the real write a screen would call
// ---------------------------------------------------------------------------

async function createProduct(key: ProductKey): Promise<MfgProduct> {
  const id = await createMfgProduct(db, { organizationId: ORG, product: PRODUCT_INPUTS[key], actor: A.badr })
  return readDoc<MfgProduct>(`mfgProducts/${id}`)!
}

async function stockOrder(product: MfgProduct, quantity: number, neededBy = "2026-10-04"): Promise<string> {
  const { id } = await act("createStockWorkOrder", createStockWorkOrder(db, { organizationId: ORG, product, quantity, neededBy, actor: A.badr }))
  return id
}

/** Procurement routes a project need (T1), the manager makes all of it (T2). */
async function projectOrder(product: MfgProduct, quantity: number, neededBy = "2026-09-30"): Promise<string> {
  const requestId = await act(
    "routeNeedToManufacturing",
    routeNeedToManufacturing(db, {
      organizationId: ORG,
      projectId: "p3",
      projectName: "Al-Rawda Tower",
      purchaseRequestRef: "PR-2026/071",
      pmRequestRef: "PM-2026/052",
      costItemName: "Stone works",
      neededBy,
      lines: [{ productId: product.id, itemName: product.name, unit: product.unit, quantity }],
      note: null,
      actor: A.huda,
    })
  )
  const request = readDoc<ManufacturingRequest>(`manufacturingRequests/${requestId}`)!
  const { workOrderIds } = await act("answerMakeRequest", answerMakeRequest(db, { request, lines: [{ line: request.lines![0], product, makeQuantity: quantity }], note: null, actor: A.badr }))
  return workOrderIds[0]
}

/** Sales asks (T1) for a sales order's line, the manager makes it (T2). */
async function clientOrder(salesOrder: SalesOrder, product: MfgProduct, quantity: number): Promise<string> {
  const requestId = await act("createManufacturingRequest", createManufacturingRequest(db, { order: salesOrder, itemName: product.name, unit: product.unit, quantity, productId: product.id, actor: A.reem }))
  const request = readDoc<ManufacturingRequest>(`manufacturingRequests/${requestId}`)!
  const { workOrderIds } = await act("answerMakeRequest", answerMakeRequest(db, { request, lines: [{ line: request.lines![0], product, makeQuantity: quantity }], note: null, actor: A.badr }))
  return workOrderIds[0]
}

const releaseInput = (orderId: string) => ({ orderId, product: load(orderId).product, departments: departments(), actor: A.badr })
const release = (orderId: string) => act("releaseOrder", releaseOrder(db, releaseInput(orderId)))

const surveyInput = (orderId: string, measured: number | null, sketch: { url: string; name: string } | null = FILE) => ({ orderId, date: TODAY, measuredQuantity: measured, note: null, sketch, actor: A.sami })
const survey = (orderId: string) => act("recordSurvey", recordSurvey(db, surveyInput(orderId, load(orderId).calc.slice.quantity)))

function submitInput(orderId: string, approverOrg: ApproverOrg, hours: number | null = null) {
  const w = load(orderId)
  return { orderId, product: w.product, departments: w.departments, approverOrg, note: null, hours, file: FILE, cutList: [], actor: A.badr }
}

async function approveDrawing(orderId: string, approverOrg: ApproverOrg = "technical_office"): Promise<void> {
  await act("submitDrawing", submitDrawing(db, submitInput(orderId, approverOrg, 3)))
  await act("recordDrawingResult A", recordDrawingResult(db, { orderId, code: "A", notes: null, approverName: "Technical office", evidence: FILE, actor: A.pm }))
}

function slabNeed(orderId: string): number {
  const w = load(orderId)
  const main = mainMaterial(w.product)!
  return roundNeed(main.unit, main.qtyPerUnit * wasteFactor(w.product) * w.calc.slice.quantity)
}

function slabInput(orderId: string, lot: string, quantity = slabNeed(orderId)) {
  const w = load(orderId)
  const main = mainMaterial(w.product)!
  return { orderId, product: w.product, lot, quantity, blockFree: lotFree(stockIndex(), main.itemName, lot, worldCalcs(), orderId), slabNumbers: "1-6", photosAttached: true, form: FILE, note: null, date: TODAY, actor: A.lama }
}
const signSlab = (orderId: string, lot: string) => act("signOffSlab", signOffSlab(db, slabInput(orderId, lot)))

/** The lead requests what the station still needs (T10), Inventory issues it (T11), the lead confirms (T12). */
async function supplyStation(orderId: string, index: number, lot: string | null, lead: Actor = A.sami): Promise<string> {
  const { calc } = load(orderId)
  const departmentId = calc.route[index].departmentId
  const lines = materialNeed(calc, index)
    .map((x) => ({ itemName: x.itemName, unit: x.unit, quantity: r1(x.qty - materialReceived(calc.slice, departmentId, x.itemName) - materialOpen(calc.slice, departmentId, x.itemName)), lot: x.lotted ? lot : null }))
    .filter((l) => l.quantity > 0)
  const requestNumber = await act("requestStationMaterials", requestStationMaterials(db, { orderId, organizationId: ORG, departmentId, lines, consentNote: null, actor: lead }))
  await act("issueWithdrawal", issueWithdrawal(db, { orderId, requestNumber, warehouseId: "wh-main", stockRows: stockRows("wh-main"), actor: A.store }))
  await act("confirmMaterialReceipt", confirmMaterialReceipt(db, { orderId, requestNumber, note: null, actor: lead, organizationId: ORG }))
  return requestNumber
}

interface OutputOpts {
  rejected?: number
  defect?: DefectKind
  cause?: string
  hours?: number
  remnantArea?: number
  actor?: Actor
}

function outputInput(orderId: string, index: number, good: number, o: OutputOpts = {}): OutputInput {
  const w = load(orderId)
  const qc = isQcStation(w.calc.stations[index])
  return {
    orderId,
    product: w.product,
    departments: w.departments,
    settings: settings(),
    index,
    good,
    rejected: o.rejected ?? 0,
    defect: o.defect ?? null,
    cause: o.cause ?? null,
    photoAttached: (o.rejected ?? 0) > 0,
    hours: o.hours ?? null,
    remnantArea: o.remnantArea ?? null,
    finalInspection: qc,
    photosBeforePacking: qc,
    actorIsQc: qc,
    actor: o.actor ?? LEAD_OF[w.calc.route[index].departmentId] ?? A.badr,
  }
}
const output = (orderId: string, index: number, good: number, o: OutputOpts = {}) => act(`recordOutput[${index}] ${good}`, recordOutput(db, outputInput(orderId, index, good, o)))

function qcInput(orderId: string, d: Pick<QcDecisionInput, "index" | "kind" | "quantity" | "defect"> & Partial<QcDecisionInput>): QcDecisionInput {
  const w = load(orderId)
  return { orderId, product: w.product, departments: w.departments, settings: settings(), cause: "unknown", toIndex: null, consent: null, remnantArea: null, reason: "", actor: A.lama, ...d }
}

function reviewInput(orderId: string, scrapId: string, d: { decision: "approve" | "return"; canApproveAny: boolean; actor: Actor; question?: string | null }) {
  const w = load(orderId)
  return { orderId, scrapId, decision: d.decision, classification: "abnormal" as const, bearer: "workshop" as const, question: d.question ?? null, settings: settings(), canApproveAny: d.canApproveAny, actor: d.actor, organizationId: ORG, product: w.product, departments: w.departments, notes: w.noteSlices }
}

function remakeInput(orderId: string, d: { source: "scrap" | "breakage"; kind: "remake" | "shortfall"; quantity: number; alternativeLot?: { lot: string; consent: string } | null }) {
  const w = load(orderId)
  return { orderId, product: w.product, departments: w.departments, source: d.source, kind: d.kind, quantity: d.quantity, reason: "Decided at the morning review", alternativeLot: d.alternativeLot ?? null, notes: w.noteSlices, actor: A.badr }
}

function closeInput(orderId: string, quantity: number) {
  const w = load(orderId)
  return { orderId, product: w.product, departments: w.departments, settings: settings(), notes: w.noteSlices, quantity, actor: A.badr }
}
const close = (orderId: string, quantity: number) => act(`closeProduction ${quantity}`, closeProduction(db, closeInput(orderId, quantity)))

function noteInput(orderId: string, quantity: number, notes: MfgNoteSlice[] = load(orderId).noteSlices) {
  const w = load(orderId)
  return {
    orderId,
    organizationId: ORG,
    product: w.product,
    departments: w.departments,
    settings: settings(),
    notes,
    quantity,
    destination: { warehouseId: "wh-fg", warehouseName: "Finished goods", kind: "central" as const, projectId: null },
    pieces: null,
    crates: 2,
    vehicle: VEHICLE,
    note: null,
    actor: A.badr,
  }
}
const deliver = (orderId: string, quantity: number) => act(`issueDeliveryNote ${quantity}`, issueDeliveryNote(db, noteInput(orderId, quantity)))

const receiveInput = (noteId: string, broken = 0) => ({ note: readDoc<DeliveryNote>(`deliveryNotes/${noteId}`)!, brokenQuantity: broken, receivedNote: null, actor: A.store })
const receive = (noteId: string, broken = 0) => act(`receiveDeliveryNote broken ${broken}`, receiveDeliveryNote(db, receiveInput(noteId, broken)))

/** A skirting order from creation through every station to production closed. */
async function stockOrderClosed(quantity: number): Promise<string> {
  const id = await stockOrder(P.skirting, quantity)
  await release(id)
  await supplyStation(id, 0, "BLK-2210")
  for (let i = 0; i < 4; i++) await output(id, i, quantity)
  await close(id, quantity)
  return id
}

/** A stair order through survey, release, drawing A and slab sign-off (and, by default, its slab received at the saw). */
async function preparedStair(quantity: number, lot: string, withMaterials = true): Promise<string> {
  const id = await projectOrder(P.stair, quantity)
  await survey(id)
  await release(id)
  await approveDrawing(id)
  await signSlab(id, lot)
  if (withMaterials) await supplyStation(id, 2, lot)
  return id
}

const sum = (xs: number[]) => round2(xs.reduce((a, x) => a + x, 0))

// ---------------------------------------------------------------------------

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
})
afterAll(() => {
  jest.useRealTimers()
})

beforeEach(async () => {
  resetFakeDb()
  jest.clearAllMocks()
  jest.setSystemTime(NOW)
  seedWorld()
  P = {
    skirting: await createProduct("skirting"),
    stair: await createProduct("stair"),
    cladding: await createProduct("cladding"),
    vanity: await createProduct("vanity"),
  }
})

// ===========================================================================
// 0 · The in-memory Firestore keeps Firestore's promises
// ===========================================================================

describe("0 · the in-memory Firestore", () => {
  const fs = firestoreModule

  it("transactions read before they write, and a throw writes nothing", async () => {
    seed("things/a", { n: 1 })
    const ref = fs.doc(db, "things", "a")
    await expect(
      fs.runTransaction(db, async (tx) => {
        await tx.get(ref)
        tx.update(ref, { n: 2 })
        await tx.get(ref)
      })
    ).rejects.toThrow(/reads to be executed before all writes/)
    await expect(
      fs.runTransaction(db, async (tx) => {
        tx.update(ref, { n: 3 })
        throw new Error("changed my mind")
      })
    ).rejects.toThrow("changed my mind")
    expect(readDoc<{ n: number }>("things/a")).toEqual({ id: "a", n: 1 })
  })

  it("applies dotted paths, increments, merges and server timestamps; refuses undefined and missing documents", async () => {
    seed("things/a", { payment: { kind: "deposit", depositPaid: false }, quantity: 10 })
    const ref = fs.doc(db, "things/a")
    await fs.updateDoc(ref, { "payment.depositPaid": true, quantity: fs.increment(-2.5), at: fs.serverTimestamp() })
    await fs.setDoc(ref, { payment: { depositPercent: 40 } }, { merge: true })
    expect(readDoc("things/a")).toEqual({ id: "a", payment: { kind: "deposit", depositPaid: true, depositPercent: 40 }, quantity: 7.5, at: NOW.toISOString() })
    await expect(fs.updateDoc(ref, { note: undefined })).rejects.toThrow(/Unsupported field value: undefined/)
    await expect(fs.updateDoc(fs.doc(db, "things/missing"), { n: 1 })).rejects.toThrow(/No document to update/)
    const batch = fs.writeBatch(db)
    batch.set(fs.doc(fs.collection(db, "things")), { n: 1 })
    batch.update(fs.doc(db, "things/missing"), { n: 1 })
    await expect(batch.commit()).rejects.toThrow(/No document to update/)
    expect(listCollection("things")).toHaveLength(1)
    const q = await fs.getDocs(fs.query(fs.collection(db, "things"), fs.where("payment.kind", "==", "deposit")))
    expect(q.docs.map((d) => d.id)).toEqual(["a"])
  })
})

// ===========================================================================
// 1 · Tour 1 — the down-payment gate
// ===========================================================================

describe("1 · the down-payment gate (tour 1)", () => {
  it("WO-2026/056 waits for Finance with no button for the manager; the deposit opens release and reserves the need", async () => {
    seedCounter(55)
    const so = seedSalesOrder("so-131", 131, false)
    const orderId = await clientOrder(so, P.skirting, 400)

    let w = load(orderId)
    expect(w.order).toMatchObject({ docNumber: "WO-2026/056", sourceKind: "client", salesOrderId: "so-131", quantity: 400, releasedAt: null })
    expect(readDoc<ManufacturingRequest>(`manufacturingRequests/${w.order.mfgRequestId}`)).toMatchObject({ requestNumber: "MR-2026/001", sourceKind: "sales", status: "accepted", neededBy: "2026-10-05" }) // two days before the 7 Oct promise (Sales PRD SO-16)
    expect(w.calc.stage).toBe("pay")
    expect(releaseBlocks(w.calc).map((b) => b.key)).toEqual(["down_payment"])
    const cands = candidates(w.calc, ctx())
    expect(cands[0]).toMatchObject({ key: "down_payment", owner: { kind: "external", module: "finance" }, pctPercent: 40 })
    expect(cands.some((c) => c.key === "release")).toBe(false)
    expect(nextStep(cands, MANAGER, w.departments, settings())).toBeNull()
    expect(allocate().reserved.has(orderId)).toBe(false)

    await refused("release before the deposit", () => releaseOrder(db, releaseInput(orderId)), "blocked")

    // Finance finds the deposit (T4)
    await act("markDepositPaid", markDepositPaid(db, so))
    expect(readDoc<SalesOrder>("salesOrders/so-131")).toMatchObject({ status: "running", payment: { kind: "deposit", depositPercent: 40, depositPaid: true, depositPaidAt: NOW.toISOString() } })
    w = load(orderId)
    expect(w.calc.stage).toBe("wait")
    expect(releaseBlocks(w.calc)).toEqual([])
    expect(nextStep(candidates(w.calc, ctx()), MANAGER, w.departments, settings())).toMatchObject({ key: "release" })

    await release(orderId)
    w = load(orderId)
    expect(w.order).toMatchObject({ releasedAt: NOW.toISOString(), releasedByName: A.badr.name })
    expect(w.calc.stage).toBe("prod")
    const alloc = allocate()
    // 400 m × 0.12 m² × 1.15 planned waste = 55.2 m² of Beige Sahel reserved for it
    expect(alloc.reserved.get(orderId)?.get(itemKey(BEIGE.itemName))).toBe(55.2)
    expect(alloc.free.get(itemKey(BEIGE.itemName))).toBe(364.8)
    expect(shortages(w.calc, alloc)).toEqual([])

    await refused("releasing twice", () => releaseOrder(db, releaseInput(orderId)), "already_released")
  })
})

// ===========================================================================
// 2 · Tour 2 — a full stock-order cycle
// ===========================================================================

describe("2 · a full stock-order cycle (tour 2)", () => {
  it("WO-2026/055 skirting to stock: release → slab issued and received → three stations → QC release → close → note → receipt", async () => {
    seedCounter(54)
    const orderId = await stockOrder(P.skirting, 180)
    let w = load(orderId)
    expect(w.order).toMatchObject({ docNumber: "WO-2026/055", orderNumber: 55, sourceKind: "stock", status: "open" })
    expect(w.calc.stage).toBe("wait")
    await release(orderId)

    // Abu Sami: the saw needs the slab
    w = load(orderId)
    expect(materialNeed(w.calc, 0)).toEqual([expect.objectContaining({ itemName: BEIGE.itemName, qty: 24.9 })])
    expect(candidates(w.calc, ctx()).find((c) => c.key === "request_materials")).toMatchObject({ index: 0, owner: { kind: "station", departmentId: "s7" } })
    await refused("output before any slab arrived", () => recordOutput(db, outputInput(orderId, 0, 180)), "beyond_materials")

    const wr = await act(
      "requestStationMaterials",
      requestStationMaterials(db, { orderId, organizationId: ORG, departmentId: "s7", lines: [{ itemName: BEIGE.itemName, unit: "m²", quantity: 24.9, lot: "BLK-2210" }], consentNote: null, actor: A.sami })
    )
    expect(wr).toBe("WR-2026/001")
    w = load(orderId)
    expect(candidates(w.calc, ctx()).find((c) => c.key === "issue_wait")).toMatchObject({ owner: { kind: "external", module: "inventory" }, requestNumber: wr })
    // the open withdrawal holds its quantity; nothing else is reserved twice
    let alloc = allocate()
    expect(alloc.free.get(itemKey(BEIGE.itemName))).toBe(395.1)
    expect(alloc.reserved.get(orderId)?.get(itemKey(BEIGE.itemName)) ?? 0).toBe(0)

    // Inventory issues: stock leaves the shelf, cost snapshotted — no value on the order yet
    await act("issueWithdrawal", issueWithdrawal(db, { orderId, requestNumber: wr, warehouseId: "wh-main", stockRows: stockRows("wh-main"), actor: A.store }))
    expect(readDoc<StockRow>("warehouses/wh-main/inventoryItems/row-bsc-2210")!.quantity).toBeCloseTo(235.1, 9)
    w = load(orderId)
    expect(w.order.materials).toEqual([expect.objectContaining({ state: "released", unitCost: 245, warehouseId: "wh-main", lot: "BLK-2210", releasedByName: A.store.name })])
    expect(orderCost(w.calc, w.departments, settings()).materials).toBe(0)
    expect(candidates(w.calc, ctx()).find((c) => c.key === "confirm_receipt")).toMatchObject({ owner: { kind: "station", departmentId: "s7" }, requestNumber: wr })
    expect(onMfgMaterialsReceived).not.toHaveBeenCalled()

    // The station confirms: here the value lands (MAT-02)
    await act("confirmMaterialReceipt", confirmMaterialReceipt(db, { orderId, requestNumber: wr, note: null, actor: A.sami, organizationId: ORG }))
    w = load(orderId)
    expect(w.order.materialCost).toBe(6100.5)
    expect(materialState(w.calc, 0)).toBe("complete")
    expect(onMfgMaterialsReceived).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: ORG, userId: A.sami.id }), expect.objectContaining({ workOrderId: orderId, requestNumber: wr, value: 6100.5 }))
    alloc = allocate()
    expect(alloc.free.get(itemKey(BEIGE.itemName))).toBe(395.1)

    // Each station records and hands over (T13); consumables come from custody
    await output(orderId, 0, 180, { hours: 10.8 })
    expect(load(orderId).calc.pend).toEqual([0, 180, 0, 0])
    await output(orderId, 1, 180, { hours: 12.6 })
    await output(orderId, 2, 180, { hours: 9 })
    w = load(orderId)
    expect(w.calc.pend).toEqual([0, 0, 0, 180])
    expect(candidates(w.calc, ctx()).find((c) => c.key === "qc_release")).toMatchObject({ owner: { kind: "qc" }, quantity: 180 })

    // Nothing closes before Quality releases it (FL-09)
    await refused("close before the quality release", () => closeProduction(db, closeInput(orderId, 180)), "more_than_released")
    await refused("a station lead recording at QC & packing", () => recordOutput(db, { ...outputInput(orderId, 3, 180), actorIsQc: false, actor: A.faisal }), "qc_only")
    await refused("a release without the final inspection", () => recordOutput(db, { ...outputInput(orderId, 3, 180), finalInspection: false }), "final_inspection_required")
    await output(orderId, 3, 180, { hours: 3.6 })
    w = load(orderId)
    expect(w.order.qcReleases).toEqual([expect.objectContaining({ quantity: 180, by: A.lama.name, photosAttached: true })])
    expect(w.calc).toMatchObject({ stage: "close", toClose: 180 })

    // Close production — the final close freezes the actual cost (T17)
    const { final } = await close(orderId, 180)
    expect(final).toBe(true)
    w = load(orderId)
    const cost = orderCost(w.calc, w.departments, settings())
    // slab 6,100.5 + custody 523.8 + labour 2,196 + overhead 36 h × 32 = 9,972.3
    expect(cost).toMatchObject({ materials: 6100.5, custody: 523.8, labour: 2196, overhead: 1152, total: 9972.3, frozen: true })
    expect(w.order.frozenCost).toMatchObject({ cost: 9972.3, by: A.badr.name })
    expect(w.calc.stage).toBe("ready")

    // The delivery note (T18) — no entry before receipt
    const { noteId, noteNumber } = await deliver(orderId, 180)
    expect(noteNumber).toBe("DN-2026/001")
    w = load(orderId)
    const unitCost = round2(9972.3 / 180)
    expect(readDoc<DeliveryNote>(`deliveryNotes/${noteId}`)).toMatchObject({
      status: "in_transit",
      item: { name: P.skirting.name, quantity: 180, unit: "m", unitCost },
      toWarehouseId: "wh-fg",
      driverName: VEHICLE.driverName,
      vehicleId: VEHICLE.id,
      source: { kind: "manufacturing", workOrderId: orderId, workOrderDocNumber: "WO-2026/055" },
    })
    expect(w.order.shippedQuantity).toBe(180)
    expect(w.calc.stage).toBe("transit")
    expect(candidates(w.calc, ctx()).find((c) => c.key === "receipt_wait")).toMatchObject({ owner: { kind: "external", module: "inventory" }, noteNumber, destination: "warehouse" })
    expect(listCollection("warehouses/wh-fg/inventoryItems")).toEqual([])
    expect(onWorkOrderDelivered).not.toHaveBeenCalled()

    // Inventory receives (T19): the order closes, finished stock lands with its cost
    await receive(noteId)
    w = load(orderId)
    expect(w.order.status).toBe("done")
    expect(w.calc).toMatchObject({ done_: true, stage: "done", delivered: 180 })
    expect(candidates(w.calc, ctx())).toEqual([])
    expect(listCollection<StockRow>("warehouses/wh-fg/inventoryItems")).toEqual([
      expect.objectContaining({ name: P.skirting.name, quantity: 180, unit: "m", unitCost, isManufactured: true, sourceWorkOrderId: orderId }),
    ])
    expect(onWorkOrderDelivered).toHaveBeenCalledWith(db, expect.objectContaining({ userId: A.store.id }), expect.objectContaining({ deliveryNoteId: noteId, value: round2(unitCost * 180), toProject: false }))
    expect(orderCost(w.calc, w.departments, settings()).wip).toBe(0)

    await refused("receiving the same note twice", () => receiveDeliveryNote(db, receiveInput(noteId)), "not_in_transit")
    await refused("recording on a done order", () => recordOutput(db, outputInput(orderId, 0, 1)), "order_closed")
  })

  it("the close guard holds even when QC & packing progress was written without a quality release", async () => {
    const orderId = await stockOrder(P.skirting, 10)
    await release(orderId)
    await supplyStation(orderId, 0, "BLK-2210")
    for (let i = 0; i < 3; i++) await output(orderId, i, 10)
    // an older client writes the QC station's output directly, with no release record
    const stored = readDoc<WorkOrderV2>(`workOrders/${orderId}`)!
    const { id: _id, ...data } = stored
    seed(`workOrders/${orderId}`, { ...data, progress: stored.progress!.map((p, i) => (i === 3 ? { ...p, done: 10 } : p)) })
    expect(load(orderId).calc.toClose).toBe(10)
    await expect(closeProduction(db, closeInput(orderId, 10))).rejects.toThrow(/^not_qc_released$/)
    expect(load(orderId).order.closures).toEqual([])
  })
})

// ===========================================================================
// 3 · Tour 3 — a shortage and an honest date
// ===========================================================================

describe("3 · shortage → purchase → arrival → stop (tour 3)", () => {
  it("WO-2026/043 Statuario cladding has no date while short; the purchase arrives, a new block is signed; a stop at polishing moves the dates", async () => {
    seedCounter(42)
    const cladId = await projectOrder(P.cladding, 34, "2026-09-26")
    let w = load(cladId)
    expect(w.order).toMatchObject({ docNumber: "WO-2026/043", sourceKind: "project", projectId: "p3", purchaseRequestRef: "PR-2026/071" })

    // Made to measure: no release without a documented survey (T5, T6)
    expect(releaseBlocks(w.calc).map((b) => b.key)).toEqual(["survey"])
    await refused("release without a survey", () => releaseOrder(db, releaseInput(cladId)), "blocked")
    await refused("a survey without its sketch", () => recordSurvey(db, surveyInput(cladId, 34, null)), "sketch_required")
    const { mismatch } = await act("recordSurvey", recordSurvey(db, surveyInput(cladId, 34)))
    expect(mismatch).toBe(false)
    await release(cladId)

    // 34 m² × 1.30 = 44.2 m² needed; the store holds 22 m² on BLK-7712
    let alloc = allocate()
    w = load(cladId)
    expect(alloc.reserved.get(cladId)?.get(itemKey(STATUARIO.itemName))).toBe(22)
    expect(shortages(w.calc, alloc)).toEqual([{ itemName: STATUARIO.itemName, unit: "m²", short: 22.2, requested: null }])
    expect(scheduleOrders(worldCalcs(), departments(), lostHours(), alloc).get(cladId)).toMatchObject({ finishDays: null, condition: "materials" })
    expect(nextStep(candidates(w.calc, ctx(alloc)), MANAGER, w.departments, settings())).toMatchObject({ key: "shortage", itemName: STATUARIO.itemName, quantity: 22.2 })

    // T22: the shortfall goes to Procurement; the date waits for the arrival
    await act("requestPurchase", requestPurchase(db, { orderId: cladId, itemName: STATUARIO.itemName, unit: "m²", quantity: 22.2, needBy: "2026-09-18", note: null, actor: A.badr }))
    w = load(cladId)
    alloc = allocate()
    const pr = w.order.purchaseRequests![0]
    expect(pr).toMatchObject({ state: "sent", quantity: 22.2, by: A.badr.name })
    let cands = candidates(w.calc, ctx(alloc))
    expect(cands.some((c) => c.key === "shortage")).toBe(false)
    expect(cands.find((c) => c.key === "purchase_wait")).toMatchObject({ owner: { kind: "external", module: "procurement" }, quantity: 22.2 })
    expect(shortages(w.calc, alloc)[0].requested?.id).toBe(pr.id)
    expect(scheduleOrders(worldCalcs(), departments(), lostHours(), alloc).get(cladId)!.finishDays).toBeNull()

    // T23: Procurement marks it arrived. Until Inventory books the block the
    // shortfall is Inventory's to close — not back on the manager as "no
    // purchase requested" (the review of 18 Sep).
    await act("markPurchaseArrived", markPurchaseArrived(db, { orderId: cladId, purchaseRequestId: pr.id, actor: A.huda }))
    w = load(cladId)
    alloc = allocate()
    expect(w.order.purchaseRequests![0]).toMatchObject({ state: "arrived", arrivedBy: A.huda.name })
    cands = candidates(w.calc, ctx(alloc))
    expect(cands.some((c) => c.key === "shortage" || c.key === "purchase_wait")).toBe(false)
    expect(cands.find((c) => c.key === "arrived_wait")).toMatchObject({ owner: { kind: "external", module: "inventory" } })
    // Inventory receives the new block
    stockRow("wh-main", "row-sta-8100", STATUARIO, 50, "BLK-8100")
    expectWorldInvariants("Inventory receives BLK-8100")
    w = load(cladId)
    alloc = allocate()
    expect(shortages(w.calc, alloc)).toEqual([])
    cands = candidates(w.calc, ctx(alloc))
    expect(cands.some((c) => c.key === "purchase_wait" || c.key === "shortage")).toBe(false)
    const dated = scheduleOrders(worldCalcs(), departments(), lostHours(), alloc).get(cladId)!
    expect(dated.finishDays).toEqual(expect.any(Number))
    expect(dated.condition).toBe("drawing")

    // The new block needs the client's sign-off — all pieces from one block (T9)
    await approveDrawing(cladId, "consultant")
    expect(conditionOf(load(cladId).calc, allocate())).toBe("slab")
    await refused("signing a block that cannot cover the need", () => signOffSlab(db, slabInput(cladId, "BLK-7712")), "block_short")
    await refused("signing without the signed form", () => signOffSlab(db, { ...slabInput(cladId, "BLK-8100"), form: null }), "form_required")
    await signSlab(cladId, "BLK-8100")
    expect(load(cladId).order.slabApproval).toMatchObject({ lot: "BLK-8100", quantity: 44.2, by: A.lama.name })
    expect(conditionOf(load(cladId).calc, allocate())).toBeNull()

    // Another order sits at polishing today: 700 m of skirting, ahead in the queue
    const skirtId = await stockOrder(P.skirting, 700, "2026-09-20")
    await release(skirtId)
    await supplyStation(skirtId, 0, "BLK-2210")
    await output(skirtId, 0, 700)
    await output(skirtId, 1, 700)
    expect(load(skirtId).calc.pend).toEqual([0, 0, 700, 0])

    const before = scheduleOrders(worldCalcs(), departments(), lostHours(), allocate())
    expect(before.get(skirtId)!.finishDays).toBe(4)
    expect(before.get(cladId)!.finishDays).toBe(4)

    // T24: a stop at polishing — never more hours than the station's day
    const polishing = stationOf("s10")
    await refused("a stop longer than the day", () => recordStop(db, { organizationId: ORG, department: polishing, hours: 17, alreadyLost: 0, kind: "machine", note: null, actor: A.faisal }), "hours_beyond_capacity")
    await act("recordStop", recordStop(db, { organizationId: ORG, department: polishing, hours: 16, alreadyLost: 0, kind: "machine", note: "Polisher spindle seized", actor: A.faisal }))
    expect(listCollection<MfgStop>("mfgStops")).toEqual([expect.objectContaining({ departmentId: "s10", date: TODAY, hours: 16, kind: "machine", by: A.faisal.name })])
    await refused("more lost hours than the day holds", () => recordStop(db, { organizationId: ORG, department: polishing, hours: 1, alreadyLost: lostHours().get("s10") ?? 0, kind: "power", note: null, actor: A.faisal }), "hours_beyond_capacity")

    const after = scheduleOrders(worldCalcs(), departments(), lostHours(), allocate())
    expect(after.get(skirtId)!.finishDays).toBe(5)
    expect(after.get(cladId)!.finishDays).toBe(5)
  })
})

// ===========================================================================
// 4 · Tour 4 — scrap above the limit, early re-make, block notice
// ===========================================================================

describe("4 · scrap above the limit, early re-make and a block notice (tour 4)", () => {
  it("WO-2026/053 stair: the cost controller approves what the manager cannot; the re-make runs in parallel from a consented block; the notice lands on every live order on BLK-4471", async () => {
    seedCounter(52)
    const stairId = await preparedStair(40, "BLK-4471")
    const twinId = await preparedStair(12, "BLK-4471", false)
    const otherLotId = await preparedStair(8, "BLK-4479", false)
    const droppedId = await preparedStair(6, "BLK-4471", false)
    expect(load(stairId).order.docNumber).toBe("WO-2026/053")
    await act("requestOrderChange cancel", requestOrderChange(db, { orderId: droppedId, kind: "cancel", newQuantity: null, reason: "Stair 3 deleted from the design", module: "projects", actor: A.pm }))
    await act(
      "applyOrderChange cancel",
      applyOrderChange(db, { orderId: droppedId, product: P.stair, departments: departments(), notes: [], kind: "cancel", quantity: null, reason: "", wip: "scrap", settings: settings(), actor: A.badr })
    )

    // The saw: 28 good, 10 cracked at a weak vein
    await refused("a reject without its defect", () => recordOutput(db, outputInput(stairId, 2, 28, { rejected: 10 })), "defect_required")
    await output(stairId, 2, 28, { rejected: 10, defect: "vein", cause: CAUSE_MATERIAL, hours: 9.1 })
    await output(stairId, 3, 14, { hours: 7.2 })
    let w = load(stairId)
    expect(candidates(w.calc, ctx())[0]).toMatchObject({ key: "qc_decision", owner: { kind: "qc" }, index: 2, quantity: 10 })

    const { scrapValue } = await act(
      "qcDecide scrap",
      qcDecide(db, qcInput(stairId, { index: 2, kind: "scrap", quantity: 10, defect: "vein", cause: CAUSE_MATERIAL, reason: "Cracked on the saw at a weak vein" }))
    )
    // what each unit had consumed through the saw: 425.72 → 426 SAR
    expect(scrapValue).toBe(Math.round(unitSunkCost(P.stair, departments(), settings(), 2) * 10))
    expect(scrapValue).toBe(4260)
    expect(scrapValue).toBeGreaterThan(settings().scrapApprovalLimit)
    w = load(stairId)
    const scrap = w.order.scrapRecords![0]
    expect(scrap).toMatchObject({ status: "pending", decision: null, value: 4260, index: 2, defect: "vein", cause: CAUSE_MATERIAL, raisedByName: A.lama.name })
    const cands = candidates(w.calc, ctx())
    const review = cands.find((c) => c.key === "scrap_review")!
    expect(review.owner).toEqual({ kind: "scrap", value: 4260 })
    expect(ownsCandidate(review, MANAGER, w.departments, settings())).toBe(false)
    expect(ownsCandidate(review, COST, w.departments, settings())).toBe(true)
    expect(cands.find((c) => c.key === "remake_scrap")).toMatchObject({ owner: { kind: "manager" }, quantity: 10, approvalRunning: true })
    await refused("the manager approving above his limit", () => reviewScrap(db, reviewInput(stairId, scrap.id, { decision: "approve", canApproveAny: false, actor: A.badr })), "above_limit")

    // Eng. Lama: the block itself is defective (T25)
    const onBlock = liveOrdersOnLot("BLK-4471")
    expect(onBlock).toEqual([stairId, twinId].sort())
    expect(onBlock).not.toContain(otherLotId)
    expect(onBlock).not.toContain(droppedId)
    const noticeId = await act(
      "raiseBlockNotice",
      raiseBlockNotice(db, { organizationId: ORG, lot: "BLK-4471", itemName: CREMA.itemName, defect: "vein", note: "Weak vein runs through the block", photosAttached: true, orderIds: onBlock, actor: A.lama })
    )
    expect(readDoc<MfgBlockNotice>(`mfgBlockNotices/${noticeId}`)).toMatchObject({ lot: "BLK-4471", orderIds: onBlock, by: A.lama.name, quarantinedAt: null, claimRaisedAt: null })
    await act("markBlockQuarantined", markBlockQuarantined(db, { noticeId, actor: A.store }))
    await act("markBlockClaimRaised", markBlockClaimRaised(db, { noticeId, actor: A.huda }))
    const quarantined = new Set(listCollection<MfgBlockNotice>("mfgBlockNotices").filter((n) => n.quarantinedAt && !n.closedAt).map((n) => n.lot))
    expect(Array.from(quarantined)).toEqual(["BLK-4471"])
    expect(stockIndex(quarantined).lots.map((l) => l.lot)).not.toContain("BLK-4471")

    // The manager decides the re-make without waiting for the approval (FL-12) — from another block, with consent (FL-08)
    await refused("another block without documented consent", () => decideRemake(db, remakeInput(stairId, { source: "scrap", kind: "remake", quantity: 10, alternativeLot: { lot: "BLK-4479", consent: "  " } })), "consent_required")
    await act("decideRemake", decideRemake(db, remakeInput(stairId, { source: "scrap", kind: "remake", quantity: 10, alternativeLot: { lot: "BLK-4479", consent: "Client approved BLK-4479 by email, 13 Sep" } })))
    w = load(stairId)
    expect(w.order.scrapRecords![0]).toMatchObject({ status: "pending", decision: "remake", decidedBy: A.badr.name })
    expect(w.order).toMatchObject({ remade: 10 })
    expect(w.order.progress![2].rework).toBe(10)
    expect(w.order.slabApproval!.alternativeLot).toMatchObject({ lot: "BLK-4479", by: A.badr.name })
    expect(w.calc.pend.slice(2)).toEqual([12, 14, 14, 0])

    // The re-cut needs slab: a block nobody consented to is refused, the quarantined block is never issued
    expect(needRemain(w.calc, CREMA.itemName)).toBe(11.5)
    await refused(
      "a block without consent",
      () => requestStationMaterials(db, { orderId: stairId, organizationId: ORG, departmentId: "s7", lines: [{ itemName: CREMA.itemName, unit: "m²", quantity: 11.5, lot: "BLK-5001" }], consentNote: null, actor: A.sami }),
      "consent_required"
    )
    const wr = await act(
      "requestStationMaterials",
      requestStationMaterials(db, { orderId: stairId, organizationId: ORG, departmentId: "s7", lines: [{ itemName: CREMA.itemName, unit: "m²", quantity: 11.5, lot: "BLK-4479" }], consentNote: null, actor: A.sami })
    )
    const line = load(stairId).order.materials!.find((m) => m.requestNumber === wr)!
    await refused(
      "issuing from the quarantined block",
      () => issueWithdrawal(db, { orderId: stairId, requestNumber: wr, warehouseId: "wh-main", stockRows: stockRows("wh-main"), rowFor: { [line.id]: "row-crm-4471" }, quarantinedLots: Array.from(quarantined), actor: A.store }),
      "block_quarantined"
    )
    await act("issueWithdrawal", issueWithdrawal(db, { orderId: stairId, requestNumber: wr, warehouseId: "wh-main", stockRows: stockRows("wh-main"), quarantinedLots: Array.from(quarantined), actor: A.store }))
    expect(readDoc<StockRow>("warehouses/wh-main/inventoryItems/row-crm-4479")!.quantity).toBeCloseTo(40.5, 9)
    await act("confirmMaterialReceipt", confirmMaterialReceipt(db, { orderId: stairId, requestNumber: wr, note: null, actor: A.sami, organizationId: ORG }))

    // Noura (cost controller) approves from Today
    await act("reviewScrap approve", reviewScrap(db, { ...reviewInput(stairId, scrap.id, { decision: "approve", canApproveAny: true, actor: A.noura }), bearer: "supplier" }))
    w = load(stairId)
    expect(w.order.scrapRecords![0]).toMatchObject({ status: "approved", approvedByName: A.noura.name, classification: "abnormal", bearer: "supplier", decision: "remake" })
    expect(w.order.log!.map((l) => l.kind)).toContain("scrap_claim_supplier")
    expect(onMfgScrapApproved).toHaveBeenCalledWith(db, expect.objectContaining({ userId: A.noura.id }), expect.objectContaining({ workOrderId: stairId, scrapId: scrap.id, value: 4260 }))
    expect(orderCost(w.calc, w.departments, settings()).scrapValue).toBe(4260)

    // The re-cut runs on
    await output(stairId, 2, 12, { hours: 3 })
    expect(load(stairId).calc.pend.slice(2)).toEqual([0, 26, 14, 0])
  })

  it("an order that finished while its scrap approval ran in parallel is marked done when the approval lands (status cache)", async () => {
    const id = await stockOrder(P.skirting, 10)
    await release(id)
    await supplyStation(id, 0, "BLK-2210")
    await output(id, 0, 9, { rejected: 1, defect: "crack", cause: CAUSE_MATERIAL })
    const { scrapValue } = await act("qcDecide scrap", qcDecide(db, qcInput(id, { index: 0, kind: "scrap", quantity: 1, defect: "crack", cause: CAUSE_MATERIAL, reason: "Hairline crack" })))
    expect(scrapValue).toBeLessThanOrEqual(settings().scrapApprovalLimit)
    await act("decideRemake", decideRemake(db, remakeInput(id, { source: "scrap", kind: "remake", quantity: 1 })))
    await supplyStation(id, 0, "BLK-2210")
    await output(id, 0, 1)
    for (let i = 1; i < 4; i++) await output(id, i, 10)
    await close(id, 10)
    const { noteId } = await deliver(id, 10)
    await receive(noteId)
    let w = load(id)
    expect(w.calc.done_).toBe(false) // the approval is still pending
    expect(w.order.status).toBe("open")
    const scrapId = w.order.scrapRecords![0].id
    await act("reviewScrap approve", reviewScrap(db, reviewInput(id, scrapId, { decision: "approve", canApproveAny: false, actor: A.badr })))
    w = load(id)
    expect(w.calc.done_).toBe(true)
    expect(w.order.status).toBe("done")
  })
})

describe("rules conformance guard", () => {
  it("reads each role's field list from firestore.rules", () => {
    expect(RULE_FIELDS.warehouses.has("materials")).toBe(true)
    expect(RULE_FIELDS.procurement).toEqual(new Set(["purchaseRequests", "updatedAt"]))
    expect(RULE_FIELDS.cost.has("progress")).toBe(false)
  })

  it("flags a field or a status the role is not granted", () => {
    expect(rulesViolation(["procurement"], ["purchaseRequests", "updatedAt"], "open")).toBeNull()
    expect(rulesViolation(["procurement"], ["purchaseRequests", "quantity"], "open")).toMatch(/quantity/)
    expect(rulesViolation(["warehouses"], ["status", "updatedAt"], "cancelled")).toMatch(/status cancelled/)
  })
})

// ===========================================================================
// 5 · PRD full flows
// ===========================================================================

describe("5 · PRD full flows", () => {
  it("drawing C → revised → resubmitted → A; B/C need notes; the result is another module's", async () => {
    const id = await projectOrder(P.cladding, 10)
    await survey(id)
    await release(id)
    let w = load(id)
    expect(w.calc.drawingState).toBe("draft")
    expect(candidates(w.calc, ctx()).find((c) => c.key === "submit_drawing")).toMatchObject({ owner: { kind: "station", departmentId: "s1" }, index: 0 })

    const cutList = [{ no: "P1", length: 1.2, width: 0.6, thickness: 0.03, edge: "bullnose", cutouts: null }]
    await act("submitDrawing rev 1", submitDrawing(db, { ...submitInput(id, "consultant", 4.9), cutList }))
    w = load(id)
    expect(w.order.drawing).toMatchObject({ revision: 1, approverOrg: "consultant", code: null, submittedBy: A.badr.name })
    expect(w.order.progress![0].hours).toBe(4.9)
    expect(w.calc.drawingState).toBe("wait")
    const wait = candidates(w.calc, ctx()).find((c) => c.key === "drawing_wait")!
    expect(wait.owner).toEqual({ kind: "external", module: "projects" })
    await refused("resubmitting while at approval", () => submitDrawing(db, submitInput(id, "consultant")), "drawing_at_approval")
    await refused("a C without notes", () => recordDrawingResult(db, { orderId: id, code: "C", notes: "  ", approverName: null, actor: A.pm }), "notes_required")

    const cNotes = "Joint lines must follow the window grid"
    await act("recordDrawingResult C", recordDrawingResult(db, { orderId: id, code: "C", notes: cNotes, approverName: "Consultant — Dar Al-Tasmeem", evidence: FILE, actor: A.pm }))
    w = load(id)
    expect(w.order.drawing).toMatchObject({ revision: 1, submittedAt: null, code: null, previousC: cNotes, resultFileUrl: FILE.url })
    expect(w.calc.drawingState).toBe("draft")
    expect(candidates(w.calc, ctx()).find((c) => c.key === "submit_drawing")).toMatchObject({ previousC: cNotes })
    await refused("a result on a drawing not at approval", () => recordDrawingResult(db, { orderId: id, code: "A", notes: null, approverName: null, actor: A.pm }), "drawing_not_submitted")

    await act("submitDrawing rev 2", submitDrawing(db, submitInput(id, "consultant", 1.5)))
    w = load(id)
    expect(w.order.drawing).toMatchObject({ revision: 2, previousC: cNotes, code: null })
    expect(w.order.drawing!.cutList).toEqual(cutList)
    expect(w.order.progress![0].hours).toBe(6.4)

    await act("recordDrawingResult A", recordDrawingResult(db, { orderId: id, code: "A", notes: null, approverName: "Consultant — Dar Al-Tasmeem", actor: A.pm }))
    w = load(id)
    expect(w.calc.drawingState).toBe("ok")
    expect(w.calc.pend.slice(0, 3)).toEqual([0, 10, 0]) // design closed; the quantity waits at slab sign-off
    await refused("submitting an approved drawing", () => submitDrawing(db, submitInput(id, "consultant")), "drawing_approved")
  })

  it("a client's drawing is recorded by Sales; a stock order's drawing is the workshop's own (D12)", async () => {
    const so = seedSalesOrder("so-140", 140, true)
    const clientId = await clientOrder(so, P.cladding, 5)
    await survey(clientId)
    await release(clientId)
    await act("submitDrawing", submitDrawing(db, submitInput(clientId, "technical_office")))
    let w = load(clientId)
    expect(w.order.drawing).toMatchObject({ approverOrg: "client", code: null })
    expect(candidates(w.calc, ctx()).find((c) => c.key === "drawing_wait")!.owner).toEqual({ kind: "external", module: "sales" })

    const stockId = await stockOrder(P.cladding, 5)
    await survey(stockId)
    await release(stockId)
    await act("submitDrawing", submitDrawing(db, submitInput(stockId, "technical_office")))
    w = load(stockId)
    expect(w.order.drawing).toMatchObject({ approverOrg: "workshop", code: "A", recordedBy: A.badr.name })
    expect(w.calc.drawingState).toBe("ok")
  })

  it("a client order that carries only its quotation is still its sales order's: gated by that deposit, found by Sales, answered by Sales", async () => {
    // Quote-born data: the order names no sales order, only Q-9RT2KD — the
    // quotation so-131 was born of.
    const so = seedSalesOrder("so-131", 131, false)
    const id = await clientOrder(so, P.cladding, 5)
    const stored = (path: string): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...readDoc<Record<string, unknown>>(path)! }
      delete copy.id
      return copy
    }
    seed(`workOrders/${id}`, { ...stored(`workOrders/${id}`), salesOrderId: null, salesOrderNumber: null, source: { kind: "quotation", quotationId: "q44", quotationNumber: "Q-9RT2KD", contactName: null } })
    // Another client's sales order, born of another quotation, deposit unpaid.
    seedSalesOrder("so-200", 200, false)
    seed("salesOrders/so-200", { ...stored("salesOrders/so-200"), quotationId: "q99", quotationNumber: "Q-OTHER1" })

    const salesOrders = () => listCollection<SalesOrder>("salesOrders")
    const resolved = () => salesOrderOfWorkOrder(readDoc<WorkOrderV2>(`workOrders/${id}`)!, salesOrders())
    const calc = () => {
      const w = load(id)
      return calcOf(w.order, w.product, w.departments, w.noteSlices, resolved())
    }
    expect(resolved()?.id).toBe("so-131")

    // The same gate as a named order: no release before the down payment —
    // and an id the order does not belong to is never trusted.
    expect(calc().stage).toBe("pay")
    await survey(id)
    await refused("release before the deposit", () => releaseOrder(db, { ...releaseInput(id), salesOrderId: "so-131" }), "blocked")
    await act("markDepositPaid", markDepositPaid(db, so))
    expect(calc().stage).toBe("wait")
    await act("releaseOrder", releaseOrder(db, { ...releaseInput(id), salesOrderId: "so-200" }))
    expect(load(id).order.releasedAt).toBe(NOW.toISOString())

    // The workshop submits; the drawing is Sales' to answer and Sales finds it
    // without a sales order id on the work order.
    await act("submitDrawing", submitDrawing(db, submitInput(id, "technical_office")))
    const products = new Map(listCollection<MfgProduct>("mfgProducts").map((p) => [p.id, p]))
    const orders = () => listCollection<WorkOrderV2>("workOrders")
    expect(clientDrawingsDue(orders(), products).map((o) => o.id)).toEqual([id])
    expect(workshopGatesFor(resolved()!, orders(), products).gates).toEqual([{ gate: "approval", orderId: id, ref: load(id).order.docNumber }])
    expect(workshopGatesFor(salesOrders().find((s) => s.id === "so-200")!, orders(), products).gates).toEqual([])
    expect(candidates(calc(), ctx()).find((c) => c.key === "drawing_wait")!.owner).toEqual({ kind: "external", module: "sales" })

    await act("recordDrawingResult B", recordDrawingResult(db, { orderId: id, code: "B", notes: "Edge profile to be eased", approverName: so.contactName ?? null, actor: A.reem }))
    expect(load(id).order.drawing).toMatchObject({ code: "B", recordedBy: A.reem.name, approverName: "Al-Ofuq Contracting" })
    expect(calc().drawingState).toBe("ok")
    expect(clientDrawingsDue(orders(), products)).toEqual([])
  })

  it("QC rework sends quantity back to the station that caused it and out of QC's hands — never counted twice", async () => {
    const id = await stockOrder(P.skirting, 20)
    await release(id)
    await supplyStation(id, 0, "BLK-2210")
    for (let i = 0; i < 3; i++) await output(id, i, 20)
    await output(id, 3, 17, { rejected: 3, defect: "chip", cause: "s8" })
    let w = load(id)
    expect(w.order.rejects).toEqual([expect.objectContaining({ index: 3, departmentId: "s5", quantity: 3, defect: "chip", cause: "s8", by: A.lama.name })])
    expect(w.order.qcReleases).toEqual([expect.objectContaining({ quantity: 17 })])

    await refused("rework to a later station", () => qcDecide(db, qcInput(id, { index: 3, kind: "rework", quantity: 1, defect: "chip", toIndex: 4 })), "rework_forward")
    await refused("deciding more than was rejected", () => qcDecide(db, qcInput(id, { index: 3, kind: "rework", quantity: 4, defect: "chip", toIndex: 1 })), "more_than_rejected")
    await act("qcDecide rework → profiling", qcDecide(db, qcInput(id, { index: 3, kind: "rework", quantity: 2, defect: "chip", cause: "s8", toIndex: 1 })))
    w = load(id)
    expect(w.order.progress![3]).toMatchObject({ done: 17, rejected: 1, back: 2 })
    expect(w.order.progress![1]).toMatchObject({ done: 20, rework: 2 })
    expect(w.calc.pend).toEqual([0, 2, 0, 0])

    await act("qcDecide rework in place", qcDecide(db, qcInput(id, { index: 3, kind: "rework", quantity: 1, defect: "chip", cause: "s5", toIndex: 3 })))
    w = load(id)
    expect(w.calc.pend).toEqual([0, 2, 0, 1])
    expect(w.calc.rejected).toBe(0)

    await output(id, 3, 1)
    await output(id, 1, 2)
    await output(id, 2, 2)
    expect(load(id).calc.pend).toEqual([0, 0, 0, 2])
    await output(id, 3, 2)
    w = load(id)
    expect(w.calc).toMatchObject({ finished: 20, wip: 0, toClose: 20 })
    expect(sum(w.order.qcReleases!.map((r) => r.quantity))).toBe(20)
    await close(id, 20)
    expect(load(id).calc.stage).toBe("ready")
  })

  it("concession needs documented consent; scrap returned for clarification comes back to review; a declared shortfall closes the order short", async () => {
    const id = await stockOrder(P.skirting, 10)
    await release(id)
    await supplyStation(id, 0, "BLK-2210")
    await output(id, 0, 10)
    await output(id, 1, 8, { rejected: 2, defect: "chip", cause: "s8" })

    await refused("a concession without consent", () => qcDecide(db, qcInput(id, { index: 1, kind: "concession", quantity: 1, defect: "chip", consent: " " })), "consent_required")
    await act("qcDecide concession", qcDecide(db, qcInput(id, { index: 1, kind: "concession", quantity: 1, defect: "chip", cause: "s8", consent: "Chip on the hidden back edge — accepted by the manager" })))
    expect(load(id).order.progress![1]).toMatchObject({ done: 9, rejected: 1 })

    await refused("scrap without a reason", () => qcDecide(db, qcInput(id, { index: 1, kind: "scrap", quantity: 1, defect: "chip" })), "reason_required")
    const { scrapValue } = await act("qcDecide scrap", qcDecide(db, qcInput(id, { index: 1, kind: "scrap", quantity: 1, defect: "chip", cause: "s8", reason: "Chipped through the face" })))
    expect(scrapValue).toBe(Math.round(unitSunkCost(P.skirting, departments(), settings(), 1)))
    const scrapId = load(id).order.scrapRecords![0].id

    await refused("returning without a question", () => reviewScrap(db, reviewInput(id, scrapId, { decision: "return", canApproveAny: false, actor: A.badr, question: " " })), "question_required")
    await act("reviewScrap return", reviewScrap(db, reviewInput(id, scrapId, { decision: "return", canApproveAny: false, actor: A.badr, question: "Handling or the profiling wheel?" })))
    let w = load(id)
    expect(w.order.scrapRecords![0]).toMatchObject({ status: "returned", question: "Handling or the profiling wheel?", questionBy: A.badr.name })
    let cands = candidates(w.calc, ctx())
    expect(cands.find((c) => c.key === "scrap_clarify")).toMatchObject({ owner: { kind: "qc" }, scrapId })
    expect(cands.some((c) => c.key === "remake_scrap" || c.key === "scrap_review")).toBe(false)
    expect(w.calc.stage).toBe("prod")
    await refused("approving a returned record", () => reviewScrap(db, reviewInput(id, scrapId, { decision: "approve", canApproveAny: true, actor: A.noura })), "nothing_pending")
    await refused("clarifying without an answer", () => clarifyScrap(db, { orderId: id, scrapId, defect: "handling", cause: "s8", answer: "  ", actor: A.lama }), "answer_required")

    await act("clarifyScrap", clarifyScrap(db, { orderId: id, scrapId, defect: "handling", cause: "s8", answer: "Dropped from the trolley at profiling", actor: A.lama }))
    expect(load(id).order.scrapRecords![0]).toMatchObject({ status: "pending", defect: "handling", clarification: "Dropped from the trolley at profiling" })
    await refused("clarifying twice", () => clarifyScrap(db, { orderId: id, scrapId, defect: "handling", cause: "s8", answer: "again", actor: A.lama }), "nothing_returned")
    await act("reviewScrap approve", reviewScrap(db, reviewInput(id, scrapId, { decision: "approve", canApproveAny: false, actor: A.badr })))
    expect(onMfgScrapApproved).toHaveBeenCalledTimes(1)
    w = load(id)
    cands = candidates(w.calc, ctx())
    expect(cands.find((c) => c.key === "remake_scrap")).toMatchObject({ quantity: 1, approvalRunning: false })

    await act("decideRemake shortfall", decideRemake(db, remakeInput(id, { source: "scrap", kind: "shortfall", quantity: 1 })))
    w = load(id)
    expect(w.order).toMatchObject({ shortfall: 1 })
    expect(w.calc.target).toBe(9)
    await refused("deciding a decided scrap", () => decideRemake(db, remakeInput(id, { source: "scrap", kind: "remake", quantity: 1 })), "quantity_required")

    // A concession at QC & packing is itself the quality release
    await output(id, 2, 9)
    await output(id, 3, 8, { rejected: 1, defect: "gloss", cause: "s10" })
    await act("qcDecide concession at QC", qcDecide(db, qcInput(id, { index: 3, kind: "concession", quantity: 1, defect: "gloss", cause: "s10", consent: "Client accepts the lower gloss (email 13 Sep)" })))
    w = load(id)
    expect(sum(w.order.qcReleases!.map((r) => r.quantity))).toBe(9)
    expect(w.calc.toClose).toBe(9)
    await close(id, 9)
    const { noteId } = await deliver(id, 9)
    await receive(noteId)
    w = load(id)
    expect(w.order.status).toBe("done")
    expect(w.calc).toMatchObject({ done_: true, delivered: 9, target: 9, scrapAll: 1 })
  })

  it("make requests: partial with the remainder returned, full, and declined with a reason", async () => {
    const so = seedSalesOrder("so-131", 131, false)
    const requestId = await act("createManufacturingRequest", createManufacturingRequest(db, { order: so, itemName: P.skirting.name, unit: "m", quantity: 400, productId: P.skirting.id, actor: A.reem }))
    let request = readDoc<ManufacturingRequest>(`manufacturingRequests/${requestId}`)!
    const line = request.lines![0]
    await refused("making more than requested", () => answerMakeRequest(db, { request, lines: [{ line, product: P.skirting, makeQuantity: 500 }], note: null, actor: A.badr }), "more_than_requested")
    await refused("an answer that makes nothing", () => answerMakeRequest(db, { request, lines: [{ line, product: P.skirting, makeQuantity: 0 }], note: null, actor: A.badr }), "lines_required")

    const partial = await act("answerMakeRequest partial", answerMakeRequest(db, { request, lines: [{ line, product: P.skirting, makeQuantity: 250 }], note: "Capacity for 250 m by the promise date", actor: A.badr }))
    request = readDoc<ManufacturingRequest>(`manufacturingRequests/${requestId}`)!
    expect(request).toMatchObject({ status: "partial", answerRoute: "make", workOrderIds: partial.workOrderIds, decidedByUserName: A.badr.name })
    expect(request.lines).toEqual([expect.objectContaining({ quantity: 400, makeQuantity: 250, returnedQuantity: 150, productId: P.skirting.id })])
    expect(load(partial.workOrderIds[0]).order).toMatchObject({ quantity: 250, sourceKind: "client", salesOrderId: "so-131", mfgRequestId: requestId, requestedByName: A.reem.name })
    await refused("answering twice", () => answerMakeRequest(db, { request, lines: [{ line, product: P.skirting, makeQuantity: 150 }], note: null, actor: A.badr }), "already_answered")

    const fullId = await projectOrder(P.stair, 18)
    expect(listCollection<ManufacturingRequest>("manufacturingRequests").find((r) => r.workOrderId === fullId)).toMatchObject({
      status: "accepted",
      sourceKind: "procurement",
      lines: [expect.objectContaining({ makeQuantity: 18, returnedQuantity: 0 })],
    })
    expect(load(fullId).order).toMatchObject({ sourceKind: "project", projectId: "p3", purchaseRequestRef: "PR-2026/071", pmRequestRef: "PM-2026/052", costItemName: "Stone works" })

    const declinedId = await act("createManufacturingRequest", createManufacturingRequest(db, { order: so, itemName: P.cladding.name, unit: "m²", quantity: 60, productId: P.cladding.id, actor: A.reem }))
    const declined = readDoc<ManufacturingRequest>(`manufacturingRequests/${declinedId}`)!
    await refused("declining without a reason", () => declineRequest(db, { request: declined, reason: "  ", actor: A.badr }), "reason_required")
    await act("declineRequest", declineRequest(db, { request: declined, reason: "Statuario lead time beyond the promise — buy finished cladding", actor: A.badr }))
    expect(readDoc<ManufacturingRequest>(`manufacturingRequests/${declinedId}`)).toMatchObject({ status: "rejected", answerRoute: "decline", rejectionReason: "Statuario lead time beyond the promise — buy finished cladding" })
    await refused("making a declined request", () => answerMakeRequest(db, { request: declined, lines: [{ line: declined.lines![0], product: P.cladding, makeQuantity: 60 }], note: null, actor: A.badr }), "already_answered")
    await refused("declining an answered request", () => declineRequest(db, { request: declined, reason: "again", actor: A.badr }), "already_answered")
  })

  it("costing: request → draft cost statement → sent → quoted → won, and the won statement travels into the make request (REQ-06, REQ-08)", async () => {
    const requestId = await act(
      "createCostingRequest",
      createCostingRequest(db, { organizationId: ORG, contactName: "Al-Ofuq Contracting", rfqRef: "RFQ-2026/044", neededBy: "2026-10-15", lines: [{ productId: P.stair.id, itemName: P.stair.name, unit: "m", quantity: 18 }], note: null, actor: A.reem })
    )
    const request = readDoc<ManufacturingRequest>(`manufacturingRequests/${requestId}`)!
    expect(request).toMatchObject({ kind: "cost", status: "new", requestNumber: "MR-2026/001" })

    const estimateId = await act("answerCostingRequest", answerCostingRequest(db, { request, lines: [{ product: P.stair, quantity: 18 }], departments: departments(), settings: settings(), note: null, actor: A.badr }))
    let est = readDoc<MfgCostEstimate>(`mfgCostEstimates/${estimateId}`)!
    const std = standardCost(P.stair, departments(), settings(), 18)
    expect(est).toMatchObject({ estimateNumber: "CE-2026/001", state: "draft", validityDays: 15, requestId })
    expect(est.lines).toEqual([expect.objectContaining({ productId: P.stair.id, quantity: 18, materialCost: std.materials, labourCost: std.labour, overheadCost: std.overhead, hours: std.hours, totalCost: std.total })])
    expect(readDoc<ManufacturingRequest>(`manufacturingRequests/${requestId}`)).toMatchObject({ status: "estimated", answerRoute: "estimate", estimateId, estimateNumber: "CE-2026/001" })
    await refused("quoting a draft", () => recordQuoteStatus(db, { estimate: est, state: "quoted", quoteNumber: "Q-9RT2KD", salesOrderNumber: null, actor: A.reem }), "invalid_transition")

    await act("sendCostStatement", sendCostStatement(db, { estimate: est, products: new Map([[P.stair.id, P.stair]]), departments: departments(), settings: settings(), earliestDays: 9, note: null, actor: A.noura }))
    est = readDoc<MfgCostEstimate>(`mfgCostEstimates/${estimateId}`)!
    expect(est).toMatchObject({ state: "sent", sentByName: A.noura.name, sentAt: NOW.toISOString(), earliestDays: 9 })
    await refused("quoting without the quote number", () => recordQuoteStatus(db, { estimate: est, state: "quoted", quoteNumber: " ", salesOrderNumber: null, actor: A.reem }), "quote_required")
    await refused("quoting past validity", () => recordQuoteStatus(db, { estimate: est, state: "quoted", quoteNumber: "Q-9RT2KD", salesOrderNumber: null, actor: A.reem, settings: settings(), today: "2026-10-01" }), "expired")

    await act("recordQuoteStatus quoted", recordQuoteStatus(db, { estimate: est, state: "quoted", quoteNumber: "Q-9RT2KD", salesOrderNumber: null, actor: A.reem, settings: settings(), today: TODAY }))
    est = readDoc<MfgCostEstimate>(`mfgCostEstimates/${estimateId}`)!
    await act("recordQuoteStatus won", recordQuoteStatus(db, { estimate: est, state: "won", quoteNumber: null, salesOrderNumber: 131, actor: A.reem }))
    est = readDoc<MfgCostEstimate>(`mfgCostEstimates/${estimateId}`)!
    expect(est).toMatchObject({ state: "won", quoteNumber: "Q-9RT2KD", salesOrderNumber: 131, salesStatusBy: A.reem.name })
    await refused("quoting a won statement again", () => recordQuoteStatus(db, { estimate: est, state: "quoted", quoteNumber: "Q-1", salesOrderNumber: null, actor: A.reem }), "invalid_transition")

    const so = seedSalesOrder("so-131", 131, true)
    const orderId = await clientOrder(so, P.stair, 18)
    const w = load(orderId)
    expect(readDoc<ManufacturingRequest>(`manufacturingRequests/${w.order.mfgRequestId}`)!.estimateId).toBe(estimateId)
    expect(w.order.estimateId).toBe(estimateId)
  })

  it("a cost statement cannot be sent while a route step has no standard time (REQ-09)", async () => {
    const requestId = await act(
      "createCostingRequest",
      createCostingRequest(db, { organizationId: ORG, contactName: null, rfqRef: null, neededBy: null, lines: [{ productId: P.vanity.id, itemName: P.vanity.name, unit: "m²", quantity: 4 }], note: null, actor: A.reem })
    )
    const request = readDoc<ManufacturingRequest>(`manufacturingRequests/${requestId}`)!
    const estimateId = await act("answerCostingRequest", answerCostingRequest(db, { request, lines: [{ product: P.vanity, quantity: 4 }], departments: departments(), settings: settings(), note: null, actor: A.badr }))
    const est = readDoc<MfgCostEstimate>(`mfgCostEstimates/${estimateId}`)!
    expect(standardCost(P.vanity, departments(), settings(), 4).unestimated).toEqual(["s9"])
    await refused("sending with cut-outs unestimated", () => sendCostStatement(db, { estimate: est, products: new Map([[P.vanity.id, P.vanity]]), departments: departments(), settings: settings(), earliestDays: null, note: null, actor: A.noura }), "standard_incomplete")
  })

  it("an incoming quantity change is applied by the manager — never below what entered production — and a cancel decides the work in hand (T20)", async () => {
    const id = await projectOrder(P.skirting, 320)
    await release(id)
    await supplyStation(id, 0, "BLK-2244")
    await output(id, 0, 80, { hours: 4.6 })

    const changeInput = (kind: "quantity" | "cancel") => ({ orderId: id, product: P.skirting, departments: departments(), notes: load(id).noteSlices, kind, quantity: null, reason: "", wip: "scrap" as const, settings: settings(), actor: A.badr })
    await refused("the manager changing a project order on his own", () => applyOrderChange(db, { ...changeInput("quantity"), quantity: 200, reason: "Looks like too much" }), "owner_changes_only")
    await refused("a change without a reason", () => requestOrderChange(db, { orderId: id, kind: "quantity", newQuantity: 200, reason: " ", module: "projects", actor: A.pm }), "reason_required")
    await act("requestOrderChange 200", requestOrderChange(db, { orderId: id, kind: "quantity", newQuantity: 200, reason: "Floor 12 redesigned — less skirting", module: "projects", actor: A.pm }))
    await refused("a second change while one is pending", () => requestOrderChange(db, { orderId: id, kind: "cancel", newQuantity: null, reason: "x", module: "projects", actor: A.pm }), "change_pending")
    let w = load(id)
    expect(w.calc.stage).toBe("prod") // stays in stage until applied
    expect(candidates(w.calc, ctx()).find((c) => c.key === "apply_change")).toMatchObject({ owner: { kind: "manager" }, changeKind: "quantity", newQuantity: 200 })

    const first = await act("applyOrderChange 200", applyOrderChange(db, changeInput("quantity")))
    expect(first.applied).toBe(200)
    w = load(id)
    expect(w.order).toMatchObject({ quantity: 200, changeRequest: null, output: { quantity: 200 } })
    expect(w.calc.pend[0]).toBe(120)

    await act("requestOrderChange 50", requestOrderChange(db, { orderId: id, kind: "quantity", newQuantity: 50, reason: "Only the lobby remains", module: "projects", actor: A.pm }))
    const second = await act("applyOrderChange 50", applyOrderChange(db, changeInput("quantity")))
    expect(second.applied).toBe(80) // what already entered production stays
    w = load(id)
    expect(minQuantity(w.calc)).toBe(80)
    expect(w.order.log!.find((l) => l.kind === "quantity_changed" && (l.detail || "").includes("(min 80)"))).toBeDefined()

    // A withdrawal still at the store, then the owner cancels
    await act("requestStationMaterials", requestStationMaterials(db, { orderId: id, organizationId: ORG, departmentId: "s7", lines: [{ itemName: BEIGE.itemName, unit: "m²", quantity: 1, lot: "BLK-2244" }], consentNote: null, actor: A.sami }))
    await act("requestOrderChange cancel", requestOrderChange(db, { orderId: id, kind: "cancel", newQuantity: null, reason: "Project descoped", module: "projects", actor: A.pm }))
    await act("applyOrderChange cancel", applyOrderChange(db, changeInput("cancel")))
    w = load(id)
    expect(w.order.status).toBe("cancelled")
    expect(w.order.cancellation).toMatchObject({ by: A.badr.name, reason: "Project descoped", wip: "scrap", fromModule: "projects" })
    expect(w.order.materials!.some((m) => m.state === "requested")).toBe(false)
    expect(w.order.scrapRecords).toEqual([
      expect.objectContaining({ index: 1, quantity: 80, value: Math.round(unitSunkCost(P.skirting, departments(), settings(), 1) * 80), status: "pending", decision: "shortfall" }),
    ])
    expect(candidates(w.calc, ctx()).map((c) => c.key)).toEqual(["scrap_review"])
    expect(orderCost(w.calc, w.departments, settings()).wip).toBe(0)
    await refused("changing a cancelled order", () => requestOrderChange(db, { orderId: id, kind: "quantity", newQuantity: 10, reason: "x", module: "projects", actor: A.pm }), "order_closed")
  })

  it("the workshop cancels its own stock order and returns the work in hand as usable remnants", async () => {
    const id = await stockOrder(P.skirting, 50)
    await release(id)
    await supplyStation(id, 0, "BLK-2210")
    await output(id, 0, 50, { hours: 3 })
    await act(
      "applyOrderChange cancel (remnants)",
      applyOrderChange(db, { orderId: id, product: P.skirting, departments: departments(), notes: [], kind: "cancel", quantity: null, reason: "Stock level restored by a purchase", wip: "remnant", remnantArea: 5, settings: settings(), actor: A.badr })
    )
    const w = load(id)
    expect(w.order.cancellation).toMatchObject({ wip: "remnant", fromModule: null })
    const rem = w.order.remnants![0]
    expect(rem).toMatchObject({ source: "cancel", area: 5, value: Math.round(5 * 245 * 0.5), state: "returned", itemName: BEIGE.itemName })
    await act("receiveRemnant", receiveRemnant(db, { orderId: id, remnantId: rem.id, warehouseId: "wh-main", organizationId: ORG, actor: A.store }))
    expect(listCollection<StockRow>("warehouses/wh-main/inventoryItems").find((r) => r.remnant)).toMatchObject({ quantity: 5, lot: "REM-WO-2026/001-1", sourceWorkOrderId: id })
  })

  it("cancelling with usable remnants never credits WIP more than cancelling as scrap would", async () => {
    const cancelBoth = async (wip: "scrap" | "remnant") => {
      const id = await stockOrder(P.skirting, 50)
      await release(id)
      await supplyStation(id, 0, "BLK-2210")
      await output(id, 0, 50, { hours: 3 })
      await act(`applyOrderChange cancel (${wip})`, applyOrderChange(db, { orderId: id, product: P.skirting, departments: departments(), notes: [], kind: "cancel", quantity: null, reason: "Stock level restored", wip, remnantArea: 5, settings: settings(), actor: A.badr }))
      const o = load(id).order
      // scrap approval credits WIP by its value; remnant receipt credits WIP by its value
      return sum(o.scrapRecords!.map((s) => s.value)) + sum((o.remnants || []).map((r) => r.value))
    }
    const asScrap = await cancelBoth("scrap")
    const asRemnants = await cancelBoth("remnant")
    expect(asRemnants).toBeLessThanOrEqual(asScrap)
  })

  it("cancelling before anything was cut writes off no more than the order holds", async () => {
    const id = await preparedStair(6, "BLK-4471", false)
    const w0 = load(id)
    expect(w0.calc.pend[2]).toBe(6) // waiting at the saw — no slab requested, nothing cut
    const accumulated = orderCost(w0.calc, w0.departments, settings()).total
    await act("requestOrderChange cancel", requestOrderChange(db, { orderId: id, kind: "cancel", newQuantity: null, reason: "Stair deleted", module: "projects", actor: A.pm }))
    await act("applyOrderChange cancel", applyOrderChange(db, { orderId: id, product: P.stair, departments: departments(), notes: [], kind: "cancel", quantity: null, reason: "", wip: "scrap", settings: settings(), actor: A.badr }))
    const writtenOff = sum(load(id).order.scrapRecords!.map((s) => s.value))
    expect(writtenOff).toBeLessThanOrEqual(accumulated)
  })

  it("transit breakage is recorded at receipt and opens a re-make (T19, T16)", async () => {
    const id = await stockOrderClosed(50)
    const n1 = await deliver(id, 30)
    await refused("more broken than the note carried", () => receiveDeliveryNote(db, receiveInput(n1.noteId, 31)), "more_than_shipped")
    await receive(n1.noteId, 2)
    let w = load(id)
    const unitCost = readDoc<DeliveryNote>(`deliveryNotes/${n1.noteId}`)!.item.unitCost!
    expect(readDoc<DeliveryNote>(`deliveryNotes/${n1.noteId}`)).toMatchObject({ status: "received", brokenQuantity: 2, receivedByUserName: A.store.name })
    expect(listCollection<StockRow>("warehouses/wh-fg/inventoryItems")).toEqual([expect.objectContaining({ quantity: 28 })])
    expect(onWorkOrderDelivered).toHaveBeenLastCalledWith(db, expect.anything(), expect.objectContaining({ deliveryNoteId: n1.noteId, value: round2(unitCost * 28) }))
    expect(w.calc).toMatchObject({ delivered: 28, broken: 2, brokenOpen: 2, ready: 20, stage: "ready" })
    expect(w.order.status).toBe("open")
    expect(candidates(w.calc, ctx()).find((c) => c.key === "remake_breakage")).toMatchObject({ owner: { kind: "manager" }, quantity: 2 })

    await refused("re-making more than broke", () => decideRemake(db, remakeInput(id, { source: "breakage", kind: "remake", quantity: 3 })), "more_than_broken")
    await act("decideRemake breakage", decideRemake(db, remakeInput(id, { source: "breakage", kind: "remake", quantity: 2 })))
    w = load(id)
    expect(w.order).toMatchObject({ brokenResolved: 2, remade: 2 })
    expect(w.calc.pend).toEqual([2, 0, 0, 0])
    await refused("the same breakage re-made twice", () => decideRemake(db, remakeInput(id, { source: "breakage", kind: "remake", quantity: 2 })), "more_than_broken")

    await supplyStation(id, 0, "BLK-2210")
    for (let i = 0; i < 4; i++) await output(id, i, 2)
    await close(id, 2)
    const n2 = await deliver(id, 22)
    await receive(n2.noteId)
    w = load(id)
    expect(w.order.status).toBe("done")
    expect(w.calc).toMatchObject({ done_: true, delivered: 50, target: 50, broken: 2 })
  })

  it("a breakage declared short closes the order at the lower target in the same decision", async () => {
    const id = await stockOrderClosed(10)
    const { noteId } = await deliver(id, 10)
    await receive(noteId, 1)
    expect(load(id).order.status).toBe("open")
    await act("decideRemake breakage shortfall", decideRemake(db, remakeInput(id, { source: "breakage", kind: "shortfall", quantity: 1 })))
    const w = load(id)
    expect(w.order).toMatchObject({ shortfall: 1, brokenResolved: 1, status: "done" })
    expect(w.calc).toMatchObject({ done_: true, target: 9, delivered: 9, brokenOpen: 0 })
  })

  it("hours far past the standard ask for a variance review, and the review clears it (FL-05)", async () => {
    const id = await stockOrder(P.skirting, 20)
    await release(id)
    await supplyStation(id, 0, "BLK-2210")
    await output(id, 0, 20, { hours: 1.2 })
    await output(id, 1, 20, { hours: 6 })
    expect(hourVariance(load(id).calc, settings())).toMatchObject({ departmentId: "s8", standard: 1.4, actual: 6, gap: 4.6, percent: 329 })
    await act("reviewVariance", reviewVariance(db, { orderId: id, departmentId: "s8", cause: "unrecorded_rework", note: "Edges re-profiled after a wheel change", actor: A.noura }))
    const w = load(id)
    expect(w.order.varianceReviews!.s8).toMatchObject({ cause: "unrecorded_rework", by: A.noura.name })
    expect(hourVariance(w.calc, settings())).toBeNull()
  })

  it("remnants from the saw and from a QC decision go to Inventory; receipt credits the order and books the value (T26)", async () => {
    const id = await preparedStair(40, "BLK-4471")
    await output(id, 2, 40, { hours: 12, remnantArea: 1.8 })
    let w = load(id)
    const rem = w.order.remnants![0]
    // 1.8 m² × 320 SAR × 50% remnant policy
    expect(rem).toMatchObject({ area: 1.8, itemName: CREMA.itemName, unit: "m²", lot: "BLK-4471", value: 288, state: "returned", source: "output", by: A.sami.name })
    expect(candidates(w.calc, ctx()).find((c) => c.key === "remnant_wait")).toMatchObject({ owner: { kind: "external", module: "inventory" }, quantity: 1.8 })
    expect(orderCost(w.calc, w.departments, settings()).remnantCredit).toBe(0) // the credit lands only at receipt

    // QC downgrades a rejected piece to a usable offcut — its credit nets off the scrap value
    await output(id, 3, 39, { rejected: 1, defect: "chip", cause: "s8" })
    const sunk = unitSunkCost(P.stair, departments(), settings(), 3)
    await refused("a remnant decision without its area", () => qcDecide(db, qcInput(id, { index: 3, kind: "remnant", quantity: 1, defect: "chip", reason: "Offcut" })), "remnant_area_required")
    const { scrapValue } = await act("qcDecide remnant", qcDecide(db, qcInput(id, { index: 3, kind: "remnant", quantity: 1, defect: "chip", cause: "s8", remnantArea: 0.6, reason: "Corner chipped — offcut usable" })))
    expect(scrapValue).toBe(Math.max(0, Math.round(sunk - 96)))
    w = load(id)
    expect(w.order.remnants![1]).toMatchObject({ source: "qc", area: 0.6, value: 96, lot: "BLK-4471" })
    expect(w.order.scrapRecords![0]).toMatchObject({ remnantCredit: 96, value: scrapValue })

    await act("receiveRemnant", receiveRemnant(db, { orderId: id, remnantId: rem.id, warehouseId: "wh-main", organizationId: ORG, actor: A.store }))
    expect(listCollection<StockRow>("warehouses/wh-main/inventoryItems").find((r) => r.remnant)).toMatchObject({
      name: CREMA.itemName,
      quantity: 1.8,
      unit: "m²",
      unitCost: 160,
      lot: "REM-4471-1",
      remnant: true,
      sourceWorkOrderId: id,
    })
    expect(onMfgRemnantReceived).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: ORG, userId: A.store.id }), expect.objectContaining({ workOrderId: id, remnantId: rem.id, value: 288, itemName: CREMA.itemName }))
    w = load(id)
    expect(w.order.remnants![0]).toMatchObject({ state: "received", receivedBy: A.store.name, warehouseId: "wh-main" })
    expect(orderCost(w.calc, w.departments, settings()).remnantCredit).toBe(288)
    // offered in later requests: the remnant is a lot in the stock index
    expect(stockIndex().lots).toContainEqual({ itemName: CREMA.itemName, lot: "REM-4471-1", quantity: 1.8, remnant: true })
    await refused("receiving the same remnant twice", () => receiveRemnant(db, { orderId: id, remnantId: rem.id, warehouseId: "wh-main", organizationId: ORG, actor: A.store }), "nothing_to_receive")
  })
})

// ===========================================================================
// 6 · The invariant check itself
// ===========================================================================

describe("6 · invariants after every event", () => {
  it("the checker is not vacuous: units that appear from nowhere, a leak, or a hidden negative balance are caught", async () => {
    const id = await stockOrder(P.skirting, 10)
    await release(id)
    await supplyStation(id, 0, "BLK-2210")
    await output(id, 0, 10)
    expect(worldProblems()).toEqual([])
    const stored = readDoc<WorkOrderV2>(`workOrders/${id}`)!
    const { id: _id, ...data } = stored
    // profiling claims 12 done out of the 10 it was handed
    seed(`workOrders/${id}`, { ...data, progress: stored.progress!.map((p, i) => (i === 1 ? { ...p, done: 12 } : p)) })
    const problems = worldProblems()
    expect(problems.some((p) => p.includes("conservation gap"))).toBe(true)
    expect(problems.some((p) => p.includes("s8 holds -2"))).toBe(true)
  })
})

// ===========================================================================
// 7 · Concurrency guard
// ===========================================================================

describe("7 · the delivery-note concurrency guard", () => {
  it("a second note for the same remaining quantity is refused even from a stale screen; the true remainder still ships", async () => {
    const id = await stockOrderClosed(10)
    const stale = load(id).noteSlices
    expect(stale).toEqual([])
    const first = await act("issueDeliveryNote 6", issueDeliveryNote(db, noteInput(id, 6, stale)))
    await refused("a second 6 from the same stale screen", () => issueDeliveryNote(db, noteInput(id, 6, stale)), "more_than_ready")
    await refused("more than ready on a fresh screen", () => issueDeliveryNote(db, noteInput(id, 5)), "more_than_ready")
    const second = await act("issueDeliveryNote 4 (stale screen)", issueDeliveryNote(db, noteInput(id, 4, stale)))
    expect([first.noteNumber, second.noteNumber]).toEqual(["DN-2026/001", "DN-2026/002"])
    await refused("anything more", () => issueDeliveryNote(db, noteInput(id, 1, stale)), "more_than_ready")
    expect(listCollection<DeliveryNote>("deliveryNotes")).toHaveLength(2)
    expect(load(id).order.shippedQuantity).toBe(10)
  })
})

describe("rules conformance coverage", () => {
  it("every act another role performs was checked against firestore.rules at least once", () => {
    expect(Object.keys(ACT_ROLES).filter((k) => !RULES_CHECKED.has(k))).toEqual([])
  })
})

/**
 * Seeds the Manufacturing prototype's marble workshop into ONE existing UAT
 * company, so its four guided tours can be walked in the real app:
 *
 *   1. The down-payment gate  — WO-DEMO-056: a client order waiting on Finance
 *      (Sales → Payments → confirm, then release it in the workshop).
 *   2. A full stock-order cycle — WO-DEMO-055: skirting for the warehouse,
 *      ready to release (request slab → Inventory issues → stations → QC →
 *      close → delivery note → Inventory receives).
 *   3. A shortage and an honest date — WO-DEMO-043: Statuario cladding short
 *      of slab (purchase request → Procurement marks arrived → stop at polishing).
 *   4. Scrap above the limit — WO-DEMO-053: 10 m of stair scrapped at cutting,
 *      valued above the manager's approval limit (the cost controller approves;
 *      the manager decides the re-make first; a block notice on BLK-4471).
 *
 * What it writes (deterministic ids, prefixed `mfgdemo_`, so re-running
 * replaces the demo and never touches anything else):
 *   manufacturingDepartments · mfgProducts · a demo warehouse with slabs by
 *   block and station consumables · one sales order awaiting its deposit ·
 *   four work orders · manufacturingSettings ONLY if the company has none.
 *
 * UAT ONLY — refuses to run against any other Firebase project.
 *
 * Usage (from the repo root):
 *   npx tsx scripts/seed-mfg-demo.ts --env .env.uat --org <orgId> [--project <projectId>] [--apply]
 *
 * Without --apply it prints what it would write and exits. --project attaches
 * the two project orders (043, 053) to a real project; without it they are
 * stock orders (the tours don't depend on the source).
 */

import { config } from "dotenv"
import { resolve } from "path"
import type { DeptCapacityFields, MfgBomLine, MfgProduct, RemnantRecord, StageProgress, WorkOrderMaterial, WorkOrderScrap } from "@/lib/manufacturing-engine"
import type { WorkOrderV2 } from "@/lib/manufacturing-writes"
import type { SalesOrder } from "@/lib/sales-orders"

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] ?? null : null
}
const ENV_FILE = arg("--env") || ".env.uat"
config({ path: resolve(process.cwd(), ENV_FILE) })

import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app"
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore"

const UAT_PROJECT = "mdmaktech-uat"
const APPLY = process.argv.includes("--apply")
const ORG = arg("--org")
const PROJECT = arg("--project")

function initAdmin() {
  if (getApps().length > 0) return getApps()[0]!
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (projectId && clientEmail && privateKey) return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  return initializeApp({ credential: applicationDefault(), projectId })
}

// ── Dates relative to today, like the prototype's day offsets ──
const DAY = 86400000
const NOW = Date.now()
const at = (days: number, hour = 9) => new Date(Math.floor((NOW + days * DAY) / DAY) * DAY + hour * 3600000).toISOString()
const date = (days: number) => at(days).slice(0, 10)

// ── People (names only — the demo acts are recorded, not signed by accounts) ──
const BY = {
  badr: "م. بدر السبيعي",
  sami: "أبو سامي",
  lama: "م. لمى الغامدي",
  reem: "ريم العتيبي",
  huda: "هدى الشهري",
  majed: "ماجد القرني",
} as const
const SEED_ID = "seed-mfg-demo"

// ── Stations (the prototype's STA) ──
const STATIONS: Array<DeptCapacityFields & { order: number; name: string }> = [
  { id: "s1", order: 1, name: "التصميم والتقطيع النظري", workers: 2, hoursPerDay: 8, hourlyRate: 85, gate: "drawing" },
  { id: "s6", order: 2, name: "فرز البلاطات واعتماد العميل", workers: 1, hoursPerDay: 8, hourlyRate: 65, gate: "slab" },
  { id: "s7", order: 3, name: "القص بالمنشار الجسري", workers: 2, hoursPerDay: 8, hourlyRate: 70, gate: null },
  { id: "s8", order: 4, name: "التشكيل والحواف", workers: 3, hoursPerDay: 8, hourlyRate: 60, gate: null },
  { id: "s9", order: 5, name: "الحفر والتفريغ", workers: 1, hoursPerDay: 8, hourlyRate: 65, gate: null },
  { id: "s10", order: 6, name: "التلميع والمعالجة", workers: 2, hoursPerDay: 8, hourlyRate: 58, gate: null },
  { id: "s5", order: 7, name: "الفحص والتغليف", workers: 2, hoursPerDay: 8, hourlyRate: 45, gate: null, qcStation: true },
]
const deptId = (org: string, s: string) => `mfgdemo_${org}_${s}`

// ── Materials (Inventory's item cards) ──
const ITEMS = {
  CRM: { name: "رخام كريمة مارفل — بلاطة", unit: "م²", cost: 320, lotted: true },
  STA: { name: "رخام ستاتواريو — بلاطة", unit: "م²", cost: 690, lotted: true },
  BSC: { name: "رخام بيج ساحل — بلاطة", unit: "م²", cost: 245, lotted: true },
  EPX: { name: "غراء إيبوكسي للرخام", unit: "عبوة", cost: 95, lotted: false },
  SEA: { name: "مادة حماية للرخام (سيلر)", unit: "لتر", cost: 140, lotted: false },
  BLD: { name: "أقراص ألماس للقص", unit: "حبة", cost: 340, lotted: false },
  POL: { name: "أقراص تلميع", unit: "طقم", cost: 260, lotted: false },
  CRT: { name: "صندوق شحن خشبي", unit: "صندوق", cost: 85, lotted: false },
} as const
type ItemCode = keyof typeof ITEMS

const STOCK: Array<{ code: ItemCode; qty: number; lot?: string }> = [
  { code: "CRM", qty: 96, lot: "BLK-4471" },
  { code: "CRM", qty: 52, lot: "BLK-4479" },
  { code: "STA", qty: 22, lot: "BLK-7712" },
  { code: "BSC", qty: 260, lot: "BLK-2210" },
  { code: "BSC", qty: 160, lot: "BLK-2244" },
  { code: "EPX", qty: 24 },
  { code: "SEA", qty: 60 },
  { code: "BLD", qty: 12 },
  { code: "POL", qty: 18 },
  { code: "CRT", qty: 40 },
]

// ── Products (the prototype's PROD) — consumables come from station custody ──
type Line = [ItemCode, number, string, "w" | "c"]
const bom = (org: string, lines: Line[]): MfgBomLine[] =>
  lines.map(([code, qty, s, kind]) => ({
    itemName: ITEMS[code].name,
    unit: ITEMS[code].unit,
    qtyPerUnit: qty,
    departmentId: deptId(org, s),
    withWaste: kind === "w",
    unitCost: ITEMS[code].cost,
    lotted: ITEMS[code].lotted && kind === "w",
    custody: kind === "c",
  }))
const route = (org: string, steps: Array<[string, number | null]>) => steps.map(([s, h]) => ({ departmentId: deptId(org, s), departmentName: STATIONS.find((x) => x.id === s)!.name, hoursPerUnit: h }))

const products = (org: string): Array<Omit<MfgProduct, "createdAt" | "updatedAt">> => [
  {
    id: `mfgdemo_${org}_pr13`,
    organizationId: org,
    name: "درج رخام — قائمة ونائمة",
    unit: "م.ط",
    family: "stone",
    requiresMeasurement: true,
    requiresDrawingApproval: true,
    requiresSlabApproval: true,
    wastePercent: 35,
    referenceBuyPrice: 620,
    route: route(org, [["s1", 0.12], ["s6", 0.08], ["s7", 0.3], ["s8", 0.45], ["s10", 0.28], ["s5", 0.1]]),
    bom: bom(org, [["CRM", 0.85, "s7", "w"], ["BLD", 0.018, "s7", "c"], ["EPX", 0.09, "s8", "c"], ["POL", 0.024, "s10", "c"], ["SEA", 0.08, "s10", "c"], ["CRT", 0.07, "s5", "c"]]),
  },
  {
    id: `mfgdemo_${org}_pr15`,
    organizationId: org,
    name: "وزرة رخام 10 سم",
    unit: "م.ط",
    family: "stone",
    requiresMeasurement: false,
    requiresDrawingApproval: false,
    requiresSlabApproval: false,
    wastePercent: 15,
    referenceBuyPrice: 70,
    route: route(org, [["s7", 0.06], ["s8", 0.07], ["s10", 0.05], ["s5", 0.02]]),
    bom: bom(org, [["BSC", 0.12, "s7", "w"], ["BLD", 0.003, "s7", "c"], ["POL", 0.004, "s10", "c"], ["CRT", 0.01, "s5", "c"]]),
  },
  {
    id: `mfgdemo_${org}_pr16`,
    organizationId: org,
    name: "واجهة رخام خارجية ستاتواريو",
    unit: "م²",
    family: "stone",
    requiresMeasurement: true,
    requiresDrawingApproval: true,
    requiresSlabApproval: true,
    wastePercent: 30,
    referenceBuyPrice: 1250,
    route: route(org, [["s1", 0.14], ["s6", 0.09], ["s7", 0.4], ["s8", 0.36], ["s10", 0.26], ["s5", 0.11]]),
    bom: bom(org, [["STA", 1, "s7", "w"], ["BLD", 0.02, "s7", "c"], ["EPX", 0.12, "s8", "c"], ["POL", 0.02, "s10", "c"], ["SEA", 0.1, "s10", "c"], ["CRT", 0.08, "s5", "c"]]),
  },
]

const progress = (p: Pick<MfgProduct, "route">, rows: Array<[number, number]>): StageProgress[] =>
  p.route.map((r, i) => ({ departmentId: r.departmentId, done: rows[i]?.[0] ?? 0, rejected: 0, rework: 0, hours: rows[i]?.[1] ?? 0 }))

type SeedOrder = Omit<WorkOrderV2, "createdAt" | "updatedAt"> & { createdAt?: unknown; updatedAt?: unknown }

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (projectId !== UAT_PROJECT) {
    console.error(`Refusing to run: FIREBASE_PROJECT_ID is "${projectId ?? ""}", this script only seeds ${UAT_PROJECT}.`)
    process.exit(1)
  }
  if (!ORG) {
    console.error("Missing --org <orgId> (the company to seed).")
    process.exit(1)
  }
  initAdmin()
  const db: Firestore = getFirestore()

  const orgDoc = await db.collection("users").doc(ORG).get()
  if (!orgDoc.exists) {
    console.error(`No user/org owner ${ORG} on ${UAT_PROJECT}.`)
    process.exit(1)
  }
  let projectName: string | null = null
  if (PROJECT) {
    const p = await db.collection("projects").doc(PROJECT).get()
    if (!p.exists || p.data()?.organizationId !== ORG) {
      console.error(`Project ${PROJECT} does not belong to ${ORG}.`)
      process.exit(1)
    }
    projectName = (p.data()?.name as string) || (p.data()?.title as string) || null
  }

  const writes: Array<{ path: string; data: Record<string, unknown>; onlyIfMissing?: boolean }> = []
  const put = (path: string, data: object, onlyIfMissing = false) => writes.push({ path, data: data as Record<string, unknown>, onlyIfMissing })

  // Stations
  for (const s of STATIONS) {
    const { id, ...rest } = s
    put(`manufacturingDepartments/${deptId(ORG, id)}`, { ...rest, organizationId: ORG, leadUserId: null, leadUserName: null, updatedAt: FieldValue.serverTimestamp() })
  }
  // Products
  const prods = products(ORG)
  for (const p of prods) {
    const { id, ...rest } = p
    put(`mfgProducts/${id}`, { ...rest, archived: false, updatedAt: FieldValue.serverTimestamp() })
  }
  const P = (key: "pr13" | "pr15" | "pr16") => prods.find((p) => p.id.endsWith(`_${key}`))!

  // Settings — only when the company has none (Finance owns the policies)
  put(
    `manufacturingSettings/${ORG}`,
    { organizationId: ORG, features: { time: true, estimates: true, checklists: true }, overheadRatePerHour: 32, scrapApprovalLimit: 3000, answerWindowHours: 24, noteEscalationHours: 48, estimateValidityDays: 15, remnantValuePercent: 50, updatedAt: FieldValue.serverTimestamp() },
    true
  )

  // Warehouse and stock
  const WH = `mfgdemo_${ORG}_central`
  put(`warehouses/${WH}`, { organizationId: ORG, name: "مستودع الرخام (تجريبي)", location: null, description: "بيانات عرض لوحدة التصنيع", isCentral: true, updatedAt: FieldValue.serverTimestamp() })
  STOCK.forEach((s, i) => {
    const it = ITEMS[s.code]
    put(`warehouses/${WH}/inventoryItems/mfgdemo_${i}`, { organizationId: ORG, warehouseId: WH, name: it.name, quantity: s.qty, unit: it.unit, unitCost: it.cost, lot: s.lot ?? null, remnant: false, updatedAt: FieldValue.serverTimestamp() })
  })

  // Numbers that never collide with the company's own sequences
  const [ordersSnap, salesSnap] = await Promise.all([
    db.collection("workOrders").where("organizationId", "==", ORG).get(),
    db.collection("salesOrders").where("organizationId", "==", ORG).get(),
  ])
  const demoOrderIds = new Set(["055", "056", "043", "053"].map((n) => `mfgdemo_${ORG}_wo${n}`))
  const maxWo = Math.max(0, ...ordersSnap.docs.filter((d) => !demoOrderIds.has(d.id)).map((d) => Number(d.data().orderNumber) || 0))
  const soId = `mfgdemo_${ORG}_so131`
  const maxSo = Math.max(0, ...salesSnap.docs.filter((d) => d.id !== soId).map((d) => Number(d.data().orderNumber) || 0))
  const soNumber = (salesSnap.docs.find((d) => d.id === soId)?.data().orderNumber as number | undefined) ?? maxSo + 1

  // Tour 1 — the sales order waiting on its deposit
  const skirting = P("pr15")
  const so: Omit<SalesOrder, "id" | "createdAt" | "updatedAt"> = {
    organizationId: ORG,
    orderNumber: soNumber,
    type: "standard",
    status: "awaiting_deposit",
    contactId: null,
    contactName: "شركة الأفق للمقاولات",
    payment: { kind: "deposit", depositPercent: 40, depositPaid: false, depositPaidAt: null, depositReportedAt: at(-1, 11), depositReportedBy: BY.reem },
    promiseDate: date(24),
    vatPercent: 15,
    lines: [{ name: skirting.name, unit: skirting.unit, quantity: 400, unitPrice: 80, unitCost: null }],
    createdByUserId: SEED_ID,
    createdByUserName: BY.reem,
  }
  put(`salesOrders/${soId}`, { ...so, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })

  const base = (n: string, num: number, product: Omit<MfgProduct, "createdAt" | "updatedAt">, quantity: number, over: Partial<SeedOrder>): [string, SeedOrder] => {
    const id = `mfgdemo_${ORG}_wo${n}`
    return [
      id,
      {
        id,
        organizationId: ORG,
        orderNumber: num,
        docNumber: `WO-DEMO-${n}`,
        title: product.name,
        items: [{ name: product.name, quantity, unit: product.unit }],
        output: { name: product.name, quantity, unit: product.unit },
        source: { kind: "manual" },
        status: "open",
        currentStageIndex: 0,
        stages: [],
        createdByUserId: SEED_ID,
        createdByUserName: BY.badr,
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity,
        createdAtIso: at(-1, 8),
        releasedAt: null,
        progress: progress(product, []),
        materials: [],
        scrapRecords: [],
        closures: [],
        remnants: [],
        purchaseRequests: [],
        log: [],
        ...over,
      },
    ]
  }
  const projectFields = PROJECT ? { projectId: PROJECT, projectName, sourceKind: "project" as const } : { sourceKind: "stock" as const }

  const orders: Array<[string, SeedOrder]> = []

  // Tour 2 — stock skirting, ready to release
  orders.push(base("055", maxWo + 1, skirting, 180, { sourceKind: "stock", neededBy: date(21) }))

  // Tour 1 — the client order behind the deposit
  orders.push(
    base("056", maxWo + 2, skirting, 400, {
      sourceKind: "client",
      salesOrderId: soId,
      salesOrderNumber: soNumber,
      source: { kind: "manual", contactName: so.contactName },
      neededBy: date(24),
      requestedByName: BY.reem,
    })
  )

  // Tour 3 — Statuario cladding short of slab, drawing with the consultant
  const cladding = P("pr16")
  orders.push(
    base("043", maxWo + 3, cladding, 34, {
      ...projectFields,
      purchaseRequestRef: "PR-2026/071",
      pmRequestRef: "PM-2026/052",
      neededBy: date(13),
      createdAtIso: at(-7, 8),
      releasedAt: at(-6, 10),
      releasedByName: BY.badr,
      survey: { at: at(-8, 10), by: BY.badr, note: null, measuredQuantity: 34 },
      drawing: { revision: 1, approverOrg: "consultant", submittedAt: at(-5, 12), submittedBy: BY.badr, code: null },
      progress: progress(cladding, [[0, 4.9]]),
      requestedByName: BY.huda,
    })
  )

  // Tour 4 — stair scrap above the limit, a remnant returned, block BLK-4471
  const stair = P("pr13")
  const s7 = deptId(ORG, "s7")
  const crm = ITEMS.CRM
  const matRow = (i: number, dept: string, qty: number, daysAgo: number): WorkOrderMaterial => ({
    id: `mfgdemo_m${i}`,
    requestNumber: `WR-DEMO-${180 + i}`,
    itemName: crm.name,
    unit: crm.unit,
    quantity: qty,
    departmentId: dept,
    lot: "BLK-4471",
    state: "received",
    unitCost: crm.cost,
    warehouseId: WH,
    requestedByUserId: SEED_ID,
    requestedByName: BY.sami,
    requestedAt: at(-daysAgo, 8),
    releasedByName: BY.majed,
    releasedAt: at(-daysAgo, 10),
    receivedByName: BY.sami,
    receivedAt: at(-daysAgo, 12),
  })
  const scrap: WorkOrderScrap = {
    id: "mfgdemo_sc1",
    quantity: 10,
    value: 4257,
    reason: "انكسرت على المنشار عند عرق ضعيف — عيب في البلوك لم يظهر في الفرز",
    departmentId: s7,
    index: 2,
    defect: "vein",
    cause: "material",
    raisedByUserId: SEED_ID,
    raisedByName: BY.lama,
    raisedAt: at(-2, 13),
    status: "pending",
    decision: null,
  }
  const remnant: RemnantRecord = {
    id: "mfgdemo_r1",
    area: 1.8,
    itemName: crm.name,
    unit: crm.unit,
    lot: "BLK-4471",
    value: Math.round(1.8 * crm.cost * 0.5),
    state: "returned",
    source: "output",
    by: BY.sami,
    at: at(-2, 15),
  }
  orders.push(
    base("053", maxWo + 4, stair, 40, {
      ...projectFields,
      purchaseRequestRef: "PR-2026/069",
      pmRequestRef: "PM-2026/050",
      neededBy: date(11),
      createdAtIso: at(-14, 8),
      releasedAt: at(-10, 10),
      releasedByName: BY.badr,
      survey: { at: at(-12, 10), by: BY.badr, note: null, measuredQuantity: 40 },
      drawing: { revision: 1, approverOrg: "technical_office", submittedAt: at(-12, 12), submittedBy: BY.badr, code: "A", recordedBy: "المكتب الفني — إدارة المشاريع", recordedAt: at(-11, 9) },
      slabApproval: { at: at(-9, 11), by: BY.lama, lot: "BLK-4471", signedOn: date(-9), quantity: 46, photosAttached: true },
      progress: progress(stair, [[40, 4.8], [40, 3.2], [28, 9.1], [14, 7.2], [0, 0], [0, 0]]),
      // Profiling draws its adhesive from station custody — only the slab is requested.
      materials: [matRow(1, s7, 46, 9)],
      scrapRecords: [scrap],
      remnants: [remnant],
      requestedByName: BY.huda,
    })
  )
  for (const [id, o] of orders) put(`workOrders/${id}`, { ...o, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })

  // ── Report / apply ──
  console.log(`${APPLY ? "Writing" : "Would write"} ${writes.length} documents to ${UAT_PROJECT} for org ${ORG}${PROJECT ? ` (project ${PROJECT})` : ""}:`)
  for (const w of writes) console.log(`  ${w.onlyIfMissing ? "[if missing] " : ""}${w.path}`)
  if (!APPLY) {
    console.log("\nDry run — add --apply to write.")
    return
  }
  for (const w of writes) {
    const ref = db.doc(w.path)
    if (w.onlyIfMissing && (await ref.get()).exists) {
      console.log(`  [kept] ${w.path} already exists`)
      continue
    }
    await ref.set(w.data)
  }
  console.log("\nDone. Assign station leads and group permissions in Manufacturing → Settings and Team before walking the tours.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

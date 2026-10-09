// Manufacturing + Inventory against the REAL firestore.rules (Google's rules-test API), UAT documents read-only.
// Every ALLOW case is "the client's own guard lets this role do it" — the rules must agree.
// Cases whose name starts with [client-vs-rules] are the ones where a role the client lets through is refused.

import cp from "child_process"
import fs from "fs"
import path from "path"
import type { RuleCase, RuleResult } from "./sim"
import { openUatDb, UAT_PROJECT } from "../lib/uat-db"

// One gcloud token for the whole run (the harness shells out to gcloud on every API call).
const realExec = cp.execSync
let cachedToken = ""
let cachedAt = 0
;(cp as { execSync: unknown }).execSync = ((cmd: string, opts?: unknown) => {
  if (String(cmd).startsWith("gcloud auth print-access-token")) {
    if (!cachedToken || Date.now() - cachedAt > 20 * 60_000) {
      cachedToken = String(realExec(cmd, opts as never))
      cachedAt = Date.now()
    }
    return cachedToken
  }
  return realExec(cmd, opts as never)
}) as typeof cp.execSync

type Data = Record<string, unknown>
type Expect = "ALLOW" | "DENY"

const ORG = "uilut3A3HnV13RiZXYqd3KgeNCH3"
const OWNER = ORG
const OTHER_ORG = "org-other-1"
const T0 = "2026-10-08T08:00:00Z"
const T1 = "2026-10-08T09:00:00Z"

// ---------------------------------------------------------------------------
// People: one synthetic user per role, each with one team group
// ---------------------------------------------------------------------------

const FINANCE = ["projects.view", "projects.publish", "offers.view", "offers.accept", "po.approve", "invoices.manage", "accounting.view", "accounting.post"]
const SUPPLY = ["projects.view", "rfq.create", "rfq.manage", "offers.view", "po.expedite", "suppliers.manage", "deliveries.confirm", "warehouses.manage", "warehouses.receive"]

const GROUPS: Record<string, string[]> = {
  mgr: ["manufacturing.manage"],
  work: ["manufacturing.work"],
  qc: ["manufacturing.qc"],
  cost: ["manufacturing.cost"],
  view: ["manufacturing.view"],
  whm: ["warehouses.manage"],
  whr: ["warehouses.receive"],
  proj: ["projects.edit"],
  projpub: ["projects.publish"],
  sales: ["sales.manage"],
  salesapp: ["sales.approve"],
  rfqm: ["rfq.manage"],
  rfqc: ["rfq.create"],
  buyer: ["offers.accept"],
  poap: ["po.approve"],
  deliv: ["deliveries.confirm"],
  fin: FINANCE,
  supply: SUPPLY,
  acc: ["accounting.close"],
  hr: ["employees.manage"],
  crmclose: ["crm.close"],
  none: [],
}

const uidOf = (role: string): string | null => (role === "owner" ? OWNER : role === "anon" ? null : role === "stranger" ? "u-stranger" : `u-${role}`)

const directory: Record<string, Data | null> = {
  [`users/${OWNER}`]: { organizationId: ORG, role: "Contractor", organizationRole: "owner" },
  "users/u-stranger": { organizationId: OTHER_ORG, role: "Contractor", organizationRole: "owner" },
  "users/u-seat": { organizationId: ORG, role: "Contractor", organizationRole: "member" },
  "projects/p1/members/u-seat": { groupId: "tg-proj" },
  "projects/p1/members/u-stranger": null,
  [`projects/p1/members/${OWNER}`]: null,
  "projects/p1": { organizationId: ORG },
  "projects/p2": { organizationId: ORG, pm: { lifecycle: "closed" } },
  "warehouses/wh1": { organizationId: ORG },
}
for (const [key, perms] of Object.entries(GROUPS)) {
  directory[`users/u-${key}`] = { organizationId: ORG, role: "Contractor", organizationRole: "member", ...(key === "none" ? {} : { defaultGroupId: `tg-${key}` }) }
  directory[`teamGroups/tg-${key}`] = { organizationId: ORG, permissions: perms }
  directory[`projects/p1/members/u-${key}`] = null
  directory[`projects/p2/members/u-${key}`] = null
}
directory["teamGroups/tg-proj"] = { organizationId: ORG, permissions: ["projects.edit"] }

// ---------------------------------------------------------------------------
// Case plumbing
// ---------------------------------------------------------------------------

const cases: RuleCase[] = []
const mk = (name: string, role: string, method: RuleCase["method"], path: string, before: Data | undefined, after: Data | undefined, expect: Expect, extra: Record<string, Data | null> = {}): void => {
  cases.push({ name, uid: uidOf(role), method, path, before, after, overrides: { ...directory, ...extra }, expect })
}

const BASE_DENY = ["view"]
const STRANGER_ACTS = /^(recordOutput \(good only\)|qcDecide \(scrap\)|reviewScrap \(approve, refreshes|receiveRemnant$|markPurchaseArrived \(Procurement|recordDrawingResult \(A\)$|issueWithdrawal$|releaseOrder|requestStationMaterials|reviewVariance|requestOrderChange$)/

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

const stage = (id: string, status: string, startedAt: string | null = null): Data => ({ departmentId: id, departmentName: id, assigneeUserId: null, assigneeName: null, status, startedAt, completedAt: null, note: null })
const prog = (done = 0, rejected = 0, rework = 0): Data => ({ done, rejected, rework, hours: 0, back: 0 })
const stages0 = [stage("s1", "in_progress"), stage("s7", "pending"), stage("s5", "pending")]
const stages1 = [stage("s1", "in_progress", T1), stage("s7", "pending"), stage("s5", "pending")]

const WO: Data = {
  organizationId: ORG,
  orderNumber: 57,
  docNumber: "WO-2026/057",
  title: "Marble stair",
  items: [{ name: "Marble stair", quantity: 40, unit: "m" }],
  output: { name: "Marble stair", quantity: 40, unit: "m" },
  source: { kind: "manual", contactId: null, contactName: null, quotationId: null, quotationNumber: null },
  sourceKind: "stock",
  projectId: null,
  projectName: null,
  salesOrderId: null,
  salesOrderNumber: null,
  status: "open",
  currentStageIndex: 0,
  stages: stages0,
  dueDate: "2026-10-20",
  productId: "prod1",
  productName: "Marble stair",
  unit: "m",
  quantity: 40,
  neededBy: "2026-10-20",
  createdAtIso: T0,
  releasedAt: T0,
  releasedByName: "Badr",
  survey: null,
  drawing: null,
  slabApproval: null,
  rush: null,
  progress: [prog(), prog(), prog()],
  materials: [],
  scrapRecords: [],
  rejects: [],
  qcReleases: [],
  closures: [],
  frozenCost: null,
  remade: 0,
  shortfall: 0,
  brokenResolved: 0,
  remnants: [],
  purchaseRequests: [],
  overrides: {},
  changeRequest: null,
  cancellation: null,
  varianceReviews: {},
  checklists: {},
  log: [],
  createdByUserId: "u-mgr",
  createdByUserName: "Badr",
  createdAt: T0,
  updatedAt: T0,
  completedAt: null,
}
const WO_PROJECT: Data = { ...WO, sourceKind: "project", projectId: "p1", projectName: "Tower" }
const WO_CANCELLED: Data = { ...WO, status: "cancelled", cancellation: { at: T0, by: "Badr", reason: "client left", wip: "scrap", fromModule: null } }

const woPath = "workOrders/wo1"
const patched = (before: Data, patch: Data): Data => ({ ...before, ...patch, updatedAt: T1 })

/** One work-order update, for every listed role. */
function woAct(name: string, patch: Data, allow: string[], deny: string[] = [], before: Data = WO, extra: Record<string, Data | null> = {}, tag = ""): void {
  const after = patched(before, patch)
  for (const r of allow) mk(`${tag}${name}: ${r} allowed`, r, "update", woPath, before, after, "ALLOW", extra)
  const refused = new Set(deny)
  if (STRANGER_ACTS.test(name)) {
    refused.add("none")
    refused.add("stranger")
    refused.add("anon")
  }
  for (const r of refused) mk(`${name}: ${r} refused`, r, "update", woPath, before, after, "DENY", extra)
}

const reject1 = { id: "NC-1", index: 0, departmentId: "s1", quantity: 2, defect: "crack", cause: "s1", photoAttached: true, note: null, by: "Lead", byId: "u-work", at: T1 }
const remnant1 = { id: "RM-1", area: 1.5, itemName: "Crema slab", unit: "m2", lot: "BLK-1", value: 100, state: "returned", source: "output", by: "Lead", byId: "u-work", at: T1 }
const matReq = (n: string, state = "requested") => ({ id: `${n}_0`, requestNumber: n, itemName: "Diamond blades", unit: "pc", quantity: 2, departmentId: "s7", lot: null, state, unitCost: null, warehouseId: null, requestedByUserId: "u-work", requestedByName: "Lead", requestedAt: T1, consentNote: null, releasedByName: null, releasedAt: null, receivedByName: null, receivedAt: null })
const matReleased = { ...matReq("WR-2026/001", "released"), unitCost: 340, warehouseId: "wh1", releasedByName: "Keeper", releasedAt: T1 }
const matReceived = { ...matReleased, state: "received", receivedByName: "Lead", receivedAt: T1 }
const scrapPending = { id: "SC-1", quantity: 2, value: 4000, reason: "chipped", departmentId: "s7", index: 1, defect: "chip", cause: "s7", raisedByUserId: "u-qc", raisedByName: "Lama", raisedAt: T0, status: "pending", approvedByName: null, approvedAt: null, classification: null, bearer: null, question: null, clarification: null, decision: null, remnantCredit: null }
const scrapApproved = { ...scrapPending, status: "approved", approvedByName: "Noura", approvedAt: T1, classification: "normal", bearer: "company" }
const scrapReturned = { ...scrapPending, status: "returned", question: "which blade?", questionBy: "Noura" }
const scrapClarified = { ...scrapReturned, status: "pending", clarification: "dull blade", cause: "blade" }
const note = (kind: string) => ({ kind, at: T1, by: "x", detail: null, tone: "neutral" })

// recordOutput (a station)
woAct("recordOutput (good only)", { progress: [prog(10), prog(), prog()], stages: stages1 }, ["owner", "mgr", "work"], ["cost", "whm", "sales", ...BASE_DENY])
woAct("recordOutput (rejects + remnant)", { progress: [prog(8, 2), prog(), prog()], rejects: [reject1], remnants: [remnant1], stages: stages1 }, ["owner", "mgr", "work"], ["cost", "whm", ...BASE_DENY])
woAct("recordOutput at QC & packing (qcReleases)", { progress: [prog(), prog(), prog(5)], qcReleases: [{ quantity: 5, by: "Lama", byId: "u-qc", at: T1, photosAttached: true }], stages: stages1 }, ["owner", "qc"], ["work", "cost", "whm", ...BASE_DENY])
woAct("completeOrderStep (manual gate)", { progress: [prog(40), prog(), prog()] }, ["owner", "mgr", "work"], ["cost", "whm", "sales", ...BASE_DENY])
woAct("submitDrawing", { drawing: { revision: 1, approverOrg: "technical_office", submittedAt: T1, submittedBy: "Lead", submittedById: "u-work", code: null, cutList: [] }, progress: [prog(), prog(), prog()].map((p, i) => (i === 0 ? { ...p, hours: 2 } : p)) }, ["owner", "mgr", "work"], ["qc", "cost", "whm", "sales", ...BASE_DENY])

// materials: ours request/receive, Inventory issues
woAct("requestStationMaterials", { materials: [matReq("WR-2026/001")] }, ["owner", "mgr", "work", "qc"], ["cost", "sales", ...BASE_DENY])
const WO_ISSUED: Data = { ...WO, materials: [matReleased] }
woAct("confirmMaterialReceipt", { materials: [matReceived], materialCost: 680, log: [note("materials_note")] }, ["owner", "mgr", "work", "qc"], ["cost", "whm", "sales", ...BASE_DENY], WO_ISSUED)
const WO_REQUESTED: Data = { ...WO, materials: [matReq("WR-2026/001")] }
woAct("issueWithdrawal", { materials: [matReleased] }, ["owner", "whm", "mgr"], ["cost", "sales", "proj", "rfqm", ...BASE_DENY], WO_REQUESTED)
woAct("issueWithdrawal (storekeeper with receive only)", { materials: [matReleased] }, ["whr"], [], WO_REQUESTED)
woAct("overrideMaterials", { overrides: { s7: { reason: "urgent", by: "Badr", byId: "u-mgr", at: T1 } }, log: [note("materials_override")] }, ["owner", "mgr"], ["work", "qc", "cost", "whm", ...BASE_DENY])
woAct("requestPurchase (manager raises a shortfall)", { purchaseRequests: [{ id: "PR-1", itemName: "Blades", unit: "pc", quantity: 4, needBy: null, note: null, by: "Badr", byId: "u-mgr", at: T1, state: "sent", arrivedAt: null }] }, ["owner", "mgr"], ["rfqm", "rfqc", "whm", "work", "buyer", ...BASE_DENY])
woAct("toggleChecklistItem", { checklists: { s7: { k1: { by: "Lead", at: T1 } } } }, ["owner", "mgr", "work", "qc"], ["cost", "whm", "sales", ...BASE_DENY])

// quality
woAct("qcDecide (rework)", { progress: [prog(), prog(0, 0, 2), prog()], log: [note("qc_rework")] }, ["owner", "qc"], BASE_DENY)
woAct("qcDecide (concession)", { progress: [prog(), prog(2), prog()], log: [note("qc_concession")], qcReleases: [{ quantity: 2, by: "Lama", byId: "u-qc", at: T1, photosAttached: false }] }, ["owner", "qc"], ["work", "cost", "whm", ...BASE_DENY])
woAct("qcDecide (scrap)", { progress: [prog(), prog(), prog()].map((p, i) => (i === 1 ? { ...p, rejected: 1 } : p)), scrapRecords: [scrapPending] }, ["owner", "qc"], ["work", "cost", "whm", "sales", ...BASE_DENY])
woAct("qcDecide (remnant)", { progress: [prog(), prog(), prog()].map((p, i) => (i === 1 ? { ...p, rejected: 1 } : p)), scrapRecords: [scrapPending], remnants: [{ ...remnant1, source: "qc", by: "Lama", byId: "u-qc" }] }, ["owner", "qc"], ["work", "cost", "whm", ...BASE_DENY])
woAct("signOffSlab", { slabApproval: { at: T1, by: "Lama", byId: "u-qc", lot: "BLK-1", signedOn: "2026-10-08", quantity: 40, slabNumbers: null, photosAttached: true, formUrl: "https://f/x.pdf", formName: "x.pdf", note: null, alternativeLot: null }, materials: [{ ...matReq("WR-2026/001"), lot: "BLK-1" }] }, ["owner", "mgr", "qc"], ["work", "cost", "whm", "sales", ...BASE_DENY], WO_REQUESTED)
woAct("clarifyScrap", { scrapRecords: [scrapClarified], log: [note("scrap_clarified")] }, ["owner", "qc"], ["work", "whm", ...BASE_DENY], { ...WO, scrapRecords: [scrapReturned] })

// cost controller
const WO_SCRAP: Data = { ...WO, scrapRecords: [scrapPending] }
woAct("reviewScrap (approve, refreshes status cache)", { scrapRecords: [scrapApproved], status: "done", completedAt: T1 }, ["owner", "cost", "mgr"], ["work", "qc", "whm", "sales", ...BASE_DENY], WO_SCRAP)
woAct("reviewScrap (approve, supplier claim log)", { scrapRecords: [{ ...scrapApproved, bearer: "supplier" }], log: [note("scrap_claim_supplier")] }, ["owner", "cost", "mgr"], ["work", "whm", "sales", ...BASE_DENY], WO_SCRAP)
woAct("reviewScrap (return with question)", { scrapRecords: [scrapReturned] }, ["owner", "cost", "mgr"], ["whm", "sales", ...BASE_DENY], WO_SCRAP)
woAct("reviewScrap (approve) on a CANCELLED order's write-off", { scrapRecords: [scrapApproved] }, ["cost"], [], { ...WO_CANCELLED, scrapRecords: [scrapPending] }, {}, "[client-vs-rules] ")
woAct("reviewScrap (approve) on a CANCELLED order's write-off, manager", { scrapRecords: [scrapApproved] }, ["mgr", "owner"], [], { ...WO_CANCELLED, scrapRecords: [scrapPending] })
woAct("reviewVariance", { varianceReviews: { s7: { cause: "material", note: null, by: "Noura", at: T1 } }, log: [note("variance_reviewed")] }, ["owner", "cost", "mgr"], ["work", "qc", "whm", "sales", ...BASE_DENY])

// manager's decisions
woAct("releaseOrder", { releasedAt: T1, releasedByName: "Badr", releasedById: "u-mgr" }, ["owner", "mgr"], ["work", "qc", "cost", "whm", "sales", "proj", ...BASE_DENY], { ...WO, releasedAt: null, releasedByName: null })
woAct("rushOrder", { rush: { reason: "client", by: "Badr", at: T1, delays: [12] }, log: [note("rushed")] }, ["owner", "mgr"], ["work", "qc", "cost", "whm", "sales", ...BASE_DENY])
woAct("recordSurvey", { survey: { at: "2026-10-08", by: "Badr", byId: "u-mgr", note: null, measuredQuantity: 41, sketchUrl: "https://f/s.png", sketchName: "s.png" }, log: [note("survey_mismatch")] }, ["owner", "mgr"], ["work", "qc", "cost", "whm", "sales", "proj", ...BASE_DENY])
woAct("decideRemake (scrap)", { scrapRecords: [{ ...scrapApproved, decision: "remake", decidedBy: "Badr", decidedAt: T1 }], progress: [prog(0, 0, 2), prog(), prog()], remade: 2, log: [note("remake_scrap")] }, ["owner", "mgr"], ["work", "qc", "cost", "whm", ...BASE_DENY], { ...WO, scrapRecords: [scrapApproved] })
woAct("decideRemake (breakage, alt. lot, status cache)", { brokenResolved: 1, progress: [prog(0, 0, 1), prog(), prog()], remade: 1, slabApproval: { lot: "BLK-1", alternativeLot: { lot: "BLK-2", consent: "ok", by: "Badr", at: T1 } }, log: [note("remake_breakage")], status: "open", completedAt: null }, ["owner", "mgr"], ["work", "qc", "cost", "whm", ...BASE_DENY], { ...WO, status: "done", slabApproval: { lot: "BLK-1", alternativeLot: null }, completedAt: T0 })
woAct("closeProduction (final: frozen cost)", { closures: [{ quantity: 40, by: "Badr", byId: "u-mgr", at: T1 }], frozenCost: { cost: 12000, at: T1, by: "Badr" } }, ["owner", "mgr"], ["work", "qc", "cost", "whm", "sales", ...BASE_DENY])
woAct("issueDeliveryNote (order side)", { deliveryNoteId: "dn1", deliveryNoteNumber: "DN-2026/001", shippedQuantity: 40 }, ["owner", "mgr"], ["work", "qc", "cost", "whm", "sales", "proj", ...BASE_DENY])
woAct("applyOrderChange (quantity)", { quantity: 30, items: [{ name: "Marble stair", quantity: 30, unit: "m" }], output: { name: "Marble stair", quantity: 30, unit: "m" }, progress: [prog(), prog(), prog()], changeRequest: null, log: [note("quantity_changed")] }, ["owner", "mgr"], ["work", "qc", "cost", "whm", "sales", ...BASE_DENY], { ...WO, changeRequest: { kind: "quantity", newQuantity: 30, reason: "r", module: "sales", by: "x", byId: "u-sales", at: T0 } })
woAct("applyOrderChange (cancel with write-off + remnant)", { status: "cancelled", changeRequest: null, cancellation: { at: T1, by: "Badr", reason: "r", wip: "scrap", fromModule: null }, materials: [], scrapRecords: [scrapPending], remnants: [remnant1], log: [note("cancelled")] }, ["owner", "mgr"], ["work", "qc", "cost", "whm", "sales", ...BASE_DENY])

// other modules
woAct("receiveRemnant", { remnants: [{ ...remnant1, state: "received", receivedBy: "Keeper", receivedAt: T1, warehouseId: "wh1" }] }, ["owner", "whm", "whr", "mgr"], ["cost", "sales", "proj", "rfqm", ...BASE_DENY], { ...WO, remnants: [remnant1] })
woAct("receiveRemnant on a CANCELLED order (cancel-with-remnant returns it to stock)", { remnants: [{ ...remnant1, state: "received", receivedBy: "Keeper", receivedAt: T1, warehouseId: "wh1" }] }, ["whm", "whr"], [], { ...WO_CANCELLED, remnants: [remnant1] }, {}, "[client-vs-rules] ")
woAct("receiveDeliveryNote (order side, central warehouse)", { receivedAt: T1, receivedByUserId: "u-whr", receivedByUserName: "Keeper" }, ["owner", "whm", "whr"], ["work", "qc", "cost", "rfqm", "buyer", ...BASE_DENY])
woAct("receiveDeliveryNote (order side, completes the order)", { receivedAt: T1, receivedByUserId: "u-whr", receivedByUserName: "Keeper", status: "done", completedAt: T1 }, ["owner", "whm", "whr"], ["work", "qc", "cost", ...BASE_DENY])
woAct("receiveDeliveryNote (order side, project custody, projects.edit)", { receivedAt: T1, receivedByUserId: "u-proj", receivedByUserName: "Eng", status: "done", completedAt: T1 }, ["owner", "proj", "whm"], ["work", "qc", "cost", "buyer", ...BASE_DENY], WO_PROJECT)
woAct("receiveDeliveryNote (order side, project custody, project seat)", { receivedAt: T1, receivedByUserId: "u-seat", receivedByUserName: "Eng", status: "done", completedAt: T1 }, ["seat"], [], WO_PROJECT)
woAct("receiveDeliveryNote (order side) on a CANCELLED order", { receivedAt: T1, receivedByUserId: "u-whr", receivedByUserName: "Keeper" }, ["whr", "whm"], [], WO_CANCELLED, {}, "[client-vs-rules] ")
woAct("recordDrawingResult (A)", { drawing: { revision: 1, approverOrg: "client", submittedAt: T0, code: "A", resultNotes: null, approverName: "Client", recordedBy: "Sara", recordedById: "u-sales", recordedAt: T1 }, log: [note("drawing_a")] }, ["owner", "sales", "proj", "mgr"], ["qc", "cost", "whm", "buyer", "rfqm", ...BASE_DENY], { ...WO, drawing: { revision: 1, approverOrg: "client", submittedAt: T0, code: null } })
woAct("recordDrawingResult (A) on a project order", { drawing: { revision: 1, approverOrg: "technical_office", submittedAt: T0, code: "A", recordedBy: "Eng", recordedById: "u-proj", recordedAt: T1 }, log: [note("drawing_a")] }, ["proj", "seat"], ["qc", "cost", "whm", ...BASE_DENY], { ...WO_PROJECT, drawing: { revision: 1, approverOrg: "technical_office", submittedAt: T0, code: null } })
woAct("requestOrderChange", { changeRequest: { kind: "quantity", newQuantity: 30, reason: "r", module: "sales", by: "Sara", byId: "u-sales", at: T1 } }, ["owner", "sales", "proj", "mgr"], ["work", "qc", "cost", "whm", "buyer", "rfqm", ...BASE_DENY])
woAct("requestOrderChange on a project order (project seat)", { changeRequest: { kind: "cancel", newQuantity: null, reason: "r", module: "projects", by: "Eng", byId: "u-seat", at: T1 } }, ["seat", "proj"], ["work", "none"], WO_PROJECT)

// procurement answers a purchase request
const pr = (state: string, extra: Data = {}) => ({ id: "PR-1", itemName: "Blades", unit: "pc", quantity: 4, needBy: null, note: null, by: "Badr", byId: "u-mgr", at: T0, state, arrivedAt: null, ...extra })
const WO_PR_SENT: Data = { ...WO, purchaseRequests: [pr("sent")] }
const WO_PR_ORDERED: Data = { ...WO, purchaseRequests: [pr("ordered", { rfqId: "r1", rfqNumber: "RFQ-1" })] }
woAct("markPurchaseArrived (Procurement inbox / RFQs page)", { purchaseRequests: [pr("arrived", { arrivedAt: T1, arrivedBy: "x" })] }, ["owner", "rfqm", "whm", "supply"], ["work", "qc", "cost", "sales", "proj", ...BASE_DENY], WO_PR_ORDERED)
woAct("markPurchaseArrived (goods-receipt posting, deliveries.confirm only)", { purchaseRequests: [pr("arrived", { arrivedAt: T1, arrivedBy: "x" })] }, ["deliv"], [], WO_PR_ORDERED, {}, "[client-vs-rules] ")
woAct("linkPurchaseRequestRfq (RFQ started from a work-order shortfall)", { purchaseRequests: [pr("ordered", { rfqId: "r1", rfqNumber: "RFQ-1", orderedAt: T1 })] }, ["owner", "rfqm", "rfqc", "supply"], ["work", "qc", "cost", "sales", "proj", ...BASE_DENY], WO_PR_SENT)
woAct("linkPurchaseRequestRfq (buyer holding only offers.accept / po.approve / seeded Finance group)", { purchaseRequests: [pr("ordered", { rfqId: "r1", rfqNumber: "RFQ-1", orderedAt: T1 })] }, ["buyer", "poap", "fin"], [], WO_PR_SENT, {}, "[client-vs-rules] ")
woAct("linkPurchaseRequestOrder (direct PO / price agreement for a shortfall)", { purchaseRequests: [pr("ordered", { poId: "po1", poNumber: "PO-1", orderedAt: T1 })] }, ["owner", "rfqm", "supply"], ["work", "qc", "cost", ...BASE_DENY], WO_PR_SENT)
woAct("linkPurchaseRequestOrder (buyer holding only offers.accept / seeded Finance group)", { purchaseRequests: [pr("ordered", { poId: "po1", poNumber: "PO-1", orderedAt: T1 })] }, ["buyer", "fin"], [], WO_PR_SENT, {}, "[client-vs-rules] ")
woAct("declinePurchaseRequest", { purchaseRequests: [pr("declined", { declinedAt: T1, declinedBy: "x", declinedReason: "no budget" })] }, ["owner", "rfqm"], ["work", "qc", "cost", "sales", ...BASE_DENY], WO_PR_SENT)
woAct("unlinkNeedsFromRfq (draft RFQ deleted by rfq.create)", { purchaseRequests: [pr("sent", { rfqId: null, rfqNumber: null, orderedAt: null })] }, ["rfqc", "rfqm", "owner"], ["work", "cost", ...BASE_DENY], WO_PR_ORDERED)
woAct("Procurement ADDS a purchase request (must be refused: the array may not grow)", { purchaseRequests: [pr("sent"), pr("sent", { id: "PR-2" })] }, [], ["rfqm", "rfqc", "whm"], WO_PR_SENT)
woAct("Procurement edits another field next to purchaseRequests", { purchaseRequests: [pr("arrived", { arrivedAt: T1 })], quantity: 1 }, [], ["rfqm", "whm"], WO_PR_ORDERED)

woAct("Procurement-side roles ADD a purchase request (refused for the buyer / receiver roles too)", { purchaseRequests: [pr("sent"), pr("sent", { id: "PR-2" })] }, [], ["buyer", "fin", "deliv"], WO_PR_SENT)

// status guard: Finance / Inventory / Sales / Projects may refresh the status cache between open and done, never cancel or revive
woAct("[hardening] a cost / inventory / projects user cancels a live order", { status: "cancelled" }, [], ["cost", "whr", "proj"], WO)
woAct("[hardening] a cost / inventory / projects user revives a CANCELLED order", { status: "open" }, [], ["cost", "whr", "proj"], WO_CANCELLED)

// create / delete
const newOrder: Data = { ...WO, releasedAt: null, releasedByName: null, createdAt: T1, updatedAt: T1 }
for (const r of ["owner", "mgr", "crmclose"]) mk(`workOrders create (stock order / accepted request): ${r} allowed`, r, "create", "workOrders/wo-new", undefined, newOrder, "ALLOW")
for (const r of ["work", "qc", "cost", "sales", "whm", "view", "none", "stranger", "anon"]) mk(`workOrders create: ${r} refused`, r, "create", "workOrders/wo-new", undefined, newOrder, "DENY")
mk("workOrders delete: mgr allowed", "mgr", "delete", woPath, WO, undefined, "ALLOW")
for (const r of ["work", "cost", "whm", "stranger"]) mk(`workOrders delete: ${r} refused`, r, "delete", woPath, WO, undefined, "DENY")
for (const r of ["view", "none", "work", "whm"]) mk(`workOrders get: ${r} allowed (org member)`, r, "get", woPath, WO, undefined, "ALLOW")
for (const r of ["stranger", "anon"]) mk(`workOrders get: ${r} refused`, r, "get", woPath, WO, undefined, "DENY")

// stranger / unauthenticated on a plain manager write
for (const r of ["stranger", "anon"]) mk(`workOrders update (manager's release): ${r} refused`, r, "update", woPath, WO, patched(WO, { rush: { reason: "x" } }), "DENY")
mk("workOrders update that moves the order to another company: manager refused", "mgr", "update", woPath, WO, patched(WO, { organizationId: OTHER_ORG }), "DENY")
mk("workOrders update that moves the order to another company: lead refused", "work", "update", woPath, WO, patched(WO, { organizationId: OTHER_ORG, progress: [prog(1), prog(), prog()] }), "DENY")

// ---------------------------------------------------------------------------
// Legacy stage-flow orders (no productId) keep a member-wide field set
// ---------------------------------------------------------------------------

const LEGACY: Data = {
  organizationId: ORG,
  orderNumber: 12,
  title: "Counter",
  items: [],
  inputs: [],
  output: { name: "Counter", quantity: 1, unit: "pc" },
  source: { kind: "manual" },
  status: "open",
  currentStageIndex: 0,
  stages: stages0,
  deliveredTo: null,
  deliveredAt: null,
  materialCost: 100,
  createdByUserId: "u-mgr",
  createdAt: T0,
  updatedAt: T0,
  completedAt: null,
}
const legacyStagesDone = [stage("s1", "done", T1), stage("s7", "in_progress"), stage("s5", "pending")]
woAct("legacy: assign a stage", { stages: [{ ...stages0[0], assigneeUserId: "u-work", assigneeName: "Lead" }, stages0[1], stages0[2]] }, ["owner", "mgr", "work", "none", "view"], ["stranger", "anon"], LEGACY)
woAct("legacy: hand off to the next stage", { stages: legacyStagesDone, currentStageIndex: 1 }, ["owner", "mgr", "work", "none"], ["stranger", "anon"], LEGACY)
woAct("legacy: complete the last stage", { stages: legacyStagesDone, currentStageIndex: 2, status: "done", completedAt: T1 }, ["work", "none"], ["stranger", "anon"], LEGACY)
woAct("legacy: cancel the order", { status: "cancelled" }, ["owner", "mgr", "none"], ["stranger", "anon"], LEGACY)
woAct("legacy: hand over to a warehouse (handOverWorkOrder)", { deliveredTo: { warehouseId: "wh1", warehouseName: "Main", kind: "central" }, deliveredAt: T1, deliveryNoteId: "dn1", deliveryNoteNumber: "DN-1", receivedAt: null, receivedByUserId: null, receivedByUserName: null }, ["owner", "mgr", "work", "none"], ["stranger", "anon"], LEGACY)
woAct("legacy: receive the note (confirmDeliveryNote)", { receivedAt: T1, receivedByUserId: "u-whr", receivedByUserName: "Keeper" }, ["whr", "whm", "owner"], ["stranger", "anon"], { ...LEGACY, deliveredTo: { warehouseId: "wh1" }, deliveryNoteId: "dn1" })
woAct("legacy: refuse the note (rejectDeliveryNote)", { deliveredTo: null, deliveredAt: null, deliveryNoteId: null, deliveryNoteNumber: null, receivedAt: null, receivedByUserId: null, receivedByUserName: null }, ["whr", "whm", "owner"], ["stranger", "anon"], { ...LEGACY, deliveredTo: { warehouseId: "wh1" }, deliveredAt: T0, deliveryNoteId: "dn1", deliveryNoteNumber: "DN-1" })
woAct("legacy: a member rewrites the title (not a stage-flow field)", { title: "Hijacked" }, [], ["work", "whr", "none", "view"], LEGACY)
woAct("legacy: a member rewrites the title (manager is allowed)", { title: "Renamed" }, ["mgr", "owner"], [], LEGACY)

// ---------------------------------------------------------------------------
// Delivery notes
// ---------------------------------------------------------------------------

const noteOut = (toKind: "central" | "project"): Data => ({
  organizationId: ORG,
  noteNumber: "DN-2026/001",
  source: { kind: "manufacturing", workOrderId: "wo1", workOrderNumber: 57, workOrderDocNumber: "WO-2026/057", title: "Marble stair" },
  item: { name: "Marble stair", quantity: 40, unit: "m", unitCost: 300 },
  toWarehouseId: "wh1",
  toWarehouseName: "Main",
  toKind,
  toProjectId: toKind === "project" ? "p1" : null,
  status: "in_transit",
  sentByUserId: "u-mgr",
  sentByUserName: "Badr",
  sentAt: T0,
  receivedByUserId: null,
  receivedByUserName: null,
  receivedAt: null,
  sentNote: null,
  receivedNote: null,
  rejectedReason: null,
  brokenQuantity: 0,
  pieces: 10,
  crates: 2,
  vehicleId: "v1",
  vehicleLabel: "Saeed — truck",
  driverName: "Saeed",
  vehiclePlate: "4471",
  createdAt: T0,
  updatedAt: T0,
})
const noteReceived = (n: Data): Data => ({ ...n, status: "received", brokenQuantity: 2, receivedByUserId: "u-whr", receivedByUserName: "Keeper", receivedAt: T1, receivedNote: "ok", updatedAt: T1 })
const notePath = "deliveryNotes/dn1"

const noVehicle: Data = { ...noteOut("central"), vehicleId: null, vehicleLabel: null, driverName: null, vehiclePlate: null }
const typedDriver: Data = { ...noteOut("central"), vehicleId: null, vehicleLabel: "Hand-typed", driverName: "Ali", vehiclePlate: null }
for (const r of ["owner", "mgr", "none", "view", "work"]) mk(`deliveryNotes create (issueDeliveryNote, HR on): ${r} allowed`, r, "create", notePath, undefined, noteOut("central"), "ALLOW")
for (const r of ["mgr", "owner"]) mk(`deliveryNotes create, vehicle optional (HR off, vehicleId/driverName/vehiclePlate null): ${r} allowed`, r, "create", notePath, undefined, noVehicle, "ALLOW")
mk("deliveryNotes create, driver typed with no fleet entry: mgr allowed", "mgr", "create", notePath, undefined, typedDriver, "ALLOW")
mk("deliveryNotes create into project custody: mgr allowed", "mgr", "create", notePath, undefined, noteOut("project"), "ALLOW")
for (const r of ["stranger", "anon"]) mk(`deliveryNotes create: ${r} refused`, r, "create", notePath, undefined, noteOut("central"), "DENY")

const central = noteOut("central")
const project = noteOut("project")
for (const r of ["owner", "whr", "whm"]) mk(`deliveryNotes receive (central warehouse, MfgNoteReceiptDialog): ${r} allowed`, r, "update", notePath, central, noteReceived(central), "ALLOW")
for (const r of ["work", "qc", "cost", "sales", "proj", "rfqm", "buyer", "view", "none", "stranger", "anon"]) mk(`deliveryNotes receive (central warehouse): ${r} refused`, r, "update", notePath, central, noteReceived(central), "DENY")
for (const r of ["owner", "proj", "whm", "seat"]) mk(`deliveryNotes receive (project custody): ${r} allowed`, r, "update", notePath, project, noteReceived(project), "ALLOW")
for (const r of ["work", "qc", "cost", "sales", "rfqm", "view", "none", "stranger", "anon"]) mk(`deliveryNotes receive (project custody): ${r} refused`, r, "update", notePath, project, noteReceived(project), "DENY")
for (const r of ["whr", "whm", "owner"]) mk(`deliveryNotes legacy refuse (rejectDeliveryNote): ${r} allowed`, r, "update", notePath, central, { ...central, status: "rejected", receivedByUserId: "u-whr", receivedByUserName: "Keeper", receivedAt: T1, rejectedReason: "damaged", updatedAt: T1 }, "ALLOW")
for (const r of ["view", "stranger", "anon"]) mk(`deliveryNotes get: ${r}`, r, "get", notePath, central, undefined, r === "view" ? "ALLOW" : "DENY")
mk("deliveryNotes delete: member refused", "mgr", "delete", notePath, central, undefined, "DENY")

// ---------------------------------------------------------------------------
// Requests (Sales / Procurement ask, the workshop answers)
// ---------------------------------------------------------------------------

const REQ: Data = { organizationId: ORG, requestNumber: "MR-2026/001", kind: "make", sourceKind: "sales", orderId: "so1", orderNumber: 9, contactName: "Client", itemName: "Marble stair", unit: "m", quantity: 40, lines: [{ productId: "prod1", itemName: "Marble stair", unit: "m", quantity: 40 }], neededBy: "2026-10-20", note: null, status: "new", workOrderId: null, workOrderNumber: null, rejectionReason: null, decidedAt: null, decidedByUserId: null, decidedByUserName: null, createdByUserId: "u-sales", createdByUserName: "Sara", createdAt: T0, updatedAt: T0, requestedAt: T0 }
const reqPath = "manufacturingRequests/mr1"
const answered = { decidedAt: T1, decidedByUserId: "u-mgr", decidedByUserName: "Badr", updatedAt: T1 }

for (const r of ["sales", "owner", "mgr", "rfqm", "rfqc", "whm"]) mk(`manufacturingRequests create (sales / procurement / costing request): ${r} allowed`, r === "owner" ? "owner" : r, "create", reqPath, undefined, { ...REQ, createdByUserId: uidOf(r) }, "ALLOW")
mk("manufacturingRequests create naming another user as creator: refused", "sales", "create", reqPath, undefined, { ...REQ, createdByUserId: "u-mgr" }, "DENY")
mk("manufacturingRequests create already accepted: refused", "sales", "create", reqPath, undefined, { ...REQ, status: "accepted", createdByUserId: "u-sales" }, "DENY")
for (const r of ["view", "work", "qc", "cost", "buyer", "poap", "none", "stranger", "anon"]) mk(`manufacturingRequests create: ${r} refused`, r, "create", reqPath, undefined, { ...REQ, createdByUserId: uidOf(r) }, "DENY")
for (const r of ["mgr", "owner"]) {
  mk(`manufacturingRequests answer: make accepted (answerMakeRequest): ${r} allowed`, r, "update", reqPath, REQ, { ...REQ, status: "accepted", answerRoute: "make", answerNote: null, workOrderIds: ["wo1"], workOrderId: "wo1", workOrderNumber: 57, workOrderDocNumbers: ["WO-2026/057"], lines: [{ productId: "prod1", itemName: "Marble stair", unit: "m", quantity: 40, makeQuantity: 40, returnedQuantity: 0 }], ...answered }, "ALLOW")
  mk(`manufacturingRequests answer: partial: ${r} allowed`, r, "update", reqPath, REQ, { ...REQ, status: "partial", answerRoute: "make", workOrderIds: ["wo1"], ...answered }, "ALLOW")
  mk(`manufacturingRequests answer: declined: ${r} allowed`, r, "update", reqPath, REQ, { ...REQ, status: "rejected", answerRoute: "decline", rejectionReason: "no capacity", answerNote: "no capacity", ...answered }, "ALLOW")
  mk(`manufacturingRequests answer: costing -> estimated: ${r} allowed`, r, "update", reqPath, { ...REQ, kind: "cost" }, { ...REQ, kind: "cost", status: "estimated", answerRoute: "estimate", estimateId: "e1", estimateNumber: "CE-2026/001", ...answered }, "ALLOW")
}
for (const r of ["work", "qc", "cost", "view", "none", "buyer", "stranger", "anon"]) mk(`manufacturingRequests answer: ${r} refused`, r, "update", reqPath, REQ, { ...REQ, status: "rejected", answerRoute: "decline", rejectionReason: "x", ...answered }, "DENY")
const moved = { ...REQ, status: "moved", answerNote: null, movedToPurchase: true, ...answered }
for (const r of ["sales", "rfqm", "whm"]) mk(`manufacturingRequests lapsed -> buy instead (moveRequestToPurchase): ${r} allowed`, r, "update", reqPath, REQ, moved, "ALLOW")
for (const r of ["buyer", "poap", "fin", "rfqc"]) mk(`[client-vs-rules] manufacturingRequests lapsed -> buy instead (Procurement desk "proceed" button, canAct = rfq/offers/po): ${r} allowed`, r, "update", reqPath, REQ, moved, "ALLOW")
mk("manufacturingRequests move a request that was already answered: refused", "rfqm", "update", reqPath, { ...REQ, status: "accepted" }, moved, "DENY")
mk("manufacturingRequests requester writes another field with the move: refused", "rfqm", "update", reqPath, REQ, { ...moved, quantity: 1 }, "DENY")
mk("manufacturingRequests requester moves to a status other than moved: refused", "rfqm", "update", reqPath, REQ, { ...moved, status: "accepted" }, "DENY")

// ---------------------------------------------------------------------------
// Cost statements
// ---------------------------------------------------------------------------

const EST: Data = { organizationId: ORG, estimateNumber: "CE-2026/001", requestId: "mr1", contactId: null, contactName: "Client", requestedBy: "Sara", neededBy: null, validityDays: 14, note: null, lines: [{ productId: "prod1", productName: "Marble stair", quantity: 40 }], state: "draft", sentAt: null, sentByName: null, quoteNumber: null, createdByUserId: "u-mgr", createdByUserName: "Badr", createdAt: T0, updatedAt: T0 }
const estPath = "mfgCostEstimates/e1"
for (const r of ["mgr", "cost", "owner"]) mk(`mfgCostEstimates create draft (answerCostingRequest): ${r} allowed`, r, "create", estPath, undefined, EST, "ALLOW")
for (const r of ["work", "sales", "qc", "view", "none", "stranger", "anon"]) mk(`mfgCostEstimates create draft: ${r} refused`, r, "create", estPath, undefined, EST, "DENY")
mk("mfgCostEstimates create already sent: refused", "cost", "create", estPath, undefined, { ...EST, state: "sent" }, "DENY")
const sent = { ...EST, state: "sent", sentAt: T1, sentByName: "Noura", earliestDays: 6, updatedAt: T1 }
for (const r of ["cost", "owner"]) mk(`mfgCostEstimates send (sendCostStatement): ${r} allowed`, r, "update", estPath, EST, sent, "ALLOW")
for (const r of ["cost", "owner"]) mk(`mfgCostEstimates recalculate (past validity): ${r} allowed`, r, "update", estPath, sent, { ...EST, state: "draft", recalculatedAt: T1, recalculatedBy: "Noura", updatedAt: T1 }, "ALLOW")
for (const r of ["mgr", "work", "whm", "view", "none", "stranger", "anon"]) mk(`mfgCostEstimates send: ${r} refused`, r, "update", estPath, EST, sent, "DENY")
const quoted = { ...sent, state: "quoted", quoteNumber: "Q-1", salesStatusBy: "Sara", salesStatusAt: T1, salesOrderNumber: null }
for (const r of ["sales", "cost", "owner"]) mk(`mfgCostEstimates Sales records quoted (recordQuoteStatus): ${r} allowed`, r, "update", estPath, sent, quoted, "ALLOW")
mk("mfgCostEstimates Sales records won after quoted: allowed", "sales", "update", estPath, quoted, { ...quoted, state: "won", salesOrderNumber: 9, salesStatusAt: T1 }, "ALLOW")
mk("mfgCostEstimates Sales records lost: allowed", "sales", "update", estPath, sent, { ...sent, state: "lost", salesStatusBy: "Sara", salesStatusAt: T1, quoteNumber: null, salesOrderNumber: null }, "ALLOW")
mk("mfgCostEstimates Sales records quoted from a DRAFT: refused", "sales", "update", estPath, EST, quoted, "DENY")
mk("mfgCostEstimates Sales edits the lines while recording: refused", "sales", "update", estPath, sent, { ...quoted, lines: [] }, "DENY")
mk("mfgCostEstimates Sales moves it back to sent: refused", "sales", "update", estPath, quoted, { ...quoted, state: "sent" }, "DENY")
for (const r of ["salesapp", "mgr", "buyer"]) mk(`mfgCostEstimates Sales records quoted: ${r} refused`, r, "update", estPath, sent, quoted, "DENY")

// ---------------------------------------------------------------------------
// Product cards, stations, settings
// ---------------------------------------------------------------------------

const PROD: Data = { organizationId: ORG, name: "Marble stair", unit: "m", family: "stone", requiresMeasurement: true, requiresDrawingApproval: true, requiresSlabApproval: true, wastePercent: 35, referenceBuyPrice: 620, route: [{ departmentId: "s1", departmentName: "Design", hoursPerUnit: 0.1 }], bom: [], createdByUserId: "u-mgr", createdByUserName: "Badr", createdAt: T0, updatedAt: T0 }
const prodPath = "mfgProducts/prod1"
for (const r of ["mgr", "owner"]) {
  mk(`mfgProducts create (createMfgProduct): ${r} allowed`, r, "create", prodPath, undefined, PROD, "ALLOW")
  mk(`mfgProducts update (updateMfgProduct): ${r} allowed`, r, "update", prodPath, PROD, { ...PROD, wastePercent: 30, updatedByUserName: "Badr", updatedAt: T1 }, "ALLOW")
  mk(`mfgProducts delete: ${r} allowed`, r, "delete", prodPath, PROD, undefined, "ALLOW")
}
for (const r of ["work", "qc", "cost", "sales", "whm", "view", "none", "stranger", "anon"]) {
  mk(`mfgProducts create: ${r} refused`, r, "create", prodPath, undefined, PROD, "DENY")
  mk(`mfgProducts update: ${r} refused`, r, "update", prodPath, PROD, { ...PROD, wastePercent: 30, updatedAt: T1 }, "DENY")
}
const refPrice = { ...PROD, referenceBuyPrice: 700, referenceBuyAt: T1, referenceBuyPo: "PO-2026/001", updatedAt: T1 }
for (const r of ["poap", "buyer", "fin", "owner"]) mk(`mfgProducts Procurement writes the reference buy price: ${r} allowed`, r, "update", prodPath, PROD, refPrice, "ALLOW")
for (const r of ["rfqm", "work", "stranger", "anon"]) mk(`mfgProducts reference buy price: ${r} refused`, r, "update", prodPath, PROD, refPrice, "DENY")
mk("mfgProducts reference buy price of 0: refused", "poap", "update", prodPath, PROD, { ...refPrice, referenceBuyPrice: 0 }, "DENY")
mk("mfgProducts reference buy price with a route edit: refused", "poap", "update", prodPath, PROD, { ...refPrice, route: [] }, "DENY")
mk("mfgProducts get: view allowed", "view", "get", prodPath, PROD, undefined, "ALLOW")
mk("mfgProducts get: stranger refused", "stranger", "get", prodPath, PROD, undefined, "DENY")

const DEPT: Data = { organizationId: ORG, name: "Bridge-saw cutting", order: 3, workers: 2, hoursPerDay: 8, hourlyRate: 70, gate: null, qcStation: false, leadUserId: null, createdAt: T0 }
const deptPath = "manufacturingDepartments/s7"
for (const r of ["mgr", "owner"]) {
  mk(`manufacturingDepartments create: ${r} allowed`, r, "create", deptPath, undefined, DEPT, "ALLOW")
  mk(`manufacturingDepartments update (updateStation / reorder): ${r} allowed`, r, "update", deptPath, DEPT, { ...DEPT, leadUserId: "u-work", leadUserName: "Lead", updatedAt: T1 }, "ALLOW")
  mk(`manufacturingDepartments delete: ${r} allowed`, r, "delete", deptPath, DEPT, undefined, "ALLOW")
}
for (const r of ["work", "qc", "cost", "hr", "whm", "view", "none", "stranger", "anon"]) {
  mk(`manufacturingDepartments create: ${r} refused`, r, "create", deptPath, undefined, DEPT, "DENY")
  mk(`manufacturingDepartments update: ${r} refused`, r, "update", deptPath, DEPT, { ...DEPT, workers: 5, updatedAt: T1 }, "DENY")
}
mk("manufacturingDepartments get: view allowed", "view", "get", deptPath, DEPT, undefined, "ALLOW")

const SETP = `manufacturingSettings/${ORG}`
const features = { time: true, labourCost: true, estimates: false, checklists: true }
const policies = { overheadRatePerHour: 20, scrapApprovalLimit: 3000, answerWindowHours: 24, noteEscalationHours: 24, estimateValidityDays: 14, remnantValuePercent: 50 }
const featuresDoc: Data = { organizationId: ORG, features, featuresUpdatedBy: "Badr", updatedAt: T1 }
const policiesDoc: Data = { organizationId: ORG, ...policies, policiesUpdatedBy: "Noura", policiesUpdatedAt: T1, updatedAt: T1 }
const bothDoc: Data = { organizationId: ORG, features, featuresUpdatedBy: "Badr", ...policies, policiesUpdatedBy: "Noura", policiesUpdatedAt: T0, updatedAt: T0 }
for (const r of ["mgr", "owner"]) {
  mk(`manufacturingSettings first save of features (setDoc merge on a missing doc): ${r} allowed`, r, "create", SETP, undefined, featuresDoc, "ALLOW")
  mk(`manufacturingSettings toggle a feature: ${r} allowed`, r, "update", SETP, bothDoc, { ...bothDoc, features: { ...features, time: false }, featuresUpdatedBy: "Badr", updatedAt: T1 }, "ALLOW")
}
for (const r of ["acc", "owner"]) {
  mk(`manufacturingSettings first save of policies (Finance, missing doc): ${r} allowed`, r, "create", SETP, undefined, policiesDoc, "ALLOW")
  mk(`manufacturingSettings edit policies (accounting.close): ${r} allowed`, r, "update", SETP, bothDoc, { ...bothDoc, scrapApprovalLimit: 5000, policiesUpdatedBy: "Noura", policiesUpdatedAt: T1, updatedAt: T1 }, "ALLOW")
}
mk("manufacturingSettings manager edits a policy: refused", "mgr", "update", SETP, bothDoc, { ...bothDoc, scrapApprovalLimit: 9999, updatedAt: T1 }, "DENY")
mk("manufacturingSettings Finance toggles a feature: refused", "acc", "update", SETP, bothDoc, { ...bothDoc, features: { ...features, time: false }, updatedAt: T1 }, "DENY")
mk("manufacturingSettings manager creates with a policy key: refused", "mgr", "create", SETP, undefined, { ...featuresDoc, scrapApprovalLimit: 1 }, "DENY")
for (const r of ["work", "qc", "cost", "view", "none"]) mk(`manufacturingSettings update: ${r} refused`, r, "update", SETP, bothDoc, { ...bothDoc, features: { ...features, time: false }, updatedAt: T1 }, "DENY")
for (const r of ["stranger", "anon"]) mk(`manufacturingSettings update: ${r} refused`, r, "update", SETP, bothDoc, { ...bothDoc, features: { ...features, time: false }, updatedAt: T1 }, "DENY")
mk("manufacturingSettings get: view allowed", "view", "get", SETP, bothDoc, undefined, "ALLOW")
mk("manufacturingSettings get: stranger refused", "stranger", "get", SETP, bothDoc, undefined, "DENY")

// ---------------------------------------------------------------------------
// Stops, block notices, counters, fleet, notifications
// ---------------------------------------------------------------------------

const stop = (uid: string): Data => ({ organizationId: ORG, departmentId: "s7", date: "2026-10-08", hours: 2, kind: "machine", note: null, by: "x", byId: uid, at: T1, createdAt: T1 })
for (const r of ["work", "mgr", "owner"]) mk(`mfgStops create (recordStop): ${r} allowed`, r, "create", "mfgStops/st1", undefined, stop(uidOf(r)!), "ALLOW")
mk("[client-vs-rules] mfgStops create at QC & packing by Quality (StopForm lets canQc record at its station): qc allowed", "qc", "create", "mfgStops/st1", undefined, stop("u-qc"), "ALLOW")
mk("mfgStops create naming someone else: refused", "work", "create", "mfgStops/st1", undefined, stop("u-mgr"), "DENY")
mk("mfgStops create of 0 hours: refused", "work", "create", "mfgStops/st1", undefined, { ...stop("u-work"), hours: 0 }, "DENY")
for (const r of ["cost", "view", "none", "stranger", "anon"]) mk(`mfgStops create: ${r} refused`, r, "create", "mfgStops/st1", undefined, stop(uidOf(r) ?? "x"), "DENY")
mk("mfgStops update: manager refused", "mgr", "update", "mfgStops/st1", stop("u-work"), { ...stop("u-work"), hours: 1 }, "DENY")

const NOTICE: Data = { organizationId: ORG, lot: "BLK-1", itemName: "Crema", defect: "crack", note: "cracked", photosAttached: true, orderIds: ["wo1"], by: "Lama", byId: "u-qc", at: T0, quarantinedAt: null, claimRaisedAt: null, closedAt: null, createdAt: T0 }
const noticePath = "mfgBlockNotices/n1"
for (const r of ["qc", "mgr", "owner"]) mk(`mfgBlockNotices create (raiseBlockNotice): ${r} allowed`, r, "create", noticePath, undefined, { ...NOTICE, byId: uidOf(r) }, "ALLOW")
for (const r of ["work", "cost", "whm", "view", "none", "stranger", "anon"]) mk(`mfgBlockNotices create: ${r} refused`, r, "create", noticePath, undefined, { ...NOTICE, byId: uidOf(r) ?? "x" }, "DENY")
mk("mfgBlockNotices create naming someone else: refused", "qc", "create", noticePath, undefined, { ...NOTICE, byId: "u-mgr" }, "DENY")
for (const r of ["whm", "owner"]) mk(`mfgBlockNotices quarantine (Inventory): ${r} allowed`, r, "update", noticePath, NOTICE, { ...NOTICE, quarantinedAt: T1, quarantinedBy: "Keeper", updatedAt: T1 }, "ALLOW")
for (const r of ["rfqc", "rfqm", "owner"]) mk(`mfgBlockNotices raise the supplier claim (Procurement): ${r} allowed`, r, "update", noticePath, NOTICE, { ...NOTICE, claimRaisedAt: T1, claimRaisedBy: "Huda", updatedAt: T1 }, "ALLOW")
for (const r of ["qc", "mgr", "owner"]) mk(`mfgBlockNotices close: ${r} allowed`, r, "update", noticePath, NOTICE, { ...NOTICE, closedAt: T1, closedBy: "Lama", updatedAt: T1 }, "ALLOW")
mk("mfgBlockNotices Inventory also writes the claim field: refused", "whm", "update", noticePath, NOTICE, { ...NOTICE, quarantinedAt: T1, claimRaisedAt: T1, updatedAt: T1 }, "DENY")
for (const r of ["work", "cost", "view", "stranger", "anon"]) mk(`mfgBlockNotices quarantine: ${r} refused`, r, "update", noticePath, NOTICE, { ...NOTICE, quarantinedAt: T1, quarantinedBy: "x", updatedAt: T1 }, "DENY")

const ctr = (last: number, org = ORG): Data => ({ organizationId: org, type: "WR", year: 2026, last, updatedAt: T1 })
const ctrPath = `mfgCounters/${ORG}__WR__2026`
for (const r of ["work", "qc", "mgr", "sales", "rfqm", "whm", "none", "view", "owner"]) {
  mk(`mfgCounters first draw (create last=1): ${r} allowed`, r, "create", ctrPath, undefined, ctr(1), "ALLOW")
  mk(`mfgCounters next draw (last 7 -> 8): ${r} allowed`, r, "update", ctrPath, ctr(7), ctr(8), "ALLOW")
}
mk("mfgCounters WO bulk draw for a 3-line answer (+3): allowed", "mgr", "update", `mfgCounters/${ORG}__WO__2026`, { ...ctr(10), type: "WO" }, { ...ctr(13), type: "WO" }, "ALLOW")
mk("mfgCounters global WO counter first create seeded past 50 (seed from legacy numbers): allowed", "mgr", "create", `mfgCounters/${ORG}__WO__0`, undefined, { organizationId: ORG, type: "WO", year: 0, last: 301, updatedAt: T1 }, "ALLOW")
mk("[client-vs-rules] mfgCounters global WO counter behind legacy order numbers by more than 50 (createStockWorkOrder = max(counter, seed)+1): allowed", "mgr", "update", `mfgCounters/${ORG}__WO__0`, { organizationId: ORG, type: "WO", year: 0, last: 5 }, { organizationId: ORG, type: "WO", year: 0, last: 301, updatedAt: T1 }, "ALLOW")
mk("mfgCounters same value again: refused", "work", "update", ctrPath, ctr(7), ctr(7), "DENY")
mk("mfgCounters going backwards: refused", "work", "update", ctrPath, ctr(7), ctr(6), "DENY")
mk("mfgCounters jump of 51: refused", "work", "update", ctrPath, ctr(7), ctr(58), "DENY")
mk("mfgCounters organisation rewritten: refused", "work", "update", ctrPath, ctr(7), ctr(8, OTHER_ORG), "DENY")
mk("mfgCounters create of last=0: refused", "work", "create", ctrPath, undefined, ctr(0), "DENY")
mk("mfgCounters create with a fractional last: refused", "work", "create", ctrPath, undefined, ctr(1.5), "DENY")
for (const r of ["stranger", "anon"]) {
  mk(`mfgCounters create: ${r} refused`, r, "create", ctrPath, undefined, ctr(1), "DENY")
  mk(`mfgCounters update: ${r} refused`, r, "update", ctrPath, ctr(7), ctr(8), "DENY")
}
mk("mfgCounters create inside another company's id: refused", "stranger", "create", ctrPath, undefined, ctr(1, OTHER_ORG), "DENY")
mk("mfgCounters delete: member refused", "mgr", "delete", ctrPath, ctr(7), undefined, "DENY")
mk("mfgCounters get: member allowed", "work", "get", ctrPath, ctr(7), undefined, "ALLOW")
mk("mfgCounters get: stranger refused", "stranger", "get", ctrPath, ctr(7), undefined, "DENY")

const VEH: Data = { organizationId: ORG, driverName: "Saeed", plate: "4471", kind: "truck", active: true, updatedBy: "HR", updatedAt: T1, createdAt: T0 }
mk("fleetVehicles create (HR): hr allowed", "hr", "create", "fleetVehicles/v1", undefined, VEH, "ALLOW")
mk("fleetVehicles update (HR): hr allowed", "hr", "update", "fleetVehicles/v1", VEH, { ...VEH, active: false }, "ALLOW")
for (const r of ["mgr", "whm", "none", "stranger", "anon"]) mk(`fleetVehicles create: ${r} refused`, r, "create", "fleetVehicles/v1", undefined, VEH, "DENY")
mk("fleetVehicles get: view allowed (delivery note picker)", "view", "get", "fleetVehicles/v1", VEH, undefined, "ALLOW")

for (const r of ["work", "mgr", "sales", "whm"]) mk(`notification to a colleague (emitMfgEvent): ${r} allowed`, r, "create", "users/u-mgr/notifications/n1", undefined, { userId: "u-mgr", organizationId: ORG, title: "t", message: "m", read: false }, "ALLOW")
mk("notification: anon refused", "anon", "create", "users/u-mgr/notifications/n1", undefined, { userId: "u-mgr" }, "DENY")

// ---------------------------------------------------------------------------
// Inventory: stock rows, transfers, requests, waste (the stock side of every issue/receipt)
// ---------------------------------------------------------------------------

const ITEM: Data = { organizationId: ORG, warehouseId: "wh1", name: "Diamond blades", quantity: 20, unit: "pc", unitCost: 340, lot: null, createdAt: T0, updatedAt: T0 }
const itemPath = "warehouses/wh1/inventoryItems/i1"
for (const r of ["whm", "whr", "mgr", "proj", "owner", "none"]) mk(`inventoryItems take stock out (issueWithdrawal / transfer / waste): ${r} allowed`, r, "update", itemPath, ITEM, { ...ITEM, quantity: 18, updatedAt: T1 }, "ALLOW")
for (const r of ["whr", "proj", "owner"]) mk(`inventoryItems land received goods (receiveDeliveryNote / receiveRemnant create): ${r} allowed`, r, "create", "warehouses/wh1/inventoryItems/i2", undefined, { ...ITEM, name: "Marble stair", isManufactured: true, sourceWorkOrderId: "wo1", sourceWorkOrderNumber: 57 }, "ALLOW")
mk("inventoryItems create a remnant row: whr allowed", "whr", "create", "warehouses/wh1/inventoryItems/i3", undefined, { ...ITEM, name: "Crema", lot: "REM-1-1", remnant: true, sourceWorkOrderId: "wo1" }, "ALLOW")
for (const r of ["stranger", "anon"]) {
  mk(`inventoryItems update: ${r} refused`, r, "update", itemPath, ITEM, { ...ITEM, quantity: 1, updatedAt: T1 }, "DENY")
  mk(`inventoryItems create: ${r} refused`, r, "create", "warehouses/wh1/inventoryItems/i2", undefined, ITEM, "DENY")
}
mk("inventoryItems create under another company's id: refused", "whr", "create", "warehouses/wh1/inventoryItems/i2", undefined, { ...ITEM, organizationId: OTHER_ORG }, "DENY")
mk("inventoryItems get: view allowed", "view", "get", itemPath, ITEM, undefined, "ALLOW")
mk("inventoryItems get: stranger refused", "stranger", "get", itemPath, ITEM, undefined, "DENY")

const unit: Data = { status: "available", barcode: "B1", organizationId: ORG, createdAt: T0 }
mk("inventory unit flipped to consumed (waste batch): whm allowed", "whm", "update", "warehouses/wh1/inventoryItems/i1/units/u1", unit, { ...unit, status: "consumed", updatedAt: T1 }, "ALLOW")
mk("inventory unit flipped by another company: refused", "stranger", "update", "warehouses/wh1/inventoryItems/i1/units/u1", unit, { ...unit, status: "consumed" }, "DENY")

const TRANSFER: Data = { organizationId: ORG, itemName: "Blades", unit: "pc", quantity: 2, fromWarehouseId: "wh1", toWarehouseId: "wh2", toProjectId: "p1", toProjectName: "Tower", direction: "out", byUserId: "u-whm", byUserName: "Keeper", createdAt: T1 }
mk("warehouses/transfers log (runTransfer): whm allowed", "whm", "create", "warehouses/wh1/transfers/t1", undefined, TRANSFER, "ALLOW")
mk("warehouses/transfers log: another company refused", "stranger", "create", "warehouses/wh1/transfers/t1", undefined, TRANSFER, "DENY")
mk("warehouses/transfers edit by a member (append-only): refused", "whm", "update", "warehouses/wh1/transfers/t1", TRANSFER, { ...TRANSFER, quantity: 9 }, "DENY")
const WREQ: Data = { organizationId: ORG, requestNumber: "R-1", itemId: "i1", itemName: "Blades", unit: "pc", quantity: 2, fromWarehouseId: "wh1", toWarehouseId: "wh2", status: "pending", requestedByUserId: "u-proj", requestedByName: "Eng", requestedAt: T0 }
mk("warehouses/requests raise (createWarehouseRequest): proj allowed", "proj", "create", "warehouses/wh1/requests/r1", undefined, WREQ, "ALLOW")
mk("warehouses/requests release (releaseWarehouseRequest): whm allowed", "whm", "update", "warehouses/wh1/requests/r1", WREQ, { ...WREQ, status: "released", releasedQuantity: 2, releasedByUserId: "u-whm" }, "ALLOW")
mk("warehouses/requests confirm receipt: whr allowed", "whr", "update", "warehouses/wh1/requests/r1", { ...WREQ, status: "released" }, { ...WREQ, status: "received", receivedByUserId: "u-whr" }, "ALLOW")
mk("warehouses/requests cancel: proj allowed", "proj", "update", "warehouses/wh1/requests/r1", WREQ, { ...WREQ, status: "cancelled", cancelledReason: "x" }, "ALLOW")
mk("warehouses/requests update by another company: refused", "stranger", "update", "warehouses/wh1/requests/r1", WREQ, { ...WREQ, status: "cancelled" }, "DENY")
mk("warehouses/requests delete by a member: refused", "whm", "delete", "warehouses/wh1/requests/r1", WREQ, undefined, "DENY")

const WASTE = (uid: string): Data => ({ type: "consumption", batchId: "issue_1", inventoryItemId: "i1", warehouseId: "wh1", projectId: null, itemName: "Blades", unit: "pc", quantityTaken: 2, quantityUsed: 2, wastePercent: 0, unitCost: 340, wasteValue: 0, recordedByUserId: uid, recordedByUserName: "x", createdAt: T1 })
for (const r of ["whm", "owner"]) mk(`warehouses/wasteRecords issue from a warehouse (StandaloneWasteView): ${r} allowed`, r, "create", "warehouses/wh1/wasteRecords/w1", undefined, WASTE(uidOf(r)!), "ALLOW")
for (const r of ["whr", "proj", "none", "stranger", "anon"]) mk(`warehouses/wasteRecords issue from a warehouse: ${r} refused`, r, "create", "warehouses/wh1/wasteRecords/w1", undefined, WASTE(uidOf(r) ?? "x"), "DENY")
mk("warehouses/wasteRecords naming someone else as recorder: refused", "whm", "create", "warehouses/wh1/wasteRecords/w1", undefined, WASTE("u-mgr"), "DENY")
mk("warehouses/wasteRecords edit: manager refused", "whm", "update", "warehouses/wh1/wasteRecords/w1", WASTE("u-whm"), { ...WASTE("u-whm"), quantityUsed: 1 }, "DENY")
for (const r of ["proj", "projpub", "owner", "seat"]) mk(`projects/wasteRecords issue to a project (project page consume): ${r} allowed`, r, "create", "projects/p1/wasteRecords/w1", undefined, { ...WASTE(uidOf(r === "seat" ? "seat" : r)!), projectId: "p1" }, "ALLOW")
for (const r of ["none", "whm", "work", "view", "stranger", "anon"]) mk(`projects/wasteRecords issue to a project: ${r} refused`, r, "create", "projects/p1/wasteRecords/w1", undefined, { ...WASTE(uidOf(r) ?? "x"), projectId: "p1" }, "DENY")
mk("projects/wasteRecords issue to an ARCHIVED project: refused", "proj", "create", "projects/p2/wasteRecords/w1", undefined, { ...WASTE("u-proj"), projectId: "p2" }, "DENY")


// ---------------------------------------------------------------------------
// Runner: same contract as sim.ts (real rules via the :test API, live UAT documents for anything not overridden),
// but every case's overrides are mocked up front and cases go to the API in batches, so a case settles in one round.
// ---------------------------------------------------------------------------

const ROOT = "/databases/(default)/documents/"
const rulesSource = (): string => fs.readFileSync(process.env.RULES_FILE ?? path.join(process.cwd(), "firestore.rules"), "utf8")
interface ApiResult {
  state: string
  debugMessages?: string[]
  visitedExpressions?: unknown[]
  functionCalls?: Array<{ function: string; args: string[] }>
}
const decodePath = (p: string): string => decodeURIComponent(p).replace(ROOT, "")

let dbHandle: ReturnType<typeof openUatDb>["db"] | null = null
const liveCache = new Map<string, Data | null>()
async function live(p: string): Promise<Data | null> {
  if (!liveCache.has(p)) {
    dbHandle = dbHandle ?? openUatDb().db
    const snap = await dbHandle.doc(p).get()
    const plain = (v: unknown): unknown => {
      if (v === null || typeof v !== "object") return v
      if (Array.isArray(v)) return v.map(plain)
      const o = v as { toDate?: () => Date }
      if (typeof o.toDate === "function") return o.toDate().toISOString()
      return Object.fromEntries(Object.entries(v as Data).map(([k, x]) => [k, plain(x)]))
    }
    liveCache.set(p, snap.exists ? (plain(snap.data()) as Data) : null)
  }
  return liveCache.get(p) ?? null
}

async function postBatch(testCases: unknown[]): Promise<ApiResult[]> {
  const body = JSON.stringify({ source: { files: [{ name: "firestore.rules", content: rulesSource() }] }, testSuite: { testCases } })
  let last = "rules test failed"
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const token = String(cp.execSync("gcloud auth print-access-token", { encoding: "utf8" })).trim()
      const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${UAT_PROJECT}:test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": UAT_PROJECT, "Content-Type": "application/json" },
        body,
      })
      const text = await res.text()
      let json: { testResults?: ApiResult[]; error?: { message: string } } = {}
      try {
        json = JSON.parse(text)
      } catch {
        last = `HTTP ${res.status} non-JSON (${testCases.length} cases): ${text.slice(0, 80).replace(/\s+/g, " ")}`
      }
      if (json.testResults && json.testResults.length === testCases.length) return json.testResults
      last = json.error?.message ?? last
    } catch (err) {
      last = `fetch failed: ${(err as Error).message}`
    }
    await new Promise((r) => setTimeout(r, Math.min(2000 * (attempt + 1), 20000)))
  }
  throw new Error(last)
}

interface Settled {
  state: "pending" | "done"
  known: Map<string, Data | null>
  result?: ApiResult
}

async function runBatch(batch: RuleCase[]): Promise<RuleResult[]> {
  const st: Settled[] = batch.map((c) => ({ state: "pending", known: new Map(Object.entries(c.overrides ?? {})) }))
  for (let round = 0; round < 8; round++) {
    const idx = st.map((s, i) => (s.state === "pending" ? i : -1)).filter((i) => i >= 0)
    if (!idx.length) break
    const testCases = idx.map((i) => {
      const c = batch[i]
      const mocks = [...st[i].known].flatMap(([p, d]) => [
        { function: "exists", args: [{ exactValue: ROOT + p }], result: { value: d !== null } },
        { function: "get", args: [{ exactValue: ROOT + p }], result: d === null ? { undefined: {} } : { value: { data: d } } },
      ])
      return {
        expectation: "ALLOW",
        request: { auth: c.uid ? { uid: c.uid, token: {} } : null, path: ROOT + c.path, method: c.method, ...(c.after ? { resource: { data: c.after } } : {}) },
        ...(c.before ? { resource: { data: c.before } } : {}),
        functionMocks: mocks,
      }
    })
    const results = await postBatch(testCases)
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]
      const r = results[k]
      const wanted = [...new Set((r.functionCalls ?? []).map((f) => decodePath(f.args[0])))].filter((p) => !st[i].known.has(p))
      if (wanted.length === 0 || r.state === "SUCCESS") {
        st[i].state = "done"
        st[i].result = r
      } else {
        for (const p of wanted) st[i].known.set(p, await live(p))
      }
    }
  }
  return batch.map((c, i) => {
    const r = st[i].result
    if (!r) return { name: c.name, expected: c.expect, got: "DENY", ok: false, reads: [], detail: "did not settle" }
    const got = r.state === "SUCCESS" ? "ALLOW" : "DENY"
    const reads = [...new Set((r.functionCalls ?? []).map((f) => decodePath(f.args[0])))]
    return { name: c.name, expected: c.expect, got, ok: got === c.expect, reads, detail: (r.debugMessages ?? []).join(" | ").slice(0, 400) + ` {visited=${(r.visitedExpressions ?? []).length}}` }
  })
}

async function main(): Promise<void> {
  const only = process.env.ONLY
  const picked = only ? cases.filter((c) => only.split("||").some((o) => c.name.includes(o))) : cases
  const todo = [...picked.filter((c) => c.expect === "ALLOW"), ...picked.filter((c) => c.expect === "DENY")]
  console.error(`${todo.length} cases (${picked.filter((c) => c.expect === "ALLOW").length} ALLOW)`)
  const SIZE = Number(process.env.BATCH ?? 30)
  const POOL = Number(process.env.POOL ?? 4)
  const batches: RuleCase[][] = []
  for (let i = 0; i < todo.length; i += SIZE) batches.push(todo.slice(i, i + SIZE))
  const out: RuleResult[][] = new Array(batches.length)
  let next = 0
  await Promise.all(
    Array.from({ length: POOL }, async () => {
      for (;;) {
        const b = next++
        if (b >= batches.length) return
        try {
          out[b] = await runBatch(batches[b])
        } catch (err) {
          out[b] = batches[b].map((c) => ({ name: c.name, expected: c.expect, got: "DENY" as const, ok: false, reads: [], detail: `HARNESS ERROR: ${(err as Error).message}` }))
        }
        console.error(`batch ${b + 1}/${batches.length} done`)
        for (const r of out[b]) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  (expected ${r.expected}, got ${r.got})${/maximum of 1000 expressions/.test(r.detail) ? " [EXPR-LIMIT]" : ""}${r.ok ? "" : "  " + r.detail}  reads=${r.reads.length} ${/visited=\d+/.exec(r.detail)?.[0] ?? ""}`)
      }
    })
  )
  const results = out.flat()
  let bad = 0
  for (const r of results) if (!r.ok) bad++
  console.log("\n--- FAILURES ---")
  for (const r of results) if (!r.ok) console.log(`FAIL ${r.name}  (expected ${r.expected}, got ${r.got})  ${r.detail}`)
  const exprLimit = results.filter((r) => /maximum of 1000 expressions/.test(r.detail))
  const maxReads = results.reduce((m, r) => Math.max(m, r.reads.length), 0)
  console.log(`\n${results.length - bad}/${results.length} as expected; most documents read by one case: ${maxReads}`)
  if (exprLimit.length) console.log(`EXPRESSION LIMIT hit in ${exprLimit.length}: ${exprLimit.map((r) => `${r.name} [${r.expected}->${r.got}]`).join(" | ")}`)
  process.exit(bad ? 1 : 0)
}

void main()

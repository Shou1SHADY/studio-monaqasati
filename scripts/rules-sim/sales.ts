import cp from "child_process"
import fs from "fs"
import path from "path"
import type { Method, RuleCase } from "./sim"

interface RuleResult { name: string; expected: "ALLOW" | "DENY"; got: "ALLOW" | "DENY"; ok: boolean; reads: string[]; detail: string }

let cachedToken: { at: number; out: string } | null = null
const token = (): string => {
  if (!cachedToken || Date.now() - cachedToken.at > 3 * 60 * 1000) cachedToken = { at: Date.now(), out: cp.execSync("gcloud auth print-access-token", { encoding: "utf8", env: process.env }).trim() }
  return cachedToken.out
}

type Data = Record<string, unknown>
type Role = keyof typeof U

const ORG = "uilut3A3HnV13RiZXYqd3KgeNCH3"
const OTHER_ORG = "org-other"
const T0 = "2026-10-07T09:00:00Z"
const T1 = "2026-10-08T09:00:00Z"

const U = {
  owner: ORG,
  rep: "u_rep",
  rep2: "u_rep2",
  mgr: "u_mgr",
  approver: "u_approver",
  fin: "u_fin",
  fininv: "u_fininv",
  acct: "u_acct",
  wh: "u_wh",
  crm: "u_crm",
  closer: "u_closer",
  closeOnly: "u_closeonly",
  repCloser: "u_repcloser",
  viewer: "u_viewer",
  pm: "u_pm",
  stranger: "u_stranger",
  admin: "u_admin",
  realMember: "ALeoSloXkjczUp6dK2DPEKheqcR2",
  realAdmin: "JlqlaiFywLMXOR2j70Tqu0bWja52",
  anon: null as unknown as string,
}

const GROUPS: Record<string, string[]> = {
  g_rep: ["projects.view", "sales.manage", "crm.manage"],
  g_mgr: ["projects.view", "sales.manage", "sales.approve", "crm.manage", "crm.close"],
  g_approver: ["projects.view", "sales.approve"],
  g_fin: ["projects.view", "projects.publish", "offers.view", "offers.accept", "po.approve", "invoices.manage", "accounting.view", "accounting.post"],
  g_fininv: ["invoices.manage"],
  g_acct: ["accounting.post"],
  g_wh: ["warehouses.manage"],
  g_crm: ["crm.manage"],
  g_closer: ["crm.manage", "crm.close"],
  g_closeonly: ["crm.close"],
  g_repcloser: ["projects.view", "sales.manage", "crm.close"],
  g_viewer: ["projects.view"],
  g_pm: ["projects.view", "pm.manage"],
}

const member = (group: string): Data => ({ organizationId: ORG, role: "Contractor", organizationRole: "member", defaultGroupId: group })

const WORLD: Record<string, Data | null> = {
  [`users/${U.owner}`]: { organizationId: ORG, role: "Contractor", organizationRole: "owner" },
  [`users/${U.rep}`]: member("g_rep"),
  [`users/${U.rep2}`]: member("g_rep"),
  [`users/${U.mgr}`]: member("g_mgr"),
  [`users/${U.approver}`]: member("g_approver"),
  [`users/${U.fin}`]: member("g_fin"),
  [`users/${U.fininv}`]: member("g_fininv"),
  [`users/${U.acct}`]: member("g_acct"),
  [`users/${U.wh}`]: member("g_wh"),
  [`users/${U.crm}`]: member("g_crm"),
  [`users/${U.closer}`]: member("g_closer"),
  [`users/${U.closeOnly}`]: member("g_closeonly"),
  [`users/${U.repCloser}`]: member("g_repcloser"),
  [`users/${U.viewer}`]: member("g_viewer"),
  [`users/${U.pm}`]: member("g_pm"),
  [`users/${U.stranger}`]: { organizationId: OTHER_ORG, role: "Contractor", organizationRole: "owner" },
  [`users/${U.admin}`]: { organizationId: U.admin, role: "Admin", organizationRole: "owner" },
  [`users/${U.realMember}`]: member("uilut3A3HnV13RiZXYqd3KgeNCH3_supply_chain"),
  [`teamGroups/uilut3A3HnV13RiZXYqd3KgeNCH3_supply_chain`]: { organizationId: ORG, permissions: ["projects.view", "rfq.create", "rfq.manage", "offers.view", "po.expedite", "suppliers.manage", "deliveries.confirm", "warehouses.manage", "warehouses.receive"] },
  [`users/${U.realAdmin}`]: { organizationId: U.realAdmin, role: "Admin", organizationRole: "owner" },
  "warehouses/w1": { organizationId: ORG },
  ...Object.fromEntries(Object.entries(GROUPS).map(([id, permissions]) => [`teamGroups/${id}`, { organizationId: ORG, permissions }])),
}

const patch = (b: Data, p: Data): Data => ({ ...b, ...p, updatedAt: T1 })

const cases: RuleCase[] = []
const seen = new Set<string>()

function add(name: string, uid: string | null, method: Method, path: string, expect: "ALLOW" | "DENY", b?: Data, a?: Data, ov?: Record<string, Data | null>) {
  const full = `${name}`
  if (seen.has(full)) throw new Error(`duplicate case name: ${full}`)
  seen.add(full)
  cases.push({ name: full, uid, method, path, before: b, after: a, overrides: { ...WORLD, ...ov }, expect })
}

interface Op {
  title: string
  method: Method
  path: string
  before?: Data
  after?: Data
  allow?: Role[]
  deny?: Role[]
  gap?: Role[]
  ov?: Record<string, Data | null>
}

function run(op: Op) {
  for (const r of op.allow ?? []) add(`${op.title}: ${r} ALLOW`, U[r], op.method, op.path, "ALLOW", op.before, op.after, op.ov)
  for (const r of op.deny ?? []) add(`${op.title}: ${r} DENY`, U[r], op.method, op.path, "DENY", op.before, op.after, op.ov)
  for (const r of op.gap ?? []) add(`[GAP] ${op.title}: ${r} should be DENY`, U[r], op.method, op.path, "DENY", op.before, op.after, op.ov)
}

const OUTSIDE: Role[] = ["stranger", "anon"]

// ---------------------------------------------------------------------------
// Document shapes (as the client writes them)
// ---------------------------------------------------------------------------

const BRAND = { logoUrl: null, companyName: "Al Bunyan", crNumber: "1010", vatNumber: "3000", address: "Riyadh", phone: "0500000000", email: "a@b.sa", website: "" }
const INST = [
  { id: "i1", label: "Advance", percent: 30, beforeProduction: true },
  { id: "i2", label: "Balance", percent: 70, beforeProduction: false },
]
const ITEMS = [{ name: "Slab", quantity: 10, unit: "m2", unitPrice: 100 }]

const quote = (status: string, extra: Data = {}): Data => ({
  organizationId: ORG,
  contactId: "c1",
  contactName: "Client",
  opportunityId: null,
  requestId: null,
  quotationNumber: "QT-2026/001",
  revision: 1,
  amount: 1000,
  items: ITEMS,
  installments: INST,
  phase: "pre_manufacturing",
  date: "2026-10-07",
  validityDays: 14,
  validUntil: null,
  notes: null,
  terms: "t",
  leadTime: "2w",
  vatPercent: 15,
  branding: BRAND,
  status,
  workOrderId: null,
  workOrderNumber: null,
  createdByUserId: U.rep,
  createdByUserName: "Rep",
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const qDraft = quote("draft")
const qIssued = quote("issued", { issuedAt: T0, issuedByUserName: "Rep" })
const qSent = quote("sent", { issuedAt: T0, issuedByUserName: "Rep", sentAt: T0, sentByUserName: "Rep", validUntil: "2026-10-21" })
const qAccepted = { ...qSent, status: "accepted", acceptedAt: T0, salesOrderId: "o1" }
const qLost = { ...qSent, status: "rejected", rejectedAt: T0, lostReason: "price" }
const qCreate = (status = "draft", extra: Data = {}): Data => {
  const { updatedAt: _u, ...rest } = quote(status, { createdAt: T1, updatedAt: T1, ...extra })
  return { ...rest, updatedAt: T1 }
}
const Q = "crmQuotations/q1"

const order = (status: string, payment: Data, extra: Data = {}): Data => ({
  organizationId: ORG,
  orderNumber: 1,
  type: "standard",
  status,
  contactId: "c1",
  contactName: "Client",
  projectId: null,
  projectName: null,
  quotationId: "q1",
  quotationNumber: "QT-2026/001",
  frameworkId: null,
  frameworkCap: null,
  frameworkValidUntil: null,
  payment,
  paymentSchedule: INST,
  promiseDate: "2026-11-01",
  vatPercent: 15,
  lines: [{ name: "Slab", unit: "m2", quantity: 10, unitPrice: 100, unitCost: null }],
  measurementRecordedAt: null,
  approvalStatus: "not_required",
  log: [],
  createdByUserId: U.rep,
  createdByUserName: "Rep",
  createdAt: T0,
  updatedAt: T0,
  closedAt: null,
  ...extra,
})
const DEP = { kind: "deposit", depositPercent: 30, depositPaid: false, advanceInstallmentId: "i1" }
const CREDIT = { kind: "credit", creditDays: 30 }
const O = "salesOrders/o1"

const note = (status: string, extra: Data = {}): Data => ({
  organizationId: ORG,
  noteNumber: "DN-1",
  orderId: "o1",
  orderNumber: 1,
  contactId: "c1",
  contactName: "Client",
  status,
  lines: [{ name: "Slab", quantity: 5 }],
  warehouseId: "w1",
  warehouseName: "Main",
  receiverName: null,
  holdReason: null,
  varianceNote: null,
  requestedAt: T0,
  deliveredAt: null,
  deliveredByUserId: null,
  deliveredByUserName: null,
  createdByUserId: U.rep,
  createdByUserName: "Rep",
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const N = "salesDeliveryNotes/n1"

const ret = (status: string, extra: Data = {}): Data => ({
  organizationId: ORG,
  returnNumber: "RT-1",
  orderId: "o1",
  orderNumber: 1,
  contactId: "c1",
  contactName: "Client",
  deliveryNoteId: "n1",
  lines: [{ name: "Slab", quantity: 1 }],
  reason: "damaged",
  status,
  decidedAt: null,
  decidedByUserId: null,
  decidedByUserName: null,
  creditNoteIssuedAt: null,
  createdByUserId: U.rep,
  createdByUserName: "Rep",
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const R = "salesReturns/r1"

const inv = (extra: Data = {}): Data => ({
  organizationId: ORG,
  invoiceNumber: "INV-1",
  contactId: "c1",
  contactName: "Client",
  deliveryNoteIds: ["n1"],
  advance: false,
  orderId: "o1",
  orderNumber: 1,
  advanceNet: null,
  vatPercent: 15,
  issueDate: "2026-10-08",
  dueDate: "2026-11-07",
  paid: false,
  paidAt: null,
  createdByUserId: U.rep,
  createdByUserName: "Rep",
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const INVP = "salesInvoices/inv1"

const notice = (status: string, extra: Data = {}): Data => ({
  organizationId: ORG,
  noticeNumber: "TN-ABC123",
  quotationId: "q1",
  quotationNumber: "QT-2026/001",
  orderId: "o1",
  orderNumber: 1,
  installmentId: "i1",
  installmentLabel: "Advance",
  contactId: "c1",
  contactName: "Client",
  amountStated: 300,
  transferDate: "2026-10-08",
  bankRef: null,
  note: null,
  status,
  financeMessage: null,
  answeredAt: null,
  answeredByUserId: null,
  answeredByUserName: null,
  reportedAt: T0,
  createdByUserId: U.rep,
  createdByUserName: "Rep",
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const TN = "salesTransferNotices/t1"

const qreq = (status: string, extra: Data = {}): Data => ({
  organizationId: ORG,
  requestNumber: "RQ-ABC123",
  contactId: "c1",
  contactName: "Client",
  opportunityId: null,
  opportunityTitle: null,
  lines: [{ name: "Slab", unit: "m2", quantity: 10 }],
  note: null,
  dueDate: null,
  status,
  quotationId: null,
  quotationNumber: null,
  declineReason: null,
  declineNote: null,
  requestedByUserId: U.crm,
  requestedByUserName: "Crm",
  requestedAt: T0,
  decidedAt: null,
  decidedByUserId: null,
  decidedByUserName: null,
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const QR = "salesQuoteRequests/rq1"

const opp = (extra: Data = {}): Data => ({
  organizationId: ORG,
  contactId: "c1",
  contactName: "Client",
  title: "Deal",
  track: "standard",
  value: 1000,
  probability: 50,
  expectedCloseDate: null,
  ownerId: U.crm,
  ownerName: "Crm",
  notes: null,
  scopeTypes: [],
  customScopeType: null,
  customScopeActivity: null,
  route: null,
  contractKind: null,
  source: null,
  consultantContactId: null,
  consultantName: null,
  stage: "negotiation",
  state: "open",
  completedGates: [],
  approvalStatus: "none",
  stageHistory: [],
  addenda: [],
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const OPP = "crmOpportunities/p1"

const contact = (extra: Data = {}): Data => ({
  organizationId: ORG,
  name: "Client",
  type: "client",
  entityType: "company",
  company: null,
  phone: null,
  email: null,
  status: "active",
  source: "referral",
  ownerId: U.crm,
  ownerName: "Crm",
  notes: null,
  city: null,
  crNumber: null,
  tier: "b",
  people: [],
  roles: [],
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const CT = "crmContacts/c1"

const activity = (extra: Data = {}): Data => ({
  organizationId: ORG,
  type: "call",
  title: "Call",
  contactId: "c1",
  contactName: "Client",
  opportunityId: "p1",
  opportunityTitle: "Deal",
  dueDate: "2026-10-09",
  done: false,
  notes: null,
  ownerId: U.crm,
  ownerName: "Crm",
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const ACT = "crmActivities/a1"

const priceItem = (extra: Data = {}): Data => ({
  organizationId: ORG,
  name: "Slab",
  unit: "m2",
  unitPrice: 100,
  cost: 60,
  requiresMeasurement: false,
  requiresApproval: false,
  notes: null,
  createdAt: T0,
  updatedAt: T0,
  ...extra,
})
const PI = "salesPriceItems/pi1"

// ---------------------------------------------------------------------------
// crmQuotations — create
// ---------------------------------------------------------------------------

run({ title: "crmQuotations create draft (createQuotation)", method: "create", path: "crmQuotations/qn", after: qCreate(), allow: ["owner", "rep", "mgr", "repCloser", "crm"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmQuotations create draft naming another company", method: "create", path: "crmQuotations/qn", after: qCreate("draft", { organizationId: OTHER_ORG }), deny: ["rep", "owner"] })
run({ title: "crmQuotations create revision draft (reviseQuotation)", method: "create", path: "crmQuotations/qn2", after: qCreate("draft", { quotationNumber: "QT-2026/001-2", revision: 2, revisionOf: "q1" }), allow: ["rep"] })
run({ title: "crmQuotations create as accepted", method: "create", path: "crmQuotations/qn", after: qCreate("accepted"), allow: ["owner", "mgr", "approver", "closer"], deny: ["rep", "crm", "fin"] })
run({ title: "crmQuotations create as sent (legacy CRM submitted-price step)", method: "create", path: "crmQuotations/qn", after: qCreate("sent", { version: 1, paymentTerms: null, validityDays: 30 }), allow: ["crm", "rep", "owner"] })

// ---------------------------------------------------------------------------
// crmQuotations — lifecycle
// ---------------------------------------------------------------------------

const issuePatch = { status: "issued", issuedAt: T1, issuedByUserName: "Rep" }
run({ title: "crmQuotations draft->issued", method: "update", path: Q, before: qDraft, after: patch(qDraft, issuePatch), allow: ["owner", "rep", "mgr", "repCloser"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmQuotations draft->issued changing organization", method: "update", path: Q, before: qDraft, after: patch(qDraft, { ...issuePatch, organizationId: OTHER_ORG }), deny: ["rep", "owner"] })
run({ title: "crmQuotations draft->sent (skip issue)", method: "update", path: Q, before: qDraft, after: patch(qDraft, { status: "sent", sentAt: T1 }), deny: ["rep", "owner", "mgr"] })
run({ title: "crmQuotations draft->accepted (skip issue and send)", method: "update", path: Q, before: qDraft, after: patch(qDraft, { status: "accepted", acceptedAt: T1, salesOrderId: "o1" }), deny: ["owner", "mgr", "closer"] })
run({ title: "crmQuotations draft->rejected", method: "update", path: Q, before: qDraft, after: patch(qDraft, { status: "rejected", lostReason: "x" }), deny: ["rep", "mgr"] })

run({ title: "crmQuotations draft figures edit (useQuotationForm save)", method: "update", path: Q, before: qDraft, after: patch(qDraft, { amount: 2000, items: [{ name: "Slab", quantity: 20, unit: "m2", unitPrice: 100 }], installments: INST, validityDays: 30, contactId: "c2", contactName: "Other", validUntil: null }), allow: ["owner", "rep", "mgr", "crm"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmQuotations draft edit by a different rep (scope)", method: "update", path: Q, before: qDraft, after: patch(qDraft, { amount: 2000 }), gap: ["rep2"] })

run({ title: "crmQuotations issued->sent (logQuotationSent)", method: "update", path: Q, before: qIssued, after: patch(qIssued, { status: "sent", sentAt: T1, sentByUserName: "Rep", validityDays: 14, validUntil: "2026-10-22" }), allow: ["owner", "rep", "mgr"], deny: OUTSIDE })
run({ title: "crmQuotations issued->sent changing validityDays", method: "update", path: Q, before: qIssued, after: patch(qIssued, { status: "sent", sentAt: T1, validityDays: 30, validUntil: "2026-11-07" }), deny: ["rep", "owner"] })
run({ title: "crmQuotations issued->sent changing amount", method: "update", path: Q, before: qIssued, after: patch(qIssued, { status: "sent", sentAt: T1, amount: 1 }), deny: ["rep", "owner"] })
run({ title: "crmQuotations issued->accepted (skip send)", method: "update", path: Q, before: qIssued, after: patch(qIssued, { status: "accepted", acceptedAt: T1, salesOrderId: "o1" }), deny: ["owner", "mgr"] })
run({ title: "crmQuotations issued->rejected", method: "update", path: Q, before: qIssued, after: patch(qIssued, { status: "rejected", lostReason: "x" }), deny: ["rep", "mgr"] })
run({ title: "crmQuotations issued->draft (re-open)", method: "update", path: Q, before: qIssued, after: patch(qIssued, { status: "draft" }), deny: ["rep", "owner"] })

const textsPatch = { notes: "n", terms: "new terms", leadTime: "3w", branding: { ...BRAND, companyName: "New" } }
run({ title: "crmQuotations issued texts edit (useQuotationForm texts mode)", method: "update", path: Q, before: qIssued, after: patch(qIssued, textsPatch), allow: ["owner", "rep", "mgr"], deny: OUTSIDE })
run({ title: "crmQuotations issued amount edit", method: "update", path: Q, before: qIssued, after: patch(qIssued, { amount: 5 }), deny: ["rep", "owner", "mgr"] })
run({ title: "crmQuotations issued items edit", method: "update", path: Q, before: qIssued, after: patch(qIssued, { items: [{ name: "Slab", quantity: 1, unit: "m2", unitPrice: 1 }] }), deny: ["rep", "owner"] })
run({ title: "crmQuotations issued installments edit", method: "update", path: Q, before: qIssued, after: patch(qIssued, { installments: [{ id: "i1", label: "All", percent: 100, beforeProduction: false }] }), deny: ["rep"] })
run({ title: "crmQuotations issued client change", method: "update", path: Q, before: qIssued, after: patch(qIssued, { contactId: "c2" }), deny: ["rep"] })
run({ title: "crmQuotations issued vatPercent edit", method: "update", path: Q, before: qIssued, after: patch(qIssued, { vatPercent: 0 }), deny: ["rep"] })
run({ title: "crmQuotations issued validityDays edit", method: "update", path: Q, before: qIssued, after: patch(qIssued, { validityDays: 30 }), deny: ["rep"] })
run({ title: "crmQuotations issued quotationNumber edit", method: "update", path: Q, before: qIssued, after: patch(qIssued, { quotationNumber: "QT-2026/999" }), deny: ["rep", "owner"] })

run({ title: "crmQuotations sent terms edit", method: "update", path: Q, before: qSent, after: patch(qSent, { terms: "changed" }), deny: ["rep", "owner", "mgr"] })
run({ title: "crmQuotations sent notes edit", method: "update", path: Q, before: qSent, after: patch(qSent, { notes: "changed" }), deny: ["rep", "owner"] })
run({ title: "crmQuotations sent branding edit", method: "update", path: Q, before: qSent, after: patch(qSent, { branding: { ...BRAND, companyName: "X" } }), deny: ["rep"] })
run({ title: "crmQuotations sent amount edit", method: "update", path: Q, before: qSent, after: patch(qSent, { amount: 1 }), deny: ["rep", "owner"] })
run({ title: "crmQuotations sent extend validity (extendQuotation)", method: "update", path: Q, before: qSent, after: patch(qSent, { validUntil: "2026-11-05", extendedAt: T1, extendedByUserName: "Rep" }), allow: ["rep", "owner", "mgr"], deny: OUTSIDE })
run({ title: "crmQuotations sent superseded stamp (reviseQuotation)", method: "update", path: Q, before: qSent, after: patch(qSent, { supersededById: "q2", supersededAt: T1 }), allow: ["rep", "owner"] })
run({ title: "crmQuotations issued superseded stamp (reviseQuotation)", method: "update", path: Q, before: qIssued, after: patch(qIssued, { supersededById: "q2", supersededAt: T1 }), allow: ["rep", "owner"] })
run({ title: "crmQuotations sent->issued (step back)", method: "update", path: Q, before: qSent, after: patch(qSent, { status: "issued" }), deny: ["rep", "owner"] })
run({ title: "crmQuotations sent->draft (step back)", method: "update", path: Q, before: qSent, after: patch(qSent, { status: "draft" }), deny: ["rep", "owner"] })

const lostPatch = { status: "rejected", rejectedAt: T1, lostReason: "Chose a competitor", lostByUserName: "Rep" }
run({ title: "crmQuotations sent->rejected with reason (closeQuotationLost)", method: "update", path: Q, before: qSent, after: patch(qSent, lostPatch), allow: ["rep", "owner", "mgr"], deny: OUTSIDE })
run({ title: "crmQuotations sent->rejected without reason", method: "update", path: Q, before: qSent, after: patch(qSent, { status: "rejected", rejectedAt: T1, lostByUserName: "Rep" }), deny: ["rep", "owner"] })
run({ title: "crmQuotations sent->rejected with blank reason", method: "update", path: Q, before: qSent, after: patch(qSent, { ...lostPatch, lostReason: "" }), deny: ["rep"] })

const acceptPatch = { salesOrderId: "o1", status: "accepted", acceptedAt: T1 }
run({ title: "crmQuotations sent->accepted (runQuotationAcceptance batch)", method: "update", path: Q, before: qSent, after: patch(qSent, acceptPatch), allow: ["owner", "mgr", "approver", "closer", "repCloser", "closeOnly"], deny: ["rep", "crm", "fin", "fininv", "viewer", ...OUTSIDE] })
run({ title: "crmQuotations sent->accepted with figures changed", method: "update", path: Q, before: qSent, after: patch(qSent, { ...acceptPatch, amount: 1 }), deny: ["owner", "mgr"] })
run({ title: "crmQuotations stamp salesOrderId only, status kept sent (twin repair, no accept)", method: "update", path: Q, before: qSent, after: patch(qSent, { salesOrderId: "o1" }), allow: ["rep", "owner"] })
run({ title: "crmQuotations accepted->sent (re-open)", method: "update", path: Q, before: qAccepted, after: patch(qAccepted, { status: "sent" }), deny: ["owner", "mgr"] })
run({ title: "crmQuotations accepted->rejected", method: "update", path: Q, before: qAccepted, after: patch(qAccepted, { status: "rejected", lostReason: "x" }), deny: ["owner", "mgr"] })
run({ title: "crmQuotations rejected->sent (re-open)", method: "update", path: Q, before: qLost, after: patch(qLost, { status: "sent" }), deny: ["owner", "mgr"] })
run({ title: "crmQuotations rejected->accepted", method: "update", path: Q, before: qLost, after: patch(qLost, { status: "accepted" }), deny: ["owner", "mgr"] })
run({ title: "crmQuotations accepted amount edit", method: "update", path: Q, before: qAccepted, after: patch(qAccepted, { amount: 1 }), deny: ["owner", "mgr"] })
run({ title: "crmQuotations accepted workOrderId stamp, no updatedAt (legacy work order)", method: "update", path: Q, before: qAccepted, after: { ...qAccepted, workOrderId: "wo1" }, allow: ["rep", "owner", "mgr"], deny: OUTSIDE })

const payments = [{ installmentId: "i1", entries: [{ paidAt: T1, paidAmount: 300, paidByUserId: U.fininv, paidByUserName: "Fin", note: null }] }]
const payPatch = { payments, paidAmount: 300, paidAt: T1 }
run({ title: "crmQuotations record payment (recordInstallmentPayment / answerTransferNotice)", method: "update", path: Q, before: qAccepted, after: patch(qAccepted, payPatch), allow: ["owner", "fin", "fininv", "acct", "approver", "mgr"], deny: ["rep", "crm", "closer", "closeOnly", "viewer", "wh", ...OUTSIDE] })
run({ title: "crmQuotations record full payment with paidBy stamps", method: "update", path: Q, before: qAccepted, after: patch(qAccepted, { ...payPatch, paidByUserId: U.fininv, paidByUserName: "Fin", paymentNote: "TN-ABC123" }), allow: ["fininv", "approver"], deny: ["rep"] })
run({ title: "crmQuotations record payment on a sent quote (advance before acceptance)", method: "update", path: Q, before: qSent, after: patch(qSent, payPatch), allow: ["fininv", "approver"], deny: ["rep"] })
run({ title: "crmQuotations rename contactName on draft (renameContactReferences)", method: "update", path: Q, before: qDraft, after: { ...qDraft, contactName: "Renamed" }, allow: ["crm", "rep"], deny: OUTSIDE })
run({ title: "crmQuotations rename contactName on sent", method: "update", path: Q, before: qSent, after: { ...qSent, contactName: "Renamed" }, allow: ["crm"] })
run({ title: "crmQuotations rename contactName on accepted", method: "update", path: Q, before: qAccepted, after: { ...qAccepted, contactName: "Renamed" }, allow: ["crm"] })
run({ title: "crmQuotations rename contactName on rejected", method: "update", path: Q, before: qLost, after: { ...qLost, contactName: "Renamed" }, allow: ["crm"] })

// ---------------------------------------------------------------------------
// crmQuotations — delete / read
// ---------------------------------------------------------------------------

run({ title: "crmQuotations delete draft", method: "delete", path: Q, before: qDraft, allow: ["owner", "rep", "crm", "closer"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmQuotations delete issued", method: "delete", path: Q, before: qIssued, allow: ["owner", "closer", "approver", "mgr"], deny: ["rep", "crm", "viewer", ...OUTSIDE] })
run({ title: "crmQuotations delete sent (deleteOpportunityCascade / deleteContactCascade by crm.manage member)", method: "delete", path: Q, before: qSent, allow: ["owner", "closer", "mgr", "crm"], deny: ["rep", ...OUTSIDE] })
run({ title: "crmQuotations delete accepted (cascade by crm.manage member)", method: "delete", path: Q, before: qAccepted, allow: ["owner", "closer", "crm"], deny: ["rep"] })
run({ title: "crmQuotations get", method: "get", path: Q, before: qDraft, allow: ["owner", "rep", "viewer", "fin", "realMember"], deny: OUTSIDE })
run({ title: "crmQuotations list", method: "list", path: Q, before: qDraft, allow: ["owner", "rep"], deny: ["anon"], gap: ["stranger"] })

// ---------------------------------------------------------------------------
// crmOpportunities
// ---------------------------------------------------------------------------

const oppNew = { ...opp({ stage: "new", createdAt: T1, updatedAt: T1, stageHistory: [{ event: "new" }] }) }
run({ title: "crmOpportunities create open (CrmOpportunityDialog)", method: "create", path: "crmOpportunities/pn", after: oppNew, allow: ["owner", "crm", "closer", "rep"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmOpportunities create as won", method: "create", path: "crmOpportunities/pn", after: { ...oppNew, state: "won" }, deny: ["owner", "closer"] })
run({ title: "crmOpportunities create as lost stage", method: "create", path: "crmOpportunities/pn", after: { ...oppNew, stage: "lost" }, deny: ["owner", "closer"] })
run({ title: "crmOpportunities create as handed_over", method: "create", path: "crmOpportunities/pn", after: { ...oppNew, state: "handed_over" }, deny: ["owner"] })
run({ title: "crmOpportunities create renewal (createRenewalOpportunity)", method: "create", path: "crmOpportunities/pn", after: { ...oppNew, track: "renewal", renewalOfOpportunityId: "p0", previousContractValue: 900, probability: 60 }, allow: ["crm", "owner"] })

run({ title: "crmOpportunities edit details (CrmOpportunityDialog)", method: "update", path: OPP, before: opp(), after: patch(opp(), { title: "Deal 2", value: 2000, ownerId: U.rep, notes: "n" }), allow: ["owner", "crm", "closer"], deny: OUTSIDE })
run({ title: "crmOpportunities move stage (moveStage)", method: "update", path: OPP, before: opp({ stage: "new" }), after: patch(opp({ stage: "new" }), { stage: "negotiation", state: "open", stageHistory: [{ event: "negotiation" }] }), allow: ["crm", "owner"], deny: OUTSIDE })
run({ title: "crmOpportunities toggle gate", method: "update", path: OPP, before: opp(), after: patch(opp(), { completedGates: ["g1"] }), allow: ["crm", "owner"] })
run({ title: "crmOpportunities advance stage (not won)", method: "update", path: OPP, before: opp({ stage: "new" }), after: patch(opp({ stage: "new" }), { stage: "negotiation", stageHistory: [{ event: "negotiation" }] }), allow: ["crm"] })
run({ title: "crmOpportunities put on hold (CrmCloseDialog hold)", method: "update", path: OPP, before: opp(), after: patch(opp(), { state: "on_hold", holdReason: "client_postponed", holdUntil: "2026-12-01", stageHistory: [{ event: "on_hold" }] }), allow: ["crm", "owner"], deny: OUTSIDE })
run({ title: "crmOpportunities reactivate from hold", method: "update", path: OPP, before: opp({ state: "on_hold" }), after: patch(opp({ state: "on_hold" }), { state: "open", holdReason: null, holdUntil: null }), allow: ["crm", "owner"] })
run({ title: "crmOpportunities stage move out of hold (moveStage on_hold deal)", method: "update", path: OPP, before: opp({ state: "on_hold" }), after: patch(opp({ state: "on_hold" }), { stage: "new", state: "open" }), allow: ["crm"] })
run({ title: "crmOpportunities set estimate / approved cost / submitted price", method: "update", path: OPP, before: opp(), after: patch(opp(), { submittedPrice: 1200, approvalStatus: "approved", approvalAmount: 1200, approvedByName: "Crm" }), allow: ["crm", "owner"] })
run({ title: "crmOpportunities addendum (CrmAddendumDialog)", method: "update", path: OPP, before: opp(), after: patch(opp(), { addenda: [{ number: 1, at: T1, note: "n", newDate: null, newValue: 1100 }], value: 1100 }), allow: ["crm", "owner"] })
run({ title: "crmOpportunities record award (CrmValueDialog award)", method: "update", path: OPP, before: opp(), after: patch(opp(), { awardedValue: 1000, stage: "won", state: "won", wonReason: "price", stageHistory: [{ event: "won" }] }), allow: ["owner", "closer", "mgr", "repCloser", "closeOnly"], deny: ["crm", "rep", "viewer", ...OUTSIDE] })
run({ title: "crmOpportunities edit award of an already won deal", method: "update", path: OPP, before: opp({ stage: "won", state: "won" }), after: patch(opp({ stage: "won", state: "won" }), { awardedValue: 900, wonReason: "price" }), allow: ["closer", "crm"] })
run({ title: "crmOpportunities close lost (CrmCloseDialog lost)", method: "update", path: OPP, before: opp(), after: patch(opp(), { stage: "lost", state: "lost", lostReason: "price", lostToCompetitor: null, competitorPrice: null, lessonLearned: null, stageHistory: [{ event: "lost" }] }), allow: ["owner", "closer", "mgr"], deny: ["crm", "rep", ...OUTSIDE] })
run({ title: "crmOpportunities close lost from hold", method: "update", path: OPP, before: opp({ state: "on_hold" }), after: patch(opp({ state: "on_hold" }), { stage: "lost", state: "lost", lostReason: "price" }), allow: ["closer"], deny: ["crm"] })
run({ title: "crmOpportunities send handover (state handed_over)", method: "update", path: OPP, before: opp({ stage: "won", state: "won" }), after: patch(opp({ stage: "won", state: "won" }), { state: "handed_over", stage: "won", pmHandoverId: "h1", projectId: null, handoverStatus: "pending", projectManagerId: U.pm, projectManagerName: "PM", handedOverAt: T1 }), allow: ["owner", "closer", "mgr"], deny: ["crm", "pm", "rep"] })
const handed = opp({ stage: "won", state: "handed_over", pmHandoverId: "h1", projectManagerId: U.pm })
run({ title: "crmOpportunities PM reassigns manager (reassignHandover)", method: "update", path: OPP, before: handed, after: patch(handed, { projectManagerId: "u_other_pm", projectManagerName: "PM2" }), allow: ["pm", "owner"] })
run({ title: "crmOpportunities PM returns handover, deal back to won (returnHandover)", method: "update", path: OPP, before: handed, after: patch(handed, { state: "won", handoverStatus: "rejected", handoverRejectReason: "missing", pmHandoverId: null }), allow: ["pm", "owner"] })
run({ title: "crmOpportunities PM accepts handover stamps project (acceptHandover)", method: "update", path: OPP, before: handed, after: patch(handed, { projectId: "pr1", handoverStatus: "accepted", projectManagerId: U.pm, projectManagerName: "PM" }), allow: ["pm", "owner"] })
run({ title: "crmOpportunities respond to handover rejected (legacy respondToHandover)", method: "update", path: OPP, before: handed, after: patch(handed, { handoverStatus: "rejected", handoverRejectReason: "r", state: "won", projectId: null, projectManagerId: null, projectManagerName: null }), allow: ["pm"] })
run({ title: "crmOpportunities rename contactName (renameContactReferences)", method: "update", path: OPP, before: opp({ stage: "won", state: "won" }), after: { ...opp({ stage: "won", state: "won" }), contactName: "Renamed" }, allow: ["crm"] })
run({ title: "crmOpportunities rename contactName on handed_over deal", method: "update", path: OPP, before: handed, after: { ...handed, contactName: "Renamed" }, allow: ["crm"] })
run({ title: "crmOpportunities move deal into another company", method: "update", path: OPP, before: opp(), after: patch(opp(), { organizationId: OTHER_ORG }), gap: ["crm", "owner"] })
run({ title: "crmOpportunities delete", method: "delete", path: OPP, before: opp(), allow: ["owner", "crm"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmOpportunities get", method: "get", path: OPP, before: opp(), allow: ["owner", "crm", "viewer"], deny: OUTSIDE })
run({ title: "crmOpportunities list", method: "list", path: OPP, before: opp(), allow: ["owner"], deny: ["anon"], gap: ["stranger"] })
const OPPF = "crmOpportunities/p1/files/f1"
const oppFile = (by: string, extra: Data = {}): Data => ({ organizationId: ORG, byId: by, name: "site.jpg", url: "https://x", createdAt: T1, ...extra })
run({ title: "crmOpportunities file add in own name (OPP-10)", method: "create", path: OPPF, after: oppFile(U.crm), allow: ["crm"], deny: OUTSIDE })
run({ title: "crmOpportunities file add by the owner", method: "create", path: OPPF, after: oppFile(U.owner), allow: ["owner"] })
run({ title: "crmOpportunities file add in someone else name", method: "create", path: OPPF, after: oppFile(U.rep), deny: ["crm", "owner"] })
run({ title: "crmOpportunities file add into another company", method: "create", path: OPPF, after: oppFile(U.crm, { organizationId: OTHER_ORG }), deny: ["crm"] })
run({ title: "crmOpportunities file read", method: "get", path: OPPF, before: oppFile(U.crm), allow: ["crm", "owner", "viewer"], deny: OUTSIDE })
run({ title: "crmOpportunities file removed by its adder", method: "delete", path: OPPF, before: oppFile(U.crm), allow: ["crm"] })
run({ title: "crmOpportunities file removed by someone else", method: "delete", path: OPPF, before: oppFile(U.crm), deny: ["owner", "rep", "viewer", ...OUTSIDE] })
run({ title: "crmOpportunities file edited", method: "update", path: OPPF, before: oppFile(U.crm), after: oppFile(U.crm, { name: "x" }), deny: ["crm", "owner"] })

// ---------------------------------------------------------------------------
// crmContacts / crmActivities / crmOrgProfile
// ---------------------------------------------------------------------------

const ctNew = contact({ createdAt: T1, updatedAt: T1 })
run({ title: "crmContacts create", method: "create", path: "crmContacts/cn", after: ctNew, allow: ["owner", "crm", "closer"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmContacts create for another company", method: "create", path: "crmContacts/cn", after: contact({ organizationId: OTHER_ORG }), deny: ["owner", "crm"] })
run({ title: "crmContacts update (rename)", method: "update", path: CT, before: contact(), after: patch(contact(), { name: "Renamed", phone: "050", email: "a@b.sa", tier: "a" }), allow: ["owner", "crm"], deny: OUTSIDE })
run({ title: "crmContacts update moving it to another company", method: "update", path: CT, before: contact(), after: patch(contact(), { organizationId: OTHER_ORG }), gap: ["crm", "owner"] })
run({ title: "crmContacts delete (deleteContactCascade last step)", method: "delete", path: CT, before: contact(), allow: ["owner", "crm"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmContacts get", method: "get", path: CT, before: contact(), allow: ["owner", "crm", "viewer"], deny: OUTSIDE })
run({ title: "crmContacts list", method: "list", path: CT, before: contact(), allow: ["owner"], deny: ["anon"], gap: ["stranger"] })

const actNew = activity({ createdAt: T1, updatedAt: T1 })
run({ title: "crmActivities create (CrmActivityDialog)", method: "create", path: "crmActivities/an", after: actNew, allow: ["owner", "crm"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmActivities create from Sales (logQuoteEventInCrm)", method: "create", path: "crmActivities/an", after: activity({ type: "task", title: "Quote sent", opportunityTitle: null, done: true, source: "sales", ownerId: U.rep, ownerName: "Rep", createdAt: T1, updatedAt: T1 }), allow: ["rep", "approver", "mgr"] })
run({ title: "crmActivities create follow-up (createFollowUp after close/lost)", method: "create", path: "crmActivities/an", after: activity({ done: false, notes: null, createdAt: T1, updatedAt: T1 }), allow: ["closer"] })
run({ title: "crmActivities create for another company", method: "create", path: "crmActivities/an", after: activity({ organizationId: OTHER_ORG }), deny: ["owner", "crm"] })
run({ title: "crmActivities toggle done", method: "update", path: ACT, before: activity(), after: patch(activity(), { done: true }), allow: ["owner", "crm"], deny: OUTSIDE })
run({ title: "crmActivities edit", method: "update", path: ACT, before: activity(), after: patch(activity(), { title: "New", dueDate: "2026-10-12", notes: "n" }), allow: ["crm"] })
run({ title: "crmActivities clear deal link (deleteOpportunityCascade)", method: "update", path: ACT, before: activity(), after: { ...activity(), opportunityId: null, opportunityTitle: null }, allow: ["crm"] })
run({ title: "crmActivities move to another company", method: "update", path: ACT, before: activity(), after: patch(activity(), { organizationId: OTHER_ORG }), gap: ["crm"] })
run({ title: "crmActivities delete", method: "delete", path: ACT, before: activity(), allow: ["owner", "crm"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmActivities get", method: "get", path: ACT, before: activity(), allow: ["owner", "viewer"], deny: OUTSIDE })
run({ title: "crmActivities list", method: "list", path: ACT, before: activity(), allow: ["owner"], deny: ["anon"], gap: ["stranger"] })

const profile = { organizationId: ORG, classifications: {}, annualCeiling: 1000000, underExecution: 1000, updatedAt: T1 }
run({ title: "crmOrgProfile first save (CrmSettingsView setDoc merge, create)", method: "create", path: `crmOrgProfile/${ORG}`, after: profile, allow: ["owner", "crm", "rep"], deny: OUTSIDE, gap: ["viewer"] })
run({ title: "crmOrgProfile update (settings)", method: "update", path: `crmOrgProfile/${ORG}`, before: { ...profile, updatedAt: T0 }, after: profile, allow: ["owner", "crm"], deny: OUTSIDE })
run({ title: "crmOrgProfile logo default (QuotationLogoField)", method: "update", path: `crmOrgProfile/${ORG}`, before: { ...profile, updatedAt: T0 }, after: { ...profile, quotationLogoUrl: "https://x/logo.png", quotationLogoPath: "p" }, allow: ["rep", "mgr"] })
run({ title: "crmOrgProfile with mismatching organizationId field", method: "update", path: `crmOrgProfile/${ORG}`, before: { ...profile, updatedAt: T0 }, after: { ...profile, organizationId: OTHER_ORG }, deny: ["owner", "crm"] })
run({ title: "crmOrgProfile another company's profile", method: "update", path: `crmOrgProfile/${OTHER_ORG}`, before: { ...profile, organizationId: OTHER_ORG, updatedAt: T0 }, after: { ...profile, organizationId: OTHER_ORG }, deny: ["owner", "crm"] })
run({ title: "crmOrgProfile get", method: "get", path: `crmOrgProfile/${ORG}`, allow: ["owner", "viewer"], deny: OUTSIDE })
run({ title: "crmOrgProfile list", method: "list", path: `crmOrgProfile/${ORG}`, allow: ["owner"], deny: ["anon"], gap: ["stranger"] })

// ---------------------------------------------------------------------------
// salesPriceItems
// ---------------------------------------------------------------------------

const piNew = priceItem({ createdAt: T1, updatedAt: T1 })
run({ title: "salesPriceItems create", method: "create", path: "salesPriceItems/pn", after: piNew, allow: ["owner", "mgr", "approver"], deny: ["rep", "crm", "fin", "viewer", ...OUTSIDE] })
run({ title: "salesPriceItems create for another company", method: "create", path: "salesPriceItems/pn", after: priceItem({ organizationId: OTHER_ORG }), deny: ["owner", "mgr"] })
run({ title: "salesPriceItems update", method: "update", path: PI, before: priceItem(), after: patch(priceItem(), { unitPrice: 120, cost: 70, requiresApproval: true }), allow: ["owner", "mgr", "approver"], deny: ["rep", "fin", "viewer", ...OUTSIDE] })
run({ title: "salesPriceItems update moving item to another company", method: "update", path: PI, before: priceItem(), after: patch(priceItem(), { organizationId: OTHER_ORG }), gap: ["mgr", "owner"] })
run({ title: "salesPriceItems delete", method: "delete", path: PI, before: priceItem(), allow: ["owner", "mgr", "approver"], deny: ["rep", "viewer", ...OUTSIDE] })
run({ title: "salesPriceItems get", method: "get", path: PI, before: priceItem(), allow: ["owner", "rep", "viewer"], deny: OUTSIDE })
run({ title: "salesPriceItems list", method: "list", path: PI, before: priceItem(), allow: ["owner", "rep"], deny: ["anon", "stranger"] })

// ---------------------------------------------------------------------------
// salesOrders
// ---------------------------------------------------------------------------

const oDeposit = order("awaiting_deposit", DEP)
const oRunning = order("running", { ...DEP, depositPaid: true, depositPaidAt: T0 })
const oCredit = order("running", CREDIT)
const oNew = order("awaiting_deposit", DEP, { createdAt: T1, updatedAt: T1, log: [{ at: T1, by: "Rep", kind: "created", detail: "QT-2026/001" }] })
run({ title: "salesOrders create from quotation (createSalesOrderFromQuotation)", method: "create", path: "salesOrders/on", after: oNew, allow: ["owner", "rep", "mgr", "approver", "repCloser"], deny: ["fin", "fininv", "crm", "closer", "viewer", ...OUTSIDE] })
run({ title: "salesOrders create for another company", method: "create", path: "salesOrders/on", after: order("running", CREDIT, { organizationId: OTHER_ORG }), deny: ["owner", "rep"] })
run({ title: "salesOrders create call-off (createCallOff)", method: "create", path: "salesOrders/on", after: order("running", CREDIT, { frameworkId: "fw1", quotationId: null, quotationNumber: null, promiseDate: null, createdAt: T1, updatedAt: T1 }), allow: ["rep", "owner"] })

const reported = patch(oDeposit, { payment: { ...DEP, depositReportedAt: T1, depositReportedBy: "Rep" } })
run({ title: "salesOrders report deposit received (reportDepositReceived)", method: "update", path: O, before: oDeposit, after: reported, allow: ["owner", "rep", "approver"], deny: ["fin", "fininv", "viewer", ...OUTSIDE] })
const released = patch(oDeposit, { payment: { ...DEP, depositPaid: true, depositPaidAt: T1 }, status: "running" })
run({ title: "salesOrders release on confirmed advance (answerTransferNotice / confirmAdvance)", method: "update", path: O, before: oDeposit, after: released, allow: ["owner", "fin", "fininv", "acct", "approver", "rep", "mgr"], deny: ["crm", "viewer", "wh", ...OUTSIDE] })
run({ title: "salesOrders release by crm.close-only member (SalesOrdersView canConfirmDeposit via crm.close)", method: "update", path: O, before: oDeposit, after: released, allow: ["closeOnly"] })
run({ title: "salesOrders release while changing lines", method: "update", path: O, before: oDeposit, after: patch(released, { lines: [] }), deny: ["fininv", "acct"] })
run({ title: "salesOrders release without depositPaid", method: "update", path: O, before: oDeposit, after: patch(oDeposit, { status: "running" }), deny: ["fininv", "acct"] })
run({ title: "salesOrders release on a credit order", method: "update", path: O, before: order("awaiting_deposit", CREDIT), after: patch(order("awaiting_deposit", CREDIT), { status: "running", payment: { ...CREDIT, depositPaid: true } }), deny: ["fininv"] })
run({ title: "salesOrders release changing depositPercent", method: "update", path: O, before: oDeposit, after: patch(released, { payment: { ...DEP, depositPercent: 5, depositPaid: true, depositPaidAt: T1 } }), deny: ["fininv"] })
run({ title: "salesOrders release of an order not awaiting deposit", method: "update", path: O, before: oRunning, after: patch(oRunning, { status: "running", payment: { ...oRunning.payment as Data, depositPaidAt: T1 } }), deny: ["fininv"] })
run({ title: "salesOrders reset promise (resetOrderPromise)", method: "update", path: O, before: oRunning, after: patch(oRunning, { promiseDate: "2026-11-15", log: [{ at: T1, by: "Rep", kind: "promise_reset", detail: "x" }] }), allow: ["rep", "owner", "mgr"], deny: ["fininv", "viewer", ...OUTSIDE] })
run({ title: "salesOrders record measurement / approve drawings", method: "update", path: O, before: oRunning, after: patch(oRunning, { measurementRecordedAt: T1, approvalStatus: "approved" }), allow: ["rep", "owner"], deny: ["fininv", "viewer"] })
run({ title: "salesOrders close after final delivery (confirmDelivery tx)", method: "update", path: O, before: oRunning, after: patch(oRunning, { status: "closed", closedAt: T1 }), allow: ["rep", "owner", "mgr"], deny: ["fininv", "wh", "viewer"] })
run({ title: "salesOrders move to another company", method: "update", path: O, before: oRunning, after: patch(oRunning, { organizationId: OTHER_ORG }), deny: ["rep", "owner"] })
run({ title: "salesOrders delete", method: "delete", path: O, before: oRunning, deny: ["owner", "rep", "mgr"] })
run({ title: "salesOrders get", method: "get", path: O, before: oRunning, allow: ["owner", "viewer", "fin"], deny: OUTSIDE })
run({ title: "salesOrders list", method: "list", path: O, before: oRunning, allow: ["owner", "rep"], deny: OUTSIDE })

// ---------------------------------------------------------------------------
// salesTransferNotices
// ---------------------------------------------------------------------------

const tnNew = notice("reported", { createdAt: T1, updatedAt: T1, reportedAt: T1 })
run({ title: "salesTransferNotices create (reportTransfer)", method: "create", path: "salesTransferNotices/tn", after: tnNew, allow: ["owner", "rep", "approver", "mgr"], deny: ["fin", "fininv", "acct", "crm", "viewer", ...OUTSIDE] })
run({ title: "salesTransferNotices create already confirmed", method: "create", path: "salesTransferNotices/tn", after: notice("confirmed"), deny: ["rep", "owner"] })
run({ title: "salesTransferNotices create for another company", method: "create", path: "salesTransferNotices/tn", after: notice("reported", { organizationId: OTHER_ORG }), deny: ["rep"] })
const answered = (status: string) => patch(notice("reported"), { status, financeMessage: status === "not_found" ? "not found" : null, answeredAt: T1, answeredByUserId: U.fininv, answeredByUserName: "Fin" })
run({ title: "salesTransferNotices confirm (answerTransferNotice)", method: "update", path: TN, before: notice("reported"), after: answered("confirmed"), allow: ["owner", "fin", "fininv", "acct", "approver", "mgr"], deny: ["rep", "crm", "viewer", "wh", ...OUTSIDE] })
run({ title: "salesTransferNotices answer not found", method: "update", path: TN, before: notice("reported"), after: answered("not_found"), allow: ["fininv", "acct", "approver"], deny: ["rep"] })
run({ title: "salesTransferNotices answer moving it to another company", method: "update", path: TN, before: notice("reported"), after: patch(answered("confirmed"), { organizationId: OTHER_ORG }), deny: ["fininv", "owner"] })
run({ title: "salesTransferNotices delete", method: "delete", path: TN, before: notice("reported"), deny: ["owner", "rep", "fininv"] })
run({ title: "salesTransferNotices get", method: "get", path: TN, before: notice("reported"), allow: ["owner", "rep", "fininv"], deny: OUTSIDE })

// ---------------------------------------------------------------------------
// salesQuoteRequests
// ---------------------------------------------------------------------------

const qrNew = qreq("new", { createdAt: T1, updatedAt: T1, requestedAt: T1 })
run({ title: "salesQuoteRequests create (createQuoteRequest from CRM)", method: "create", path: "salesQuoteRequests/qr", after: qrNew, allow: ["owner", "crm", "closer", "mgr", "rep"], deny: ["approver", "fin", "viewer", ...OUTSIDE] })
run({ title: "salesQuoteRequests create not new", method: "create", path: "salesQuoteRequests/qr", after: qreq("quoted"), deny: ["crm", "owner"] })
run({ title: "salesQuoteRequests decline (declineQuoteRequest)", method: "update", path: QR, before: qreq("new"), after: patch(qreq("new"), { status: "declined", declineReason: "capacity", declineNote: null, decidedAt: T1, decidedByUserId: U.rep, decidedByUserName: "Rep" }), allow: ["rep", "owner", "approver", "mgr"], deny: ["crm", "fin", "viewer", ...OUTSIDE] })
run({ title: "salesQuoteRequests link draft (linkQuoteRequestDraft)", method: "update", path: QR, before: qreq("new"), after: patch(qreq("new"), { draftQuotationId: "q1", draftQuotationNumber: "QT-2026/001" }), allow: ["rep", "mgr"], deny: ["crm", "viewer"] })
run({ title: "salesQuoteRequests mark quoted (issueQuotation / markQuoteRequestQuoted)", method: "update", path: QR, before: qreq("new"), after: patch(qreq("new"), { status: "quoted", quotationId: "q1", quotationNumber: "QT-2026/001", decidedAt: T1, decidedByUserId: U.rep, decidedByUserName: "Rep" }), allow: ["rep", "mgr", "owner"], deny: ["crm", "fin"] })
run({ title: "salesQuoteRequests delete", method: "delete", path: QR, before: qreq("new"), deny: ["owner", "rep"] })
run({ title: "salesQuoteRequests get", method: "get", path: QR, before: qreq("new"), allow: ["owner", "rep", "crm"], deny: OUTSIDE })

// ---------------------------------------------------------------------------
// salesDeliveryNotes — requested -> authorized -> delivered
// ---------------------------------------------------------------------------

const noteNew = note("requested", { createdAt: T1, updatedAt: T1, requestedAt: T1 })
run({ title: "salesDeliveryNotes create (scheduleDelivery)", method: "create", path: "salesDeliveryNotes/nn", after: noteNew, allow: ["owner", "rep", "mgr", "repCloser"], deny: ["approver", "fin", "fininv", "wh", "viewer", ...OUTSIDE] })
run({ title: "salesDeliveryNotes create already authorized", method: "create", path: "salesDeliveryNotes/nn", after: note("authorized"), deny: ["rep", "owner"] })
run({ title: "salesDeliveryNotes create for another company", method: "create", path: "salesDeliveryNotes/nn", after: note("requested", { organizationId: OTHER_ORG }), deny: ["rep"] })

const authPatch = { status: "authorized", authorizedAt: T1, authorizedByUserId: U.wh, authorizedByUserName: "WH" }
run({ title: "salesDeliveryNotes authorize (authorizeDelivery)", method: "update", path: N, before: note("requested"), after: patch(note("requested"), authPatch), allow: ["wh", "owner", "realMember"], deny: ["rep", "approver", "fininv", "viewer", ...OUTSIDE] })
run({ title: "salesDeliveryNotes authorize and edit lines", method: "update", path: N, before: note("requested"), after: patch(note("requested"), { ...authPatch, lines: [{ name: "Slab", quantity: 99 }] }), deny: ["wh", "owner"] })
run({ title: "salesDeliveryNotes authorize a held note", method: "update", path: N, before: note("held", { heldFrom: "requested", holdReason: "unpaid" }), after: patch(note("held", { heldFrom: "requested", holdReason: "unpaid" }), authPatch), deny: ["wh", "owner"] })

const signPatch = { status: "delivered", lines: [{ name: "Slab", quantity: 4, requestedQuantity: 5 }], signerName: "Site Foreman", signedAt: T1, deliveredAt: T1, deliveredByUserId: U.rep, deliveredByUserName: "Rep", varianceNote: "1 broken" }
run({ title: "salesDeliveryNotes client signs (confirmDelivery)", method: "update", path: N, before: note("authorized"), after: patch(note("authorized"), signPatch), allow: ["owner", "rep", "mgr", "approver"], deny: ["wh", "fininv", "viewer", ...OUTSIDE] })
run({ title: "salesDeliveryNotes client signs without signer", method: "update", path: N, before: note("authorized"), after: patch(note("authorized"), { ...signPatch, signerName: "" }), deny: ["rep", "owner"] })
run({ title: "salesDeliveryNotes client signs with signer missing", method: "update", path: N, before: note("authorized"), after: (() => { const { signerName: _s, ...rest } = signPatch; return patch(note("authorized"), rest) })(), deny: ["rep"] })
run({ title: "salesDeliveryNotes sign a requested note (skip Inventory)", method: "update", path: N, before: note("requested"), after: patch(note("requested"), signPatch), deny: ["rep", "owner", "mgr"] })
run({ title: "salesDeliveryNotes sign a held note", method: "update", path: N, before: note("held", { heldFrom: "authorized" }), after: patch(note("held", { heldFrom: "authorized" }), signPatch), deny: ["rep", "owner"] })
run({ title: "salesDeliveryNotes sign and tamper with orderId", method: "update", path: N, before: note("authorized"), after: patch(note("authorized"), { ...signPatch, orderId: "o2" }), deny: ["rep"] })
run({ title: "salesDeliveryNotes edit a delivered note", method: "update", path: N, before: note("delivered", { signerName: "x" }), after: patch(note("delivered", { signerName: "x" }), { lines: [{ name: "Slab", quantity: 50 }] }), deny: ["rep", "owner", "wh", "fininv"] })

const holdPatch = { status: "held", heldFrom: "authorized", holdReason: "Overdue invoice", heldAt: T1, heldByUserName: "Fin", releaseRequestedAt: null, releaseRequestedByUserName: null }
run({ title: "salesDeliveryNotes hold authorized note (holdDelivery)", method: "update", path: N, before: note("authorized"), after: patch(note("authorized"), holdPatch), allow: ["fininv", "fin", "owner"], deny: ["rep", "approver", "wh", "viewer", ...OUTSIDE] })
run({ title: "salesDeliveryNotes hold requested note", method: "update", path: N, before: note("requested"), after: patch(note("requested"), { ...holdPatch, heldFrom: "requested" }), allow: ["fininv", "owner"] })
run({ title: "salesDeliveryNotes hold a delivered note", method: "update", path: N, before: note("delivered", { signerName: "x" }), after: patch(note("delivered", { signerName: "x" }), holdPatch), deny: ["fininv", "owner"] })

const heldN = note("held", { heldFrom: "authorized", holdReason: "Overdue", heldAt: T0, heldByUserName: "Fin" })
run({ title: "salesDeliveryNotes seller asks release (requestDeliveryRelease)", method: "update", path: N, before: heldN, after: patch(heldN, { releaseRequestedAt: T1, releaseRequestedByUserName: "Rep" }), allow: ["rep", "mgr", "approver", "owner"], deny: ["viewer", "wh", ...OUTSIDE] })
run({ title: "salesDeliveryNotes seller asks release and edits reason", method: "update", path: N, before: heldN, after: patch(heldN, { releaseRequestedAt: T1, holdReason: "none" }), deny: ["rep"] })
run({ title: "salesDeliveryNotes seller un-holds himself", method: "update", path: N, before: heldN, after: patch(heldN, { status: "authorized", heldFrom: null }), deny: ["rep", "mgr"] })
run({ title: "salesDeliveryNotes release to where it stood (releaseDelivery)", method: "update", path: N, before: heldN, after: patch(heldN, { status: "authorized", heldFrom: null, releasedAt: T1, releasedByUserName: "Fin" }), allow: ["fininv", "fin", "owner"], deny: ["rep", "wh", ...OUTSIDE] })
run({ title: "salesDeliveryNotes release to requested", method: "update", path: N, before: note("held", { heldFrom: "requested" }), after: patch(note("held", { heldFrom: "requested" }), { status: "requested", heldFrom: null, releasedAt: T1, releasedByUserName: "Fin" }), allow: ["fininv"] })
run({ title: "salesDeliveryNotes release straight to delivered", method: "update", path: N, before: heldN, after: patch(heldN, { status: "delivered", heldFrom: null }), deny: ["fininv", "owner"] })

run({ title: "salesDeliveryNotes delete requested", method: "delete", path: N, before: note("requested"), allow: ["rep", "owner", "mgr"], deny: ["approver", "fininv", "wh", "viewer", ...OUTSIDE] })
run({ title: "salesDeliveryNotes delete authorized", method: "delete", path: N, before: note("authorized"), deny: ["rep", "owner", "mgr"] })
run({ title: "salesDeliveryNotes get", method: "get", path: N, before: note("requested"), allow: ["owner", "wh", "viewer"], deny: OUTSIDE })

// ---------------------------------------------------------------------------
// salesReturns
// ---------------------------------------------------------------------------

const retNew = ret("awaiting_decision", { createdAt: T1, updatedAt: T1 })
run({ title: "salesReturns create (requestReturn)", method: "create", path: "salesReturns/rn", after: retNew, allow: ["owner", "rep", "mgr"], deny: ["approver", "fininv", "viewer", ...OUTSIDE] })
run({ title: "salesReturns create already approved", method: "create", path: "salesReturns/rn", after: ret("approved"), deny: ["rep", "owner"] })
run({ title: "salesReturns create for another company", method: "create", path: "salesReturns/rn", after: ret("awaiting_decision", { organizationId: OTHER_ORG }), deny: ["rep"] })
const decide = (approve: boolean) => patch(ret("awaiting_decision"), { status: approve ? "approved" : "rejected", disposition: approve ? "stock" : null, decidedAt: T1, decidedByUserId: U.approver, decidedByUserName: "Mgr" })
run({ title: "salesReturns approve (decideReturn)", method: "update", path: R, before: ret("awaiting_decision"), after: decide(true), allow: ["owner", "approver", "mgr"], deny: ["rep", "fininv", "viewer", ...OUTSIDE] })
run({ title: "salesReturns reject (decideReturn)", method: "update", path: R, before: ret("awaiting_decision"), after: decide(false), allow: ["approver", "owner"], deny: ["rep", "fininv"] })
run({ title: "salesReturns approve and edit lines", method: "update", path: R, before: ret("awaiting_decision"), after: patch(decide(true), { lines: [{ name: "Slab", quantity: 99 }] }), deny: ["approver", "owner"] })
run({ title: "salesReturns decide an already approved return", method: "update", path: R, before: ret("approved", { disposition: "stock" }), after: patch(ret("approved", { disposition: "stock" }), { status: "rejected" }), deny: ["approver", "owner"] })
const credit = patch(ret("approved", { disposition: "stock", decidedAt: T0 }), { status: "credit_note_issued", creditNoteIssuedAt: T1, creditNoteByUserId: U.fininv, creditNoteByUserName: "Fin" })
run({ title: "salesReturns issue credit note (issueCreditNote)", method: "update", path: R, before: ret("approved", { disposition: "stock", decidedAt: T0 }), after: credit, allow: ["fininv", "fin", "owner"], deny: ["rep", "approver", "viewer", ...OUTSIDE] })
run({ title: "salesReturns credit note before approval", method: "update", path: R, before: ret("awaiting_decision"), after: patch(ret("awaiting_decision"), { status: "credit_note_issued", creditNoteIssuedAt: T1 }), deny: ["fininv", "owner"] })
run({ title: "salesReturns delete", method: "delete", path: R, before: ret("awaiting_decision"), deny: ["owner", "rep"] })
run({ title: "salesReturns get", method: "get", path: R, before: ret("awaiting_decision"), allow: ["owner", "rep"], deny: OUTSIDE })

// ---------------------------------------------------------------------------
// salesInvoices
// ---------------------------------------------------------------------------

const invNew = inv({ createdAt: T1, updatedAt: T1 })
run({ title: "salesInvoices create (issueInvoiceFromDeliveries)", method: "create", path: "salesInvoices/in", after: invNew, allow: ["owner", "rep", "mgr", "fininv", "fin"], deny: ["approver", "acct", "viewer", "wh", ...OUTSIDE] })
run({ title: "salesInvoices create for another company", method: "create", path: "salesInvoices/in", after: inv({ organizationId: OTHER_ORG }), deny: ["rep", "fininv"] })
run({ title: "salesInvoices mark paid (markInvoicePaid)", method: "update", path: INVP, before: inv(), after: patch(inv(), { paid: true, paidAt: T1 }), allow: ["owner", "fininv", "fin", "approver", "mgr"], deny: ["rep", "acct", "viewer", ...OUTSIDE] })
run({ title: "salesInvoices move to another company", method: "update", path: INVP, before: inv(), after: patch(inv(), { organizationId: OTHER_ORG }), deny: ["fininv", "owner"] })
run({ title: "salesInvoices delete", method: "delete", path: INVP, before: inv(), deny: ["owner", "fininv"] })
run({ title: "salesInvoices get", method: "get", path: INVP, before: inv(), allow: ["owner", "rep", "viewer"], deny: OUTSIDE })

// ---------------------------------------------------------------------------
// Counters, stock and requests the Sales flows write in the same batches
// ---------------------------------------------------------------------------

const ctr = `mfgCounters/${ORG}__QT__2026`
run({ title: "mfgCounters create first QT sequence (drawSalesDocNumber)", method: "create", path: ctr, after: { organizationId: ORG, type: "QT", year: 2026, last: 1, updatedAt: T1 }, allow: ["rep", "mgr", "owner", "approver"], deny: OUTSIDE })
run({ title: "mfgCounters create with last = 0", method: "create", path: ctr, after: { organizationId: ORG, type: "QT", year: 2026, last: 0, updatedAt: T1 }, deny: ["rep"] })
run({ title: "mfgCounters bump QT sequence", method: "update", path: ctr, before: { organizationId: ORG, type: "QT", year: 2026, last: 5, updatedAt: T0 }, after: { organizationId: ORG, type: "QT", year: 2026, last: 6, updatedAt: T1 }, allow: ["rep", "owner", "mgr"], deny: ["stranger", "anon"] })
run({ title: "mfgCounters rewind", method: "update", path: ctr, before: { organizationId: ORG, type: "QT", year: 2026, last: 5, updatedAt: T0 }, after: { organizationId: ORG, type: "QT", year: 2026, last: 3, updatedAt: T1 }, deny: ["rep", "owner"] })
run({ title: "mfgCounters jump by more than 50", method: "update", path: ctr, before: { organizationId: ORG, type: "QT", year: 2026, last: 5, updatedAt: T0 }, after: { organizationId: ORG, type: "QT", year: 2026, last: 99, updatedAt: T1 }, deny: ["rep"] })
run({ title: "mfgCounters get own company", method: "get", path: ctr, before: { organizationId: ORG, last: 5 }, allow: ["rep", "owner"], deny: ["stranger"] })

const inventoryRow = { name: "Slab", quantity: 100, organizationId: ORG, updatedAt: T0 }
run({ title: "inventoryItems decrement on client signature (confirmDelivery tx)", method: "update", path: "warehouses/w1/inventoryItems/it1", before: inventoryRow, after: { ...inventoryRow, quantity: 96, updatedAt: T1 }, allow: ["rep", "owner", "mgr"], deny: ["stranger", "anon"] })
run({ title: "inventoryItems restock on credit note (issueCreditNote)", method: "update", path: "warehouses/w1/inventoryItems/it1", before: inventoryRow, after: { ...inventoryRow, quantity: 101, updatedAt: T1 }, allow: ["fininv", "fin"], deny: ["stranger"] })

const mfgReq = (extra: Data = {}): Data => ({ organizationId: ORG, requestNumber: "MR-2026/001", kind: "make", sourceKind: "sales", orderId: "o1", orderNumber: 1, contactName: "Client", itemName: "Slab", unit: "m2", quantity: 5, lines: [], estimateId: null, neededBy: null, note: null, status: "new", workOrderId: null, workOrderNumber: null, rejectionReason: null, decidedAt: null, decidedByUserId: null, decidedByUserName: null, createdByUserId: U.rep, createdByUserName: "Rep", createdAt: T1, updatedAt: T1, requestedAt: T1, ...extra })
run({ title: "manufacturingRequests create from Sales order (createManufacturingRequest)", method: "create", path: "manufacturingRequests/mr1", after: mfgReq(), allow: ["rep"], deny: ["fininv", "viewer", ...OUTSIDE] })
run({ title: "manufacturingRequests create from Sales order by the owner", method: "create", path: "manufacturingRequests/mr1", after: mfgReq({ createdByUserId: U.owner }), allow: ["owner"] })
run({ title: "manufacturingRequests create by sales.approve-only member (advance report, best effort)", method: "create", path: "manufacturingRequests/mr1", after: mfgReq({ createdByUserId: U.approver }), allow: ["approver"] })
run({ title: "manufacturingRequests create on behalf of someone else", method: "create", path: "manufacturingRequests/mr1", after: mfgReq({ createdByUserId: "someone-else" }), deny: ["rep", "owner"] })

// ---------------------------------------------------------------------------
// Platform-staff CRM (admin only)
// ---------------------------------------------------------------------------

const adminClient = { stage: "new", ownerUid: U.admin, ownerName: "Admin", updatedAt: T1 }
run({ title: "adminCrmClients create (saveRecord merge)", method: "create", path: "adminCrmClients/lead_manual_x", after: adminClient, allow: ["admin", "realAdmin"], deny: ["owner", "rep", "stranger", "anon"] })
run({ title: "adminCrmClients update (stage / contacts)", method: "update", path: "adminCrmClients/lead_manual_x", before: { ...adminClient, updatedAt: T0 }, after: { ...adminClient, stage: "demo", contacts: [{ name: "A" }], notDuplicateOf: ["lead_demo_y"] }, allow: ["admin"], deny: ["owner", "rep", "anon"] })
run({ title: "adminCrmClients delete", method: "delete", path: "adminCrmClients/lead_manual_x", before: adminClient, deny: ["admin", "realAdmin", "owner"] })
run({ title: "adminCrmClients get", method: "get", path: "adminCrmClients/lead_manual_x", before: adminClient, allow: ["admin", "realAdmin"], deny: ["owner", "rep", "stranger", "anon"] })
run({ title: "adminCrmClients list", method: "list", path: "adminCrmClients/lead_manual_x", before: adminClient, allow: ["admin"], deny: ["owner", "rep", "anon"] })

const deal = { clientId: "lead_manual_x", kind: "opportunity", title: "Plan", plan: "pro", amount: 5000, date: "2026-10-08", note: "", state: "open", authorUid: U.admin, authorName: "Admin", createdAt: T1 }
run({ title: "adminCrmDeals create (CrmDeals DealForm)", method: "create", path: "adminCrmDeals/d1", after: deal, allow: ["admin", "realAdmin"], deny: ["owner", "rep", "anon"] })
run({ title: "adminCrmDeals set state", method: "update", path: "adminCrmDeals/d1", before: deal, after: { ...deal, state: "won", updatedAt: T1 }, allow: ["admin"], deny: ["owner", "rep"] })
run({ title: "adminCrmDeals move on merge (clientId, movedFrom)", method: "update", path: "adminCrmDeals/d1", before: deal, after: { ...deal, clientId: "lead_demo_y", movedFrom: "lead_manual_x" }, allow: ["admin"] })
run({ title: "adminCrmDeals delete", method: "delete", path: "adminCrmDeals/d1", before: deal, deny: ["admin", "owner"] })

const adminAct = { clientId: "lead_manual_x", type: "call", status: "scheduled", dueDate: "2026-10-09", dueTime: "", withName: "A", title: "Call A", note: "", ownerUid: U.admin, ownerName: "Admin", authorUid: U.admin, authorName: "Admin", createdAt: T1 }
run({ title: "adminCrmActivities create (createActivity)", method: "create", path: "adminCrmActivities/ac1", after: adminAct, allow: ["admin"], deny: ["owner", "rep", "anon"] })
run({ title: "adminCrmActivities create stage-change log (changeStage)", method: "create", path: "adminCrmActivities/ac1", after: { clientId: "lead_manual_x", type: "stage", from: "new", to: "demo", note: "why", status: "done", authorUid: U.admin, authorName: "Admin", createdAt: T1 }, allow: ["admin"] })
run({ title: "adminCrmActivities create with someone else as author", method: "create", path: "adminCrmActivities/ac1", after: { ...adminAct, authorUid: "someone-else" }, deny: ["admin"] })
run({ title: "adminCrmActivities update (updateActivity)", method: "update", path: "adminCrmActivities/ac1", before: adminAct, after: { ...adminAct, title: "Call B", result: null, updatedAt: T1 }, allow: ["admin"], deny: ["owner", "rep"] })
run({ title: "adminCrmActivities tick done (setActivityDone)", method: "update", path: "adminCrmActivities/ac1", before: adminAct, after: { ...adminAct, status: "done", doneAt: T1, dueDate: "2026-10-08", updatedAt: T1 }, allow: ["admin"] })
run({ title: "adminCrmActivities move on merge", method: "update", path: "adminCrmActivities/ac1", before: adminAct, after: { ...adminAct, clientId: "lead_demo_y", movedFrom: "lead_manual_x" }, allow: ["admin"] })
run({ title: "adminCrmActivities change author", method: "update", path: "adminCrmActivities/ac1", before: adminAct, after: { ...adminAct, authorUid: "someone-else", updatedAt: T1 }, deny: ["admin"] })
run({ title: "adminCrmActivities delete (deleteActivity)", method: "delete", path: "adminCrmActivities/ac1", before: adminAct, allow: ["admin"], deny: ["owner", "rep", "anon"] })
run({ title: "adminCrmActivities get", method: "get", path: "adminCrmActivities/ac1", before: adminAct, allow: ["admin"], deny: ["owner", "anon"] })

const lead = { name: "Lead", company: "Co", phone: "050", email: "l@x.sa", city: "Riyadh", origin: "manual", manualSource: "phone", businessTypes: ["contractor"], note: "n", status: "new", createdByUid: U.admin, createdAt: T1 }
run({ title: "demoRequests create manual lead (addManualLead)", method: "create", path: "demoRequests/dr1", after: lead, allow: ["admin"] })
run({ title: "demoRequests archive lead (setLeadArchived)", method: "update", path: "demoRequests/dr1", before: lead, after: { ...lead, archived: true, archivedAt: T1, archivedByUid: U.admin, archivedReason: "duplicate" }, allow: ["admin"], deny: ["owner", "rep", "anon"] })
run({ title: "demoRequests update details (updateLeadDetails)", method: "update", path: "demoRequests/dr1", before: lead, after: { ...lead, name: "New name", updatedAt: T1 }, allow: ["admin"], deny: ["owner"] })
run({ title: "onboardingRequests archive lead (mergeLeads)", method: "update", path: "onboardingRequests/or1", before: { name: "x" }, after: { name: "x", archived: true, archivedReason: "duplicate" }, allow: ["admin"], deny: ["owner", "anon"] })

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const ROOT = "/databases/(default)/documents/"
const decode = (p: string) => decodeURIComponent(p).replace(ROOT, "")

interface TestResult { state: string; debugMessages?: string[]; visitedExpressions?: unknown[]; functionCalls?: Array<{ function: string; args: string[] }> }

async function post(testCases: unknown[]): Promise<TestResult[]> {
  const rules = fs.readFileSync(process.env.RULES_FILE ?? path.join(process.cwd(), "firestore.rules"), "utf8")
  const body = JSON.stringify({ source: { files: [{ name: "firestore.rules", content: rules }] }, testSuite: { testCases } })
  let last = "rules test failed"
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const res = await fetch("https://firebaserules.googleapis.com/v1/projects/mdmaktech-uat:test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "x-goog-user-project": "mdmaktech-uat", "Content-Type": "application/json" },
        body,
      })
      const json = (await res.json()) as { testResults?: TestResult[]; error?: { message: string } }
      if (json.testResults && json.testResults.length === testCases.length) return json.testResults
      last = json.error?.message ?? last
      if (/authentication credentials/i.test(last)) cachedToken = null
    } catch (err) {
      last = (err as Error).message
    }
    await new Promise((r) => setTimeout(r, Math.min(3000 * (attempt + 1), 20000)))
  }
  throw new Error(last)
}

async function simulateBatch(batch: RuleCase[]): Promise<RuleResult[]> {
  const known = batch.map((c) => new Map<string, Data | null>(Object.entries(c.overrides ?? {})))
  const out: (RuleResult | null)[] = batch.map(() => null)
  let pending = batch.map((_, i) => i)
  for (let round = 0; round < 6 && pending.length; round++) {
    const tests = pending.map((i) => {
      const c = batch[i]
      const mocks = [...known[i]].flatMap(([p, d]) => [
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
    const results = await post(tests)
    const next: number[] = []
    results.forEach((r, k) => {
      const i = pending[k]
      const wanted = [...new Set((r.functionCalls ?? []).map((f) => decode(f.args[0])))].filter((p) => !known[i].has(p))
      if (wanted.length && r.state !== "SUCCESS") {
        for (const p of wanted) known[i].set(p, null)
        next.push(i)
        return
      }
      const got = r.state === "SUCCESS" ? "ALLOW" : "DENY"
      out[i] = { name: batch[i].name, expected: batch[i].expect, got, ok: got === batch[i].expect, reads: [...known[i].keys()], detail: (r.debugMessages ?? []).join(" | ").slice(0, 300) + ` {visited=${(r.visitedExpressions ?? []).length}}` }
    })
    pending = next
  }
  return batch.map((c, i) => out[i] ?? { name: c.name, expected: c.expect, got: "DENY", ok: false, reads: [], detail: "did not settle" })
}

async function main() {
  const only = process.env.SIM_ONLY
  const list = only ? cases.filter((c) => c.name.includes(only)) : cases
  const size = Number(process.env.SIM_BATCH ?? 20)
  const chunks: RuleCase[][] = []
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size))
  const results: RuleResult[][] = new Array(chunks.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= chunks.length) return
      try {
        results[i] = await simulateBatch(chunks[i])
      } catch (err) {
        results[i] = chunks[i].map((c) => ({ name: c.name, expected: c.expect, got: "DENY", ok: false, reads: [], detail: `harness error: ${(err as Error).message}` }))
      }
      console.error(`chunk ${i + 1}/${chunks.length} done`)
    }
  }
  await Promise.all(Array.from({ length: Number(process.env.SIM_CONCURRENCY ?? 3) }, worker))
  const flat = results.flat()
  let bad = 0
  for (const r of flat) {
    if (!r.ok) bad++
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  (expected ${r.expected}, got ${r.got})${r.ok ? "  " + (/\{visited=\d+\}/.exec(r.detail)?.[0] ?? "") + (/maximum of 1000/i.test(r.detail) ? " [EXPR-LIMIT]" : "") : "  " + r.detail}`)
  }
  console.log(`\n${flat.length - bad}/${flat.length} as expected`)
  const limit = flat.filter((r) => /maximum of 1000/i.test(r.detail))
  if (limit.length) console.log(`\n1000-expression limit hit in ${limit.length} case(s):\n${limit.map((r) => " - " + r.name).join("\n")}`)
  process.exit(bad ? 1 : 0)
}

main()

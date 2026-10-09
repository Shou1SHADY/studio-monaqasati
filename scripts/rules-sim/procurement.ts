// Procurement against the REAL firestore.rules (Google's :test API), UAT read-only. Every case is built the
// way the client writes it (src/lib/procurement/*writes*.ts and the screens that write rfqs/offers/deliveries).
// Users and groups are synthetic (overrides) so the cases do not depend on what UAT holds.
//
// Naming: ALLOW cases are "the client's own guard lets this role do it"; DENY cases are rule refusals.

/* eslint-disable @typescript-eslint/no-explicit-any */
// The harness calls `gcloud auth print-access-token` for every request; one token serves the whole run.
const cp = require("child_process")
const realExec = cp.execSync
const tokenCache: { v?: string; at?: number } = {}
cp.execSync = (cmd: string, opts: unknown) => {
  if (typeof cmd === "string" && cmd.startsWith("gcloud auth print-access-token")) {
    if (!tokenCache.v || Date.now() - (tokenCache.at ?? 0) > 3 * 60 * 1000) {
      tokenCache.v = realExec(cmd, opts)
      tokenCache.at = Date.now()
    }
    return tokenCache.v
  }
  return realExec(cmd, opts)
}
import type { RuleCase } from "./sim"
const fs = require("fs") as typeof import("fs")
const nodePath = require("path") as typeof import("path")
const { openUatDb, UAT_PROJECT } = require("../lib/uat-db") as typeof import("../lib/uat-db")

type Data = Record<string, any>
type Ov = Record<string, Data | null>

// ---------------------------------------------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------------------------------------------
const ORG = "orgT" // the buying company; its id is its owner's uid
const OWNER = ORG
const OTHER_ORG = "orgOther"
const OTHER_OWNER = OTHER_ORG
const SUP_ORG = "supOrgT" // a registered supplier company; the id is its owner's uid
const SUP_USER = SUP_ORG
const SUP2_ORG = "sup2OrgT"

const PERMS = {
  buyer: ["offers.accept"],
  manager: ["po.approve"],
  finance: ["offers.accept", "po.approve", "invoices.manage", "accounting.post"], // the seeded finance group (minus view bits)
  expediter: ["po.expedite"],
  receiver: ["deliveries.confirm"],
  supply: ["rfq.create", "rfq.manage", "po.expedite", "suppliers.manage", "deliveries.confirm", "warehouses.manage", "warehouses.receive"],
  rfqCreate: ["rfq.create"],
  payer: ["invoices.manage"],
  poster: ["accounting.post"],
  viewer: ["projects.view"],
  offersView: ["offers.view"],
  warehouse: ["warehouses.manage"],
  suppliersManage: ["suppliers.manage"],
  pmManage: ["pm.manage"],
  pmSite: ["pm.site"],
} as const
type Role = keyof typeof PERMS

const uidOf = (r: Role) => `u_${r}`
const BUYER = uidOf("buyer")
const BUYER2 = "u_buyer2"
const MANAGER = uidOf("manager")
const FINANCE = uidOf("finance")
const FINANCE2 = "u_finance2"

const memberOv = (uid: string, perms: readonly string[], org = ORG): Ov => ({
  [`users/${uid}`]: { organizationId: org, role: "Contractor", organizationRole: "member", defaultGroupId: `g_${uid}`, name: uid },
  [`teamGroups/g_${uid}`]: { organizationId: org, permissions: [...perms] },
})
const ownerOv = (uid: string, org: string): Ov => ({ [`users/${uid}`]: { organizationId: org, role: "Contractor", organizationRole: "owner", name: uid } })
const supplierOv = (uid: string, org: string): Ov => ({ [`users/${uid}`]: { organizationId: org, role: "Supplier", organizationRole: "owner", name: uid } })

const WORLD: Ov = {
  ...ownerOv(OWNER, ORG),
  ...ownerOv(OTHER_OWNER, OTHER_ORG),
  ...supplierOv(SUP_USER, SUP_ORG),
  ...supplierOv(SUP2_ORG, SUP2_ORG),
  ...Object.fromEntries(Object.entries(PERMS).flatMap(([r, p]) => Object.entries(memberOv(uidOf(r as Role), p)))),
  ...memberOv(BUYER2, PERMS.buyer),
  ...memberOv(FINANCE2, PERMS.finance),
  // a member of ANOTHER company holding every procurement permission: the "other company" attacker
  ...memberOv("u_foreign", [...PERMS.finance, "po.expedite", "deliveries.confirm", "rfq.manage"], OTHER_ORG),
  "companyModules/orgT": null,
  "procurementSettings/orgT": null,
}

const T0 = "2026-10-01T00:00:00.000Z"
const T1 = "2026-10-08T09:00:00.000Z"

// ---------------------------------------------------------------------------------------------------------------
// Case plumbing
// ---------------------------------------------------------------------------------------------------------------
const cases: RuleCase[] = []
const add = (name: string, expect: "ALLOW" | "DENY", c: Omit<RuleCase, "name" | "expect" | "overrides"> & { ov?: Ov }) => {
  const { ov, ...rest } = c
  cases.push({ name, expect, overrides: { ...WORLD, ...(ov || {}) }, ...rest } as RuleCase)
}

// ---------------------------------------------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------------------------------------------
const LOG0 = [{ at: T0, byId: BUYER, byName: "b", action: "created", note: null, params: { basis: "rfq" } }]
const logE = (uid: string, action: string, extra: Data = {}) => ({ at: T1, byId: uid, byName: uid, action, note: null, params: null, ...extra })
const line = (over: Data = {}) => ({ id: "l1", name: "Rebar", unit: "ton", quantity: 10, unitPrice: 100, accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: null, rfqProductIndex: 0, ...over })

const po = (over: Data = {}): Data => ({
  organizationId: ORG, docNumber: "PO-2026/001", status: "awaiting_approval", basis: "rfq", rfqId: "rfq1", rfqTitle: "Rebar", offerId: "off1",
  projectId: null, projectName: null, category: "steel", purchaseSource: null,
  supplierOrgId: SUP_ORG, supplierUserId: SUP_USER, supplierName: "Supplier", isGuestSupplier: false,
  lines: [line()], totalExVat: 1000, vatRate: 0.15, paymentTerms: null, deliveryLocation: "Riyadh", leadTimeDays: 7,
  offersCount: 2, lowestOfferTotal: 1000, awardReasonCode: null, awardReasonText: null, shortCompetition: false, noOfficialQuote: true,
  preparedById: BUYER, preparedByName: "b", createdAt: T0,
  approverKind: "manager", approvedById: null, approvedByName: null, approvedAt: null, returnedReason: null,
  sentAt: null, sentChannel: null, supplierAcceptedAt: null, promisedDate: null, acceptanceRecordedBy: null, rating: null,
  log: LOG0, updatedAt: T0, ...over,
})
/** What `transition()` / `commit()` write: the patch, the log (when given) and updatedAt. */
const step = (before: Data, patch: Data, uid: string, action?: string, logExtra: Data = {}): Data => {
  const after: Data = { ...before, ...patch, updatedAt: T1 }
  if (action) after.log = [...(before.log || []), logE(uid, action, logExtra)]
  return after
}
const POP = "purchaseOrders/po1"
const upd = (uid: string, before: Data, after: Data, ov?: Ov) => ({ uid, method: "update" as const, path: POP, before, after, ov })

const approvedPatch = (uid: string, extra: Data = {}) => ({ status: "approved", approvedById: uid, approvedByName: uid, approvedAt: T1, returnedReason: null, ...extra })

// --- create -----------------------------------------------------------------------------------------------------
const poNew = (uid: string, over: Data = {}): Data => po({ preparedById: uid, preparedByName: uid, log: [logE(uid, "created")], ...over })
for (const [label, uid] of [["owner", OWNER], ["buyer (offers.accept)", BUYER], ["finance (offers.accept+po.approve)", FINANCE]] as const)
  add(`PO create from award: ${label}`, "ALLOW", { uid, method: "create", path: "purchaseOrders/n1", after: poNew(uid) })
add("PO create direct order (createOrderWithoutRfq shape, extra fields): buyer", "ALLOW", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { basis: "direct", rfqId: null, offerId: null, agreementId: "ag1", agreementNo: "AG-2026/001", deliveryMode: "once", requestedDeliveryDate: "2026-11-01", singleSourceReason: "x" }) })
add("PO create service order: buyer", "ALLOW", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { basis: "direct", rfqId: null, offerId: null, orderKind: "service" }) })
add("PO create retroactive (approverKind owner): buyer", "ALLOW", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { basis: "retroactive", approverKind: "owner", rfqId: null, offerId: null }) })
add("PO create split award with approverKind owner (preparer holds po.approve): finance", "ALLOW", { uid: FINANCE, method: "create", path: "purchaseOrders/n1", after: poNew(FINANCE, { approverKind: "owner" }) })
add("PO create: manager with po.approve only (client also refuses: canPrepare needed)", "DENY", { uid: MANAGER, method: "create", path: "purchaseOrders/n1", after: poNew(MANAGER) })
add("PO create: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: "purchaseOrders/n1", after: poNew(uidOf("expediter")) })
add("PO create: member of another company", "DENY", { uid: "u_foreign", method: "create", path: "purchaseOrders/n1", after: poNew("u_foreign") })
add("PO create: buyer writes into ANOTHER company's organizationId", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { organizationId: OTHER_ORG }) })
add("PO create: born approved", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { status: "approved" }) })
add("PO create: born with approvedById", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { approvedById: BUYER }) })
add("PO create: born with sentAt", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { sentAt: T0 }) })
add("PO create: born rated", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { rating: { conformity: 5 } }) })
add("PO create: preparedById names someone else", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { preparedById: MANAGER }) })
add("PO create: retroactive routed to manager", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { basis: "retroactive", approverKind: "manager" }) })
add("PO create: no docNumber", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { docNumber: "" }) })
add("PO create: unknown basis", "DENY", { uid: BUYER, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER, { basis: "weird" }) })
add("PO create: unauthenticated", "DENY", { uid: null, method: "create", path: "purchaseOrders/n1", after: poNew(BUYER) })

// --- numbering (mfgCounters, drawn in the same transaction) ---------------------------------------------------------
const ctr = (type: string, last: number) => ({ organizationId: ORG, type, year: 2026, last, updatedAt: T1 })
add("PO counter: first draw (create last=1): buyer", "ALLOW", { uid: BUYER, method: "create", path: `mfgCounters/${ORG}__PO__2026`, after: ctr("PO", 1) })
add("PO counter: next draw (update 4→5): buyer", "ALLOW", { uid: BUYER, method: "update", path: `mfgCounters/${ORG}__PO__2026`, before: ctr("PO", 4), after: ctr("PO", 5) })
add("PO counter: split award bumps by 3: buyer", "ALLOW", { uid: BUYER, method: "update", path: `mfgCounters/${ORG}__PO__2026`, before: ctr("PO", 4), after: ctr("PO", 7) })
add("GR counter: receiver", "ALLOW", { uid: uidOf("receiver"), method: "update", path: `mfgCounters/${ORG}__GR__2026`, before: ctr("GR", 9), after: ctr("GR", 10) })
add("AG counter: buyer", "ALLOW", { uid: BUYER, method: "create", path: `mfgCounters/${ORG}__AG__2026`, after: ctr("AG", 1) })
add("PO counter: another company's counter", "DENY", { uid: "u_foreign", method: "update", path: `mfgCounters/${ORG}__PO__2026`, before: ctr("PO", 4), after: ctr("PO", 5) })
add("PO counter: rewind", "DENY", { uid: BUYER, method: "update", path: `mfgCounters/${ORG}__PO__2026`, before: ctr("PO", 4), after: ctr("PO", 3) })

// --- approve ------------------------------------------------------------------------------------------------------
const base = po()
add("approve: owner approves a buyer's order", "ALLOW", { ...upd(OWNER, base, step(base, approvedPatch(OWNER), OWNER, "approved")) })
add("approve: manager (po.approve) approves buyer's order, with noticeCopyTo", "ALLOW", { ...upd(MANAGER, base, step(base, approvedPatch(MANAGER, { noticeCopyTo: ["r1", "r2"] }), MANAGER, "approved")) })
add("approve: finance2 approves buyer's order", "ALLOW", { ...upd(FINANCE2, base, step(base, approvedPatch(FINANCE2), FINANCE2, "approved")) })
add("approve: owner approves a retroactive order straight into accepted", "ALLOW", { ...upd(OWNER, po({ basis: "retroactive", approverKind: "owner" }), step(po({ basis: "retroactive", approverKind: "owner" }), { ...approvedPatch(OWNER), status: "accepted", supplierAcceptedAt: T1, acceptanceRecordedBy: "buyer" }, OWNER, "approved")) })
add("approve: manager above the default limit (200,000)", "DENY", { ...upd(MANAGER, po({ totalExVat: 200000 }), step(po({ totalExVat: 200000 }), approvedPatch(MANAGER), MANAGER, "approved")) })
add("approve: manager above default limit but org limit raised to 500,000", "ALLOW", { ...upd(MANAGER, po({ totalExVat: 200000 }), step(po({ totalExVat: 200000 }), approvedPatch(MANAGER), MANAGER, "approved"), { "procurementSettings/orgT": { organizationId: ORG, managerApprovalLimit: 500000 } }) })
add("approve: owner above the limit (approverKind owner)", "ALLOW", { ...upd(OWNER, po({ totalExVat: 200000, approverKind: "owner" }), step(po({ totalExVat: 200000, approverKind: "owner" }), approvedPatch(OWNER), OWNER, "approved")) })
add("approve: manager on approverKind=owner order prepared by a finance member (UI shows Approve: approvalRefusal ignores approverKind)", "ALLOW", { ...upd(MANAGER, po({ preparedById: FINANCE, approverKind: "owner" }), step(po({ preparedById: FINANCE, approverKind: "owner" }), approvedPatch(MANAGER), MANAGER, "approved")) })
add("approve: finance2 on approverKind=owner order prepared by finance (the seeded finance group prepares AND approves)", "ALLOW", { ...upd(FINANCE2, po({ preparedById: FINANCE, approverKind: "owner" }), step(po({ preparedById: FINANCE, approverKind: "owner" }), approvedPatch(FINANCE2), FINANCE2, "approved")) })
add("approve: manager approves his own prepared order", "DENY", { ...upd(FINANCE, po({ preparedById: FINANCE }), step(po({ preparedById: FINANCE }), approvedPatch(FINANCE), FINANCE, "approved")) })
add("approve: owner approves own prepared order (flagged selfApproved)", "ALLOW", { ...upd(OWNER, po({ preparedById: OWNER }), step(po({ preparedById: OWNER }), approvedPatch(OWNER), OWNER, "approved", { params: { selfApproved: 1 } })) })
add("approve: manager approves a retroactive order", "DENY", { ...upd(MANAGER, po({ basis: "retroactive", approverKind: "owner" }), step(po({ basis: "retroactive", approverKind: "owner" }), approvedPatch(MANAGER), MANAGER, "approved")) })
add("approve: buyer (offers.accept only)", "DENY", { ...upd(BUYER2, base, step(base, approvedPatch(BUYER2), BUYER2, "approved")) })
add("approve: expediter", "DENY", { ...upd(uidOf("expediter"), base, step(base, approvedPatch(uidOf("expediter")), uidOf("expediter"), "approved")) })
add("approve: other company's manager", "DENY", { ...upd("u_foreign", base, step(base, approvedPatch("u_foreign"), "u_foreign", "approved")) })
add("approve: approvedById is someone else", "DENY", { ...upd(MANAGER, base, step(base, approvedPatch(OWNER), MANAGER, "approved")) })
add("approve: also rewrites totalExVat", "DENY", { ...upd(MANAGER, base, step(base, approvedPatch(MANAGER, { totalExVat: 1 }), MANAGER, "approved")) })
add("approve: also rewrites supplierOrgId", "DENY", { ...upd(MANAGER, base, step(base, approvedPatch(MANAGER, { supplierOrgId: "x" }), MANAGER, "approved")) })
add("approve: also sets sentAt (dispatch folded into approval)", "DENY", { ...upd(MANAGER, base, step(base, approvedPatch(MANAGER, { sentAt: T1 }), MANAGER, "approved")) })
add("approve: unauthenticated", "DENY", { ...upd(null as any, base, step(base, approvedPatch(MANAGER), MANAGER, "approved")) })
add("approve: from approved (already approved)", "DENY", { ...upd(MANAGER, po({ status: "approved", approvedById: OWNER }), step(po({ status: "approved", approvedById: OWNER }), approvedPatch(MANAGER), MANAGER, "approved")) })
const pendingBudget = po({ projectId: "p1", pmBudget: { state: "pending", over: 500 } })
add("approve: budget decision pending, PM on", "DENY", { ...upd(MANAGER, pendingBudget, step(pendingBudget, approvedPatch(MANAGER), MANAGER, "approved")) })
add("approve: budget decision pending, PM switched off", "ALLOW", { ...upd(MANAGER, pendingBudget, step(pendingBudget, approvedPatch(MANAGER), MANAGER, "approved"), { "companyModules/orgT": { organizationId: ORG, off: ["project-management"] } }) })
const acceptedBudget = po({ projectId: "p1", pmBudget: { state: "accepted", over: 500 } })
add("approve: budget accepted", "ALLOW", { ...upd(MANAGER, acceptedBudget, step(acceptedBudget, approvedPatch(MANAGER), MANAGER, "approved")) })

// --- return / resubmit --------------------------------------------------------------------------------------------
add("return: manager with reason", "ALLOW", { ...upd(MANAGER, base, step(base, { returnedReason: "price too high" }, MANAGER, "returned")) })
add("return: owner", "ALLOW", { ...upd(OWNER, base, step(base, { returnedReason: "r" }, OWNER, "returned")) })
add("return: buyer (offers.accept only)", "DENY", { ...upd(BUYER2, base, step(base, { returnedReason: "r" }, BUYER2, "returned")) })
add("return: empty reason", "DENY", { ...upd(MANAGER, base, step(base, { returnedReason: "" }, MANAGER, "returned")) })
add("return: other company", "DENY", { ...upd("u_foreign", base, step(base, { returnedReason: "r" }, "u_foreign", "returned")) })
const returned = po({ returnedReason: "price too high" })
add("resubmit: preparer buyer clears returnedReason", "ALLOW", { ...upd(BUYER, returned, step(returned, { returnedReason: null }, BUYER, "resubmitted")) })
add("resubmit: owner", "ALLOW", { ...upd(OWNER, returned, step(returned, { returnedReason: null }, OWNER, "resubmitted")) })
add("resubmit: manager without offers.accept (client refuses too)", "DENY", { ...upd(MANAGER, returned, step(returned, { returnedReason: null }, MANAGER, "resubmitted")) })

// --- send / acceptance / date / reminder --------------------------------------------------------------------------
const approved = po({ status: "approved", approvedById: MANAGER, approvedByName: "m", approvedAt: T0 })
const sendPatch = (uid: string) => ({ status: "sent", sentAt: T1, sentById: uid, sentByName: uid, sentChannel: "portal" })
add("send: manager (the send that rides the approval, sendOnApproval)", "ALLOW", { ...upd(MANAGER, approved, step(approved, sendPatch(MANAGER), MANAGER, "sent")) })
add("send: owner", "ALLOW", { ...upd(OWNER, approved, step(approved, sendPatch(OWNER), OWNER, "sent")) })
add("send: expediter (po.expedite)", "ALLOW", { ...upd(uidOf("expediter"), approved, step(approved, sendPatch(uidOf("expediter")), uidOf("expediter"), "sent")) })
add("send: supply-chain member (po.expedite)", "ALLOW", { ...upd(uidOf("supply"), approved, step(approved, sendPatch(uidOf("supply")), uidOf("supply"), "sent")) })
add("send: the preparing buyer sends his own order", "ALLOW", { ...upd(BUYER, approved, step(approved, sendPatch(BUYER), BUYER, "sent")) })
add("send: buyer approves-and-sends via self-issue's afterApproval on own order", "ALLOW", { ...upd(BUYER, po({ status: "approved", selfIssued: true, approvedById: BUYER }), step(po({ status: "approved", selfIssued: true, approvedById: BUYER }), sendPatch(BUYER), BUYER, "sent")) })
add("send: logSentOutside (sentChannel null): buyer", "ALLOW", { ...upd(BUYER, approved, step(approved, { ...sendPatch(BUYER), sentChannel: null }, BUYER, "sent", { params: { outside: 1 } })) })
add("send: another buyer on someone else's order (R-26)", "DENY", { ...upd(BUYER2, approved, step(approved, sendPatch(BUYER2), BUYER2, "sent")) })
add("send: receiver-only", "DENY", { ...upd(uidOf("receiver"), approved, step(approved, sendPatch(uidOf("receiver")), uidOf("receiver"), "sent")) })
add("send: from awaiting_approval (no dispatch before approval)", "DENY", { ...upd(MANAGER, base, step(base, sendPatch(MANAGER), MANAGER, "sent")) })
add("send: sentById is someone else", "DENY", { ...upd(MANAGER, approved, step(approved, { ...sendPatch(MANAGER), sentById: OWNER }, MANAGER, "sent")) })
add("send: other company", "DENY", { ...upd("u_foreign", approved, step(approved, sendPatch("u_foreign"), "u_foreign", "sent")) })

const sent = po({ status: "sent", approvedById: MANAGER, approvedAt: T0, sentAt: T0, sentById: MANAGER, sentByName: "m", sentChannel: "portal" })
const acceptBy = (by: "buyer" | "supplier") => ({ status: "accepted", supplierAcceptedAt: T1, promisedDate: "2026-10-20", acceptanceRecordedBy: by })
add("accept (recordSupplierAcceptance): expediter records by phone", "ALLOW", { ...upd(uidOf("expediter"), sent, step(sent, acceptBy("buyer"), uidOf("expediter"), "supplier_accepted")) })
add("accept: manager", "ALLOW", { ...upd(MANAGER, sent, step(sent, acceptBy("buyer"), MANAGER, "supplier_accepted")) })
add("accept: preparing buyer", "ALLOW", { ...upd(BUYER, sent, step(sent, acceptBy("buyer"), BUYER, "supplier_accepted")) })
add("accept: SUPPLIER in his portal (supplierAcceptPurchaseOrder)", "ALLOW", { ...upd(SUP_USER, sent, step(sent, acceptBy("supplier"), SUP_USER, "supplier_accepted")) })
add("accept: supplier's company TEAM MEMBER (not the owner)", "ALLOW", { ...upd("u_supmember", sent, step(sent, acceptBy("supplier"), "u_supmember", "supplier_accepted"), { "users/u_supmember": { organizationId: SUP_ORG, role: "Supplier", organizationRole: "member" } }) })
add("accept: a different supplier", "DENY", { ...upd(SUP2_ORG, sent, step(sent, acceptBy("supplier"), SUP2_ORG, "supplier_accepted")) })
add("accept: supplier on a guest order (supplierOrgId guest)", "DENY", { ...upd(SUP_USER, po({ ...sent, supplierOrgId: "guest", isGuestSupplier: true }), step(po({ ...sent, supplierOrgId: "guest", isGuestSupplier: true }), acceptBy("supplier"), SUP_USER, "supplier_accepted")) })
add("accept: supplier on an approved (not yet sent) order", "DENY", { ...upd(SUP_USER, approved, step(approved, acceptBy("supplier"), SUP_USER, "supplier_accepted")) })
add("accept: supplier but recordedBy 'buyer'", "DENY", { ...upd(SUP_USER, sent, step(sent, acceptBy("buyer"), SUP_USER, "supplier_accepted")) })
add("accept: supplier also changes lines (price tampering)", "DENY", { ...upd(SUP_USER, sent, step(sent, { ...acceptBy("supplier"), lines: [line({ unitPrice: 999 })] }, SUP_USER, "supplier_accepted")) })
add("accept: supplier also changes totalExVat", "DENY", { ...upd(SUP_USER, sent, step(sent, { ...acceptBy("supplier"), totalExVat: 5000 }, SUP_USER, "supplier_accepted")) })
add("accept: supplier without promisedDate string", "DENY", { ...upd(SUP_USER, sent, step(sent, { ...acceptBy("supplier"), promisedDate: null }, SUP_USER, "supplier_accepted")) })
add("accept: receiver-only", "DENY", { ...upd(uidOf("receiver"), sent, step(sent, acceptBy("buyer"), uidOf("receiver"), "supplier_accepted")) })
add("accept: other buyer on someone else's order", "DENY", { ...upd(BUYER2, sent, step(sent, acceptBy("buyer"), BUYER2, "supplier_accepted")) })

const accepted = po({ status: "accepted", approvedById: MANAGER, approvedAt: T0, sentAt: T0, sentById: MANAGER, supplierAcceptedAt: T0, promisedDate: "2026-10-15", acceptanceRecordedBy: "supplier", noticeCopyTo: ["r1"] })
add("date: new promisedDate by expediter", "ALLOW", { ...upd(uidOf("expediter"), accepted, step(accepted, { promisedDate: "2026-10-25" }, uidOf("expediter"), "date_updated")) })
add("date: new promisedDate by buyer (own order)", "ALLOW", { ...upd(BUYER, accepted, step(accepted, { promisedDate: "2026-10-25" }, BUYER, "date_updated")) })
add("reminder (patch {}: log only) on sent: expediter", "ALLOW", { ...upd(uidOf("expediter"), sent, step(sent, {}, uidOf("expediter"), "reminded")) })
add("reminder on accepted: manager", "ALLOW", { ...upd(MANAGER, accepted, step(accepted, {}, MANAGER, "reminded")) })
add("date: other buyer on someone else's order", "DENY", { ...upd(BUYER2, accepted, step(accepted, { promisedDate: "2026-10-25" }, BUYER2, "date_updated")) })

// --- receipts moving the counters ---------------------------------------------------------------------------------
const recvLines = [line({ accepted: 4, rejected: 1, held: 0 })]
const recvPatch = (po0: Data) => (po0.status === "sent" ? { lines: recvLines, status: "accepted", supplierAcceptedAt: T1, acceptanceRecordedBy: "buyer" } : { lines: recvLines })
add("receipt on accepted order: receiver (deliveries.confirm)", "ALLOW", { ...upd(uidOf("receiver"), accepted, step(accepted, recvPatch(accepted), uidOf("receiver"), "received")) })
add("receipt on SENT order (records supplier's acceptance): receiver", "ALLOW", { ...upd(uidOf("receiver"), sent, step(sent, recvPatch(sent), uidOf("receiver"), "received")) })
add("receipt: owner", "ALLOW", { ...upd(OWNER, accepted, step(accepted, recvPatch(accepted), OWNER, "received")) })
add("receipt: buyer under buyerReceives policy (offers.accept only)", "ALLOW", { ...upd(BUYER, accepted, step(accepted, recvPatch(accepted), BUYER, "received")) })
add("receipt: manual-form manager (po.approve)", "ALLOW", { ...upd(MANAGER, accepted, step(accepted, recvPatch(accepted), MANAGER, "received")) })
add("receipt: expediter (po.expedite only)", "DENY", { ...upd(uidOf("expediter"), accepted, step(accepted, recvPatch(accepted), uidOf("expediter"), "received")) })
add("receipt: other company's receiver", "DENY", { ...upd("u_foreign", accepted, step(accepted, recvPatch(accepted), "u_foreign", "received")) })
add("receipt: on an approved (unsent) order", "DENY", { ...upd(uidOf("receiver"), approved, step(approved, recvPatch(approved), uidOf("receiver"), "received")) })
add("receipt: receiver also closes the order", "DENY", { ...upd(uidOf("receiver"), accepted, step(accepted, { ...recvPatch(accepted), status: "closed", closedAt: T1 }, uidOf("receiver"), "received")) })
add("receipt: receiver also changes totalExVat", "DENY", { ...upd(uidOf("receiver"), accepted, step(accepted, { ...recvPatch(accepted), totalExVat: 1 }, uidOf("receiver"), "received")) })
add("release held / discounted (releaseHeld, releaseDiscounted): receiver", "ALLOW", { ...upd(uidOf("receiver"), accepted, step(accepted, { lines: [line({ held: 2 })] }, uidOf("receiver"), "received")) })

// --- decisions on lines / close / cancel / rate -------------------------------------------------------------------
const lineRej = [line({ accepted: 5, rejected: 3 })]
add("cancelRemainder: buyer (own order)", "ALLOW", { ...upd(BUYER, accepted, step(accepted, { lines: [line({ cancelled: 5, cancelReason: "x" })] }, BUYER, "remainder_cancelled")) })
add("cancelRemainder: manager", "ALLOW", { ...upd(MANAGER, accepted, step(accepted, { lines: [line({ cancelled: 5 })] }, MANAGER, "remainder_cancelled")) })
add("cancelRemainderWithFee: owner (cancelFees)", "ALLOW", { ...upd(OWNER, accepted, step(accepted, { lines: [line({ cancelled: 5 })], cancelFees: [{ lineId: "l1", amount: 50, at: T1, byName: "o" }] }, OWNER, "remainder_cancelled")) })
add("decideReject: buyer", "ALLOW", { ...upd(BUYER, po({ ...accepted, lines: lineRej }), step(po({ ...accepted, lines: lineRej }), { lines: [line({ accepted: 5, rejected: 3, rejectDecision: "replace", rejectReplaceBy: "2026-11-01" })] }, BUYER, "reject_decided")) })
add("R-26: another buyer cancels the remainder of someone else's order (poDecides refuses, poReceives lets any buyer write lines)", "DENY", { ...upd(BUYER2, accepted, step(accepted, { lines: [line({ cancelled: 5 })] }, BUYER2, "remainder_cancelled")) })
add("cancelRemainder: expediter", "DENY", { ...upd(uidOf("expediter"), accepted, step(accepted, { lines: [line({ cancelled: 5 })] }, uidOf("expediter"), "remainder_cancelled")) })
const closePatch = { status: "closed", closedAt: T1, closedShort: true, closeReason: "enough" }
const part = po({ ...accepted, lines: [line({ accepted: 5, cancelled: 0 })] })
add("close short: buyer (own)", "ALLOW", { ...upd(BUYER, part, step(part, closePatch, BUYER, "closed", { params: { short: 1 } })) })
add("close short: owner", "ALLOW", { ...upd(OWNER, part, step(part, closePatch, OWNER, "closed")) })
add("close short: manager", "ALLOW", { ...upd(MANAGER, part, step(part, closePatch, MANAGER, "closed")) })
add("close short: other buyer", "DENY", { ...upd(BUYER2, part, step(part, closePatch, BUYER2, "closed")) })
add("close short: receiver-only", "DENY", { ...upd(uidOf("receiver"), part, step(part, closePatch, uidOf("receiver"), "closed")) })
add("close: from sent (skips accepted)", "DENY", { ...upd(BUYER, sent, step(sent, closePatch, BUYER, "closed")) })
for (const [label, st] of [["awaiting_approval", base], ["approved", approved], ["sent", sent], ["accepted", accepted]] as const)
  add(`cancel whole order from ${label}: buyer (own)`, "ALLOW", { ...upd(BUYER, st, step(st, { status: "cancelled", cancelledReason: "no longer needed" }, BUYER, "cancelled", { params: { from: label } })) })
add("cancel: manager from approved", "ALLOW", { ...upd(MANAGER, approved, step(approved, { status: "cancelled", cancelledReason: "x" }, MANAGER, "cancelled")) })
add("cancel: other buyer", "DENY", { ...upd(BUYER2, approved, step(approved, { status: "cancelled", cancelledReason: "x" }, BUYER2, "cancelled")) })
add("cancel: from closed", "DENY", { ...upd(MANAGER, po({ status: "closed" }), step(po({ status: "closed" }), { status: "cancelled", cancelledReason: "x" }, MANAGER, "cancelled")) })
add("cancel: expediter", "DENY", { ...upd(uidOf("expediter"), approved, step(approved, { status: "cancelled", cancelledReason: "x" }, uidOf("expediter"), "cancelled")) })
const ratingV = { onTime: true, lateByDays: 0, inFull: true, rejectPercent: 0, conformity: 5, cooperation: 4, note: null, publishAnonymously: false, byId: BUYER, byName: "b", at: T1 }
add("rate: buyer (own) on an accepted order", "ALLOW", { ...upd(BUYER, accepted, step(accepted, { rating: ratingV }, BUYER, "rated")) })
add("rate: manager on a closed order", "ALLOW", { ...upd(MANAGER, po({ status: "closed" }), step(po({ status: "closed" }), { rating: ratingV }, MANAGER, "rated")) })
add("rate: second rating", "DENY", { ...upd(MANAGER, po({ ...accepted, rating: ratingV }), step(po({ ...accepted, rating: ratingV }), { rating: { ...ratingV, conformity: 1 } }, MANAGER, "rated")) })
add("rate: expediter", "DENY", { ...upd(uidOf("expediter"), accepted, step(accepted, { rating: ratingV }, uidOf("expediter"), "rated")) })
add("rate: other buyer", "DENY", { ...upd(BUYER2, accepted, step(accepted, { rating: ratingV }, BUYER2, "rated")) })
add("rate: on an order awaiting approval", "DENY", { ...upd(BUYER, base, step(base, { rating: ratingV }, BUYER, "rated")) })

// --- buyer's self-issue -------------------------------------------------------------------------------------------
const direct = po({ basis: "direct", rfqId: null, offerId: null, totalExVat: 1500, lines: [line({ quantity: 15 })] })
const selfPatch = { status: "approved", approvedById: BUYER, approvedByName: "b", approvedAt: T1, selfIssued: true }
add("self-issue: buyer issues his own direct order under 2,000", "ALLOW", { ...upd(BUYER, direct, step(direct, selfPatch, BUYER, "approved", { params: { selfIssued: 1, limit: 2000 } })) })
add("self-issue: owner on an order he prepared (hasOrgPermission passes)", "ALLOW", { ...upd(OWNER, po({ ...direct, preparedById: OWNER }), step(po({ ...direct, preparedById: OWNER }), { ...selfPatch, approvedById: OWNER }, OWNER, "approved")) })
add("self-issue: above 2,000", "DENY", { ...upd(BUYER, po({ ...direct, totalExVat: 2500 }), step(po({ ...direct, totalExVat: 2500 }), selfPatch, BUYER, "approved")) })
add("self-issue: org raised buyerSelfIssueLimit to 5,000", "ALLOW", { ...upd(BUYER, po({ ...direct, totalExVat: 2500 }), step(po({ ...direct, totalExVat: 2500 }), selfPatch, BUYER, "approved"), { "procurementSettings/orgT": { organizationId: ORG, buyerSelfIssueLimit: 5000 } }) })
add("self-issue: an RFQ-basis order", "DENY", { ...upd(BUYER, po({ totalExVat: 1500 }), step(po({ totalExVat: 1500 }), selfPatch, BUYER, "approved")) })
add("self-issue: someone else's order", "DENY", { ...upd(BUYER2, direct, step(direct, { ...selfPatch, approvedById: BUYER2 }, BUYER2, "approved")) })
add("self-issue: returned order", "DENY", { ...upd(BUYER, po({ ...direct, returnedReason: "x" }), step(po({ ...direct, returnedReason: "x" }), selfPatch, BUYER, "approved")) })
add("self-issue: without the selfIssued flag", "DENY", { ...upd(BUYER, direct, step(direct, { ...selfPatch, selfIssued: false }, BUYER, "approved")) })
add("self-issue: budget decision pending (PM on)", "DENY", { ...upd(BUYER, po({ ...direct, projectId: "p1", pmBudget: { state: "pending", over: 1 } }), step(po({ ...direct, projectId: "p1", pmBudget: { state: "pending", over: 1 } }), selfPatch, BUYER, "approved")) })

// --- Finance's side ------------------------------------------------------------------------------------------------
const pay = { no: "PAY-2026/001-1", kind: "adv", amount: 100, net: null, vat: null, recovered: null, invoiceNo: null, valueDate: "2026-10-08", bank: null, reference: "ref", account: null, byName: "f", at: T1 }
for (const role of ["payer", "poster", "finance"] as const)
  add(`Finance records a payment on an accepted order: ${role}`, "ALLOW", { ...upd(uidOf(role), accepted, step(accepted, { financePayments: [pay] }, uidOf(role))) })
add("Finance records a payment: owner on an approved order", "ALLOW", { ...upd(OWNER, approved, step(approved, { financePayments: [pay] }, OWNER)) })
add("Finance records a payment on a closed order", "ALLOW", { ...upd(uidOf("payer"), po({ status: "closed" }), step(po({ status: "closed" }), { financePayments: [pay] }, uidOf("payer"))) })
add("Finance payment: buyer (offers.accept only)", "DENY", { ...upd(BUYER, accepted, step(accepted, { financePayments: [pay] }, BUYER)) })
add("Finance payment: on awaiting_approval", "DENY", { ...upd(uidOf("payer"), base, step(base, { financePayments: [pay] }, uidOf("payer"))) })
add("Finance payment: payer also flips status", "DENY", { ...upd(uidOf("payer"), accepted, step(accepted, { financePayments: [pay], status: "cancelled" }, uidOf("payer"))) })
add("Finance payment: other company's finance", "DENY", { ...upd("u_foreign", accepted, step(accepted, { financePayments: [pay] }, "u_foreign")) })
const recvAll = po({ ...accepted, lines: [line({ accepted: 10 })] })
add("Finance closes by payment (accepted → closed, closedByPayment): payer", "ALLOW", { ...upd(uidOf("payer"), recvAll, step(recvAll, { financePayments: [pay], status: "closed", closedAt: T1, closedShort: false, closedByPayment: true }, uidOf("payer"), "closed", { params: { byPayment: 1 } })) })
add("Finance closes by payment: closedShort true", "DENY", { ...upd(uidOf("payer"), recvAll, step(recvAll, { financePayments: [pay], status: "closed", closedAt: T1, closedShort: true, closedByPayment: true }, uidOf("payer"), "closed")) })
add("Finance closes by payment: without the log entry", "DENY", { ...upd(uidOf("payer"), recvAll, step(recvAll, { financePayments: [pay], status: "closed", closedAt: T1, closedShort: false, closedByPayment: true }, uidOf("payer"))) })
const hold = { id: "h1", invoiceNo: "I1", amount: 10, reason: "price", text: "t", need: "n", at: T1, byName: "f", state: "open", price: 12, lineId: "l1" }
add("Finance holds an invoice: poster", "ALLOW", { ...upd(uidOf("poster"), accepted, step(accepted, { financeHolds: [hold] }, uidOf("poster"))) })
const held = po({ ...accepted, financeHolds: [hold] })
add("Finance releases a hold: payer", "ALLOW", { ...upd(uidOf("payer"), held, step(held, { financeHolds: [{ ...hold, state: "released", decidedAt: T1 }] }, uidOf("payer"))) })
add("Procurement decides a hold (decideHold): buyer (own order)", "ALLOW", { ...upd(BUYER, held, step(held, { financeHolds: [{ ...hold, state: "decided", decision: "po_price" }] }, BUYER, "hold_decided")) })
add("Procurement decides a hold: manager (answerHoldPrice)", "ALLOW", { ...upd(MANAGER, held, step(held, { financeHolds: [{ ...hold, state: "decided", decision: "po_price" }] }, MANAGER, "hold_price_refused")) })
add("Procurement decides a hold: other buyer", "DENY", { ...upd(BUYER2, held, step(held, { financeHolds: [{ ...hold, state: "decided" }] }, BUYER2, "hold_decided")) })
add("Procurement decides a hold: Finance-only user (payer)", "DENY", { ...upd(uidOf("payer"), held, step(held, { financeHolds: [{ ...hold, state: "decided" }] }, uidOf("payer"), "hold_decided")) })

// --- Projects' budget gate and stop requests (PM project world) -----------------------------------------------------
const PM_USER = "u_pmmgr"
const PMW: Ov = {
  ...memberOv(PM_USER, PERMS.pmManage),
  ...memberOv("u_site", PERMS.pmSite),
  "projects/p1": { organizationId: ORG, name: "P1", projectManagerId: PM_USER, pmHandoverId: "h1", contractorId: OWNER, pm: { lifecycle: "live", no: "PJ-2026/001" } },
  [`projects/p1/members/${PM_USER}`]: { pmRole: "pm", to: null },
  "projects/p1/members/u_site": { pmRole: "site", to: null },
  "projects/pClosed": { organizationId: ORG, name: "PC", projectManagerId: PM_USER, pmHandoverId: "h1", pm: { lifecycle: "closed" } },
}
const refer = (uid: string, b: Data) => step(b, { pmBudget: { state: "pending", over: 500, askedByName: uid, askedAt: T1 } }, uid, "budget_referred", { params: { over: 500 } })
const pop = po({ projectId: "p1", projectName: "P1" })
add("budget referral: preparing buyer", "ALLOW", { ...upd(BUYER, pop, refer(BUYER, pop), PMW) })
add("budget referral: manager", "ALLOW", { ...upd(MANAGER, pop, refer(MANAGER, pop), PMW) })
add("budget referral: second time (already referred)", "DENY", { ...upd(BUYER, po({ ...pop, pmBudget: { state: "pending", over: 5 } }), refer(BUYER, po({ ...pop, pmBudget: { state: "pending", over: 5 } })), PMW) })
add("budget referral: expediter", "DENY", { ...upd(uidOf("expediter"), pop, refer(uidOf("expediter"), pop), PMW) })
add("budget referral: other buyer on someone else's order", "DENY", { ...upd(BUYER2, pop, refer(BUYER2, pop), PMW) })
const pend = po({ ...pop, pmBudget: { state: "pending", over: 500, askedByName: "b", askedAt: T0 } })
const decide = (uid: string, state: string, note: string | null = null) => step(pend, { pmBudget: { ...pend.pmBudget, state, byName: uid, at: T1, note } }, uid, "budget_decided", { params: { decision: state } })
add("PM decides budget — accept: project manager (pm.manage + seat)", "ALLOW", { ...upd(PM_USER, pend, decide(PM_USER, "accepted"), PMW) })
add("PM decides budget — renegotiate with note: project manager", "ALLOW", { ...upd(PM_USER, pend, decide(PM_USER, "renegotiate", "lower please"), PMW) })
add("PM decides budget — accept: owner", "ALLOW", { ...upd(OWNER, pend, decide(OWNER, "accepted"), PMW) })
add("PM decides budget — renegotiate without a note", "DENY", { ...upd(PM_USER, pend, decide(PM_USER, "renegotiate", null), PMW) })
add("PM decides budget — site engineer (no approve duty)", "DENY", { ...upd("u_site", pend, decide("u_site", "accepted"), PMW) })
add("PM decides budget — the buyer himself", "DENY", { ...upd(BUYER, pend, decide(BUYER, "accepted"), PMW) })
add("PM decides budget — project is archived", "DENY", { ...upd(PM_USER, po({ ...pend, projectId: "pClosed" }), step(po({ ...pend, projectId: "pClosed" }), { pmBudget: { ...pend.pmBudget, state: "accepted", byName: "x", at: T1, note: null } }, PM_USER, "budget_decided"), PMW) })
const stopEntry = { reason: "no longer needed", byName: "pm", at: T1, projectId: "p1", requestId: "req1", line: "0" }
const stopAfter = (uid: string, e: Data = stopEntry) => ({ ...step(pop, { pmCancels: { l1: e }, pmCancelKey: "l1" }, uid) })
const REQ: Ov = { "projects/p1/purchaseRequests/req1": { status: "approved", pm: true, requestedByUserId: "u_site", poId: "po1", lines: [{ name: "x" }], organizationId: ORG } }
add("PM stops a line (requestPmStopInTx): project manager (approve)", "ALLOW", { ...upd(PM_USER, pop, stopAfter(PM_USER), { ...PMW, ...REQ }) })
add("PM stops a line: the requesting site engineer (req duty, his own request)", "ALLOW", { ...upd("u_site", pop, stopAfter("u_site"), { ...PMW, ...REQ }) })
add("PM stops a line: on an order awaiting approval", "ALLOW", { ...upd(PM_USER, base, step(base, { pmCancels: { l1: { ...stopEntry, projectId: "p1" } }, pmCancelKey: "l1" }, PM_USER), { ...PMW, ...REQ }) })
add("PM stops a line: without a reason", "DENY", { ...upd(PM_USER, pop, stopAfter(PM_USER, { ...stopEntry, reason: "" }), { ...PMW, ...REQ }) })
add("PM stops a line: a buyer", "DENY", { ...upd(BUYER, pop, stopAfter(BUYER), { ...PMW, ...REQ }) })
add("PM stops a line: site engineer who did NOT raise the request", "DENY", { ...upd("u_site", pop, stopAfter("u_site"), { ...PMW, "projects/p1/purchaseRequests/req1": { ...REQ["projects/p1/purchaseRequests/req1"], requestedByUserId: "someone-else" } }) })
add("PM stops a line: on a closed order", "DENY", { ...upd(PM_USER, po({ ...pop, status: "closed" }), step(po({ ...pop, status: "closed" }), { pmCancels: { l1: stopEntry }, pmCancelKey: "l1" }, PM_USER), { ...PMW, ...REQ }) })

// --- identity fields are frozen for everyone -------------------------------------------------------------------------
for (const key of ["docNumber", "totalExVat", "supplierOrgId", "supplierUserId", "organizationId", "preparedById", "basis", "approverKind", "offerId", "rfqId", "createdAt"])
  add(`identity: owner cannot rewrite ${key}`, "DENY", { ...upd(OWNER, base, step(base, { [key]: key === "totalExVat" ? 1 : "changed" }, OWNER, "approved")) })
add("PO delete: owner (admin only)", "DENY", { uid: OWNER, method: "delete", path: POP, before: base })
add("PO read: supplier of the order", "ALLOW", { uid: SUP_USER, method: "get", path: POP, before: sent })
add("PO read: another supplier", "DENY", { uid: SUP2_ORG, method: "get", path: POP, before: sent })
add("PO read: other company's member", "DENY", { uid: "u_foreign", method: "get", path: POP, before: sent })
add("PO read: own company member", "ALLOW", { uid: uidOf("viewer"), method: "get", path: POP, before: sent })

// SECURITY: poReceives lets a receiver (deliveries.confirm) write `lines` wholesale — it only checks the field list.
add("security: receiver rewrites a line's unitPrice and quantity on an accepted order", "DENY", { ...upd(uidOf("receiver"), accepted, step(accepted, { lines: [line({ unitPrice: 1, quantity: 1000 })] }, uidOf("receiver"), "received")) })
add("security: receiver cancels the remainder of a line (no decision right)", "DENY", { ...upd(uidOf("receiver"), accepted, step(accepted, { lines: [line({ cancelled: 5 })] }, uidOf("receiver"), "remainder_cancelled")) })

// ---------------------------------------------------------------------------------------------------------------
// Deliveries (notices, goods receipts, manual receipts, regularisation)
// ---------------------------------------------------------------------------------------------------------------
const DP = "deliveries/d1"
const dLine = (over: Data = {}) => ({ poLineId: "l1", name: "Rebar", unit: "ton", noticeQuantity: 5, counted: 5, rejected: 0, held: 0, accepted: 5, ...over })
const notice = (over: Data = {}): Data => ({
  rfqId: "rfq1", offerId: "off1", projectId: null, contractorOrgId: ORG, contractorId: BUYER, supplierOrgId: SUP_ORG, supplierId: SUP_USER, supplierName: "Supplier",
  deliveryPersonName: "Driver", handoverRecipientName: null, deliveryDate: T1, notes: null, rfqTitle: "Rebar", items: [{ name: "Rebar", quantity: 5, unitOfMeasure: "ton" }],
  status: "pending_confirmation", createdAt: T0, poId: "po1", poNumber: "PO-2026/001", lines: [dLine({ counted: undefined, accepted: undefined })], vehiclePlate: null, driverPhone: null,
  qualityPapers: [], paperNoteNumber: null, deliveryWindow: null, ...over,
})
const BR_ON: Ov = { "procurementSettings/orgT": { organizationId: ORG, buyerReceives: true } }
add("notice create (supplier's buildDeliveryNotice shape): supplier owner", "ALLOW", { uid: SUP_USER, method: "create", path: DP, after: notice() })
add("notice create: supplier company member", "ALLOW", { uid: "u_supmember", method: "create", path: DP, after: notice(), ov: { "users/u_supmember": { organizationId: SUP_ORG, role: "Supplier", organizationRole: "member" } } })
add("notice create (legacy offers page shape, no PO): supplier", "ALLOW", { uid: SUP_USER, method: "create", path: DP, after: notice({ poId: undefined, poNumber: undefined, lines: undefined }) })
add("notice create: supplier names another supplier's org", "DENY", { uid: SUP_USER, method: "create", path: DP, after: notice({ supplierOrgId: SUP2_ORG }) })
add("notice create: a contractor creating a pending notice", "DENY", { uid: BUYER, method: "create", path: DP, after: notice({ supplierId: undefined, supplierOrgId: undefined }) })
add("notice create: unauthenticated", "DENY", { uid: null, method: "create", path: DP, after: notice() })

const arrival = (uid: string, over: Data = {}): Data => ({
  contractorOrgId: ORG, contractorId: uid, poId: "po1", poNumber: "PO-2026/001", docNumber: "GR-2026/001", supplierName: "Supplier", rfqTitle: "Rebar", projectId: null,
  deliveryPersonName: null, deliveryDate: "2026-10-08", lines: [dLine()], status: "confirmed", noNotice: true, receivedByName: "Keeper", receiverUserId: uid, confirmedAt: T1,
  confirmedByUserId: uid, confirmedByName: uid, createdAt: T1, checklist: [], vehiclePlate: null, paperNoteNumber: null, receiptNote: null, receiverSignatureData: null,
  landedWarehouseId: "central_orgT", selfReceived: false, postedNet: 500, ...over,
})
add("arrival without notice (gate): receiver", "ALLOW", { uid: uidOf("receiver"), method: "create", path: DP, after: arrival(uidOf("receiver")) })
add("arrival without notice: owner", "ALLOW", { uid: OWNER, method: "create", path: DP, after: arrival(OWNER) })
add("arrival without notice: buyer under buyerReceives (selfReceived)", "ALLOW", { uid: BUYER, method: "create", path: DP, after: arrival(BUYER, { selfReceived: true }), ov: BR_ON })
add("arrival without notice, manual form: buyer", "ALLOW", { uid: BUYER, method: "create", path: DP, after: arrival(BUYER, { source: "manual", selfReceived: true }) })
add("arrival without notice, manual form: manager", "ALLOW", { uid: MANAGER, method: "create", path: DP, after: arrival(MANAGER, { source: "manual", selfReceived: false, attachmentUrls: ["u"] }) })
add("arrival without notice, manual form: owner", "ALLOW", { uid: OWNER, method: "create", path: DP, after: arrival(OWNER, { source: "manual" }) })
const manualR = (uid: string, over: Data = {}): Data => arrival(uid, { poId: undefined, poNumber: undefined, noNotice: undefined, source: "manual", supplierName: "Corner shop", supplierGuessOrgId: null, warehouseId: "central_orgT", items: [{ itemId: null, name: "Nails", quantity: 3, unit: "kg", unitPrice: 5 }], lines: [dLine({ poLineId: "i1", noticeQuantity: 0, counted: 3, accepted: 3 })], postedNet: null, ...over })
add("manual receipt, no order (createManualReceipt): buyer", "ALLOW", { uid: BUYER, method: "create", path: DP, after: manualR(BUYER) })
add("manual receipt, no order: manager", "ALLOW", { uid: MANAGER, method: "create", path: DP, after: manualR(MANAGER) })
add("manual receipt, no order: owner", "ALLOW", { uid: OWNER, method: "create", path: DP, after: manualR(OWNER) })
add("manual receipt, no order: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: DP, after: manualR(uidOf("expediter")) })
add("arrival: buyer WITHOUT buyerReceives, not the manual form", "DENY", { uid: BUYER, method: "create", path: DP, after: arrival(BUYER, { selfReceived: true }) })
add("arrival: buyerReceives on but selfReceived false", "DENY", { uid: BUYER, method: "create", path: DP, after: arrival(BUYER, { selfReceived: false }), ov: BR_ON })
add("arrival: manual flag by an expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: DP, after: arrival(uidOf("expediter"), { source: "manual" }) })
add("arrival: carries supplierId (impersonation)", "DENY", { uid: uidOf("receiver"), method: "create", path: DP, after: arrival(uidOf("receiver"), { supplierId: SUP_USER }) })
add("arrival: carries offerId", "DENY", { uid: uidOf("receiver"), method: "create", path: DP, after: arrival(uidOf("receiver"), { offerId: "off1" }) })
add("arrival: carries rfqId", "DENY", { uid: uidOf("receiver"), method: "create", path: DP, after: arrival(uidOf("receiver"), { rfqId: "rfq1" }) })
add("arrival: born pending", "DENY", { uid: uidOf("receiver"), method: "create", path: DP, after: arrival(uidOf("receiver"), { status: "pending_confirmation" }) })
add("arrival: contractorId names someone else", "DENY", { uid: uidOf("receiver"), method: "create", path: DP, after: arrival(uidOf("receiver"), { contractorId: BUYER }) })
add("arrival: other company's receiver into our org", "DENY", { uid: "u_foreign", method: "create", path: DP, after: arrival("u_foreign") })
add("arrival: a supplier user", "DENY", { uid: SUP_USER, method: "create", path: DP, after: arrival(SUP_USER) })

const pendingN = notice()
const confirmPatch = (uid: string, over: Data = {}) => ({ status: "confirmed", docNumber: "GR-2026/002", lines: [dLine()], receivedByName: "Keeper", receiverUserId: uid, confirmedAt: T1, confirmedByUserId: uid, confirmedByName: uid, checklist: [], vehiclePlate: null, paperNoteNumber: null, receiptNote: null, receiverSignatureData: null, landedWarehouseId: "central_orgT", selfReceived: false, postedNet: 500, poId: "po1", poNumber: "PO-2026/001", ...over })
const dUpd = (uid: string, before: Data, patch: Data, ov?: Ov) => ({ uid, method: "update" as const, path: DP, before, after: { ...before, ...patch }, ov })
add("receipt confirm (recordReceipt): receiver", "ALLOW", { ...dUpd(uidOf("receiver"), pendingN, confirmPatch(uidOf("receiver"))) })
add("receipt confirm: owner", "ALLOW", { ...dUpd(OWNER, pendingN, confirmPatch(OWNER)) })
add("receipt confirm: supply-chain member (deliveries.confirm)", "ALLOW", { ...dUpd(uidOf("supply"), pendingN, confirmPatch(uidOf("supply"))) })
add("receipt confirm: buyer under buyerReceives (offers.accept only)", "ALLOW", { ...dUpd(BUYER, pendingN, confirmPatch(BUYER, { selfReceived: true }), BR_ON) })
add("receipt confirm: legacy notice (RfqOffersView) receiver", "ALLOW", { ...dUpd(uidOf("receiver"), notice({ poId: undefined, poNumber: undefined, lines: undefined }), { status: "confirmed", receivedByName: "k", confirmedAt: T1, confirmedByUserId: uidOf("receiver") }) })
add("receipt confirm: buyer WITHOUT the buyerReceives policy", "DENY", { ...dUpd(BUYER, pendingN, confirmPatch(BUYER, { selfReceived: true })) })
add("receipt confirm: buyerReceives but selfReceived false", "DENY", { ...dUpd(BUYER, pendingN, confirmPatch(BUYER, { selfReceived: false }), BR_ON) })
add("receipt confirm: buyerReceives, confirmedByUserId someone else", "DENY", { ...dUpd(BUYER, pendingN, confirmPatch(BUYER, { selfReceived: true, confirmedByUserId: OWNER }), BR_ON) })
add("receipt confirm: expediter", "DENY", { ...dUpd(uidOf("expediter"), pendingN, confirmPatch(uidOf("expediter"))) })
add("receipt confirm: other company's receiver", "DENY", { ...dUpd("u_foreign", pendingN, confirmPatch("u_foreign")) })
add("receipt confirm: adds an offerId to a notice that had none (impersonation)", "DENY", { ...dUpd(uidOf("receiver"), notice({ offerId: undefined }), confirmPatch(uidOf("receiver"), { offerId: "x" })) })
add("security: supplier confirms his OWN pending notice (status → confirmed)", "DENY", { ...dUpd(SUP_USER, pendingN, { status: "confirmed", confirmedByUserId: SUP_USER, receivedByName: "me" }) })
add("supplier edits his own notice's notes before confirmation", "ALLOW", { ...dUpd(SUP_USER, pendingN, { notes: "gate 3" }) })
add("another supplier edits the notice", "DENY", { ...dUpd(SUP2_ORG, pendingN, { notes: "x" }) })
const trimmed = (uid: string, over: Data = {}) => ({ lines: [dLine({ noticeQuantity: 2, counted: undefined, accepted: undefined })], updatedAt: T1, ...over })
add("receipt without notice trims the pending notice: buyer", "ALLOW", { ...dUpd(BUYER, pendingN, trimmed(BUYER)) })
add("receipt without notice closes the pending notice: manager", "ALLOW", { ...dUpd(MANAGER, pendingN, trimmed(MANAGER, { closedByReceipt: { deliveryId: "d9", docNumber: "GR-2026/009" } })) })
add("trim notice: buyer also flips status", "DENY", { ...dUpd(BUYER, pendingN, trimmed(BUYER, { status: "confirmed" })) })
add("trim notice: already closed by a receipt", "DENY", { ...dUpd(BUYER, notice({ closedByReceipt: { deliveryId: "d8" } }), trimmed(BUYER)) })
add("trim notice: expediter", "DENY", { ...dUpd(uidOf("expediter"), pendingN, trimmed(uidOf("expediter"))) })

const manualD = manualR(BUYER)
const regular = (uid: string, over: Data = {}) => ({ regularisation: "expense", regularisedAt: T1, regularisedById: uid, regularisedByName: uid, ...over })
add("markReceiptAsExpense: buyer", "ALLOW", { ...dUpd(BUYER, manualD, regular(BUYER)) })
add("markReceiptAsExpense: manager", "ALLOW", { ...dUpd(MANAGER, manualD, regular(MANAGER)) })
add("markReceiptAsExpense: owner", "ALLOW", { ...dUpd(OWNER, manualD, regular(OWNER)) })
add("link receipt to open order (linkReceiptToOrder): buyer", "ALLOW", { ...dUpd(BUYER, manualD, { poId: "po1", poNumber: "PO-2026/001", lines: [dLine()], regularisedAt: T1, regularisedById: BUYER, regularisedByName: "b", postedNet: 500 }) })
add("link receipt to a retroactive order (retroactivePurchaseOrder): manager", "ALLOW", { ...dUpd(MANAGER, manualD, { poId: "po1", poNumber: "PO-2026/002", regularisedAt: T1, regularisedById: MANAGER, regularisedByName: "m" }) })
add("regularise: twice (regularisation already set)", "DENY", { ...dUpd(BUYER, { ...manualD, regularisation: "expense" }, regular(BUYER)) })
add("regularise: receipt already tied to an order", "DENY", { ...dUpd(BUYER, { ...manualD, poId: "po9" }, regular(BUYER)) })
add("regularise: a supplier notice (not manual)", "DENY", { ...dUpd(BUYER, pendingN, regular(BUYER)) })
add("regularise: adds an offerId", "DENY", { ...dUpd(BUYER, manualD, regular(BUYER, { offerId: "off1" })) })
add("regularise: expediter", "DENY", { ...dUpd(uidOf("expediter"), manualD, regular(uidOf("expediter"))) })
add("regularise: touches the receipt's lines and a forbidden field", "DENY", { ...dUpd(BUYER, manualD, regular(BUYER, { receivedByName: "someone else" })) })
add("delivery delete: owner", "DENY", { uid: OWNER, method: "delete", path: DP, before: manualD })
add("delivery read: its supplier", "ALLOW", { uid: SUP_USER, method: "get", path: DP, before: pendingN })
add("delivery read: another supplier", "DENY", { uid: SUP2_ORG, method: "get", path: DP, before: pendingN })

// what a receipt does after the commit: stock into the warehouse (receiveDelivery) and the central warehouse
const WH: Ov = { "warehouses/central_orgT": { organizationId: ORG, isCentral: true, name: "central" } }
add("receipt effect: receiver creates the central warehouse", "ALLOW", { uid: uidOf("receiver"), method: "create", path: "warehouses/central_orgT", after: { name: "c", location: "l", description: "d", organizationId: ORG, isCentral: true, projectId: null, projectName: null, createdAt: T1, updatedAt: T1 } })
add("receipt effect: receiver creates a stock row", "ALLOW", { uid: uidOf("receiver"), method: "create", path: "warehouses/central_orgT/inventoryItems/i1", after: { name: "Rebar", sku: null, quantity: 5, unit: "ton", unitCost: 100, minStockLevel: null, trackingMode: null, organizationId: ORG, warehouseId: "central_orgT", createdAt: T1, updatedAt: T1 }, ov: WH })
add("receipt effect: receiver adds quantity to a stock row", "ALLOW", { uid: uidOf("receiver"), method: "update", path: "warehouses/central_orgT/inventoryItems/i1", before: { name: "Rebar", quantity: 5, unit: "ton", unitCost: 100, organizationId: ORG, warehouseId: "central_orgT" }, after: { name: "Rebar", quantity: 10, unit: "ton", unitCost: 100, organizationId: ORG, warehouseId: "central_orgT", updatedAt: T1 }, ov: WH })
add("receipt effect: other company's user adds stock to our warehouse", "DENY", { uid: "u_foreign", method: "update", path: "warehouses/central_orgT/inventoryItems/i1", before: { name: "Rebar", quantity: 5, organizationId: ORG }, after: { name: "Rebar", quantity: 999, organizationId: ORG }, ov: WH })
add("receipt effect: the supplier is told (cross-user notification create)", "ALLOW", { uid: uidOf("receiver"), method: "create", path: `users/${SUP_USER}/notifications/n1`, after: { userId: SUP_USER, type: "delivery_confirmed", read: false } })

// ---------------------------------------------------------------------------------------------------------------
// RFQs (create, draft edit, publish, delete, cancel, close early, round, extend, award) and their inquiries
// ---------------------------------------------------------------------------------------------------------------
const RP = "rfqs/rfq1"
const rfqDoc = (over: Data = {}): Data => ({
  contractorId: BUYER, organizationId: ORG, projectId: null, title: "Rebar", category: "steel", subCategory: "x",
  products: [{ name: "Rebar", quantity: 10, unitOfMeasure: "ton", description: "", category: "steel", subCategory: "x", requiresWarranty: false }],
  attachments: [], deadline: "2026-10-20", estimatedBudget: null, country: "SA", city: "Riyadh", district: "", notes: "", pdfUrl: null, pdfStoragePath: null,
  status: "New", pricingMode: "total", visibility: "public", allowedSupplierOrgIds: [], orderedFromMdmakDirect: false, requiresWarranty: false,
  createdByUserId: BUYER, createdByUserName: "b", createdAt: T0, offersCount: 0, log: [], ...over,
})
const rLog = (uid: string, action: string, extra: Data = {}) => ({ at: T1, byId: uid, byName: uid, action, note: null, params: null, ...extra })
const rStep = (before: Data, patch: Data, uid: string, action?: string): Data => ({ ...before, ...patch, updatedAt: T1, ...(action ? { log: [...(before.log || []), rLog(uid, action)] } : {}) })
const rUpd = (uid: string | null, before: Data, after: Data, ov?: Ov) => ({ uid: uid as string, method: "update" as const, path: RP, before, after, ov })
const PROJ_OK: Ov = { "projects/p1": { organizationId: ORG, name: "P1" }, "projects/pX": { organizationId: OTHER_ORG, name: "X" } }

for (const [label, uid] of [["buyer (offers.accept)", BUYER], ["rfq.create only", uidOf("rfqCreate")], ["supply chain (rfq.manage+create)", uidOf("supply")], ["manager (po.approve)", MANAGER], ["owner", OWNER]] as const)
  add(`RFQ create standalone: ${label}`, "ALLOW", { uid, method: "create", path: "rfqs/n1", after: rfqDoc({ contractorId: uid, createdByUserId: uid }) })
add("RFQ create in a project: buyer", "ALLOW", { uid: BUYER, method: "create", path: "rfqs/n1", after: rfqDoc({ projectId: "p1" }), ov: PROJ_OK })
add("RFQ create in a project: rfq.create only", "ALLOW", { uid: uidOf("rfqCreate"), method: "create", path: "rfqs/n1", after: rfqDoc({ projectId: "p1", contractorId: uidOf("rfqCreate"), createdByUserId: uidOf("rfqCreate") }), ov: PROJ_OK })
add("RFQ create direct award, born Awarded: buyer", "ALLOW", { uid: BUYER, method: "create", path: "rfqs/n1", after: rfqDoc({ status: "Awarded", directAward: true, visibility: "private", allowedSupplierOrgIds: [SUP_ORG], awardedAt: T1, deadline: null }) })
add("RFQ create: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: "rfqs/n1", after: rfqDoc({ contractorId: uidOf("expediter") }) })
add("RFQ create: viewer", "DENY", { uid: uidOf("viewer"), method: "create", path: "rfqs/n1", after: rfqDoc({ contractorId: uidOf("viewer") }) })
add("RFQ create: receiver", "DENY", { uid: uidOf("receiver"), method: "create", path: "rfqs/n1", after: rfqDoc({ contractorId: uidOf("receiver") }) })
add("RFQ create: foreign member writes organizationId of our company", "DENY", { uid: "u_foreign", method: "create", path: "rfqs/n1", after: rfqDoc({ contractorId: "u_foreign" }) })
add("RFQ create: buyer writes another company's organizationId", "DENY", { uid: BUYER, method: "create", path: "rfqs/n1", after: rfqDoc({ organizationId: OTHER_ORG }) })
add("RFQ create: in another company's project", "DENY", { uid: BUYER, method: "create", path: "rfqs/n1", after: rfqDoc({ projectId: "pX" }), ov: PROJ_OK })
add("RFQ create: unauthenticated", "DENY", { uid: null, method: "create", path: "rfqs/n1", after: rfqDoc() })

const draft = rfqDoc({ status: "Draft" })
const edited = (b: Data) => ({ ...b, title: "Rebar v2", deadline: "2026-10-25", status: "New", updatedAt: T1 })
for (const [label, uid, exp] of [["buyer (own draft)", BUYER, "ALLOW"], ["supply chain (rfq.manage)", uidOf("supply"), "ALLOW"], ["manager", MANAGER, "ALLOW"], ["owner", OWNER, "ALLOW"], ["rfq.create-only member (client's runner model: managesRfqs)", uidOf("rfqCreate"), "ALLOW"], ["another buyer", BUYER2, "DENY"], ["expediter", uidOf("expediter"), "DENY"], ["foreign member with rfq.manage", "u_foreign", "DENY"]] as const) {
  const b = uid === uidOf("rfqCreate") ? rfqDoc({ status: "Draft", contractorId: uid, createdByUserId: uid }) : draft
  add(`RFQ edit own draft and publish via the form: ${label}`, exp, { ...rUpd(uid, b, edited(b)) })
  const patch = { status: "New", visibility: "public", publishedAt: T1 }
  add(`RFQ bulk publish a draft: ${label}`, exp, { ...rUpd(uid, b, { ...b, ...patch }) })
}
add("RFQ delete a draft: buyer (own)", "ALLOW", { uid: BUYER, method: "delete", path: RP, before: draft })
add("RFQ delete a draft: supply chain", "ALLOW", { uid: uidOf("supply"), method: "delete", path: RP, before: draft })
add("RFQ delete a draft: the creator holding rfq.create only", "ALLOW", { uid: uidOf("rfqCreate"), method: "delete", path: RP, before: rfqDoc({ status: "Draft", contractorId: uidOf("rfqCreate"), createdByUserId: uidOf("rfqCreate") }) })
add("RFQ delete a published RFQ", "DENY", { uid: OWNER, method: "delete", path: RP, before: rfqDoc() })
add("RFQ delete a draft: another buyer", "DENY", { uid: BUYER2, method: "delete", path: RP, before: draft })
add("RFQ delete a draft: foreign member", "DENY", { uid: "u_foreign", method: "delete", path: RP, before: draft })

const open = rfqDoc()
const cancelP = (uid: string, code = "need") => ({ status: "Cancelled", cancellation: { code, byId: uid, byName: uid, at: T1 }, cancelledAt: T1 })
for (const [label, uid] of [["buyer (own)", BUYER], ["manager", MANAGER], ["supply chain member who raised it", uidOf("supply")], ["owner", OWNER]] as const) {
  const b = uid === uidOf("supply") ? rfqDoc({ contractorId: uid, createdByUserId: uid }) : open
  add(`RFQ cancel (R-12): ${label}`, "ALLOW", { ...rUpd(uid, b, rStep(b, cancelP(uid), uid, "cancelled")) })
}
add("RFQ cancel a Draft (R-12 allows New or Draft): buyer", "ALLOW", { ...rUpd(BUYER, draft, rStep(draft, cancelP(BUYER), BUYER, "cancelled")) })
add("RFQ cancel: another buyer", "DENY", { ...rUpd(BUYER2, open, rStep(open, cancelP(BUYER2), BUYER2, "cancelled")) })
add("RFQ cancel: unknown reason code", "DENY", { ...rUpd(BUYER, open, rStep(open, cancelP(BUYER, "because"), BUYER, "cancelled")) })
add("RFQ cancel: already Awarded", "DENY", { ...rUpd(BUYER, rfqDoc({ status: "Awarded" }), rStep(rfqDoc({ status: "Awarded" }), cancelP(BUYER), BUYER, "cancelled")) })
add("RFQ cancel: expediter", "DENY", { ...rUpd(uidOf("expediter"), open, rStep(open, cancelP(uidOf("expediter")), uidOf("expediter"), "cancelled")) })
add("RFQ cancel: no log entry", "DENY", { ...rUpd(BUYER, open, rStep(open, cancelP(BUYER), BUYER)) })

const closeP = (uid: string, over: Data = {}) => ({ deadline: "2026-10-07", closedEarly: { at: T1, byId: uid, byName: uid, reason: "enough offers", originalDeadline: "2026-10-20" }, ...over })
add("RFQ close early (R-08): manager", "ALLOW", { ...rUpd(MANAGER, open, rStep(open, closeP(MANAGER), MANAGER, "closed_early")) })
add("RFQ close early: owner", "ALLOW", { ...rUpd(OWNER, open, rStep(open, closeP(OWNER), OWNER, "closed_early")) })
add("RFQ close early: finance (po.approve) on a buyer's RFQ", "ALLOW", { ...rUpd(FINANCE, open, rStep(open, closeP(FINANCE), FINANCE, "closed_early")) })
add("RFQ close early: the buyer who raised it (client refuses too: not the manager)", "DENY", { ...rUpd(BUYER, open, rStep(open, closeP(BUYER), BUYER, "closed_early")) })
add("RFQ close early: deadline moved forward", "DENY", { ...rUpd(MANAGER, open, rStep(open, closeP(MANAGER, { deadline: "2026-12-01" }), MANAGER, "closed_early")) })
add("RFQ close early: without a reason", "DENY", { ...rUpd(MANAGER, open, rStep(open, closeP(MANAGER, { closedEarly: { at: T1, byId: MANAGER, byName: "m", reason: "", originalDeadline: null } }), MANAGER, "closed_early")) })
add("RFQ close early: twice", "DENY", { ...rUpd(MANAGER, rfqDoc({ closedEarly: { at: T0, byId: OWNER, reason: "x" } }), rStep(rfqDoc({ closedEarly: { at: T0, byId: OWNER, reason: "x" } }), closeP(MANAGER), MANAGER, "closed_early")) })

const roundP = (uid: string) => ({ reductionRound: { at: T1, byId: uid, byName: uid, targets: null, offers: 2 } })
add("RFQ reduction round (R-11): buyer (own)", "ALLOW", { ...rUpd(BUYER, open, rStep(open, roundP(BUYER), BUYER, "reduction_round")) })
add("RFQ reduction round: manager", "ALLOW", { ...rUpd(MANAGER, open, rStep(open, roundP(MANAGER), MANAGER, "reduction_round")) })
add("RFQ reduction round: second round", "DENY", { ...rUpd(BUYER, rfqDoc({ reductionRound: { at: T0, byId: BUYER } }), rStep(rfqDoc({ reductionRound: { at: T0, byId: BUYER } }), roundP(BUYER), BUYER, "reduction_round")) })
add("RFQ reduction round: another buyer", "DENY", { ...rUpd(BUYER2, open, rStep(open, roundP(BUYER2), BUYER2, "reduction_round")) })
for (const [label, uid] of [["buyer (own)", BUYER], ["supply chain (rfq.manage, raised it)", uidOf("supply")], ["manager", MANAGER], ["rfq.create-only member (raised it)", uidOf("rfqCreate")]] as const) {
  const b = uid === uidOf("supply") || uid === uidOf("rfqCreate") ? rfqDoc({ contractorId: uid, createdByUserId: uid }) : open
  add(`RFQ log-only entry (print / exclude / answer / guest invite): ${label}`, "ALLOW", { ...rUpd(uid, b, rStep(b, {}, uid, "document_printed")) })
  add(`RFQ manual offer recorded, offersCount+1: ${label}`, "ALLOW", { ...rUpd(uid, b, rStep(b, { offersCount: 1 }, uid, "offer_recorded")) })
}
add("RFQ log-only: another buyer", "DENY", { ...rUpd(BUYER2, open, rStep(open, {}, BUYER2, "document_printed")) })
add("RFQ log-only: expediter", "DENY", { ...rUpd(uidOf("expediter"), open, rStep(open, {}, uidOf("expediter"), "document_printed")) })
add("RFQ log-only: log entry names someone else", "DENY", { ...rUpd(BUYER, open, { ...open, updatedAt: T1, log: [rLog(OWNER, "document_printed")] }) })
add("RFQ log-only: offersCount jumps by 2", "DENY", { ...rUpd(BUYER, open, rStep(open, { offersCount: 2 }, BUYER, "offer_recorded")) })
const extP = { deadline: "2026-10-30", invitedSupplierOrgIds: [SUP_ORG] }
add("RFQ extend (R-40): buyer (own)", "ALLOW", { ...rUpd(BUYER, open, rStep(open, extP, BUYER, "extended")) })
add("RFQ extend, private RFQ also widens allowedSupplierOrgIds: manager", "ALLOW", { ...rUpd(MANAGER, rfqDoc({ visibility: "private" }), rStep(rfqDoc({ visibility: "private" }), { ...extP, allowedSupplierOrgIds: [SUP_ORG] }, MANAGER, "extended")) })
add("RFQ extend: a direct award", "DENY", { ...rUpd(BUYER, rfqDoc({ directAward: true }), rStep(rfqDoc({ directAward: true }), extP, BUYER, "extended")) })
add("RFQ extend: also rewrites the title", "DENY", { ...rUpd(BUYER, open, rStep(open, { ...extP, title: "other" }, BUYER, "extended")) })
add("RFQ extend: another buyer", "DENY", { ...rUpd(BUYER2, open, rStep(open, extP, BUYER2, "extended")) })
const awardP = { status: "Awarded", awardedAt: T1, unawardedLines: [1], awardSplit: false }
add("RFQ award (R-01): buyer (own, offers.accept)", "ALLOW", { ...rUpd(BUYER, open, rStep(open, awardP, BUYER, "awarded")) })
add("RFQ award: owner", "ALLOW", { ...rUpd(OWNER, open, rStep(open, awardP, OWNER, "awarded")) })
add("RFQ award: finance on a buyer's RFQ", "ALLOW", { ...rUpd(FINANCE, open, rStep(open, awardP, FINANCE, "awarded")) })
add("security: RFQ award by a supply-chain member without offers.accept (rfq.manage clause allows ANY field; client refuses)", "DENY", { ...rUpd(uidOf("supply"), rfqDoc({ contractorId: uidOf("supply"), createdByUserId: uidOf("supply") }), rStep(rfqDoc({ contractorId: uidOf("supply"), createdByUserId: uidOf("supply") }), awardP, uidOf("supply"), "awarded")) })
add("RFQ award: manager without offers.accept (client refuses too)", "DENY", { ...rUpd(MANAGER, open, rStep(open, awardP, MANAGER, "awarded")) })
add("RFQ award: another buyer", "DENY", { ...rUpd(BUYER2, open, rStep(open, awardP, BUYER2, "awarded")) })
add("RFQ award: an RFQ already Awarded", "DENY", { ...rUpd(BUYER, rfqDoc({ status: "Awarded" }), rStep(rfqDoc({ status: "Awarded" }), awardP, BUYER, "awarded")) })
add("RFQ award: also rewrites projectId", "DENY", { ...rUpd(BUYER, open, rStep(open, { ...awardP, projectId: "p1" }, BUYER, "awarded"), PROJ_OK) })
add("RFQ legacy «confirm completion» (status Awarded + completedAt): owner", "ALLOW", { ...rUpd(OWNER, rfqDoc({ status: "Awarded" }), { ...rfqDoc({ status: "Awarded" }), completedAt: T1 }) })
add("RFQ legacy «confirm completion»: the buyer who raised it", "ALLOW", { ...rUpd(BUYER, rfqDoc({ status: "Awarded" }), { ...rfqDoc({ status: "Awarded" }), completedAt: T1 }) })
add("RFQ offersCount+1 by a supplier submitting an offer", "ALLOW", { ...rUpd(SUP_USER, open, { ...open, offersCount: 1 }) })
add("RFQ supplier changes status", "DENY", { ...rUpd(SUP_USER, open, { ...open, status: "Awarded" }) })
add("security: any signed-in user sets offersCount to 999", "DENY", { ...rUpd(SUP_USER, open, { ...open, offersCount: 999 }) })
add("RFQ update by a foreign member holding rfq.manage", "DENY", { ...rUpd("u_foreign", open, rStep(open, {}, "u_foreign", "document_printed")) })
add("RFQ read by a supplier", "ALLOW", { uid: SUP_USER, method: "get", path: RP, before: open })

const IP = "rfqs/rfq1/inquiries/q1"
const inquiry = { rfqId: "rfq1", userId: SUP_USER, userName: "S", question: "q?", createdAt: T0 }
add("inquiry create: supplier", "ALLOW", { uid: SUP_USER, method: "create", path: IP, after: inquiry })
add("inquiry answer (answerQuery): buyer", "ALLOW", { uid: BUYER, method: "update", path: IP, before: inquiry, after: { ...inquiry, reply: "a", repliedAt: T1, repliedBy: BUYER, repliedByUserName: "b", sentToAll: true, sentToCount: 3 }, ov: { "rfqs/rfq1": open } })
add("inquiry answer: manager", "ALLOW", { uid: MANAGER, method: "update", path: IP, before: inquiry, after: { ...inquiry, reply: "a" }, ov: { "rfqs/rfq1": open } })
add("inquiry answer: foreign member", "DENY", { uid: "u_foreign", method: "update", path: IP, before: inquiry, after: { ...inquiry, reply: "a" }, ov: { "rfqs/rfq1": open } })
add("inquiry answer: another supplier", "DENY", { uid: SUP2_ORG, method: "update", path: IP, before: inquiry, after: { ...inquiry, reply: "a" }, ov: { "rfqs/rfq1": open } })

// ---------------------------------------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------------------------------------
const OP = "offers/off1"
const RF: Ov = { "rfqs/rfq1": open }
const offerDoc = (over: Data = {}): Data => ({
  supplierId: SUP_USER, organizationId: SUP_ORG, supplierName: "Supplier", companyName: "Supplier", submittedByUserId: SUP_USER, rfqId: "rfq1", rfqTitle: "Rebar", projectId: null,
  contractorId: BUYER, contractorOrgId: ORG, price: "1000", deliveryLocation: "Riyadh", deliveryBatches: [{ location: "Riyadh", deliveryDate: "2026-11-01", price: "1000", quantity: "10" }],
  status: "قيد المراجعة", createdAt: T0, ...over,
})
const oUpd = (uid: string | null, patch: Data, before: Data = offerDoc(), ov: Ov = RF) => ({ uid: uid as string, method: "update" as const, path: OP, before, after: { ...before, ...patch }, ov })
add("offer submit (SubmitOfferDialog): supplier", "ALLOW", { uid: SUP_USER, method: "create", path: OP, after: offerDoc() })
add("offer submit: supplier company member", "ALLOW", { uid: "u_supmember", method: "create", path: OP, after: offerDoc({ supplierId: "u_supmember", submittedByUserId: "u_supmember" }), ov: { "users/u_supmember": { organizationId: SUP_ORG, role: "Supplier", organizationRole: "member" } } })
add("offer create on behalf of a supplier by a contractor buyer", "DENY", { uid: BUYER, method: "create", path: OP, after: offerDoc() })
add("offer create: unauthenticated", "DENY", { uid: null, method: "create", path: OP, after: offerDoc() })
const directOffer = (uid: string, over: Data = {}) => offerDoc({ directAward: true, status: "مقبول", contractorId: uid, submittedByUserId: uid, awaitingOrderApproval: true, decidedByUserId: uid, decidedByUserName: uid, decidedAt: T1, lines: [{ rfqProductIndex: 0, unitPrice: 100 }], ...over })
const directRfq = (uid: string): Ov => ({ "rfqs/rfq1": rfqDoc({ status: "Awarded", directAward: true, contractorId: uid, createdByUserId: uid }) })
add("direct-award offer (RfqForm): owner", "ALLOW", { uid: OWNER, method: "create", path: OP, after: directOffer(OWNER), ov: directRfq(OWNER) })
add("direct-award offer: buyer (offers.accept)", "ALLOW", { uid: BUYER, method: "create", path: OP, after: directOffer(BUYER), ov: directRfq(BUYER) })
add("direct-award offer: finance", "ALLOW", { uid: FINANCE, method: "create", path: OP, after: directOffer(FINANCE), ov: directRfq(FINANCE) })
add("direct-award offer: supply-chain member (RfqForm offers «direct» to anyone who can raise an RFQ; rule needs offers.accept)", "ALLOW", { uid: uidOf("supply"), method: "create", path: OP, after: directOffer(uidOf("supply")), ov: directRfq(uidOf("supply")) })
add("direct-award offer: rfq.create-only member (same)", "ALLOW", { uid: uidOf("rfqCreate"), method: "create", path: OP, after: directOffer(uidOf("rfqCreate")), ov: directRfq(uidOf("rfqCreate")) })
add("direct-award offer: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: OP, after: directOffer(uidOf("expediter")), ov: directRfq(uidOf("expediter")) })
add("direct-award offer: on another company's RFQ", "DENY", { uid: BUYER, method: "create", path: OP, after: directOffer(BUYER), ov: { "rfqs/rfq1": rfqDoc({ organizationId: OTHER_ORG, status: "Awarded", directAward: true }) } })
add("direct-award offer: born not-accepted", "DENY", { uid: BUYER, method: "create", path: OP, after: directOffer(BUYER, { status: "قيد المراجعة" }), ov: directRfq(BUYER) })
const manualO = (uid: string, over: Data = {}) => offerDoc({ supplierId: SUP_ORG, organizationId: SUP_ORG, supplierOrgId: SUP_ORG, isGuestOffer: false, isManualOffer: true, recordedById: uid, recordedByName: uid, recordedEarly: false, manualProofUrl: null, contractorId: BUYER, validUntil: null, priceBasis: "delivered", creditDays: 0, advancePercent: 0, ...over })
add("manual offer recorded (recordManualOffer): buyer on his RFQ", "ALLOW", { uid: BUYER, method: "create", path: OP, after: manualO(BUYER), ov: RF })
add("manual offer, guest supplier: buyer", "ALLOW", { uid: BUYER, method: "create", path: OP, after: manualO(BUYER, { supplierId: "guest", organizationId: "guest", supplierOrgId: null, isGuestOffer: true }), ov: RF })
add("manual offer: manager on a buyer's RFQ", "ALLOW", { uid: MANAGER, method: "create", path: OP, after: manualO(MANAGER), ov: RF })
add("manual offer: owner", "ALLOW", { uid: OWNER, method: "create", path: OP, after: manualO(OWNER), ov: RF })
add("manual offer: supply-chain member on his own RFQ", "ALLOW", { uid: uidOf("supply"), method: "create", path: OP, after: manualO(uidOf("supply")), ov: { "rfqs/rfq1": rfqDoc({ contractorId: uidOf("supply"), createdByUserId: uidOf("supply") }) } })
add("manual offer: another buyer on someone else's RFQ", "DENY", { uid: BUYER2, method: "create", path: OP, after: manualO(BUYER2), ov: RF })
add("manual offer: on an RFQ that is no longer New", "DENY", { uid: BUYER, method: "create", path: OP, after: manualO(BUYER), ov: { "rfqs/rfq1": rfqDoc({ status: "Awarded" }) } })
add("manual offer: recordedById names someone else", "DENY", { uid: BUYER, method: "create", path: OP, after: manualO(OWNER), ov: RF })
add("manual offer: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: OP, after: manualO(uidOf("expediter")), ov: RF })

const excl = { status: "مرفوض", exclusion: { code: "late", note: null, byId: BUYER, at: T1 }, decidedByUserId: BUYER, decidedByUserName: "b", decidedAt: T1, readAt: null }
for (const [label, uid] of [["buyer (his RFQ)", BUYER], ["manager", MANAGER], ["owner", OWNER], ["finance", FINANCE]] as const)
  add(`offer exclude (excludeOffer): ${label}`, "ALLOW", { ...oUpd(uid, { ...excl, decidedByUserId: uid }) })
add("offer exclude: supply chain member who did not raise the RFQ", "DENY", { ...oUpd(uidOf("supply"), excl) })
add("offer exclude: another buyer", "DENY", { ...oUpd(BUYER2, excl) })
add("offer exclude: expediter", "DENY", { ...oUpd(uidOf("expediter"), excl) })
add("offer exclude: viewer", "DENY", { ...oUpd(uidOf("viewer"), excl) })
add("offer exclude: foreign member", "DENY", { ...oUpd("u_foreign", excl) })
const awardO = { status: "مقبول", decidedByUserId: BUYER, decidedByUserName: "b", decidedAt: T1, readAt: null, awaitingOrderApproval: true, awardedLines: [0], awardedTotal: 1000, requestedDeliveryDate: null, poId: "po1", poNumber: "PO-2026/001", updatedAt: T1 }
add("offer award (awardRfq): buyer who raised the RFQ", "ALLOW", { ...oUpd(BUYER, awardO) })
add("offer award: owner", "ALLOW", { ...oUpd(OWNER, awardO) })
add("offer award: finance", "ALLOW", { ...oUpd(FINANCE, awardO) })
add("offer link to order (createPurchaseOrderFromAward): buyer", "ALLOW", { ...oUpd(BUYER, { poId: "po1", poNumber: "PO-2026/001", updatedAt: T1 }) })
add("offer award: another buyer", "DENY", { ...oUpd(BUYER2, awardO) })
add("offer reduction round: buyer", "ALLOW", { ...oUpd(BUYER, { status: "مطلوب تخفيض", reductionNote: null, reductionTargets: null, reductionRound: true, decidedByUserId: BUYER, decidedByUserName: "b", decidedAt: T1, readAt: null }) })
add("offer guest invite: buyer", "ALLOW", { ...oUpd(BUYER, { guestInvite: { at: T1, byId: BUYER, byName: "b", channel: "wa", invitationId: null } }) })
add("offer sample request / receipt: buyer", "ALLOW", { ...oUpd(BUYER, { sampleStatus: "مطلوبة", sampleUpdatedAt: T1 }) })
add("offer legacy «confirm completion»: buyer", "ALLOW", { ...oUpd(BUYER, { status: "تم التسليم", completedAt: T1 }, offerDoc({ status: "مقبول" })) })
add("offer contractorRated after a rating (writes.ts ratePurchaseOrder): manager", "ALLOW", { ...oUpd(MANAGER, { contractorRated: true }) })
add("offer contractorRated: buyer", "ALLOW", { ...oUpd(BUYER, { contractorRated: true }) })
add("offer mark-as-read (bell): offers.view member of the buying company", "ALLOW", { ...oUpd(uidOf("offersView"), { contractorReadAt: T1, contractorUnread: false }) })
add("offer mark-as-read (bell): the buyer", "ALLOW", { ...oUpd(BUYER, { contractorReadAt: T1, contractorUnread: false }) })
add("offer mark-as-read (bell): viewer member", "ALLOW", { ...oUpd(uidOf("viewer"), { contractorReadAt: T1, contractorUnread: false }) })
add("offer: supplier revises his price", "ALLOW", { ...oUpd(SUP_USER, { price: "900", status: "قيد المراجعة", updatedAt: T1 }, offerDoc({ status: "مطلوب تخفيض" })) })
add("offer: supplier archives / marks sample sent", "ALLOW", { ...oUpd(SUP_USER, { archived: true, archivedAt: T1 }) })
add("offer: supplier's company member revises the price", "ALLOW", { ...oUpd("u_supmember", { price: "900" }, offerDoc(), { ...RF, "users/u_supmember": { organizationId: SUP_ORG, role: "Supplier", organizationRole: "member" } }) })
add("offer: supplier marks readAt (offer_update bell)", "ALLOW", { ...oUpd(SUP_USER, { readAt: T1, supplierUnread: false }) })
add("offer delete: its supplier", "ALLOW", { uid: SUP_USER, method: "delete", path: OP, before: offerDoc() })
add("offer delete: another supplier", "DENY", { uid: SUP2_ORG, method: "delete", path: OP, before: offerDoc() })
add("offer update: another supplier", "DENY", { ...oUpd(SUP2_ORG, { price: "1" }) })
add("security: supplier flips his OWN offer to accepted and attaches a PO", "DENY", { ...oUpd(SUP_USER, { status: "مقبول", poId: "po-fake", awardedTotal: 99999 }) })
add("security: supplier rewrites the contractor-side exclusion on his offer", "DENY", { ...oUpd(SUP_USER, { status: "قيد المراجعة", exclusion: null }, offerDoc({ status: "مرفوض", exclusion: { code: "late", byId: BUYER } })) })
add("rating refresh: contractor writes the supplier's users doc (rating, reviewsCount) — ratePurchaseOrder / ReviewDialog", "ALLOW", { uid: MANAGER, method: "update", path: `users/${SUP_USER}`, before: { organizationId: SUP_ORG, role: "Supplier", organizationRole: "owner" }, after: { organizationId: SUP_ORG, role: "Supplier", organizationRole: "owner", rating: 4.5, reviewsCount: 3 } })
add("rating review create (anonymous review): manager", "ALLOW", { uid: MANAGER, method: "create", path: "reviews/rv1", after: { offerId: "off1", rfqId: "rfq1", poId: "po1", reviewerId: MANAGER, anonymous: true, revieweeId: SUP_USER, rating: 5, comment: "", createdAt: T1 } })

// ---------------------------------------------------------------------------------------------------------------
// Procurement settings, receiver register, supplier records, price agreements, price history
// ---------------------------------------------------------------------------------------------------------------
const SP = `procurementSettings/${ORG}`
const settings = { organizationId: ORG, sendOnApproval: true, sealOffersUntilDeadline: true, buyerReceives: false, replyWindowDays: 1, managerApprovalLimit: 150000, buyerSelfIssueLimit: 2000, directPurchaseCap: 10000, overReceiptTolerancePercent: 5, updatedAt: T0, updatedById: OWNER }
const sUpd = (uid: string, patch: Data, ov?: Ov) => ({ uid, method: "update" as const, path: SP, before: settings, after: { ...settings, ...patch, updatedAt: T1, updatedById: uid }, ov })
add("settings save (setDoc merge, existing): owner changes a limit", "ALLOW", { ...sUpd(OWNER, { managerApprovalLimit: 300000 }) })
add("settings save: manager changes a policy toggle (limits omitted)", "ALLOW", { ...sUpd(MANAGER, { sealOffersUntilDeadline: false, buyerReceives: true }) })
add("settings save: finance changes replyWindowDays", "ALLOW", { ...sUpd(FINANCE, { replyWindowDays: 2 }) })
add("settings first save (create): owner", "ALLOW", { uid: OWNER, method: "create", path: SP, after: settings })
const { managerApprovalLimit: _m, buyerSelfIssueLimit: _b, directPurchaseCap: _d, overReceiptTolerancePercent: _o, ...noLimits } = settings
add("settings first save (create): manager, owner-only limits omitted as the client does", "ALLOW", { uid: MANAGER, method: "create", path: SP, after: noLimits })
add("settings: manager changes managerApprovalLimit", "DENY", { ...sUpd(MANAGER, { managerApprovalLimit: 999999 }) })
add("settings: manager changes buyerSelfIssueLimit", "DENY", { ...sUpd(MANAGER, { buyerSelfIssueLimit: 99999 }) })
add("settings: manager first save WITH the limits", "DENY", { uid: MANAGER, method: "create", path: SP, after: settings })
add("settings: buyer (offers.accept)", "DENY", { ...sUpd(BUYER, { replyWindowDays: 3 }) })
add("settings: expediter", "DENY", { ...sUpd(uidOf("expediter"), { replyWindowDays: 3 }) })
add("settings: foreign owner writes our org's settings", "DENY", { ...sUpd(OTHER_OWNER, { replyWindowDays: 3 }) })
add("settings: organizationId rewritten", "DENY", { uid: OWNER, method: "update", path: SP, before: settings, after: { ...settings, organizationId: OTHER_ORG } })
add("settings read: any member", "ALLOW", { uid: uidOf("viewer"), method: "get", path: SP, before: settings })
add("settings read: foreign member", "DENY", { uid: "u_foreign", method: "get", path: SP, before: settings })

const RV = "procurementReceivers/r1"
const rcvDoc = (uid: string, over: Data = {}): Data => ({ name: "Khalid", title: "Storekeeper", module: "inventory", phone: "0500000000", userId: null, warehouseIds: ["w1"], organizationId: ORG, active: true, createdAt: T1, createdById: uid, updatedAt: T1, ...over })
for (const [label, uid] of [["owner", OWNER], ["buyer", BUYER], ["manager", MANAGER]] as const) add(`receiver register add: ${label}`, "ALLOW", { uid, method: "create", path: RV, after: rcvDoc(uid) })
add("receiver register add: a store keeper (deliveries.confirm) cannot add himself", "DENY", { uid: uidOf("receiver"), method: "create", path: RV, after: rcvDoc(uidOf("receiver")) })
add("receiver register add: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: RV, after: rcvDoc(uidOf("expediter")) })
add("receiver register add: unknown module", "DENY", { uid: BUYER, method: "create", path: RV, after: rcvDoc(BUYER, { module: "hr" }) })
add("receiver register add: born inactive", "DENY", { uid: BUYER, method: "create", path: RV, after: rcvDoc(BUYER, { active: false }) })
add("receiver register add: createdById names someone else", "DENY", { uid: BUYER, method: "create", path: RV, after: rcvDoc(OWNER) })
add("receiver register add: into another company", "DENY", { uid: BUYER, method: "create", path: RV, after: rcvDoc(BUYER, { organizationId: OTHER_ORG }) })
add("receiver register add: phone empty", "DENY", { uid: BUYER, method: "create", path: RV, after: rcvDoc(BUYER, { phone: "" }) })
const rcv0 = rcvDoc(OWNER)
add("receiver register correct (updateReceiver): buyer", "ALLOW", { uid: BUYER, method: "update", path: RV, before: rcv0, after: { ...rcv0, name: "Khaled", phone: "0511111111", warehouseIds: ["w1", "w2"], updatedAt: T1 } })
add("receiver register retire (setReceiverActive): manager", "ALLOW", { uid: MANAGER, method: "update", path: RV, before: rcv0, after: { ...rcv0, active: false, updatedAt: T1 } })
add("receiver register correct: store keeper", "DENY", { uid: uidOf("receiver"), method: "update", path: RV, before: rcv0, after: { ...rcv0, name: "X" } })
add("receiver register correct: createdById rewritten", "DENY", { uid: BUYER, method: "update", path: RV, before: rcv0, after: { ...rcv0, createdById: BUYER } })
add("receiver register correct: foreign member", "DENY", { uid: "u_foreign", method: "update", path: RV, before: rcv0, after: { ...rcv0, name: "X" } })
add("receiver register read: any member", "ALLOW", { uid: uidOf("viewer"), method: "get", path: RV, before: rcv0 })
add("receiver register delete: owner", "DENY", { uid: OWNER, method: "delete", path: RV, before: rcv0 })

const SR = `supplierRecords/${ORG}__${SUP_ORG}`
const srec = (uid: string, over: Data = {}): Data => ({ organizationId: ORG, supplierOrgId: SUP_ORG, supplierName: "Supplier", kind: "mat", source: "directory", vatNumber: "300000000000003", crExpiry: null, paymentTermsDays: 30, leadTimeDays: null, verified: false, addedById: uid, addedByName: uid, addedAt: T1, log: [{ action: "added", at: T1, byId: uid, byName: uid }], ...over })
const LINKS: Ov = {}
add("supplier record add from the directory (addFromDirectory): buyer", "ALLOW", { uid: BUYER, method: "create", path: SR, after: srec(BUYER) })
add("supplier record add from the directory: manager", "ALLOW", { uid: MANAGER, method: "create", path: SR, after: srec(MANAGER) })
add("supplier record add from the directory: owner", "ALLOW", { uid: OWNER, method: "create", path: SR, after: srec(OWNER) })
add("supplier record add: born verified by a buyer", "DENY", { uid: BUYER, method: "create", path: SR, after: srec(BUYER, { verified: true }) })
add("supplier record add: suppliers.manage only (seeded expediter reads)", "DENY", { uid: uidOf("suppliersManage"), method: "create", path: SR, after: srec(uidOf("suppliersManage")) })
add("supplier record add: wrong document id", "DENY", { uid: BUYER, method: "create", path: `supplierRecords/${ORG}__other`, after: srec(BUYER) })
add("supplier record add: addedById names someone else", "DENY", { uid: BUYER, method: "create", path: SR, after: srec(OWNER) })
const sr0 = srec(BUYER)
const verified = (uid: string) => ({ ...sr0, verified: true, verifiedById: uid, verifiedByName: uid, verifiedAt: T1, log: [...sr0.log, { action: "verified", at: T1, byId: uid, byName: uid }] })
add("supplier verify (verifySupplier): manager", "ALLOW", { uid: MANAGER, method: "update", path: SR, before: sr0, after: verified(MANAGER) })
add("supplier verify: owner", "ALLOW", { uid: OWNER, method: "update", path: SR, before: sr0, after: verified(OWNER) })
add("supplier verify: buyer (client refuses too)", "DENY", { uid: BUYER, method: "update", path: SR, before: sr0, after: verified(BUYER) })
add("supplier record edit (saveSupplierRecord): manager", "ALLOW", { uid: MANAGER, method: "update", path: SR, before: sr0, after: { ...sr0, vatNumber: "300000000000004", paymentTermsDays: 45, log: [...sr0.log, { action: "record_updated", at: T1, byId: MANAGER, byName: "m" }] } })
add("supplier record create via saveSupplierRecord (source link): manager", "ALLOW", { uid: MANAGER, method: "create", path: SR, after: srec(MANAGER, { source: "link", verified: undefined, log: [{ action: "record_updated", at: T1, byId: MANAGER, byName: "m" }] }) })
add("supplier record edit: supplierOrgId rewritten", "DENY", { uid: MANAGER, method: "update", path: SR, before: sr0, after: { ...sr0, supplierOrgId: SUP2_ORG } })
add("supplier favourite on (arrayUnion log entry): buyer", "ALLOW", { uid: BUYER, method: "update", path: SR, before: sr0, after: { ...sr0, log: [...sr0.log, { action: "favourite_on", at: T1, byId: BUYER, byName: "b" }] } })
add("supplier favourite: log entry names someone else", "DENY", { uid: BUYER, method: "update", path: SR, before: sr0, after: { ...sr0, log: [...sr0.log, { action: "favourite_on", at: T1, byId: OWNER, byName: "o" }] } })
add("supplier favourite: expediter", "DENY", { uid: uidOf("expediter"), method: "update", path: SR, before: sr0, after: { ...sr0, log: [...sr0.log, { action: "favourite_on", at: T1, byId: uidOf("expediter"), byName: "e" }] } })
add("supplier contact saved on send (sendPurchaseOrder → update): expediter", "ALLOW", { uid: uidOf("expediter"), method: "update", path: SR, before: sr0, after: { ...sr0, contactPhone: "0500000000", contactSavedAt: T1, contactSavedByName: "e" } })
add("supplier contact saved on send (create): expediter", "ALLOW", { uid: uidOf("expediter"), method: "create", path: SR, after: { organizationId: ORG, supplierOrgId: SUP_ORG, supplierName: "Supplier", contactEmail: "a@b.c", contactSavedAt: T1, contactSavedByName: "e" } })
add("supplier contact saved on send: receiver-only", "DENY", { uid: uidOf("receiver"), method: "update", path: SR, before: sr0, after: { ...sr0, contactPhone: "0500000000", contactSavedAt: T1, contactSavedByName: "r" } })
add("supplier record read: any member", "ALLOW", { uid: uidOf("viewer"), method: "get", path: SR, before: sr0 })
add("supplier directory link (contractorSupplierLinks create): buyer", "ALLOW", { uid: BUYER, method: "create", path: "contractorSupplierLinks/l1", after: { contractorOrgId: ORG, supplierOrgId: SUP_ORG, supplierName: "S", supplierCategories: [], status: "active", requestedBy: "contractor_directory", requestedAt: T1, connectedAt: T1, updatedAt: T1 } })
add("supplier directory link: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: "contractorSupplierLinks/l1", after: { contractorOrgId: ORG, supplierOrgId: SUP_ORG, status: "active", requestedBy: "contractor_directory" } })

const AG = "priceAgreements/ag1"
const agDoc = (uid: string, over: Data = {}): Data => ({ organizationId: ORG, docNumber: "AG-2026/001", supplierOrgId: SUP_ORG, supplierName: "S", from: "2026-10-01", until: "2026-12-31", lines: [{ name: "Rebar", unit: "ton", price: 90 }], note: null, preparedById: uid, preparedByName: uid, createdAt: T1, endedAt: null, log: [{ action: "created", at: T1, byId: uid, byName: uid }], updatedAt: T1, ...over })
for (const [label, uid] of [["owner", OWNER], ["buyer", BUYER], ["manager", MANAGER]] as const) add(`price agreement sign: ${label}`, "ALLOW", { uid, method: "create", path: AG, after: agDoc(uid) })
add("price agreement sign: expediter", "DENY", { uid: uidOf("expediter"), method: "create", path: AG, after: agDoc(uidOf("expediter")) })
add("price agreement sign: no lines", "DENY", { uid: BUYER, method: "create", path: AG, after: agDoc(BUYER, { lines: [] }) })
add("price agreement sign: until before from", "DENY", { uid: BUYER, method: "create", path: AG, after: agDoc(BUYER, { until: "2026-09-01" }) })
add("price agreement sign: into another company", "DENY", { uid: BUYER, method: "create", path: AG, after: agDoc(BUYER, { organizationId: OTHER_ORG }) })
const ag0 = agDoc(BUYER)
add("price agreement renew: manager", "ALLOW", { uid: MANAGER, method: "update", path: AG, before: ag0, after: { ...ag0, until: "2027-03-31", lines: [{ name: "Rebar", unit: "ton", price: 88 }], endedAt: null, log: [...ag0.log, { action: "renewed", at: T1, byId: MANAGER, byName: "m" }], updatedAt: T1 } })
add("price agreement end early: owner", "ALLOW", { uid: OWNER, method: "update", path: AG, before: ag0, after: { ...ag0, endedAt: T1, log: [...ag0.log, { action: "ended", at: T1, byId: OWNER, byName: "o" }], updatedAt: T1 } })
add("price agreement renew: buyer (client refuses too: manager only)", "DENY", { uid: BUYER, method: "update", path: AG, before: ag0, after: { ...ag0, until: "2027-03-31" } })
add("price agreement renew: docNumber rewritten", "DENY", { uid: MANAGER, method: "update", path: AG, before: ag0, after: { ...ag0, docNumber: "AG-2026/999" } })
add("price agreement renew: supplier rewritten", "DENY", { uid: MANAGER, method: "update", path: AG, before: ag0, after: { ...ag0, supplierOrgId: SUP2_ORG } })

const PH = "priceHistory/po1__l1"
const phRow = { organizationId: ORG, materialKey: "rebar|ton", name: "Rebar", unit: "ton", supplierOrgId: SUP_ORG, supplierName: "S", price: 100, day: "2026-10-08", kind: "po", poId: "po1", poNumber: "PO-2026/001" }
add("price history row at approval: manager", "ALLOW", { uid: MANAGER, method: "create", path: PH, after: phRow })
add("price history row at approval: owner", "ALLOW", { uid: OWNER, method: "create", path: PH, after: phRow })
add("price history row at approval: retried approval rewrites its row", "ALLOW", { uid: MANAGER, method: "update", path: PH, before: phRow, after: { ...phRow, price: 100 } })
add("price history row: variance row after a hold decision (decideHold): buyer", "ALLOW", { uid: BUYER, method: "create", path: "priceHistory/po1__l1__h1", after: { ...phRow, kind: "variance", price: 110 } })
add("price history row: price 0", "DENY", { uid: MANAGER, method: "create", path: PH, after: { ...phRow, price: 0 } })
add("price history row: into another company", "DENY", { uid: MANAGER, method: "create", path: PH, after: { ...phRow, organizationId: OTHER_ORG } })
add("price history row: rewriting the day", "DENY", { uid: MANAGER, method: "update", path: PH, before: phRow, after: { ...phRow, day: "2026-01-01" } })
add("price history row: delete", "DENY", { uid: OWNER, method: "delete", path: PH, before: phRow })
const MP = "mfgProducts/mp1"
const prod = { organizationId: ORG, name: "Rebar", unit: "ton", archived: false }
add("make-or-buy reference price (shareReferencePrices): manager", "ALLOW", { uid: MANAGER, method: "update", path: MP, before: prod, after: { ...prod, referenceBuyPrice: 100, referenceBuyAt: T1, referenceBuyPo: "PO-2026/001", updatedAt: T1 } })
add("make-or-buy reference price: buyer", "ALLOW", { uid: BUYER, method: "update", path: MP, before: prod, after: { ...prod, referenceBuyPrice: 100, referenceBuyAt: T1, referenceBuyPo: "PO-2026/001", updatedAt: T1 } })
add("make-or-buy reference price: receiver-only", "DENY", { uid: uidOf("receiver"), method: "update", path: MP, before: prod, after: { ...prod, referenceBuyPrice: 100, referenceBuyAt: T1, referenceBuyPo: "x", updatedAt: T1 } })
add("make-or-buy reference price: also renames the product", "DENY", { uid: MANAGER, method: "update", path: MP, before: prod, after: { ...prod, name: "Other", referenceBuyPrice: 100, referenceBuyAt: T1, referenceBuyPo: "x", updatedAt: T1 } })

// ---------------------------------------------------------------------------------------------------------------
// A project's purchase requests, seen from Procurement (legacy, non-PM requests and the PM links)
// ---------------------------------------------------------------------------------------------------------------
const PR = "projects/p1/purchaseRequests/req1"
const PRW: Ov = { "projects/p1": { organizationId: ORG, name: "P1" } }
const reqDoc = (over: Data = {}): Data => ({ title: "Cement", items: [{ name: "Cement", quantity: 10, unit: "bag" }], notes: null, status: "pending", requestedByUserId: "u_viewer", requestedByUserName: "v", createdAt: T0, updatedAt: T0, ...over })
add("project request file (fileProjectRequest): any member (viewer)", "ALLOW", { uid: uidOf("viewer"), method: "create", path: PR, after: reqDoc(), ov: PRW })
add("project request file: foreign member", "DENY", { uid: "u_foreign", method: "create", path: PR, after: reqDoc({ requestedByUserId: "u_foreign" }), ov: PRW })
add("project request file: requestedByUserId names someone else", "DENY", { uid: uidOf("viewer"), method: "create", path: PR, after: reqDoc({ requestedByUserId: OWNER }), ov: PRW })
add("project request file: born approved", "DENY", { uid: uidOf("viewer"), method: "create", path: PR, after: reqDoc({ status: "approved" }), ov: PRW })
const dec = (ok: boolean) => ({ status: ok ? "approved" : "rejected", decidedByUserId: uidOf("warehouse"), decidedByUserName: "w", decidedAt: T1, updatedAt: T1 })
add("project request approve (decideProjectRequest): warehouse manager", "ALLOW", { uid: uidOf("warehouse"), method: "update", path: PR, before: reqDoc(), after: { ...reqDoc(), ...dec(true) }, ov: PRW })
add("project request reject: warehouse manager", "ALLOW", { uid: uidOf("warehouse"), method: "update", path: PR, before: reqDoc(), after: { ...reqDoc(), ...dec(false) }, ov: PRW })
add("project request approve: supply chain (warehouses.manage)", "ALLOW", { uid: uidOf("supply"), method: "update", path: PR, before: reqDoc(), after: { ...reqDoc(), ...dec(true) }, ov: PRW })
add("project request approve: owner", "ALLOW", { uid: OWNER, method: "update", path: PR, before: reqDoc(), after: { ...reqDoc(), ...dec(true) }, ov: PRW })
add("project request approve: a buyer without warehouses.manage", "DENY", { uid: BUYER, method: "update", path: PR, before: reqDoc(), after: { ...reqDoc(), ...dec(true) }, ov: PRW })
add("project request approve: PM request is the project manager's", "DENY", { uid: uidOf("warehouse"), method: "update", path: PR, before: reqDoc({ pm: true }), after: { ...reqDoc({ pm: true }), ...dec(true) }, ov: PRW })
const appr = reqDoc({ status: "approved" })
const linkRfq = { rfqId: "rfq9", rfqNumber: null, orderedAt: T1, orderedByName: "b", updatedAt: T1 }
const linkPo = { poId: "po9", poNumber: "PO-2026/009", orderedAt: T1, orderedByName: "b", updatedAt: T1 }
for (const [label, uid] of [["buyer", BUYER], ["supply chain", uidOf("supply")], ["rfq.create-only", uidOf("rfqCreate")], ["owner", OWNER]] as const) {
  add(`need ↔ RFQ link (linkNeed rfq): ${label}`, "ALLOW", { uid, method: "update", path: PR, before: appr, after: { ...appr, ...linkRfq }, ov: PRW })
  add(`need ↔ order link (linkNeed po, order placed without an RFQ): ${label}`, "ALLOW", { uid, method: "update", path: PR, before: appr, after: { ...appr, ...linkPo }, ov: PRW })
}
add("need link: a viewer", "DENY", { uid: uidOf("viewer"), method: "update", path: PR, before: appr, after: { ...appr, ...linkRfq }, ov: PRW })
add("need link: request not approved yet", "DENY", { uid: BUYER, method: "update", path: PR, before: reqDoc(), after: { ...reqDoc(), ...linkRfq }, ov: PRW })
add("need link: already linked to an RFQ", "DENY", { uid: BUYER, method: "update", path: PR, before: { ...appr, rfqId: "rfq1" }, after: { ...appr, rfqId: "rfq9", orderedAt: T1, orderedByName: "b", updatedAt: T1 }, ov: PRW })
add("need link: foreign member", "DENY", { uid: "u_foreign", method: "update", path: PR, before: appr, after: { ...appr, ...linkRfq }, ov: PRW })
const DRAFT_RFQ: Ov = { ...PRW, "rfqs/rfq1": rfqDoc({ status: "Draft" }) }
const unl = { ...appr, rfqId: "rfq1", rfqNumber: null, orderedAt: T1, orderedByName: "b" }
const { rfqId: _r1, rfqNumber: _r2, orderedAt: _r3, orderedByName: _r4, ...unlinked } = unl
add("need unlink when a draft RFQ is deleted (unlinkNeedsFromRfq): buyer", "ALLOW", { uid: BUYER, method: "update", path: PR, before: unl, after: { ...unlinked, updatedAt: T1 }, ov: DRAFT_RFQ })
add("need unlink: the RFQ is no longer a draft", "DENY", { uid: BUYER, method: "update", path: PR, before: unl, after: { ...unlinked, updatedAt: T1 }, ov: { ...PRW, "rfqs/rfq1": rfqDoc({ status: "New" }) } })
add("award writes the order on the request (linkServedRequests): buyer", "ALLOW", { uid: BUYER, method: "update", path: PR, before: { ...appr, rfqId: "rfq1" }, after: { ...appr, rfqId: "rfq1", poId: "po9", poNumber: "PO-2026/009", updatedAt: T1 }, ov: { ...PRW, "purchaseOrders/po9": po({ rfqId: "rfq1" }) } })
add("award writes the order on the request: the order names another RFQ", "DENY", { uid: BUYER, method: "update", path: PR, before: { ...appr, rfqId: "rfq1" }, after: { ...appr, rfqId: "rfq1", poId: "po9", poNumber: "PO-2026/009", updatedAt: T1 }, ov: { ...PRW, "purchaseOrders/po9": po({ rfqId: "rfqOther" }) } })
add("procurement decision «buy» without asking the workshop (recordNeedDecision): buyer", "ALLOW", { uid: BUYER, method: "update", path: PR, before: appr, after: { ...appr, procDecision: { kind: "buy", at: T1, byName: "b" }, updatedAt: T1 }, ov: PRW })
add("procurement decision «buy»: second decision", "DENY", { uid: BUYER, method: "update", path: PR, before: { ...appr, procDecision: { kind: "buy", at: T0, byName: "b" } }, after: { ...appr, procDecision: { kind: "buy", at: T1, byName: "b2" }, updatedAt: T1 }, ov: PRW })
add("procurement decision «buy»: rfq.manage-only member (client: canPrepare needed)", "DENY", { uid: uidOf("supply"), method: "update", path: PR, before: appr, after: { ...appr, procDecision: { kind: "buy", at: T1, byName: "s" }, updatedAt: T1 }, ov: PRW })
const pmReq = reqDoc({ status: "approved", pm: true, requestedByUserId: "u_site", lines: [{ name: "x" }] })
add("PM request line link (lineLinks.<n>, linkNeed with source.line): buyer", "ALLOW", { uid: BUYER, method: "update", path: PR, before: pmReq, after: { ...pmReq, lineLinks: { "0": { rfqId: "rfq9", orderedAt: T1, orderedByName: "b" } }, updatedAt: T1 }, ov: { ...PMW } })
add("PM request line link: two lines at once", "DENY", { uid: BUYER, method: "update", path: PR, before: pmReq, after: { ...pmReq, lineLinks: { "0": { rfqId: "rfq9" }, "1": { rfqId: "rfq9" } }, updatedAt: T1 }, ov: { ...PMW } })

// ---------------------------------------------------------------------------------------------------------------
// Not reachable from a client (the server owns them)
// ---------------------------------------------------------------------------------------------------------------
for (const col of ["guestOfferLinks", "rfqShareLinks", "receiptLinks"]) {
  add(`${col}: owner reads`, "DENY", { uid: OWNER, method: "get", path: `${col}/t1`, before: { token: "x" } })
  add(`${col}: owner writes`, "DENY", { uid: OWNER, method: "create", path: `${col}/t1`, after: { token: "x" } })
}

// ---------------------------------------------------------------------------------------------------------------
// Runner. Same evaluation as scripts/rules-sim/sim.ts (the real rules through :test, every get()/exists() answered
// from `overrides` or, failing that, read live from UAT), but BATCHED: one :test request carries many cases (the
// ruleset is compiled once per request, ~25 s), and the documents the case is known to read are mocked up front
// so most cases settle in one round.
// ---------------------------------------------------------------------------------------------------------------
const ROOT = "/databases/(default)/documents/"
const { db } = openUatDb()
const liveCache = new Map<string, Data | null>()
const plain = (v: unknown): unknown => {
  if (v === null || typeof v !== "object") return v
  if (Array.isArray(v)) return v.map(plain)
  const o = v as { toDate?: () => Date }
  if (typeof o.toDate === "function") return o.toDate().toISOString()
  return Object.fromEntries(Object.entries(v as Data).map(([k, x]) => [k, plain(x)]))
}
async function live(p: string): Promise<Data | null> {
  if (!liveCache.has(p)) {
    const snap = await db.doc(p).get()
    liveCache.set(p, snap.exists ? (plain(snap.data()) as Data) : null)
  }
  return liveCache.get(p) ?? null
}
const rulesSource = fs.readFileSync(process.env.RULES_FILE ?? nodePath.join(process.cwd(), "firestore.rules"), "utf8")
const token = () => cp.execSync("gcloud auth print-access-token", { encoding: "utf8", env: process.env }).trim()
const decode = (p: string) => decodeURIComponent(p).replace("/databases/(default)/documents/", "")

interface Settled { got: "ALLOW" | "DENY"; detail: string; reads: string[]; errored: boolean }
interface Pending { c: RuleCase; known: Map<string, Data | null>; out?: Settled; rounds: number }

const mocksOf = (known: Map<string, Data | null>) =>
  [...known].flatMap(([p, d]) => {
    const value = d === null ? { undefined: {} } : { value: { data: d } }
    return [
      { function: "exists", args: [{ exactValue: ROOT + p }], result: { value: d !== null } },
      { function: "get", args: [{ exactValue: ROOT + p }], result: value },
      { function: "existsAfter", args: [{ exactValue: ROOT + p }], result: { value: d !== null } },
      { function: "getAfter", args: [{ exactValue: ROOT + p }], result: value },
    ]
  })

const caseBody = (c: RuleCase, known: Map<string, Data | null>) => ({
  expectation: "ALLOW",
  request: { auth: c.uid ? { uid: c.uid, token: {} } : null, path: ROOT + c.path, method: c.method, ...(c.after ? { resource: { data: c.after } } : {}) },
  ...(c.before ? { resource: { data: c.before } } : c.method === "create" ? { resource: null } : {}),
  functionMocks: mocksOf(known),
})

async function callBatch(batch: Pending[]): Promise<Array<{ state: string; debugMessages?: string[]; functionCalls?: Array<{ function: string; args: string[] }> }>> {
  const body = JSON.stringify({ source: { files: [{ name: "firestore.rules", content: rulesSource }] }, testSuite: { testCases: batch.map((p) => caseBody(p.c, p.known)) } })
  let last = "rules test failed"
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${UAT_PROJECT}:test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "x-goog-user-project": UAT_PROJECT, "Content-Type": "application/json" },
        body,
      })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = { error: { message: `HTTP ${res.status}` } } }
      if (json.testResults && json.testResults.length === batch.length) return json.testResults
      last = json.error?.message ?? last
      if (/authentication credentials/i.test(last)) tokenCache.v = undefined
    } catch (e) {
      last = (e as Error).message
    }
    await new Promise((r) => setTimeout(r, Math.min(3000 * (attempt + 1), 20000)))
  }
  throw new Error(last)
}

const relevantMocks = (c: RuleCase): Map<string, Data | null> => {
  const known = new Map<string, Data | null>()
  const ov = c.overrides || {}
  const u = c.uid ? ov[`users/${c.uid}`] : null
  for (const [p, d] of Object.entries(ov)) {
    if (!p.startsWith("users/") && !p.startsWith("teamGroups/")) known.set(p, d)
  }
  if (c.uid && u) {
    known.set(`users/${c.uid}`, u)
    const g = (u as Data).defaultGroupId
    if (typeof g === "string" && ov[`teamGroups/${g}`]) known.set(`teamGroups/${g}`, ov[`teamGroups/${g}`])
  } else if (c.uid) known.set(`users/${c.uid}`, ov[`users/${c.uid}`] ?? null)
  return known
}

async function runAll(list: RuleCase[]): Promise<number> {
  const only = process.env.ONLY
  const onlyRe = process.env.ONLYRE ? new RegExp(process.env.ONLYRE, "i") : null
  const todo = (onlyRe ? list.filter((c) => onlyRe.test(c.name)) : only ? list.filter((c) => c.name.toLowerCase().includes(only.toLowerCase())) : list).map<Pending>((c) => ({ c, known: relevantMocks(c), rounds: 0 }))
  const BATCH = Number(process.env.BATCH || 30)
  const CONC = Number(process.env.CONC || 3)
  let queue = [...todo]
  const chunks: Pending[][] = []
  const runRound = async (pending: Pending[]) => {
    for (let i = 0; i < pending.length; i += BATCH) chunks.push(pending.slice(i, i + BATCH))
    let k = 0
    const worker = async () => {
      for (;;) {
        const my = k++
        if (my >= chunks.length) return
        const batch = chunks[my]
        const results = await callBatch(batch)
        for (let j = 0; j < batch.length; j++) {
          const r = results[j]
          const p = batch[j]
          p.rounds++
          const wanted = [...new Set((r.functionCalls ?? []).map((f) => decode(f.args[0])))].filter((x) => !p.known.has(x))
          const msgs = (r.debugMessages ?? []).join(" | ")
          if (r.state === "SUCCESS" || wanted.length === 0 || p.rounds >= 10) {
            p.out = { got: r.state === "SUCCESS" ? "ALLOW" : "DENY", detail: msgs.slice(0, 400) + ` {visited=${((r as any).visitedExpressions ?? []).length}}`, reads: [...p.known.keys()], errored: /Error/.test(msgs) }
          } else {
            for (const x of wanted) p.known.set(x, p.c.overrides && x in p.c.overrides ? p.c.overrides[x] : await live(x))
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker))
    chunks.length = 0
  }
  for (let round = 0; round < 10 && queue.length; round++) {
    await runRound(queue)
    queue = queue.filter((p) => !p.out)
    if (queue.length) console.error(`round ${round + 1}: ${queue.length} case(s) need more documents`)
  }
  let bad = 0
  for (const p of todo) {
    const got = p.out?.got ?? "DENY"
    const ok = got === p.c.expect
    if (!ok) bad++
    const d = p.out?.detail ?? ""
    const note = p.out?.errored && got === "DENY" ? (/maximum of 1000/.test(d) ? "  [LIMIT 1000 expressions]" : "  [EVAL ERROR: " + d.replace(/firestore.rules line/, "line").slice(0, 140) + "]") : ""
    if (!ok || process.env.VERBOSE || (note && process.env.ERRS)) console.log(`${ok ? "ok  " : "FAIL"} ${p.c.name}  (expected ${p.c.expect}, got ${got})${ok ? "  " + (/\{visited=\d+\}/.exec(d)?.[0] ?? "") : "  " + d}${note}`)
  }
  const lim = todo.filter((p) => p.out?.got === "DENY" && /maximum of 1000/.test(p.out.detail))
  console.log(`\n${lim.length} case(s) were refused by the 1000-expression limit (${lim.filter((p) => p.c.expect === "ALLOW").length} of them legitimate ALLOWs; the DENY ones pass for the wrong reason)`)
  console.log(`${todo.length - bad}/${todo.length} as expected`)
  return bad
}

runAll(cases).then((bad) => process.exit(bad ? 1 : 0))

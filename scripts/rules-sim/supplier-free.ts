// Supplier 1.0 (free journey) against the REAL firestore.rules (Google's :test API), UAT read-only. Users and the
// documents the rules read are synthetic (overrides). Each case is built the way the client writes it
// (src/lib/supplier-free/*-writes.ts, src/lib/procurement/supplier-acts-writes.ts).

/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { runAll, type Method, type RuleCase } from "./sim"

type Data = Record<string, any>
const BUY = "buyT"
const SUP = "supT"
const SUP2 = "sup2T"
const FIN = "finT"
const ADMIN = "adminT"

const world: Record<string, Data | null> = {
  [`users/${BUY}`]: { organizationId: BUY, role: "Contractor", organizationRole: "owner" },
  [`users/${SUP}`]: { organizationId: SUP, role: "Supplier", organizationRole: "owner" },
  [`users/${SUP2}`]: { organizationId: SUP2, role: "Supplier", organizationRole: "owner" },
  [`users/${FIN}`]: { organizationId: BUY, role: "Contractor", organizationRole: "member", defaultGroupId: "fin" },
  [`users/${ADMIN}`]: { organizationId: ADMIN, role: "Admin" },
  [`teamGroups/fin`]: { organizationId: BUY, permissions: ["invoices.manage"] },
  "purchaseOrders/po1": { organizationId: BUY, supplierOrgId: SUP, status: "sent", docNumber: "PO-T/1" },
  "purchaseOrders/poGuest": { organizationId: BUY, supplierOrgId: "guest", status: "sent", docNumber: "PO-T/2" },
  [`companyModules/${BUY}`]: null,
  [`procurementSettings/${BUY}`]: null,
}

const mk = (name: string, uid: string | null, method: Method, path: string, expect: "ALLOW" | "DENY", before?: Data, after?: Data): RuleCase => ({ name, uid, method, path, before, after, overrides: world, expect })

const transfer: Data = { poId: "po1", rfqId: "r1", supplierOrgId: SUP, buyerOrgId: BUY, amount: 1150, bank: "Rajhi", ref: "T9", state: "sent", reportedAt: "2026-10-12T00:00:00Z" }
const warranty: Data = { poId: "po1", supplierOrgId: SUP, buyerOrgId: BUY, itemName: "Roof", until: "2027-10-12", state: "wait" }
const invoice: Data = { poId: "po1", supplierOrgId: SUP, buyerOrgId: BUY, number: "INV-1", amountNet: 1000 }

const sent: Data = { organizationId: BUY, supplierOrgId: SUP, status: "sent", docNumber: "PO-T/1", log: [], createdAt: "2026-10-01T00:00:00Z", preparedById: BUY, totalExVat: 1000, vatRate: 0.15, basis: "rfq" }
const accepted: Data = { ...sent, status: "accepted", promisedDate: "2026-10-20", acceptanceRecordedBy: "supplier", deliveryReports: [] }
const report = { id: "d1", at: "2026-10-18T00:00:00Z", date: "2026-10-18", note: null, byId: SUP, byName: "S", reminders: [] }

const cases: RuleCase[] = [
  // ---- companyPlans
  mk("plan: admin sets a plan", ADMIN, "create", `companyPlans/${SUP}`, "ALLOW", undefined, { organizationId: SUP, supplierPlan: "free" }),
  mk("plan: admin cannot set an unknown plan", ADMIN, "create", `companyPlans/${SUP}`, "DENY", undefined, { organizationId: SUP, supplierPlan: "gold" }),
  mk("plan: the supplier cannot set his own plan", SUP, "create", `companyPlans/${SUP}`, "DENY", undefined, { organizationId: SUP, supplierPlan: "full" }),
  mk("plan: the company reads its own", SUP, "get", `companyPlans/${SUP}`, "ALLOW", { supplierPlan: "free" }),
  mk("plan: another company cannot read it", SUP2, "get", `companyPlans/${SUP}`, "DENY", { supplierPlan: "free" }),

  // ---- supplierInvoices (server-only writes)
  mk("invoice: the supplier cannot create one from the client", SUP, "create", "supplierInvoices/i1", "DENY", undefined, invoice),
  mk("invoice: the buyer cannot create one either", BUY, "create", "supplierInvoices/i1", "DENY", undefined, invoice),
  mk("invoice: the supplier reads his", SUP, "get", "supplierInvoices/i1", "ALLOW", invoice),
  mk("invoice: the buyer reads it", BUY, "get", "supplierInvoices/i1", "ALLOW", invoice),
  mk("invoice: a stranger cannot read it", SUP2, "get", "supplierInvoices/i1", "DENY", invoice),
  mk("invoice: nobody edits it", SUP, "update", "supplierInvoices/i1", "DENY", invoice, { ...invoice, amountNet: 1 }),
  mk("invoice: nobody deletes it", SUP, "delete", "supplierInvoices/i1", "DENY", invoice),

  // ---- supplierTransfers
  mk("transfer: the buyer's owner reports one", BUY, "create", "supplierTransfers/t1", "ALLOW", undefined, transfer),
  mk("transfer: Finance (invoices.manage) reports one", FIN, "create", "supplierTransfers/t1", "ALLOW", undefined, transfer),
  mk("transfer: the supplier cannot report one", SUP, "create", "supplierTransfers/t1", "DENY", undefined, transfer),
  mk("transfer: a zero amount is refused", BUY, "create", "supplierTransfers/t1", "DENY", undefined, { ...transfer, amount: 0 }),
  mk("transfer: it cannot start as already confirmed", BUY, "create", "supplierTransfers/t1", "DENY", undefined, { ...transfer, state: "ok" }),
  mk("transfer: the order's supplier must match", BUY, "create", "supplierTransfers/t1", "DENY", undefined, { ...transfer, supplierOrgId: SUP2 }),
  mk("transfer: the supplier confirms it arrived", SUP, "update", "supplierTransfers/t1", "ALLOW", transfer, { ...transfer, state: "ok", confirmedAt: "x", confirmedById: SUP, updatedAt: "x" }),
  mk("transfer: the supplier says it did not arrive", SUP, "update", "supplierTransfers/t1", "ALLOW", transfer, { ...transfer, state: "miss", note: "n", confirmedAt: "x", confirmedById: SUP, updatedAt: "x" }),
  mk("transfer: a missing one arrives later", SUP, "update", "supplierTransfers/t1", "ALLOW", { ...transfer, state: "miss" }, { ...transfer, state: "ok", arrivedLater: true, confirmedAt: "x", confirmedById: SUP, updatedAt: "x" }),
  mk("transfer: a confirmed one is final", SUP, "update", "supplierTransfers/t1", "DENY", { ...transfer, state: "ok" }, { ...transfer, state: "miss", updatedAt: "x" }),
  mk("transfer: the supplier cannot change the amount", SUP, "update", "supplierTransfers/t1", "DENY", transfer, { ...transfer, state: "ok", amount: 5, updatedAt: "x" }),
  mk("transfer: the buyer cannot confirm his own", BUY, "update", "supplierTransfers/t1", "DENY", transfer, { ...transfer, state: "ok", updatedAt: "x" }),
  mk("transfer: nobody deletes it", BUY, "delete", "supplierTransfers/t1", "DENY", transfer),

  // ---- supplierWarranties
  mk("warranty: the order's supplier registers one", SUP, "create", "supplierWarranties/w1", "ALLOW", undefined, warranty),
  mk("warranty: another supplier cannot register on the order", SUP2, "create", "supplierWarranties/w1", "DENY", undefined, { ...warranty, supplierOrgId: SUP2 }),
  mk("warranty: it cannot be born accepted", SUP, "create", "supplierWarranties/w1", "DENY", undefined, { ...warranty, state: "ok" }),
  mk("warranty: the buyer's owner accepts it", BUY, "update", "supplierWarranties/w1", "ALLOW", warranty, { ...warranty, state: "ok", acceptedAt: "x", acceptedById: BUY, updatedAt: "x" }),
  mk("warranty: the supplier cannot accept his own", SUP, "update", "supplierWarranties/w1", "DENY", warranty, { ...warranty, state: "ok", updatedAt: "x" }),
  mk("warranty: acceptance is final", BUY, "update", "supplierWarranties/w1", "DENY", { ...warranty, state: "ok" }, { ...warranty, state: "wait", updatedAt: "x" }),
  mk("warranty: the buyer cannot rewrite the terms", BUY, "update", "supplierWarranties/w1", "DENY", warranty, { ...warranty, state: "ok", until: "2099-01-01", updatedAt: "x" }),

  // ---- supplierWorkspace
  mk("workspace: a member reads his company's", SUP, "get", `supplierWorkspace/${SUP}`, "ALLOW", { organizationId: SUP }),
  mk("workspace: another company cannot", SUP2, "get", `supplierWorkspace/${SUP}`, "DENY", { organizationId: SUP }),
  mk("workspace: a member writes his company's", SUP, "create", `supplierWorkspace/${SUP}`, "ALLOW", undefined, { organizationId: SUP, seen: {} }),
  mk("workspace: nobody writes another company's", SUP2, "update", `supplierWorkspace/${SUP}`, "DENY", { organizationId: SUP }, { organizationId: SUP, seen: {} }),
  mk("workspace: no listing", SUP, "list", "supplierWorkspace/x", "DENY"),

  // ---- the supplier's acts on his order
  mk("order: he accepts with a date and a note", SUP, "update", "purchaseOrders/po1", "ALLOW", sent, { ...sent, status: "accepted", supplierAcceptedAt: "x", promisedDate: "2026-10-20", acceptanceRecordedBy: "supplier", supplierAcceptNote: "ok", log: [{}], updatedAt: "x" }),
  mk("order: he declines with a reason", SUP, "update", "purchaseOrders/po1", "ALLOW", sent, { ...sent, status: "cancelled", cancelledReason: "no stock", closedAt: "x", supplierDecline: { at: "x", reason: "stock", byId: SUP, byName: "S" }, log: [{}], updatedAt: "x" }),
  mk("order: a decline needs a known reason", SUP, "update", "purchaseOrders/po1", "DENY", sent, { ...sent, status: "cancelled", cancelledReason: "x", closedAt: "x", supplierDecline: { at: "x", reason: "mood", byId: SUP, byName: "S" }, log: [{}], updatedAt: "x" }),
  mk("order: a decline needs a stated reason", SUP, "update", "purchaseOrders/po1", "DENY", sent, { ...sent, status: "cancelled", cancelledReason: "", closedAt: "x", supplierDecline: { at: "x", reason: "stock", byId: SUP, byName: "S" }, log: [{}], updatedAt: "x" }),
  mk("order: he reports a delivery on an accepted order", SUP, "update", "purchaseOrders/po1", "ALLOW", accepted, { ...accepted, deliveryReports: [report], log: [{}], updatedAt: "x" }),
  mk("order: a report cannot remove an earlier one", SUP, "update", "purchaseOrders/po1", "DENY", { ...accepted, deliveryReports: [report] }, { ...accepted, deliveryReports: [], log: [{}], updatedAt: "x" }),
  mk("order: a report cannot ride on a price change", SUP, "update", "purchaseOrders/po1", "DENY", accepted, { ...accepted, totalExVat: 1, deliveryReports: [report], log: [{}], updatedAt: "x" }),
  mk("order: he cannot report before accepting", SUP, "update", "purchaseOrders/po1", "DENY", sent, { ...sent, deliveryReports: [report], log: [{}], updatedAt: "x" }),
  mk("order: another supplier cannot decline it", SUP2, "update", "purchaseOrders/po1", "DENY", sent, { ...sent, status: "cancelled", cancelledReason: "x", closedAt: "x", supplierDecline: { at: "x", reason: "stock", byId: SUP2, byName: "S" }, log: [{}], updatedAt: "x" }),
  mk("order: a guest's order has no supplier acts", SUP, "update", "purchaseOrders/poGuest", "DENY", { ...sent, supplierOrgId: "guest" }, { ...sent, supplierOrgId: "guest", status: "cancelled", cancelledReason: "x", closedAt: "x", supplierDecline: { at: "x", reason: "stock", byId: SUP, byName: "S" }, log: [{}], updatedAt: "x" }),
]

runAll(cases.slice(Number(process.env.FROM || 0))).then((bad) => process.exit(bad ? 1 : 0))

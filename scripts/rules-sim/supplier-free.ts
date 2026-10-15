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

  // ---- supplierTransfers and supplierWarranties: both companies read, every write is the server's
  mk("transfer: the supplier reads his", SUP, "get", "supplierTransfers/t1", "ALLOW", transfer),
  mk("transfer: the buyer reads it", BUY, "get", "supplierTransfers/t1", "ALLOW", transfer),
  mk("transfer: a stranger cannot read it", SUP2, "get", "supplierTransfers/t1", "DENY", transfer),
  mk("transfer: the buyer cannot create one from the client", BUY, "create", "supplierTransfers/t1", "DENY", undefined, transfer),
  mk("transfer: Finance cannot create one from the client", FIN, "create", "supplierTransfers/t1", "DENY", undefined, transfer),
  mk("transfer: the supplier cannot create one", SUP, "create", "supplierTransfers/t1", "DENY", undefined, transfer),
  mk("transfer: the supplier cannot answer from the client", SUP, "update", "supplierTransfers/t1", "DENY", transfer, { ...transfer, state: "ok", confirmedAt: "x", updatedAt: "x" }),
  mk("transfer: nobody deletes it", BUY, "delete", "supplierTransfers/t1", "DENY", transfer),
  mk("warranty: the supplier reads his", SUP, "get", "supplierWarranties/w1", "ALLOW", warranty),
  mk("warranty: the buyer reads it", BUY, "get", "supplierWarranties/w1", "ALLOW", warranty),
  mk("warranty: a stranger cannot read it", SUP2, "get", "supplierWarranties/w1", "DENY", warranty),
  mk("warranty: the supplier cannot create one from the client", SUP, "create", "supplierWarranties/w1", "DENY", undefined, warranty),
  mk("warranty: the buyer cannot accept from the client", BUY, "update", "supplierWarranties/w1", "DENY", warranty, { ...warranty, state: "ok", updatedAt: "x" }),

  // ---- supplierWorkspace
  mk("workspace: a member reads his company's", SUP, "get", `supplierWorkspace/${SUP}`, "ALLOW", { organizationId: SUP }),
  mk("workspace: another company cannot", SUP2, "get", `supplierWorkspace/${SUP}`, "DENY", { organizationId: SUP }),
  mk("workspace: a member writes his company's", SUP, "create", `supplierWorkspace/${SUP}`, "ALLOW", undefined, { organizationId: SUP, seen: {} }),
  mk("workspace: nobody writes another company's", SUP2, "update", `supplierWorkspace/${SUP}`, "DENY", { organizationId: SUP }, { organizationId: SUP, seen: {} }),
  mk("workspace: no listing", SUP, "list", "supplierWorkspace/x", "DENY"),

  // ---- the supplier's acts on his order: accept stays a client write; decline and reports are the server's
  mk("order: he accepts with a date and a note", SUP, "update", "purchaseOrders/po1", "ALLOW", sent, { ...sent, status: "accepted", supplierAcceptedAt: "x", promisedDate: "2026-10-20", acceptanceRecordedBy: "supplier", supplierAcceptNote: "ok", log: [{}], updatedAt: "x" }),
  mk("order: he cannot decline from the client", SUP, "update", "purchaseOrders/po1", "DENY", sent, { ...sent, status: "cancelled", cancelledReason: "no stock", closedAt: "x", supplierDecline: { at: "x", reason: "stock", byId: SUP, byName: "S" }, log: [{}], updatedAt: "x" }),
  mk("order: he cannot report a delivery from the client", SUP, "update", "purchaseOrders/po1", "DENY", accepted, { ...accepted, deliveryReports: [report], log: [{}], updatedAt: "x" }),
  mk("order: another supplier cannot accept it", SUP2, "update", "purchaseOrders/po1", "DENY", sent, { ...sent, status: "accepted", supplierAcceptedAt: "x", promisedDate: "2026-10-20", acceptanceRecordedBy: "supplier", log: [{}], updatedAt: "x" }),
  mk("order: a guest's order has no supplier acts", SUP, "update", "purchaseOrders/poGuest", "DENY", { ...sent, supplierOrgId: "guest" }, { ...sent, supplierOrgId: "guest", status: "accepted", supplierAcceptedAt: "x", promisedDate: "2026-10-20", acceptanceRecordedBy: "supplier", log: [{}], updatedAt: "x" }),
]

runAll(cases.slice(Number(process.env.FROM || 0))).then((bad) => process.exit(bad ? 1 : 0))

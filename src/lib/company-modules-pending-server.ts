import type { Firestore } from "firebase-admin/firestore"
import type { PendingByModule, PendingItem } from "@/lib/company-modules-pending"

/** What a company still has in flight inside each optional module: counts only, no names, no amounts. */
export async function loadPending(db: Firestore, orgId: string): Promise<PendingByModule> {
  const count = async (collection: string, field: string, value: string | string[]): Promise<number> => {
    const base = db.collection(collection).where("organizationId", "==", orgId)
    const snap = await (Array.isArray(value) ? base.where(field, "in", value) : base.where(field, "==", value)).count().get()
    return snap.data().count
  }

  // Equipment requests approved and not yet answered by the desk, across the company's projects.
  const projects = await db.collection("projects").where("organizationId", "==", orgId).select().limit(300).get()
  let plant = 0
  for (const p of projects.docs) {
    const reqs = await p.ref.collection("pmPlantRequests").where("status", "==", "go").get()
    plant += reqs.docs.filter((d) => !d.data().rep && !d.data().got).length
  }

  const [handover, exits, advances, payroll, notes, requests, deals, deliveries, notices] = await Promise.all([
    count("pmHandovers", "status", "wait"),
    count("hrExits", "state", "leaving"),
    db.collection("hrRequests").where("organizationId", "==", orgId).where("kind", "==", "advance").where("state", "==", "finance").count().get().then((s) => s.data().count),
    count("hrPayrolls", "state", ["prepared", "approved", "posted"]),
    count("deliveryNotes", "status", "in_transit"),
    count("manufacturingRequests", "status", "new"),
    // A supplier's CRM, Inventory and Finance (11 Oct 2026): open deals · customer deliveries not yet signed ·
    // transfers the seller reported that Finance has not answered.
    count("crmOpportunities", "stage", ["new", "qualified", "proposal", "negotiation"]),
    count("salesDeliveryNotes", "status", ["requested", "authorized", "held"]),
    count("salesTransferNotices", "status", "reported"),
  ])

  const keep = (items: PendingItem[]) => items.filter((i) => i.count > 0)
  return {
    "project-management": keep([{ key: "plant", count: plant }, { key: "handover", count: handover }]),
    hr: keep([{ key: "exits", count: exits }, { key: "advances", count: advances }, { key: "payroll", count: payroll }]),
    manufacturing: keep([{ key: "notes", count: notes }, { key: "requests", count: requests }]),
    crm: keep([{ key: "deals", count: deals }]),
    warehouses: keep([{ key: "deliveries", count: deliveries }]),
    payments: keep([{ key: "notices", count: notices }]),
  }
}

// The server's side of a package change: reads the records the planner counts. Admin SDK only; the admin account does
// not read a company's own documents, so the counting happens here. Nothing is written.

import type { Firestore } from "firebase-admin/firestore"
import { MANUFACTURING_REQUESTS } from "@/lib/sales-orders"
import { storedSites } from "./delivery-sites"
import { PROJECT_SCAN_CAP, type PackageSnapshot, type SnapshotOrder, type SnapshotProjectRequest, type SnapshotWorkshopAsk } from "./package-migration"
import type { TeamLinkedRfq, TeamRequestDoc } from "./team-requests"
import { PROCUREMENT_SETTINGS, PURCHASE_ORDERS } from "./types"

const WORKSHOP_SOURCES = new Set(["project", "procurement"])

const withId = <T>(id: string, data: Record<string, unknown> | undefined): T => ({ ...(data || {}), id }) as T

export async function loadPackageSnapshot(db: Firestore, orgId: string): Promise<PackageSnapshot> {
  const inOrg = (collection: string) => db.collection(collection).where("organizationId", "==", orgId).get()
  const [teamSnap, rfqSnap, orderSnap, askSnap, settingsSnap, warehouseSnap, projectSnap] = await Promise.all([
    inOrg("procTeamRequests"),
    inOrg("rfqs"),
    inOrg(PURCHASE_ORDERS),
    inOrg(MANUFACTURING_REQUESTS),
    db.collection(PROCUREMENT_SETTINGS).doc(orgId).get(),
    inOrg("warehouses"),
    db.collection("projects").where("organizationId", "==", orgId).limit(PROJECT_SCAN_CAP + 1).get(),
  ])

  const scanned = projectSnap.docs.slice(0, PROJECT_SCAN_CAP)
  const projectRequests: SnapshotProjectRequest[] = []
  for (const project of scanned) {
    const requests = await project.ref.collection("purchaseRequests").get()
    for (const r of requests.docs) projectRequests.push(withId<SnapshotProjectRequest>(r.id, r.data()))
  }

  return {
    teamRequests: teamSnap.docs.map((d) => withId<TeamRequestDoc>(d.id, d.data())),
    rfqs: rfqSnap.docs.map((d) => withId<TeamLinkedRfq>(d.id, d.data())),
    projectRequests,
    projects: scanned.map((p) => ({ id: p.id, name: (p.data()?.name as string | undefined) ?? null })),
    projectsCapped: projectSnap.docs.length > PROJECT_SCAN_CAP,
    orders: orderSnap.docs.map((d) => withId<SnapshotOrder>(d.id, d.data())),
    workshopAsks: askSnap.docs.map((d) => withId<SnapshotWorkshopAsk>(d.id, d.data())).filter((a) => WORKSHOP_SOURCES.has(a.sourceKind || "")),
    sites: storedSites(settingsSnap.data()?.deliverySites),
    workshopWarehouses: warehouseSnap.docs.filter((d) => d.data()?.kind === "workshop").map((d) => ({ id: d.id, name: (d.data()?.name as string | undefined) ?? null })),
  }
}

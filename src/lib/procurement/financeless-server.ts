// The server's side of a Finance-less company (PUR-10): is Finance in its package, and the
// caller allowed to mark payment («يعلّم الدفع» — the owner and the procurement manager).

import type { Firestore } from "firebase-admin/firestore"
import { COMPANY_MODULES } from "@/lib/company-modules"
import type { PermissionId } from "@/lib/permissions"

export async function financeOn(db: Firestore, orgId: string): Promise<boolean> {
  const off = (await db.collection(COMPANY_MODULES).doc(orgId).get()).data()?.off
  return !(Array.isArray(off) && off.includes("payments"))
}

/** Project Management in the package: then materials are asked for from the project, never the team's «طلب مواد». */
export async function projectsOn(db: Firestore, orgId: string): Promise<boolean> {
  const off = (await db.collection(COMPANY_MODULES).doc(orgId).get()).data()?.off
  return !(Array.isArray(off) && off.includes("project-management"))
}

export const mayMarkPayment = (can: (p: PermissionId) => boolean): boolean => can("po.approve")

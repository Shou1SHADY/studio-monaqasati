// The company's Procurement policies, read with the Admin SDK and resolved (a missing document, field or a nonsense value falls back to the
// PRD's reference value). Shared by the receipt, escalation and daily-job code so none of them re-implements the read.

import type { Firestore } from "firebase-admin/firestore"
import { resolvePolicies, type ResolvedPolicies } from "./policies"
import { PROCUREMENT_SETTINGS } from "./types"

export async function readPoliciesAdmin(db: Firestore, orgId: string): Promise<ResolvedPolicies> {
  const snap = await db.collection(PROCUREMENT_SETTINGS).doc(orgId).get()
  return resolvePolicies(snap.exists ? (snap.data() as Partial<ResolvedPolicies>) : null)
}

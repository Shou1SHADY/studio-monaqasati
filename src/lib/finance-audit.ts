import { collection, addDoc, serverTimestamp, type Firestore } from "firebase/firestore"

export type FinanceAuditAction = "ipc_submitted" | "ipc_collected" | "budget_exception_override" | "waste_threshold_exceeded" | "waste_record_reversed"

export interface FinanceAuditEntry {
  action: FinanceAuditAction
  actorId: string
  actorName: string
  targetType: "ipcClaim" | "offer" | "wasteConsumption"
  targetId: string
  amount: number
  /** Required for budget_exception_override — the written justification for exceeding budget. */
  reason?: string
  /** Extra context specific to the action (e.g. rfqTitle, supplierName, budget, projectedTotal, overageAmount). */
  meta?: Record<string, unknown>
}

export function logFinanceAudit(firestore: Firestore, projectId: string, entry: FinanceAuditEntry) {
  return addDoc(collection(firestore, "projects", projectId, "financeAuditLog"), {
    ...entry,
    createdAt: serverTimestamp(),
  }).catch((err) => console.warn("finance audit log write failed:", err?.code))
}

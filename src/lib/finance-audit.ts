import { collection, addDoc, serverTimestamp, type Firestore } from "firebase/firestore"

export type FinanceAuditAction = "ipc_submitted" | "ipc_collected"

export interface FinanceAuditEntry {
  action: FinanceAuditAction
  actorId: string
  actorName: string
  targetType: "ipcClaim"
  targetId: string
  amount: number
}

export function logFinanceAudit(firestore: Firestore, projectId: string, entry: FinanceAuditEntry) {
  return addDoc(collection(firestore, "projects", projectId, "financeAuditLog"), {
    ...entry,
    createdAt: serverTimestamp(),
  }).catch((err) => console.warn("finance audit log write failed:", err?.code))
}

"use client"

// Shared reader for a project's financeAuditLog subcollection — the project's
// single audit trail (IPC submissions/collections, budget-exception overrides,
// and future entries). One query, one sort, reused by every surface that
// displays project history instead of each screen keeping its own copy.

import { collection } from "firebase/firestore"
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase"
import type { FinanceAuditAction } from "@/lib/finance-audit"

export interface FinanceAuditLogEntry {
  id: string
  action: FinanceAuditAction
  actorId: string
  actorName: string
  targetType: "ipcClaim" | "offer"
  targetId: string
  amount: number
  reason?: string
  meta?: Record<string, unknown>
  createdAt?: unknown
}

function toMs(v: unknown): number {
  if (v && typeof v === "object" && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().getTime()
  }
  return 0
}

export function useFinanceAuditLog(projectId: string | undefined | null) {
  const firestore = useFirestore()

  const auditQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "financeAuditLog")
  }, [firestore, projectId])

  const { data, isLoading } = useCollection(auditQuery)
  const entries = ((data || []) as FinanceAuditLogEntry[]).slice().sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))

  return { entries, isLoading }
}

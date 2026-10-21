"use client"

// What Procurement says of this project's lines (Procurement 2.0, WP-S2-08): read from the stored request (`procIncoming`) so a line
// Procurement could not buy shows «تعذّر الشراء» with the reason, whatever the project's own document says. Provided once by the
// requests panel; a line asks for its own fact. Outside a provider every line reads as «nothing to add».

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { collection, query, where } from "firebase/firestore"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { procFactsOf } from "@/lib/pm/proc-state"
import type { ProcLineFact } from "@/lib/pm/supply"
import { PROC_INCOMING } from "@/lib/procurement/incoming-state"

const Facts = createContext<Map<string, ProcLineFact[]>>(new Map())

export function ProcLineProvider({ projectId, orgId, children }: { projectId: string; orgId: string; children: ReactNode }) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId && projectId ? query(collection(firestore, PROC_INCOMING), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null), [firestore, orgId, projectId])
  const { data } = useCollection(q)
  const facts = useMemo(() => procFactsOf((data || []) as Parameters<typeof procFactsOf>[0], projectId), [data, projectId])
  return <Facts.Provider value={facts}>{children}</Facts.Provider>
}

export function useProcLine(requestId: string, index: number): ProcLineFact | null {
  return useContext(Facts).get(requestId)?.[index] ?? null
}

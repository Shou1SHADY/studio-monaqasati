"use client"

// The stored incoming requests of the company (`procIncoming`, Procurement 2.0) — live. Opening a Procurement page asks the server
// to bring in what reached Procurement since (a project's approved request, a workshop shortfall) and to read the RFQs and orders
// back onto the open requests; the answer arrives through the same listener. The ask is made at most once a minute per company.

import { useEffect } from "react"
import { collection, query, where } from "firebase/firestore"
import { getAuth } from "firebase/auth"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { PROC_INCOMING, type IncomingDoc } from "@/lib/procurement/incoming-state"

const asked = new Map<string, number>()
const EVERY_MS = 60_000

export async function askForSync(orgId: string, force = false): Promise<void> {
  const last = asked.get(orgId) ?? 0
  if (!force && Date.now() - last < EVERY_MS) return
  asked.set(orgId, Date.now())
  try {
    const token = await getAuth().currentUser?.getIdToken()
    if (!token) return
    await fetch("/api/procurement/incoming", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "sync" }) })
  } catch (error) {
    console.warn("incoming sync failed:", error)
  }
}

export function useIncomingDocs(orgId: string | null | undefined, enabled = true): { docs: IncomingDoc[]; loading: boolean } {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId && enabled ? query(collection(firestore, PROC_INCOMING), where("organizationId", "==", orgId)) : null), [firestore, orgId, enabled])
  const { data, isLoading } = useCollection(q)
  useEffect(() => {
    if (orgId && enabled) void askForSync(orgId)
  }, [orgId, enabled])
  return { docs: (data || []) as IncomingDoc[], loading: isLoading }
}

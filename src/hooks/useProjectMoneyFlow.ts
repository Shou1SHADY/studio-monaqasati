"use client"

// Per-project money-flow aggregation: spend pipeline (budget -> priced ->
// committed -> received -> invoiced -> paid) and collection pipeline
// (claimed -> collected). Formulas match src/lib/project-sections.ts's
// PIPELINE_STAGES. "received" is an approximation — delivery records carry
// no per-item pricing, so it's the committed value of RFQs that have at
// least one confirmed delivery, not a true received-value sum.

import { useEffect, useState } from "react"
import { useFirestore, useCollection, useDoc, useMemoFirebase } from "@/firebase"
import { collection, doc, query, where, getDocs } from "firebase/firestore"
import { calculateInvoiceTotal, calculateVat } from "@/utils/invoice-utils"

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function useProjectMoneyFlow(projectId: string | undefined | null) {
  const firestore = useFirestore()

  const projectRef = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return doc(firestore, "projects", projectId)
  }, [firestore, projectId])
  const { data: project } = useDoc(projectRef)

  const boqItemsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "boqItems")
  }, [firestore, projectId])
  const { data: boqItems } = useCollection(boqItemsQuery)

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return query(collection(firestore, "invoices"), where("projectId", "==", projectId))
  }, [firestore, projectId])
  const { data: invoices } = useCollection(invoicesQuery)

  const claimsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "ipcClaims")
  }, [firestore, projectId])
  const { data: claims } = useCollection(claimsQuery)

  const rfqsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return query(collection(firestore, "rfqs"), where("projectId", "==", projectId))
  }, [firestore, projectId])
  const { data: projectRfqs } = useCollection(rfqsQuery)

  // committed/received need a join across offers + deliveries by rfqId — not expressible
  // as a single top-level query, so fetch once (not real-time) whenever the RFQ set changes.
  const [committed, setCommitted] = useState(0)
  const [received, setReceived] = useState(0)
  const [joinLoading, setJoinLoading] = useState(true)

  useEffect(() => {
    if (!firestore || !projectRfqs) return
    const rfqIds = projectRfqs.map((r: any) => r.id)
    if (rfqIds.length === 0) {
      setCommitted(0)
      setReceived(0)
      setJoinLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setJoinLoading(true)
      const chunks = chunk(rfqIds, 30)

      const rfqIdsWithConfirmedDelivery = new Set<string>()
      for (const c of chunks) {
        const snap = await getDocs(query(collection(firestore, "deliveries"), where("rfqId", "in", c), where("status", "==", "confirmed")))
        snap.forEach((d) => rfqIdsWithConfirmedDelivery.add((d.data() as { rfqId?: string }).rfqId || ""))
      }

      let committedSum = 0
      let receivedSum = 0
      for (const c of chunks) {
        const snap = await getDocs(query(collection(firestore, "offers"), where("rfqId", "in", c), where("status", "==", "مقبول")))
        snap.forEach((o) => {
          const data = o.data() as { rfqId?: string; price?: string }
          const price = parseFloat(data.price || "0") || 0
          committedSum += price
          if (data.rfqId && rfqIdsWithConfirmedDelivery.has(data.rfqId)) receivedSum += price
        })
      }

      if (!cancelled) {
        setCommitted(committedSum)
        setReceived(receivedSum)
        setJoinLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [firestore, projectRfqs])

  const priced = ((boqItems || []) as { quantity?: string | number; unitPrice?: string | number }[]).reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    0
  )

  const invoiceTotal = (inv: { items?: unknown[]; vatPercent?: number }) => {
    const subtotal = calculateInvoiceTotal((inv.items || []) as any)
    return subtotal + calculateVat(subtotal, inv.vatPercent || 0)
  }
  const invoiceList = (invoices || []) as { items?: unknown[]; vatPercent?: number; status?: string; dueDate?: string }[]
  const invoiced = invoiceList.reduce((sum, inv) => sum + invoiceTotal(inv), 0)
  const paid = invoiceList.filter((inv) => inv.status === "paid").reduce((sum, inv) => sum + invoiceTotal(inv), 0)

  const claimList = (claims || []) as { amount?: number; status?: string }[]
  const claimed = claimList.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const collected = claimList.filter((c) => c.status === "collected").reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

  const projectData = project as { budget?: number; status?: string } | null
  const budget = projectData?.budget ?? null
  const status = projectData?.status ?? null
  const remaining = budget != null ? budget - paid : null

  const isLoading = !project || !boqItems || !invoices || !claims || !projectRfqs || joinLoading

  return {
    budget,
    priced,
    committed,
    received,
    invoiced,
    paid,
    remaining,
    status,
    claimed,
    collected,
    isApproximate: { received: true },
    isLoading,
  }
}

"use client"

// A registered supplier opened this RFQ: tell the server once per page visit (it counts once per company — portal-views.ts).
// A courtesy count: a failure is silent and never blocks the page.

import { useEffect, useRef } from "react"
import { useUser } from "@/firebase"

export function useCountRfqView(rfqId: string | null | undefined): void {
  const { user } = useUser()
  const sent = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!user || !rfqId || sent.current.has(rfqId)) return
    sent.current.add(rfqId)
    void (async () => {
      try {
        const idToken = await user.getIdToken()
        await fetch("/api/supplier/rfq-view", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ rfqId }) })
      } catch {
        // Not counted this time; the page works without it.
      }
    })()
  }, [user, rfqId])
}

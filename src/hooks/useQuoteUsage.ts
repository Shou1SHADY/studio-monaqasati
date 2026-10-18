"use client"

// What the supplier's company has used of the free plan's monthly quote allowance (/api/supplier/quota). null while
// unread or when the read fails — the server refuses an over-limit quote whatever the screen shows.

import { useEffect, useState } from "react"
import type { User } from "firebase/auth"

export interface QuoteUsage {
  month: string
  used: number
  limit: number | null
}

export function useQuoteUsage(user: User | null | undefined, enabled: boolean): QuoteUsage | null {
  const [usage, setUsage] = useState<QuoteUsage | null>(null)
  useEffect(() => {
    if (!user || !enabled) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch("/api/supplier/quota", { headers: { Authorization: `Bearer ${await user.getIdToken()}` } })
        const body = (await res.json().catch(() => null)) as { success?: boolean; data?: QuoteUsage } | null
        if (alive && res.ok && body?.success && body.data) setUsage(body.data)
      } catch {
        /* the server still enforces it */
      }
    })()
    return () => {
      alive = false
    }
  }, [user, enabled])
  return usage
}

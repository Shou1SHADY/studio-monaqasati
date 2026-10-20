"use client"

// Asks the server to forward the company's lapsed delivery notices (PUR-06) when a
// Procurement page opens — at most once per quarter-hour per browser session. The
// server decides what is due and to whom; this only says "someone is looking".

import { useEffect } from "react"
import { getAuth } from "firebase/auth"

const KEY = "mdmak:auto-forward-at"
export const AUTO_FORWARD_TICK_MS = 15 * 60_000

export function useAutoForwardTick(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let user: ReturnType<typeof getAuth>["currentUser"] = null
    try {
      user = getAuth().currentUser
    } catch {
      return
    }
    if (!user) return
    const signedIn = user
    try {
      const last = Number(sessionStorage.getItem(KEY)) || 0
      if (Date.now() - last < AUTO_FORWARD_TICK_MS) return
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      /* storage blocked — run anyway; the server forwards nothing twice */
    }
    void (async () => {
      try {
        await fetch("/api/procurement/auto-forward", { method: "POST", headers: { Authorization: `Bearer ${await signedIn.getIdToken()}` } })
      } catch {
        /* the daily job still runs on prod */
      }
    })()
  }, [enabled])
}

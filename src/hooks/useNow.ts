"use client"

import { useEffect, useState } from "react"

/** The current time, re-read every `ms` — so a screen that depends on a deadline flips when it passes without a reload. */
export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

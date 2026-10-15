"use client"

// The questions on one request as a supplier may read them — served by /api/supplier-free/questions (his company's own,
// and the answered ones of other bidders without who asked) — and `ask`, which goes through the server act so the
// buying side is told. The rules no longer let a supplier list a request's questions himself.

import { useCallback, useEffect, useState } from "react"
import { askQuestion, fetchQuestions, type QuestionRow } from "@/lib/supplier-free/act-client"

export function useSupplierQuestions(rfqId: string | null | undefined) {
  const [rows, setRows] = useState<QuestionRow[]>([])
  const [isLoading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!rfqId) {
      setRows([])
      return
    }
    let live = true
    setLoading(true)
    fetchQuestions(rfqId)
      .then((r) => live && setRows(r))
      .catch((err) => {
        console.warn("questions read failed:", (err as { code?: string })?.code || err)
        if (live) setRows([])
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [rfqId, tick])

  const ask = useCallback(
    async (question: string) => {
      if (!rfqId) return
      await askQuestion(rfqId, question)
      setTick((n) => n + 1)
    },
    [rfqId]
  )

  return { rows, isLoading, ask }
}

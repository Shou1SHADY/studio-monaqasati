"use client"

// A live read of the documents whose `field` is one of many values. Firestore's `in` takes ten
// (thirty on current SDKs) — the values are split into chunks, each chunk its own listener, and the
// result is every chunk's documents together. Used where the supplier's deals fan out from a list
// of ids he already holds (the requests he quoted, the receipts of his orders, the contractors).

import { useEffect, useMemo, useState } from "react"
import { collection, documentId, onSnapshot, query, where, type DocumentData, type Firestore } from "firebase/firestore"
import { useFirestore } from "@/firebase"

export type ChunkedDoc<T> = T & { id: string }

const CHUNK = 30

export function useChunkedDocs<T = DocumentData>(path: string, field: string | null, values: readonly string[]): { data: ChunkedDoc<T>[]; ready: boolean } {
  const firestore = useFirestore()
  const key = useMemo(() => [...new Set(values.filter(Boolean))].sort().join("|"), [values])
  const [byChunk, setByChunk] = useState<Record<number, ChunkedDoc<T>[]>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setByChunk({})
    if (!firestore) {
      setReady(false)
      return
    }
    const list = key ? key.split("|") : []
    if (!list.length) {
      setReady(true)
      return
    }
    setReady(false)
    const chunks: string[][] = []
    for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK))
    let pending = chunks.length
    const seen = new Set<number>()
    const unsubs = chunks.map((chunk, n) =>
      onSnapshot(
        query(collection(firestore as Firestore, path), where(field === null ? documentId() : field, "in", chunk)),
        (snap) => {
          setByChunk((prev) => ({ ...prev, [n]: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })) }))
          if (!seen.has(n)) {
            seen.add(n)
            pending -= 1
            if (pending <= 0) setReady(true)
          }
        },
        (err) => {
          console.error("useChunkedDocs", path, err)
          if (!seen.has(n)) {
            seen.add(n)
            pending -= 1
            if (pending <= 0) setReady(true)
          }
        }
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [firestore, path, field, key])

  const data = useMemo(() => Object.keys(byChunk).sort((a, b) => Number(a) - Number(b)).flatMap((k) => byChunk[Number(k)]), [byChunk])
  return { data, ready }
}

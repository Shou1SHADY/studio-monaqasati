import { getAuth } from "firebase/auth"
import { memoryMap, storedMemory } from "@/lib/boq-import/materials-memory"
import type { MaterialMemory, MaterialMemoryEntry } from "@/lib/boq-import/materials-match"

const headers = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${(await getAuth().currentUser?.getIdToken()) || ""}` })

/** What the company remembers of its files' texts (`/api/procurement/material-memory`). A failure is an empty memory: the upload works without it. */
export async function loadMaterialMemory(): Promise<MaterialMemory> {
  try {
    const res = await fetch("/api/procurement/material-memory", { headers: await headers() })
    const body = (await res.json().catch(() => null)) as { data?: { entries?: unknown } } | null
    return res.ok ? memoryMap(storedMemory(body?.data?.entries)) : new Map()
  } catch {
    return new Map()
  }
}

export async function saveMaterialMemory(entry: MaterialMemoryEntry): Promise<void> {
  try {
    await fetch("/api/procurement/material-memory", { method: "POST", headers: await headers(), body: JSON.stringify(entry) })
  } catch {
    // The pick still applies to this file; it is simply not remembered for the next one.
  }
}

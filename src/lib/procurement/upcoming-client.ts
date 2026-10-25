// The browser's side of `/api/procurement/upcoming-watch`: the keys the signed-in member watches, and one watch put on or taken off.

import { getAuth } from "firebase/auth"

async function token(): Promise<string | null> {
  try {
    return (await getAuth().currentUser?.getIdToken()) ?? null
  } catch {
    return null
  }
}

export async function fetchWatched(): Promise<string[] | null> {
  return (await fetchUpcomingFacts())?.keys ?? null
}

/** The watched keys and the stock items' issue rates per day (`issueKey(warehouse, name)` → quantity a day). */
export async function fetchUpcomingFacts(): Promise<{ keys: string[]; rates: Record<string, number> } | null> {
  const t = await token()
  if (!t) return null
  try {
    const res = await fetch("/api/procurement/upcoming-watch", { headers: { Authorization: `Bearer ${t}` } })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { keys?: string[]; rates?: Record<string, number> } }
    return { keys: json.data?.keys ?? [], rates: json.data?.rates ?? {} }
  } catch {
    return null
  }
}

export async function setWatched(key: string, on: boolean): Promise<boolean> {
  const t = await token()
  if (!t) return false
  try {
    const res = await fetch("/api/procurement/upcoming-watch", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ key, on }) })
    return res.ok
  } catch {
    return false
  }
}

// The browser's side of /api/supplier-free/act: the signed-in user's token goes with the request and a refusal comes
// back as the code the screens already know how to say.

import { getAuth } from "firebase/auth"

export class ActRefused extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "ActRefused"
  }
}

export async function callAct<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const token = await getAuth().currentUser?.getIdToken()
  if (!token) throw new ActRefused("UNAUTHENTICATED")
  const res = await fetch("/api/supplier-free/act", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; code?: string } | null
  if (!res.ok || !json?.success) throw new ActRefused(json?.code || "INTERNAL")
  return (json.data || {}) as T
}

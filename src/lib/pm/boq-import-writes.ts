// PM — the browser's side of writing a BOQ: the signed-in user's ID token to the server route.

import { getAuth } from "firebase/auth"
import type { BoqImportPayload } from "./boq-import-payload"

export class BoqImportRequestError extends Error {
  constructor(readonly code: string, readonly blocks: string[] = []) {
    super(code)
    this.name = "BoqImportRequestError"
  }
}

export async function submitBoqImport(projectId: string, payload: BoqImportPayload): Promise<{ written: number; removed: number }> {
  const token = (await getAuth().currentUser?.getIdToken().catch(() => "")) || ""
  const res = await fetch("/api/pm/boq-import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ projectId, payload }) })
  const json = (await res.json().catch(() => null)) as { data?: { written: number; removed: number }; code?: string; blocks?: string[] } | null
  if (!res.ok || !json?.data) throw new BoqImportRequestError(json?.code ?? "INTERNAL", json?.blocks ?? [])
  return json.data
}

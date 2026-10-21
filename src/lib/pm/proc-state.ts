// What Procurement says of a project's material request (Procurement 2.0 WP-S2-08): the request is stored there as `procIncoming`
// (`pm:{projectId}:{requestId}`), its lines in the request's own order. Projects reads from it what its own document cannot say —
// that a line could not be bought, why, and what Procurement proposed instead. Pure.

import type { ProcLineFact } from "./supply"

interface StoredLine {
  ps?: string | null
  fail?: { why?: string; alt?: string } | null
}

interface StoredRequest {
  mrKey?: string
  src?: string
  projectId?: string | null
  lines?: StoredLine[]
}

/** `requestId → line index → fact`, for the project's own requests. */
export function procFactsOf(docs: readonly StoredRequest[], projectId: string): Map<string, ProcLineFact[]> {
  const out = new Map<string, ProcLineFact[]>()
  for (const d of docs) {
    if (d.src !== "pm" || d.projectId !== projectId || !d.mrKey) continue
    const requestId = d.mrKey.split(":")[2]
    if (!requestId) continue
    out.set(
      requestId,
      (d.lines || []).map((l) => (l.ps === "fail" && l.fail ? { fail: { why: l.fail.why || "", alt: l.fail.alt || "" } } : {}))
    )
  }
  return out
}

// «السجل» of an incoming request (Procurement 2.0, NFR-05; the prototype's `req-log`): the request's STORED history
// (`procIncoming.log[]` — at · by · act · line · note), newest first, each act named by a message key. An act the screen does not
// know (written by a newer server) still shows, under a neutral sentence. Pure.

import type { IncomingDoc, IncomingLogEntry } from "./incoming-state"

/** Every act the server writes on a request's log — the ones it names itself and the line moves `logChanges` derives. */
export const REQUEST_LOG_ACTS = [
  "created",
  "created_for",
  "ingested",
  "submitted",
  "resubmitted",
  "approved",
  "approved_own",
  "returned",
  "released_policy_off",
  "escalated",
  "link_rfq",
  "link_po",
  "fail",
  "withdrawn",
  "ask_stock",
  "stock_reply",
  "ask_workshop",
  "workshop_reply",
  "proceed",
  "workshop_closed",
  "released",
  "buy",
  "wait",
  "rfq",
  "po",
  "covered",
  "gone",
  "done",
] as const
export type RequestLogAct = (typeof REQUEST_LOG_ACTS)[number]

export interface RequestLogRow {
  at: string
  by: string
  act: RequestLogAct | "other"
  /** The raw act when it is not one the screen knows. */
  raw: string
  note: string
  /** The material the entry is about, by its line number. */
  line: string | null
}

const known = new Set<string>(REQUEST_LOG_ACTS)

export function requestLogRows(doc: Pick<IncomingDoc, "log" | "lines"> | null | undefined): RequestLogRow[] {
  const log: IncomingLogEntry[] = Array.isArray(doc?.log) ? doc.log : []
  const nameOf = new Map((doc?.lines || []).map((l) => [l.no, l.name]))
  return log
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (b.e.at || "").localeCompare(a.e.at || "") || b.i - a.i)
    .map(({ e }) => ({
      at: e.at || "",
      by: e.by || "",
      act: known.has(e.act) ? (e.act as RequestLogAct) : "other",
      raw: e.act || "",
      note: e.note == null ? "" : String(e.note),
      line: e.line != null ? nameOf.get(e.line) ?? null : null,
    }))
}

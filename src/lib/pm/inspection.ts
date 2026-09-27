// PM 1.0 — inspection requests and the measurement gate (PRD WIR-01…03,
// MS-03, WF-15). A request names the item, the location, the party and the
// day; its result is one of three — passed · passed with comments · failed —
// and a result is never saved without a choice (it once wrote an undefined
// state and took the whole screen down). A failed inspection is re-inspected
// as a new numbered attempt; history keeps every attempt. An item that
// requires inspection cannot be measured until its LAST attempt passed.
// Pure: no I/O.

/** `projects/{id}/pmInspections/{NN}`, numbered by the project's `pm.wirCount`. */
export const PM_INSPECTIONS = "pmInspections"

export const WIR_RESULTS = ["pass", "cond", "fail"] as const
export type WirResult = (typeof WIR_RESULTS)[number]
export type WirStatus = "open" | WirResult

/** Who inspects — "other" is stated (RSN-01). */
export const WIR_PARTIES = ["consultant", "client", "authority", "internal", "other"] as const
export type WirParty = (typeof WIR_PARTIES)[number]

export interface WirAttempt {
  n: number
  /** The day it is booked for. */
  on: string
  result: WirResult | null
  note?: string | null
  by: string
  byName?: string | null
  /** Who recorded the result, and when. */
  rBy?: string | null
  rByName?: string | null
  rAt?: string | null
}

export interface PmInspection {
  id: string
  seq: number
  itemId: string
  code?: string | null
  location: string
  party: WirParty
  partyText?: string | null
  status: WirStatus
  attempts: WirAttempt[]
}

export const wirNo = (seq: number) => String(seq).padStart(2, "0")

export const isKnownStatus = (s: unknown): s is WirStatus => s === "open" || (WIR_RESULTS as readonly unknown[]).includes(s)

export type RequestBlock = "no_item" | "no_location" | "no_date" | "party_text" | "archived"

export function requestBlocks(input: { archived: boolean; itemId: string | null; location: string; on: string | null; party: WirParty | null; partyText?: string | null }): RequestBlock[] {
  const out: RequestBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.itemId) out.push("no_item")
  if (!input.location.trim()) out.push("no_location")
  if (!input.on) out.push("no_date")
  if (!input.party || (input.party === "other" && !input.partyText?.trim())) out.push("party_text")
  return out
}

export type ResultBlock = "no_choice" | "not_open" | "archived"

/** A result is one of three — no choice, no save (WIR-03). */
export function resultBlocks(input: { archived: boolean; status: unknown; result: unknown }): ResultBlock[] {
  const out: ResultBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== "open") out.push("not_open")
  if (!(WIR_RESULTS as readonly unknown[]).includes(input.result)) out.push("no_choice")
  return out
}

/** A failed inspection is re-inspected as the next attempt (WIR-02). */
export const canReinspect = (status: WirStatus) => status === "fail"

/** What the BOQ line carries for the gate: whether it requires inspection, and
 * its last result — kept on the line so a measurement can read it in its own
 * transaction. */
export interface GateFields {
  pmInspect?: boolean | null
  pmWir?: WirStatus | null
}

export type GateState = "free" | "passed" | "needs" | "open" | "failed"

/** MS-03: free when the item needs no inspection; otherwise measurable only
 * when its last attempt passed (with or without comments). */
export function gateOf(item: GateFields): GateState {
  if (!item.pmInspect) return "free"
  if (item.pmWir === "pass" || item.pmWir === "cond") return "passed"
  if (item.pmWir === "fail") return "failed"
  if (item.pmWir === "open") return "open"
  return "needs"
}

export const measurable = (item: GateFields) => {
  const g = gateOf(item)
  return g === "free" || g === "passed"
}

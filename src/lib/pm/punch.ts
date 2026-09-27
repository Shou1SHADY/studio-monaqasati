// PM 1.0 — the punch list (PRD PN-01…03, WF-17). A punch item states what is
// wrong, exactly where (mandatory), how serious, and who raised it ("other
// party" stated). Three states, not two: open → fixed → closed — "fixed" is
// not "closed" until the party who raised it confirms, and that confirmation
// is recorded. An open item — fixed but unconfirmed included — blocks final
// acceptance (PN-03). Pure: no I/O.

/** `projects/{id}/pmPunch/{NN}`, numbered by the project's `pm.punchCount`. */
export const PM_PUNCH = "pmPunch"

export const PUNCH_STATUSES = ["open", "fix", "done"] as const
export type PunchStatus = (typeof PUNCH_STATUSES)[number]

/** Critical or normal (the prototype's a / b). */
export const PUNCH_SEVERITIES = ["a", "b"] as const
export type PunchSeverity = (typeof PUNCH_SEVERITIES)[number]

/** Who raised it — the same party confirms it closed. "oth" is stated (RSN-01). */
export const PUNCH_SOURCES = ["cons", "own", "qs", "int", "ho", "oth"] as const
export type PunchSource = (typeof PUNCH_SOURCES)[number]

export interface PunchItem {
  id: string
  seq: number
  what: string
  location: string
  severity: PunchSeverity
  source: PunchSource
  sourceText?: string | null
  status: PunchStatus
  day: string
  by: string
  byName?: string | null
  itemId?: string | null
  fix?: { on: string; by: string; byName?: string | null; note?: string | null } | null
  conf?: { on: string; by: string; byName?: string | null; party: PunchSource; partyText?: string | null } | null
}

export const punchNo = (seq: number) => String(seq).padStart(2, "0")

export const isOpenPunch = (p: Pick<PunchItem, "status">) => p.status !== "done"

export type PunchBlock = "archived" | "no_what" | "no_location" | "source_text"

export function punchBlocks(input: { archived: boolean; what: string; location: string; source: PunchSource | null; sourceText?: string | null }): PunchBlock[] {
  const out: PunchBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.what.trim()) out.push("no_what")
  if (!input.location.trim()) out.push("no_location")
  if (!input.source || (input.source === "oth" && !input.sourceText?.trim())) out.push("source_text")
  return out
}

export type PunchStepBlock = "archived" | "wrong_state"

/** open → fix (the fix recorded) → done (the raiser's confirmation recorded). */
export function punchStepBlocks(input: { archived: boolean; status: PunchStatus; step: "fix" | "confirm" }): PunchStepBlock[] {
  const out: PunchStepBlock[] = []
  if (input.archived) out.push("archived")
  if ((input.step === "fix" && input.status !== "open") || (input.step === "confirm" && input.status !== "fix")) out.push("wrong_state")
  return out
}

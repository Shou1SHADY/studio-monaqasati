// PM 1.0 — the punch list (PRD PN-01…03, WF-17). A punch item states what is
// wrong, exactly where (mandatory), how serious, and who raised it ("other
// party" stated). Three states, not two: open → fixed → closed — "fixed" is
// not "closed" until the party who raised it confirms, and that confirmation
// is recorded. An open item — fixed but unconfirmed included — blocks final
// acceptance (PN-03). Every step carries its own day and, optionally, its
// photos: a "before" on the item, an "after" on the fix, the walk minute on the
// confirmation. Pure: no I/O.

import type { PmAttachment } from "./attachments"

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
  /** The delivery unit it is on — it blocks that unit's handover only. */
  unit?: string | null
  /** Photo of the item (optional). */
  files?: PmAttachment[]
  fix?: { on: string; by: string; byName?: string | null; note?: string | null; files?: PmAttachment[] } | null
  /** Who confirmed the closure — the raising party by default, chosen at confirmation. */
  conf?: { on: string; by: string; byName?: string | null; party: PunchSource; partyText?: string | null; files?: PmAttachment[] } | null
}

export const punchNo = (seq: number) => String(seq).padStart(2, "0")

export const isOpenPunch = (p: Pick<PunchItem, "status">) => p.status !== "done"

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A step's day: a real day, not in the future, not before `after` when given. */
export const badStepDay = (day: string | undefined, today: string | undefined, after?: string | null) =>
  day !== undefined && today !== undefined && (!DAY.test(day) || day > today || (after ? day < after : false))

export type PunchBlock = "archived" | "no_what" | "no_location" | "source_text" | "bad_date"

export function punchBlocks(input: { archived: boolean; what: string; location: string; source: PunchSource | null; sourceText?: string | null; day?: string; today?: string }): PunchBlock[] {
  const out: PunchBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.what.trim()) out.push("no_what")
  if (!input.location.trim()) out.push("no_location")
  if (!input.source || (input.source === "oth" && !input.sourceText?.trim())) out.push("source_text")
  if (badStepDay(input.day, input.today)) out.push("bad_date")
  return out
}

export type PunchStepBlock = "archived" | "wrong_state" | "no_fix_note" | "bad_date" | "party_text"

/** open → fix (the fix recorded) → done (the raiser's confirmation recorded).
 * A fix says what was done — "fixed" convinces nobody; a confirmation names
 * who confirmed ("other" stated). Both are dated, never before the step before. */
export function punchStepBlocks(input: {
  archived: boolean
  status: PunchStatus
  step: "fix" | "confirm"
  note?: string | null
  day?: string
  today?: string
  after?: string | null
  party?: PunchSource | null
  partyText?: string | null
}): PunchStepBlock[] {
  const out: PunchStepBlock[] = []
  if (input.archived) out.push("archived")
  if ((input.step === "fix" && input.status !== "open") || (input.step === "confirm" && input.status !== "fix")) out.push("wrong_state")
  if (input.step === "fix" && input.note !== undefined && !input.note?.trim()) out.push("no_fix_note")
  if (input.step === "confirm" && input.party !== undefined && (!input.party || (input.party === "oth" && !input.partyText?.trim()))) out.push("party_text")
  if (badStepDay(input.day, input.today, input.after)) out.push("bad_date")
  return out
}

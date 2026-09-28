// PM 1.0 — the inspection & test plan (the prototype's «خطة الفحص والاختبار»).
// An inspection says "this part passed"; the plan says what must be tested on
// each item, at which stage, how often and who signs it — before the work is
// covered. What is typed is the requirement (the test, the frequency, how many);
// what is DONE is counted from the item's passed inspections, never typed.
// Pure: no I/O.

import type { WirParty } from "./inspection"

/** `projects/{id}/pmItp/{NN}`, numbered by the project's `pm.itpCount`. */
export const PM_ITP = "pmItp"

export interface PmItpRow {
  id: string
  seq: number
  itemId: string
  code?: string | null
  /** Before pour · before covering · after execution. */
  stage: string
  /** Slump & 7/28-day cubes · flatness 4mm/2m. */
  test: string
  /** Every pour · every 100 m². */
  freq: string
  /** Who signs it. */
  party: WirParty
  partyText?: string | null
  /** How many passed inspections the plan requires on the item. */
  need: number
  day: string
  by: string
  byName?: string | null
}

export const itpNo = (seq: number) => String(seq).padStart(2, "0")

export type ItpBlock = "archived" | "no_item" | "no_stage" | "no_test" | "no_freq" | "bad_need" | "party_text"

export function itpBlocks(input: { archived: boolean; itemId: string | null; stage: string; test: string; freq: string; need: number; party: WirParty | null; partyText?: string | null }): ItpBlock[] {
  const out: ItpBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.itemId) out.push("no_item")
  if (!input.stage.trim()) out.push("no_stage")
  if (!input.test.trim()) out.push("no_test")
  if (!input.freq.trim()) out.push("no_freq")
  if (!(Number.isInteger(input.need) && input.need >= 1)) out.push("bad_need")
  if (!input.party || (input.party === "other" && !input.partyText?.trim())) out.push("party_text")
  return out
}

/** Done = inspections on the item whose result passed (with or without comments). */
export const itpDone = (itemId: string, inspections: Array<{ itemId: string; status: string }>) =>
  inspections.filter((w) => w.itemId === itemId && (w.status === "pass" || w.status === "cond")).length

/** How many tests the item is short of its plan. */
export const itpGap = (need: number, done: number) => Math.max(0, need - done)

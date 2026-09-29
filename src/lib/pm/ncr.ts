// PM 1.0 — non-conformance (PRD WF-18, NCR-01). Work that failed the
// specification: the item, severity, root cause and cost; a corrective plan;
// closed when the consultant accepts it. An open NCR blocks closing. The
// cost is on us and never billed: estimated when raised, revised with the
// plan, and the actual figure recorded at closing — the latest one stands.
// Pure: no I/O.

import type { PmAttachment } from "./attachments"

/** `projects/{id}/pmNcrs/{NN}`, numbered by the project's `pm.ncrCount`. */
export const PM_NCRS = "pmNcrs"

export const NCR_STATUSES = ["open", "plan", "done"] as const
export type NcrStatus = (typeof NCR_STATUSES)[number]
export const NCR_SEVERITIES = ["a", "b"] as const
export type NcrSeverity = (typeof NCR_SEVERITIES)[number]

export interface PmNcr {
  id: string
  seq: number
  /** The BOQ line, or "" when none was named (the prototype's «— غير محدّد»). */
  itemId: string
  code?: string | null
  /** What went against the specification («ما المخالفة»). */
  what?: string | null
  severity: NcrSeverity
  root: string
  /** The estimated rework cost when raised. */
  cost: number
  status: NcrStatus
  /** The day it was found. */
  day: string
  by: string
  byName?: string | null
  /** Photos and test reports (optional). */
  files?: PmAttachment[]
  plan?: { on: string; by: string; byName?: string | null; text: string; cost?: number | null; files?: PmAttachment[] } | null
  /** `on` = the consultant's acceptance day; `cost` = the actual rework cost. */
  accepted?: { on: string; by: string; byName?: string | null; cost?: number | null; recordedOn?: string | null; files?: PmAttachment[] } | null
}

export const ncrNo = (seq: number) => String(seq).padStart(2, "0")
export const isOpenNcr = (n: Pick<PmNcr, "status">) => n.status !== "done"

const DAY = /^\d{4}-\d{2}-\d{2}$/
const badDay = (day: string | undefined, today: string | undefined, after?: string | null) => day !== undefined && today !== undefined && (!DAY.test(day) || day > today || (after ? day < after : false))
const badCost = (c: number | null | undefined) => c !== undefined && c !== null && !(Number.isFinite(c) && c >= 0)

export type NcrBlock = "archived" | "no_what" | "no_root" | "bad_cost" | "bad_date"

export function ncrBlocks(input: { archived: boolean; root: string; cost: number; what?: string | null; day?: string; today?: string }): NcrBlock[] {
  const out: NcrBlock[] = []
  if (input.archived) out.push("archived")
  if (input.what !== undefined && !input.what?.trim()) out.push("no_what")
  if (!input.root.trim()) out.push("no_root")
  if (!(Number.isFinite(input.cost) && input.cost >= 0)) out.push("bad_cost")
  if (badDay(input.day, input.today)) out.push("bad_date")
  return out
}

export type NcrStepBlock = "archived" | "wrong_state" | "no_plan" | "bad_cost" | "bad_date"

/** open → plan (the corrective action stated) → done (the consultant accepted
 * it, on a day not before the plan and not in the future). */
export function ncrStepBlocks(input: { archived: boolean; status: NcrStatus; step: "plan" | "accept"; text?: string | null; cost?: number | null; day?: string; today?: string; after?: string | null }): NcrStepBlock[] {
  const out: NcrStepBlock[] = []
  if (input.archived) out.push("archived")
  if ((input.step === "plan" && input.status !== "open") || (input.step === "accept" && input.status !== "plan")) out.push("wrong_state")
  if (input.step === "plan" && !input.text?.trim()) out.push("no_plan")
  if (badCost(input.cost)) out.push("bad_cost")
  if (badDay(input.day, input.today, input.after)) out.push("bad_date")
  return out
}

/** The rework cost as it stands: actual at closing, else the plan's, else the estimate. */
export const ncrCost = (n: Pick<PmNcr, "cost" | "plan" | "accepted">): number => n.accepted?.cost ?? n.plan?.cost ?? n.cost ?? 0

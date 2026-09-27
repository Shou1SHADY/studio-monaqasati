// PM 1.0 — non-conformance (PRD WF-18, NCR-01). Work that failed the
// specification: the item, severity, root cause and cost; a corrective plan;
// closed when the consultant accepts it. An open NCR blocks closing.
// Pure: no I/O.

/** `projects/{id}/pmNcrs/{NN}`, numbered by the project's `pm.ncrCount`. */
export const PM_NCRS = "pmNcrs"

export const NCR_STATUSES = ["open", "plan", "done"] as const
export type NcrStatus = (typeof NCR_STATUSES)[number]
export const NCR_SEVERITIES = ["a", "b"] as const
export type NcrSeverity = (typeof NCR_SEVERITIES)[number]

export interface PmNcr {
  id: string
  seq: number
  itemId: string
  code?: string | null
  severity: NcrSeverity
  root: string
  cost: number
  status: NcrStatus
  day: string
  by: string
  byName?: string | null
  plan?: { on: string; by: string; byName?: string | null; text: string } | null
  accepted?: { on: string; by: string; byName?: string | null } | null
}

export const ncrNo = (seq: number) => String(seq).padStart(2, "0")
export const isOpenNcr = (n: Pick<PmNcr, "status">) => n.status !== "done"

export type NcrBlock = "archived" | "no_item" | "no_root" | "bad_cost"

export function ncrBlocks(input: { archived: boolean; itemId: string | null; root: string; cost: number }): NcrBlock[] {
  const out: NcrBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.itemId) out.push("no_item")
  if (!input.root.trim()) out.push("no_root")
  if (!(Number.isFinite(input.cost) && input.cost >= 0)) out.push("bad_cost")
  return out
}

export type NcrStepBlock = "archived" | "wrong_state" | "no_plan"

/** open → plan (the corrective action stated) → done (the consultant accepted it). */
export function ncrStepBlocks(input: { archived: boolean; status: NcrStatus; step: "plan" | "accept"; text?: string | null }): NcrStepBlock[] {
  const out: NcrStepBlock[] = []
  if (input.archived) out.push("archived")
  if ((input.step === "plan" && input.status !== "open") || (input.step === "accept" && input.status !== "plan")) out.push("wrong_state")
  if (input.step === "plan" && !input.text?.trim()) out.push("no_plan")
  return out
}

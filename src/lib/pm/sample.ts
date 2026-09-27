// PM 1.0 — material submittals, the sample gate (PRD WF-16, SUB-01…03,
// INV-18). Items whose contract requires a sample are a defined list (the BOQ
// line's `pmSample`); a sample is approved only when the consultant said so —
// approved, or approved as noted. No sample is not consent: it used to count as
// approved and let activities pass as ready. Pure: no I/O.

/** `projects/{id}/pmSubmittals/{NN}`, numbered by the project's `pm.sampleCount`. */
export const PM_SUBMITTALS = "pmSubmittals"

export const SAMPLE_STATUSES = ["sub", "appA", "appB", "rej"] as const
export type SampleStatus = (typeof SAMPLE_STATUSES)[number]
export const SAMPLE_REPLIES = ["appA", "appB", "rej"] as const
export type SampleReply = (typeof SAMPLE_REPLIES)[number]

export interface PmSubmittal {
  id: string
  seq: number
  itemId: string
  code?: string | null
  supplier: string
  /** 1 for the first submission of this item; a resubmission after a rejection is the next. */
  rev: number
  status: SampleStatus
  day: string
  by: string
  byName?: string | null
  reply?: { on: string; by: string; byName?: string | null; note?: string | null } | null
}

export const sampleNo = (seq: number) => String(seq).padStart(2, "0")

/** SUB-01: the item's sample state, from what the line carries. */
export type SampleState = "free" | "approved" | "with_consultant" | "rejected" | "not_submitted"

export function sampleStateOf(item: { pmSample?: boolean | null; pmSub?: string | null }): SampleState {
  if (!item.pmSample) return "free"
  if (item.pmSub === "appA" || item.pmSub === "appB") return "approved"
  if (item.pmSub === "sub") return "with_consultant"
  if (item.pmSub === "rej") return "rejected"
  return "not_submitted"
}

/** INV-18: an item requiring a sample is approved iff its state is "approved". */
export const sampleApproved = (item: { pmSample?: boolean | null; pmSub?: string | null }) => {
  const s = sampleStateOf(item)
  return s === "free" || s === "approved"
}

export type SubmitBlock = "archived" | "no_item" | "no_supplier" | "with_consultant" | "already_approved"

/** A new revision only after a rejection (or the first time); never two with the consultant. */
export function submitBlocks(input: { archived: boolean; itemId: string | null; supplier: string; pmSub: string | null | undefined }): SubmitBlock[] {
  const out: SubmitBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.itemId) out.push("no_item")
  if (!input.supplier.trim()) out.push("no_supplier")
  if (input.pmSub === "sub") out.push("with_consultant")
  if (input.pmSub === "appA" || input.pmSub === "appB") out.push("already_approved")
  return out
}

export type ReplyBlock = "archived" | "not_with_consultant" | "no_choice"

export function replyBlocks(input: { archived: boolean; status: unknown; reply: unknown }): ReplyBlock[] {
  const out: ReplyBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== "sub") out.push("not_with_consultant")
  if (!(SAMPLE_REPLIES as readonly unknown[]).includes(input.reply)) out.push("no_choice")
  return out
}

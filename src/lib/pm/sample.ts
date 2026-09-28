// PM 1.0 — material submittals, the sample gate (PRD WF-16, SUB-01…03,
// INV-18). Items whose contract requires a sample are a defined list (the BOQ
// line's `pmSample`); a sample is approved only when the consultant said so —
// approved, or approved as noted. No sample is not consent: it used to count as
// approved and let activities pass as ready. The consultant's turnaround is
// measured from the submission day to the reply day — the evidence when a
// reply is late. Pure: no I/O.

import type { PmAttachment } from "./attachments"

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
  /** What is being submitted («ما الذي يُعتمد»): the material, the sample. */
  what?: string | null
  /** 1 for the first submission of this item; a resubmission after a rejection is the next. */
  rev: number
  status: SampleStatus
  /** The submission day — the consultant's turnaround runs from it. */
  day: string
  by: string
  byName?: string | null
  /** The catalogue and certificates (optional). */
  files?: PmAttachment[]
  /** `on` = the reply's day as given; `files` = the signed reply. */
  reply?: { on: string; by: string; byName?: string | null; note?: string | null; files?: PmAttachment[]; recordedOn?: string | null } | null
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

const DAY = /^\d{4}-\d{2}-\d{2}$/
const badDay = (day: string | undefined, today: string | undefined, after?: string | null) => day !== undefined && today !== undefined && (!DAY.test(day) || day > today || (after ? day < after : false))

export type SubmitBlock = "archived" | "no_item" | "no_what" | "no_supplier" | "with_consultant" | "already_approved" | "bad_date"

/** A new revision only after a rejection (or the first time); never two with the consultant. */
export function submitBlocks(input: { archived: boolean; itemId: string | null; supplier: string; pmSub: string | null | undefined; what?: string | null; day?: string; today?: string }): SubmitBlock[] {
  const out: SubmitBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.itemId) out.push("no_item")
  if (input.what !== undefined && !input.what?.trim()) out.push("no_what")
  if (!input.supplier.trim()) out.push("no_supplier")
  if (input.pmSub === "sub") out.push("with_consultant")
  if (input.pmSub === "appA" || input.pmSub === "appB") out.push("already_approved")
  if (badDay(input.day, input.today)) out.push("bad_date")
  return out
}

export type ReplyBlock = "archived" | "not_with_consultant" | "no_choice" | "no_note" | "bad_date"

/** A rejection or an approval with comments carries the consultant's words. */
export function replyBlocks(input: { archived: boolean; status: unknown; reply: unknown; note?: string | null; on?: string; today?: string; submittedOn?: string | null }): ReplyBlock[] {
  const out: ReplyBlock[] = []
  if (input.archived) out.push("archived")
  if (input.status !== "sub") out.push("not_with_consultant")
  if (!(SAMPLE_REPLIES as readonly unknown[]).includes(input.reply)) out.push("no_choice")
  if (input.note !== undefined && (input.reply === "rej" || input.reply === "appB") && !input.note?.trim()) out.push("no_note")
  if (badDay(input.on, input.today, input.submittedOn)) out.push("bad_date")
  return out
}

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))

/** The consultant's turnaround: submission → reply, or how long it has been open. */
export function turnaround(s: Pick<PmSubmittal, "day" | "reply" | "status">, today: string): { days: number; open: boolean } {
  if (s.status === "sub" || !s.reply?.on) return { days: days(s.day, today), open: true }
  return { days: days(s.day, s.reply.on), open: false }
}

/** Average turnaround over the answered submissions, rounded to whole days; null when none. */
export function averageTurnaround(list: Array<Pick<PmSubmittal, "day" | "reply" | "status">>, today: string): number | null {
  const done = list.map((s) => turnaround(s, today)).filter((t) => !t.open)
  return done.length ? Math.round(done.reduce((a, t) => a + t.days, 0) / done.length) : null
}

/** A rejected submission is resubmitted as the next revision — unless a newer one already followed it. */
export const canResubmit = (s: Pick<PmSubmittal, "status" | "itemId" | "rev">, all: Array<Pick<PmSubmittal, "itemId" | "rev">>) =>
  s.status === "rej" && !all.some((x) => x.itemId === s.itemId && x.rev > s.rev)

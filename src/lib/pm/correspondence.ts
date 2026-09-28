// PM 1.0 — official correspondence (COR-01). In a dispute nobody asks "did you
// say it?" but "when did you send it, and when did they answer?" — a letter is
// its dates: sent or received, the party, a reply deadline, and the reply with
// its own date. A deadline that passes with no reply is half a claim, so a late
// letter shows red. Numbers read ص-014/023 (out) and و-014/017 (in): the
// project's sequence, then the letter's within its direction; the stored
// number stays Latin and the prefix follows the reader's language. A deadline
// of 0 days means none (a letter for information is never late). Pure: no I/O.

import type { PmFile } from "./documents"

/** `projects/{id}/pmLetters/{NN}`, numbered by the project's `pm.letterCount`;
 * the direction's own sequence is `pm.lettersOut` / `pm.lettersIn`. */
export const PM_LETTERS = "pmLetters"

export const LETTER_DIRS = ["out", "in"] as const
export type LetterDir = (typeof LETTER_DIRS)[number]

export const LETTER_PARTIES = ["cons", "own", "gov", "sub"] as const
export type LetterParty = (typeof LETTER_PARTIES)[number]

/** out = sent, awaiting their reply · in = received, needs ours · rep = replied · done = closed. */
export const LETTER_STATUSES = ["out", "in", "rep", "done"] as const
export type LetterStatus = (typeof LETTER_STATUSES)[number]

export const DEFAULT_REPLY_DAYS = 7

export interface LetterReply {
  text: string
  on: string
  by: string
  byName?: string | null
  file?: PmFile | null
}

export interface PmLetter {
  id: string
  seq: number
  /** "014/023" — the prefix comes from `dir`. */
  no: string
  dir: LetterDir
  party: LetterParty
  subject: string
  day: string
  due: number
  status: LetterStatus
  links: string[]
  file?: PmFile | null
  reply?: LetterReply | null
  by: string
  byName?: string | null
}

export const letterDocId = (seq: number) => String(seq).padStart(2, "0")

/** The project's three-digit sequence out of its number ("PJ-2026/014" → "014"). */
export const projectSeq = (projectNo: string | null | undefined) => String(projectNo ?? "").replace(/\D/g, "").slice(-3) || "000"

export const letterNumber = (projectNo: string | null | undefined, dirSeq: number) => `${projectSeq(projectNo)}/${String(dirSeq).padStart(3, "0")}`

export const letterPrefix = (dir: LetterDir, locale: string) => (locale === "ar" ? (dir === "out" ? "ص" : "و") : dir === "out" ? "OUT" : "IN")

export const letterLabel = (l: Pick<PmLetter, "dir" | "no">, locale: string) => `${letterPrefix(l.dir, locale)}-${l.no}`

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

export const letterAge = (l: Pick<PmLetter, "day">, today: string) => Math.max(0, daysBetween(l.day, today))

export const isLetterOpen = (l: Pick<PmLetter, "status">) => l.status === "out" || l.status === "in"

export const isLetterLate = (l: Pick<PmLetter, "status" | "day" | "due">, today: string) => isLetterOpen(l) && l.due > 0 && letterAge(l, today) > l.due

/** Days past the deadline (0 when not late). */
export const lateBy = (l: Pick<PmLetter, "status" | "day" | "due">, today: string) => (isLetterLate(l, today) ? letterAge(l, today) - l.due : 0)

/** "أ.ت-03، مط-014/02، RFI-07" → three references; any separator the keyboard offers. */
export function parseLinks(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[,،;؛\n·]+/)) {
    const ref = part.trim()
    if (ref && !out.includes(ref)) out.push(ref)
  }
  return out
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export type LetterBlock = "archived" | "no_subject" | "bad_day" | "future_day" | "bad_due"

export function letterBlocks(input: { archived: boolean; subject: string; day: string; due: number; today: string }): LetterBlock[] {
  const out: LetterBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.subject.trim()) out.push("no_subject")
  if (!isDay(input.day)) out.push("bad_day")
  else if (input.day > input.today) out.push("future_day")
  if (!Number.isInteger(input.due) || input.due < 0) out.push("bad_due")
  return out
}

export type ReplyBlock = "archived" | "wrong_state" | "no_text" | "bad_day" | "before_letter" | "future_day"

/** A reply closes an open letter only, and is dated between the letter and today. */
export function replyBlocks(input: { archived: boolean; status: LetterStatus; text: string; on: string; letterDay: string; today: string }): ReplyBlock[] {
  const out: ReplyBlock[] = []
  if (input.archived) out.push("archived")
  if (!isLetterOpen({ status: input.status })) out.push("wrong_state")
  if (!input.text.trim()) out.push("no_text")
  if (!isDay(input.on)) out.push("bad_day")
  else {
    if (input.on < input.letterDay) out.push("before_letter")
    if (input.on > input.today) out.push("future_day")
  }
  return out
}

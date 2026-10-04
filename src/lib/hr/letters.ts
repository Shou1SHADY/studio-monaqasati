// HR 1.0 — letters (PRD EM-08, WF-24). Five types: a salary certificate, an
// embassy letter and an experience certificate (on exit) come from the card
// with nothing typed; a no-objection letter and "other" carry the employee's
// own words — what he needs and why — which the signer turns into the letter's
// text. The employee asks from My file (the HR manager may ask for him); the
// HR manager signs, government relations signs an embassy letter, and nobody
// signs his own: the HR manager's own goes to management, a government
// relations officer's own embassy letter to the HR manager (RL-02). Issued
// with a yearly serial (LT-2026/001, read خ-2026/001 in Arabic) or declined
// with a reason the employee sees. An issued letter is never changed.
//
// The letter itself carries no pay: a salary or embassy letter's figures are
// copied from `employeePay` into `hrLetterPay/{letterId}`, which only pay roles
// and the employee read (RL-03) — government relations signs the embassy
// letter with the figures masked. Pure: no I/O.

import { z } from "zod"
import type { HrContext } from "./access"
import type { EmployeeStatus, HrEmployee } from "./employee"
import type { Stamp } from "./requests"

export const LETTER_KINDS = ["sal", "emb", "noc", "oth", "exp"] as const
export type LetterKind = (typeof LETTER_KINDS)[number]

export const LETTER_STATES = ["pending", "issued", "declined"] as const
export type LetterState = (typeof LETTER_STATES)[number]

export const LETTER_LANGS = ["ar", "en"] as const
export type LetterLang = (typeof LETTER_LANGS)[number]

/** Who signs: government relations, the HR manager, or management (the HR manager's own). */
export type SignerLevel = "gov" | "manager" | "management"

/** The yearly sequence (`mfgCounters/{orgId}__LT__{year}`) — read خ in Arabic. */
export const LETTER_NUMBER_TYPE = "LT"

/** WF-24 step 2 — the signer by type. */
export const LETTER_SIGNER: Record<LetterKind, Exclude<SignerLevel, "management">> = { sal: "manager", emb: "gov", noc: "manager", oth: "manager", exp: "manager" }

/** The employee states the letter's purpose; the signer writes its text. */
export const FREE_LETTERS: readonly LetterKind[] = ["noc", "oth"]
/** The letter states the wage — its figures come from pay (RL-03). */
export const PAY_LETTERS: readonly LetterKind[] = ["sal", "emb"]

export const isFreeLetter = (k: LetterKind) => FREE_LETTERS.includes(k)
export const isPayLetter = (k: LetterKind) => PAY_LETTERS.includes(k)

/** The card at the moment of signing — the letter never reads the record again. */
export interface LetterCard {
  nameAr: string
  nameEn: string | null
  nationality: string
  gender: "m" | "f"
  idNo: string | null
  trade: string
  join: string
  lastDay: string | null
}

/** The letterhead at the moment of signing. */
export interface LetterHead {
  name: string | null
  cr: string | null
  mol: string | null
}

export interface LetterPay {
  organizationId: string
  employeeId: string
  employeeUserId: string | null
  basic: number
  housing: number
  transport: number
}

export interface HrLetter {
  id: string
  organizationId: string
  kind: LetterKind
  /** "Other": the letter he needs, in his words. */
  title: string | null
  /** The purpose and details — required for no-objection and other. */
  purpose: string | null
  addressee: string
  lang: LetterLang
  employeeId: string
  /** The employee's platform user at filing — lets the rules show him his own. */
  employeeUserId: string | null
  employeeName: string
  signerLevel: SignerLevel
  filedBy: Stamp
  onBehalf: boolean
  state: LetterState
  createdAt: string
  serial?: string | null
  issuedOn?: string | null
  /** The signer's text of a free letter. */
  text?: string | null
  card?: LetterCard | null
  head?: LetterHead | null
  /** An embassy letter names the approved leave he travels in. */
  travel?: { from: string; to: string; requestId: string } | null
  /** Who signed or declined, as what; a decline's reason is its note. */
  decision?: (Stamp & { role: SignerLevel; ownFlagged?: boolean }) | null
}

// ---------------------------------------------------------------------------
// The request (WF-24 step 1)
// ---------------------------------------------------------------------------

export const letterRequestSchema = z.object({
  kind: z.enum(LETTER_KINDS),
  title: z.string().trim().max(160).default(""),
  purpose: z.string().trim().max(2000).default(""),
  addressee: z.string().trim().max(160),
  lang: z.enum(LETTER_LANGS),
})
export type LetterRequestInput = z.input<typeof letterRequestSchema>

export type LetterBlock = "no_addressee" | "no_title" | "no_purpose" | "exp_on_exit" | "left" | "no_wage" | "bad_input"

/** The experience certificate is for one who is leaving or has left; the rest while he works. */
export function requestableKinds(status: EmployeeStatus | null | undefined): LetterKind[] {
  const leaving = status === "leaving" || status === "left"
  return LETTER_KINDS.filter((k) => (k === "exp" ? leaving : status !== "left"))
}

/** What stops a request from being sent — said in the form, refused by the write. */
export function letterBlocks(input: LetterRequestInput, ctx: { status: EmployeeStatus | null | undefined; hasWage: boolean }): LetterBlock[] {
  const parsed = letterRequestSchema.safeParse(input)
  if (!parsed.success) return ["bad_input"]
  const d = parsed.data
  const out: LetterBlock[] = []
  if (!d.addressee) out.push("no_addressee")
  if (d.kind === "oth" && !d.title) out.push("no_title")
  if (isFreeLetter(d.kind) && !d.purpose) out.push("no_purpose")
  if (!requestableKinds(ctx.status).includes(d.kind)) out.push(d.kind === "exp" ? "exp_on_exit" : "left")
  if (isPayLetter(d.kind) && !ctx.hasWage) out.push("no_wage")
  return out
}

/** Nobody signs his own (RL-02): the HR manager's own goes to management, a
 * government relations officer's own embassy letter to the HR manager. */
export function letterSignerLevel(kind: LetterKind, requester: { isHrManager: boolean; isGov: boolean }): SignerLevel {
  let level: SignerLevel = LETTER_SIGNER[kind]
  if (level === "gov" && requester.isGov) level = "manager"
  if (level === "manager" && requester.isHrManager) level = "management"
  return level
}

// ---------------------------------------------------------------------------
// Signing (WF-24 steps 3–4)
// ---------------------------------------------------------------------------

export type LetterRefusal = "own_request" | "no_role"

/** May this person sign or decline this letter? The HR manager also signs an
 * embassy letter (when there is no officer); the owner signs anything — his
 * own included, flagged. */
export function maySignLetter(ctx: HrContext, letter: Pick<HrLetter, "employeeId" | "signerLevel">): LetterRefusal | null {
  if (ctx.employeeId && ctx.employeeId === letter.employeeId && !ctx.owner) return "own_request"
  if (ctx.owner) return null
  const r = ctx.roles
  const ok = letter.signerLevel === "gov" ? r.has("gov") || r.has("manager") : letter.signerLevel === "manager" ? r.has("manager") : r.has("management")
  return ok ? null : "no_role"
}

/** The role a signature is recorded under — the letter's level, or the HR manager standing in for government relations. */
export function signingRole(ctx: HrContext, letter: Pick<HrLetter, "signerLevel">): SignerLevel {
  if (letter.signerLevel === "gov" && !ctx.roles.has("gov")) return "manager"
  return letter.signerLevel
}

export type IssueBlock = "stale" | "no_text" | "no_reason"

export function issueBlocks(letter: Pick<HrLetter, "state" | "kind">, input: { text?: string | null }): IssueBlock[] {
  if (letter.state !== "pending") return ["stale"]
  if (isFreeLetter(letter.kind) && !input.text?.trim()) return ["no_text"]
  return []
}

export function declineBlocks(letter: Pick<HrLetter, "state">, reason: string): IssueBlock[] {
  if (letter.state !== "pending") return ["stale"]
  return reason.trim() ? [] : ["no_reason"]
}

/** The free text starts from the employee's words (WF-24 step 3). */
export const initialLetterText = (letter: Pick<HrLetter, "text" | "purpose">) => letter.text ?? letter.purpose ?? ""

/** The card as it stands — copied onto the letter when it is signed. */
export function letterCardOf(emp: Pick<HrEmployee, "names" | "nationality" | "gender" | "idNo" | "trade" | "join" | "lastDay">): LetterCard {
  return {
    nameAr: emp.names?.ar ?? "",
    nameEn: emp.names?.en || null,
    nationality: emp.nationality,
    gender: emp.gender === "f" ? "f" : "m",
    idNo: emp.idNo || null,
    trade: emp.trade,
    join: emp.join,
    lastDay: emp.lastDay ?? null,
  }
}

export const letterTotal = (p: Pick<LetterPay, "basic" | "housing" | "transport">) => (p.basic || 0) + (p.housing || 0) + (p.transport || 0)

/** "LT-2026/118" reads "خ-2026/118" in Arabic — the digits never change. */
export function letterNoDisplay(serial: string | null | undefined, lang: string): string {
  if (!serial) return ""
  return lang === "ar" ? serial.replace(/^LT-/, "خ-") : serial
}

// ---------------------------------------------------------------------------
// The signer's queue — for Today ("letters waiting for you")
// ---------------------------------------------------------------------------

/** Pending letters this person may sign, oldest first. */
export function lettersToSign(ctx: HrContext, letters: readonly HrLetter[]): HrLetter[] {
  return letters.filter((l) => l.state === "pending" && maySignLetter(ctx, l) === null).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
}

export interface LetterTodayRow {
  key: string
  severity: "blue"
  kind: "letter_to_sign"
  letterId: string
  params: { name: string; letter: LetterKind; title: string; addressee: string; purpose: string }
  /** Relative to the portal's HR root, like Today's rows. */
  href: string
  action: "sign"
}

/** One row per letter waiting for this viewer — the purpose cut at 70 characters, as the prototype shows it. */
export function letterTodayRows(ctx: HrContext, letters: readonly HrLetter[]): LetterTodayRow[] {
  return lettersToSign(ctx, letters).map((l) => {
    const p = (l.purpose ?? "").trim()
    return {
      key: `letter:${l.id}`,
      severity: "blue",
      kind: "letter_to_sign",
      letterId: l.id,
      params: { name: l.employeeName, letter: l.kind, title: l.title ?? "", addressee: l.addressee, purpose: p.length > 70 ? `${p.slice(0, 70)}…` : p },
      href: `people/${l.employeeId}`,
      action: "sign",
    }
  })
}

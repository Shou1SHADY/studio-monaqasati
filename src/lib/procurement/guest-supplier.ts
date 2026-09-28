// The guest supplier's page (prototype `supv`, proc-index 2241): what a
// supplier with no account may do through the RFQ's guest link, and what the
// buyer sees of it. Pure — shared by the public pages, their API routes and the
// buyer's share dialog.
//
// Invariants:
// - A one-time code proves the mobile the offer names. It is bound to the link
//   AND the number (`guestOtpSubject`), so a code sent to one number never
//   vouches for another, nor for another RFQ's link.
// - Papers (CR, VAT certificate) are checked here on the server before a byte
//   is stored; the object lives under the guest link it arrived through.
// - A link minted for the deadline (`expiresWith: "deadline"`) is open exactly
//   while the RFQ takes offers: it closes with the deadline and an extension
//   reopens it — nothing to re-mint. Older links keep their fixed expiry.

export type GuestOtpPurpose = "guest_offer"

/** Saudi mobiles in any usual spelling, or an international E.164 number → E.164; else null. */
export function normalizeGuestMobile(raw: string | null | undefined): string | null {
  const s = (raw || "").replace(/[\s\-()]/g, "")
  if (/^05\d{8}$/.test(s)) return `+966${s.slice(1)}`
  if (/^5\d{8}$/.test(s)) return `+966${s}`
  if (/^9665\d{8}$/.test(s)) return `+${s}`
  if (/^009665\d{8}$/.test(s)) return `+${s.slice(2)}`
  if (/^\+9665\d{8}$/.test(s)) return s
  if (/^\+966/.test(s)) return null
  if (/^00[1-9]\d{7,13}$/.test(s)) return `+${s.slice(2)}`
  if (/^\+[1-9]\d{7,13}$/.test(s)) return s
  return null
}

export const guestOtpSubject = (linkId: string, phoneE164: string): string => `rfq_share:${linkId}:${phoneE164}`

/** Every subject of one link sorts between these two — a range read counts a link's codes. */
export const guestOtpSubjectRange = (linkId: string): [string, string] => [`rfq_share:${linkId}:`, `rfq_share:${linkId}:`]

/** Codes one link may send in an hour, whatever numbers are typed — a link is not an SMS gateway. */
export const GUEST_OTP_LINK_CAP_PER_HOUR = 20

/** A code is asked for when the platform can deliver one, or on UAT, where it is shown on screen. */
export const guestOtpRequired = (canSendCodes: boolean, uat: boolean): boolean => canSendCodes || uat

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

export const GUEST_PAPER_KINDS = ["cr", "vat"] as const
export type GuestPaperKind = (typeof GUEST_PAPER_KINDS)[number]

export const GUEST_PAPER_MAX_BYTES = 5 * 1024 * 1024
export const GUEST_PAPER_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const

export type GuestPaperRefusal = "empty" | "type" | "size"

export function guestPaperRefusal(file: { type?: string | null; size?: number | null } | null | undefined): GuestPaperRefusal | null {
  if (!file || !file.size || file.size <= 0) return "empty"
  if (!(GUEST_PAPER_TYPES as readonly string[]).includes(file.type || "")) return "type"
  if (file.size > GUEST_PAPER_MAX_BYTES) return "size"
  return null
}

export const isGuestPaperKind = (v: unknown): v is GuestPaperKind => typeof v === "string" && (GUEST_PAPER_KINDS as readonly string[]).includes(v)

export function safeFileName(name: string | null | undefined, fallback = "file"): string {
  const cleaned = (name || "").replace(/[^\w.\-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[._]+|_+$/g, "")
  return (cleaned || fallback).slice(-80)
}

export const guestPaperPath = (linkId: string, offerId: string, kind: GuestPaperKind, fileName: string, stamp: number): string =>
  `rfqShareLinks/${linkId}/papers/${offerId}/${kind}-${stamp}-${safeFileName(fileName, kind)}`

export interface GuestPaper {
  kind: GuestPaperKind
  name: string
  url: string
  contentType: string
  size: number
  at: string
}

/** One paper per kind: a newer upload replaces the older, the others stay. */
export function mergeGuestPapers(current: GuestPaper[] | null | undefined, added: GuestPaper[]): GuestPaper[] {
  const byKind = new Map<GuestPaperKind, GuestPaper>()
  for (const p of current || []) if (p && isGuestPaperKind(p.kind)) byKind.set(p.kind, p)
  for (const p of added) byKind.set(p.kind, p)
  return GUEST_PAPER_KINDS.map((k) => byKind.get(k)).filter((p): p is GuestPaper => Boolean(p))
}

// ---------------------------------------------------------------------------
// Answered queries — what every invitee may read (§5.1), never who asked
// ---------------------------------------------------------------------------

export interface InquiryDoc {
  question?: unknown
  reply?: unknown
  repliedAt?: unknown
  createdAt?: unknown
}

export interface AnsweredQuery {
  question: string
  answer: string
  answeredAt: string | null
}

const asIso = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

export function answeredQueries(docs: InquiryDoc[], limit = 50): AnsweredQuery[] {
  return docs
    .map((d) => ({ question: text(d.question), answer: text(d.reply), answeredAt: asIso(d.repliedAt) || asIso(d.createdAt) }))
    .filter((q) => q.question && q.answer)
    .sort((a, b) => (a.answeredAt || "").localeCompare(b.answeredAt || ""))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// The link's validity — the RFQ's deadline
// ---------------------------------------------------------------------------

export interface ShareLinkLike {
  expiresAt?: string | null
  expiresWith?: "deadline" | null
  revoked?: boolean | null
}

export interface ShareRfqLike {
  status?: string | null
  deadline?: string | null
}

/** The last instant of the deadline's day — the same instant the offer route stops taking offers. */
export function deadlineEnd(deadline: string | null | undefined): string | null {
  const day = (deadline || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return `${day}T23:59:59.999Z`
}

export type ShareLinkState = "open" | "closed" | "gone"

/** open: takes offers · closed: the deadline passed while the RFQ still waits (view only; an extension reopens it) · gone: revoked, expired or the RFQ is decided. */
export function shareLinkState(link: ShareLinkLike, rfq: ShareRfqLike | null, now: Date): ShareLinkState {
  if (link.revoked || !rfq) return "gone"
  if (link.expiresWith === "deadline") {
    if (rfq.status !== "New") return "gone"
    const end = deadlineEnd(rfq.deadline)
    return end && new Date(end).getTime() < now.getTime() ? "closed" : "open"
  }
  const exp = link.expiresAt ? new Date(link.expiresAt).getTime() : NaN
  if (!Number.isFinite(exp) || exp <= now.getTime()) return "gone"
  const end = deadlineEnd(rfq.deadline)
  return end && new Date(end).getTime() < now.getTime() ? "closed" : "open"
}

/** What the share dialog and the guest page say the link is valid until. */
export const shareLinkValidUntil = (link: ShareLinkLike, rfq: ShareRfqLike | null): string | null =>
  link.expiresWith === "deadline" ? deadlineEnd(rfq?.deadline) : link.expiresAt || null

// ---------------------------------------------------------------------------
// «دعوات الزوار» — who the link was sent to, and how
// ---------------------------------------------------------------------------

export type GuestInviteChannel = "wa" | "mail" | "plat"

export interface GuestInvite {
  to: string | null
  channel: GuestInviteChannel
  at: string
  byName: string
}

/** The share dialog's channels → an invitation line. A copied link invites nobody in particular. */
export function guestInviteOf(channel: "whatsapp" | "email" | "link" | null | undefined, email: string | null | undefined, at: string, byName: string): GuestInvite | null {
  if (email) return { to: email, channel: "plat", at, byName }
  if (channel === "whatsapp") return { to: null, channel: "wa", at, byName }
  if (channel === "email") return { to: null, channel: "mail", at, byName }
  return null
}

export const MAX_GUEST_INVITES = 200

export function guestInvitesNewestFirst(list: GuestInvite[] | null | undefined): GuestInvite[] {
  return [...(list || [])].filter((x) => x && x.channel && x.at).sort((a, b) => b.at.localeCompare(a.at))
}

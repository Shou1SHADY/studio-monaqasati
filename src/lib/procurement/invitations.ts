// Inviting a supplier to the PLATFORM (Procurement 1.5, PUR-05) — not the RFQ's guest link.
// The invitation carries a join link in our company's name and no RFQ, no price; it is
// good for 30 days, then «انتهت» and is sent again with one press. Its state is DERIVED:
// أُرسلت · فُتحت · انضم · انتهت (· أُلغيت · رفضها). WhatsApp opens the sender's own chat
// with the ready text; e-mail and the text message are sent by the platform in the
// company's name. Pure.

import { waPhone } from "./supplier-file"

export const INVITE_TTL_DAYS = 30
export const PLATFORM_INVITE_CHANNELS = ["wa", "email", "sms"] as const
export type PlatformInviteChannel = (typeof PLATFORM_INVITE_CHANNELS)[number]

/** Stands for the join link in the ready text until the server mints it. */
export const LINK_TOKEN = "[[link]]"

export type InvitationState = "sent" | "opened" | "joined" | "expired" | "cancelled" | "declined"

export interface InvitationFacts {
  status?: string | null
  createdAt?: unknown
  /** The last time it was sent again — the 30 days count from it. */
  renewedAt?: string | null
  openedAt?: string | null
}

const isoOf = (v: unknown): string | null => {
  if (!v) return null
  if (typeof v === "string") return v
  const ts = v as { toDate?: () => Date }
  return typeof ts.toDate === "function" ? ts.toDate().toISOString() : null
}

/** When it stops working: 30 days after it was sent (or sent again). */
export function inviteExpiresAt(inv: InvitationFacts): string | null {
  const from = inv.renewedAt || isoOf(inv.createdAt)
  if (!from) return null
  const t = Date.parse(from)
  return Number.isFinite(t) ? new Date(t + INVITE_TTL_DAYS * 86_400_000).toISOString() : null
}

export function invitationState(inv: InvitationFacts, now: Date): InvitationState {
  if (inv.status === "accepted") return "joined"
  if (inv.status === "cancelled") return "cancelled"
  if (inv.status === "declined") return "declined"
  const exp = inviteExpiresAt(inv)
  if (exp && Date.parse(exp) < now.getTime()) return "expired"
  return inv.openedAt ? "opened" : "sent"
}

/** «الجوال أو البريد»: which the one field holds. */
export function contactOf(raw: string): { phone: string | null; email: string | null } {
  const v = raw.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { phone: null, email: v.toLowerCase() }
  const p = waPhone(v)
  return p.length >= 11 && /^9665\d{8}$/.test(p) ? { phone: `0${p.slice(3)}`, email: null } : { phone: null, email: null }
}

/** The channel a contact allows: a mobile for WhatsApp and a text message, an address for e-mail. */
export const channelFits = (channel: PlatformInviteChannel, c: { phone: string | null; email: string | null }): boolean => (channel === "email" ? !!c.email : !!c.phone)

/** «السلام عليكم أبو خالد، تدعوكم «شركة البنيان» إلى منصة مدماك تِك… سجّلوا من هنا: [[link]]» — editable. */
export const readyInviteText = (words: (p: { name: string; company: string; link: string }) => string, contactName: string, company: string): string => words({ name: contactName.trim(), company, link: LINK_TOKEN })

/** The text as sent: the link in place of its token (added at the end if the sender deleted it). */
export function finalInviteText(text: string, url: string): string {
  const t = text.trim()
  return t.includes(LINK_TOKEN) ? t.split(LINK_TOKEN).join(url) : `${t}\n${url}`.trim()
}

export interface DuplicateHint {
  kind: "invited" | "registered"
  /** The invitation's day, or the registered supplier's org id. */
  day?: string | null
  invitationId?: string
  orgId?: string
  name?: string
}

const samePhone = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && waPhone(a) === waPhone(b)

/** «دُعي في 12 أكتوبر — أعد الإرسال؟» / «موجود في المنصة — أضِفه إلى مورّدينا». */
export function duplicateOf(
  contact: { phone: string | null; email: string | null },
  invitations: Array<InvitationFacts & { id: string; phone?: string | null; email?: string | null }>,
  platform: Array<{ orgId: string; name: string; phone?: string | null; email?: string | null }>
): DuplicateHint | null {
  if (!contact.phone && !contact.email) return null
  const reg = platform.find((s) => (contact.email && s.email && s.email.toLowerCase() === contact.email) || samePhone(contact.phone, s.phone))
  if (reg) return { kind: "registered", orgId: reg.orgId, name: reg.name }
  const inv = invitations.find((i) => i.status !== "cancelled" && ((contact.email && i.email === contact.email) || samePhone(contact.phone, i.phone)))
  if (inv) return { kind: "invited", invitationId: inv.id, day: (inv.renewedAt || isoOf(inv.createdAt) || "").slice(0, 10) || null }
  return null
}

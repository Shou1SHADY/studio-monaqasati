// The order's conversation (Procurement 2.0 MSG-01…05, WF-19): ONE thread per purchase order between its company and its supplier.
// What people wrote is stored (`poMessages`, written only by the routes); what HAPPENED to the order — sent · accepted · reported
// delivery · receipt recorded — is read off the order's own log and receipts when the thread is drawn, so a fact can never
// disagree with the order and is never stored twice (prototype `poThread()`). The summary the list needs (last line, who spoke
// last, who has read up to where) sits on the order document as `chat`, written by the same routes. Pure: no I/O.

import { matchesSearch } from "@/lib/search-text"
import { bareOrderNo } from "@/lib/po-link"
import { pendingChangeAsk } from "./po-state"
import type { PoLogEntry, PurchaseOrder } from "./types"

export const POLL_MESSAGES = "poMessages"
export const MESSAGE_MAX = 2000
export const MESSAGE_FILE_MAX_BYTES = 4 * 1024 * 1024

export type MessageSide = "us" | "sup"
/** Where a message came from: the platform, the supplier's order link, or the buyer's own phone (he sent it on WhatsApp from the thread). */
export type MessageChannel = "portal" | "link" | "whatsapp"

export interface MessageFile {
  name: string
  url: string
}

export interface PoMessage {
  id: string
  poId: string
  seq: number
  by: MessageSide
  authorId: string
  authorName: string
  text: string | null
  file: MessageFile | null
  channel: MessageChannel
  /** A request to change the order, typed by the supplier on the link (it also raises a task for the buyer). */
  kind?: "change" | null
  at: string
}

/** The summary the list reads: counters per side so "unread" is a comparison of numbers, never a count that can drift. */
export interface PoChatSummary {
  /** The last message number; the next is `seq + 1`. */
  seq: number
  usSeq: number
  supSeq: number
  lastAt: string | null
  lastText: string | null
  lastBy: MessageSide | null
  lastFile: boolean
  /** Per member of the buying company: the supplier message number he has read up to. */
  readBy: Record<string, number>
  /** The supplier's side: the buyer's message number he has read up to. */
  supReadSeq: number
}

export const EMPTY_CHAT: PoChatSummary = { seq: 0, usSeq: 0, supSeq: 0, lastAt: null, lastText: null, lastBy: null, lastFile: false, readBy: {}, supReadSeq: 0 }

export interface PoChangeAsk {
  at: string
  seq: number
  text: string
}

/** The order with the fields the conversation adds (kept out of `types.ts`, which is mirrored to the mobile app). */
export type PoWithChat = PurchaseOrder & { chat?: PoChatSummary | null; changeAsked?: PoChangeAsk | null }

export const chatOf = (po: Pick<PoWithChat, "chat">): PoChatSummary => ({ ...EMPTY_CHAT, ...(po.chat || {}), readBy: { ...(po.chat?.readBy || {}) } })

/** The supplier's request to change the order, while the buyer has not answered it with a message. */
export function changeAskOpen(po: PoWithChat): PoChangeAsk | null {
  return pendingChangeAsk(po)
}

/** Whether a member of the buying company has something to read: the supplier spoke last and he has not read it. */
export const unreadForBuyer = (po: PoWithChat, uid: string): boolean => {
  const c = chatOf(po)
  return c.supSeq > (Number(c.readBy[uid]) || 0)
}

export const unreadForSupplier = (po: PoWithChat): boolean => {
  const c = chatOf(po)
  return c.usSeq > c.supReadSeq
}

/** How many buyer messages the supplier has not read. */
export const supplierUnreadCount = (po: PoWithChat, messages: ReadonlyArray<Pick<PoMessage, "by" | "seq">>): number => {
  const read = chatOf(po).supReadSeq
  return messages.filter((m) => m.by === "us" && m.seq > read).length
}

export const cleanText = (s: string | null | undefined): string => (s || "").replace(/\r\n/g, "\n").trim().slice(0, MESSAGE_MAX)

/** Ready for the order's summary after message `m` was stored (the route does this inside its transaction). */
export function summaryAfter(prev: PoChatSummary, m: Pick<PoMessage, "by" | "seq" | "at" | "text" | "file">): PoChatSummary {
  return {
    ...prev,
    seq: m.seq,
    usSeq: m.by === "us" ? m.seq : prev.usSeq,
    supSeq: m.by === "sup" ? m.seq : prev.supSeq,
    lastAt: m.at,
    lastText: m.text ? m.text.slice(0, 140) : null,
    lastBy: m.by,
    lastFile: Boolean(m.file),
  }
}

// ---------------------------------------------------------------------------
// The order's facts, as lines of the conversation
// ---------------------------------------------------------------------------

export type PoFactKind = "sent_portal" | "sent_whatsapp" | "sent_email" | "sent_outside" | "accepted" | "accepted_for" | "declined" | "reported" | "receipt" | "date" | "closed" | "cancelled"

export interface PoFact {
  sys: true
  kind: PoFactKind
  at: string
  /** Ties on the same moment keep the order they happened in. */
  k: number
  params: Record<string, string | number>
}

export interface PoMessageItem {
  sys: false
  message: PoMessage
  k: number
}

export type ThreadItem = PoFact | PoMessageItem

export interface ThreadReceipt {
  docNumber?: string | null
  status?: string | null
  confirmedAt?: string | null
  createdAt?: unknown
}

const iso = (v: unknown): string => {
  if (typeof v === "string") return v
  if (v && typeof (v as { toDate?: () => Date }).toDate === "function") return (v as { toDate: () => Date }).toDate().toISOString()
  return ""
}

const sentKind = (po: Pick<PurchaseOrder, "sentChannel" | "isGuestSupplier" | "supplierUserId">, e: PoLogEntry | undefined): PoFactKind => {
  if (e?.params && "outside" in e.params) return "sent_outside"
  const channel = (e?.params?.channel as string | undefined) || po.sentChannel || null
  if (channel === "whatsapp") return "sent_whatsapp"
  if (channel === "email") return "sent_email"
  if (channel === "portal") return "sent_portal"
  return po.isGuestSupplier || !po.supplierUserId ? "sent_outside" : "sent_portal"
}

/** The facts of the order the conversation shows, oldest first. */
export function orderFacts(po: PurchaseOrder, receipts: ReadonlyArray<ThreadReceipt> = []): PoFact[] {
  const out: PoFact[] = []
  const log = po.log || []
  const firstSent = log.find((e) => e.action === "sent")
  if (po.sentAt) out.push({ sys: true, kind: sentKind(po, firstSent), at: po.sentAt, k: 1, params: {} })
  let n = 0
  for (const e of log) {
    n += 1
    if (e.action === "supplier_accepted") out.push({ sys: true, kind: e.params?.recordedBy === "buyer" ? "accepted_for" : "accepted", at: e.at, k: 2 + n / 1000, params: { name: e.byName, date: String(e.params?.date ?? "") } })
    else if (e.action === "supplier_declined") out.push({ sys: true, kind: "declined", at: e.at, k: 2 + n / 1000, params: { reason: e.note || "" } })
    // A notice the buyer recorded from a phone call says so, and by whom (PO-04).
    else if (e.action === "delivery_reported") out.push({ sys: true, kind: "reported", at: e.at, k: 3 + n / 1000, params: { date: String(e.params?.date ?? ""), note: e.note || "", ...(e.params?.via === "onBehalf" ? { by: e.byName || "" } : {}) } })
    else if (e.action === "date_updated") out.push({ sys: true, kind: "date", at: e.at, k: 3 + n / 1000, params: { date: String(e.params?.date ?? "") } })
    else if (e.action === "closed") out.push({ sys: true, kind: "closed", at: e.at, k: 6 + n / 1000, params: { reason: e.note || "" } })
    else if (e.action === "cancelled") out.push({ sys: true, kind: "cancelled", at: e.at, k: 6 + n / 1000, params: { reason: e.note || "" } })
  }
  receipts.forEach((r, i) => {
    if (r.status !== "confirmed" || !r.docNumber) return
    out.push({ sys: true, kind: "receipt", at: r.confirmedAt || iso(r.createdAt) || po.sentAt || "", k: 4 + i / 1000, params: { no: r.docNumber } })
  })
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.k - b.k)
}

/** The conversation: what was written and what happened, in the order it came. */
export function threadOf(po: PurchaseOrder, messages: ReadonlyArray<PoMessage>, receipts: ReadonlyArray<ThreadReceipt> = []): ThreadItem[] {
  const items: ThreadItem[] = [...orderFacts(po, receipts), ...messages.map((message): PoMessageItem => ({ sys: false, message, k: 5 + message.seq / 100000 }))]
  return items.sort((a, b) => {
    const ta = a.sys ? a.at : a.message.at
    const tb = b.sys ? b.at : b.message.at
    return ta.localeCompare(tb) || a.k - b.k
  })
}

export const itemAt = (i: ThreadItem): string => (i.sys ? i.at : i.message.at)

// ---------------------------------------------------------------------------
// «محادثاتي» — one row per sent order, unread first
// ---------------------------------------------------------------------------

export interface ChatRow {
  po: PoWithChat
  unread: boolean
  /** The last line of the conversation: a message, or a fact of the order. */
  last: ThreadItem | null
  lastAt: string
  offPlatform: boolean
}

const isConversation = (po: PurchaseOrder): boolean => Boolean(po.sentAt) && po.status !== "cancelled" && po.status !== "awaiting_approval" && po.status !== "approved"

export function chatRows(orders: ReadonlyArray<PoWithChat>, uid: string, query: string, receiptsOf: (poId: string) => ReadonlyArray<ThreadReceipt> = () => []): ChatRow[] {
  const rows: ChatRow[] = []
  for (const po of orders) {
    if (!isConversation(po)) continue
    if (query.trim() && !matchesSearch(query, [po.supplierName, po.docNumber, bareOrderNo(po.docNumber)])) continue
    const facts = orderFacts(po, receiptsOf(po.id))
    const c = chatOf(po)
    const lastFact = facts[facts.length - 1] || null
    const messageIsLast = c.lastAt != null && (!lastFact || c.lastAt >= lastFact.at)
    const last: ThreadItem | null = messageIsLast
      ? {
          sys: false,
          k: 5,
          message: { id: `${po.id}__${c.seq}`, poId: po.id, seq: c.seq, by: c.lastBy || "us", authorId: "", authorName: "", text: c.lastText, file: c.lastFile ? { name: "", url: "" } : null, channel: "portal", at: c.lastAt as string },
        }
      : lastFact
    rows.push({ po, unread: unreadForBuyer(po, uid), last, lastAt: last ? itemAt(last) : po.sentAt || "", offPlatform: Boolean(po.isGuestSupplier) || !po.supplierUserId })
  }
  return rows.sort((a, b) => Number(b.unread) - Number(a.unread) || b.lastAt.localeCompare(a.lastAt))
}

/** The sidebar's counter: the conversations with something unread. */
export const unreadChatCount = (orders: ReadonlyArray<PoWithChat>, uid: string): number => orders.filter((po) => isConversation(po) && unreadForBuyer(po, uid)).length

/** Messages of the thread the drawer shows: the last four lines and how many are older. */
export function lastLines(thread: ReadonlyArray<ThreadItem>, n = 4): { shown: ThreadItem[]; older: number } {
  return { shown: thread.slice(-n), older: Math.max(0, thread.length - n) }
}

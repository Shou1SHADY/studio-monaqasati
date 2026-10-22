// Writing the order's conversation (Procurement 2.0 MSG-01…05): the only door to `poMessages`. The buyer's team, the registered
// supplier in his portal and the off-platform supplier on his order link all post through `postMessage`, one Admin transaction per
// message — it takes the next number from the order, stores the message, keeps the order's `chat` summary (who spoke last, who has
// read up to where) and, for a supplier's request to change the order, the open ask the buyer must answer. The outbox event
// (`proc:PO:<no>:MSG<n>` / `…:MSG<n>:SUP`) and the bell follow the commit, best-effort. Nothing is sent to WhatsApp from here (B-08):
// a message to an off-platform supplier is written from the buyer's own phone, with the order link, by the screen.

import { randomUUID } from "node:crypto"
import { FieldValue, type DocumentData, type Firestore, type UpdateData } from "firebase-admin/firestore"
import { getAdminStorage, getStorageBucketName } from "@/lib/firebaseAdmin"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { bareOrderNo } from "@/lib/po-link"
import type { Caller } from "@/lib/receipt-links"
import { poMessageKey, poMessageSupplierKey } from "./event-keys"
import { sendProcEvent } from "./proc-event-server"
import { MESSAGE_FILE_MAX_BYTES, POLL_MESSAGES, chatOf, cleanText, summaryAfter, type MessageChannel, type MessageFile, type MessageSide, type PoMessage, type PoWithChat } from "./po-messages"
import { PURCHASE_ORDERS, type PoLogEntry, type PurchaseOrder } from "./types"

export type MessageRefusalCode = "order_missing" | "not_yours" | "not_sent" | "cancelled" | "empty" | "file_type" | "file_big"

const STATUS: Record<MessageRefusalCode, number> = { order_missing: 404, not_yours: 403, not_sent: 409, cancelled: 409, empty: 400, file_type: 400, file_big: 400 }

export class MessageRefusal extends Error {
  readonly status: number
  constructor(readonly code: MessageRefusalCode) {
    super(code)
    this.name = "MessageRefusal"
    this.status = STATUS[code]
  }
}

const asPo = (id: string, data: Record<string, unknown>): PoWithChat => ({ ...(data as Omit<PoWithChat, "id">), id })

export const messageDocId = (poId: string, seq: number): string => `${poId}__${seq}`

export interface PostMessageInput {
  poId: string
  by: MessageSide
  author: { id: string; name: string }
  text?: string | null
  file?: MessageFile | null
  channel: MessageChannel
  kind?: "change" | null
  locale?: "ar" | "en"
  /** Throws a `MessageRefusal("not_yours")` when this writer is not a party to the order. */
  authorize: (po: PurchaseOrder) => void
}

const supplierSide = (po: PurchaseOrder): string[] => [...new Set([po.supplierUserId, po.supplierOrgId].filter((u): u is string => Boolean(u) && u !== "guest"))]

export async function postMessage(db: Firestore, input: PostMessageInput, now: Date = new Date()): Promise<{ message: PoMessage; po: PoWithChat }> {
  const text = cleanText(input.text)
  if (!text && !input.file) throw new MessageRefusal("empty")
  const at = now.toISOString()
  const poRef = db.collection(PURCHASE_ORDERS).doc(input.poId)

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(poRef)
    const data = snap.exists ? snap.data() : undefined
    if (!snap.exists || !data) throw new MessageRefusal("order_missing")
    const po = asPo(snap.id, data)
    input.authorize(po)
    if (!po.sentAt) throw new MessageRefusal("not_sent")
    if (po.status === "cancelled") throw new MessageRefusal("cancelled")
    const prev = chatOf(po)
    const seq = prev.seq + 1
    const message: PoMessage = { id: messageDocId(po.id, seq), poId: po.id, seq, by: input.by, authorId: input.author.id, authorName: input.author.name, text: text || null, file: input.file ?? null, channel: input.channel, kind: input.kind ?? null, at }
    tx.create(db.collection(POLL_MESSAGES).doc(message.id), {
      poId: po.id,
      organizationId: po.organizationId,
      supplierOrgId: po.supplierOrgId || "guest",
      seq,
      by: message.by,
      authorId: message.authorId,
      authorName: message.authorName,
      text: message.text,
      file: message.file,
      channel: message.channel,
      kind: message.kind ?? null,
      at,
    })
    const chat = summaryAfter(prev, message)
    const patch: Record<string, unknown> = { chat, updatedAt: FieldValue.serverTimestamp() }
    if (input.kind === "change") {
      patch.changeAsked = { at, seq, text: text.slice(0, 500) }
      const entry: PoLogEntry = { at, byId: input.author.id, byName: input.author.name, action: "message", note: text.slice(0, 500), params: { kind: "change" } }
      patch.log = [...(po.log || []), entry]
    }
    tx.update(poRef, patch as UpdateData<DocumentData>)
    return { message, po: { ...po, chat } as PoWithChat }
  })

  const { message, po } = out
  const key = message.by === "us" ? poMessageKey(po.docNumber, message.seq) : poMessageSupplierKey(po.docNumber, message.seq)
  await sendProcEvent(db, { id: message.by === "us" ? "po_message" : "po_message_supplier", key, organizationId: po.organizationId, by: message.authorId, at, refs: { po: po.docNumber, rfq: po.rfqId, offer: po.offerId }, payload: { hasText: Boolean(message.text), hasFile: Boolean(message.file), channel: message.channel } })
  try {
    const preview = (message.text || message.file?.name || "").slice(0, 160)
    const locale = input.locale ?? "ar"
    if (message.by === "us") {
      const side = supplierSide(po)
      if (side.length) {
        const about = locale === "ar" ? `أمر ${bareOrderNo(po.docNumber)}` : `order ${bareOrderNo(po.docNumber)}`
        await notifyNamed(db, { uid: message.authorId, name: message.authorName }, { kind: "doc_comment", organizationId: po.organizationId, params: { about, text: preview }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId, supplier: { userId: po.supplierUserId, orgId: po.supplierOrgId } }, side, { owner: false })
      }
    } else {
      await notifyNamed(db, { uid: message.authorId, name: message.authorName }, { kind: "doc_comment", organizationId: po.organizationId, params: { about: po.docNumber, text: input.kind === "change" ? `${locale === "ar" ? "طلب تعديل" : "Change requested"}: ${preview}` : preview }, poId: po.id, rfqId: po.rfqId, offerId: po.offerId }, [po.preparedById, po.sentById])
    }
  } catch (err) {
    console.warn("message not announced:", (err as { code?: string })?.code || err)
  }
  return out
}

export type Reader = { kind: "buyer"; uid: string } | { kind: "supplier" }

/** Marks the conversation read up to the last message of the other side. Idempotent: nothing is written when nothing moved. */
export async function markRead(db: Firestore, poId: string, reader: Reader, authorize: (po: PurchaseOrder) => void): Promise<PoWithChat> {
  const poRef = db.collection(PURCHASE_ORDERS).doc(poId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(poRef)
    const data = snap.exists ? snap.data() : undefined
    if (!snap.exists || !data) throw new MessageRefusal("order_missing")
    const po = asPo(snap.id, data)
    authorize(po)
    const c = chatOf(po)
    if (reader.kind === "buyer") {
      if ((Number(c.readBy[reader.uid]) || 0) >= c.supSeq) return po
      const chat = { ...c, readBy: { ...c.readBy, [reader.uid]: c.supSeq } }
      tx.update(poRef, { chat })
      return { ...po, chat }
    }
    if (c.supReadSeq >= c.usSeq) return po
    const chat = { ...c, supReadSeq: c.usSeq }
    tx.update(poRef, { chat })
    return { ...po, chat }
  })
}

/** Reads the conversation's messages, oldest first. */
export async function messagesOf(db: Firestore, poId: string): Promise<PoMessage[]> {
  const snap = await db.collection(POLL_MESSAGES).where("poId", "==", poId).get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<PoMessage, "id">), id: d.id }) as PoMessage).sort((a, b) => a.seq - b.seq)
}

const FILE_TYPES = (type: string) => type.startsWith("image/") || type === "application/pdf"

/** Stores a file of the conversation (an image or a PDF, 4 MB at most — under the host's request limit) and returns its address. */
export async function storeMessageFile(orgId: string, poId: string, file: { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<MessageFile> {
  if (!FILE_TYPES(file.type)) throw new MessageRefusal("file_type")
  if (file.size > MESSAGE_FILE_MAX_BYTES) throw new MessageRefusal("file_big")
  const safe = file.name.replace(/[^\w.؀-ۿ-]+/g, "_").slice(-80) || "file"
  const path = `organizations/${orgId}/po/${poId}/chat/${Date.now()}-${safe}`
  const bucketName = getStorageBucketName()
  const token = randomUUID()
  await getAdminStorage()
    .bucket(bucketName)
    .file(path)
    .save(Buffer.from(await file.arrayBuffer()), { contentType: file.type, metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
  return { name: file.name.slice(0, 120), url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}` }
}

// ---------------------------------------------------------------------------
// Who is a party to the order's conversation
// ---------------------------------------------------------------------------

export type CallerLike = Pick<Caller, "uid" | "name" | "orgId" | "can">

/** The buying company's side, or the registered supplier's. A guest supplier has no account: he is the link's. */
export function sideOf(po: Pick<PurchaseOrder, "organizationId" | "supplierOrgId" | "supplierUserId">, caller: Pick<Caller, "uid" | "orgId">): MessageSide | null {
  if (caller.orgId === po.organizationId) return "us"
  if (po.supplierOrgId && po.supplierOrgId !== "guest" && (caller.orgId === po.supplierOrgId || (po.supplierUserId != null && caller.uid === po.supplierUserId))) return "sup"
  return null
}

/** «يتحدّث مع المورّد»: the owner, the manager, the officer and the expediter (the matrix of the roles). */
export const mayTalkToSupplier = (caller: Pick<Caller, "uid" | "orgId" | "can">): boolean =>
  caller.uid === caller.orgId || caller.can("po.expedite") || caller.can("offers.accept") || caller.can("po.approve")

export async function postAsCaller(db: Firestore, caller: CallerLike, input: { poId: string; text?: string | null; file?: MessageFile | null; channel?: "portal" | "whatsapp"; locale?: "ar" | "en" }, now: Date = new Date()) {
  const snap = await db.collection(PURCHASE_ORDERS).doc(input.poId).get()
  const data = snap.exists ? snap.data() : undefined
  if (!snap.exists || !data) throw new MessageRefusal("order_missing")
  const side = sideOf(data as PurchaseOrder, caller)
  if (!side || (side === "us" && !mayTalkToSupplier(caller))) throw new MessageRefusal("not_yours")
  if (input.file && !fileBelongs(input.file.url, { id: snap.id, organizationId: String(data.organizationId) })) throw new MessageRefusal("file_type")
  return postMessage(
    db,
    {
      poId: input.poId,
      by: side,
      author: { id: caller.uid, name: caller.name },
      text: input.text,
      file: input.file ?? null,
      channel: side === "us" && input.channel === "whatsapp" ? "whatsapp" : "portal",
      locale: input.locale,
      authorize: (p) => {
        if (sideOf(p, caller) !== side) throw new MessageRefusal("not_yours")
      },
    },
    now
  )
}

export async function markReadAsCaller(db: Firestore, caller: CallerLike, poId: string): Promise<PoWithChat> {
  const snap = await db.collection(PURCHASE_ORDERS).doc(poId).get()
  const data = snap.exists ? snap.data() : undefined
  if (!snap.exists || !data) throw new MessageRefusal("order_missing")
  const side = sideOf(data as PurchaseOrder, caller)
  if (!side) throw new MessageRefusal("not_yours")
  return markRead(db, poId, side === "us" ? { kind: "buyer", uid: caller.uid } : { kind: "supplier" }, (p) => {
    if (sideOf(p, caller) !== side) throw new MessageRefusal("not_yours")
  })
}

/** A file attached to a message must be one this order's conversation stored — never an address typed by hand. */
export function fileBelongs(url: string, po: { id: string; organizationId: string }): boolean {
  try {
    return url.startsWith(`https://firebasestorage.googleapis.com/v0/b/${getStorageBucketName()}/o/${encodeURIComponent(`organizations/${po.organizationId}/po/${po.id}/chat/`)}`)
  } catch {
    return false
  }
}

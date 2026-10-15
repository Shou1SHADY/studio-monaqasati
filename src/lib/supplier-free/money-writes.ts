// The supplier's acts around money and the order's afterlife (PRD §11, WF-12…16): confirming a transfer or saying it
// did not arrive, reminding about a payment, registering a warranty, rating the contractor, and the conversation of the
// deal. The invoice itself goes through the server route (it re-runs every rule); everything here is a small write
// the rules bound to the supplier's own documents (NFR-06: each carries who and when).

import { addDoc, collection, doc, getDoc, increment, setDoc, updateDoc, type Firestore } from "firebase/firestore"
import type { PurchaseOrder } from "@/lib/procurement/types"
import type { SupplierSide } from "./events"
import { ActRefused, callAct } from "./act-client"

type Rec = Record<string, unknown>

export type TransferDoc = { id: string; amount: number; bank: string; ref: string; state: string }

/** "It arrived": the instalment it covers is settled (WF-13). The server runs it. */
export async function confirmTransfer(_firestore: Firestore, _s: SupplierSide, _po: PurchaseOrder, t: TransferDoc): Promise<void> {
  await callAct({ action: "transfer.answer", transferId: t.id, answer: "ok" })
}

/** "It did not arrive": stays open for both sides until a later transfer arrives (G-09). */
export async function reportTransferMissing(_firestore: Firestore, _s: SupplierSide, _po: PurchaseOrder, t: TransferDoc, note: string): Promise<void> {
  await callAct({ action: "transfer.answer", transferId: t.id, answer: "miss", note: note.trim().slice(0, 500) })
}

/** "It arrived later": a transfer reported missing is closed (WF-13). */
export async function transferArrivedLater(_firestore: Firestore, _s: SupplierSide, _po: PurchaseOrder, t: TransferDoc): Promise<void> {
  await callAct({ action: "transfer.answer", transferId: t.id, answer: "later" })
}

/** A message in the deal's conversation, the way the chat page writes one. */
export async function sendDealMessage(firestore: Firestore, args: { chatId: string; offer: Rec; uid: string; text: string }): Promise<void> {
  const { chatId, offer, uid } = args
  const text = args.text.trim()
  if (!text) return
  const chatRef = doc(firestore, "chats", chatId)
  const chat = await getDoc(chatRef).catch(() => null)
  if (!chat || !chat.exists()) {
    await setDoc(chatRef, {
      offerId: chatId,
      rfqId: String(offer.rfqId || ""),
      rfqTitle: String(offer.rfqTitle || ""),
      contractorId: String(offer.contractorId || ""),
      contractorOrgId: String(offer.contractorOrgId || offer.contractorId || ""),
      supplierId: String(offer.supplierId || ""),
      supplierOrgId: String(offer.organizationId || offer.supplierId || ""),
      createdAt: new Date().toISOString(),
    })
  }
  const at = new Date().toISOString()
  await addDoc(collection(firestore, "chats", chatId, "messages"), { senderId: uid, text, createdAt: at })
  const other = String(offer.contractorId || "")
  await updateDoc(chatRef, {
    lastMessage: text,
    lastMessageAt: at,
    lastSenderId: uid,
    ...(other ? { unreadFor: [other], [`unreadCounts.${other}`]: increment(1) } : {}),
  }).catch((err) => console.warn("chat metadata update:", (err as { code?: string }).code))
  if (other) {
    await addDoc(collection(firestore, "users", other, "notifications"), {
      type: "new_chat_message",
      message: text.length > 80 ? `${text.slice(0, 80)}...` : text,
      chatId,
      rfqTitle: String(offer.rfqTitle || ""),
      createdAt: at,
      read: false,
    }).catch(() => undefined)
  }
}

/** "Remind about the payment" (WF-14): the server runs it — once a day per invoice, in the order's log, in the deal's
 * conversation, and a notice to Finance and the owner. */
export async function remindPayment(args: { po: PurchaseOrder; invoiceId: string; text: string; due: string; amount: number }): Promise<"sent" | "today"> {
  try {
    await callAct({ action: "po.payremind", poId: args.po.id, invoiceId: args.invoiceId, amount: args.amount, due: args.due, message: args.text })
    return "sent"
  } catch (err) {
    if (err instanceof ActRefused && err.code === "reminded_today") return "today"
    throw err
  }
}

export interface WarrantyInput {
  itemId: string
  until: string
  file: { name: string; url: string }
}

/** A warranty for a warranty-eligible material, after receipt, ending in the future (ORD-14). The server runs it and reads
 * the category from the request and the item from the order — the screen's words are not trusted. */
export async function registerWarranty(_firestore: Firestore, _s: SupplierSide, po: PurchaseOrder, input: WarrantyInput, today: string): Promise<string> {
  if (!input.until || input.until <= today) throw new Error("WARRANTY_DATE")
  const r = await callAct<{ id?: string }>({ action: "warranty.register", poId: po.id, itemId: input.itemId, until: input.until, file: input.file })
  return r.id || ""
}

/** The supplier rates the contractor — after full payment only, once per order (B-09, WF-16). The server checks both and
 * writes the review with the order and its material, so a rating always stands on a delivery that happened (ACC-07). */
export async function rateContractor(args: { po: PurchaseOrder; stars: number; text: string }): Promise<void> {
  const stars = Math.min(5, Math.max(1, Math.round(args.stars)))
  await callAct({ action: "po.rate", poId: args.po.id, stars, text: args.text.trim().slice(0, 1000) })
}

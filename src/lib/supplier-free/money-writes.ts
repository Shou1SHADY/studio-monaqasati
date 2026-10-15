// The supplier's acts around money and the order's afterlife (PRD §11, WF-12…16): confirming a transfer or saying it
// did not arrive, reminding about a payment, registering a warranty, rating the contractor, and the conversation of the
// deal. The invoice itself goes through the server route (it re-runs every rule); everything here is a small write
// the rules bound to the supplier's own documents (NFR-06: each carries who and when).

import { addDoc, collection, doc, getDoc, increment, serverTimestamp, setDoc, updateDoc, type Firestore } from "firebase/firestore"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { tellAboutPo, type SupplierSide } from "./events"
import { sarText } from "@/lib/procurement/events"

type Rec = Record<string, unknown>

export type TransferDoc = { id: string; amount: number; bank: string; ref: string; state: string }

const day = (iso: string) => iso.slice(0, 10)

/** "It arrived": the instalment it covers is settled (WF-13). */
export async function confirmTransfer(firestore: Firestore, s: SupplierSide, po: PurchaseOrder, t: TransferDoc, now: Date = new Date()): Promise<void> {
  const at = now.toISOString()
  await updateDoc(doc(firestore, "supplierTransfers", t.id), { state: "ok", confirmedAt: at, confirmedById: s.actor.uid, updatedAt: serverTimestamp() })
  await tellAboutPo(firestore, s, po, "po_payment_confirmed", { amount: sarText(t.amount), bank: t.bank, ref: t.ref })
}

/** "It did not arrive": stays open for both sides until a later transfer arrives (G-09). */
export async function reportTransferMissing(firestore: Firestore, s: SupplierSide, po: PurchaseOrder, t: TransferDoc, note: string, now: Date = new Date()): Promise<void> {
  const at = now.toISOString()
  await updateDoc(doc(firestore, "supplierTransfers", t.id), { state: "miss", confirmedAt: at, confirmedById: s.actor.uid, note: note.trim().slice(0, 500), updatedAt: serverTimestamp() })
  await tellAboutPo(firestore, s, po, "po_payment_missing", { amount: sarText(t.amount), ref: t.ref, note: note.trim() })
}

/** "It arrived later": a transfer reported missing is closed (WF-13). */
export async function transferArrivedLater(firestore: Firestore, s: SupplierSide, po: PurchaseOrder, t: TransferDoc, now: Date = new Date()): Promise<void> {
  const at = now.toISOString()
  await updateDoc(doc(firestore, "supplierTransfers", t.id), { state: "ok", confirmedAt: at, confirmedById: s.actor.uid, arrivedLater: true, updatedAt: serverTimestamp() })
  await tellAboutPo(firestore, s, po, "po_payment_later", { amount: sarText(t.amount), ref: t.ref })
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

/** "Remind about the payment": a message in the conversation and a notice to the contractor — at most once a day per order. */
export async function remindPayment(firestore: Firestore, s: SupplierSide, args: { po: PurchaseOrder; offer: Rec; chatId: string; text: string; due: string; amount: number; orgId: string }, now: Date = new Date()): Promise<"sent" | "today"> {
  const ref = doc(firestore, "supplierWorkspace", args.orgId)
  const snap = await getDoc(ref).catch(() => null)
  const last = snap && snap.exists() ? ((snap.data().remind as Rec | undefined) || {})[args.po.id] : null
  if (typeof last === "string" && day(last) === day(now.toISOString())) return "today"
  await sendDealMessage(firestore, { chatId: args.chatId, offer: args.offer, uid: s.actor.uid, text: args.text })
  await setDoc(ref, { organizationId: args.orgId, remind: { [args.po.id]: now.toISOString() } }, { merge: true })
  await tellAboutPo(firestore, s, args.po, "po_payment_reminder", { amount: sarText(args.amount), date: args.due })
  return "sent"
}

export interface WarrantyInput {
  itemId: string
  itemName: string
  category: string
  until: string
  file: { name: string; url: string }
}

/** A warranty for a warranty-eligible material, after receipt, ending in the future (ORD-14). */
export async function registerWarranty(firestore: Firestore, s: SupplierSide, po: PurchaseOrder, input: WarrantyInput, today: string): Promise<string> {
  if (!input.until || input.until <= today) throw new Error("WARRANTY_DATE")
  const ref = await addDoc(collection(firestore, "supplierWarranties"), {
    poId: po.id,
    rfqId: po.rfqId,
    supplierOrgId: po.supplierOrgId,
    buyerOrgId: po.organizationId,
    itemId: input.itemId,
    itemName: input.itemName,
    category: input.category,
    until: input.until,
    file: input.file,
    state: "wait",
    createdAt: new Date().toISOString(),
    createdById: s.actor.uid,
    createdByName: s.actor.name,
  })
  await tellAboutPo(firestore, s, po, "po_warranty_registered", { item: input.itemName, until: input.until })
  return ref.id
}

/** The supplier rates the contractor — after full payment only (B-09, WF-16). */
export async function rateContractor(firestore: Firestore, s: SupplierSide, args: { po: PurchaseOrder; offerId: string; rfqId: string; contractorId: string; contractorName: string; stars: number; text: string }): Promise<void> {
  const stars = Math.min(5, Math.max(1, Math.round(args.stars)))
  const at = new Date().toISOString()
  await addDoc(collection(firestore, "reviews"), {
    offerId: args.offerId,
    rfqId: args.rfqId,
    poId: args.po.id,
    reviewerId: s.actor.uid,
    reviewerName: s.company,
    reviewerRole: "Supplier",
    revieweeId: args.contractorId,
    revieweeName: args.contractorName,
    revieweeRole: "Contractor",
    rating: stars,
    comment: args.text.trim().slice(0, 1000),
    createdAt: at,
  })
  await updateDoc(doc(firestore, "offers", args.offerId), { supplierRated: true, supplierRating: { stars, text: args.text.trim().slice(0, 1000), at } })
  await tellAboutPo(firestore, s, args.po, "po_supplier_rated", { stars })
}

// The browser's side of the order's conversation routes (`/api/procurement/po/message/*`): one call with the signed-in user's token.
// A refusal comes back as the `err_*` reason the screens already translate.

import { getAuth } from "firebase/auth"
import { PoRouteError } from "./po-client"
import type { MessageFile } from "./po-messages"
import type { PoLinkView } from "@/lib/po-link"

async function token(): Promise<string> {
  const user = getAuth().currentUser
  if (!user) throw new PoRouteError("no_permission")
  return user.getIdToken()
}

async function read<T>(res: Response, fallback: string): Promise<T> {
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; reason?: string; params?: Record<string, string | number> } | null
  if (res.ok && json?.success && json.data) return json.data
  if (json?.reason) throw new PoRouteError(json.reason, json.params || {})
  throw new Error(fallback)
}

export async function sendPoMessage(input: { poId: string; text?: string | null; file?: MessageFile | null; channel?: "portal" | "whatsapp"; locale?: "ar" | "en" }): Promise<{ poId: string; seq: number }> {
  const res = await fetch("/api/procurement/po/message", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(input) })
  return read(res, "message failed")
}

export async function markPoRead(poId: string): Promise<void> {
  const res = await fetch("/api/procurement/po/message/read", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ poId }) })
  await read(res, "read failed")
}

export async function uploadPoMessageFile(poId: string, file: File): Promise<MessageFile> {
  const form = new FormData()
  form.append("poId", poId)
  form.append("file", file)
  const res = await fetch("/api/procurement/po/message/file", { method: "POST", headers: { Authorization: `Bearer ${await token()}` }, body: form })
  return (await read<{ file: MessageFile }>(res, "upload failed")).file
}

/** A fresh address of the order link, for the message the buyer sends from his own phone. */
export async function fetchPoLink(poId: string): Promise<string> {
  const res = await fetch("/api/procurement/po/message/link", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ poId }) })
  return (await read<{ link: string }>(res, "link failed")).link
}

/** The order link's page as the supplier reads it, for the buyer to look at (PO-02) — read-only: no token, no read receipt. */
export async function fetchPoLinkPreview(poId: string): Promise<PoLinkView> {
  const res = await fetch("/api/procurement/po/message/preview", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ poId }) })
  return (await read<{ view: PoLinkView }>(res, "preview failed")).view
}

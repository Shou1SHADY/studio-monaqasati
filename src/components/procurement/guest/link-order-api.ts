// The order link's requests: the token IS the address's last segment, nothing else identifies the visitor. A refusal comes back as
// its `code` so the page can say what happened.

import type { PoLinkView } from "@/lib/po-link"
import type { MessageFile } from "@/lib/procurement/po-messages"

export class OrderLinkError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "OrderLinkError"
  }
}

async function readView(res: Response): Promise<PoLinkView> {
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { view?: PoLinkView }; code?: string } | null
  if (res.ok && json?.data?.view) return json.data.view
  throw new OrderLinkError(json?.code || "NETWORK")
}

export const loadOrder = async (token: string): Promise<PoLinkView> => readView(await fetch(`/api/po-link/${encodeURIComponent(token)}`, { cache: "no-store" }))

export const actOnOrder = async (token: string, act: "accept" | "decline" | "request-change" | "report-delivery" | "reply" | "me" | "accept-version", body: Record<string, unknown> = {}): Promise<PoLinkView> =>
  readView(await fetch(`/api/po-link/${encodeURIComponent(token)}/${act}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))

export async function uploadOrderFile(token: string, file: File): Promise<MessageFile> {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`/api/po-link/${encodeURIComponent(token)}/files`, { method: "POST", body: form })
  const json = (await res.json().catch(() => null)) as { data?: { file?: MessageFile }; code?: string } | null
  if (res.ok && json?.data?.file) return json.data.file
  throw new OrderLinkError(json?.code || "NETWORK")
}

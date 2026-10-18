// The browser's side of /api/supplier/offers: a supplier's quotation from the full portal or the AI assistant goes to the
// server, which checks the company's approval and the request (supplier-offer-server.ts). The rules no longer take it
// from a browser.

export type OfferSubmitCode = "not_approved" | "quota" | "rfq_missing" | "rfq_closed" | "too_large" | "failed"

export class OfferSubmitError extends Error {
  constructor(
    readonly code: OfferSubmitCode,
    readonly detail: string | null = null
  ) {
    super(code)
    this.name = "OfferSubmitError"
  }
}

const KNOWN = new Set<OfferSubmitCode>(["not_approved", "quota", "rfq_missing", "rfq_closed", "too_large"])

/** Sends the quote; resolves to the new offer's id, or throws an `OfferSubmitError` naming why it was refused. */
export async function submitSupplierOffer(idToken: string, rfqId: string, offer: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/supplier/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ rfqId, offer }),
  }).catch(() => null)
  const body = (await res?.json().catch(() => null)) as { success?: boolean; data?: { id?: string }; code?: string; detail?: string | null } | null
  if (res?.ok && body?.success && body.data?.id) return body.data.id
  const code = KNOWN.has(body?.code as OfferSubmitCode) ? (body?.code as OfferSubmitCode) : "failed"
  throw new OfferSubmitError(code, body?.detail ?? null)
}

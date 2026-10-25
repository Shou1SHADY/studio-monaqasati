// What the receiver's page shows above the count (RC-06, prototype `rcvlink` header): WHERE the goods are going — the place's name,
// its address or map link — WHEN (the notice's day), and the buying company's name for the page's header strip. The order freezes
// its delivery site (`po.site`, PO-05); without one the store the goods land in names the place. Never a quantity, never a price.
// Pure — the public receipt-link route reads the documents and hands them here.

import { noticeNumberFor } from "./format"

export interface ReceivePlaceFacts {
  placeName: string | null
  address: string | null
  mapUrl: string | null
}

type Site = { name?: string | null; city?: string | null; district?: string | null; address?: string | null; mapUrl?: string | null } | null | undefined

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

export function receivePlace(input: { site?: Site; warehouse?: { name?: string | null; location?: string | null } | null; project?: { name?: string | null; location?: string | null } | null }): ReceivePlaceFacts {
  const s = input.site || null
  const line = s ? [txt(s.city), txt(s.district)].filter(Boolean).join(" — ") : ""
  const placeName = txt(s?.name) || txt(input.warehouse?.name) || txt(input.project?.name) || null
  const address = txt(s?.address) || line || txt(input.warehouse?.location) || txt(input.project?.location) || null
  const map = txt(s?.mapUrl)
  return { placeName, address: address && address !== placeName ? address : null, mapUrl: map && /^https:\/\//i.test(map) ? map : null }
}

/** The notice's own number (`ASN-2026/126-2`) when the server stored its ordinal — the page says «أمر … · إشعار …». */
export const receiveNoticeNumber = (poNumber: string | null | undefined, seq: unknown): string | null => noticeNumberFor(poNumber, Number(seq) > 0 ? Number(seq) : null)

/** The buying company's name as its identity reads — a secondary company's own document first, then the owner's account. */
export const buyerCompanyName = (org: { companyName?: unknown; name?: unknown } | null | undefined, owner: { companyName?: unknown; name?: unknown } | null | undefined): string =>
  txt(org?.companyName) || txt(owner?.companyName) || txt(org?.name) || txt(owner?.name) || ""

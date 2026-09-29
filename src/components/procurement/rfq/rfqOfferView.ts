// The offer and RFQ as the RFQ page's pieces read them — the stored documents
// with every optional field a newer form may write. Anything absent is simply
// not shown (no invented "cash in advance" for an offer that never said).

import type { NoteOffer, NoteRfq } from "@/lib/procurement/rfq-notes"
import type { ReductionRound, RfqEarlyClose, RfqLogEntry, RfqCancellation } from "@/lib/procurement/rfq-detail"
import type { OfferExclusion } from "@/lib/procurement/award"

export interface RfqOfferView extends NoteOffer {
  price?: string | number | null
  status?: string | null
  offerPdfUrl?: string | null
  paymentTerms?: string | null
  createdAt?: string | null
  exclusion?: OfferExclusion | null
  isManualOffer?: boolean | null
  recordedByName?: string | null
  /** Keyed in while the round was still sealed — the buyer saw its price first. */
  recordedEarly?: boolean | null
  directAward?: boolean | null
  /** The «سجّله مورداً» invitation sent to a guest (`inviteGuestSupplier`). */
  guestInvite?: { at?: string | null; byName?: string | null; channel?: string | null } | null
  manualProofUrl?: string | null
  isFromMdmak?: boolean | null
  poId?: string | null
  poNumber?: string | null
  awardedLines?: number[] | null
  awardedTotal?: number | null
  guestContact?: { name?: string | null; email?: string | null; phone?: string | null; vatNumber?: string | null; phoneVerified?: boolean | null } | null
  /** The guest's CR and VAT certificate, uploaded through the guest link. */
  guestPapers?: Array<{ kind: "cr" | "vat"; name: string; url: string }> | null
  /** A registered supplier's CR and VAT certificate, attached from his profile when he offered. */
  supplierPapers?: Array<{ kind: "cr" | "vat"; name: string; url: string }> | null
  /** A registered supplier's note to us, written with the offer. */
  supplierNote?: string | null
  priceHistory?: Array<{ price?: string | number | null; replacedAt?: string | null }> | null
  reductionRound?: boolean | null
}

export interface RfqView extends NoteRfq {
  id: string
  title?: string | null
  organizationId?: string | null
  contractorId?: string | null
  projectId?: string | null
  category?: string | null
  subCategory?: string | null
  city?: string | null
  district?: string | null
  deadline?: string | null
  visibility?: string | null
  directAward?: boolean | null
  estimatedBudget?: number | null
  requiresWarranty?: boolean | null
  notes?: string | null
  pdfUrl?: string | null
  attachments?: Array<{ url?: string | null; name?: string | null } | string> | null
  rfqNumber?: string | null
  createdByUserId?: string | null
  pricingMode?: string | null
  createdAt?: string | null
  createdByUserName?: string | null
  allowedSupplierOrgIds?: string[] | null
  invitedSupplierOrgIds?: string[] | null
  purchaseSource?: { kind: string; workOrderId?: string; purchaseRequestId?: string } | null
  closedEarly?: RfqEarlyClose | null
  cancellation?: RfqCancellation | null
  unawardedLines?: number[] | null
  reductionRound?: ReductionRound | null
  log?: RfqLogEntry[] | null
  /** How many times the guest link was sent (the share dialog's «دعوات الزوار»). */
  guestInviteCount?: number | null
  products?: Array<{
    name?: string | null
    quantity?: number | string | null
    unitOfMeasure?: string | null
    unit?: string | null
    description?: string | null
    needBy?: string | null
    boqItemId?: string | null
    requiresWarranty?: boolean | null
    /** The project this line is charged to, and its name when it was written. */
    projectId?: string | null
    projectName?: string | null
    /** The need the line was picked from (the form's «من الاحتياج المفتوح»). */
    needSource?: { kind: string; workOrderId?: string; purchaseRequestId?: string; projectId?: string; warehouseId?: string; itemId?: string } | null
    needLine?: number | null
  }> | null
  needSources?: Array<{ kind: string; workOrderId?: string; purchaseRequestId?: string; projectId?: string; warehouseId?: string; itemId?: string }> | null
}

/** Who a line is for: its own project, else the RFQ's, else the workshop or general stock. */
export function lineForKey(rfq: Pick<RfqView, "products" | "projectId" | "purchaseSource">, index: number): { kind: "project"; id: string; name: string | null } | { kind: "workshop" } | { kind: "general" } {
  const line = rfq.products?.[index]
  if (line?.projectId) return { kind: "project", id: line.projectId, name: line.projectName || null }
  if (rfq.projectId) return { kind: "project", id: rfq.projectId, name: null }
  return rfq.purchaseSource?.kind === "mfg_purchase" ? { kind: "workshop" } : { kind: "general" }
}

/** The papers a registered supplier's offer carries — his CR and VAT certificate from his profile. */
export function profilePapers(legal: { cr?: { url?: string | null } | null; vat?: { url?: string | null } | null } | null | undefined): Array<{ kind: "cr" | "vat"; name: string; url: string }> {
  const out: Array<{ kind: "cr" | "vat"; name: string; url: string }> = []
  for (const kind of ["cr", "vat"] as const) {
    const url = (legal?.[kind]?.url || "").trim()
    if (url) out.push({ kind, name: kind, url })
  }
  return out
}

export const supplierNameOf = (o: Pick<RfqOfferView, "companyName" | "supplierName" | "guestContact">, fallback: string) =>
  (o.companyName || o.supplierName || o.guestContact?.name || "").trim() || fallback

export type TermsText = { key: "advance"; percent: number; days: number } | { key: "credit"; days: number } | { key: "cash" } | { key: "text"; text: string } | null

/** How the offer asks to be paid, as far as it said. */
export function termsOf(o: Pick<RfqOfferView, "advancePercent" | "creditDays" | "paymentTerms">): TermsText {
  const adv = Number(o.advancePercent)
  const days = Number(o.creditDays)
  if (Number.isFinite(adv) && adv > 0 && adv < 100) return { key: "advance", percent: adv, days: Number.isFinite(days) ? days : 0 }
  if (Number.isFinite(adv) && adv >= 100) return { key: "cash" }
  if (Number.isFinite(days) && days > 0) return { key: "credit", days }
  if (o.creditDays != null && days === 0) return { key: "cash" }
  const text = (o.paymentTerms || "").trim()
  return text ? { key: "text", text } : null
}

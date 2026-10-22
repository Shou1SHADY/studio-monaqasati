// What the visitor's page is told about the request (LNK-01, LNK-02, G-06) — and nothing more. The visitor sees the city
// and the district, never the site's pin, its address or the project's name; never another supplier's quote or name; never
// the buyer's own title when it could carry a project (his title is built here, from the materials). The same payload is
// served to the buyer's preview, which is why it is built in one place. Pure: the route reads, this shapes.

import { answeredQueries, deadlineEnd, type AnsweredQuery, type InquiryDoc } from "./guest-supplier"
import { readDeliveryOptions } from "./delivery-options"
import { termsListOf, type FrozenTerm } from "./terms-freeze"
import { pricingModeOf, type PricedRfq } from "./offer-calc"
import { saleUnitsOf, warrantyAskedOf, type QuoteProduct } from "./offer-versions"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim())
const day = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "")

export type LinkState = "open" | "closed" | "awarded" | "cancelled"

export interface LinkLineView {
  index: number
  name: string
  specs: string
  qty: number
  unit: string
  saleUnits: Array<{ lengthM: number; ar: string; en: string }>
  warrantyMonths: number | null
  needBy: string | null
  place: { city: string; district: string } | null
}

export interface LinkRfqView {
  id: string
  number: string | null
  title: string
  places: Array<{ city: string; district: string }>
  closeDay: string | null
  closeAt: string | null
  closedAt: string | null
  closedEarly: boolean
  needBy: string | null
  termsList: FrozenTerm[] | null
  paymentTerms: string | null
  delivery: { unload: "supplier" | "us" | null; slot: "am" | "pm" | "any" | null } | null
  accessNote: string | null
  notes: string | null
  attachments: Array<{ name: string; url: string }>
  lines: LinkLineView[]
  pricing: "line" | "total"
  lump: boolean
  state: LinkState
  cancelCode: string | null
}

export function linkStateOf(rfq: Rec, now: Date): LinkState {
  const status = str(rfq.status)
  if (status === "Cancelled") return "cancelled"
  if (status !== "New") return "awarded"
  const end = deadlineEnd(str(rfq.deadline))
  return end && new Date(end).getTime() < now.getTime() ? "closed" : "open"
}

const products = (rfq: Rec): Rec[] => (Array.isArray(rfq.products) ? (rfq.products as Rec[]) : []).filter((p) => p && typeof p === "object")

/** The request's name for a visitor: its materials, never the buyer's free title (which can carry a project or a site). */
export function visitorTitle(rfq: Rec, more: (count: number) => string = (n) => ` +${n}`): string {
  const names = [...new Set(products(rfq).map((p) => str(p.name) || str(p.subCategory)).filter(Boolean))]
  if (!names.length) return str(rfq.category) || str(rfq.subCategory) || ""
  return names.length <= 2 ? names.join(" و ") : `${names.slice(0, 2).join(" و ")}${more(names.length - 2)}`
}

function placesOf(rfq: Rec): Array<{ city: string; district: string }> {
  const seen = new Set<string>()
  const out: Array<{ city: string; district: string }> = []
  const add = (city: string, district: string) => {
    const key = `${city}|${district}`
    if (!city || seen.has(key)) return
    seen.add(key)
    out.push({ city, district })
  }
  for (const p of products(rfq)) add(str(p.deliveryCity), str(p.deliveryDistrict))
  if (!out.length) add(str(rfq.city), str(rfq.district))
  return out
}

function lineViews(rfq: Rec, multiPlace: boolean): LinkLineView[] {
  return products(rfq)
    .map((p, index): LinkLineView => {
      const q = p as QuoteProduct & Rec
      const name = str(p.name) || str(p.subCategory)
      const specs = str(p.description)
      const qty = Number(String(p.quantity ?? "").replace(/[,\s]/g, ""))
      const city = str(p.deliveryCity)
      return {
        index,
        name,
        specs: specs && specs !== name ? specs : "",
        qty: Number.isFinite(qty) ? qty : 0,
        unit: str(p.unitOfMeasure || p.unit),
        saleUnits: saleUnitsOf(q).map((u) => {
          const raw = (q.saleUnits || []).find((x) => Number(x?.lengthM) === u.lengthM)
          return { lengthM: u.lengthM, ar: str(raw?.ar) || u.name, en: str(raw?.en) || str(raw?.ar) || u.name }
        }),
        warrantyMonths: warrantyAskedOf(q),
        needBy: day(p.needBy) || null,
        place: multiPlace && city ? { city, district: str(p.deliveryDistrict) } : null,
      }
    })
    .filter((l) => l.name)
}

/** One delivery line for the header: the options the buyer set on the places, the first that says something. */
function deliveryOf(rfq: Rec): LinkRfqView["delivery"] {
  const all = Object.values(readDeliveryOptions(rfq.deliveryOptions))
  const unload = all.find((d) => d.unload)?.unload ?? null
  const slot = all.find((d) => d.slot)?.slot ?? null
  return unload || slot ? { unload, slot } : null
}

const accessNoteOf = (rfq: Rec): string | null => Object.values(readDeliveryOptions(rfq.deliveryOptions)).find((d) => d.note)?.note ?? null

export function buildLinkView(rfq: Rec, rfqId: string, now: Date, queries: InquiryDoc[] = []): { rfq: LinkRfqView; queries: AnsweredQuery[] } {
  const places = placesOf(rfq)
  const lines = lineViews(rfq, places.length > 1)
  const needs = lines.map((l) => l.needBy).filter((d): d is string => !!d).sort()
  const attachments = Array.isArray(rfq.attachments)
    ? (rfq.attachments as Array<{ name?: unknown; url?: unknown }>)
        .filter((a) => typeof a?.url === "string")
        .map((a) => ({ name: typeof a.name === "string" ? a.name : "PDF", url: a.url as string }))
        .slice(0, 20)
    : []
  if (typeof rfq.pdfUrl === "string" && rfq.pdfUrl && !attachments.some((a) => a.url === rfq.pdfUrl)) attachments.unshift({ name: "PDF", url: rfq.pdfUrl })
  const state = linkStateOf(rfq, now)
  const closeDay = day(rfq.deadline) || null
  const decidedAt = str(rfq.awardedAt) || str(rfq.cancelledAt) || null
  const pricing = pricingModeOf(rfq as PricedRfq)
  return {
    rfq: {
      id: rfqId,
      number: str(rfq.rfqNumber) || null,
      title: visitorTitle(rfq),
      places,
      closeDay,
      closeAt: deadlineEnd(closeDay),
      closedAt: state === "open" ? null : decidedAt || deadlineEnd(closeDay),
      closedEarly: Boolean(decidedAt && closeDay && day(decidedAt) < closeDay),
      needBy: needs[0] || null,
      termsList: termsListOf(rfq.paymentTermsList),
      paymentTerms: str(rfq.paymentTerms) || null,
      delivery: deliveryOf(rfq),
      accessNote: accessNoteOf(rfq),
      notes: str(rfq.notes) || null,
      attachments,
      lines,
      pricing,
      lump: pricing === "total" && lines.length > 1,
      state,
      cancelCode: state === "cancelled" ? str((rfq.cancellation as Rec | undefined)?.code) || null : null,
    },
    queries: answeredQueries(queries),
  }
}

// ---------------------------------------------------------------------------
// His result (LNK-11)
// ---------------------------------------------------------------------------

export type VisitorResultKind = "open" | "review" | "awarded" | "lost" | "cancelled"

export interface VisitorResult {
  kind: VisitorResultKind
  cancelCode?: string | null
  poNumber?: string | null
  orderUrl?: string | null
}

/** What a visitor who quoted is told: «رُسّي عليك» only once the order is out to him (the same rule as a registered
 * supplier's), «لم يُرسَ عليك» when the request was decided without him, «قيد الدراسة» while it is still being weighed. */
export function resultOf(state: LinkState, offer: { poId?: unknown; withdrawnAt?: unknown }, disclosed: boolean, cancelCode: string | null): VisitorResult {
  if (state === "cancelled") return { kind: "cancelled", cancelCode }
  if (state === "open") return { kind: "open" }
  if (state === "closed") return { kind: "review" }
  if (offer.poId) return disclosed ? { kind: "awarded" } : { kind: "review" }
  return { kind: "lost" }
}

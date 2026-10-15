// From the live collections to the supplier's deals (Supplier 1.0 PRD §13 "the supplier
// owns his quote, acceptance, report, invoice and confirmation; everything else is read
// from the contractor's modules by key, never copied or renumbered"). Pure: it takes the
// documents already read and returns the world, so a screen and a test see the same deals.
//
// The documents are NOT reshaped when they are written; this layer reads both what the free
// journey writes (`versions`, `outcome`, `supplierDecline`, `deliveryReports`, `termsList`) and what
// every older document carries, so a quote or an order from before this release still reads.

import { awardDisclosed, supplierSegmentOf } from "@/lib/procurement/supplier"
import { isWithdrawnOffer } from "@/lib/procurement/award"
import { termsListOf } from "@/lib/procurement/terms-freeze"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { addDaysTo, dayNum } from "./deal-logic"
import { rfqItems } from "./quote-rules"
import type {
  ConnectionInvite,
  ContractorRef,
  Deal,
  DealChannel,
  DealInvoice,
  DealItem,
  DealOffer,
  DealPo,
  DealReceipt,
  DealReport,
  DealTransfer,
  DealWarranty,
  OfferStatus,
  OutcomeWhy,
  PaymentTerm,
  PoLineFact,
  QuoteVersion,
  World,
} from "./types"

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const numOf = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? "").replace(/[,\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}
const dayOf = (v: unknown): string => {
  if (!v) return ""
  if (typeof v === "string") return v.slice(0, 10)
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return new Date((v as { toDate: () => Date }).toDate().getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
  }
  if (typeof v === "object" && v !== null && "seconds" in v) return new Date(((v as { seconds: number }).seconds + 3 * 3600) * 1000).toISOString().slice(0, 10)
  return ""
}
const timeOf = (iso: unknown): string => {
  if (typeof iso !== "string" || iso.length < 16) return ""
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  return new Date(t + 3 * 3_600_000).toISOString().slice(11, 16)
}

export interface RawRfq extends Rec {
  id: string
}
export interface RawOffer extends Rec {
  id: string
}
export interface RawPo extends Rec {
  id: string
}
export interface RawDelivery extends Rec {
  id: string
}

export interface RawWorld {
  today: string
  myOrgId: string
  rfqs: RawRfq[]
  offers: RawOffer[]
  pos: PurchaseOrder[]
  deliveries: RawDelivery[]
  invoices: Rec[]
  transfers: Rec[]
  warranties: Rec[]
  chats: Rec[]
  /** contractor org id → public facts. */
  contractors: Record<string, Rec>
  links: Rec[]
  invitations: Rec[]
  archived: Record<string, unknown>
  seen: Record<string, unknown>
  /** Invitations the supplier declined to quote on (his own mark): request id → when and why. */
  declined: Record<string, { at?: string; note?: string }>
  /** The signed-in user — chat counters are kept per user. */
  myUid: string
  questions: Record<string, Rec[]>
}

// ---- Small mappings --------------------------------------------------------------------

/** `RFQ-2026/031` → `2026/031`: the supplier reads the contractor's number as a word and a number. */
export function bareNumber(n: unknown): string {
  const s = str(n)
  const m = /(\d{4}\/\d+)\s*$/.exec(s)
  return m ? m[1] : s.replace(/^[A-Za-z؀-ۿ.]+-?/, "")
}

/** The number the supplier reads on a receipt: `GR-2026/031` → `2026/031`. */
export const receiptNumber = bareNumber

/** The contractor's exclusion reasons (R-41, and the older set still stored) as the supplier reads them. */
const EXCLUSION_TO_WHY: Record<string, OutcomeWhy> = { price: "price", terms: "price", lead: "time", spec: "spec", incomplete: "incomplete", documents: "docs", not_qualified: "docs", other: "other" }

/** Why a request was cancelled (R-12) → the no-award reason the supplier reads. */
const CANCEL_TO_WHY: Record<string, OutcomeWhy> = { need: "need", spec: "spec", reissue: "reissue" }

const CHECK_MAP: Record<string, string> = { photos: "ph", weighbridge: "wt", certificate: "cert" }

/** A short title from the request: its own title when brief, else built from the items. */
export function shortTitle(title: string, items: DealItem[]): string {
  const t = title.trim()
  if (t && t.length <= 90 && !t.includes("\n")) return t
  if (items.length === 1) return items[0].name
  return t.split(/[\n.،;]/)[0].slice(0, 90) || items[0]?.name || ""
}

function channelOf(rfq: Rec, myOrgId: string, offer: Rec | null): DealChannel {
  if (offer && (offer.isGuestOffer || offer.guestOfferLinkId)) return "link"
  const allowed = Array.isArray(rfq.allowedSupplierOrgIds) ? (rfq.allowedSupplierOrgIds as string[]) : []
  const invited = Array.isArray(rfq.invitedSupplierOrgIds) ? (rfq.invitedSupplierOrgIds as string[]) : []
  if (rfq.visibility === "private" && (allowed.includes(myOrgId) || invited.includes(myOrgId))) return "invite"
  return "public"
}

function versionsOf(offer: Rec, items: DealItem[], pricing: "item" | "total"): QuoteVersion[] {
  const raw = Array.isArray(offer.versions) ? (offer.versions as Rec[]) : null
  const toVersion = (x: Rec): QuoteVersion => {
    const prices: Record<string, number | null> = {}
    const lines = Array.isArray(x.lines) ? (x.lines as Rec[]) : []
    if (pricing === "item") for (const it of items) prices[it.id] = null
    for (const l of lines) prices[`i${numOf(l.rfqProductIndex) + 1}`] = numOf(l.unitPrice)
    const v: QuoteVersion = {
      at: dayOf(x.at),
      prices,
      arrive: dayOf(x.arrive),
      valid: dayOf(x.valid),
      note: str(x.note),
      file: str(x.fileUrl) || null,
    }
    if (pricing === "total" || !lines.length) v.total = numOf(x.total ?? x.price)
    return v
  }
  if (raw && raw.length) return raw.map(toVersion)

  // A quote from before versions: the history of replaced prices, then the live one.
  const created = dayOf(offer.createdAt) || dayOf(offer.updatedAt)
  const batches = Array.isArray(offer.deliveryBatches) ? (offer.deliveryBatches as Rec[]) : []
  const arrive = dayOf(batches[0]?.deliveryDate) || ""
  const terms = typeof offer.validUntil === "string" ? offer.validUntil : dayOf(offer.validUntil)
  const live = toVersion({
    at: dayOf(offer.updatedAt) || created,
    lines: offer.lines,
    total: offer.price,
    arrive,
    valid: terms,
    note: offer.supplierNote,
    fileUrl: offer.offerPdfUrl,
  })
  const hist = Array.isArray(offer.priceHistory) ? (offer.priceHistory as Rec[]) : []
  const older = hist.map((h) => ({ at: dayOf(h.replacedAt) || created, prices: {}, total: numOf(h.price), arrive, valid: terms, note: "" }) as QuoteVersion).sort((a, b) => dayNum(a.at || "1970-01-01") - dayNum(b.at || "1970-01-01"))
  return [...older, live]
}

/** The outcome of a quote the contractor decided (or the closing of its request). */
function outcomeOf(offer: Rec, rfq: Rec, hasOwnPo: boolean, disclosed: boolean, posById: ReadonlyMap<string, PurchaseOrder>): { st: OfferStatus; at: string; why?: OutcomeWhy } | null {
  const out = offer.outcome as Rec | undefined
  if (out && typeof out.k === "string") {
    const k = out.k as string
    if (k === "won" || k === "lost" || k === "noaward") return { st: k, at: dayOf(out.at), why: (str(out.why) || undefined) as OutcomeWhy | undefined }
  }
  const status = str(offer.status)
  if (status === "مرفوض") {
    const ex = offer.exclusion as Rec | undefined
    const why = ex ? EXCLUSION_TO_WHY[str(ex.code)] : undefined
    return { st: "lost", at: dayOf(ex?.at) || dayOf(offer.decidedAt) || dayOf(offer.updatedAt), why }
  }
  if (hasOwnPo && disclosed) return { st: "won", at: dayOf(offer.decidedAt) || dayOf(offer.updatedAt) }
  // HIS quote was chosen: its order is with the buyer's approval, so it waits — never "awarded to another" (OFR-07).
  if (status === "مقبول" || status === "تم التسليم" || offer.poId) {
    const p = offer.poId ? posById.get(str(offer.poId)) : undefined
    // The order was refused before it was ever sent: the request closed without an award for him.
    if (p && p.status === "cancelled" && supplierSegmentOf(p) == null) return { st: "noaward", at: dayOf(p.closedAt) || dayOf((p as unknown as Rec).updatedAt) }
    // An award from before purchase orders was told at the time.
    if (!offer.poId && !offer.awaitingOrderApproval) return { st: "won", at: dayOf(offer.decidedAt) || dayOf(offer.updatedAt) }
    return null
  }
  if (str(rfq.status) === "Cancelled") {
    const c = rfq.cancellation as Rec | undefined
    return { st: "noaward", at: dayOf(c?.at) || dayOf(rfq.cancelledAt) || dayOf(rfq.updatedAt), why: CANCEL_TO_WHY[str(c?.code)] || "cancelled" }
  }
  if (str(rfq.status) === "Awarded" && !hasOwnPo) return { st: "lost", at: dayOf(rfq.awardedAt) || dayOf(rfq.updatedAt) }
  return null
}

function offerOf(offer: Rec, rfq: Rec, items: DealItem[], pricing: "item" | "total", hasOwnPo: boolean, disclosed: boolean, today: string, posById: ReadonlyMap<string, PurchaseOrder>): DealOffer {
  const v = versionsOf(offer, items, pricing)
  const status = str(offer.status)
  const out = outcomeOf(offer, rfq, hasOwnPo, disclosed, posById)
  const o: DealOffer = { status: "review", v }
  const hasReduce = status === "مطلوب تخفيض"
  const sample = str(offer.sampleStatus)

  if (isWithdrawnOffer(offer as { status?: string; withdrawnAt?: unknown })) {
    o.status = "withdrawn"
    // The day he withdrew it, not the day it is looked at (OFR-04).
    o.out = { at: dayOf(offer.withdrawnAt) || dayOf(offer.updatedAt) || today }
    return o
  }
  if (out) {
    o.status = out.st
    o.out = { at: out.at, why: out.why }
    if (out.st === "won") o.wonAt = out.at
    return o
  }
  if (hasReduce) {
    const at = dayOf(offer.reductionAt) || dayOf(offer.decidedAt) || dayOf(offer.updatedAt) || today
    o.status = "reduce"
    o.reduce = {
      at,
      target: numOf(offer.targetPrice) || targetOfLines(offer, items),
      by: dayOf(offer.reductionBy) || addDaysTo(at, 3),
      note: str(offer.reductionNote),
    }
    return o
  }
  if (sample === "مطلوبة") {
    const at = dayOf(offer.sampleRequestedAt) || dayOf(offer.sampleUpdatedAt) || today
    o.status = "sample"
    o.sample = { at, what: str(offer.sampleWhat) || str(offer.sampleNo), place: str(offer.samplePlace), by: dayOf(offer.sampleBy) || addDaysTo(at, 5) }
    return o
  }
  if (sample === "تم الإرسال" || sample === "تم الاستلام") {
    const at = dayOf(offer.sampleRequestedAt) || dayOf(offer.sampleUpdatedAt) || today
    o.status = "sampleSent"
    o.sample = {
      at,
      what: str(offer.sampleWhat) || str(offer.sampleNo),
      place: str(offer.samplePlace),
      by: dayOf(offer.sampleBy) || addDaysTo(at, 5),
      sentAt: dayOf(offer.sampleSentAt) || dayOf(offer.sampleUpdatedAt) || at,
      receivedBy: str(offer.sampleReceivedBy) || undefined,
      note: str(offer.sampleNote) || undefined,
    }
    return o
  }
  return o
}

/** A round's line targets × quantities, before VAT — what a cut asked when no total was named. */
function targetOfLines(offer: Rec, items: DealItem[]): number {
  const targets = Array.isArray(offer.reductionTargets) ? (offer.reductionTargets as Rec[]) : []
  let sum = 0
  for (const t of targets) {
    const item = items[numOf(t.rfqProductIndex)]
    if (!item) return 0
    sum += numOf(t.unitPrice) * item.qty
  }
  return Math.round(sum * 100) / 100
}

function termsOfPo(po: PurchaseOrder & Rec): PaymentTerm[] {
  const list = Array.isArray(po.termsList) ? (po.termsList as Rec[]) : null
  if (list && list.length) return list.map((x) => ({ pct: numOf(x.pct), days: numOf(x.days) }))
  const adv = numOf(po.advancePercent)
  const credit = numOf(po.creditDays)
  if (adv > 0 && adv < 100) return [{ pct: adv, days: 0 }, { pct: 100 - adv, days: credit || 30 }]
  return [{ pct: 100, days: credit || 30 }]
}

function declineOf(po: Rec): DealPo["decl"] | undefined {
  const d = po.supplierDecline as Rec | undefined
  if (!d) return undefined
  return { at: dayOf(d.at), why: (str(d.reason) || "other") as NonNullable<DealPo["decl"]>["why"], note: str(d.note) || undefined }
}

export interface DeriveContext {
  myOrgId: string
  today: string
}

export function deriveWorld(raw: RawWorld): World {
  const { today, myOrgId } = raw
  const posById = new Map(raw.pos.map((p) => [p.id, p]))
  const posByRfq = new Map<string, PurchaseOrder[]>()
  for (const p of raw.pos) {
    if (!p.rfqId) continue
    const arr = posByRfq.get(p.rfqId) || []
    arr.push(p)
    posByRfq.set(p.rfqId, arr)
  }
  const offersByRfq = new Map<string, RawOffer>()
  for (const o of raw.offers) {
    const rid = str(o.rfqId)
    if (!rid) continue
    const prev = offersByRfq.get(rid)
    if (!prev || dayOf(o.updatedAt) >= dayOf(prev.updatedAt)) offersByRfq.set(rid, o)
  }
  const receiptsByPo = new Map<string, RawDelivery[]>()
  for (const d of raw.deliveries) {
    const pid = str(d.poId)
    if (!pid || d.status !== "confirmed") continue
    const arr = receiptsByPo.get(pid) || []
    arr.push(d)
    receiptsByPo.set(pid, arr)
  }
  const invoicesByPo = groupBy(raw.invoices, "poId")
  const transfersByPo = groupBy(raw.transfers, "poId")
  const warrantyByPo = new Map(raw.warranties.map((w) => [str(w.poId), w]))
  const chatByOffer = new Map(raw.chats.map((c) => [str(c.id), c]))

  const contractors: Record<string, ContractorRef> = {}
  const linkBy = new Map(raw.links.filter((l) => l.status === "active").map((l) => [str(l.contractorOrgId), l]))
  const refOf = (orgId: string): string => {
    if (!contractors[orgId]) {
      const f = raw.contractors[orgId] || {}
      const link = linkBy.get(orgId)
      contractors[orgId] = {
        name: str(f.companyName) || str(f.name) || "—",
        city: str(f.city),
        phone: str(f.phone),
        conn: link ? dayOf(link.createdAt) || dayOf(link.updatedAt) || today : null,
        verified: !!f.isVerified,
      }
    }
    return orgId
  }

  const deals: Deal[] = []
  for (const rfq of raw.rfqs) {
    const items = rfqItems(rfq)
    const orgId = str(rfq.organizationId) || str(rfq.contractorId)
    const offer = offersByRfq.get(rfq.id) || null
    const pos = (posByRfq.get(rfq.id) || []).filter((p) => p.supplierOrgId === myOrgId && supplierSegmentOf(p) != null)
    const po = pos.sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))[0] || null
    // A request the supplier never quoted and that is no longer open is not his to see.
    if (!offer && str(rfq.status) !== "New") continue
    const declinedMark = !offer ? raw.declined[rfq.id] : undefined
    const terms = termsListOf(rfq.paymentTermsList)

    const pricing: "item" | "total" = str(rfq.pricingMode) === "line" ? "item" : "total"
    const channel = channelOf(rfq, myOrgId, offer)
    const district = str(rfq.district)
    const deal: Deal = {
      id: rfq.id,
      // The contractor's own number as a word; an RFQ from before numbering reads by its title, never an id fragment.
      rfq: bareNumber(rfq.rfqNumber) || shortTitle(str(rfq.title), items),
      c: refOf(orgId),
      title: shortTitle(str(rfq.title), items),
      city: district ? `${str(rfq.city)} — ${district}` : str(rfq.city),
      cat: str(rfq.category),
      channel,
      posted: dayOf(rfq.createdAt) || dayOf(rfq.publishedAt) || today,
      deadline: dayOf(rfq.deadline),
      needBy: dayOf(rfq.needBy),
      pricing,
      items,
      files: Array.isArray(rfq.attachments)
        ? (rfq.attachments as Rec[]).map((a) => ({ n: str(a.name) || str(a.fileName) || "file", s: str(a.size), url: str(a.url) || undefined }))
        : rfq.pdfUrl
          ? [{ n: "RFQ.pdf", s: "", url: str(rfq.pdfUrl) }]
          : [],
      qa: (raw.questions[rfq.id] || []).map((q) => ({ q: str(q.question), a: str(q.reply) || null, at: dayOf(q.createdAt) })),
      offer: null,
      po: null,
      ship: [],
      invs: [],
      pays: [],
      msgs: [],
      log: [],
    }
    if (terms) deal.terms = terms

    if (offer) {
      const disclosed = !offer.poId || awardDisclosed({ status: str(offer.status), poId: str(offer.poId), awaitingOrderApproval: !!offer.awaitingOrderApproval }, posById as ReadonlyMap<string, PurchaseOrder>)
      deal.offer = offerOf(offer, rfq, items, pricing, !!po, disclosed, today, posById as ReadonlyMap<string, PurchaseOrder>)
      const chat = chatByOffer.get(offer.id)
      if (chat) deal.chat = { last: str(chat.lastMessage), lastAt: dayOf(chat.updatedAt), unread: numOf((chat.unreadCounts as Rec | undefined)?.[raw.myUid]) || (Array.isArray(chat.unreadFor) && (chat.unreadFor as string[]).includes(raw.myUid) ? 1 : 0), chatId: offer.id }
      if (!deal.chat && deal.offer) deal.chat = { last: "", lastAt: "", unread: 0, chatId: offer.id }
    }

    if (po && deal.offer) {
      const p = po as PurchaseOrder & Rec
      const itemId = (l: { id: string; rfqProductIndex?: number | null }): string => (l.rfqProductIndex != null && items[l.rfqProductIndex] ? items[l.rfqProductIndex].id : l.id)
      const lump = p.lines.some((l) => l.unitPrice == null)
      const lines: PoLineFact[] = p.lines.map((l) => {
        const id = itemId(l)
        if (!items.some((i) => i.id === id)) items.push({ id, name: l.name, unit: l.unit, qty: l.quantity, spec: "" })
        return { it: id, qty: l.quantity, price: l.unitPrice, got: l.accepted || 0, rej: l.rejected || 0, can: l.cancelled || 0, held: l.held || 0 }
      })
      const dec = declineOf(p)
      deal.po = {
        no: bareNumber(p.docNumber),
        at: dayOf(p.sentAt) || dayOf(p.createdAt),
        lines,
        need: dayOf(p.requestedDeliveryDate) || deal.needBy,
        acc: p.supplierAcceptedAt && p.promisedDate ? { at: dayOf(p.supplierAcceptedAt), date: dayOf(p.promisedDate) } : null,
        site: str(p.deliveryLocation),
        rcv: str(p.receiverName),
        terms: termsOfPo(p),
        lump: lump ? p.totalExVat : null,
        cancelNote: str((p.lines.find((l) => l.cancelReason) || {}).cancelReason) || undefined,
        decl: dec,
      }
      if (dec || (p.status === "cancelled" && dec)) deal.closed = { k: "declined", at: dec?.at || today }
      else if (p.status === "cancelled") deal.closed = { k: "cancelled", at: dayOf(p.closedAt) || today }

      // Receipts the contractor recorded, and the supplier's reports still waiting for one.
      const rcpts = (receiptsByPo.get(p.id) || []).sort((a, b) => str(a.confirmedAt).localeCompare(str(b.confirmedAt)))
      for (const r of rcpts) {
        const items2: Record<string, number> = {}
        const got: Record<string, number> = {}
        const why: Record<string, string> = {}
        for (const l of Array.isArray(r.lines) ? (r.lines as Rec[]) : []) {
          const pl = p.lines.find((x) => x.id === l.poLineId)
          if (!pl) continue
          const id = itemId(pl)
          const counted = numOf(l.counted ?? l.noticeQuantity)
          items2[id] = counted
          got[id] = l.accepted != null ? numOf(l.accepted) : Math.max(0, counted - numOf(l.rejected) - numOf(l.held))
          const reason = str(l.rejectNote) || str(l.rejectReason)
          if (reason && got[id] < counted) why[id] = reason
        }
        const rcp: DealReceipt = {
          st: "ok",
          grn: str(r.docNumber) || r.id,
          date: dayOf(r.deliveryDate) || dayOf(r.confirmedAt),
          okAt: dayOf(r.confirmedAt),
          t: timeOf(r.confirmedAt),
          by: str(r.confirmedByName),
          items: items2,
          got,
          chk: (Array.isArray(r.checklist) ? (r.checklist as unknown[]) : []).map((c) => CHECK_MAP[str(c)]).filter(Boolean),
          note: str(r.receiptNote) || undefined,
        }
        if (Object.keys(why).length) rcp.why = why
        deal.ship.push(rcp)
      }
      const reports = Array.isArray(p.deliveryReports) ? (p.deliveryReports as unknown as Rec[]) : []
      for (const r of reports) {
        if (r.closedAt) continue
        const rep: DealReport = { st: "wait", at: dayOf(r.at), date: dayOf(r.date), note: str(r.note) || undefined }
        if (Array.isArray(r.reminders) && r.reminders.length) rep.reminders = (r.reminders as unknown[]).map((x) => dayOf(x))
        deal.ship.push(rep)
      }

      for (const i of invoicesByPo.get(p.id) || []) {
        const inv: DealInvoice = {
          no: str(i.number),
          date: dayOf(i.date),
          amt: numOf(i.amountNet),
          file: str((i.file as Rec | undefined)?.name) || str(i.fileName),
          fileUrl: str((i.file as Rec | undefined)?.url) || undefined,
          grns: Array.isArray(i.grns) ? (i.grns as unknown[]).map(str) : [],
          id: str(i.id),
        }
        deal.invs.push(inv)
      }
      deal.invs.sort((a, b) => dayNum(a.date || "1970-01-01") - dayNum(b.date || "1970-01-01"))

      for (const t of transfersByPo.get(p.id) || []) {
        const st = str(t.state)
        const pay: DealTransfer = {
          at: dayOf(t.reportedAt),
          amt: numOf(t.amount),
          bank: str(t.bank),
          ref: str(t.ref),
          st: st === "ok" || st === "miss" ? st : "sent",
          okAt: dayOf(t.confirmedAt) || undefined,
          note: str(t.note) || undefined,
          id: str(t.id),
        }
        deal.pays.push(pay)
      }
      deal.pays.sort((a, b) => dayNum(a.at || "1970-01-01") - dayNum(b.at || "1970-01-01") || str(a.id).localeCompare(str(b.id)))

      const w = warrantyByPo.get(p.id)
      if (w) {
        const wr: DealWarranty = { it: str(w.itemId), until: dayOf(w.until), file: str((w.file as Rec | undefined)?.name) || str(w.fileName), at: dayOf(w.createdAt), st: str(w.state) === "ok" ? "ok" : "wait", okAt: dayOf(w.acceptedAt) || undefined }
        deal.war = wr
      }
    } else if (declinedMark) {
      // He declined to quote: no quote exists, so none is counted in My quotes (RFQ-13, WF-02) — the request closes.
      deal.closed = { k: "noquote", at: dayOf(declinedMark.at) || today }
    } else if (deal.offer && deal.offer.status === "lost" && deal.offer.out) {
      deal.closed = { k: "lost", at: deal.offer.out.at }
    } else if (deal.offer && ["noaward", "withdrawn"].includes(deal.offer.status)) {
      deal.closed = { k: deal.offer.status, at: deal.offer.out?.at || today }
    }

    const rated = offer && (offer.supplierRatedAt || offer.supplierRated)
    if (rated && offer && typeof offer.supplierRating === "object" && offer.supplierRating) {
      const r = offer.supplierRating as Rec
      deal.rated = { stars: numOf(r.stars), text: str(r.text), at: dayOf(r.at) }
    }
    deals.push(deal)
  }

  // A deal with an order that is fully received, billed and paid is finished (stage "done").
  for (const d of deals) {
    if (!d.po || d.closed) continue
    const allIn = d.po.lines.every((l) => l.qty - l.got - l.can <= 0)
    if (!allIn || !d.invs.length) continue
    const gross = d.invs.reduce((s, i) => s + i.amt * 1.15, 0)
    const paid = d.pays.filter((p) => p.st === "ok").reduce((s, p) => s + p.amt, 0)
    const billed = d.po.lump != null ? d.po.lump : d.po.lines.reduce((s, l) => s + l.got * (l.price || 0), 0)
    if (gross - paid <= 0.01 && d.invs.reduce((s, i) => s + i.amt, 0) >= billed - 0.01) {
      const last = d.pays.filter((p) => p.st === "ok").map((p) => p.okAt || p.at).sort().pop() || today
      d.closed = { k: "paid", at: last }
    }
  }

  const invites: ConnectionInvite[] = raw.invitations
    .filter((i) => i.type === "supplier_invite" && (i.status === "pending" || !i.status))
    .map((i) => ({ id: str(i.id), c: refOf(str(i.contractorOrgId) || str(i.invitedBy)), at: dayOf(i.createdAt), note: str(i.message), u: 1 as const }))

  const requests = raw.links.filter((l) => l.status === "pending" && l.requestedBy === "supplier").map((l) => ({ c: refOf(str(l.contractorOrgId)), at: dayOf(l.requestedAt) || dayOf(l.updatedAt) || today }))

  const arch: Record<string, 1> = {}
  for (const k of Object.keys(raw.archived || {})) if (raw.archived[k]) arch[k] = 1
  const seen: Record<string, 1> = {}
  for (const k of Object.keys(raw.seen || {})) if (raw.seen[k]) seen[k] = 1

  return { deals, contractors, invites, requests, arch, seen }
}

function groupBy(list: Rec[], key: string): Map<string, Rec[]> {
  const m = new Map<string, Rec[]>()
  for (const x of list) {
    const k = str(x[key])
    if (!k) continue
    const a = m.get(k) || []
    a.push(x)
    m.set(k, a)
  }
  return m
}

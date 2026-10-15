// The supplier's quote and what blocks it (PRD OFR-01…05). `quoteBlocks` is the one list of reasons the form
// shows live and the write runs again; the builders write the fields every older reader has always used
// (`price` as a string, `lines`, `deliveryBatches`, `validUntil`, `status`) beside the new `versions`, so the
// contractor's comparison, award and mobile app keep working without knowing this journey exists.

import { addDoc, arrayUnion, collection, doc, increment, setDoc, updateDoc, type DocumentData, type Firestore, type UpdateData } from "firebase/firestore"
import { pricedProducts, revisePrice, toAmount } from "@/lib/procurement/offer-pricing"
import { UNDER_REVIEW } from "@/lib/procurement/supplier"
import { newOfferNotice, newOfferNoticeId } from "@/lib/procurement/offer-announce"
import { VAT, r2, type DealLogic } from "./deal-logic"
import { tellAboutRfq, type SupplierSide } from "./events"
import type { Deal } from "./types"

export type QuoteMode = "new" | "edit" | "reduce"

export interface QuoteValues {
  /** Unit price typed per item id (`i1`…). */
  prices: Record<string, string>
  /** Items the supplier does not supply. */
  skip: Record<string, boolean>
  total: string
  arrive: string
  valid: string
  note: string
}

export type QuoteBlock = "total" | "zero" | "oneItem" | "deadline" | "valid"

export interface QuoteCheck {
  blocks: { code: QuoteBlock; item?: string }[]
  net: number
  vat: number
  gross: number
  /** Net per item id, for the live line totals. */
  lines: Record<string, number | null>
}

/** The reasons a quote cannot go, in the order they are shown, and the figures it would carry (net, VAT, gross). */
export function quoteBlocks(deal: Deal, v: QuoteValues, mode: QuoteMode, L: Pick<DealLogic, "daysTo">): QuoteCheck {
  const blocks: QuoteCheck["blocks"] = []
  const lines: Record<string, number | null> = {}
  let net = 0
  if (deal.pricing === "total") {
    const t = toAmount(v.total)
    net = t
    if (!(t > 0)) blocks.push({ code: "total" })
  } else {
    let priced = 0
    for (const i of deal.items) {
      if (v.skip[i.id]) {
        lines[i.id] = null
        continue
      }
      const raw = String(v.prices[i.id] ?? "").trim()
      const p = toAmount(raw)
      if (raw === "") {
        lines[i.id] = null
        continue
      }
      if (p <= 0) {
        blocks.push({ code: "zero", item: i.name })
        lines[i.id] = null
        continue
      }
      priced += 1
      lines[i.id] = r2(p * i.qty)
      net += p * i.qty
    }
    if (!priced) blocks.push({ code: "oneItem" })
  }
  if (mode !== "reduce" && L.daysTo(deal.deadline) < 0) blocks.push({ code: "deadline" })
  if (!v.valid) blocks.push({ code: "valid" })
  net = r2(net)
  return { blocks, net, vat: r2(net * VAT), gross: r2(net * (1 + VAT)), lines }
}

export interface QuoteContext {
  firestore: Firestore
  uid: string
  orgId: string
  userName: string
  companyName: string
  today: string
  /** The request document as stored (`products[]`, `deliveryLocation`, `projectId`…). */
  rfq: Record<string, unknown> & { id: string }
  deal: Deal
  /** The supplier's CR and VAT certificates travel with the quote. */
  papers: { kind: string; url: string; name?: string }[]
  fileUrl?: string | null
  side: SupplierSide
}

const pickRates = (deal: Deal, v: QuoteValues): Record<number, string> => {
  const rates: Record<number, string> = {}
  deal.items.forEach((i, n) => {
    if (!v.skip[i.id] && String(v.prices[i.id] ?? "").trim() !== "") rates[n] = v.prices[i.id]
  })
  return rates
}

/** The stored version a form becomes. */
export function versionOf(deal: Deal, v: QuoteValues, today: string, fileUrl?: string | null) {
  const out: Record<string, unknown> = { at: today, arrive: v.arrive || null, valid: v.valid, note: v.note.trim().slice(0, 1000), fileUrl: fileUrl || null }
  if (deal.pricing === "total") out.total = r2(toAmount(v.total))
  else {
    const lines: { rfqProductIndex: number; unitPrice: number }[] = []
    deal.items.forEach((i, n) => {
      const rate = r2(toAmount(v.prices[i.id]))
      if (!v.skip[i.id] && rate > 0) lines.push({ rfqProductIndex: n, unitPrice: rate })
    })
    out.lines = lines
    out.total = r2(lines.reduce((s, l) => s + l.unitPrice * deal.items[l.rfqProductIndex].qty, 0))
  }
  return out
}

/** A first quote: the document every reader of `offers` understands, plus `versions`. */
export async function submitNewQuote(ctx: QuoteContext, v: QuoteValues): Promise<string> {
  const { firestore, rfq, deal } = ctx
  const check = quoteBlocks(deal, v, "new", { daysTo: (iso, from) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from ?? ctx.today}T00:00:00Z`)) / 864e5) })
  if (check.blocks.length) throw new Error(`QUOTE_BLOCKED:${check.blocks[0].code}`)
  const version = versionOf(deal, v, ctx.today, ctx.fileUrl)
  const price = String(version.total)
  const location = String(rfq.deliveryLocation || rfq.district || rfq.city || "")
  const data: Record<string, unknown> = {
    supplierId: ctx.uid,
    organizationId: ctx.orgId,
    supplierName: ctx.companyName || "—",
    companyName: ctx.companyName || "",
    submittedByUserId: ctx.uid,
    submittedByUserName: ctx.userName,
    rfqId: rfq.id,
    rfqTitle: String(rfq.title || ""),
    projectId: (rfq.projectId as string) || null,
    contractorId: (rfq.contractorId as string) || null,
    contractorOrgId: (rfq.organizationId as string) || (rfq.contractorId as string) || null,
    price,
    deliveryLocation: location,
    deliveryBatches: [{ location, deliveryDate: v.arrive || "", price, quantity: String(deal.items.reduce((s, i) => s + i.qty, 0) || "") }],
    validUntil: v.valid,
    status: UNDER_REVIEW,
    versions: [version],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (deal.pricing === "item") data.lines = version.lines
  if (ctx.fileUrl) data.offerPdfUrl = ctx.fileUrl
  if (v.note.trim()) data.supplierNote = v.note.trim().slice(0, 1000)
  if (ctx.papers.length) data.supplierPapers = ctx.papers
  const skipped = deal.items.map((i, n) => (v.skip[i.id] ? n : -1)).filter((n) => n >= 0)
  if (skipped.length) data.skippedItems = skipped

  const ref = await addDoc(collection(firestore, "offers"), data)
  // The server tells the contractor (it knows whether the round is sealed); if it cannot be reached, say so without an amount.
  try {
    await updateDoc(doc(firestore, "rfqs", rfq.id), { offersCount: increment(1) })
  } catch (err) {
    console.error("offersCount", err)
  }
  const contractorId = (rfq.contractorId as string) || null
  if (contractorId) {
    let told = false
    try {
      const { getAuth } = await import("firebase/auth")
      const token = await getAuth().currentUser?.getIdToken()
      if (token) {
        const res = await fetch("/api/sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind: "new_offer", offerId: ref.id }) })
        told = res.ok
      }
    } catch (err) {
      console.error("new_offer notice", err)
    }
    if (!told) {
      const notice = newOfferNotice({ supplier: ctx.companyName, rfqTitle: String(rfq.title || ""), price: null, sealed: false })
      await setDoc(doc(firestore, "users", contractorId, "notifications", newOfferNoticeId(ref.id)), {
        userId: contractorId,
        organizationId: (rfq.organizationId as string) || contractorId,
        type: "new_offer",
        i18n: notice.i18n,
        title: notice.title,
        message: notice.message,
        offerId: ref.id,
        rfqId: rfq.id,
        createdAt: new Date().toISOString(),
        read: false,
      }).catch((e) => console.error("offer notice fallback", e))
    }
  }
  return ref.id
}

/** A new version of an open quote: an edit before the deadline, or the reply to a price cut (WF-03, WF-04). */
export async function submitNextVersion(ctx: QuoteContext, offerId: string, v: QuoteValues, mode: Exclude<QuoteMode, "new">, current: Record<string, unknown>): Promise<void> {
  const { firestore, rfq, deal } = ctx
  const check = quoteBlocks(deal, v, mode, { daysTo: (iso, from) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from ?? ctx.today}T00:00:00Z`)) / 864e5) })
  if (check.blocks.length) throw new Error(`QUOTE_BLOCKED:${check.blocks[0].code}`)
  const version = versionOf(deal, v, ctx.today, ctx.fileUrl)
  const products = pricedProducts({ pricingMode: String(rfq.pricingMode || ""), shipmentMode: String(rfq.shipmentMode || ""), products: (rfq.products as never) || [] })
  // The same revision the contractor-side readers expect: price, rates and batches that agree with each other.
  const rev = revisePrice(
    { price: current.price as string, lines: (current.lines as never) || [], deliveryBatches: (current.deliveryBatches as never) || [], totalBatchesPrice: current.totalBatchesPrice as never },
    deal.pricing === "item" ? products : null,
    { total: String(version.total), rates: deal.pricing === "item" ? pickRates(deal, v) : undefined }
  )
  const fields: Record<string, unknown> = rev.ok ? { ...rev.fields } : { price: String(version.total) }
  if (deal.pricing === "item" && Array.isArray(version.lines)) fields.lines = version.lines
  const prev = Number(current.price)
  const history = Number.isFinite(prev) && prev > 0 ? { price: String(current.price), replacedAt: new Date().toISOString(), by: ctx.uid } : null
  const patch: Record<string, unknown> = {
    ...fields,
    price: String(version.total),
    validUntil: v.valid,
    status: UNDER_REVIEW,
    versions: arrayUnion(version),
    updatedAt: new Date().toISOString(),
    supplierNote: v.note.trim().slice(0, 1000),
  }
  if (history) patch.priceHistory = arrayUnion(history)
  if (ctx.fileUrl) patch.offerPdfUrl = ctx.fileUrl
  if (v.arrive) {
    const batches = (fields.deliveryBatches as Record<string, unknown>[] | undefined) || (current.deliveryBatches as Record<string, unknown>[] | undefined) || []
    patch.deliveryBatches = batches.length ? batches.map((b, i) => (i === 0 ? { ...b, deliveryDate: v.arrive } : b)) : [{ location: String(rfq.city || ""), deliveryDate: v.arrive, price: String(version.total), quantity: "" }]
  }
  if (mode === "reduce") patch.reductionReply = { at: ctx.today, kind: "lowered" }
  await updateDoc(doc(firestore, "offers", offerId), patch as UpdateData<DocumentData>)
  const n = Array.isArray(current.versions) ? (current.versions as unknown[]).length + 1 : 2
  await tellAboutRfq(firestore, ctx.side, rfq, "sup_quote_version", { n }, offerId)
}

/** "My price is final": the supplier keeps his price and the quote returns to awaiting decision (WF-04). */
export async function submitFinalPrice(ctx: QuoteContext, offerId: string, note: string): Promise<void> {
  await updateDoc(doc(ctx.firestore, "offers", offerId), { status: UNDER_REVIEW, reductionReply: { at: ctx.today, kind: "final", note: note.trim().slice(0, 500) }, updatedAt: new Date().toISOString() })
  await tellAboutRfq(ctx.firestore, ctx.side, ctx.rfq, "sup_quote_final", { note: note.trim() }, offerId)
}

/** Withdraw a quote while submissions are open (WF-03). */
export async function withdrawQuote(ctx: QuoteContext, offerId: string): Promise<void> {
  await updateDoc(doc(ctx.firestore, "offers", offerId), { withdrawnAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  await tellAboutRfq(ctx.firestore, ctx.side, ctx.rfq, "sup_quote_withdrawn", {}, offerId)
}

/** "Sample sent": the date it left and who received it (WF-05). */
export async function confirmSample(ctx: QuoteContext, offerId: string, input: { sentAt: string; receivedBy: string; note?: string }): Promise<void> {
  await updateDoc(doc(ctx.firestore, "offers", offerId), {
    sampleStatus: "تم الإرسال",
    sampleSentAt: input.sentAt,
    sampleReceivedBy: input.receivedBy.trim().slice(0, 120),
    sampleUpdatedAt: new Date().toISOString(),
    ...(input.note?.trim() ? { guestReplyNote: input.note.trim().slice(0, 500) } : {}),
  })
  await tellAboutRfq(ctx.firestore, ctx.side, ctx.rfq, "sup_sample_sent", { date: input.sentAt, by: input.receivedBy.trim(), note: (input.note || "").trim() }, offerId)
}

/** "I will not quote": an invitation that names him closes as declined, leaves the list and the tasks, and the contractor is told (WF-02). */
export async function declineInvitation(ctx: Omit<QuoteContext, "fileUrl" | "papers">, note: string): Promise<void> {
  await setDoc(
    doc(ctx.firestore, "supplierWorkspace", ctx.orgId),
    { organizationId: ctx.orgId, declined: { [ctx.rfq.id]: { at: ctx.today, note: note.trim().slice(0, 500) } } },
    { merge: true }
  )
  await tellAboutRfq(ctx.firestore, ctx.side, ctx.rfq, "sup_invite_declined", { note: note.trim() })
}

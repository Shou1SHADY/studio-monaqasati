// The manual goods receipt on the server (PRD 2.0 RCV-05, WF-20, WP-S5-03b): something bought OUTSIDE the platform. It is tagged «يدوي»
// and listed under «بلا أمر شراء». Where it goes decides what it does — at a SITE (a project's own store) it lands at once, recorded by
// the buyer and charged to the site; at a MAIN WAREHOUSE it reaches Inventory as a DRAFT the storekeeper confirms (`proc:GRN:<no>:MAN`),
// and no stock moves before he does. The buyer also says what comes next: an order raised later, or a cash expense with no order.
// One Admin transaction numbers it (`GR-yyyy/NNN`) and writes it; stock, events and notices follow the commit, best-effort.

import { FieldValue, type Firestore } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"
import { notifyNamed } from "@/lib/supplier-free/server-notify"
import { manualReceiptKey } from "./event-keys"
import type { ManualReceiptBody } from "./manual-receipt-form"
import { sendProcEvent } from "./proc-event-server"
import { centralWarehouseId, landStock, resolveLanding } from "./receipt-effects-server"
import { projectSiteId, storedSites } from "./delivery-sites"
import { PRICE_HISTORY, materialKey, specKeyOf } from "./prices"
import { round2 } from "./po"
import { PROCUREMENT_SETTINGS, type DeliveryLine } from "./types"

export type ManualReceiptRefusalCode = "site_missing" | "date_future" | "delivery_missing" | "not_a_draft" | "not_yours"

const STATUS: Record<ManualReceiptRefusalCode, number> = { site_missing: 400, date_future: 400, delivery_missing: 404, not_a_draft: 409, not_yours: 403 }

export class ManualReceiptRefusal extends Error {
  readonly status: number
  constructor(readonly code: ManualReceiptRefusalCode) {
    super(code)
    this.name = "ManualReceiptRefusal"
    this.status = STATUS[code]
  }
}

export interface ManualCaller {
  uid: string
  name: string
  orgId: string
}

export interface ManualReceiptResult {
  deliveryId: string
  docNumber: string
  /** At a main warehouse: a draft the storekeeper confirms. */
  draft: boolean
  stockLanded: boolean
}

type Doc = Record<string, unknown>

const yearOf = (now: Date) => Number(riyadhDay(now).slice(0, 4))

export async function createManualReceipt(db: Firestore, caller: ManualCaller, body: ManualReceiptBody, now: Date = new Date()): Promise<ManualReceiptResult> {
  const orgId = caller.orgId
  if (body.deliveryDate > riyadhDay(now)) throw new ManualReceiptRefusal("date_future")
  const place = await resolveManualPlace(db, orgId, body)
  const draft = place.kind === "main"
  const recordOnly = place.kind === "site"
  const warehouseId = place.warehouseId
  const at = now.toISOString()
  const ref = db.collection("deliveries").doc()
  // RC-03: a row carries the tree's material and its specification key, so the purchase joins price history and the material drawer.
  const specOf = (it: ManualReceiptBody["items"][number]) => (it.material ? specKeyOf({ name: it.name, unit: it.unit, material: it.material }) : { materialId: null, specKey: null })
  const material = (it: ManualReceiptBody["items"][number]) => {
    const k = specOf(it)
    return {
      ...(it.material ? { material: it.material } : {}),
      ...(k.specKey ? { materialId: k.materialId, specKey: k.specKey } : {}),
      ...(it.invoiceName ? { invoiceName: it.invoiceName } : {}),
    }
  }
  const items = body.items.map((it) => ({ itemId: null, name: it.name, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice ?? null, ...material(it) }))
  const lines: DeliveryLine[] = body.items.map((it, i) => ({ poLineId: `i${i + 1}`, name: it.name, unit: it.unit, noticeQuantity: 0, counted: it.quantity, rejected: 0, held: 0, accepted: it.quantity, ...material(it) }))
  const year = yearOf(now)
  const counter = db.collection("mfgCounters").doc(`${orgId}__GR__${year}`)

  const docNumber = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counter)
    const last = snap.exists ? Number((snap.data() as Doc).last) || 0 : 0
    const number = formatYearlyDocNumber("GR", year, last + 1)
    tx.set(counter, { organizationId: orgId, type: "GR", year, last: last + 1, updatedAt: FieldValue.serverTimestamp() })
    tx.create(ref, {
      contractorOrgId: orgId,
      contractorId: caller.uid,
      supplierName: body.supplierName,
      supplierGuessOrgId: body.supplierOrgId || null,
      deliveryDate: body.deliveryDate,
      notes: body.notes || null,
      receiptNote: body.notes || null,
      warehouseId,
      landedWarehouseId: draft || recordOnly ? null : warehouseId,
      projectId: place.projectId,
      ...(recordOnly ? { deliverySiteId: place.siteId, deliverySiteName: place.name, recordOnly: true } : {}),
      items,
      lines,
      docNumber: number,
      invoiceNumber: body.invoiceNumber || null,
      paperNoteNumber: body.invoiceNumber || null,
      invoiceValue: body.invoiceValue ?? null,
      after: body.after,
      status: "confirmed",
      source: "manual",
      recordedBy: "procurement_manual",
      receiverModule: draft ? "inventory" : recordOnly && !place.projectId ? "inventory" : "projects",
      receivedByName: caller.name,
      confirmedByUserId: caller.uid,
      confirmedByName: caller.name,
      confirmedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      attachmentUrls: body.attachments.map((a) => a.url),
      postedNet: null,
      selfReceived: false,
      ...(draft ? { manualDraft: { state: "draft", warehouseId, byId: caller.uid, byName: caller.name, at } } : {}),
      ...(body.after === "cash" ? { regularisation: "expense", regularisedAt: at, regularisedById: caller.uid, regularisedByName: caller.name } : {}),
    })
    return number
  })

  const stockLanded = draft || recordOnly || !warehouseId ? false : await landManual(db, orgId, warehouseId, items)
  await recordManualPrices(db, { orgId, deliveryId: ref.id, docNumber, day: body.deliveryDate, supplierName: body.supplierName, supplierOrgId: body.supplierOrgId || null, items: body.items })
  await sendProcEvent(db, { id: "receipt_manual", key: manualReceiptKey(docNumber), organizationId: orgId, by: caller.uid, at, refs: { grn: docNumber, ...(warehouseId ? { warehouse: warehouseId } : { site: place.siteId || "" }) }, payload: { supplier: body.supplierName, lines: lines.length, draft, after: body.after, ...(recordOnly ? { recordOnly: true } : {}) } })
  const who = { uid: caller.uid, name: caller.name }
  const common = { organizationId: orgId, poId: null, link: `/contractor/goods-received?tab=nopo&delivery=${ref.id}` }
  await notifyNamed(db, who, { kind: "receipt_manual", ...common, params: { receipt: docNumber, supplier: body.supplierName, order: draft ? " — مسودة بانتظار تأكيد أمين المستودع" : "" } }, [], { permissions: ["invoices.manage", "accounting.post"] }).catch(warn)
  if (draft) await notifyNamed(db, who, { kind: "receipt_manual", ...common, params: { receipt: docNumber, supplier: body.supplierName, order: " — بانتظار تأكيدك" }, link: `/contractor/goods-received?tab=nopo&delivery=${ref.id}` }, [], { permissions: ["warehouses.receive", "warehouses.manage"], owner: false }).catch(warn)
  if (body.after === "cash") await notifyNamed(db, who, { kind: "receipt_expensed", ...common, params: { receipt: docNumber, supplier: body.supplierName } }, [], { permissions: ["invoices.manage", "accounting.post"] }).catch(warn)
  return { deliveryId: ref.id, docNumber, draft, stockLanded }
}

const warn = (err: unknown) => console.warn("manual receipt notice failed:", (err as { code?: string })?.code || err)

/** Where a manual receipt goes (RC-04): a project's store (lands at once), a main store (a draft the storekeeper confirms), or a
 * delivery site with no store — a work site — where it is a RECORD of what arrived, and no stock moves. */
export interface ManualPlaceResolved {
  kind: "project" | "main" | "site"
  warehouseId: string | null
  siteId: string | null
  projectId: string | null
  name: string | null
}

export async function resolveManualPlace(db: Firestore, orgId: string, body: Pick<ManualReceiptBody, "warehouseId" | "siteId">): Promise<ManualPlaceResolved> {
  if (body.warehouseId) {
    // The company's central store is made the first time anything needs it, with the id everyone uses.
    if (body.warehouseId === centralWarehouseId(orgId)) await resolveLanding(db, orgId, { warehouseId: body.warehouseId })
    const wh = (await db.collection("warehouses").doc(body.warehouseId).get()).data() as { organizationId?: string; projectId?: string | null; name?: string } | undefined
    if (!wh || wh.organizationId !== orgId) throw new ManualReceiptRefusal("site_missing")
    return { kind: wh.projectId ? "project" : "main", warehouseId: body.warehouseId, siteId: null, projectId: wh.projectId || null, name: wh.name || null }
  }
  const siteId = body.siteId || ""
  if (!siteId) throw new ManualReceiptRefusal("site_missing")
  const settings = (await db.collection(PROCUREMENT_SETTINGS).doc(orgId).get()).data() as { deliverySites?: unknown } | undefined
  const site = storedSites(settings?.deliverySites).find((s) => s.id === siteId && !s.retired)
  if (site) {
    // A stored site that IS a store is that store (the browser sends the store; this is the belt to its braces).
    if (site.warehouseId) return resolveManualPlace(db, orgId, { warehouseId: site.warehouseId })
    return { kind: "site", warehouseId: null, siteId: site.id, projectId: site.projectId || null, name: site.name }
  }
  // A project's site not stored yet (`prj_<id>`, Projects on, the project has no store of its own).
  if (siteId.startsWith("prj_")) {
    const projectId = siteId.slice(4)
    const project = (await db.collection("projects").doc(projectId).get()).data() as { organizationId?: string; name?: string; warehouseId?: string | null } | undefined
    if (project && project.organizationId === orgId && projectSiteId(projectId) === siteId) {
      if (project.warehouseId) return resolveManualPlace(db, orgId, { warehouseId: project.warehouseId })
      return { kind: "site", warehouseId: null, siteId, projectId, name: project.name || null }
    }
  }
  throw new ManualReceiptRefusal("site_missing")
}

/**
 * RC-03: what was paid for each priced row joins the price history as a «يدوي» point — the same `priceHistory` rows an approved order
 * writes, keyed by the receipt's line so a retry overwrites its own row. Best-effort: a receipt is never refused for its prices.
 */
async function recordManualPrices(
  db: Firestore,
  m: { orgId: string; deliveryId: string; docNumber: string; day: string; supplierName: string; supplierOrgId: string | null; items: ManualReceiptBody["items"] }
): Promise<void> {
  try {
    await Promise.all(
      m.items.map((it, i) => {
        const price = it.unitPrice != null ? round2(Number(it.unitPrice)) : 0
        if (!(price > 0)) return null
        const k = it.material ? specKeyOf({ name: it.name, unit: it.unit, material: it.material }) : { materialId: null, specKey: null }
        return db
          .collection(PRICE_HISTORY)
          .doc(`${m.deliveryId}__i${i + 1}`)
          .set({
            organizationId: m.orgId,
            materialKey: materialKey(it.name, it.unit),
            ...(k.specKey ? { specKey: k.specKey, materialId: k.materialId } : {}),
            name: it.name,
            unit: it.unit,
            supplierOrgId: m.supplierOrgId || "",
            supplierName: m.supplierName,
            price,
            day: m.day,
            kind: "manual",
            poId: null,
            poNumber: null,
            receiptId: m.deliveryId,
            receiptNumber: m.docNumber,
          })
      })
    )
  } catch (err) {
    console.warn("manual receipt prices not recorded:", (err as { code?: string })?.code || err)
  }
}

async function landManual(db: Firestore, orgId: string, warehouseId: string, items: Array<{ name: string; quantity: number; unit: string; unitPrice: number | null }>): Promise<boolean> {
  try {
    await landStock(db, { orgId, warehouseId, items: items.map((it) => ({ name: it.name, unit: it.unit, quantity: it.quantity, unitCost: it.unitPrice })) })
    return true
  } catch (err) {
    console.error("Manual receipt into warehouse failed:", err)
    return false
  }
}

export type DraftAnswer = "confirm" | "decline"

export interface DraftResult {
  deliveryId: string
  docNumber: string
  state: "confirmed" | "declined"
  stockLanded: boolean
}

/** The storekeeper's answer to a manual receipt that waits at his main warehouse: confirming lands the stock; declining moves nothing and tells the buyer why. */
export async function answerManualDraft(db: Firestore, caller: ManualCaller, input: { deliveryId: string; answer: DraftAnswer; note?: string | null }, now: Date = new Date()): Promise<DraftResult> {
  const ref = db.collection("deliveries").doc(input.deliveryId)
  const at = now.toISOString()
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.data() as (Doc & { manualDraft?: { state?: string; warehouseId?: string; byId?: string }; items?: Array<{ name: string; quantity: number; unit: string; unitPrice: number | null }> }) | undefined
    if (!d) throw new ManualReceiptRefusal("delivery_missing")
    if (d.contractorOrgId !== caller.orgId) throw new ManualReceiptRefusal("not_yours")
    if (d.source !== "manual" || d.manualDraft?.state !== "draft") throw new ManualReceiptRefusal("not_a_draft")
    const warehouseId = d.manualDraft.warehouseId || (d.warehouseId as string)
    const manualDraft = { ...d.manualDraft, state: input.answer === "confirm" ? "confirmed" : "declined", confirmedById: caller.uid, confirmedByName: caller.name, confirmedAt: at, note: input.note?.trim() || null }
    tx.update(ref, { manualDraft, ...(input.answer === "confirm" ? { landedWarehouseId: warehouseId } : {}), updatedAt: FieldValue.serverTimestamp() })
    return { d, warehouseId, buyerId: d.manualDraft.byId || null }
  })
  const docNumber = String(out.d.docNumber || "")
  let stockLanded = false
  if (input.answer === "confirm") stockLanded = await landManual(db, caller.orgId, out.warehouseId, out.d.items || [])
  await notifyNamed(
    db,
    { uid: caller.uid, name: caller.name },
    { kind: "receipt_manual", organizationId: caller.orgId, poId: null, link: `/contractor/goods-received?tab=nopo&delivery=${input.deliveryId}`, params: { receipt: docNumber, supplier: String(out.d.supplierName || ""), order: input.answer === "confirm" ? " — أكّد أمين المستودع دخولها الرصيد" : ` — رفضها أمين المستودع${input.note ? `: ${input.note}` : ""}` } },
    [out.buyerId],
    { owner: false }
  ).catch(warn)
  return { deliveryId: input.deliveryId, docNumber, state: input.answer === "confirm" ? "confirmed" : "declined", stockLanded }
}

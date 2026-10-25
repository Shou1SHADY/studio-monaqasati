// «انشر» on the server (Procurement 2.0, WP-S2-07; ED-01, ED-05..08, WF-06, WF-28, G-16, R-06, R-09, R-32, R-36): the editor's rows
// become ONE RFQ here, with the rules enforced where they cannot be skipped — every row has a material (or its category), a quantity and
// a unit; every place has its city; the deadline is today or later (Riyadh); a private round names a supplier and a direct award one
// who may be sent it. The RFQ number is drawn in the same transaction as the document, so an abandoned form spends none.
//
// A DIRECT AWARD is no longer a shortcut to an order: it is an OPEN private RFQ to one supplier, with no visitor link unless asked.
// The server estimates it from the last price we paid (the material's own, else its category's) × quantity × 1.15; above the policy
// cap a reason is required, stored as `dirOver` / `directWhy`, and the order that comes from awarding it needs the owner's approval.

import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore"
import { z } from "zod"
import { riyadhDay } from "@/lib/hr/format"
import { COMPANY_PUBLIC_FACTS } from "@/lib/company-public-facts"
import { mintLinkToken } from "@/lib/links/hash"
import { linkUrl } from "@/lib/links/url"
import { formatYearlyDocNumber } from "@/lib/sales-numbering"
import { supplierFactsFromProfile } from "../award"
import { rfqPublishKey } from "../event-keys"
import { deadlineEnd, shareLinkState } from "../guest-supplier"
import { riyadhYear, RFQ_DOC_TYPE } from "../numbering"
import { resolvePolicies } from "../policies"
import { PRICE_HISTORY, type PriceHistoryEntry } from "../prices"
import { rfqKeyPart, sendProcEvent } from "../proc-event-server"
import { rfqLogEntry, type RfqLogEntry } from "../rfq-detail"
import { DIRECT_WHY_CODES, deadlineProblem, directEstimate, directReasonRefusal, directWhyText, rowProblems, type DirectEstimate } from "../rfq-publish-rules"
import { SUPPLIER_RECORDS, supplierRecordId, supplierSourcingBlock, type SupplierRecord } from "../supplier-file"
import { termsListOf } from "../terms-freeze"
import { PROCUREMENT_SETTINGS } from "../types"
import { RfqError, mayPublish, mayRun, str, type Rec, type RfqCaller } from "./common"
import { linkRfqNeeds } from "./release"
import { cityCovers, rfqCities, supplierCities } from "@/lib/materials/reach"

const id = z.string().trim().min(1).max(128)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const product = z
  .object({
    name: z.string().trim().min(1).max(300),
    quantity: z.number().finite().gt(0).max(1e9),
    unitOfMeasure: z.string().trim().min(1).max(60),
  })
  .passthrough()

/** The editor's document: only these keys are ever copied from it — the status, the owner, the number and the audience are the server's. */
const LINE_DOC_KEYS = ["products", "subCategoryIds", "categoryIds", "categories", "categoryLabels", "category", "subCategory", "editorGroups", "deliveryOptions", "materialTree", "needBy", "needSources", "purchaseSource", "city", "district", "multiPlace", "cities", "projectId", "projectIds"] as const

export const publishSchema = z.object({
  rfqId: id.optional(),
  title: z.string().trim().min(1).max(200),
  audience: z.enum(["public", "private", "direct"]),
  deadline: day,
  pricing: z.enum(["line", "total"]),
  recipients: z.array(id).max(100).default([]),
  directSupplierOrgId: id.nullable().optional(),
  directWhy: z.object({ code: z.enum(DIRECT_WHY_CODES), text: z.string().trim().max(300).optional() }).nullable().optional(),
  terms: z.array(z.object({ pct: z.number().finite(), days: z.number().int() })).max(6).nullable().optional(),
  link: z.boolean().optional(),
  notes: z.string().max(4000).default(""),
  budget: z.number().finite().min(0).max(1e10).nullable().optional(),
  attachments: z.array(z.object({ name: z.string().max(300), url: z.string().max(2000), path: z.string().max(500) })).max(10).default([]),
  doc: z.object({ products: z.array(product).min(1).max(200) }).passthrough(),
  reach: z.object({ count: z.number().int().min(0).max(100000), orgIds: z.array(id).max(300).default([]) }).default({ count: 0, orgIds: [] }),
})
export type PublishInput = z.infer<typeof publishSchema>

export interface PublishResult {
  id: string
  number: string
  guestUrl: string | null
  reached: number
  closesOn: string
  direct: boolean
  dirOver: boolean
  directEst: number | null
  linkedRequests: number
  edited: boolean
}

// ── The number ──────────────────────────────────────────────────────────────

async function drawRfqNumberAdmin(db: Firestore, tx: FirebaseFirestore.Transaction, orgId: string, year: number): Promise<string> {
  const counter = db.collection("mfgCounters").doc(`${orgId}__${RFQ_DOC_TYPE}__${year}`)
  const snap = await tx.get(counter)
  const seq = (snap.exists ? Number(snap.data()?.last) || 0 : 0) + 1
  tx.set(counter, { organizationId: orgId, type: RFQ_DOC_TYPE, year, last: seq, updatedAt: FieldValue.serverTimestamp() })
  return formatYearlyDocNumber(RFQ_DOC_TYPE, year, seq)
}

// ── The supplier you may send it to ─────────────────────────────────────────

/** Why this supplier may not be sent a private or direct RFQ: an unverified one (added, not vouched for) or one whose CR has lapsed. */
export async function sourcingBlockServer(db: Firestore, orgId: string, supplierOrgId: string, today: string): Promise<"unverified" | "cr_expired" | null> {
  try {
    let snap = await db.collection("users").doc(supplierOrgId).get()
    if (!snap.exists) snap = await db.collection("organizations").doc(supplierOrgId).get()
    const pub = snap.exists ? ((await db.collection(COMPANY_PUBLIC_FACTS).doc(supplierOrgId).get().catch(() => null))?.data() as Parameters<typeof supplierFactsFromProfile>[2]) : undefined
    const base = supplierFactsFromProfile(supplierOrgId, snap.exists ? (snap.data() as Parameters<typeof supplierFactsFromProfile>[1]) : null, pub)
    const record = await db.collection(SUPPLIER_RECORDS).doc(supplierRecordId(orgId, supplierOrgId)).get()
    return supplierSourcingBlock(record.exists ? (record.data() as SupplierRecord) : null, { crExpiry: base.crExpiry }, today)
  } catch (err) {
    console.warn("supplier block not read:", (err as { code?: string })?.code || err)
    return null
  }
}

// ── The visitor link ────────────────────────────────────────────────────────

/** Opens the RFQ's visitor link — the live one is reused (a fresh token on it), else one is made. A private or direct RFQ gets it only when asked. */
export async function openGuestLink(db: Firestore, caller: RfqCaller, rfqId: string, rfq: Rec, explicit: boolean, now: Date): Promise<string | null> {
  const existing = await db.collection("rfqShareLinks").where("rfqId", "==", rfqId).where("revoked", "==", false).limit(10).get()
  const deadline = str(rfq.deadline)
  const found = existing.docs.find((d) => shareLinkState(d.data() as never, rfq as never, now) !== "gone" && (d.data().expiresWith === "deadline") === Boolean(deadlineEnd(deadline)))
  let linkId = found?.id
  if (!linkId) {
    const ref = await db.collection("rfqShareLinks").add({
      tokenHashes: [],
      rfqId,
      channel: "link",
      channelUpdatedAt: now.toISOString(),
      rfqTitle: str(rfq.title),
      contractorId: str(rfq.contractorId) || caller.uid,
      organizationId: caller.orgId,
      createdBy: caller.uid,
      createdByName: caller.name,
      revoked: false,
      offersSubmitted: 0,
      ...(deadlineEnd(deadline) ? { expiresWith: "deadline" } : {}),
      expiresAt: deadlineEnd(deadline) || new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      invites: [],
      ...(explicit && rfq.visibility === "private" ? { explicitBy: { uid: caller.uid, name: caller.name, at: now.toISOString() } } : {}),
      createdAt: FieldValue.serverTimestamp(),
    })
    linkId = ref.id
  }
  return linkUrl("rfq", await mintLinkToken(db, "rfq", linkId))
}

// ── The publish ─────────────────────────────────────────────────────────────

const keepLog = (log: RfqLogEntry[]): RfqLogEntry[] => log.slice(-200)

/**
 * ED-21: the public reach re-checked here on the delivery cities, with the same rule the editor counted with
 * (`cityCovers`): a supplier whose profile covers none of the RFQ's cities is dropped from what is stored (and so from
 * the reminders that read `reachedOrgIds`); one with no city data, or an RFQ with no city, is kept.
 */
export async function reachInCities(db: Firestore, orgIds: string[], rfq: Rec): Promise<string[]> {
  const cities = rfqCities(rfq)
  if (!cities.length || !orgIds.length) return orgIds
  const read = async (col: string, id: string) => {
    const snap = await db.collection(col).doc(id).get().catch(() => null)
    return snap?.exists ? (snap.data() as Rec) : null
  }
  const keep = await Promise.all(orgIds.map(async (id) => cityCovers(supplierCities(await read("users", id), await read("organizations", id)), cities)))
  return orgIds.filter((_, i) => keep[i])
}

export async function publishRfq(db: Firestore, caller: RfqCaller, input: PublishInput, now = new Date()): Promise<PublishResult> {
  if (!mayPublish(caller)) throw new RfqError("no_permission")
  const at = now.toISOString()
  const today = riyadhDay(now)
  const doc = input.doc as Rec
  const products = input.doc.products as Rec[]
  const direct = input.audience === "direct"

  const rowProblem = rowProblems(products, str(doc.city))
  if (rowProblem) throw new RfqError(rowProblem.code, rowProblem.params)
  const late = deadlineProblem(input.deadline, today)
  if (late) throw new RfqError(late.code)
  const terms = input.terms && input.terms.length ? termsListOf(input.terms) : null
  if (input.terms && input.terms.length && !terms) throw new RfqError("terms_invalid")

  let recipients: string[] = []
  if (input.audience === "private") {
    const picked = [...new Set(input.recipients)]
    const blocks = await Promise.all(picked.map((o) => sourcingBlockServer(db, caller.orgId, o, today)))
    recipients = picked.filter((_, i) => !blocks[i])
    if (!recipients.length) throw new RfqError("recipients_missing")
  }
  let directSupplier = ""
  let estimate: DirectEstimate | null = null
  let dirOver = false
  if (direct) {
    directSupplier = str(input.directSupplierOrgId)
    if (!directSupplier) throw new RfqError("direct_supplier_missing")
    if (await sourcingBlockServer(db, caller.orgId, directSupplier, today)) throw new RfqError("direct_blocked")
    const settings = (await db.collection(PROCUREMENT_SETTINGS).doc(caller.orgId).get()).data()
    const policies = resolvePolicies(settings as Parameters<typeof resolvePolicies>[0])
    const history = (await db.collection(PRICE_HISTORY).where("organizationId", "==", caller.orgId).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceHistoryEntry, "id">) }))
    estimate = directEstimate(products, history)
    dirOver = estimate.total > policies.directPurchaseCap
    const refusal = directReasonRefusal(input.directWhy, dirOver)
    if (refusal) throw new RfqError(refusal.code)
  }

  const sentIds = input.audience === "public" ? [...new Set(input.reach.orgIds)].slice(0, 300) : []
  const reachedOrgIds = input.audience === "public" ? await reachInCities(db, sentIds, doc) : []
  const cut = sentIds.length - reachedOrgIds.length
  const reached = input.audience === "private" ? recipients.length : direct ? 1 : Math.max(0, input.reach.count - cut)

  const copied: Rec = {}
  for (const key of LINE_DOC_KEYS) if (doc[key] !== undefined) copied[key] = doc[key]

  const ref = input.rfqId ? db.collection("rfqs").doc(input.rfqId) : db.collection("rfqs").doc()
  const done = await db.runTransaction(async (tx) => {
    const snap = input.rfqId ? await tx.get(ref) : null
    const cur = snap?.exists ? (snap.data() as Rec) : null
    if (input.rfqId && !cur) throw new RfqError("rfq_missing")
    if (cur) {
      if (!mayRun(caller, cur as never)) throw new RfqError("no_permission")
      if (cur.status !== "Draft" && cur.status !== "New") throw new RfqError("rfq_not_open")
      if (cur.status === "New" && Number(cur.offersCount) > 0) throw new RfqError("rfq_not_open")
    }
    const number = str(cur?.rfqNumber) || (await drawRfqNumberAdmin(db, tx, caller.orgId, riyadhYear(now)))
    const edited = cur?.status === "New"
    const before = ((cur?.log as RfqLogEntry[]) || []) as RfqLogEntry[]
    const log = edited ? before : [...before, rfqLogEntry({ uid: caller.uid, name: caller.name }, "published", at)]
    const body: DocumentData = {
      ...copied,
      organizationId: caller.orgId,
      contractorId: str(cur?.contractorId) || caller.uid,
      createdByUserId: str(cur?.createdByUserId) || caller.uid,
      createdByUserName: str(cur?.createdByUserName) || caller.name,
      title: input.title.trim(),
      rfqNumber: number,
      status: "New",
      country: "SA",
      audience: input.audience,
      visibility: input.audience === "public" ? "public" : "private",
      allowedSupplierOrgIds: direct ? [directSupplier] : input.audience === "private" ? recipients : [],
      deadline: input.deadline,
      pricingMode: products.length > 1 ? input.pricing : "line",
      estimatedBudget: input.budget && input.budget > 0 ? input.budget : null,
      notes: input.notes,
      attachments: input.attachments,
      pdfUrl: input.attachments[0]?.url || null,
      pdfStoragePath: input.attachments[0]?.path || null,
      paymentTermsList: terms,
      requiresWarranty: products.some((p) => p.requiresWarranty === true),
      orderedFromMdmakDirect: false,
      reachedCount: reached,
      reachedOrgIds,
      pubVer: Number(cur?.pubVer) || 1,
      publishedAt: str(cur?.publishedAt) || at,
      offersCount: Number(cur?.offersCount) || 0,
      ...(direct ? { dirOver, directEst: estimate?.total ?? null, directMissing: estimate?.missing ?? 0, directWhy: dirOver && input.directWhy ? directWhyText(input.directWhy) : null, directWhyCode: dirOver && input.directWhy ? input.directWhy.code : null } : { dirOver: false, directWhy: null }),
      log: keepLog(log),
      createdAt: str(cur?.createdAt) || at,
      updatedAt: FieldValue.serverTimestamp(),
    }
    tx.set(ref, body, { merge: true })
    return { number, edited, body }
  })

  const rfq = { ...done.body, id: ref.id } as Rec
  const linkedRequests = await linkRfqNeeds(db, caller, ref.id, done.number, rfq, at).catch((err) => {
    console.error("publish: requests not linked:", err)
    return 0
  })
  const projectId = str(doc.projectId)
  if (projectId) {
    try {
      const project = await db.collection("projects").doc(projectId).get()
      if (project.exists && str(project.data()?.organizationId) === caller.orgId) await db.collection("projects").doc(projectId).update({ rfqIds: FieldValue.arrayUnion(ref.id) })
    } catch (err) {
      console.warn("publish: project not linked:", (err as { code?: string })?.code || err)
    }
  }
  let guestUrl: string | null = null
  const wantsLink = input.link ?? input.audience === "public"
  if (wantsLink) guestUrl = await openGuestLink(db, caller, ref.id, rfq, input.link === true && input.audience !== "public", now).catch((err) => {
    console.error("publish: visitor link not made:", err)
    return null
  })
  await sendProcEvent(db, {
    id: "rfq_publish",
    key: rfqPublishKey(rfqKeyPart(rfq, ref.id), 1),
    organizationId: caller.orgId,
    by: caller.uid,
    at,
    refs: { rfqId: ref.id, rfqNo: done.number },
    payload: { change: "published", audience: input.audience, deadline: input.deadline, lines: products.length, link: Boolean(guestUrl) },
  })
  return { id: ref.id, number: done.number, guestUrl, reached, closesOn: input.deadline, direct, dirOver, directEst: estimate?.total ?? null, linkedRequests, edited: done.edited }
}

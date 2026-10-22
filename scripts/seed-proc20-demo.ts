/**
 * Seeds the Procurement 2.0 demo world on UAT for ONE existing contractor company (NFR-06, G-12): the same screens every time you open it.
 * The world is modelled on the customer's prototype (Prototype-Procurement-v5.html, the data section): eight incoming requests across the
 * team, the projects and the workshop (one for a receiver with no account, one in an RFQ, one ended, one withdrawn); three RFQs — one OPEN with
 * ELEVEN offers (nine on the platform, two from outside it, one expired, one piece-priced, one partial, one shortlisted, one excluded, two
 * questions), one PARTLY AWARDED into two orders with its third line back in «الواردة», one CLOSED waiting for the comparison; and nine
 * orders: awaiting approval (a direct award above the cap), approved for an off-platform supplier (not yet sent), sent to a portal supplier and
 * not yet accepted, sent by WhatsApp to an off-platform supplier (the order link), accepted and late, accepted and partly received with its
 * conversation and a delivery notice, complete, declined by the supplier, and cancelled.
 *
 * Every date is a day offset from today in Riyadh (a fixed calendar date would age), every id is deterministic (`p20_…`), and the world is pure:
 * `buildProc20World(ctx)` returns the documents, and src/__tests__/procurement-v2-guards-seed.test.tsx asserts it is the same world every time
 * and that the screens read it. The supplier companies are plain `users/p20_sup…` documents (no sign-in): they exist to be compared, awarded
 * and ordered from, not to log in.
 *
 *   npx tsx scripts/seed-proc20-demo.ts uat --email <contractor owner's e-mail>            dry run: the company found, what would be written
 *   npx tsx scripts/seed-proc20-demo.ts uat --email <…> --apply                           write the world, mint two links and print them
 *   npx tsx scripts/seed-proc20-demo.ts uat --email <…> --reset                           dry run of the reset: what would be deleted
 *   npx tsx scripts/seed-proc20-demo.ts uat --email <…> --reset --apply                   delete exactly what this script wrote
 *
 * UAT ONLY: any other target is refused, and so is an env file whose project is not mdmaktech-uat. Credentials: the service account in .env.uat.
 * It creates NO sign-in account; the contractor is found by e-mail and must already be a company owner. Settings are merged (only the delivery
 * sites with the `p20_` prefix are added); sequences (mfgCounters) are raised, never lowered. Re-running --apply rewrites the same documents and
 * mints two FRESH links (the older ones keep working; a link keeps its 25 newest).
 */

import { resolve } from "path"
import { config } from "dotenv"
import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { riyadhDay } from "@/lib/hr/format"
import { fromMfgRequest, fromPmRequest, newTeamRequest } from "@/lib/procurement/incoming-ingest"
import { incomingDocId, type IncomingDoc, type IncomingLine } from "@/lib/procurement/incoming-state"
import { materialKey } from "@/lib/procurement/prices"
import { mintLinkToken, hashToken } from "@/lib/links/hash"
import { linkUrl } from "@/lib/links/url"
import type { ProjectRequestDoc } from "@/lib/procurement/needs"

export const DEMO_PREFIX = "p20_"
export const UAT_PROJECT = "mdmaktech-uat"

export interface DemoCtx {
  orgId: string
  ownerUid: string
  ownerName: string
  /** `YYYY-MM-DD`, Riyadh. */
  today: string
}

export interface DemoDoc {
  path: string
  data: Record<string, unknown>
  merge?: boolean
}

export interface Proc20World {
  docs: DemoDoc[]
  counters: Array<{ path: string; last: number }>
  links: { rfqLinkId: string; orderLinkPoId: string }
  summary: Record<string, number>
}

type Rec = Record<string, unknown>

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export function buildProc20World(ctx: DemoCtx): Proc20World {
  const { orgId, ownerUid, ownerName, today } = ctx
  const year = today.slice(0, 4)
  const day = (n: number) => addDays(today, n)
  const iso = (n: number, hh = 8) => `${day(n)}T${String(hh).padStart(2, "0")}:00:00.000Z`
  const docs: DemoDoc[] = []
  const put = (path: string, data: Rec, merge = false) => void docs.push({ path, data, ...(merge ? { merge } : {}) })
  const id = (name: string) => `${DEMO_PREFIX}${name}`

  // ── Where things are delivered ─────────────────────────────────────────────────────────────────────────────────────────────────
  const site = (sid: string, kind: string, name: string, district: string, extra: Rec = {}) => ({ id: id(sid), kind, name, city: "الرياض", district, address: "", receiverId: null, ...extra })
  const sites = [
    site("site_wh", "warehouse", "المستودع المركزي", "حي السلي"),
    site("site_yasmin", "site", "مجمع الياسمين السكني — 5 فلل", "حي الياسمين"),
    site("site_olaya", "site", "برج العليا التجاري", "حي العليا"),
    site("site_malqa", "site", "فيلا الملقا", "حي الملقا"),
  ]
  put(`procurementSettings/${orgId}`, { organizationId: orgId, deliverySites: sites }, true)
  put(`procurementReceivers/${id("rcv_salem")}`, { organizationId: orgId, name: "سالم القحطاني", title: "مراقب موقع فيلا الملقا", role: "site_engineer", module: "projects", phone: "0551112233", userId: null, warehouseIds: [], active: true, createdAt: iso(-60), createdById: ownerUid })

  // ── Suppliers: twelve companies, four of them with a record with us ─────────────────────────────────────────────────────────
  const SUPPLIERS: Array<[string, string]> = [
    ["quality", "مصنع الجودة"],
    ["east", "مصنع الشرق للحديد"],
    ["mid", "الوسطى للتجارة"],
    ["horizon", "مؤسسة الأفق"],
    ["modern", "البناء الحديث"],
    ["alnoor", "مصنع النور"],
    ["alfajr", "مؤسسة الفجر"],
    ["alriyan", "مؤسسة الريان للتجارة"],
    ["baraka", "البركة لمواد البناء"],
    ["khaleej", "الخليج للأخشاب"],
    ["omran", "عمران للتوريدات"],
    ["safa", "الصفا للدهانات"],
  ]
  SUPPLIERS.forEach(([key, name], i) => {
    const sid = id(`sup_${key}`)
    put(`users/${sid}`, { role: "Supplier", organizationId: sid, companyName: name, name, taxNumber: `3000000000${String(10 + i).padStart(2, "0")}003`, isVerified: true, specializations: ["مواد بناء"], coverageCities: ["الرياض"], demoSeed: "proc20" })
    if (i < 4) put(`supplierRecords/${orgId}__${sid}`, { organizationId: orgId, supplierOrgId: sid, supplierName: name, vatNumber: `3000000000${String(10 + i).padStart(2, "0")}003`, verified: true, verifiedAt: iso(-90), verifiedByName: ownerName, addedAt: iso(-90), addedByName: ownerName, log: [] })
  })
  const sup = (key: string) => id(`sup_${key}`)
  const supName = (key: string) => SUPPLIERS.find(([k]) => k === key)?.[1] || key

  // ── RFQ 1 — OPEN, eleven offers ───────────────────────────────────────────────────────────────────────────────────────────────
  const SALE = [{ ar: "قطعة 6 م", en: "piece 6 m", lengthM: 6, from: "list" }, { ar: "قطعة 12 م", en: "piece 12 m", lengthM: 12, from: "list" }]
  const q1 = id("rfq_open")
  put(`rfqs/${q1}`, {
    organizationId: orgId,
    contractorId: orgId,
    createdByUserId: ownerUid,
    createdByUserName: ownerName,
    rfqNumber: `RFQ-${year}/001`,
    title: "زوايا حديد وخشب ألواح — مجمع الياسمين",
    status: "New",
    visibility: "public",
    audience: "public",
    category: "Construction Materials",
    city: "الرياض",
    pricingMode: "line",
    deadline: day(4),
    createdAt: iso(-5),
    pubVer: 1,
    offersCount: 11,
    reachedCount: 10,
    viewsCount: 19,
    paymentTermsList: [{ pct: 100, days: 30 }],
    products: [
      { name: "زوايا حديد 50×50×5 مم", quantity: 175, unitOfMeasure: "م", saleUnits: SALE, warrantyMonths: 24, requiresWarranty: true, deliverySiteId: id("site_yasmin"), deliveryCity: "الرياض", needSource: { kind: "project_request", projectId: id("project_yasmin"), purchaseRequestId: id("pr_iron") }, needLine: 0 },
      { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م", saleUnits: [{ ar: "لوح 4 م", en: "board 4 m", lengthM: 4, from: "list" }], deliverySiteId: id("site_yasmin"), deliveryCity: "الرياض" },
    ],
    log: [{ at: iso(-5), byId: ownerUid, byName: ownerName, action: "published", note: null, params: { number: `RFQ-${year}/001` } }],
  })
  const offer = (key: string, rfqId: string, lines: Rec[], over: Rec = {}) =>
    put(`offers/${id(`o_${rfqId.replace(DEMO_PREFIX, "")}_${key}`)}`, {
      rfqId,
      contractorOrgId: orgId,
      contractorId: orgId,
      organizationId: sup(key),
      supplierId: sup(key),
      companyName: supName(key),
      status: "قيد المراجعة",
      lines,
      price: "0",
      vatRegistered: true,
      vatRate: 0.15,
      leadDays: 5,
      validUntil: day(30),
      createdAt: iso(-1),
      offerPdfUrl: "https://example.invalid/demo-quote.pdf",
      creditDays: 30,
      advancePercent: 0,
      versions: [{ n: 1, at: day(-1), total: 0, by: "supplier" }],
      rev: 1,
      ...over,
    })
  const two = (a: number, b: number, extra: Rec = {}): Rec[] => [{ rfqProductIndex: 0, unitPrice: a, ...extra }, { rfqProductIndex: 1, unitPrice: b }]
  offer("quality", q1, two(12.5, 3.6), { leadDays: 7 })
  offer("east", q1, two(146, 3.8, { packLen: 12, packKey: "قطعة 12 م", warrantyMonths: 24 }), { leadDays: 4 })
  offer("mid", q1, two(12.7, 3.9, { warrantyMonths: 12 }), { creditDays: 60 })
  offer("horizon", q1, two(12.9, 3.7), { leadDays: 3 })
  offer("alnoor", q1, two(13.1, 3.85), { leadDays: 6 })
  offer("alfajr", q1, two(13.4, 3.9), { leadDays: 8 })
  offer("baraka", q1, two(13.8, 4.1), { leadDays: 9, validUntil: day(-3) })
  offer("khaleej", q1, [{ rfqProductIndex: 1, unitPrice: 3.55 }], { skippedItems: [0], leadDays: 9 })
  offer("modern", q1, two(13.6, 4), { leadDays: 10 })
  const guest = (n: number, company: string, phone: string, lines: Rec[], over: Rec = {}) =>
    put(`offers/${id(`o_rfq_open_guest${n}`)}`, {
      rfqId: q1,
      contractorOrgId: orgId,
      contractorId: orgId,
      organizationId: "guest",
      supplierId: "guest",
      isGuestOffer: true,
      companyName: company,
      supplierName: company,
      guestContact: { name: company, phone },
      status: "قيد المراجعة",
      lines,
      price: "0",
      vatRegistered: false,
      vatRate: 0,
      leadDays: 5,
      validUntil: day(2),
      createdAt: iso(0, 7),
      offerPdfUrl: null,
      versions: [{ n: 1, at: day(0), total: 0, by: "guest" }],
      rev: 1,
      ...over,
    })
  guest(1, "مؤسسة الأمل", "+966551112222", two(13.2, 3.75))
  guest(2, "مؤسسة الرمال للتجارة", "+966552223344", two(13.3, 3.95), { validUntil: day(10), leadDays: 6 })
  put(`offerDecisions/${id("o_rfq_open_horizon")}`, { offerId: id("o_rfq_open_horizon"), rfqId: q1, organizationId: orgId, shortlist: { at: iso(0, 9), byId: ownerUid, byName: ownerName }, exclusion: null, log: [], updatedAt: iso(0, 9) })
  put(`offerDecisions/${id("o_rfq_open_alfajr")}`, { offerId: id("o_rfq_open_alfajr"), rfqId: q1, organizationId: orgId, shortlist: null, exclusion: { code: "spec", text: null, at: iso(0, 9), byId: ownerUid, byName: ownerName }, log: [], updatedAt: iso(0, 9) })
  put(`rfqs/${q1}/inquiries/${id("q_unanswered")}`, { kind: "ask", question: "هل التسليم شامل التنزيل؟", from: { orgId: null, anon: true }, via: "link", answer: null, reply: null, createdAt: iso(-2, 9), li: 0 })
  put(`rfqs/${q1}/inquiries/${id("q_answered")}`, { kind: "ask", question: "ما مدة الضمان المطلوبة؟", supplierName: supName("east"), organizationId: sup("east"), from: { orgId: sup("east"), anon: false }, via: "portal", answer: { text: "سنتان على الزوايا.", all: true, at: iso(-1, 9), byId: ownerUid, byName: ownerName }, reply: "سنتان على الزوايا.", sentToAll: true, createdAt: iso(-3, 9) })
  const linkId = id("link_rfq_open")
  put(`rfqShareLinks/${linkId}`, { tokenHashes: [], rfqId: q1, channel: "link", channelUpdatedAt: iso(-5), rfqTitle: "زوايا حديد وخشب ألواح — مجمع الياسمين", contractorId: orgId, organizationId: orgId, createdBy: ownerUid, createdByName: ownerName, revoked: false, offersSubmitted: 2, expiresWith: "deadline", expiresAt: `${day(4)}T20:59:59.999Z`, invites: [], createdAt: iso(-5) })

  // ── RFQ 2 — PARTLY AWARDED: two orders, the third line back in «الواردة» ───────────────────────────────────────────────────────
  const q2 = id("rfq_awarded")
  put(`rfqs/${q2}`, {
    organizationId: orgId,
    contractorId: orgId,
    createdByUserId: ownerUid,
    createdByUserName: ownerName,
    rfqNumber: `RFQ-${year}/002`,
    title: "حديد تسليح وإسمنت — برج العليا",
    status: "Awarded",
    visibility: "public",
    audience: "public",
    city: "الرياض",
    pricingMode: "line",
    deadline: day(-3),
    closedEarly: { at: iso(-4), byId: ownerUid, byName: ownerName, originalDeadline: day(-1), reason: "award" },
    createdAt: iso(-14),
    pubVer: 1,
    offersCount: 3,
    awardRound: 1,
    awardSplit: true,
    unawardedLines: [2],
    paymentTermsList: [{ pct: 100, days: 30 }],
    products: [
      { name: "اسياخ حديد التسليح 16 مم", quantity: 10, unitOfMeasure: "طن", deliverySiteId: id("site_olaya"), deliveryCity: "الرياض" },
      { name: "الاسمنت المقاوم", quantity: 300, unitOfMeasure: "كيس", deliverySiteId: id("site_olaya"), deliveryCity: "الرياض" },
      { name: "شبك حديد", quantity: 40, unitOfMeasure: "لوح", deliverySiteId: id("site_wh"), deliveryCity: "الرياض" },
    ],
    log: [{ at: iso(-4), byId: ownerUid, byName: ownerName, action: "awarded", note: null, params: { orders: 2 } }],
  })
  const three = (a: number, b: number, c: number | null): Rec[] => [{ rfqProductIndex: 0, unitPrice: a }, { rfqProductIndex: 1, unitPrice: b }, ...(c == null ? [] : [{ rfqProductIndex: 2, unitPrice: c }])]
  offer("east", q2, three(2900, 17, 185), { status: "مقبول", awardedLines: [0], outcome: { k: "won", round: 1 } })
  offer("alnoor", q2, three(3050, 16.2, null), { status: "مقبول", awardedLines: [1], outcome: { k: "won", round: 1 }, skippedItems: [2] })
  offer("quality", q2, three(2950, 18, 190), { outcome: { k: "lost", why: "price", round: 1 } })

  // ── RFQ 3 — CLOSED, waiting for the comparison ────────────────────────────────────────────────────────────────────────────────
  const q3 = id("rfq_compare")
  put(`rfqs/${q3}`, {
    organizationId: orgId,
    contractorId: orgId,
    createdByUserId: ownerUid,
    createdByUserName: ownerName,
    rfqNumber: `RFQ-${year}/003`,
    title: "بلك وأسمنت — فيلا الملقا",
    status: "New",
    visibility: "public",
    audience: "public",
    city: "الرياض",
    pricingMode: "line",
    deadline: day(-2),
    createdAt: iso(-9),
    pubVer: 1,
    offersCount: 3,
    reachedCount: 6,
    viewsCount: 8,
    paymentTermsList: [{ pct: 100, days: 30 }],
    products: [
      { name: "البلك الاسمنتي 15×20×40", quantity: 1200, unitOfMeasure: "حبة", deliverySiteId: id("site_malqa"), deliveryCity: "الرياض" },
      { name: "الاسمنت العادي 50 كجم", quantity: 80, unitOfMeasure: "كيس", deliverySiteId: id("site_malqa"), deliveryCity: "الرياض" },
    ],
    log: [],
  })
  offer("quality", q3, [{ rfqProductIndex: 0, unitPrice: 4.6 }, { rfqProductIndex: 1, unitPrice: 16.5 }], { leadDays: 4, createdAt: iso(-4) })
  offer("horizon", q3, [{ rfqProductIndex: 0, unitPrice: 4.35 }, { rfqProductIndex: 1, unitPrice: 17.25 }], { leadDays: 6, advancePercent: 30, createdAt: iso(-3) })
  offer("safa", q3, [{ rfqProductIndex: 1, unitPrice: 15.9 }], { skippedItems: [0], leadDays: 9, createdAt: iso(-3) })

  // ── Nine orders ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const line = (n: number, name: string, unit: string, quantity: number, unitPrice: number, over: Rec = {}) => ({ id: `l${n}`, name, unit, quantity, unitPrice, accepted: 0, rejected: 0, held: 0, cancelled: 0, boqItemId: null, ...over })
  const po = (key: string, n: number, over: Rec): string => {
    const poId = id(`po_${key}`)
    const lines = over.lines as Array<{ quantity: number; unitPrice: number }>
    put(`purchaseOrders/${poId}`, {
      organizationId: orgId,
      docNumber: `PO-${year}/00${n}`,
      basis: "rfq",
      projectId: null,
      isGuestSupplier: false,
      totalExVat: Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100,
      vatRate: 0.15,
      offersCount: 3,
      lowestOfferTotal: null,
      shortCompetition: false,
      noOfficialQuote: false,
      preparedById: ownerUid,
      preparedByName: ownerName,
      createdAt: iso(-10),
      approverKind: "manager",
      leadTimeDays: 10,
      termsList: [{ pct: 100, days: 30 }],
      paymentTerms: "30 يوماً",
      log: [{ at: iso(-10), byId: ownerUid, byName: ownerName, action: "created", note: null, params: { basis: "rfq", number: `PO-${year}/00${n}` } }],
      ver: 1,
      ...over,
    })
    return poId
  }
  const sent = (n: number, extra: Rec = {}) => ({
    approvedAt: iso(-n),
    approvedById: ownerUid,
    approvedByName: ownerName,
    sentAt: iso(-n, 9),
    sentById: ownerUid,
    sentByName: ownerName,
    sentChannel: "portal",
    versions: [{ n: 1, at: iso(-n, 9), byName: ownerName, kind: "sent" }],
    ...extra,
  })
  const eastKey = sup("east")
  po("accepted_late", 1, { status: "accepted", rfqId: q2, rfqTitle: "حديد تسليح وإسمنت — برج العليا", offerId: id("o_rfq_awarded_east"), supplierOrgId: eastKey, supplierUserId: eastKey, supplierName: supName("east"), lines: [line(1, "اسياخ حديد التسليح 16 مم", "طن", 10, 2900, { rfqProductIndex: 0 })], siteKey: `${eastKey}|${id("site_olaya")}`, site: { id: id("site_olaya"), name: "برج العليا التجاري", city: "الرياض", district: "حي العليا" }, ...sent(12), supplierAcceptedAt: iso(-11), promisedDate: day(-5), dueDate: day(-5) })
  po("sent_waiting", 2, { status: "sent", rfqId: q2, rfqTitle: "حديد تسليح وإسمنت — برج العليا", offerId: id("o_rfq_awarded_alnoor"), supplierOrgId: sup("alnoor"), supplierUserId: sup("alnoor"), supplierName: supName("alnoor"), lines: [line(1, "الاسمنت المقاوم", "كيس", 300, 16.2, { rfqProductIndex: 1 })], siteKey: `${sup("alnoor")}|${id("site_olaya")}`, site: { id: id("site_olaya"), name: "برج العليا التجاري", city: "الرياض", district: "حي العليا" }, ...sent(3), dueDate: day(7) })
  po("awaiting_approval", 3, { status: "awaiting_approval", basis: "direct", rfqId: null, rfqTitle: "خرسانة جاهزة — شراء مباشر", offerId: null, supplierOrgId: sup("omran"), supplierUserId: sup("omran"), supplierName: supName("omran"), lines: [line(1, "خرسانة جاهزة C30", "م³", 40, 360)], approverKind: "owner", tags: { directOver: { why: "مورّد وحيد لهذه المادة" } }, awardReasonText: "مورّد وحيد لهذه المادة", createdAt: iso(-1) })
  po("sent_guest", 9, { status: "sent", rfqId: null, basis: "direct", rfqTitle: "رمل أحمر", offerId: null, supplierOrgId: "guest", supplierUserId: null, supplierName: "مؤسسة الرمال للتجارة", isGuestSupplier: true, lines: [line(1, "رمل أحمر", "م³", 20, 88)], ...sent(1, { sentChannel: "whatsapp" }), dueDate: day(6), site: { id: id("site_yasmin"), name: "مجمع الياسمين السكني — 5 فلل", city: "الرياض", district: "حي الياسمين" }, siteKey: `guest|${id("site_yasmin")}` })
  po("approved_guest", 4, { status: "approved", rfqId: null, basis: "direct", rfqTitle: "رمل لياسة", offerId: null, supplierOrgId: "guest", supplierUserId: null, supplierName: "مؤسسة الرمال للتجارة", isGuestSupplier: true, lines: [line(1, "رمل لياسة", "م³", 20, 88)], approvedAt: iso(-1), approvedById: ownerUid, approvedByName: ownerName, createdAt: iso(-2), dueDate: day(8) })
  po("partly_received", 5, { status: "accepted", rfqId: null, basis: "direct", rfqTitle: "بلك خرساني", offerId: null, supplierOrgId: sup("baraka"), supplierUserId: sup("baraka"), supplierName: supName("baraka"), lines: [line(1, "بلك خرساني 20 سم", "حبة", 1000, 3.5, { accepted: 400 })], ...sent(9), supplierAcceptedAt: iso(-8), promisedDate: day(3), dueDate: day(3), chat: { seq: 2, usSeq: 1, supSeq: 1, lastAt: iso(-1, 10), lastText: "الشحنة الثانية غداً", lastBy: "sup", lastFile: false, readBy: {}, supReadSeq: 1 } })
  po("complete", 6, { status: "accepted", rfqId: null, basis: "direct", rfqTitle: "أسمنت عادي", offerId: null, supplierOrgId: sup("horizon"), supplierUserId: sup("horizon"), supplierName: supName("horizon"), lines: [line(1, "الاسمنت العادي 50 كجم", "كيس", 150, 16, { accepted: 150 })], ...sent(30), supplierAcceptedAt: iso(-29), promisedDate: day(-20), dueDate: day(-20) })
  po("supplier_declined", 7, { status: "sent", rfqId: null, basis: "direct", rfqTitle: "دهان خارجي", offerId: null, supplierOrgId: sup("safa"), supplierUserId: sup("safa"), supplierName: supName("safa"), lines: [line(1, "دهان أكريليك خارجي", "جالون", 60, 120)], ...sent(2), dueDate: day(9), supplierDecline: { reason: "stock", note: "نفد المخزون", at: iso(-1, 11), byName: supName("safa") } })
  po("cancelled", 8, { status: "cancelled", rfqId: null, basis: "direct", rfqTitle: "خشب شدّات", offerId: null, supplierOrgId: sup("khaleej"), supplierUserId: sup("khaleej"), supplierName: supName("khaleej"), lines: [line(1, "خشب شدّات", "م³", 12, 900)], ...sent(15), cancelledAt: iso(-4), cancelledReason: "لم تعد الحاجة قائمة", cancelledById: ownerUid, cancelledByName: ownerName })
  const orderLinkPoId = id("po_sent_guest")
  put(`orderLinks/${orderLinkPoId}`, { poId: orderLinkPoId, organizationId: orgId, tokenHashes: [], createdAt: iso(-1) })
  put(`deliveries/${id("notice_partly")}`, { contractorOrgId: orgId, organizationId: orgId, supplierOrgId: sup("baraka"), supplierName: supName("baraka"), poId: id("po_partly_received"), poNumber: `PO-${year}/005`, status: "pending_confirmation", deliveryDate: day(1), noticeOnly: true, seq: 1, reportedBy: "portal", createdAt: iso(-1, 12) })
  put(`poMessages/${id("po_partly_received")}__1`, { poId: id("po_partly_received"), organizationId: orgId, supplierOrgId: sup("baraka"), seq: 1, by: "us", authorId: ownerUid, authorName: ownerName, text: "نرجو إرسال الشحنة الثانية", file: null, channel: "portal", at: iso(-2, 10) })
  put(`poMessages/${id("po_partly_received")}__2`, { poId: id("po_partly_received"), organizationId: orgId, supplierOrgId: sup("baraka"), seq: 2, by: "sup", authorId: sup("baraka"), authorName: supName("baraka"), text: "الشحنة الثانية غداً", file: null, channel: "portal", at: iso(-1, 10) })

  // ── Eight incoming requests ──────────────────────────────────────────────────────────────────────────────────────────────────
  const incoming = (doc: IncomingDoc) => put(`procIncoming/${incomingDocId(orgId, doc.mrKey)}`, doc as unknown as Rec)
  const place = { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" }
  const team = (key: string, no: number, lines: Array<{ name: string; unit: string; quantity: number }>, over: Rec = {}) =>
    newTeamRequest({
      organizationId: orgId,
      id: id(key),
      no: `MAT-${year}/0${20 + no}`,
      seq: 20 + no,
      lines,
      needBy: day(20 + no),
      place,
      requestedBy: { id: ownerUid, name: ownerName },
      requestedFor: { kind: "member", id: ownerUid, name: ownerName },
      at: iso(-2 - no),
      ...over,
    })
  const lined = (d: IncomingDoc, patch: (l: IncomingLine, i: number) => IncomingLine): IncomingDoc => ({ ...d, lines: d.lines.map(patch) })
  incoming(team("team_new", 1, [{ name: "الاسمنت العادي", unit: "كيس", quantity: 200 }, { name: "حديد 16", unit: "طن", quantity: 12 }]))
  const partial = team("team_partial", 2, [{ name: "رمل لياسة", unit: "م³", quantity: 30 }, { name: "الاسمنت العادي", unit: "كيس", quantity: 100 }, { name: "بلك خرساني 20 سم", unit: "حبة", quantity: 2000 }])
  incoming({ ...lined(partial, (l, i) => (i === 0 ? { ...l, ps: "rfq", rfqId: q3, rfqNumber: `RFQ-${year}/003`, v: 2 } : i === 1 ? { ...l, ps: "po", poId: id("po_partly_received"), poNumber: `PO-${year}/005`, v: 2 } : l)), st: "part" })
  incoming(team("team_receiver", 3, [{ name: "مسامير 4 إنش", unit: "كرتون", quantity: 6 }], { requestedFor: { kind: "receiver", id: id("rcv_salem"), name: "سالم القحطاني", phone: "+966551112233" } }))
  const failed = team("team_failed", 4, [{ name: "دهان إيبوكسي", unit: "جالون", quantity: 20 }])
  incoming({ ...lined(failed, (l) => ({ ...l, ps: "fail", fail: { code: "avail", why: "المادة غير متوفرة في السوق", alt: "مكافئ من الخرج", at: iso(-1), by: "المشتري" }, v: 2 })), st: "fail", status: "closed" })
  const withdrawn = team("team_withdrawn", 5, [{ name: "أسلاك كهرباء 2.5", unit: "لفة", quantity: 10 }])
  incoming({ ...withdrawn, st: "wd", status: "closed", withdrawn: { at: iso(-1), by: ownerUid, name: ownerName } } as IncomingDoc)

  const projectId = id("project_yasmin")
  put(`projects/${projectId}`, { organizationId: orgId, contractorId: orgId, name: "مجمع الياسمين السكني — 5 فلل", status: "in_progress", enabledSections: ["contract", "procure", "receive", "store"], location: "الرياض - حي الياسمين", pm: { no: `PJ-${year}/001`, lifecycle: "live", startOn: day(-60), durationDays: 300 }, demoSeed: "proc20" })
  const pmRaw = (rid: string, title: string, seq: number, lines: Rec[], over: Rec = {}) => ({
    pm: true,
    seq,
    title,
    status: "approved",
    needBy: day(10 + seq),
    requestedByUserId: ownerUid,
    requestedByUserName: ownerName,
    approvedByName: "م. خالد",
    approvedOn: day(-2),
    createdAt: iso(-3),
    lines,
    items: lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.qty, itemId: l.itemId })),
    ...over,
    id: rid,
  })
  const pmDocs = [
    pmRaw(id("pr_iron"), "زوايا حديد وألواح خشب", 1, [{ itemId: "b1", code: "03-01", key: "k1", name: "زوايا حديد 50×50×5 مم", unit: "م", qty: 175 }]),
    pmRaw(id("pr_blocks"), "بلك الدور الثاني", 2, [{ itemId: "b2", code: "04-01", key: "k2", name: "بلك اسمنتي مفرغ 20", unit: "حبة", qty: 2000 }]),
  ]
  for (const raw of pmDocs) {
    const { id: rid, ...stored } = raw
    put(`projects/${projectId}/purchaseRequests/${rid}`, stored)
    incoming(fromPmRequest(orgId, { id: projectId, name: "مجمع الياسمين السكني — 5 فلل" }, raw as unknown as ProjectRequestDoc & Rec))
  }
  put(`workOrders/${id("wo_stairs")}`, { organizationId: orgId, docNumber: `WO-${year}/052`, productId: id("product_stairs"), productName: "درج رخام — فيلا الملقا", status: "open", sourceKind: "stock", purchaseRequests: [{ id: id("prq_glue"), itemName: "غراء رخام", unit: "كيس", quantity: 20, needBy: day(9), note: null, by: "ورشة", byId: "workshop", at: iso(-1), state: "sent" }], demoSeed: "proc20" })
  incoming(fromMfgRequest(orgId, { id: id("wo_stairs"), ref: `WO-${year}/052`, context: "درج رخام — فيلا الملقا" }, { id: id("prq_glue"), itemName: "غراء رخام", unit: "كيس", quantity: 20, needBy: day(9), note: null, by: "ورشة", byId: "workshop", at: iso(-1), state: "sent" } as never, { number: `MAT-${year}/028`, seq: 28 }))

  // ── The last prices we paid, for «آخر شراء» ────────────────────────────────────────────────────────────────────────────────────
  const history: Array<[string, string, string, number, number, string]> = [
    ["اسياخ حديد التسليح 16 مم", "طن", "east", 2780, -50, "PO-" + year + "/900"],
    ["الاسمنت العادي 50 كجم", "كيس", "horizon", 16, -30, "PO-" + year + "/006"],
    ["بلك خرساني 20 سم", "حبة", "baraka", 3.4, -45, "PO-" + year + "/901"],
    ["رمل لياسة", "م³", "omran", 85, -40, "PO-" + year + "/902"],
    ["زوايا حديد 50×50×5 مم", "م", "quality", 12.8, -35, "PO-" + year + "/903"],
    ["خشب ألواح", "م", "khaleej", 3.7, -35, "PO-" + year + "/904"],
  ]
  history.forEach(([name, unit, key, price, d, poNumber], i) =>
    put(`priceHistory/${id(`h${i + 1}`)}`, { organizationId: orgId, materialKey: materialKey(name, unit), name, unit, supplierOrgId: sup(key), supplierName: supName(key), price, day: day(d), kind: "po", poId: null, poNumber })
  )

  const counters = [
    { path: `mfgCounters/${orgId}__RFQ__${year}`, last: 3 },
    { path: `mfgCounters/${orgId}__PO__${year}`, last: 9 },
    { path: `mfgCounters/${orgId}__MAT__${year}`, last: 28 },
  ]
  const summary: Record<string, number> = {}
  for (const d of docs) {
    const col = d.path.split("/")[0]
    summary[col] = (summary[col] || 0) + 1
  }
  return { docs, counters, links: { rfqLinkId: linkId, orderLinkPoId }, summary }
}

// ---- the run (only when invoked as a script) --------------------------------------------------------------------------------------

const BATCH = 400

function connect(): { db: Firestore; auth: ReturnType<typeof getAuth> } {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (projectId !== UAT_PROJECT) throw new Error(`refusing: .env.uat points at "${projectId || "(nothing)"}", this seed only touches ${UAT_PROJECT}`)
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!clientEmail || !privateKey) throw new Error("the service account is not in .env.uat (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)")
  const app = getApps()[0] || initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId })
  if (app.options.projectId !== UAT_PROJECT) throw new Error("refusing: the Admin app is not on mdmaktech-uat")
  return { db: getFirestore(app), auth: getAuth(app) }
}

async function main(argv: string[]) {
  const target = argv[0]
  const APPLY = argv.includes("--apply")
  const RESET = argv.includes("--reset")
  const emailAt = argv.indexOf("--email")
  const email = emailAt >= 0 ? argv[emailAt + 1] : ""
  if (target !== "uat") {
    console.error(`refusing: "${target || ""}" — this seed runs on UAT only.\nusage: seed-proc20-demo.ts uat --email <contractor owner's e-mail> [--apply] [--reset]`)
    process.exit(2)
  }
  if (!email) {
    console.error("usage: seed-proc20-demo.ts uat --email <contractor owner's e-mail> [--apply] [--reset]   (the contractor must already exist; no account is created)")
    process.exit(2)
  }
  config({ path: resolve(process.cwd(), ".env.uat") })
  const { db, auth } = connect()
  const user = await auth.getUserByEmail(email).catch(() => null)
  if (!user) throw new Error(`no sign-in account for ${email} on ${UAT_PROJECT}`)
  const profile = (await db.doc(`users/${user.uid}`).get()).data() as { role?: string; organizationId?: string; organizationRole?: string; name?: string; companyName?: string } | undefined
  if (!profile || profile.role !== "Contractor") throw new Error(`refusing: ${email} is not a contractor`)
  const orgId = profile.organizationId || user.uid
  if (profile.organizationRole && profile.organizationRole !== "owner" && orgId !== user.uid) throw new Error(`refusing: ${email} is a member of ${orgId}, not its owner — use the owner's e-mail`)
  const world = buildProc20World({ orgId, ownerUid: user.uid, ownerName: profile.name || profile.companyName || "المالك", today: riyadhDay() })
  console.log(`target: ${UAT_PROJECT} · company: ${orgId} (${profile.companyName || profile.name || email}) · today in Riyadh: ${riyadhDay()}`)
  console.log("documents by collection:", JSON.stringify(world.summary))

  let existing = 0
  for (const d of world.docs) if ((await db.doc(d.path).get()).exists) existing++
  console.log(`${existing} of ${world.docs.length} documents already exist`)

  if (RESET) {
    const hashes: string[] = []
    for (const linkPath of [`rfqShareLinks/${world.links.rfqLinkId}`, `orderLinks/${world.links.orderLinkPoId}`]) {
      const data = (await db.doc(linkPath).get()).data() as { tokenHashes?: string[] } | undefined
      hashes.push(...(data?.tokenHashes || []))
    }
    console.log(`${APPLY ? "deleting" : "would delete"} ${existing} documents and ${hashes.length} link tokens`)
    if (!APPLY) return console.log("dry run — add --apply to delete")
    const settings = (await db.doc(`procurementSettings/${orgId}`).get()).data() as { deliverySites?: Array<{ id?: string }> } | undefined
    if (settings?.deliverySites) await db.doc(`procurementSettings/${orgId}`).set({ deliverySites: settings.deliverySites.filter((s) => !String(s.id || "").startsWith(DEMO_PREFIX)) }, { merge: true })
    const paths = [...world.docs.filter((d) => !d.merge).map((d) => d.path), ...hashes.map((h) => `linkTokens/${h}`)]
    for (let i = 0; i < paths.length; i += BATCH) {
      const batch = db.batch()
      for (const p of paths.slice(i, i + BATCH)) batch.delete(db.doc(p))
      await batch.commit()
    }
    return console.log("deleted")
  }

  if (!APPLY) {
    console.log("dry run — add --apply to write")
    return
  }
  for (let i = 0; i < world.docs.length; i += BATCH) {
    const batch = db.batch()
    for (const d of world.docs.slice(i, i + BATCH)) batch.set(db.doc(d.path), d.data, d.merge ? { merge: true } : {})
    await batch.commit()
  }
  for (const c of world.counters) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.doc(c.path))
      const last = Math.max(Number(snap.data()?.last) || 0, c.last)
      const [, type, yearPart] = c.path.split("/")[1].split("__")
      tx.set(db.doc(c.path), { organizationId: orgId, type, year: Number(yearPart), last, updatedAt: new Date().toISOString() }, { merge: true })
    })
  }
  const rfqToken = await mintLinkToken(db, "rfq", world.links.rfqLinkId)
  const orderToken = await mintLinkToken(db, "po", world.links.orderLinkPoId)
  console.log(`written: ${world.docs.length} documents`)
  console.log(`visitor link (the open RFQ, 11 offers): ${linkUrl("rfq", rfqToken)}   [hash ${hashToken(rfqToken).slice(0, 8)}…]`)
  console.log(`order link (PO-${riyadhDay().slice(0, 4)}/009, sent by WhatsApp to an off-platform supplier): ${linkUrl("po", orderToken)}   [hash ${hashToken(orderToken).slice(0, 8)}…]`)
}

const isMain = typeof process !== "undefined" && /seed-proc20-demo\.ts$/.test(process.argv[1] || "")
if (isMain)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })

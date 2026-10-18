// The UAT demo of the Supplier 1.0 FREE account (scripts/seed-supplier-free-demo.ts): one free supplier, two
// contractor companies, and every state the free journey shows — open requests (some new, two invitations, one
// archived, one declined), quotes in each group, orders in each segment, invoices in each segment, transfers to
// confirm and one "not received", a warranty waiting and one accepted, a rating owed and one given, a connection and
// an invitation to connect, conversations and notifications.
//
// PURE: the documents are built here from the day and the account ids, in the shapes the app's own writers store
// (quote acts, award, PO, receipt, invoice server, server acts) — the script only writes them, and
// src/__tests__/supplier-free-demo-seed.test.ts derives the supplier's world from them exactly as FreeWorldProvider
// does. Every document the demo owns has a deterministic id starting with `sfdemo_` (or is keyed by a demo org).

import { randomBytes } from "node:crypto"
import { SEEDED_GROUPS, seededGroupDocId } from "@/lib/permissions"
import { buildProcNotification, sarParam, type ProcEvent } from "@/lib/procurement/events"
import { DEFAULT_POLICIES, type PoDeliveryReport, type PoLogEntry, type PurchaseOrder } from "@/lib/procurement/types"
import { addDaysTo, r2 } from "./deal-logic"
import { deriveWorld, type RawWorld } from "./derive"
import { numberLockId, receiptLockId } from "./invoice-server"
import type { World } from "./types"

export const DEMO_PREFIX = "sfdemo_"

export const DEMO_EMAILS = {
  supplier: "supplier.free.demo@mdmaktech.sa",
  contractorA: "contractor.demo@mdmaktech.sa",
  receiverA: "contractor.demo.receiver@mdmaktech.sa",
  contractorB: "contractor2.demo@mdmaktech.sa",
} as const
export type DemoRole = keyof typeof DEMO_EMAILS

export const DEMO_PEOPLE: Record<DemoRole, { name: string; phone: string; role: "Supplier" | "Contractor"; company: string; what: string }> = {
  supplier: { name: "سلمان العتيبي", phone: "0551230001", role: "Supplier", company: "مؤسسة الركائز لمواد البناء", what: "Free supplier owner — open /supplier (Today, requests, quotes, orders, invoices, connections, messages)" },
  contractorA: { name: "عبدالرحمن السبيعي", phone: "0501110001", role: "Contractor", company: "شركة البناء المتقدم للمقاولات", what: "Contractor A owner — /contractor/rfqs, purchase orders, goods received, approve the waiting PO" },
  receiverA: { name: "فهد الشمري", phone: "0501110003", role: "Contractor", company: "شركة البناء المتقدم للمقاولات", what: "Contractor A site receiver (supply_chain group) — /contractor/goods-received, record the reported delivery" },
  contractorB: { name: "ناصر الدوسري", phone: "0501110002", role: "Contractor", company: "مؤسسة الإعمار الحديث للمقاولات", what: "Contractor B owner — its invitation to connect is pending; Finance → report/answer transfers" },
}

/** The supplier's field: real platform categories (src/lib/constants.ts) — two of them warranty materials. */
export const DEMO_SPECS = ["طوب وبلوك", "أسمنت وخرسانة", "عزل وأسقف", "أدوات صحية وسباكة"] as const
export const DEMO_CITIES = ["الرياض", "الخرج"] as const

export interface DemoIds {
  supplier: string
  contractorA: string
  receiverA: string
  contractorB: string
}

/** `set` replaces the document, `merge` merges into it (a user's profile), `create` writes only when absent
 * (settings and groups a tester may have changed), `max` raises a counter's `last` and never lowers it. */
export type DemoWriteMode = "set" | "merge" | "create" | "max"
export interface DemoDoc {
  path: string
  data: Record<string, unknown>
  mode: DemoWriteMode
}

type Rec = Record<string, unknown>
type Org = "A" | "B"

interface Product {
  name: string
  unit: string
  qty: number
  spec: string
  /** The supplier's unit price before VAT; null = "not supplied" in his quote. */
  price: number | null
}

const CAT = { blocks: "طوب وبلوك", cement: "أسمنت وخرسانة", insul: "عزل وأسقف", plumb: "أدوات صحية وسباكة" } as const
const P = (name: string, unit: string, qty: number, price: number | null, spec = ""): Product => ({ name, unit, qty, price, spec })

const FILE = (name: string) => ({ name, url: `https://mdmaktech.sa/demo/${encodeURIComponent(name)}` })

export interface BuildOptions {
  /** A fresh invitation token (the script passes a random one; tests may omit it). */
  inviteToken?: string
}

export interface DemoBuild {
  docs: DemoDoc[]
  /** Request id → what it demonstrates, for the dry run and the test. */
  keys: Record<string, string>
}

export function buildSupplierFreeDemo(ids: DemoIds, today: string, opts: BuildOptions = {}): DemoBuild {
  const D = (n: number) => addDaysTo(today, n)
  /** A moment on day `n` at Riyadh hour `h` (UTC+3), as an ISO string — the form the app's writers store. */
  const at = (n: number, h = 10, m = 0) => {
    const [y, mo, d] = D(n).split("-").map(Number)
    return new Date(Date.UTC(y, mo - 1, d, h - 3, m)).toISOString()
  }
  const year = Number(today.slice(0, 4))
  const docs: DemoDoc[] = []
  const keys: Record<string, string> = {}
  const put = (path: string, data: Rec, mode: DemoWriteMode = "set") => docs.push({ path, data, mode })

  const sup = ids.supplier
  const supName = DEMO_PEOPLE.supplier.name
  const supCompany = DEMO_PEOPLE.supplier.company
  const org = (o: Org) => (o === "A" ? ids.contractorA : ids.contractorB)
  const owner = (o: Org) => (o === "A" ? DEMO_PEOPLE.contractorA : DEMO_PEOPLE.contractorB)
  /** Who records receipts: A's site receiver (a member of A), B's owner — both in the buying company (B-01). */
  const receiver = (o: Org) => (o === "A" ? { uid: ids.receiverA, name: DEMO_PEOPLE.receiverA.name } : { uid: ids.contractorB, name: DEMO_PEOPLE.contractorB.name })

  // ---- numbering: realistic mid-year sequences, the counters raised past them --------------------------------------
  const seq: Record<string, number> = { A_RFQ: 100, B_RFQ: 300, A_PO: 40, B_PO: 70, A_GR: 60, B_GR: 90 }
  const next = (o: Org, type: "RFQ" | "PO" | "GR") => {
    const k = `${o}_${type}`
    seq[k] += 1
    return `${type}-${year}/${String(seq[k]).padStart(3, "0")}`
  }

  // ---- requests ----------------------------------------------------------------------------------------------------
  interface RfqSpec {
    key: string
    o: Org
    cat: string
    title: string
    city: string
    district?: string
    posted: number
    deadline: number
    pricing: "line" | "total"
    products: Product[]
    private?: boolean
    terms?: { pct: number; days: number }[]
    notes?: string
  }
  interface Built {
    spec: RfqSpec
    id: string
    no: string
    doc: Rec
  }

  const rfq = (s: RfqSpec, status: "New" | "Awarded" | "Cancelled" = "New", extra: Rec = {}): Built => {
    const id = `${DEMO_PREFIX}rfq_${s.key}`
    const no = next(s.o, "RFQ")
    const o = owner(s.o)
    const doc: Rec = {
      contractorId: org(s.o),
      organizationId: org(s.o),
      projectId: null,
      title: s.title,
      category: s.cat,
      subCategory: s.products.length === 1 ? s.products[0].name : "متعدد",
      products: s.products.map((p) => ({ name: p.name, quantity: p.qty, unitOfMeasure: p.unit, description: p.spec || p.name, category: s.cat, subCategory: p.name, requiresWarranty: s.cat === CAT.insul || s.cat === CAT.plumb })),
      needBy: D(s.deadline + 14),
      deadline: D(s.deadline),
      estimatedBudget: null,
      country: "SA",
      city: s.city,
      district: s.district || "",
      notes: s.notes || "",
      pdfUrl: null,
      status,
      pricingMode: s.pricing,
      visibility: s.private ? "private" : "public",
      allowedSupplierOrgIds: s.private ? [sup] : [],
      orderedFromMdmakDirect: false,
      requiresWarranty: s.cat === CAT.insul || s.cat === CAT.plumb,
      paymentTermsList: s.terms || null,
      createdByUserId: org(s.o),
      createdByUserName: o.name,
      createdAt: at(s.posted, 9, 30),
      rfqNumber: no,
      offersCount: 0,
      log: [],
      ...extra,
    }
    put(`rfqs/${id}`, doc)
    return { spec: s, id, no, doc }
  }

  // ---- 28 open public requests in his field, across both contractors (6 posted within two days) -------------------
  const OPEN: Omit<RfqSpec, "key" | "o" | "posted" | "deadline">[] = [
    { cat: CAT.blocks, title: "بلوك أسمنتي مفرغ 20 سم — فلل حي النرجس", city: "الرياض", district: "شمال الرياض", pricing: "line", products: [P("بلوك أسمنتي مفرغ", "حبة", 12000, null, "20×20×40 سم، مقاومة 70 كجم/سم²")] },
    { cat: CAT.cement, title: "أسمنت بورتلاندي عادي — 2000 كيس", city: "الرياض", district: "شرق الرياض", pricing: "line", products: [P("أسمنت بورتلاندي عادي", "كيس 50 كجم", 2000, null)] },
    { cat: CAT.insul, title: "عزل مائي رولات بيتومين لسطح فيلا", city: "الرياض", district: "غرب الرياض", pricing: "line", products: [P("عزل مائي (رولات بيتومين)", "رول", 140, null, "4 مم، مقوّى بالبوليستر")] },
    { cat: CAT.plumb, title: "مواسير PPR مقاسات مختلفة — 12 فيلا", city: "الرياض", district: "جنوب الرياض", pricing: "line", products: [P("مواسير PPR 25 مم", "متر", 3000, null), P("مواسير PPR 32 مم", "متر", 1500, null)] },
    { cat: CAT.blocks, title: "بلوك عازل لجدران خارجية — مجمع تجاري", city: "الخرج", pricing: "line", products: [P("بلوك عازل (إنسوليت)", "حبة", 6000, null)] },
    { cat: CAT.cement, title: "خرسانة جاهزة C30 لصب سقف", city: "الرياض", district: "وسط الرياض", pricing: "total", products: [P("خرسانة جاهزة", "م³", 120, null, "C30، مع مضخة")] },
    { cat: CAT.insul, title: "عزل حراري XPS 5 سم لجدران عمارة", city: "الرياض", district: "شمال الرياض", pricing: "line", products: [P("عزل حراري (بولي ستايرين XPS)", "م²", 900, null, "سماكة 5 سم")] },
    { cat: CAT.plumb, title: "مواسير PVC صرف 4 بوصة", city: "الرياض", district: "شرق الرياض", pricing: "line", products: [P("مواسير PVC صرف", "متر", 1800, null, "4 بوصة، ضغط 6 بار")] },
    { cat: CAT.blocks, title: "طوب أحمر مفرغ لسور مدرسة", city: "الخرج", pricing: "total", products: [P("طوب أحمر مفرغ", "حبة", 9000, null)] },
    { cat: CAT.cement, title: "أسمنت مقاوم للكبريتات لخزان أرضي", city: "الرياض", district: "جنوب الرياض", pricing: "line", products: [P("أسمنت مقاوم للكبريتات", "كيس 50 كجم", 800, null)] },
    { cat: CAT.insul, title: "ألواح ساندوتش بانل لمستودع", city: "الخرج", pricing: "total", products: [P("ألواح ساندوتش بانل", "م²", 1200, null, "سماكة 50 مم")] },
    { cat: CAT.plumb, title: "خلاطات مياه للحمامات — مبنى إداري", city: "الرياض", district: "وسط الرياض", pricing: "line", products: [P("خلاطات مياه", "حبة", 96, null)] },
    { cat: CAT.blocks, title: "بلوك مصمت 15 سم لأعمال الأساسات", city: "الرياض", district: "غرب الرياض", pricing: "line", products: [P("بلوك أسمنتي مصمت", "حبة", 4000, null, "15×20×40 سم")] },
    { cat: CAT.cement, title: "إضافات خرسانية (ملدنات) — مشروع مدرسة", city: "الخرج", pricing: "line", products: [P("إضافات خرسانية", "لتر", 600, null)] },
    { cat: CAT.insul, title: "عزل مائي سائل لخزانات علوية", city: "الرياض", district: "شمال الرياض", pricing: "line", products: [P("عزل مائي سائل", "جالون", 90, null)] },
    { cat: CAT.plumb, title: "سخانات مياه كهربائية 80 لتر", city: "الخرج", pricing: "line", products: [P("سخانات مياه كهربائية", "حبة", 40, null, "80 لتر")] },
    { cat: CAT.blocks, title: "طوب أبيض خفيف (سيبوركس) لقواطع داخلية", city: "الرياض", district: "شرق الرياض", pricing: "line", products: [P("طوب أبيض خفيف (سيبوركس)", "م³", 80, null)] },
    { cat: CAT.cement, title: "أسمنت أبيض لأعمال التشطيب", city: "الرياض", district: "جنوب الرياض", pricing: "line", products: [P("أسمنت أبيض", "كيس 40 كجم", 300, null)] },
    { cat: CAT.insul, title: "صوف صخري للأسقف المستعارة", city: "الرياض", district: "وسط الرياض", pricing: "line", products: [P("عزل حراري (صوف صخري)", "م²", 650, null)] },
    { cat: CAT.plumb, title: "خزانات مياه بولي إيثيلين 5000 لتر", city: "الرياض", district: "غرب الرياض", pricing: "total", products: [P("خزانات مياه (فيبر / ستانلس / بولي إيثيلين)", "حبة", 12, null, "5000 لتر")] },
    { cat: CAT.blocks, title: "بلوك مفرغ 10 و15 سم — عمارة سكنية", city: "الرياض", district: "شمال الرياض", pricing: "line", products: [P("بلوك أسمنتي مفرغ 10 سم", "حبة", 5000, null), P("بلوك أسمنتي مفرغ 15 سم", "حبة", 7000, null)] },
    { cat: CAT.cement, title: "خرسانة مسبقة الصب — بلاطات أسوار", city: "", pricing: "total", products: [P("خرسانة مسبقة الصب (بريكاست)", "م²", 450, null)] },
    { cat: CAT.insul, title: "مانع رطوبة لأساسات عمارة", city: "الرياض", district: "جنوب الرياض", pricing: "line", products: [P("مانع رطوبة", "لتر", 400, null)] },
    { cat: CAT.plumb, title: "محابس وصمامات — شبكة مياه", city: "الرياض", district: "شرق الرياض", pricing: "line", products: [P("محابس وصمامات", "حبة", 350, null)] },
    { cat: CAT.blocks, title: "بلوك أسمنتي مفرغ — مستودعات الخرج", city: "الخرج", pricing: "total", products: [P("بلوك أسمنتي مفرغ", "حبة", 15000, null)] },
    { cat: CAT.cement, title: "أسمنت تشطيب (لياسة) — 1500 كيس", city: "الرياض", district: "غرب الرياض", pricing: "line", products: [P("أسمنت تشطيب (لياسة)", "كيس 50 كجم", 1500, null)] },
    { cat: CAT.insul, title: "ألواح بولي كربونيت لمظلات مواقف", city: "الرياض", district: "وسط الرياض", pricing: "total", products: [P("ألواح بولي كربونيت", "م²", 300, null)] },
    { cat: CAT.plumb, title: "مضخات مياه لعمارة سكنية", city: "", pricing: "line", products: [P("مضخات مياه", "حبة", 6, null, "1.5 حصان")] },
  ]
  const POSTED = [0, 0, -1, -1, -2, -2, -3, -3, -4, -4, -5, -5, -6, -6, -7, -7, -8, -8, -9, -9, -10, -10, -11, -11, -12, -12, -13, -14]
  const DEADLINE = [1, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 21, 6, 4, 2, 9, 12, 14, 7]
  OPEN.forEach((s, i) => {
    const key = `open_${String(i + 1).padStart(2, "0")}`
    const b = rfq({ ...s, key, o: i % 2 === 0 ? "A" : "B", posted: POSTED[i], deadline: DEADLINE[i] })
    keys[b.id] = POSTED[i] >= -2 ? "open request — new" : "open request"
  })
  const archived = rfq({ key: "archived", o: "A", cat: CAT.plumb, title: "أطقم حمامات لمشروع فندقي", city: "الرياض", district: "شمال الرياض", posted: -4, deadline: 9, pricing: "line", products: [P("أطقم حمامات (كرسي إفرنجي + مغسلة)", "طقم", 60, null)] })
  keys[archived.id] = "open request — archived (not for me)"

  // Invitations by name: two to answer, one he already declined.
  const inv1 = rfq({ key: "invite_1", o: "A", cat: CAT.insul, title: "عزل مائي لسطح مبنى إداري — دعوة خاصة", city: "الرياض", district: "شمال الرياض", posted: -1, deadline: 3, pricing: "line", private: true, products: [P("عزل مائي (رولات بيتومين)", "رول", 220, null), P("عزل مائي سائل", "جالون", 40, null)], notes: "نرغب بعرضكم لأنكم وردتم لنا سابقاً" })
  const inv2 = rfq({ key: "invite_2", o: "B", cat: CAT.plumb, title: "أدوات صحية لمجمع فلل — دعوة خاصة", city: "الخرج", posted: 0, deadline: 5, pricing: "line", private: true, products: [P("أطقم حمامات (كرسي إفرنجي + مغسلة)", "طقم", 24, null), P("شطافات", "حبة", 24, null)], notes: "يمكنكم الاعتذار إن لم يكن الصنف ضمن توريدكم" })
  const inv3 = rfq({ key: "invite_declined", o: "B", cat: CAT.blocks, title: "بلوك أسمنتي لمشروع حكومي — دعوة خاصة", city: "الخرج", posted: -3, deadline: 4, pricing: "line", private: true, products: [P("بلوك أسمنتي مفرغ", "حبة", 40000, null)] })
  keys[inv1.id] = "invitation by name — to quote"
  keys[inv2.id] = "invitation by name — to quote or decline"
  keys[inv3.id] = "invitation he declined (closed, no quote)"

  // ---- quotes -------------------------------------------------------------------------------------------------------
  interface Version {
    day: number
    /** Unit price per product (null = not supplied); total-priced requests use `total`. */
    prices?: (number | null)[]
    total?: number
    arrive: number
    note?: string
  }
  const versionDoc = (b: Built, v: Version, n: number) => {
    const lines = b.spec.pricing === "line" ? (v.prices || b.spec.products.map((p) => p.price)).map((u, k) => (u == null ? null : { rfqProductIndex: k, unitPrice: u })).filter((x): x is { rfqProductIndex: number; unitPrice: number } => !!x) : undefined
    const total = lines ? r2(lines.reduce((s, l) => s + l.unitPrice * b.spec.products[l.rfqProductIndex].qty, 0)) : r2(v.total || 0)
    const out: Rec = { n, at: D(v.day), arrive: D(v.arrive), valid: D(v.day + 30), note: v.note || "", fileUrl: null, total, vatRate: 0.15 }
    if (lines) out.lines = lines
    return { doc: out, total, lines }
  }
  interface Quote {
    id: string
    total: number
    doc: Rec
  }
  const quote = (b: Built, versions: Version[], extra: Rec = {}): Quote => {
    const id = `${DEMO_PREFIX}off_${b.spec.key}`
    const vs = versions.map((v, i) => versionDoc(b, v, i + 1))
    const last = vs[vs.length - 1]
    const lastV = versions[versions.length - 1]
    const location = [b.spec.city, b.spec.district].filter(Boolean).join(" — ")
    const doc: Rec = {
      supplierId: sup,
      organizationId: sup,
      supplierName: supCompany,
      companyName: supCompany,
      submittedByUserId: sup,
      submittedByUserName: supName,
      rfqId: b.id,
      rfqTitle: b.spec.title,
      projectId: null,
      contractorId: org(b.spec.o),
      contractorOrgId: org(b.spec.o),
      price: String(last.total),
      deliveryLocation: location,
      deliveryBatches: [{ location, deliveryDate: D(lastV.arrive), price: String(last.total), quantity: String(b.spec.products.reduce((s, p) => s + p.qty, 0)) }],
      validUntil: D(lastV.day + 30),
      status: "قيد المراجعة",
      versions: vs.map((v) => v.doc),
      createdAt: at(versions[0].day, 11),
      updatedAt: at(lastV.day, 11),
      ...(versions.length > 1 ? { priceHistory: vs.slice(0, -1).map((v, i) => ({ price: String(v.total), replacedAt: at(versions[i + 1].day, 11), by: sup })) } : {}),
      ...(last.lines ? { lines: last.lines } : {}),
      ...(lastV.note ? { supplierNote: lastV.note } : {}),
      ...extra,
    }
    const skipped = b.spec.pricing === "line" ? (lastV.prices || b.spec.products.map((p) => p.price)).map((u, k) => (u == null ? k : -1)).filter((k) => k >= 0) : []
    if (skipped.length) doc.skippedItems = skipped
    put(`offers/${id}`, doc)
    b.doc.offersCount = 1
    return { id, total: last.total, doc }
  }

  // Awaiting the contractor's decision.
  const q1 = rfq({ key: "q_review_open", o: "A", cat: CAT.blocks, title: "بلوك مفرغ ومصمت — فيلا الياسمين", city: "الرياض", district: "شمال الرياض", posted: -3, deadline: 4, pricing: "line", products: [P("بلوك أسمنتي مفرغ", "حبة", 8000, 3.05), P("بلوك أسمنتي مصمت", "حبة", 2500, 3.55)] })
  quote(q1, [{ day: -1, arrive: 9, note: "التوريد على دفعتين حسب جاهزية الموقع" }])
  const q2 = rfq({ key: "q_review_v2", o: "B", cat: CAT.cement, title: "خرسانة جاهزة C35 لصب أساسات", city: "الخرج", posted: -9, deadline: -2, pricing: "total", products: [P("خرسانة جاهزة", "م³", 90, null, "C35، مع مضخة")] })
  quote(q2, [{ day: -6, total: 24300, arrive: 6 }, { day: -4, total: 23650, arrive: 6, note: "خصم بعد مراجعة تكلفة النقل" }])
  const q3 = rfq({ key: "q_review_closed", o: "A", cat: CAT.insul, title: "عزل XPS لأسطح مدرسة أهلية", city: "الرياض", district: "شرق الرياض", posted: -8, deadline: -1, pricing: "line", products: [P("عزل حراري (بولي ستايرين XPS)", "م²", 600, 38.5, "سماكة 5 سم")] })
  quote(q3, [{ day: -5, arrive: 7 }])
  const q4 = rfq({ key: "q_review_partial", o: "A", cat: CAT.plumb, title: "مواسير PPR ومحابس — مجمع سكني", city: "الرياض", district: "جنوب الرياض", posted: -2, deadline: 2, pricing: "line", products: [P("مواسير PPR 25 مم", "متر", 2000, 6.8), P("مواسير PPR 32 مم", "متر", 900, 9.4), P("محابس وصمامات", "حبة", 120, null)] })
  quote(q4, [{ day: 0, arrive: 8, note: "المحابس غير متوفرة لدينا حالياً" }])
  keys[q1.id] = "quote awaiting decision (still open — edit/withdraw)"
  keys[q2.id] = "quote awaiting decision — two versions"
  keys[q3.id] = "quote awaiting decision (submissions closed)"
  keys[q4.id] = "quote awaiting decision — one item not supplied"

  // A price cut asked.
  const q5 = rfq({ key: "q_reduce", o: "A", cat: CAT.blocks, title: "بلوك عازل لواجهات مبنى تجاري", city: "الرياض", district: "غرب الرياض", posted: -10, deadline: -3, pricing: "line", products: [P("بلوك عازل (إنسوليت)", "حبة", 4000, 6.6)] })
  const q5o = quote(q5, [{ day: -6, arrive: 10 }], { status: "مطلوب تخفيض", targetPrice: 24800, reductionAt: D(-1), reductionBy: D(2), reductionNote: "السعر أعلى من الميزانية بنحو 6%، نأمل مراجعته", decidedAt: at(-1, 12), updatedAt: at(-1, 12) })
  keys[q5.id] = "price cut requested (target + reply-by)"
  // A sample asked, and one sent.
  const q6 = rfq({ key: "q_sample", o: "B", cat: CAT.insul, title: "ألواح XPS لعزل جدران فلل", city: "الخرج", posted: -9, deadline: -2, pricing: "line", products: [P("عزل حراري (بولي ستايرين XPS)", "م²", 1200, 37.9, "سماكة 5 سم")] })
  quote(q6, [{ day: -5, arrive: 9 }], { sampleStatus: "مطلوبة", sampleWhat: "عينة لوح XPS سماكة 5 سم مع شهادة المصنع", samplePlace: "موقع المشروع — الخرج، حي الخالدية", sampleBy: D(3), sampleRequestedAt: at(-1, 13) })
  const q7 = rfq({ key: "q_sample_sent", o: "A", cat: CAT.plumb, title: "خلاطات مياه لفندق — فئة ممتازة", city: "الرياض", district: "وسط الرياض", posted: -12, deadline: -4, pricing: "line", products: [P("خلاطات مياه", "حبة", 64, 185)] })
  quote(q7, [{ day: -7, arrive: 6 }], { sampleStatus: "تم الإرسال", sampleWhat: "خلاط مغسلة وخلاط دش", samplePlace: "مكتب المشروع — طريق الملك فهد", sampleBy: D(-1), sampleRequestedAt: at(-4, 10), sampleSentAt: D(-2), sampleReceivedBy: "م. خالد — مكتب المشروع", sampleNote: "أُرسلت مع المندوب", sampleUpdatedAt: at(-2, 15) })
  keys[q6.id] = "sample requested"
  keys[q7.id] = "sample sent"

  // Results.
  const q9 = rfq({ key: "q_lost", o: "B", cat: CAT.blocks, title: "بلوك أسمنتي مفرغ — مدارس الخرج", city: "الخرج", posted: -11, deadline: -4, pricing: "line", products: [P("بلوك أسمنتي مفرغ", "حبة", 10000, 3.15)] }, "Awarded", { awardedAt: at(-1, 14) })
  quote(q9, [{ day: -6, arrive: 8 }], { outcome: { k: "lost", at: at(-1, 14), why: "price" }, updatedAt: at(-1, 14) })
  const q10 = rfq({ key: "q_noaward", o: "A", cat: CAT.insul, title: "رولات عزل مائي لملحق", city: "الرياض", district: "جنوب الرياض", posted: -14, deadline: -6, pricing: "line", products: [P("عزل مائي (رولات بيتومين)", "رول", 200, 96)] }, "Cancelled", {
    cancellation: { code: "need", byId: ids.contractorA, byName: DEMO_PEOPLE.contractorA.name, at: at(-2, 9) },
    cancelledAt: at(-2, 9),
  })
  quote(q10, [{ day: -9, arrive: 5 }], { outcome: { k: "noaward", at: at(-2, 9), why: "need" }, updatedAt: at(-2, 9) })
  const q11 = rfq({ key: "q_withdrawn", o: "B", cat: CAT.cement, title: "أسمنت مقاوم للكبريتات — خزان مياه", city: "الخرج", posted: -4, deadline: 6, pricing: "line", products: [P("أسمنت مقاوم للكبريتات", "كيس 50 كجم", 600, 17.4)] })
  quote(q11, [{ day: -3, arrive: 10 }], { status: "مسحوب", withdrawnAt: at(-1, 16), withdrawnById: sup, withdrawnByName: supName, updatedAt: at(-1, 16) })
  keys[q9.id] = "lost — awarded to another (price)"
  keys[q10.id] = "closed with no award (no longer needed)"
  keys[q11.id] = "withdrawn"

  // ---- orders -------------------------------------------------------------------------------------------------------
  interface Receipt {
    day: number
    /** Counted per product index; rejected and its reason optional. */
    lines: { k: number; counted: number; rejected?: number; reason?: "damaged" | "wrong_spec"; note?: string }[]
    note?: string
  }
  interface Transfer {
    day: number
    amount: number
    state: "sent" | "ok" | "miss"
    answeredDay?: number
    note?: string
    ref: string
    bank: string
  }
  interface OrderSpec {
    b: Built
    versions: Version[]
    decided: number
    status: PurchaseOrder["status"]
    sent?: number
    accepted?: number
    promised?: number
    requested: number
    receipts?: Receipt[]
    report?: { day: number; date: number; note: string }
    invoice?: { day: number; number: string; grns?: "all" | number[] }
    transfers?: Transfer[]
    warranty?: { item: number; until: number; created: number; accepted?: number; file: string }
    closed?: number
    decline?: { day: number; reason: "stock" | "price" | "date" | "other"; reasonText: string; note: string }
    supplierRating?: { day: number; stars: number; text: string }
    contractorReview?: { day: number; stars: number; text: string }
  }
  interface Order {
    po: Rec & { lines: Rec[]; log: PoLogEntry[] }
    poId: string
    offerId: string
    no: string
    grNos: string[]
    invoiceId: string | null
  }

  const order = (s: OrderSpec): Order => {
    const b = s.b
    const o = b.spec.o
    const ow = owner(o)
    const buyer = { uid: org(o), name: ow.name }
    const q = quote(b, s.versions)
    const poId = `${DEMO_PREFIX}po_${b.spec.key}`
    const no = next(o, "PO")
    const lump = b.spec.pricing === "total"
    const prices = s.versions[s.versions.length - 1].prices || b.spec.products.map((p) => p.price)
    const awarded = b.spec.products.map((p, k) => ({ p, k, price: lump ? null : prices[k] })).filter((x) => lump || x.price != null)
    const log: PoLogEntry[] = []
    const L = (day: number, h: number, who: { uid: string; name: string }, action: PoLogEntry["action"], params: Record<string, string | number> | null = null, note: string | null = null) =>
      log.push({ at: at(day, h), byId: who.uid, byName: who.name, action, note, params })

    // Receipts: what the gate accepted, per line.
    const accepted = new Map<number, number>()
    const rejected = new Map<number, number>()
    const grNos: string[] = []
    const rc = receiver(o)
    ;(s.receipts || []).forEach((r, n) => {
      const gr = next(o, "GR")
      grNos.push(gr)
      const lines = r.lines.map((l) => {
        const p = b.spec.products[l.k]
        const rej = l.rejected || 0
        accepted.set(l.k, (accepted.get(l.k) || 0) + l.counted - rej)
        rejected.set(l.k, (rejected.get(l.k) || 0) + rej)
        return { poLineId: `l${l.k + 1}`, name: p.name, unit: p.unit, noticeQuantity: l.counted, counted: l.counted, rejected: rej, rejectReason: rej ? l.reason || "damaged" : null, rejectNote: rej ? l.note || null : null, held: 0, holdReason: null, accepted: l.counted - rej }
      })
      const net = lump ? null : r2(lines.reduce((sum, l) => sum + l.accepted * (prices[Number(l.poLineId.slice(1)) - 1] as number), 0))
      put(`deliveries/${DEMO_PREFIX}gr_${b.spec.key}_${n + 1}`, {
        contractorOrgId: org(o),
        contractorId: rc.uid,
        supplierId: sup,
        supplierOrgId: sup,
        offerId: q.id,
        rfqId: b.id,
        poId,
        poNumber: no,
        docNumber: gr,
        supplierName: supCompany,
        rfqTitle: b.spec.title,
        projectId: null,
        deliveryDate: D(r.day),
        lines,
        status: "confirmed",
        receivedByName: rc.name,
        receiverUserId: rc.uid,
        confirmedAt: at(r.day, 11, 20),
        confirmedByUserId: rc.uid,
        confirmedByName: rc.name,
        createdAt: at(r.day, 11, 20),
        checklist: ["delivery_note", "photos"],
        vehiclePlate: "أ ب ج 4521",
        receiptNote: r.note || null,
        landedWarehouseId: null,
        selfReceived: false,
        postedNet: net,
      })
      L(r.day, 11, rc, "received", { number: gr })
    })

    const lines = awarded.map(({ p, k, price }) => ({
      id: `l${k + 1}`,
      name: p.name,
      unit: p.unit,
      quantity: p.qty,
      unitPrice: price,
      accepted: accepted.get(k) || 0,
      rejected: rejected.get(k) || 0,
      held: 0,
      cancelled: 0,
      boqItemId: null,
      rfqProductIndex: k,
    }))
    const total = q.total
    const terms = b.spec.terms || [{ pct: 100, days: 30 }]
    const sentAt = s.sent != null ? at(s.sent, 12) : null
    L(s.decided, 12, buyer, "created", { basis: "rfq", number: no })
    if (s.status !== "awaiting_approval") L(s.sent ?? s.decided, 11, buyer, "approved", null)
    if (sentAt) L(s.sent as number, 12, buyer, "sent", { channel: "portal" })
    if (s.accepted != null && s.promised != null) L(s.accepted, 9, { uid: sup, name: supName }, "supplier_accepted", { date: D(s.promised), recordedBy: "supplier" })

    const reports: PoDeliveryReport[] = []
    if (s.report) {
      reports.push({ id: "r1", at: at(s.report.day, 15), date: D(s.report.date), note: s.report.note, byId: sup, byName: supName, reminders: [], closedAt: null })
      L(s.report.day, 15, { uid: sup, name: supName }, "delivery_reported", { date: D(s.report.date) }, s.report.note)
    }

    const po: Rec & { lines: Rec[]; log: PoLogEntry[] } = {
      organizationId: org(o),
      docNumber: no,
      status: s.status,
      basis: "rfq",
      rfqId: b.id,
      rfqTitle: b.spec.title,
      offerId: q.id,
      projectId: null,
      projectName: null,
      category: b.spec.cat,
      purchaseSource: null,
      supplierOrgId: sup,
      supplierUserId: sup,
      supplierName: supCompany,
      isGuestSupplier: false,
      lines,
      totalExVat: total,
      vatRate: 0.15,
      paymentTerms: null,
      deliveryLocation: [b.spec.city, b.spec.district].filter(Boolean).join(" — ") || null,
      receiverName: rc.name,
      leadTimeDays: null,
      offersCount: 1,
      lowestOfferTotal: total,
      awardReasonCode: null,
      awardReasonText: null,
      shortCompetition: total >= DEFAULT_POLICIES.competitionThreshold,
      noOfficialQuote: true,
      requestedDeliveryDate: D(s.requested),
      preparedById: buyer.uid,
      preparedByName: buyer.name,
      createdAt: at(s.decided, 12),
      approverKind: total > DEFAULT_POLICIES.managerApprovalLimit ? "owner" : "manager",
      approvedById: s.status === "awaiting_approval" ? null : buyer.uid,
      approvedByName: s.status === "awaiting_approval" ? null : buyer.name,
      approvedAt: s.status === "awaiting_approval" ? null : at(s.sent ?? s.decided, 11),
      returnedReason: null,
      sentAt,
      sentById: sentAt ? buyer.uid : null,
      sentByName: sentAt ? buyer.name : null,
      sentChannel: sentAt ? "portal" : null,
      supplierAcceptedAt: s.accepted != null ? at(s.accepted, 9) : null,
      promisedDate: s.promised != null ? D(s.promised) : null,
      acceptanceRecordedBy: s.accepted != null ? "supplier" : null,
      closedAt: s.closed != null ? at(s.closed, 16) : null,
      cancelledReason: null,
      rating: null,
      termsList: terms,
      supplierDecline: null,
      deliveryReports: reports,
      log,
      updatedAt: at(0, 8),
    }
    if (s.decline) {
      po.supplierDecline = { at: at(s.decline.day, 10), reason: s.decline.reason, note: s.decline.note, byId: sup, byName: supName }
      po.cancelledReason = s.decline.reasonText
      po.closedAt = at(s.decline.day, 10)
      L(s.decline.day, 10, { uid: sup, name: supName }, "supplier_declined", { reason: s.decline.reason }, s.decline.note)
    }

    // The invoice (one per receipt, decision 1) and its locks, as the invoice server writes them.
    let invoiceId: string | null = null
    if (s.invoice) {
      const grns = s.invoice.grns === "all" || !s.invoice.grns ? grNos : s.invoice.grns.map((n) => grNos[n])
      const amountNet = lump
        ? total
        : r2(
            grns.reduce((sum, g) => {
              const n = grNos.indexOf(g)
              const r = (s.receipts || [])[n]
              return sum + r.lines.reduce((x, l) => x + (l.counted - (l.rejected || 0)) * (prices[l.k] as number), 0)
            }, 0)
          )
      invoiceId = `${DEMO_PREFIX}si_${b.spec.key}`
      put(`supplierInvoices/${invoiceId}`, {
        poId,
        rfqId: b.id,
        offerId: q.id,
        supplierOrgId: sup,
        buyerOrgId: org(o),
        number: s.invoice.number,
        date: D(s.invoice.day),
        amountNet,
        vat: 0.15,
        file: FILE(`فاتورة-${s.invoice.number}.pdf`),
        grns,
        createdAt: at(s.invoice.day, 14),
        createdById: sup,
        createdByName: supName,
        createdTs: at(s.invoice.day, 14),
      })
      for (const g of grns) put(`supplierInvoiceLocks/${receiptLockId(poId, g)}`, { poId, supplierOrgId: sup, invoiceId, createdAt: at(s.invoice.day, 14) })
      put(`supplierInvoiceLocks/${numberLockId(sup, s.invoice.number)}`, { poId, supplierOrgId: sup, invoiceId, createdAt: at(s.invoice.day, 14) })
      L(s.invoice.day, 14, { uid: sup, name: supName }, "invoice_uploaded", { invoice: s.invoice.number, receipts: grns.join("، "), amount: amountNet })
    }

    // Finance's transfers and the supplier's answers.
    const fin = { uid: org(o), name: ow.name }
    ;(s.transfers || []).forEach((t, n) => {
      const answers: Rec[] = []
      const doc: Rec = {
        poId,
        rfqId: b.id,
        supplierOrgId: sup,
        buyerOrgId: org(o),
        amount: r2(t.amount),
        bank: t.bank,
        ref: t.ref,
        valueDate: D(t.day),
        state: t.state,
        answers,
        reportedAt: at(t.day, 13),
        reportedById: fin.uid,
        reportedByName: fin.name,
        createdTs: at(t.day, 13),
      }
      if (t.state === "ok") {
        const day = t.answeredDay ?? t.day
        Object.assign(doc, { confirmedAt: at(day, 17), confirmedById: sup })
        answers.push({ answer: "ok", at: at(day, 17), byId: sup, byName: supName, note: null })
        L(day, 17, { uid: sup, name: supName }, "transfer_confirmed", { ref: t.ref, amount: r2(t.amount) })
      }
      if (t.state === "miss") {
        const day = t.answeredDay ?? t.day
        Object.assign(doc, { note: t.note || "", missedAt: at(day, 17), missedById: sup })
        answers.push({ answer: "miss", at: at(day, 17), byId: sup, byName: supName, note: t.note || null })
        L(day, 17, { uid: sup, name: supName }, "transfer_missing", { ref: t.ref, amount: r2(t.amount) }, t.note || null)
      }
      put(`supplierTransfers/${DEMO_PREFIX}tr_${b.spec.key}_${n + 1}`, doc)
    })

    if (s.warranty) {
      const w = s.warranty
      const p = b.spec.products[w.item]
      const doc: Rec = {
        poId,
        rfqId: b.id,
        supplierOrgId: sup,
        buyerOrgId: org(o),
        itemId: `i${w.item + 1}`,
        itemName: p.name,
        category: b.spec.cat,
        until: D(w.until),
        file: FILE(w.file),
        state: w.accepted != null ? "ok" : "wait",
        createdAt: at(w.created, 10),
        createdById: sup,
        createdByName: supName,
      }
      L(w.created, 10, { uid: sup, name: supName }, "warranty_registered", { item: p.name, date: D(w.until) })
      if (w.accepted != null) {
        Object.assign(doc, { acceptedAt: at(w.accepted, 12), acceptedById: buyer.uid, acceptedByName: buyer.name })
        L(w.accepted, 12, buyer, "warranty_accepted", { item: p.name })
      }
      put(`supplierWarranties/${poId}`, doc)
    }

    const material = lines.map((l) => l.name).join("، ")
    if (s.contractorReview) {
      const r = s.contractorReview
      po.rating = { onTime: true, lateByDays: 0, inFull: true, rejectPercent: 0, conformity: r.stars, cooperation: r.stars, note: r.text, publishAnonymously: false, byId: buyer.uid, byName: buyer.name, at: at(r.day, 12) }
      L(r.day, 12, buyer, "rated", null)
      put(`reviews/${DEMO_PREFIX}review_${b.spec.key}`, { offerId: q.id, rfqId: b.id, poId, poNumber: no, material, reviewerId: buyer.uid, reviewerOrgId: org(o), reviewerName: ow.company, reviewerRole: "Contractor", revieweeId: sup, revieweeName: supCompany, revieweeRole: "Supplier", rating: r.stars, comment: r.text, createdAt: at(r.day, 12) })
    }
    if (s.supplierRating) {
      const r = s.supplierRating
      Object.assign(q.doc, { supplierRated: true, supplierRatedAt: at(r.day, 18), supplierRating: { stars: r.stars, text: r.text, at: at(r.day, 18) } })
      L(r.day, 18, { uid: sup, name: supName }, "supplier_rated", { stars: r.stars })
      put(`reviews/po_${poId}_supplier`, { offerId: q.id, rfqId: b.id, poId, poNumber: no, material, reviewerId: sup, reviewerOrgId: sup, reviewerName: supCompany, reviewerRole: "Supplier", revieweeId: org(o), revieweeName: ow.company, revieweeRole: "Contractor", rating: r.stars, comment: r.text, createdAt: at(r.day, 18) })
    }
    if (s.closed != null) L(s.closed, 16, buyer, "closed", null)
    log.sort((x, y) => x.at.localeCompare(y.at))

    // The award as Procurement writes it: the quote accepted, the request awarded.
    Object.assign(q.doc, {
      status: "مقبول",
      decidedByUserId: buyer.uid,
      decidedByUserName: buyer.name,
      decidedAt: at(s.decided, 12),
      awaitingOrderApproval: s.status === "awaiting_approval",
      awardedLines: lines.map((l) => l.rfqProductIndex),
      awardedTotal: total,
      requestedDeliveryDate: D(s.requested),
      poId,
      poNumber: no,
      updatedAt: at(Math.max(s.decided, s.sent ?? s.decided), 12),
    })
    Object.assign(b.doc, { status: "Awarded", awardedAt: at(s.decided, 12) })
    put(`purchaseOrders/${poId}`, po)
    return { po, poId, offerId: q.id, no, grNos, invoiceId }
  }

  const BANK = "مصرف الراجحي"
  const ord = (key: string, o: Org, cat: string, title: string, posted: number, deadline: number, pricing: "line" | "total", products: Product[], rest: Omit<OrderSpec, "b" | "versions"> & { v?: Partial<Version> }, terms?: { pct: number; days: number }[], what = "") => {
    const b = rfq({ key, o, cat, title, city: o === "A" ? "الرياض" : "الخرج", district: o === "A" ? "شمال الرياض" : "", posted, deadline, pricing, products, terms })
    const { v, ...spec } = rest
    const out = order({ b, versions: [{ day: deadline - 2, arrive: deadline + 10, ...(v || {}) }], ...spec })
    keys[b.id] = what
    return out
  }

  // Won, its order still with the buyer's approval: the supplier still reads "awaiting decision".
  ord("q_won_pending", "A", CAT.cement, "أسمنت بورتلاندي لأعمال الهيكل — برج مكتبي", -10, -3, "line", [P("أسمنت بورتلاندي عادي", "كيس 50 كجم", 1500, 15.4)], { decided: -1, status: "awaiting_approval", requested: 10 }, undefined, "won — order awaiting the contractor's approval (shows awaiting)")
  // He declined the order.
  ord("q_declined_po", "A", CAT.blocks, "طوب أحمر مفرغ — سور مجمع", -16, -10, "line", [P("طوب أحمر مفرغ", "حبة", 7000, 1.9)], { decided: -8, status: "cancelled", sent: -7, requested: 5, decline: { day: -6, reason: "stock", reasonText: "نفاد المخزون", note: "نفاد المخزون من هذا المقاس حتى نهاية الشهر" } }, undefined, "won, then he declined the order")

  // Orders & delivery.
  const o1 = ord("o_to_accept", "A", CAT.blocks, "بلوك مفرغ ومصمت — عمارة الملقا", -12, -6, "line", [P("بلوك أسمنتي مفرغ", "حبة", 6000, 3.1), P("بلوك أسمنتي مصمت", "حبة", 1500, 3.6)], { decided: -3, status: "sent", sent: -1, requested: 7 }, undefined, "order sent — awaiting his acceptance")
  ord("o_ship_soon", "B", CAT.cement, "خرسانة جاهزة C30 — أسقف فلل", -14, -9, "total", [P("خرسانة جاهزة", "م³", 60, null, "C30، مع مضخة")], { decided: -6, status: "accepted", sent: -5, accepted: -4, promised: 2, requested: 3, v: { total: 15900 } }, undefined, "accepted, lump sum — due in 2 days")
  ord("o_supply_later", "A", CAT.insul, "صوف صخري لأسقف مستشفى خاص", -10, -6, "line", [P("عزل حراري (صوف صخري)", "م²", 800, 27)], { decided: -3, status: "accepted", sent: -2, accepted: -1, promised: 10, requested: 12 }, undefined, "accepted — left to deliver")
  const o3 = ord("o_late", "A", CAT.blocks, "بلوك أسمنتي مفرغ — مدرسة حي العارض", -20, -15, "line", [P("بلوك أسمنتي مفرغ", "حبة", 5000, 3.1)], { decided: -13, status: "accepted", sent: -12, accepted: -11, promised: -2, requested: -3 }, undefined, "late by 2 days")
  const o4 = ord("o_reported", "B", CAT.plumb, "مواسير صرف ومصافٍ — فلل الخرج", -18, -13, "line", [P("مواسير PVC صرف", "متر", 1200, 11.5, "4 بوصة"), P("مصافي أرضيات", "حبة", 150, 18)], { decided: -10, status: "accepted", sent: -9, accepted: -8, promised: 1, requested: 2, report: { day: -1, date: -1, note: "سُلّمت الشحنة كاملة لحارس الموقع" } }, undefined, "delivery reported on time — awaiting the receipt")
  const o5 = ord("o_partial", "A", CAT.blocks, "بلوك مفرغ 20 سم — مجمع فلل الرمال", -22, -17, "line", [P("بلوك أسمنتي مفرغ", "حبة", 10000, 3.08)], { decided: -14, status: "accepted", sent: -13, accepted: -12, promised: 4, requested: 5, receipts: [{ day: -6, lines: [{ k: 0, counted: 6000 }] }], invoice: { day: -5, number: "INV-2041" } }, undefined, "partially received — first receipt invoiced")
  const o6 = ord("o_difference", "B", CAT.blocks, "بلوك عازل لجدران خارجية — مستودع", -16, -11, "line", [P("بلوك عازل (إنسوليت)", "حبة", 3000, 6.5)], { decided: -9, status: "accepted", sent: -8, accepted: -7, promised: 3, requested: 4, receipts: [{ day: -1, lines: [{ k: 0, counted: 3000, rejected: 40, reason: "damaged", note: "40 بلوكة مكسورة عند التنزيل" }], note: "رُفض المكسور وأُعيد مع السائق" }] }, undefined, "receipt with a difference (rejected 40)")
  const o7 = ord("o_to_invoice", "A", CAT.plumb, "سخانات وخلاطات — عمارة سكنية", -24, -19, "line", [P("سخانات مياه كهربائية", "حبة", 30, 640, "80 لتر"), P("خلاطات مياه", "حبة", 48, 182)], { decided: -16, status: "accepted", sent: -15, accepted: -14, promised: -4, requested: -3, receipts: [{ day: -3, lines: [{ k: 0, counted: 30 }, { k: 1, counted: 48 }] }] }, undefined, "fully received — awaiting his invoice")

  // Invoices & transfers.
  ord("m_overdue", "A", CAT.insul, "عزل XPS لجدران مبنى إداري", -40, -35, "line", [P("عزل حراري (بولي ستايرين XPS)", "م²", 1000, 38)], { decided: -32, status: "accepted", sent: -31, accepted: -30, promised: -23, requested: -22, receipts: [{ day: -22, lines: [{ k: 0, counted: 1000 }] }], invoice: { day: -20, number: "INV-2017" } }, [{ pct: 50, days: 0 }, { pct: 50, days: 30 }], "invoice 50/50 — first instalment overdue")
  const m2gross = r2((180 * 95 + 60 * 140) * 1.15)
  const m2 = ord("m_transfer_sent", "B", CAT.insul, "عزل مائي لأسطح مدرسة", -30, -25, "line", [P("عزل مائي (رولات بيتومين)", "رول", 180, 95), P("عزل مائي سائل", "جالون", 60, 140)], {
    decided: -22,
    status: "accepted",
    sent: -21,
    accepted: -20,
    promised: -16,
    requested: -15,
    receipts: [{ day: -15, lines: [{ k: 0, counted: 180 }, { k: 1, counted: 60 }] }],
    invoice: { day: -14, number: "INV-2029" },
    transfers: [{ day: -1, amount: m2gross, state: "sent", ref: "TRX-884213", bank: BANK }],
    warranty: { item: 0, until: 730, created: -12, file: "ضمان-العزل-المائي.pdf" },
  }, undefined, "transfer reported — awaiting his confirmation; warranty awaiting acceptance")
  const m3gross = r2(2400 * 15.3 * 1.15)
  const m3 = ord("m_transfer_missing", "A", CAT.cement, "أسمنت بورتلاندي — مشروع الطرق", -45, -40, "line", [P("أسمنت بورتلاندي عادي", "كيس 50 كجم", 2400, 15.3)], {
    decided: -37,
    status: "accepted",
    sent: -36,
    accepted: -35,
    promised: -31,
    requested: -30,
    receipts: [{ day: -30, lines: [{ k: 0, counted: 2400 }] }],
    invoice: { day: -28, number: "INV-2008" },
    transfers: [
      { day: -27, amount: r2(m3gross * 0.3), state: "ok", answeredDay: -26, ref: "TRX-771030", bank: BANK },
      { day: -4, amount: 10000, state: "miss", answeredDay: -2, note: "لم تصل الحوالة إلى الحساب حتى الآن", ref: "TRX-790455", bank: "البنك الأهلي السعودي" },
    ],
  }, [{ pct: 30, days: 0 }, { pct: 70, days: 45 }], "transfer flagged «not received»")
  const o8gross = r2(3000 * 3.6 * 1.15)
  ord("o_paid_rate", "B", CAT.blocks, "بلوك مصمت لأساسات فلل", -50, -45, "line", [P("بلوك أسمنتي مصمت", "حبة", 3000, 3.6)], {
    decided: -42,
    status: "closed",
    sent: -41,
    accepted: -40,
    promised: -33,
    requested: -32,
    receipts: [{ day: -32, lines: [{ k: 0, counted: 3000 }] }],
    invoice: { day: -30, number: "INV-1994" },
    transfers: [{ day: -12, amount: o8gross, state: "ok", answeredDay: -11, ref: "TRX-760118", bank: BANK }],
    closed: -11,
    contractorReview: { day: -10, stars: 4, text: "التزام جيد بالموعد والجودة" },
  }, undefined, "complete and fully paid — ready to rate")
  const o9gross = r2((8 * 1450 + 20 * 640) * 1.15)
  const o9 = ord("o_rated", "A", CAT.plumb, "مضخات وسخانات — مجمع سكني", -60, -55, "line", [P("مضخات مياه", "حبة", 8, 1450, "1.5 حصان"), P("سخانات مياه كهربائية", "حبة", 20, 640, "80 لتر")], {
    decided: -52,
    status: "closed",
    sent: -51,
    accepted: -50,
    promised: -42,
    requested: -41,
    receipts: [{ day: -41, lines: [{ k: 0, counted: 8 }, { k: 1, counted: 20 }] }],
    invoice: { day: -40, number: "INV-1981" },
    transfers: [{ day: -22, amount: o9gross, state: "ok", answeredDay: -21, ref: "TRX-748802", bank: BANK }],
    warranty: { item: 0, until: 365, created: -38, accepted: -35, file: "ضمان-المضخات.pdf" },
    closed: -21,
    supplierRating: { day: -15, stars: 5, text: "دفع منتظم وتواصل واضح" },
    contractorReview: { day: -20, stars: 5, text: "مورد موثوق، توريد كامل" },
  }, undefined, "complete, rated; warranty accepted")

  // ---- contractors, connection, invitation --------------------------------------------------------------------------
  put(`contractorSupplierLinks/${DEMO_PREFIX}link_A`, {
    contractorOrgId: ids.contractorA,
    supplierOrgId: sup,
    supplierName: supCompany,
    supplierCategories: [...DEMO_SPECS],
    status: "active",
    requestedBy: "contractor",
    requestedAt: at(-90),
    connectedAt: at(-89),
    createdAt: at(-89),
    updatedAt: at(-89),
  })
  put(`invitations/${DEMO_PREFIX}invite_B`, {
    email: DEMO_EMAILS.supplier,
    phone: null,
    companyName: supCompany,
    category: CAT.blocks,
    message: "نود إضافتكم إلى قائمة موردينا المعتمدين لمشاريع الخرج",
    channel: "email",
    guest: null,
    invitedBy: ids.contractorB,
    invitedByName: DEMO_PEOPLE.contractorB.name,
    contractorOrgId: ids.contractorB,
    contractorName: DEMO_PEOPLE.contractorB.company,
    status: "pending",
    type: "supplier_invite",
    inviteToken: opts.inviteToken || randomBytes(32).toString("hex"),
    sentChannel: "email",
    createdAt: at(-2, 9),
  })

  // ---- his own marks: archived, declined, opened -------------------------------------------------------------------
  put(`supplierWorkspace/${sup}`, {
    organizationId: sup,
    arch: { [archived.id]: true },
    seen: { [q10.id]: true, [o1.po.rfqId as string]: true },
    declined: { [inv3.id]: { at: D(-1), note: "الكمية فوق طاقتنا هذا الشهر", byId: sup } },
    updatedAt: at(-1),
  })

  // ---- conversations -------------------------------------------------------------------------------------------------
  interface Msg {
    from: "s" | "c"
    day: number
    h: number
    text: string
  }
  const chat = (offerId: string, b: { id: string; title: string; o: Org }, msgs: Msg[], unread: number) => {
    const c = org(b.o)
    msgs.forEach((m, i) =>
      put(`chats/${offerId}/messages/${DEMO_PREFIX}m_${String(i + 1).padStart(2, "0")}`, { senderId: m.from === "s" ? sup : c, text: m.text, createdAt: at(m.day, m.h, i) })
    )
    const last = msgs[msgs.length - 1]
    put(`chats/${offerId}`, {
      offerId,
      rfqId: b.id,
      rfqTitle: b.title,
      contractorId: c,
      contractorOrgId: c,
      supplierId: sup,
      supplierOrgId: sup,
      createdAt: at(msgs[0].day, msgs[0].h),
      lastMessage: last.text,
      lastMessageAt: at(last.day, last.h, msgs.length - 1),
      lastSenderId: last.from === "s" ? sup : c,
      unreadFor: unread ? [sup] : last.from === "s" ? [c] : [],
      unreadCounts: unread ? { [sup]: unread } : {},
    })
  }
  const ref = (b: Built) => ({ id: b.id, title: b.spec.title, o: b.spec.o })
  chat(o3.offerId, { id: o3.po.rfqId as string, title: o3.po.rfqTitle as string, o: "A" }, [
    { from: "s", day: -11, h: 9, text: "تم قبول الأمر، والتسليم بإذن الله في الموعد" },
    { from: "c", day: -1, h: 10, text: "الموعد كان أمس ولم يصل البلوك، متى التوريد؟" },
    { from: "c", day: 0, h: 9, text: "الموقع متوقف بانتظار البلوك، نرجو الرد" },
  ], 2)
  chat(o4.offerId, { id: o4.po.rfqId as string, title: o4.po.rfqTitle as string, o: "B" }, [
    { from: "s", day: -1, h: 15, text: "سلّمت الشحنة كاملة لحارس الموقع، أرجو تسجيل الاستلام" },
    { from: "c", day: -1, h: 18, text: "شكراً، سنسجل الاستلام بعد العدّ" },
  ], 1)
  chat(m3.offerId, { id: m3.po.rfqId as string, title: m3.po.rfqTitle as string, o: "A" }, [
    { from: "c", day: -4, h: 13, text: "تم تحويل دفعة ثانية بمبلغ 10,000" },
    { from: "s", day: -2, h: 17, text: "الحوالة الثانية لم تصل إلى حسابنا حتى الآن، أرجو التحقق" },
  ], 0)
  chat(q5o.id, ref(q5), [
    { from: "c", day: -1, h: 12, text: "هل يمكن مراجعة السعر؟ الهدف 6.2 ريال للبلوكة" },
    { from: "s", day: -1, h: 14, text: "سنراجع مع المصنع ونرد قبل الموعد" },
  ], 0)

  // ---- his notifications (the shapes the server writes; each opens its deal) ------------------------------------------
  let nn = 0
  const notify = (e: Omit<ProcEvent, "to" | "supplier">, actor: { uid: string; name: string }, day: number, h: number, read: boolean) => {
    const n = buildProcNotification({ ...e, to: [], supplier: { userId: sup, orgId: sup } }, actor, sup, at(day, h))
    nn += 1
    put(`users/${sup}/notifications/${DEMO_PREFIX}n_${String(nn).padStart(2, "0")}`, { ...n, read, ...(read ? { readAt: at(day, h + 1) } : {}) })
  }
  const poEvent = (x: Order, o: Org, kind: ProcEvent["kind"], params: Record<string, string | number>) => ({
    kind,
    organizationId: org(o),
    params: { contractor: owner(o).company, number: x.no, ...params },
    poId: x.poId,
    rfqId: x.po.rfqId as string,
    offerId: x.offerId,
  })
  const A = { uid: ids.contractorA, name: DEMO_PEOPLE.contractorA.name }
  const B = { uid: ids.contractorB, name: DEMO_PEOPLE.contractorB.name }
  notify(poEvent(o1, "A", "po_sent", { company: DEMO_PEOPLE.contractorA.company }), A, -1, 12, false)
  notify(poEvent(o3, "A", "po_sent", { company: DEMO_PEOPLE.contractorA.company }), A, -12, 12, true)
  notify({ kind: "rfq_outcome", organizationId: ids.contractorB, params: { contractor: DEMO_PEOPLE.contractorB.company, rfq: q9.no.replace(/^RFQ-/, ""), result: "@pn_rfq_outcome_lost", reason: "@pn_rfq_outcome_why_price" }, rfqId: q9.id, offerId: `${DEMO_PREFIX}off_${q9.spec.key}`, link: "/supplier/offers" }, B, -1, 14, false)
  notify({ kind: "rfq_outcome", organizationId: ids.contractorA, params: { contractor: DEMO_PEOPLE.contractorA.company, rfq: q10.no.replace(/^RFQ-/, ""), result: "@pn_rfq_outcome_noaward", reason: "@pn_rfq_outcome_why_need" }, rfqId: q10.id, offerId: `${DEMO_PREFIX}off_${q10.spec.key}`, link: "/supplier/offers" }, A, -2, 9, true)
  notify(poEvent(m2, "B", "po_payment_reported", { amount: sarParam(m2gross), bank: BANK, ref: "TRX-884213" }), B, -1, 13, false)
  notify(poEvent(o6, "B", "po_receipt_for_supplier", { receipt: o6.grNos[0], diff: "@pn_po_receipt_with_diff" }), B, -1, 11, false)
  notify(poEvent(o7, "A", "po_receipt_for_supplier", { receipt: o7.grNos[0], diff: "" }), { uid: ids.receiverA, name: DEMO_PEOPLE.receiverA.name }, -3, 11, true)
  notify(poEvent(o5, "A", "po_receipt_for_supplier", { receipt: o5.grNos[0], diff: "" }), { uid: ids.receiverA, name: DEMO_PEOPLE.receiverA.name }, -6, 11, true)
  notify(poEvent(o9, "A", "po_warranty_accepted", { item: "مضخات مياه" }), A, -35, 12, true)
  notify(poEvent(m3, "A", "po_payment_reported", { amount: sarParam(10000), bank: "البنك الأهلي السعودي", ref: "TRX-790455" }), A, -4, 13, true)
  nn += 1
  put(`users/${sup}/notifications/${DEMO_PREFIX}n_${String(nn).padStart(2, "0")}`, { userId: sup, organizationId: sup, type: "supplier_invite_received", title: "دعوة للانضمام كمورّد", message: `${DEMO_PEOPLE.contractorB.company} يدعوك للانضمام إلى دليل مورّديه`, createdAt: at(-2, 9), read: false })
  nn += 1
  put(`users/${sup}/notifications/${DEMO_PREFIX}n_${String(nn).padStart(2, "0")}`, { type: "new_chat_message", message: "الموقع متوقف بانتظار البلوك، نرجو الرد", chatId: o3.offerId, offerId: o3.offerId, rfqId: o3.po.rfqId, rfqTitle: o3.po.rfqTitle, createdAt: at(0, 9, 2), read: false })

  // ---- accounts' profiles, companies and settings --------------------------------------------------------------------
  const profile = (role: DemoRole, uid: string, orgId: string, extra: Rec = {}): Rec => {
    const p = DEMO_PEOPLE[role]
    return {
      id: uid,
      name: p.name,
      email: DEMO_EMAILS[role],
      phone: p.phone,
      role: p.role,
      organizationId: orgId,
      organizationRole: orgId === uid ? "owner" : "member",
      companyName: p.company,
      providers: ["password"],
      profileCompleted: true,
      joinedAt: at(-120),
      ...extra,
    }
  }
  // The supplier: five of the seven account checks (basic data, field, CR, VAT, national address — no IBAN letter,
  // no conformity certificate), so the account reads ~71% and is NOT verified.
  const legalDocuments = {
    cr: { ...FILE("السجل-التجاري.pdf"), expiryDate: D(300) },
    vat: FILE("شهادة-ضريبة-القيمة-المضافة.pdf"),
    addr: FILE("العنوان-الوطني.pdf"),
  }
  const identity = { crNumber: "1010987654", taxNumber: "310987654300003", legalDocuments }
  // Approved by the platform (onboarding, 18 Oct 2026): it has the CR and the tax certificate, and the demo quotes.
  put(`users/${sup}`, profile("supplier", sup, sup, { city: "الرياض", specializations: [...DEMO_SPECS], coverageCities: [...DEMO_CITIES], nationalAddress: "الرياض، حي السلي، طريق الخرج، 7421", isVerified: true, ...identity }), "merge")
  put(`companyIdentity/${sup}`, identity, "merge")
  put(`companyPublicFacts/${sup}`, { hasVat: true, hasCr: true, crExpiry: D(300) }, "merge")
  // Explicitly free: `set-supplier-plans.ts --apply` never overwrites a plan that is set, so the demo stays free.
  put(`companyPlans/${sup}`, { organizationId: sup, supplierPlan: "free", updatedById: "script", updatedByName: "seed-supplier-free-demo", updatedAt: at(0, 8) })

  put(`users/${ids.contractorA}`, profile("contractorA", ids.contractorA, ids.contractorA, { city: "الرياض", specializations: [], isVerified: true }), "merge")
  put(`users/${ids.receiverA}`, profile("receiverA", ids.receiverA, ids.contractorA, { city: "الرياض", specializations: [], isVerified: true, defaultGroupId: seededGroupDocId(ids.contractorA, "supply_chain") }), "merge")
  put(`users/${ids.contractorB}`, profile("contractorB", ids.contractorB, ids.contractorB, { city: "الخرج", specializations: [], isVerified: true }), "merge")
  for (const o of [ids.contractorA, ids.contractorB]) {
    for (const g of SEEDED_GROUPS) put(`teamGroups/${seededGroupDocId(o, g.key)}`, { organizationId: o, key: g.key, name: g.name, permissions: g.permissions, isSystem: g.isSystem, createdAt: at(-120), updatedAt: at(-120) }, "create")
    put(`procurementSettings/${o}`, { ...DEFAULT_POLICIES, organizationId: o, updatedAt: at(-120) }, "create")
  }

  // ---- the sequences, raised past every number used -------------------------------------------------------------------
  for (const o of ["A", "B"] as const)
    for (const type of ["RFQ", "PO", "GR"] as const) put(`mfgCounters/${org(o)}__${type}__${year}`, { organizationId: org(o), type, year, last: seq[`${o}_${type}`] }, "max")

  return { docs, keys }
}

// ---------------------------------------------------------------------------------------------------------------------
// The supplier's world from the documents, read as FreeWorldProvider reads them (its queries emulated over a map).
// ---------------------------------------------------------------------------------------------------------------------

export interface DocStore {
  /** Every document directly under a collection path, with its id. */
  list: (col: string) => (Rec & { id: string })[]
  get: (path: string) => Rec | undefined
}

export function storeOf(docs: readonly DemoDoc[]): DocStore {
  const m = new Map(docs.map((d) => [d.path, d.data]))
  return {
    get: (p) => m.get(p),
    list: (col) => [...m].filter(([k]) => k.startsWith(`${col}/`) && !k.slice(col.length + 1).includes("/")).map(([k, d]) => ({ ...d, id: k.slice(col.length + 1) })),
  }
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [])

/** The RawWorld FreeWorldProvider assembles for the signed-in supplier (`uid` owning org `orgId`). */
export function rawWorldOf(store: DocStore, uid: string, today: string): RawWorld {
  const user = store.get(`users/${uid}`) || {}
  const orgId = String(user.organizationId || uid)
  const specs = strList(user.specializations).slice(0, 30)
  const cities = strList(user.coverageCities)
  const email = String(user.email || "").toLowerCase()
  const has = (v: unknown) => strList(v).includes(orgId)

  const offers = store.list("offers").filter((o) => o.organizationId === orgId)
  const pos = store.list("purchaseOrders").filter((p) => p.supplierOrgId === orgId) as unknown as PurchaseOrder[]
  const allRfqs = store.list("rfqs")
  const quoted = new Set(offers.map((o) => String(o.rfqId || "")).filter(Boolean))
  const byId = new Map<string, Rec & { id: string }>()
  for (const r of allRfqs) {
    const pub = r.status === "New" && r.visibility === "public" && specs.includes(String(r.category))
    if (pub || has(r.allowedSupplierOrgIds) || has(r.invitedSupplierOrgIds) || quoted.has(r.id)) byId.set(r.id, r)
  }
  const rfqs = [...byId.values()]
  const poIds = new Set(pos.map((p) => p.id))
  const invitations = store
    .list("invitations")
    .filter((i) => i.status === "pending" && String(i.email || "").toLowerCase() === email && (i.type === "supplier_invite" || i.type == null))
    .map((i) => ({ id: i.id, contractorOrgId: i.contractorOrgId || null, invitedBy: i.invitedBy || null, message: i.message || "", createdAt: i.createdAt || null, type: "supplier_invite", status: "pending" }))
  const links = store.list("contractorSupplierLinks").filter((l) => l.supplierOrgId === orgId)

  // A contractor's phone only for one he deals with directly (B-04) — `closeContractors` in FreeWorldProvider.
  const close = new Set<string>()
  for (const r of rfqs) if (has(r.allowedSupplierOrgIds) || has(r.invitedSupplierOrgIds)) close.add(String(r.organizationId || r.contractorId || ""))
  for (const p of pos) close.add(String(p.organizationId || ""))
  for (const l of links) if (l.status === "active") close.add(String(l.contractorOrgId || ""))
  for (const i of invitations) close.add(String(i.contractorOrgId || i.invitedBy || ""))
  const contractorIds = new Set<string>()
  for (const r of rfqs) contractorIds.add(String(r.organizationId || r.contractorId || ""))
  for (const l of links) contractorIds.add(String(l.contractorOrgId || ""))
  for (const i of invitations) contractorIds.add(String(i.contractorOrgId || i.invitedBy || ""))
  const contractors: Record<string, Rec> = {}
  for (const id of contractorIds) {
    const c = id ? store.get(`users/${id}`) : undefined
    if (!c) continue
    const { phone, ...rest } = c
    contractors[id] = close.has(id) ? { ...c, id } : { ...rest, id }
    void phone
  }

  const inField = (r: Rec) => {
    if (has(r.allowedSupplierOrgIds) || has(r.invitedSupplierOrgIds)) return true
    if (r.visibility === "private") return false
    if (!cities.length) return false
    const city = String(r.city || "")
    return !city || cities.includes(city)
  }
  const ws = (store.get(`supplierWorkspace/${orgId}`) || {}) as { arch?: Record<string, unknown>; seen?: Record<string, unknown>; declined?: Record<string, { at?: string; note?: string }> }
  return {
    today,
    myOrgId: orgId,
    rfqs: rfqs.filter((r) => quoted.has(r.id) || inField(r)),
    offers,
    pos,
    deliveries: store.list("deliveries").filter((d) => poIds.has(String(d.poId))),
    invoices: store.list("supplierInvoices").filter((x) => x.supplierOrgId === orgId),
    transfers: store.list("supplierTransfers").filter((x) => x.supplierOrgId === orgId),
    warranties: store.list("supplierWarranties").filter((x) => x.supplierOrgId === orgId),
    chats: store.list("chats").filter((x) => x.supplierOrgId === orgId),
    contractors,
    links,
    invitations,
    archived: ws.arch || {},
    seen: ws.seen || {},
    declined: ws.declined || {},
    myUid: uid,
    questions: {},
  }
}

export function demoWorld(docs: readonly DemoDoc[], supplierUid: string, today: string): World {
  return deriveWorld(rawWorldOf(storeOf(docs), supplierUid, today))
}

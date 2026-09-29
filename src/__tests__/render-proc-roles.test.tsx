/**
 * Procurement PRD 3.0 — every screen rendered for real, as each role, in
 * Arabic: a stand-in for clicking through Procurement before anyone signs in
 * on UAT. The pages mount over the in-memory Firestore with a small world
 * written through the real write layers (an order awaiting approval, one sent
 * and accepted with a supplier's delivery notice, an open RFQ with two offers,
 * another buyer's RFQ, a project's approved material request on the needs desk).
 *
 * Roles (the prototype's, as permission ids): the manager (`po.approve`), the
 * buyer (`offers.accept`), the expediter (`po.expedite`), and the owner of a
 * company that HAS procurement staff — who reads RFQs and does not run them.
 * Each render must not throw, must resolve every message key and must show
 * the prototype's sub-headers and columns; prices are withheld from the
 * expediter; approve-only and buyer-only acts are asserted per screen.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ id: "r1", locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { act, render } from "@testing-library/react"
import type { Firestore } from "firebase/firestore"
import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, pushed, setPathname, setSignedIn } from "@/test-utils/render-world"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { approvePurchaseOrder, createPurchaseOrderFromAward, recordSupplierAcceptance, type AwardOfferLike, type RfqLike } from "@/lib/procurement/writes"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { approveMaterialRequest, createMaterialRequest } from "@/lib/pm/supply-writes"
import { todayDay } from "@/lib/pm/format"
import TodayPage from "@/app/[locale]/(contractor)/contractor/rfqs/today/page"
import RequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/requests/page"
import RfqsPage from "@/app/[locale]/(contractor)/contractor/rfqs/page"
import OrdersPage from "@/app/[locale]/(contractor)/contractor/rfqs/orders/page"
import ReportsPage from "@/app/[locale]/(contractor)/contractor/rfqs/reports/page"
import SettingsPage from "@/app/[locale]/(contractor)/contractor/rfqs/settings/page"
import GoodsReceivedPage from "@/app/[locale]/(contractor)/contractor/goods-received/page"
import SuppliersPage from "@/app/[locale]/(contractor)/contractor/suppliers/page"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"

installDomShims()
jest.setTimeout(60_000)

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const ORG = "own"
const DAY = 86_400_000
const base = new Date(`${todayDay()}T00:00:00Z`).getTime()
const d = (n: number) => new Date(base + n * DAY).toISOString().slice(0, 10)
const iso = (n: number) => new Date(base + n * DAY + 9 * 3600_000).toISOString()

type Role = "owner" | "manager" | "buyer" | "expediter"
const ROLES: Role[] = ["owner", "manager", "buyer", "expediter"]
const UID: Record<Role, string> = { owner: ORG, manager: "mgr", buyer: "buy", expediter: "exp" }
const NAME: Record<Role, string> = { owner: "المالك", manager: "نورة", buyer: "بدر", expediter: "سلمان" }
const PERMS: Record<Exclude<Role, "owner">, string[]> = { manager: ["po.approve"], buyer: ["offers.accept"], expediter: ["po.expedite"] }
const actorOf = (r: Role): ProcActor => ({
  uid: UID[r],
  name: NAME[r],
  isOwner: r === "owner",
  canApprove: r === "owner" || r === "manager",
  canPrepare: r === "owner" || r === "buyer",
  canExpedite: true,
  canReceive: r === "owner",
  seesPrices: r !== "expediter",
})

const writeFailures: string[] = []
async function attempt(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (e) {
    writeFailures.push(`${label}: ${(e as Error).message}`)
  }
}

const SUP_A = "supA"
const SUP_B = "supB"
const rfqDoc = (id: string, over: Record<string, unknown>) => ({
  organizationId: ORG,
  contractorId: UID.buyer,
  createdByUserId: UID.buyer,
  title: "",
  status: "New",
  city: "الرياض",
  category: "Construction Materials",
  deadline: d(-1),
  createdAt: iso(-10),
  pricingMode: "line",
  offersCount: 0,
  products: [
    { name: "حديد تسليح 12 مم", quantity: 10, unitOfMeasure: "طن" },
    { name: "إسمنت بورتلاندي", quantity: 200, unitOfMeasure: "كيس" },
  ],
  ...over,
  id: undefined,
})
const offerDoc = (rfqId: string, org: string, name: string, price: number, over: Record<string, unknown> = {}) => ({
  rfqId,
  contractorOrgId: ORG,
  organizationId: org,
  supplierId: org,
  companyName: name,
  price: String(price),
  status: "قيد المراجعة",
  createdAt: iso(-3),
  offerPdfUrl: "https://x/offer.pdf",
  executionDuration: "2",
  executionDurationUnit: "أسابيع",
  lines: [
    { rfqProductIndex: 0, unitPrice: price * 0.6 / 10 },
    { rfqProductIndex: 1, unitPrice: price * 0.4 / 200 },
  ],
  ...over,
})
const strip = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

async function buildWorld() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: NAME.owner, companyName: "شركة البناء المتقدم", email: "owner@test.sa" })
  for (const r of ["manager", "buyer", "expediter"] as const) {
    seed(`teamGroups/g_${r}`, { organizationId: ORG, name: r, key: null, permissions: [...PERMS[r], "projects.view"] })
    seed(`users/${UID[r]}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: `g_${r}`, name: NAME[r], email: `${UID[r]}@test.sa` })
  }
  seed(`users/${SUP_A}`, { organizationId: SUP_A, role: "Supplier", companyName: "مصنع الحديد الوطني", name: "مصنع الحديد الوطني", taxNumber: "300000000000003", isVerified: true })
  seed(`users/${SUP_B}`, { organizationId: SUP_B, role: "Supplier", companyName: "مؤسسة الإسمنت", name: "مؤسسة الإسمنت", taxNumber: "300000000000004", isVerified: true })
  seed(`projects/P1`, { organizationId: ORG, contractorId: ORG, name: "برج الواحة", status: "in_progress", budget: 5_000_000, projectManagerId: ORG, enabledSections: ["contract", "procure", "receive", "store"], pm: { no: "PJ-2026/001", lifecycle: "live", startOn: d(-60), startedAt: d(-60), durationDays: 300 } })
  seed(`projects/P1/boqItems/b1`, { itemNo: "03-01", descriptionAr: "خرسانة مسلحة", unit: "م³", quantity: 500, unitPrice: 900, executedQuantity: 100 })

  // RFQs: r1 open (the buyer's, deadline passed, two offers), r2 the manager's, r3/r4 awarded.
  seed("rfqs/r1", strip(rfqDoc("r1", { title: "حديد وإسمنت — برج الواحة", projectId: null, offersCount: 2 })))
  seed("rfqs/r2", strip(rfqDoc("r2", { title: "بلوك خرساني", contractorId: UID.manager, createdByUserId: UID.manager, deadline: d(5), products: [{ name: "بلوك 20 سم", quantity: 5000, unitOfMeasure: "حبة" }] })))
  seed("rfqs/r3", strip(rfqDoc("r3", { title: "حديد الأسقف", status: "Awarded", offersCount: 2 })))
  seed("rfqs/r4", strip(rfqDoc("r4", { title: "إسمنت المرحلة الثانية", status: "Awarded", offersCount: 1 })))
  seed("offers/o1", offerDoc("r1", SUP_A, "مصنع الحديد الوطني", 30_500))
  seed("offers/o2", offerDoc("r1", SUP_B, "مؤسسة الإسمنت", 28_400))
  seed("offers/o3", offerDoc("r3", SUP_A, "مصنع الحديد الوطني", 42_000))
  seed("offers/o4", offerDoc("r3", SUP_B, "مؤسسة الإسمنت", 45_000))
  seed("offers/o5", offerDoc("r4", SUP_B, "مؤسسة الإسمنت", 18_000))

  const db = fakeFirestore as unknown as Firestore
  const asRfq = (id: string): RfqLike => ({ ...(readDoc<Record<string, unknown>>(`rfqs/${id}`) as RfqLike), id })
  const asOffer = (id: string): AwardOfferLike => ({ ...(readDoc<Record<string, unknown>>(`offers/${id}`) as AwardOfferLike), id })
  let poA = ""
  let poB = ""
  await attempt("award r3 → PO awaiting approval", async () => {
    poA = (await createPurchaseOrderFromAward(db, actorOf("buyer"), { rfq: asRfq("r3"), offer: asOffer("o3"), offers: [asOffer("o3"), asOffer("o4")], policies: DEFAULT_POLICIES, awardReason: { code: "quality", text: "أفضل جودة في العيّنات" } })).id
  })
  await attempt("award r4 → PO", async () => {
    poB = (await createPurchaseOrderFromAward(db, actorOf("buyer"), { rfq: asRfq("r4"), offer: asOffer("o5"), offers: [asOffer("o5")], policies: DEFAULT_POLICIES, awardReason: { code: "availability", text: "الوحيد المتوفر بالكمية" } })).id
  })
  await attempt("approve PO B (sent on approval)", () => approvePurchaseOrder(db, actorOf("manager"), poB, { policies: DEFAULT_POLICIES }))
  await attempt("supplier accepted PO B", () => recordSupplierAcceptance(db, actorOf("buyer"), poB, { promisedDate: d(3), by: "buyer" }))
  const b = readDoc<PurchaseOrder>(`purchaseOrders/${poB}`)
  if (b)
    seed("deliveries/n1", {
      contractorOrgId: ORG,
      supplierOrgId: SUP_B,
      supplierId: SUP_B,
      supplierName: "مؤسسة الإسمنت",
      rfqId: "r4",
      rfqTitle: "إسمنت المرحلة الثانية",
      status: "pending_confirmation",
      deliveryDate: d(1),
      poId: poB,
      poNumber: b.docNumber,
      lines: b.lines.map((l) => ({ poLineId: l.id, name: l.name, unit: l.unit, noticeQuantity: l.quantity })),
      deliveryPersonName: "سائق المؤسسة",
      createdAt: iso(-1),
    })
  seed("deliveries/m1", { contractorOrgId: ORG, supplierName: "محل مواد البناء", status: "confirmed", deliveryDate: d(-2), confirmedAt: iso(-2), selfReceived: true, noPo: true, items: [{ name: "مسامير", quantity: 10, unit: "كرتون" }], receivedByName: NAME.owner, createdAt: iso(-2) })

  // A project's approved material request — the needs desk's row.
  const pmCtx = (r: "owner"): PmContext => ({ ceiling: pmCeiling({ owner: r === "owner", permissions: [] }), seat: null, archived: false })
  await attempt("material request", () => createMaterialRequest(db, pmCtx("owner"), "P1", { uid: ORG, name: NAME.owner }, { title: "حديد للأعمدة", needBy: d(6), notes: null, lines: [{ itemId: "b1", name: "حديد تسليح 16 مم", unit: "طن", qty: 25 }] }))
  await attempt("approve request", () => approveMaterialRequest(db, pmCtx("owner"), "P1", { uid: ORG, name: NAME.owner }, "01"))
  return { poA, poB }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

let ids = { poA: "", poB: "" }

type Screen = { path: string; search?: string; node: () => React.ReactElement }
const SCREENS: Record<string, Screen> = {
  today: { path: "/contractor/rfqs/today", node: () => <TodayPage /> },
  requests: { path: "/contractor/rfqs/requests", node: () => <RequestsPage /> },
  rfqs: { path: "/contractor/rfqs", node: () => <RfqsPage /> },
  rfqList: { path: "/contractor/rfqs/r1/offers", search: "tab=list", node: () => <RfqOffersView rfqId="r1" /> },
  rfqCompare: { path: "/contractor/rfqs/r1/offers", search: "tab=compare", node: () => <RfqOffersView rfqId="r1" /> },
  rfqInquiries: { path: "/contractor/rfqs/r1/offers", search: "tab=inquiries", node: () => <RfqOffersView rfqId="r1" /> },
  rfqDetails: { path: "/contractor/rfqs/r1/offers", search: "tab=details", node: () => <RfqOffersView rfqId="r1" /> },
  rfqOther: { path: "/contractor/rfqs/r2/offers", search: "tab=list", node: () => <RfqOffersView rfqId="r2" /> },
  orders: { path: "/contractor/rfqs/orders", node: () => <OrdersPage /> },
  orderA: { path: "/contractor/rfqs/orders", search: "po=A", node: () => <OrdersPage /> },
  orderB: { path: "/contractor/rfqs/orders", search: "po=B", node: () => <OrdersPage /> },
  receiptsIncoming: { path: "/contractor/goods-received", search: "tab=incoming", node: () => <GoodsReceivedPage /> },
  receiptsLog: { path: "/contractor/goods-received", search: "tab=log", node: () => <GoodsReceivedPage /> },
  receiptsNoPo: { path: "/contractor/goods-received", search: "tab=nopo", node: () => <GoodsReceivedPage /> },
  suppliers: { path: "/contractor/suppliers", node: () => <SuppliersPage /> },
  reports: { path: "/contractor/rfqs/reports", node: () => <ReportsPage /> },
  settings: { path: "/contractor/rfqs/settings", node: () => <SettingsPage /> },
}

async function openAs(role: Role, name: string) {
  const s = SCREENS[name]
  setSignedIn(UID[role])
  setPathname(s.path, (s.search ?? "").replace("po=A", `po=${ids.poA}`).replace("po=B", `po=${ids.poB}`))
  missingKeys.clear()
  const view = render(s.node())
  await flush()
  return view
}

const text = () => document.body.textContent ?? ""
/** Acts are buttons or links (a row's «راجع واعتمد» opens the order drawer). */
const buttons = () => Array.from(document.querySelectorAll("button, a")).map((b) => (b.textContent ?? "").trim() || b.getAttribute("aria-label") || "")

function dump(role: Role, tab: string) {
  if (!process.env.RENDER_DUMP) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("fs").appendFileSync(
    process.env.RENDER_DUMP,
    JSON.stringify({
      role,
      tab,
      text: text(),
      buttons: Array.from(document.querySelectorAll("button, a")).map((b) => `${(b.textContent ?? "").trim() || b.getAttribute("aria-label")}${(b as HTMLButtonElement).disabled ? " [x]" : ""}`),
      heads: Array.from(document.querySelectorAll("h1,h2,h3,h4,th,[role=tab]")).map((h) => (h.textContent ?? "").trim()),
    }) + "\n"
  )
}

beforeAll(async () => {
  ids = await buildWorld()
})

it("the fixture's writes all landed", () => {
  expect(writeFailures).toEqual([])
  expect(ids.poA).toBeTruthy()
  expect(readDoc<PurchaseOrder>(`purchaseOrders/${ids.poB}`)?.status).toBe("accepted")
})

// ---------------------------------------------------------------------------
// What each screen must show (the prototype's sub-headers and columns — see
// audit/proc-audit), and which acts are whose. `only`: the roles whose rail
// holds the tab; anyone else typing its address is sent to his first tab.
// ---------------------------------------------------------------------------

const O: Role[] = ["owner"]
const OM: Role[] = ["owner", "manager"]
const MB: Role[] = ["manager", "buyer"]
const OMB: Role[] = ["owner", "manager", "buyer"]
const MBE: Role[] = ["manager", "buyer", "expediter"]
const B: Role[] = ["buyer"]
const M: Role[] = ["manager"]
const ALL: Role[] = ROLES
const RIYAL = "⃁"

interface ScreenSpec {
  titles: string[]
  /** Shown to whoever sees prices — never to the expediter. */
  priced?: string[]
  acts?: Record<string, Role[]>
  only?: Role[]
}

const SPECS: Record<string, ScreenSpec> = {
  today: {
    titles: ["يحتاج قرارك", "ننتظره من وحدات أخرى", "يصل خلال"],
    acts: { "راجع واعتمد": OM, "قارن العروض": MB, "حوّل للمستلم": MBE },
  },
  requests: {
    titles: ["طلبات الشراء الواردة", "يحتاج تصرفاً", "عند غيرنا", "في عروض", "في أوامر", "المادة ومصدر الاحتياج", "الاحتياج · آخر يوم للطلب", "المسار المحسوب", "حديد تسليح 16 مم"],
    only: OMB,
  },
  rfqs: { titles: ["طلبات عروض الأسعار", "حديد وإسمنت — برج الواحة", "حديد الأسقف", "إسمنت المرحلة الثانية"], acts: { "مشاركة كرابط للزوار": M, "تعديل الموعد أو المدعوين": M }, only: OMB },
  rfqList: { titles: ["العروض المقدمة", "قائمة العروض", "مقارنة العروض", "الاستفسارات", "تفاصيل الطلب", "مصنع الحديد الوطني", "مؤسسة الإسمنت"], acts: { "طلب عينة": MB, استبعاد: MB, "ترسية وإرسال للمالية": B } },
  rfqCompare: {
    titles: ["المقارنة — اضغط خلية لترسية بندها", "البند", "الإجمالي لو أُرسي كاملاً", "حديد تسليح 12 مم"],
    acts: { "اطلب جولة تخفيض من كل العروض": MB, "اختر الأقل لكل بند": B, "أرسِ وأعِدّ أوامر الشراء": B },
  },
  rfqInquiries: { titles: ["الاستفسارات"] },
  rfqDetails: { titles: ["تفاصيل الطلب", "المنتجات المطلوبة"], acts: { "ألغِ الطلب": MB, "سجّل عرضاً وصل خارج المنصة": MB, "تعديل الموعد أو المدعوين": MB } },
  rfqOther: { titles: ["رابط الزوار — لموردين خارج المنصة", "العروض المقدمة"], acts: { "مشاركة كرابط للزوار": M } },
  orders: {
    titles: ["أوامر الشراء", "بانتظار اعتماد أو قرار", "عند الموردين", "متأخرة", "مستلمة ومقفلة", "كل الأوامر", "الأمر والمورد", "البنود", "موعد المورد", "القيمة قبل الضريبة", "الحالة", "مؤسسة الإسمنت"],
    acts: { "أمر مباشر لخدمة أو مقطوعية": B },
  },
  orderA: {
    titles: ["بانتظار الاعتماد", "الخطوة التالية", "وقائع الترسية", "المستندات", "مسار المستند — ومن يملك كل خطوة", "السجل", "مصنع الحديد الوطني"],
    priced: ["مسار المال"],
    acts: { "اعتمد الأمر": OM, "أعِده لمُعِدّه": OM, "ألغِ الأمر": MB },
  },
  // orderB was prepared by a buyer: the owner only reads it (poActs), Finance's acts included.
  orderB: {
    titles: ["عند المورد — التوريد جارٍ", "الخطوة التالية", "إشعارات التسليم", "السجل"],
    priced: ["مسار المال"],
    acts: { "ذكّر المورد": MBE, "حدّث موعد المورد": MBE, "المورد عجز — ألغِ المتبقي": MB, "أقفله ناقصاً": MB, "سجّل دفعة": [] },
  },
  receiptsIncoming: { titles: ["سندات الاستلام", "في الطريق", "السندات", "بلا أمر شراء", "في الطريق — ما أشعر به الموردون وما حلّ موعده", "مؤسسة الإسمنت"], acts: { "سجّل الاستلام": O, "سجّل سند استلام يدوياً": MB } },
  receiptsLog: { titles: ["سجل الاستلام", "سند الاستلام", "المورد وأمر الشراء", "ما قُبل", "أين استُلم وإلى أين ذهب", "محل مواد البناء"] },
  receiptsNoPo: { titles: ["بضاعة وصلت بلا أمر شراء", "لا سندات بلا أمر شراء"] },
  suppliers: { titles: ["الموردون والأسعار", "مورّدونا", "دليل موردي المنصة"], priced: ["تاريخ الأسعار", "اتفاقيات الأسعار"], acts: { "ادعُ مورداً إلى المنصة": MB } },
  reports: { titles: ["التقارير", "أداء التوريد", "زمن الدورة والمنافسة", "الاستثناءات"], priced: ["المشتريات بحسب المشروع والجهة", "المشتريات بحسب المورد", "فرق السعر عن آخر شراء", "التزامات مفتوحة بحسب الاستحقاق"] },
  settings: { titles: ["الحدود والربط", "مسار الشراء", "الربط مع الوحدات", "السياسات والأدوار", "من الحاجة إلى السداد — تسع خطوات، لكل خطوة مالك واحد", "سطر الاحتياج هو العمود الفقري", "ما تملكه الوحدة"] },
}

// The rail: every role has Today, orders, receipts, suppliers, reports, boundaries; only sourcing roles see requests and RFQs.
const RAIL: Record<string, Role[]> = { اليوم: ALL, "طلبات الشراء الواردة": OMB, "طلبات العروض": OMB, "أوامر الشراء": ALL, "سندات الاستلام": ALL, الموردون: ALL, التقارير: ALL, "الحدود والربط": ALL }
const PROC_HEADED = new Set(["today", "requests", "rfqs", "orders", "orderA", "orderB", "receiptsIncoming", "receiptsLog", "receiptsNoPo", "suppliers", "reports", "settings"])
const railLabels = () => Array.from(document.querySelectorAll("nav a")).map((a) => (a.textContent ?? "").trim().replace(/\d+$/, ""))

describe.each(ROLES)("as %s", (role) => {
  it.each(Object.keys(SCREENS))("%s renders, every key resolved, titles and gates as the prototype", async (name) => {
    const spec = SPECS[name]
    pushed.length = 0
    const view = await openAs(role, name)
    dump(role, name)
    expect([...missingKeys]).toEqual([])
    expect(text()).not.toMatch(/MISSING/)

    const offered = !spec.only || spec.only.includes(role)
    // A tab outside his rail sends him to his first tab (ProcurementHeader), as the prototype's shell.
    expect({ name, role, sentHome: pushed.includes("/contractor/rfqs/today") }).toEqual({ name, role, sentHome: !offered })
    expect({ name, role, missing: spec.titles.filter((x) => !text().includes(x)) }).toEqual({ name, role, missing: [] })
    for (const title of spec.priced ?? []) expect({ name, role, title, shown: text().includes(title) }).toEqual({ name, role, title, shown: role !== "expediter" })
    const now = buttons()
    for (const [label, who] of Object.entries(spec.acts ?? {})) expect({ name, role, label, shown: now.includes(label) }).toEqual({ name, role, label, shown: offered && who.includes(role) })
    if (PROC_HEADED.has(name)) {
      const rail = railLabels()
      for (const [label, who] of Object.entries(RAIL)) expect({ name, role, label, inRail: rail.includes(label) }).toEqual({ name, role, label, inRail: who.includes(role) })
    }
    if (role === "expediter") expect({ name, riyal: text().includes(RIYAL) }).toEqual({ name, riyal: false })
    view.unmount()
  })
})

describe("owner of a company with a procurement team reads, the team acts", () => {
  it("the owner's needs desk says read-only and offers no selection; the buyer's does", async () => {
    let view = await openAs("owner", "requests")
    expect(text()).toContain("قراءة فقط — يتصرّف فريق المشتريات")
    expect(text()).not.toContain("تحديد")
    view.unmount()
    view = await openAs("buyer", "requests")
    expect(text()).not.toContain("قراءة فقط — يتصرّف فريق المشتريات")
    expect(text()).toContain("تحديد")
    view.unmount()
  })

  it("the buyer sees only the RFQs he raised; the manager sees every one", async () => {
    let view = await openAs("buyer", "rfqs")
    expect(text()).not.toContain("بلوك خرساني")
    view.unmount()
    view = await openAs("manager", "rfqs")
    expect(text()).toContain("بلوك خرساني")
    view.unmount()
  })

  it("the expediter reads the order value as —, prints without values, and cannot pick a cell", async () => {
    let view = await openAs("expediter", "orders")
    expect(text()).toContain("—")
    view.unmount()
    view = await openAs("expediter", "orderB")
    expect(buttons().some((b) => b.startsWith("اطبع أمر الشراء") && b.includes("بلا قيم"))).toBe(true)
    view.unmount()
    view = await openAs("expediter", "rfqCompare")
    const cells = Array.from(document.querySelectorAll("button")).filter((b) => (b.textContent ?? "").trim() === "——")
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((b) => b.disabled)).toBe(true)
    view.unmount()
  })
})

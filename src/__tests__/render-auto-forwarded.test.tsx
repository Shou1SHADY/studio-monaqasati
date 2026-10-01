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
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { DEFAULT_POLICIES, type ProcActor, type PurchaseOrder } from "@/lib/procurement/types"
import { approvePurchaseOrder, createPurchaseOrderFromAward, recordSupplierAcceptance, type AwardOfferLike, type RfqLike } from "@/lib/procurement/writes"
import { todayDay } from "@/lib/pm/format"
import GoodsReceivedPage from "@/app/[locale]/(contractor)/contractor/goods-received/page"
import ReportsPage from "@/app/[locale]/(contractor)/contractor/rfqs/reports/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const SUP = "supB"
const DAY = 86_400_000
const base = new Date(`${todayDay()}T00:00:00Z`).getTime()
const d = (n: number) => new Date(base + n * DAY).toISOString().slice(0, 10)
const iso = (n: number) => new Date(base + n * DAY + 9 * 3600_000).toISOString()

const owner: ProcActor = { uid: ORG, name: "المالك", isOwner: true, canApprove: true, canPrepare: true, canExpedite: true, canReceive: true, seesPrices: true }

const AUTO_PILL = "حُوّل تلقائياً بعد المهلة"
const AUTO_TRAIL = "تحويل تلقائي بعد المهلة"
const AUTO_EXCEPTION = "حُوّل الإشعار تلقائياً"

const forwardedTo = (over: Record<string, unknown> = {}) => ({ linkId: "l1", name: "ناصر أمين المخزن", userId: null, phoneMasked: "05****67", byName: "Mdmak Tech", at: iso(0), note: null, ...over })

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function openAs(node: React.ReactElement, path: string, search: string) {
  setSignedIn(ORG)
  setPathname(path, search)
  missingKeys.clear()
  const view = render(node)
  await flush()
  return view
}

const text = () => document.body.textContent ?? ""

async function buildWorld() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: owner.name, companyName: "شركة البناء المتقدم", email: "owner@test.sa" })
  seed(`users/${SUP}`, { organizationId: SUP, role: "Supplier", companyName: "مؤسسة الإسمنت", name: "مؤسسة الإسمنت", taxNumber: "300000000000004", isVerified: true })
  seed("rfqs/r4", {
    organizationId: ORG,
    contractorId: ORG,
    createdByUserId: ORG,
    title: "إسمنت المرحلة الثانية",
    status: "Awarded",
    city: "الرياض",
    category: "Construction Materials",
    deadline: d(-1),
    createdAt: iso(-10),
    pricingMode: "line",
    offersCount: 1,
    products: [{ name: "إسمنت بورتلاندي", quantity: 200, unitOfMeasure: "كيس" }],
  })
  seed("offers/o5", {
    rfqId: "r4",
    contractorOrgId: ORG,
    organizationId: SUP,
    supplierId: SUP,
    companyName: "مؤسسة الإسمنت",
    price: "18000",
    status: "قيد المراجعة",
    createdAt: iso(-3),
    offerPdfUrl: "https://x/offer.pdf",
    executionDuration: "2",
    executionDurationUnit: "أسابيع",
    lines: [{ rfqProductIndex: 0, unitPrice: 90 }],
  })
  const db = fakeFirestore as unknown as Firestore
  const rfq = { ...(readDoc<Record<string, unknown>>("rfqs/r4") as RfqLike), id: "r4" }
  const offer = { ...(readDoc<Record<string, unknown>>("offers/o5") as AwardOfferLike), id: "o5" }
  const po = await createPurchaseOrderFromAward(db, owner, { rfq, offer, offers: [offer], policies: DEFAULT_POLICIES, awardReason: { code: "availability", text: "الوحيد المتوفر بالكمية" } })
  await approvePurchaseOrder(db, owner, po.id, { policies: DEFAULT_POLICIES })
  await recordSupplierAcceptance(db, owner, po.id, { promisedDate: d(3), by: "buyer" })
  const order = readDoc<PurchaseOrder>(`purchaseOrders/${po.id}`) as PurchaseOrder
  const notice = (over: Record<string, unknown>) => ({
    contractorOrgId: ORG,
    supplierOrgId: SUP,
    supplierId: SUP,
    supplierName: "مؤسسة الإسمنت",
    rfqId: "r4",
    rfqTitle: "إسمنت المرحلة الثانية",
    status: "pending_confirmation",
    deliveryDate: d(0),
    poId: po.id,
    poNumber: order.docNumber,
    lines: order.lines.map((l) => ({ poLineId: l.id, name: l.name, unit: l.unit, noticeQuantity: l.quantity })),
    deliveryPersonName: "سائق المؤسسة",
    createdAt: iso(-1),
    ...over,
  })
  return { notice }
}

describe("an automatically forwarded delivery notice", () => {
  it("the incoming row says it was auto-forwarded after the window, and offers no second forward", async () => {
    const { notice } = await buildWorld()
    seed("deliveries/n1", notice({ forwardedTo: forwardedTo({ auto: true }) }))
    const view = await openAs(<GoodsReceivedPage />, "/contractor/goods-received", "tab=incoming")
    expect([...missingKeys]).toEqual([])
    expect(text()).toContain(AUTO_PILL)
    expect(Array.from(document.querySelectorAll("button, a")).map((b) => (b.textContent ?? "").trim())).not.toContain("حوّل للمستلم")
    view.unmount()
  })

  it("a notice forwarded by hand carries no such tag", async () => {
    const { notice } = await buildWorld()
    seed("deliveries/n1", notice({ forwardedTo: forwardedTo() }))
    const view = await openAs(<GoodsReceivedPage />, "/contractor/goods-received", "tab=incoming")
    expect(text()).not.toContain(AUTO_PILL)
    expect(text()).not.toContain(AUTO_TRAIL)
    view.unmount()
  })

  it("the exceptions report lists the auto-forward, naming the receiver", async () => {
    const { notice } = await buildWorld()
    seed("deliveries/n1", notice({ forwardedTo: forwardedTo({ auto: true }) }))
    const view = await openAs(<ReportsPage />, "/contractor/rfqs/reports", "report=exceptions&period=90")
    expect([...missingKeys]).toEqual([])
    expect(text()).toContain(AUTO_EXCEPTION)
    expect(text()).toContain("ناصر أمين المخزن")
    view.unmount()
  })

  it("the exceptions report is silent when nothing was auto-forwarded", async () => {
    const { notice } = await buildWorld()
    seed("deliveries/n1", notice({ forwardedTo: forwardedTo() }))
    const view = await openAs(<ReportsPage />, "/contractor/rfqs/reports", "report=exceptions&period=90")
    expect(text()).not.toContain(AUTO_EXCEPTION)
    view.unmount()
  })
})

/**
 * Procurement 1.5, PUR-07 / PUR-10 — the order's drawer rendered for real in both packages: with Finance it speaks of
 * Finance and waits for its payment; without it not a word names Finance, a fully received order closes with one
 * button (the payment status never in the way), and only the next step, the lines and the notices are open.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import type { PurchaseOrder } from "@/lib/procurement/types"
import OrdersPage from "@/app/[locale]/(contractor)/contractor/rfqs/orders/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const line = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "حديد تسليح", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 10, rejected: 0, held: 0, cancelled: 0, ...over })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/001",
  status: "accepted",
  basis: "direct",
  rfqTitle: "حديد",
  supplierOrgId: "sup1",
  supplierUserId: null,
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 30000,
  vatRate: 0.15,
  offersCount: 1,
  preparedById: ORG,
  preparedByName: "المالك",
  createdAt: "2026-10-01T08:00:00Z",
  approverKind: "owner",
  approvedById: ORG,
  approvedByName: "المالك",
  approvedAt: "2026-10-02T08:00:00Z",
  sentAt: "2026-10-02T09:00:00Z",
  supplierAcceptedAt: "2026-10-03T08:00:00Z",
  promisedDate: "2026-10-10",
  log: [],
  ...over,
})

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function open(id: string) {
  setSignedIn(ORG)
  setPathname("/contractor/rfqs/orders", `po=${id}`)
  missingKeys.clear()
  render(<OrdersPage />)
  await flush()
  return (document.querySelector('[role="dialog"]')?.textContent ?? "") as string
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement
const buttonNamed = (name: string) => Array.from(dialog().querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === name)

beforeEach(() => {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "o@test.sa" })
  seed("purchaseOrders/rcv", order({ paymentMark: { state: "unpaid", day: "2026-10-10", byName: "المالك", at: "x" } }))
  document.body.innerHTML = ""
})

describe("with Finance in the package", () => {
  it("the received order waits for Finance's payment and the drawer says what came back from it", async () => {
    const text = await open("rcv")
    expect(missingKeys.size).toBe(0)
    expect(text).toContain("المالية")
    expect(text).toContain("أُرسل إلى المالية")
    expect(buttonNamed("أقفل الأمر — مكتمل")).toBeUndefined()
    expect(readDoc<PurchaseOrder>("purchaseOrders/rcv")?.status).toBe("accepted")
  })
})

describe("without Finance", () => {
  beforeEach(() => seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["payments"] }))

  it("no word of the drawer names Finance", async () => {
    const text = await open("rcv")
    expect(missingKeys.size).toBe(0)
    expect(text).toContain("ط.ش-2026/001")
    expect(text).not.toContain("المالية")
    expect(text).not.toContain("مسار المال")
  })

  it("a fully received order is closed by one button, and the payment status does not stop it", async () => {
    await open("rcv")
    const close = buttonNamed("أقفل الأمر — مكتمل")
    expect(close).toBeDefined()
    await act(async () => void fireEvent.click(close as HTMLElement))
    await flush()
    expect(readDoc<PurchaseOrder>("purchaseOrders/rcv")).toMatchObject({ status: "closed", closedShort: false })
  })

  it("only the next step and the lines are open; the payment box is folded", async () => {
    await open("rcv")
    const boxes = Array.from(dialog().querySelectorAll("details"))
    expect(boxes.length).toBeGreaterThan(0)
    expect(boxes.every((d) => !d.hasAttribute("open"))).toBe(true)
    const titles = Array.from(dialog().querySelectorAll("summary")).map((s) => (s.textContent ?? "").trim())
    expect(titles).toEqual(expect.arrayContaining(["الدفع"]))
    expect(titles.join(" ")).not.toContain("الخطوة التالية")
    expect(dialog().textContent).toContain("الخطوة التالية")
  })
})

describe("the advance marked paid clears the unpaid note", () => {
  beforeEach(() => seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["payments"] }))

  it("an unpaid advance on an order in delivery asks to mark it paid", async () => {
    seed("purchaseOrders/adv", order({ lines: [line({ accepted: 0 })], advancePercent: 30 }))
    const unpaid = await open("adv")
    expect(unpaid).toContain("لم تُعلَّم مدفوعة")
    expect(buttonNamed("علّمها مدفوعة")).toBeDefined()
  })

  it("once the advance is marked paid the note is gone", async () => {
    seed("purchaseOrders/adv", order({ lines: [line({ accepted: 0 })], advancePercent: 30, advancePaidDay: "2026-10-05" }))
    const paid = await open("adv")
    expect(paid).not.toContain("لم تُعلَّم مدفوعة")
    expect(buttonNamed("علّمها مدفوعة")).toBeUndefined()
  })
})

describe("the next step names who we wait on and offers the reminder", () => {
  it("a rejected quantity offers the three answers on the step itself, each opening the form on that answer", async () => {
    seed("purchaseOrders/rej", order({ lines: [line({ accepted: 4, rejected: 1 })] }))
    await open("rej")
    for (const name of ["اطلب استبدالاً", "اطلب خصماً", "أرجِعه"]) expect(buttonNamed(name)).toBeDefined()
    await act(async () => void fireEvent.click(buttonNamed("اطلب خصماً") as HTMLElement))
    await flush()
    expect(document.body.textContent).toContain("السعر المخفّض للوحدة المرفوضة")
  })

  it("an order awaiting approval says since when, and «ذكّر المعتمِد» tells the approvers", async () => {
    seed("users/buy", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy", name: "بدر" })
    seed("users/mgr", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-mgr", name: "نورة" })
    seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept"] })
    seed("teamGroups/g-mgr", { organizationId: ORG, permissions: ["po.approve"] })
    seed("purchaseOrders/wait", order({ status: "awaiting_approval", approvedAt: null, approvedById: null, preparedById: "buy", preparedByName: "بدر", approverKind: "manager", createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), sentAt: null, supplierAcceptedAt: null, lines: [line({ accepted: 0 })] }))
    setSignedIn("buy")
    setPathname("/contractor/rfqs/orders", "po=wait")
    render(<OrdersPage />)
    await flush()
    expect(dialog().textContent).toContain("منذ 3 أيام")
    await act(async () => void fireEvent.click(buttonNamed("ذكّر المعتمِد") as HTMLElement))
    await flush()
    expect(listCollection<{ type: string }>("users/mgr/notifications").map((n) => n.type)).toContain("po_awaiting_approval")
    expect(buttonNamed("ذُكّر المعتمِد")).toBeDefined()
  })
})

describe("with Finance: the hold is Procurement's, the payment is Finance's", () => {
  beforeEach(() => {
    seed("users/mgr", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-mgr", name: "نورة" })
    seed("teamGroups/g-mgr", { organizationId: ORG, permissions: ["po.approve"] })
    seed("purchaseOrders/fin", order({ preparedById: "buy", preparedByName: "بدر", lines: [line({ accepted: 0 })], advancePercent: 30 }))
  })

  it("the approver sees «أوقف صرف فاتورة» and never «سجّل دفعة»", async () => {
    setSignedIn("mgr")
    setPathname("/contractor/rfqs/orders", "po=fin")
    render(<OrdersPage />)
    await flush()
    expect(buttonNamed("أوقف صرف فاتورة")).toBeDefined()
    expect(buttonNamed("سجّل دفعة")).toBeUndefined()
  })

  it("an advance waiting on Finance offers «ذكّر المالية» (and nothing to mark paid here)", async () => {
    setSignedIn("mgr")
    setPathname("/contractor/rfqs/orders", "po=fin")
    render(<OrdersPage />)
    await flush()
    expect(buttonNamed("ذكّر المالية")).toBeDefined()
    expect(buttonNamed("علّمها مدفوعة")).toBeUndefined()
    expect(dialog().textContent).toContain("طُلبت من المالية")
  })
})

describe("without Project Management the orders list answers to the delivery site", () => {
  it("each order carries the site its RFQ line named, and the list has a site filter instead of the project one", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
    seed(`procurementSettings/${ORG}`, { organizationId: ORG, deliverySites: [{ id: "s1", kind: "site", name: "مجمع الياسمين", city: "الرياض", district: "الياسمين", address: "", receiverId: null }] })
    seed("rfqs/r1", { organizationId: ORG, contractorId: ORG, title: "حديد", status: "Awarded", products: [{ name: "حديد تسليح", quantity: 10, unitOfMeasure: "طن", deliverySiteId: "s1" }] })
    seed("purchaseOrders/site", order({ rfqId: "r1", lines: [line({ rfqProductIndex: 0 })] }))
    setSignedIn(ORG)
    setPathname("/contractor/rfqs/orders", "filter=all")
    render(<OrdersPage />)
    await flush()
    expect(document.body.textContent).toContain("مجمع الياسمين")
    expect(document.querySelector('[aria-label="موقع التسليم"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="المشروع"]')).toBeNull()
  })
})

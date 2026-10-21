/**
 * Procurement 2.0 — the orders list and the drawer, rendered for real (WP-S4-06): the segments with the PRD's names and counts
 * (one partition), the six columns with the next step and «من ننتظر», and the drawer's sections in the prototype's order — next
 * step, talking to the supplier, lines, notices, money or payment, the pay-later row «قريباً», the document folded — with the
 * header tags, the piece line «= 180 م (المطلوب 175)», the supplier's decline kept live in red, the owner's gate on an advance, and
 * the cancel dialog that sends its reason and its choice to the server route.
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
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { getAuth } from "firebase/auth"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import OrdersPage from "@/app/[locale]/(contractor)/contractor/rfqs/orders/page"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const line = (over: Record<string, unknown> = {}) => ({ id: "l1", name: "حديد تسليح", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0, ...over })
const order = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/001",
  status: "accepted",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد",
  offerId: "o1",
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "مصنع الجودة",
  isGuestSupplier: false,
  lines: [line()],
  totalExVat: 30000,
  vatRate: 0.15,
  offersCount: 3,
  lowestOfferTotal: 30000,
  shortCompetition: false,
  noOfficialQuote: false,
  preparedById: ORG,
  preparedByName: "المالك",
  createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  approverKind: "owner",
  approvedById: ORG,
  approvedByName: "المالك",
  approvedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  sentAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
  sentChannel: "portal",
  supplierAcceptedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  promisedDate: day(20),
  log: [],
  ...over,
})

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[]
const drawer = () => dialogs()[0]
const topDialog = () => dialogs()[dialogs().length - 1]
const buttonIn = (root: HTMLElement, name: string) => Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === name)
const tabs = () => Array.from(document.querySelectorAll('[role="tab"]')) as HTMLElement[]

async function list(search = "") {
  setSignedIn(ORG)
  setPathname("/contractor/rfqs/orders", search)
  missingKeys.clear()
  render(<OrdersPage />)
  await flush()
}
async function open(id: string) {
  await list(`po=${id}`)
  return drawer()?.textContent ?? ""
}

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "o@test.sa" })
  document.body.innerHTML = ""
})

describe("the list: segments, columns, next step and who we wait on", () => {
  beforeEach(() => {
    seed("purchaseOrders/act", order({ docNumber: "PO-2026/001", status: "awaiting_approval", approvedAt: null, approvedById: null, sentAt: null, supplierAcceptedAt: null, promisedDate: null }))
    seed("purchaseOrders/wait", order({ docNumber: "PO-2026/002", supplierName: "الأفق للتوريد" }))
    seed("purchaseOrders/late", order({ docNumber: "PO-2026/003", promisedDate: day(-8), supplierName: "المتأخر" }))
    seed("purchaseOrders/done", order({ docNumber: "PO-2026/004", status: "closed", closedAt: new Date().toISOString(), lines: [line({ accepted: 10 })], supplierName: "المكتمل" }))
  })

  it("the five segments carry the PRD's names, and the first four count to the fifth", async () => {
    await list()
    expect(missingKeys.size).toBe(0)
    const names = tabs().map((t) => (t.textContent ?? "").replace(/\d+$/, "").trim())
    expect(names).toEqual(["يحتاج تصرّفنا", "ننتظر غيرنا", "متأخرة", "مكتملة", "الكل"])
    const counts = tabs().map((t) => Number((t.textContent ?? "").replace(/\D+/g, "")))
    expect(counts).toEqual([1, 1, 1, 1, 4])
    expect(counts.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(counts[4])
  })

  it("six columns; a row names its next step and who we wait on", async () => {
    await list()
    const heads = Array.from(document.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim())
    expect(heads).toEqual(["الأمر", "المورد", "الموقع", "القيمة", "الخطوة التالية", "من ننتظر"])
    const row = document.querySelector("tbody tr") as HTMLElement
    expect(row.textContent).toContain("بانتظار اعتماد الأمر")
    expect(row.textContent).toContain("المعتمِد")
    expect(row.textContent).toContain("شامل الضريبة")
    await act(async () => void fireEvent.click(tabs()[1]))
    expect((document.querySelector("tbody tr") as HTMLElement).textContent).toContain("بانتظار المورد")
    await act(async () => void fireEvent.click(tabs()[2]))
    expect((document.querySelector("tbody tr") as HTMLElement).textContent).toContain("المورد متأخر")
    await act(async () => void fireEvent.click(tabs()[4]))
    expect(document.querySelectorAll("tbody tr")).toHaveLength(4)
  })

  it("the old addresses of Today's tiles still open the right segment", async () => {
    await list("filter=awaiting_approval")
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true")
    cleanup()
    await list("filter=received")
    expect(tabs()[3].getAttribute("aria-selected")).toBe("true")
  })

  it("an off-platform supplier is marked under his name", async () => {
    seed("purchaseOrders/guest", order({ docNumber: "PO-2026/005", isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null, supplierName: "مؤسسة الندى" }))
    await list()
    await act(async () => void fireEvent.click(tabs()[4]))
    const row = Array.from(document.querySelectorAll("tbody tr")).find((r) => (r.textContent ?? "").includes("مؤسسة الندى")) as HTMLElement
    expect(row.textContent).toContain("خارج المنصة")
  })
})

describe("the drawer in the prototype's order", () => {
  it("next step · talking to the supplier · lines · …· pay-later «قريباً» · the document folded", async () => {
    seed("purchaseOrders/p", order({ docNumber: "PO-2026/010" }))
    const text = await open("p")
    expect(missingKeys.size).toBe(0)
    const at = (s: string) => text.indexOf(s)
    expect(at("الخطوة التالية")).toBeGreaterThan(-1)
    expect(at("التواصل مع المورّد")).toBeGreaterThan(at("الخطوة التالية"))
    expect(at("البنود")).toBeGreaterThan(at("التواصل مع المورّد"))
    expect(at("ادفع هذا الأمر بالأجل على دفعات")).toBeGreaterThan(at("البنود"))
    expect(at("المستند ومن يملك كل خطوة")).toBeGreaterThan(at("ادفع هذا الأمر بالأجل على دفعات"))
    const summaries = Array.from(drawer().querySelectorAll("summary")).map((s) => (s.textContent ?? "").trim())
    expect(summaries.some((s) => s.includes("المستند ومن يملك كل خطوة"))).toBe(true)
    // the row opens an explanation and writes nothing
    expect(buttonIn(drawer(), "قريباً")).toBeDefined()
    await act(async () => void fireEvent.click(buttonIn(drawer(), "قريباً") as HTMLElement))
    await flush()
    expect(document.body.textContent).toContain("الشراء بالأجل — قريباً")
  })

  it("the conversation names the channel and the order's last events; an off-platform supplier is reached on WhatsApp with the link", async () => {
    seed("purchaseOrders/g", order({ isGuestSupplier: true, supplierOrgId: "guest", supplierUserId: null, log: [{ at: new Date().toISOString(), action: "sent", byId: ORG, byName: "المالك", params: { channel: "whatsapp" } }] }))
    const text = await open("g")
    expect(text).toContain("خارج المنصة — تصله على واتساب برابط الأمر، ويردّ منه")
    expect(text).toContain("أرسله المالك إلى المورد")
  })

  it("the header carries the tags: not the lowest, low competition, lump sum, no VAT, the version", async () => {
    seed("purchaseOrders/t", order({ lowestOfferTotal: 25000, awardReasonText: "أسرع توريد", shortCompetition: true, offersCount: 2, vatRate: 0, ver: 3, lines: [line({ unitPrice: null })] }))
    const text = await open("t")
    expect(text).toContain("ليس الأقل: أسرع توريد")
    expect(text).toContain("منافسة ناقصة (2 من 3)")
    expect(text).toContain("مبلغ إجمالي")
    expect(text).toContain("مورّد غير مسجّل ضريبياً — بلا ضريبة")
    expect(text).toContain("الإصدار 3")
  })

  it("a piece line reads «30 قطعة 6 م» and «= 180 م (المطلوب 175)»; in English the pack is «6 m bar»", async () => {
    const pieces = order({ lines: [line({ name: "اسياخ حديد 12 مم", unit: "قطعة 6 م", quantity: 30, unitPrice: 74, pk: 6, need: 175, base: "م", packName: { ar: "قطعة 6 م", en: "6 m bar" } })], totalExVat: 2220 })
    seed("purchaseOrders/pc", pieces)
    const ar = await open("pc")
    expect(ar).toContain("30 قطعة 6 م")
    expect(ar).toContain("= 180 م (المطلوب 175)")
    cleanup()
    setLocale("en")
    const en = await open("pc")
    expect(en).toContain("30 6 m bar")
    expect(en).toContain("= 180 م (needed 175)")
  })

  it("R-23 · the supplier's decline keeps the order live, in red, with «أعد الترسية أو أعِد المواد» first", async () => {
    seed("purchaseOrders/d", order({ status: "sent", supplierAcceptedAt: null, promisedDate: null, supplierDecline: { at: new Date().toISOString(), reason: "price", byId: "su1", byName: "سامر" } }))
    const text = await open("d")
    expect(text).toContain("اعتذر المورّد عن الأمر: السعر لم يعد قائماً")
    expect(buttonIn(drawer(), "أعد الترسية أو أعِد المواد")).toBeDefined()
    expect(buttonIn(drawer(), "أعد الترسية")).toBeUndefined()
  })

  it("PO-14 · an advance to a supplier with no record waits for the owner, who has the button; nobody else does", async () => {
    seed("purchaseOrders/a", order({ advancePercent: 30, advanceOwner: { required: true, approvedAt: null } }))
    const text = await open("a")
    expect(text).toContain("يعتمدها المالك قبل طلبها")
    expect(buttonIn(drawer(), "اعتمد الدفعة")).toBeDefined()
    cleanup()
    seed("users/buy", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g-buy", name: "بدر" })
    seed("teamGroups/g-buy", { organizationId: ORG, permissions: ["offers.accept", "po.approve"] })
    setSignedIn("buy")
    setPathname("/contractor/rfqs/orders", "po=a")
    render(<OrdersPage />)
    await flush()
    expect(buttonIn(drawer(), "اعتمد الدفعة")).toBeUndefined()
    expect(drawer().textContent).toContain("بانتظار المالك")
  })

  it("a changed order waits for the supplier to accept its version", async () => {
    seed("purchaseOrders/v", order({ ver: 2, versions: [{ n: 1, at: "2026-10-01T08:00:00Z", byName: "المالك", kind: "sent" }, { n: 2, at: "2026-10-05T08:00:00Z", byName: "المالك", kind: "date" }] }))
    expect(await open("v")).toContain("الإصدار 2 من الأمر بانتظار قبول المورّد")
  })
})

describe("the buttons go to the server routes", () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  beforeEach(() => {
    seed("rfqs/r1", { organizationId: ORG, contractorId: ORG, title: "حديد", status: "Awarded", rfqNumber: "RFQ-2026/011" })
    calls.length = 0
    ;(getAuth as jest.Mock).mockReturnValue({ currentUser: { getIdToken: async () => "tok" } })
    global.fetch = jest.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true, json: async () => ({ success: true, data: { poId: "x", status: "cancelled", ver: 2 } }) }
    }) as unknown as typeof fetch
  })

  it("«اعتمده» calls the approve route with the order", async () => {
    seed("purchaseOrders/ap", order({ status: "awaiting_approval", approvedAt: null, approvedById: null, sentAt: null, supplierAcceptedAt: null, promisedDate: null }))
    await open("ap")
    await act(async () => void fireEvent.click(buttonIn(drawer(), "اعتمده") as HTMLElement))
    await flush()
    expect(calls).toEqual([{ url: "/api/procurement/po/approve", body: expect.objectContaining({ poId: "ap" }) }])
  })

  it("the owner's «اعتمد الدفعة» calls advance-approve", async () => {
    seed("purchaseOrders/a", order({ advancePercent: 30, advanceOwner: { required: true, approvedAt: null } }))
    await open("a")
    await act(async () => void fireEvent.click(buttonIn(drawer(), "اعتمد الدفعة") as HTMLElement))
    await flush()
    expect(calls[0]).toMatchObject({ url: "/api/procurement/po/advance-approve", body: { poId: "a" } })
  })

  it("WF-25 · the cancel dialog asks the reason and what to do with the items; nothing is sent before both are chosen", async () => {
    seed("purchaseOrders/c", order({ status: "sent", supplierAcceptedAt: null, promisedDate: null, sentAt: new Date(Date.now() - 4 * 86_400_000).toISOString() }))
    await open("c")
    await act(async () => void fireEvent.click(buttonIn(drawer(), "ألغِ الأمر") as HTMLElement))
    await flush()
    const dlg = topDialog()
    expect(dlg.textContent).toContain("ألغِ ط.ش-2026/001")
    for (const why of ["لم يقبله المورد في مهلته", "اعتذر المورّد", "طلب تعديلاً لا نقبله", "لم تعد الحاجة قائمة", "سبب آخر"]) expect(buttonIn(dlg, why)).toBeDefined()
    expect(dlg.textContent).toContain("وموادّه؟")
    const submit = buttonIn(dlg, "ألغِ الأمر") as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await act(async () => void fireEvent.click(buttonIn(dlg, "لم يقبله المورد في مهلته") as HTMLElement))
    expect((buttonIn(topDialog(), "ألغِ الأمر") as HTMLButtonElement).disabled).toBe(true)
    const choice = Array.from(topDialog().querySelectorAll('[role="radio"]')).find((b) => (b.textContent ?? "").includes("أعد ترسيتها من عروض")) as HTMLElement
    await act(async () => void fireEvent.click(choice))
    await act(async () => void fireEvent.click(buttonIn(topDialog(), "ألغِ الأمر") as HTMLElement))
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: "/api/procurement/po/cancel", body: { poId: "c", why: "nacc", then: "reaward", note: null } })
  })

  it("«سبب آخر» asks for its words (four characters at least) before it may be sent", async () => {
    seed("purchaseOrders/c", order({ status: "sent", supplierAcceptedAt: null, promisedDate: null }))
    await open("c")
    await act(async () => void fireEvent.click(buttonIn(drawer(), "ألغِ الأمر") as HTMLElement))
    await flush()
    await act(async () => void fireEvent.click(buttonIn(topDialog(), "سبب آخر") as HTMLElement))
    const choices = Array.from(topDialog().querySelectorAll('[role="radio"]')).filter((b) => (b.textContent ?? "").includes("أعِدها إلى")) as HTMLElement[]
    await act(async () => void fireEvent.click(choices[0]))
    await act(async () => void fireEvent.click(buttonIn(topDialog(), "ألغِ الأمر") as HTMLElement))
    await flush()
    expect(calls).toHaveLength(0)
    expect(topDialog().textContent).toContain("اكتب السبب")
  })
})

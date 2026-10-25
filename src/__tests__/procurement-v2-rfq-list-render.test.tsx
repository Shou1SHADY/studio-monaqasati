jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)
jest.mock("@/hooks/useMaterialTree", () => ({ useMaterialTree: () => ({ index: null }) }))
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => "tok" } }) }))

/**
 * Procurement 2.0, «طلبات العروض» on screen (screens table, NFR-03, G-03, G-11): the prototype's chips with counts, drafts apart, the
 * filter bar, tiles or rows remembered, the card's content and its ONE primary action per state, 24 at a time and «عرض N أخرى»,
 * an empty state per case, both languages, and a phone with nothing sideways.
 */

import React from "react"
import { act, fireEvent, render, within } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, queriesRun, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import RfqsPage from "@/app/[locale]/(contractor)/contractor/rfqs/page"
import { riyadhDay } from "@/lib/hr/format"

installDomShims()
jest.setTimeout(120_000)

const ORG = "own"
const TODAY = riyadhDay()
const addDay = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const LAYOUT_KEY = "mdmak.proc.rfqLayout"

const text = () => document.body.textContent ?? ""
const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const chip = (label: string) => Array.from(document.querySelectorAll("[role='tab']")).find((b) => (b.textContent ?? "").trim().startsWith(label)) as HTMLButtonElement | undefined
const pressed = () => Array.from(document.querySelectorAll("[role='tab'][aria-selected='true']")).map((b) => (b.textContent ?? "").trim())
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined
const select = (label: string) => document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
const cards = () => Array.from(document.querySelectorAll("article"))
const titles = () => cards().map((c) => (c.querySelector("h3")?.textContent ?? "").trim())
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy()
  await act(async () => void fireEvent.click(el as Element))
  await flush(3)
}

const PRODUCTS = [
  { name: "بلك مصمت", quantity: 1000, unitOfMeasure: "حبة", deliverySiteId: "site-1" },
  { name: "أسمنت", quantity: 100, unitOfMeasure: "كيس", deliverySiteId: "site-1" },
]
const rfqDoc = (over: Record<string, unknown>) => ({
  organizationId: ORG,
  contractorId: ORG,
  createdByUserId: ORG,
  createdByUserName: "المالك",
  status: "New",
  audience: "public",
  visibility: "public",
  city: "الرياض",
  pricingMode: "line",
  deadline: addDay(2),
  createdAt: `${addDay(-5)}T08:00:00.000Z`,
  offersCount: 0,
  reachedCount: 10,
  subCategoryIds: ["cement"],
  products: PRODUCTS,
  ...over,
})
const offerDoc = (id: string, rfqId: string, name: string, a: number, b: number, over: Record<string, unknown> = {}) => ({
  rfqId,
  contractorOrgId: ORG,
  organizationId: id,
  supplierId: id,
  companyName: name,
  status: "قيد المراجعة",
  vatRegistered: true,
  createdAt: `${addDay(-1)}T08:00:00.000Z`,
  price: "0",
  lines: [{ rfqProductIndex: 0, unitPrice: a }, { rfqProductIndex: 1, unitPrice: b }],
  ...over,
})

function world() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`procurementSettings/${ORG}`, {
    organizationId: ORG,
    deliverySites: [
      { id: "site-1", kind: "site", name: "فيلا الملقا", city: "الرياض", district: "الملقا", address: "", receiverId: null },
      { id: "site-2", kind: "site", name: "برج العليا", city: "الرياض", district: "العليا", address: "", receiverId: null },
    ],
  })
  seed("rfqs/R1", rfqDoc({ title: "بلك وأسمنت — فيلا الملقا", rfqNumber: "RFQ-2026/003", offersCount: 3 }))
  seed("offers/a", offerDoc("a", "R1", "مصنع الشرق", 1, 20)) // 1,000 + 2,000
  seed("offers/b", offerDoc("b", "R1", "مؤسسة البحر", 1.1, 18))
  seed("offers/c", offerDoc("c", "R1", "الأمل للمقاولات", 1, 25, { isGuestOffer: true, supplierId: "guest", organizationId: "guest", guestContact: { name: "الأمل", phone: "0551112222" } }))
  seed("rfqs/R1/inquiries/q1", { kind: "ask", question: "هل التسليم شامل التنزيل؟", from: { orgId: null, anon: true }, via: "link", answer: null, reply: null, createdAt: `${addDay(-2)}T09:00:00.000Z` })
  seed("rfqs/R2", rfqDoc({ title: "زوايا حديد — برج العليا", rfqNumber: "RFQ-2026/011", deadline: addDay(-2), offersCount: 2, products: [{ ...PRODUCTS[0], deliverySiteId: "site-2" }, { ...PRODUCTS[1], deliverySiteId: "site-2" }], subCategoryIds: ["steel"] }))
  seed("offers/d", offerDoc("d", "R2", "مصنع النخبة", 2, 10, { rfqId: "R2" }))
  seed("offers/e", offerDoc("e", "R2", "الوادي", 2.2, 12, { rfqId: "R2" }))
  seed("rfqs/R3", rfqDoc({ title: "رمل لياسة", rfqNumber: "RFQ-2026/012", deadline: addDay(-1), subCategoryIds: ["sand"] }))
  seed("rfqs/R4", rfqDoc({ title: "بلك مصمت — الياسمين", rfqNumber: "RFQ-2026/008", status: "Awarded", deadline: addDay(-1), offersCount: 1, closedEarly: { at: `${addDay(-1)}T10:00:00.000Z`, originalDeadline: addDay(4), reason: "award" } }))
  seed("purchaseOrders/po1", { organizationId: ORG, rfqId: "R4", status: "accepted", docNumber: "PO-2026/001", lines: [], log: [] })
  seed("rfqs/R5", rfqDoc({ title: "أبواب معدنية", rfqNumber: "RFQ-2026/009", status: "Cancelled", cancellation: { code: "need", at: `${addDay(-3)}T08:00:00.000Z` } }))
  seed("rfqs/R6", rfqDoc({ title: "مسودة تشطيبات", rfqNumber: null, status: "Draft", deadline: null, reachedCount: null }))
  seed("rfqs/R7", rfqDoc({ title: "خرسانة جاهزة — إسناد مباشر", rfqNumber: "RFQ-2026/010", status: "Awarded", audience: "private", visibility: "private", directAward: true, allowedSupplierOrgIds: ["east"], deadline: addDay(-6), offersCount: 1 }))
}

async function open(search = "") {
  setSignedIn(ORG)
  setPathname("/contractor/rfqs", search)
  missingKeys.clear()
  queriesRun.length = 0
  const view = render(<RfqsPage />)
  await flush()
  return view
}

let storage: Record<string, string> = {}
beforeEach(() => {
  storage = {}
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => storage[k] ?? null, setItem: (k: string, v: string) => void (storage[k] = v), removeItem: (k: string) => void delete storage[k] },
  })
  setLocale("ar")
  window.innerWidth = 1280
  world()
})

describe("the chips", () => {
  it("are the prototype's — مفتوحة · تُقارن · رُسّيت · أُلغيت · الكل — each with its count, drafts apart", async () => {
    const view = await open()
    expect([...missingKeys]).toEqual([])
    const labels = Array.from(document.querySelectorAll("[role='tab']")).map((b) => (b.textContent ?? "").trim())
    expect(labels).toEqual(expect.arrayContaining(["مفتوحة1", "تُقارن2", "رُسّيت2", "أُلغيت1", "الكل6", "المسودات1"]))
    expect(text()).not.toMatch(/نشطة|مكتملة/)
    view.unmount()
  })

  it("open on the first non-empty one, and a chip shows exactly its cards", async () => {
    const view = await open()
    expect(pressed()).toContain("مفتوحة1")
    expect(titles()).toEqual(["بلك وأسمنت — فيلا الملقا"])
    await click(chip("تُقارن"))
    expect(titles().sort()).toEqual(["رمل لياسة", "زوايا حديد — برج العليا"].sort())
    await click(chip("رُسّيت"))
    expect(titles().sort()).toEqual(["بلك مصمت — الياسمين", "خرسانة جاهزة — إسناد مباشر"].sort())
    await click(chip("أُلغيت"))
    expect(titles()).toEqual(["أبواب معدنية"])
    await click(chip("الكل"))
    expect(titles()).toHaveLength(6)
    expect(titles()).not.toContain("مسودة تشطيبات")
    view.unmount()
  })

  it("the cancelled chip appears only when something was cancelled", async () => {
    seed("rfqs/R5", rfqDoc({ title: "أبواب معدنية", status: "Awarded", deadline: addDay(-3) }))
    const view = await open()
    expect(chip("أُلغيت")).toBeUndefined()
    view.unmount()
  })

  it("lands on «تُقارن» when nothing is open, and on «الكل» when nothing is either", async () => {
    seed("rfqs/R1", rfqDoc({ title: "بلك وأسمنت — فيلا الملقا", status: "Awarded", deadline: addDay(-3) }))
    let view = await open()
    expect(pressed()[0]).toMatch(/^تُقارن/)
    view.unmount()
    seed("rfqs/R2", rfqDoc({ title: "زوايا", status: "Awarded", deadline: addDay(-3) }))
    seed("rfqs/R3", rfqDoc({ title: "رمل", status: "Awarded", deadline: addDay(-3) }))
    view = await open()
    expect(pressed()[0]).toMatch(/^الكل/)
    view.unmount()
  })
})

describe("drafts", () => {
  it("live behind «المسودات», finish in the review step, and can be deleted one at a time — no bulk bar, no checkboxes", async () => {
    const view = await open()
    await click(chip("المسودات"))
    expect(titles()).toEqual(["مسودة تشطيبات"])
    const finish = document.querySelector('a[data-action="complete"]') as HTMLAnchorElement
    expect(finish.getAttribute("href")).toBe("/contractor/rfqs/new?edit=R6&step=review")
    expect(finish.textContent).toContain("أكمل وانشر")
    expect(button("حذف")).toBeDefined()
    expect(document.querySelector('input[type="checkbox"], [role="checkbox"]')).toBeNull()
    expect(text()).not.toMatch(/مسح التحديد|حذف المحدد|تُنشر المسودة من خطوة المراجعة/)
    expect(text()).toContain("مسودة — لم تُنشر بعد")
    view.unmount()
  })
})

describe("a card", () => {
  it("an open RFQ says its number, sites, materials, reach, unanswered inquiry, offers, closing day and the lowest complete offer with its basis", async () => {
    const view = await open()
    const card = cards()[0]
    const t = card.textContent ?? ""
    expect(t).toContain("RFQ-2026/003")
    expect(t).toContain("مفتوح")
    expect(t).toContain("فيلا الملقا")
    expect(t).toContain("مادتين")
    expect(t).toContain("عام · 10 موردين")
    expect(t).toContain("استفسار واحد بلا جواب")
    expect(t).toContain("3 عروض حتى الآن")
    expect(t).toContain("منها 1 من خارج المنصة")
    expect(t).toMatch(/يُغلق .+ · بعد يومين/)
    // a: 1,000 + 2,000 = 3,000 net → 3,450 with VAT; b: 1,100 + 1,800 = 2,900 → 3,335 — the lowest COMPLETE one.
    expect(t).toContain("أقل عرض كامل")
    expect(t).toContain("3,335")
    expect(t).toContain("شامل الضريبة")
    view.unmount()
  })

  it("the lowest complete offer on the card is the number the RFQ page's evaluation gives (G-03)", async () => {
    const { lowestCompleteOffer } = await import("@/lib/procurement/offer-calc")
    const { toCalcOffer } = await import("@/lib/procurement/award-plan")
    const { readDoc } = await import("@/test-utils/fake-firestore")
    const r = readDoc<Record<string, unknown>>("rfqs/R1") as never
    const offers = ["a", "b", "c"].map((id) => ({ id, ...(readDoc<Record<string, unknown>>(`offers/${id}`) as object) }))
    const same = lowestCompleteOffer(r, offers.map((o) => toCalcOffer(o as never, undefined)), { tiePercent: 0.5, today: TODAY })
    expect(same?.grossH).toBe(333_500)
    const view = await open()
    expect(cards()[0].textContent).toContain("3,335")
    view.unmount()
  })

  it("an offer the buyer excluded leaves the lowest", async () => {
    seed("offerDecisions/b", { offerId: "b", rfqId: "R1", organizationId: ORG, shortlist: null, exclusion: { code: "spec", text: null, at: "x", byId: ORG, byName: "المالك" }, log: [], updatedAt: "x" })
    const view = await open()
    expect(cards()[0].textContent).toContain("3,450")
    expect(cards()[0].textContent).not.toContain("3,335")
    view.unmount()
  })

  it("the one primary action: compare (live offers) · open (none yet) · reopen (nothing live) · open (awarded)", async () => {
    const view = await open()
    expect(cards()[0].querySelector("[data-action]")?.textContent).toContain("قارن ورسِّ")
    expect(cards()[0].querySelector("a[data-action='compare']")?.getAttribute("href")).toBe("/contractor/rfqs/R1/offers?tab=compare")
    expect(cards()[0].querySelectorAll("[data-action]")).toHaveLength(1)
    await click(chip("تُقارن"))
    const byTitle = (title: string) => cards().find((c) => c.querySelector("h3")?.textContent === title) as HTMLElement
    expect(byTitle("زوايا حديد — برج العليا").querySelector("[data-action]")?.textContent).toContain("قارن ورسِّ")
    const empty = byTitle("رمل لياسة")
    expect(empty.querySelector("[data-action]")?.textContent).toContain("أعد فتحه")
    expect(empty.textContent).toContain("لا عرض حيّ — أُغلق بلا عروض")
    // The pill agrees with the card's own line (UI review): nothing in the running is not «يُقارن».
    const pill = empty.querySelector("h3")?.previousElementSibling?.textContent ?? ""
    expect(pill).toContain("لا عرض حيّ")
    expect(pill).not.toContain("يُقارن")
    const comparing = cards().find((c) => c.querySelector("h3")?.textContent !== "رمل لياسة") as HTMLElement
    expect(comparing.querySelector("h3")?.previousElementSibling?.textContent).toContain("يُقارن")
    await click(chip("رُسّيت"))
    for (const c of cards()) {
      expect(c.querySelector("[data-action]")?.textContent).toContain("افتح")
      expect(c.querySelectorAll("[data-action]")).toHaveLength(1)
    }
    view.unmount()
  })

  it("«أعد فتحه» opens the lifecycle's own reopen dialog on the same page", async () => {
    const view = await open()
    await click(chip("تُقارن"))
    const empty = cards().find((c) => c.querySelector("h3")?.textContent === "رمل لياسة") as HTMLElement
    await click(empty.querySelector("[data-action='reopen']"))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("أعد فتح الطلب بموعد جديد")
    view.unmount()
  })

  it("an early award says «أُغلق مبكراً» with its date and the order it made; a direct award says to whom", async () => {
    seed("offers/x", offerDoc("x", "R7", "الإنشاءات الحديثة", 1, 1, { status: "مقبول" }))
    const view = await open()
    await click(chip("رُسّيت"))
    const early = cards().find((c) => c.querySelector("h3")?.textContent === "بلك مصمت — الياسمين") as HTMLElement
    expect(early.textContent).toContain("أُغلق مبكراً")
    expect(early.textContent).toContain("رُسّي في أمر واحد")
    expect(early.textContent).not.toContain("يُغلق")
    const direct = cards().find((c) => c.querySelector("h3")?.textContent === "خرسانة جاهزة — إسناد مباشر") as HTMLElement
    expect(direct.textContent).toContain("إسناد مباشر")
    expect(direct.textContent).toContain("رُسّي لدى الإنشاءات الحديثة")
    view.unmount()
  })

  it("the title still opens the RFQ on its details, and the unanswered badge opens its inquiries", async () => {
    const view = await open()
    expect(cards()[0].querySelector("h3 a")?.getAttribute("href")).toBe("/contractor/rfqs/R1/offers?tab=details")
    const badge = Array.from(cards()[0].querySelectorAll("a")).find((a) => (a.textContent ?? "").includes("بلا جواب"))
    expect(badge?.getAttribute("href")).toBe("/contractor/rfqs/R1/offers?tab=inquiries")
    view.unmount()
  })

  it("share (the visitor link) and print stay on an open RFQ; print stays on the others", async () => {
    const view = await open()
    expect(button("رابط الزوار")).toBeDefined()
    expect(cards()[0].querySelector('button[aria-label="مستند الطلب PDF"]')).not.toBeNull()
    await click(chip("رُسّيت"))
    expect(button("رابط الزوار")).toBeUndefined()
    expect(cards()[0].querySelector('button[aria-label="مستند الطلب PDF"]')).not.toBeNull()
    view.unmount()
  })

  it("a reader who sees no prices is not shown the lowest complete offer", async () => {
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
    seed("users/exp", { organizationId: ORG, organizationRole: "member", defaultGroupId: "g_exp", name: "سلمان", email: "e@test.sa" })
    seed("teamGroups/g_exp", { organizationId: ORG, name: "exp", key: null, permissions: ["po.expedite", "projects.view"] })
    setSignedIn("exp")
    setPathname("/contractor/rfqs", "")
    missingKeys.clear()
    const view = render(<RfqsPage />)
    await flush()
    expect(cards()[0].textContent).toContain("3 عروض حتى الآن")
    expect(cards()[0].textContent).not.toContain("أقل عرض كامل")
    view.unmount()
  })

  it("asks for the offers by the buying company, as the rules need", async () => {
    const view = await open()
    const offerQueries = queriesRun.filter((q) => q.path === "offers")
    expect(offerQueries.length).toBeGreaterThan(0)
    for (const q of offerQueries) expect(q.constraints?.some((c) => c.field === "contractorOrgId" && c.value === ORG)).toBe(true)
    view.unmount()
  })
})

describe("the filter bar", () => {
  it("carries search, delivery site, category, who it reaches and sort, each option with its count", async () => {
    const view = await open()
    await click(chip("الكل"))
    expect(document.querySelector('input[aria-label="ابحث برقم الطلب أو المادة…"]')).not.toBeNull()
    const sites = Array.from(select("كل مواقع التسليم").options).map((o) => o.textContent)
    expect(sites).toEqual(["كل مواقع التسليم", "برج العليا · 1", "فيلا الملقا · 5"])
    expect(Array.from(select("عام · خاص · مباشر").options).map((o) => o.textContent)).toEqual(["عام · خاص · مباشر", "عام · 5", "خاص · 0", "إسناد مباشر · 1"])
    expect(Array.from(select("الترتيب").options).map((o) => o.textContent)).toEqual(["الأقرب إغلاقاً", "الأحدث نشراً", "الأكثر عروضاً"])
    expect(text()).toContain("6 من 6 طلباً")
    view.unmount()
  })

  it("narrows by site and by who it reaches, moves the chips' counts, and the picked option keeps its number", async () => {
    const view = await open()
    await click(chip("الكل"))
    await act(async () => void fireEvent.change(select("كل مواقع التسليم"), { target: { value: "site-2" } }))
    expect(titles()).toEqual(["زوايا حديد — برج العليا"])
    expect(chip("الكل")?.textContent).toBe("الكل1")
    expect(chip("رُسّيت")?.textContent).toBe("رُسّيت0")
    expect(text()).toContain("1 من 6 طلباً")
    await act(async () => void fireEvent.change(select("كل مواقع التسليم"), { target: { value: "" } }))
    await act(async () => void fireEvent.change(select("عام · خاص · مباشر"), { target: { value: "direct" } }))
    expect(titles()).toEqual(["خرسانة جاهزة — إسناد مباشر"])
    view.unmount()
  })

  it("«الأكثر عروضاً» puts the RFQ with the most offers first", async () => {
    const view = await open()
    await click(chip("الكل"))
    await act(async () => void fireEvent.change(select("الترتيب"), { target: { value: "offers" } }))
    expect(titles()[0]).toBe("بلك وأسمنت — فيلا الملقا")
    view.unmount()
  })

  it("a search looks in every status — by number, by name, by supplier — and clears with its button", async () => {
    const view = await open()
    expect(titles()).toEqual(["بلك وأسمنت — فيلا الملقا"])
    const input = document.querySelector('input[aria-label="ابحث برقم الطلب أو المادة…"]') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { value: "RFQ-2026/011" } }))
    expect(titles()).toEqual(["زوايا حديد — برج العليا"])
    expect(chip("مفتوحة")?.getAttribute("aria-selected")).toBe("false")
    await act(async () => void fireEvent.change(input, { target: { value: "النخبة" } }))
    expect(titles()).toEqual(["زوايا حديد — برج العليا"])
    await act(async () => void fireEvent.change(input, { target: { value: "رمل" } }))
    expect(titles()).toEqual(["رمل لياسة"])
    await click(button("امسح البحث"))
    expect(titles()).toEqual(["بلك وأسمنت — فيلا الملقا"])
    view.unmount()
  })

  it("starts from ?search= and finds what it names", async () => {
    const view = await open("search=%D8%A3%D8%A8%D9%88%D8%A7%D8%A8")
    expect(titles()).toEqual(["أبواب معدنية"])
    view.unmount()
  })
})

describe("empty states", () => {
  it("no RFQ matches the filters → «لا طلبات تطابق الفلاتر» and a way to clear them", async () => {
    const view = await open()
    const input = document.querySelector('input[aria-label="ابحث برقم الطلب أو المادة…"]') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { value: "لا شيء بهذا الاسم" } }))
    expect(text()).toContain("لا طلبات تطابق الفلاتر")
    await click(button("امسح الفلاتر"))
    expect(titles()).toEqual(["بلك وأسمنت — فيلا الملقا"])
    view.unmount()
  })

  it("an empty chip says so and offers «اعرض الكل»", async () => {
    resetFakeDb()
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
    for (const id of ["A", "B", "C"]) seed(`rfqs/${id}`, rfqDoc({ title: `أُرسي ${id}`, status: "Awarded", deadline: addDay(-9) }))
    const view = await open()
    expect(pressed()[0]).toMatch(/^الكل/)
    await click(chip("مفتوحة"))
    expect(text()).toContain("لا طلبات مفتوحة الآن")
    await click(button("اعرض الكل"))
    expect(titles()).toHaveLength(3)
    view.unmount()
  })

  it("a company with no RFQ yet is told how to start one", async () => {
    resetFakeDb()
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
    const view = await open()
    expect(text()).toContain("لا طلبات هنا")
    expect(text()).toContain("طلب عروض جديد")
    expect(document.querySelector("select")).toBeNull()
    view.unmount()
  })
})

describe("tiles or rows", () => {
  it("rows are a table with the prototype's columns, and the choice is remembered", async () => {
    let view = await open()
    expect(document.querySelector("table")).toBeNull()
    await click(button("صفوف"))
    expect(storage[LAYOUT_KEY]).toBe("rows")
    const heads = Array.from(document.querySelectorAll("th")).map((h) => (h.textContent ?? "").trim())
    expect(heads).toEqual(expect.arrayContaining(["الطلب", "المواد والموقع", "يصله", "العروض", "الإغلاق", "الحالة"]))
    const row = document.querySelector("tbody tr") as HTMLElement
    expect(row.textContent).toContain("RFQ-2026/003")
    expect(row.textContent).toContain("3 عروض")
    expect(row.textContent).toContain("أقل عرض كامل")
    expect(row.querySelector("[data-action='compare']")).not.toBeNull()
    view.unmount()
    view = await open()
    expect(document.querySelector("table")).not.toBeNull()
    expect(cards()).toHaveLength(0)
    await click(button("مربعات"))
    expect(storage[LAYOUT_KEY]).toBe("cards")
    view.unmount()
  })

  it("a blocked storage never breaks the page", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked")
        },
        setItem: () => {
          throw new Error("blocked")
        },
      },
    })
    const view = await open()
    expect(cards()).toHaveLength(1)
    await click(button("صفوف"))
    expect(document.querySelector("table")).not.toBeNull()
    view.unmount()
  })

  it("on a phone the rows become cards and nothing needs a sideways scroll", async () => {
    window.innerWidth = 375
    storage[LAYOUT_KEY] = "rows"
    const view = await open()
    expect(document.querySelector("table")).toBeNull()
    expect(document.querySelectorAll("li").length).toBeGreaterThan(0)
    const html = document.body.innerHTML
    expect(html).not.toMatch(/min-w-\[(?:[6-9]\d\d|\d{4,})px\]/)
    expect(document.querySelector("table")).toBeNull()
    view.unmount()
  })
})

describe("hundreds of RFQs", () => {
  const many = (n: number) => {
    resetFakeDb()
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
    for (let i = 0; i < n; i++) seed(`rfqs/B${i}`, rfqDoc({ title: `طلب ${i}`, rfqNumber: `RFQ-2026/${String(i).padStart(3, "0")}`, deadline: addDay(1 + (i % 9)), offersCount: i % 4, createdAt: `${addDay(-(i % 30))}T08:00:00.000Z` }))
  }

  it("shows 24, then «عرض 24 أخرى» — and the count line says how many match", async () => {
    many(300)
    const view = await open()
    expect(cards()).toHaveLength(24)
    expect(button("عرض 24 أخرى")).toBeDefined()
    expect(text()).toContain("300 من 300 طلباً")
    await click(button("عرض 24 أخرى"))
    expect(cards()).toHaveLength(48)
    view.unmount()
  })

  it("the last button says how many are left, and goes away with them", async () => {
    many(30)
    const view = await open()
    expect(cards()).toHaveLength(24)
    await click(button("عرض 6 أخرى"))
    expect(cards()).toHaveLength(30)
    expect(Array.from(document.querySelectorAll("button")).some((b) => /^عرض \d+ أخرى$/.test((b.textContent ?? "").trim()))).toBe(false)
    view.unmount()
  })

  it("a filter starts the paging over", async () => {
    many(60)
    const view = await open()
    await click(button("عرض 24 أخرى"))
    expect(cards()).toHaveLength(48)
    const input = document.querySelector('input[aria-label="ابحث برقم الطلب أو المادة…"]') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { value: "طلب" } }))
    expect(cards()).toHaveLength(24)
    view.unmount()
  })
})

describe("English", () => {
  it("speaks the prototype's English, every key resolved", async () => {
    setLocale("en")
    const view = await open()
    expect([...missingKeys]).toEqual([])
    const labels = Array.from(document.querySelectorAll("[role='tab']")).map((b) => (b.textContent ?? "").trim())
    expect(labels).toEqual(expect.arrayContaining(["Open1", "Comparing2", "Awarded2", "Cancelled1", "All6", "Drafts1"]))
    const t = cards()[0].textContent ?? ""
    expect(t).toContain("Public · 10 suppliers")
    expect(t).toContain("3 offers so far")
    expect(t).toContain("Lowest complete offer")
    expect(t).toContain("incl. VAT")
    expect(t).toContain("Compare and award")
    expect(t).toContain("1 unanswered inquiry")
    expect(within(document.body).getByLabelText("Sort")).toBeTruthy()
    expect(Array.from(select("Sort").options).map((o) => o.textContent)).toEqual(["Closing soonest", "Newest", "Most offers"])
    expect(text()).toContain("1 of 6 RFQs")
    expect(text()).not.toMatch(/MISSING|undefined|NaN|\{[A-Za-z_]+\}/)
    setLocale("ar")
    view.unmount()
  })
})

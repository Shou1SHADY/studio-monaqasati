/**
 * Procurement 2.0 — the RFQ page rendered for real over the in-memory Firestore (WP-S3-04/05/08, RFQ-01…12, G-03, G-06, NFR-03):
 * the three-segment path, the numbers row whose «أقل عرض كامل» is the same figure as the best-of card and row #1, a list of
 * eleven offers with filters and sort, the offer panel and its acts going through the server routes (never a write to the offer),
 * the off-platform supplier's panel, and the Inquiries tab with its red counter and the two ways to answer.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const { useMemo } = jest.requireActual("react")
  const base = jest.requireActual("@/test-utils/render-world").firebaseMock
  return {
    ...base,
    useUser: () => {
      const r = base.useUser()
      const user = useMemo(() => (r.user ? { ...r.user, getIdToken: async () => "tok" } : null), [r.user])
      return { ...r, user }
    },
  }
})
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => "tok" } }) }))
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"
import { RfqOfferList } from "@/components/procurement/rfq/RfqOfferList"
import { buildOfferRows, type RowOffer } from "@/lib/procurement/rfq-offers-view"
import { riyadhDay } from "@/lib/hr/format"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const TODAY = riyadhDay()
const addDay = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const calls: Array<{ url: string; body: Record<string, unknown> | null }> = []

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ url: String(url), body })
    if (String(url).includes("offers/decide")) return { ok: true, json: async () => ({ success: true, data: { action: body?.action, offerId: body?.offerId, rfqId: "R1", guest: false, decision: { shortlist: null, exclusion: null } } }) }
    if (String(url).includes("rfq/inquiry")) return { ok: true, json: async () => ({ success: true, data: { action: body?.action, rfqId: "R1", id: body?.inquiryId || "n1", scope: body?.scope || "all", told: 4 } }) }
    return { ok: true, json: async () => ({ success: true, data: {} }) }
  })
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]
const rowEls = () => Array.from(document.querySelectorAll("[role=row][data-offer]")) as HTMLElement[]
const click = async (el: Element | undefined) => {
  expect(el).toBeDefined()
  await act(async () => void fireEvent.click(el as Element))
  await flush()
}
const figure = (s: string) => /[\d,]+(\.\d+)?/.exec(s.replace(/[٠-٩]/g, ""))?.[0] ?? ""

const offerDoc = (id: string, name: string, lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
  rfqId: "R1",
  contractorOrgId: ORG,
  organizationId: id,
  supplierId: id,
  companyName: name,
  status: "قيد المراجعة",
  vatRegistered: true,
  leadDays: 5,
  validUntil: addDay(30),
  createdAt: `${addDay(-1)}T08:00:00.000Z`,
  offerPdfUrl: "https://x/q.pdf",
  creditDays: 30,
  advancePercent: 0,
  price: "0",
  lines,
  ...over,
})

function world() {
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG })
  seed("rfqs/R1", {
    organizationId: ORG,
    contractorId: ORG,
    createdByUserId: ORG,
    createdByUserName: "المالك",
    rfqNumber: "RFQ-2026/011",
    title: "زوايا حديد وخشب ألواح",
    status: "New",
    visibility: "public",
    category: "Construction Materials",
    city: "الرياض",
    pricingMode: "line",
    deadline: addDay(4),
    createdAt: `${addDay(-5)}T08:00:00.000Z`,
    offersCount: 11,
    reachedCount: 10,
    viewsCount: 19,
    paymentTermsList: [{ pct: 100, days: 30 }],
    products: [
      { name: "زوايا حديد 50×50×5 مم", quantity: 175, unitOfMeasure: "م" },
      { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
    ],
  })
  seed("procIncoming/own__pm:P1:04", {
    organizationId: ORG,
    mrKey: "pm:P1:04",
    src: "pm",
    no: "MR 04",
    needBy: addDay(12),
    createdAt: `${addDay(-6)}T08:00:00.000Z`,
    requestedBy: { id: "u", name: "سالم" },
    requestedFor: { kind: "member", name: "سالم القحطاني" },
    lines: [{ no: 1, name: "زوايا", unit: "م", qty: 175, rfqId: "R1", v: 1 }],
    st: "rfq",
    status: "open",
    requesterIds: [],
    log: [],
  })
  const two = (a: number, b: number, extra: Record<string, unknown> = {}) => [{ rfqProductIndex: 0, unitPrice: a, ...extra }, { rfqProductIndex: 1, unitPrice: b }]
  seed("offers/quality", offerDoc("quality", "مصنع الجودة", two(12.5, 3.6), { leadDays: 7 }))
  seed("offers/east", offerDoc("east", "الشرق", two(146, 3.8, { packLen: 12 }), { leadDays: 4 }))
  seed("offers/mid", offerDoc("mid", "الوسطى", two(74, 3.9, { packLen: 6 }), { creditDays: 60 }))
  seed("offers/horizon", offerDoc("horizon", "الأفق", two(12.9, 3.7), { leadDays: 3 }))
  seed("offers/hope", offerDoc("hope", "الأمل", [{ rfqProductIndex: 0, unitPrice: 80, packLen: 6 }, { rfqProductIndex: 1, unitPrice: 13.5, packLen: 4 }], { isGuestOffer: true, supplierId: "guest", organizationId: "guest", guestContact: { name: "سعد", phone: "0551112222" } }))
  seed("offers/modern", offerDoc("modern", "البناء الحديث", [{ rfqProductIndex: 1, unitPrice: 14.2, packLen: 4 }], { skippedItems: [0] }))
  for (let i = 1; i <= 5; i++) seed(`offers/extra${i}`, offerDoc(`extra${i}`, `مورد إضافي ${i}`, two(13 + i, 4 + i / 10), { leadDays: 6 + i }))
  seed("offerDecisions/horizon", { offerId: "horizon", rfqId: "R1", organizationId: ORG, shortlist: { at: "x", byId: "u", byName: "نورة" }, exclusion: null, log: [], updatedAt: "x" })
  seed("rfqs/R1/inquiries/q1", { kind: "ask", question: "هل التسليم شامل التنزيل؟", from: { orgId: null, anon: true }, via: "link", answer: null, reply: null, createdAt: `${addDay(-2)}T09:00:00.000Z`, li: 0 })
  seed("rfqs/R1/inquiries/q2", { kind: "ask", question: "ما مدة الضمان؟", supplierName: "الشرق", organizationId: "east", from: { orgId: "east", anon: false }, via: "portal", answer: { text: "سنتان", all: true, at: `${addDay(-1)}T09:00:00.000Z`, byId: ORG, byName: "المالك" }, reply: "سنتان", sentToAll: true, createdAt: `${addDay(-3)}T09:00:00.000Z` })
}

beforeEach(() => {
  resetFakeDb()
  calls.length = 0
  world()
  setSignedIn(ORG)
  missingKeys.clear()
})

async function open(search = "") {
  setPathname("/contractor/rfqs/R1/offers", search)
  const view = render(<RfqOffersView rfqId="R1" />)
  await flush()
  return view
}

describe("the head of the page (RFQ-01, RFQ-02, G-03)", () => {
  it("names the path in three role-coloured segments with the request, its source, its owner and the need date", async () => {
    const view = await open()
    for (const s of ["الطلب — الأساس", "المشتريات", "التوريد والاستلام", "ط.م 04", "إدارة المشاريع", "سالم القحطاني", "الترسية", "أوامر الشراء", "الاستلام"]) expect(text()).toContain(s)
    const sections = Array.from(document.querySelectorAll("nav section"))
    expect(sections).toHaveLength(3)
    expect(sections[0].className).toContain("role-requester")
    expect(sections[1].className).toContain("role-buyer")
    expect(sections[2].className).toContain("role-receiver")
    expect(text()).toContain("زوايا حديد وخشب ألواح")
    expect(text()).toContain("مفتوح")
    expect(text()).not.toContain("إجمالي العروض")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("the numbers row: reached, viewed, offers with the off-platform one, the lowest complete offer, the unanswered question that opens the tab", async () => {
    const view = await open()
    const row = document.querySelector("[data-testid=rfq-numbers]")?.textContent ?? ""
    expect(row).toContain("وصل إلى 10 مورّد")
    expect(row).toContain("اطّلع عليه 19 مرة")
    expect(row).toContain("11 عرض")
    expect(row).toContain("منها 1 من خارج المنصة")
    expect(row).toContain("استفسار بلا جواب")
    await click(buttons().find((b) => (b.textContent || "").includes("استفسار بلا جواب")))
    expect(text()).toContain("هل التسليم شامل التنزيل؟")
    view.unmount()
  })

  it("«أقل عرض كامل» is ONE figure: the numbers row, the best-of card and the first row say 3,840.43", async () => {
    const view = await open()
    const fromRow = figure(document.querySelector("[data-testid=rfq-numbers]")?.textContent?.split("أقل عرض كامل")[1] ?? "")
    const fromCard = figure(document.querySelector("[data-testid=rfq-best-cards] section")?.textContent ?? "")
    const first = rowEls()[0]
    expect(first.getAttribute("data-offer")).toBe("quality")
    const fromRowOne = figure(first.textContent?.split("مصنع الجودة")[1] ?? "")
    expect([fromRow, fromCard, fromRowOne]).toEqual(["3,840.43", "3,840.43", "3,840.43"])
    view.unmount()
  })

  it("the tabs carry the offers' count and a RED count of the unanswered questions", async () => {
    const view = await open()
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    expect(tabs.map((t) => (t.textContent || "").replace(/\d+$/, ""))).toEqual(["العروض", "المقارنة", "الاستفسارات", "التفاصيل"])
    expect(tabs[0].textContent).toContain("11")
    const badge = tabs[2].querySelector("span")
    expect(badge?.textContent).toBe("1")
    expect(badge?.className).toContain("bg-destructive")
    view.unmount()
  })
})

describe("the offers tab (RFQ-04, RFQ-05, RFQ-06)", () => {
  it("shows the four best-of cards, a row per offer with its total including VAT, and the old hero is gone", async () => {
    const view = await open()
    const cards = document.querySelector("[data-testid=rfq-best-cards]")?.textContent ?? ""
    for (const s of ["أقل عرض كامل", "الأسرع توريداً", "لو قسّمت الترسية", "اختر الأقل لكل بند", "شامل الضريبة · كل المواد"]) expect(cards).toContain(s)
    expect(rowEls()).toHaveLength(11)
    expect(rowEls().every((r) => r.querySelectorAll("button").length <= 4)).toBe(true)
    expect(text()).toContain("شامل الضريبة")
    expect(text()).toContain("القائمة القصيرة")
    expect(text()).toContain("سعّر 1 فقط")
    expect(text()).toContain("من خارج المنصة · رابط الزوار")
    expect(text()).toContain("بالقطعة")
    expect(text()).toContain("يخالف شروطك")
    expect(text()).not.toContain("ترسية وإرسال للمالية")
    expect(text()).not.toContain("السعر مغلق")
    view.unmount()
  })

  it("filters with counts: «من خارج المنصة» leaves the visitor, «القائمة القصيرة» the ★ one; sort changes the order", async () => {
    const view = await open()
    const chip = (label: string) => buttons().find((b) => (b.textContent || "").startsWith(label) && b.getAttribute("aria-pressed") !== null)
    expect(chip("الكل")?.textContent).toContain("11")
    expect(chip("جزئية")?.textContent).toContain("1")
    await click(chip("من خارج المنصة"))
    expect(rowEls().map((r) => r.getAttribute("data-offer"))).toEqual(["hope"])
    await click(chip("القائمة القصيرة"))
    expect(rowEls().map((r) => r.getAttribute("data-offer"))).toEqual(["horizon"])
    await click(chip("الكل"))
    const select = document.querySelector("select") as HTMLSelectElement
    await act(async () => void fireEvent.change(select, { target: { value: "fastest" } }))
    expect(rowEls()[0].getAttribute("data-offer")).toBe("horizon")
    view.unmount()
  })
})

describe("the offer panel and the server-side acts (RFQ-07, RFQ-09…12, G-15)", () => {
  const openPanel = async (id: string) => {
    const row = rowEls().find((r) => r.getAttribute("data-offer") === id) as HTMLElement
    await click(Array.from(row.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "التفاصيل"))
  }

  it("opens with the totals, the prices line by line with the pack line and the effective price, the terms and «ما جرى»", async () => {
    const view = await open()
    await openPanel("east")
    for (const s of ["الإجمالي شامل الضريبة", "الأسعار", "الشروط", "ما جرى", "قدّم عرضه", "رسِّ الطلب كله عليه", "اطلب سعراً أفضل", "اطلب توضيحاً", "استبعد", "القائمة القصيرة"]) expect(text()).toContain(s)
    expect(text()).toContain("15 قطعة × 12 م — تستلم 180 م (5 زيادة)")
    expect(text()).toContain("للوحدة المستلمة")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("★ goes to the decide route and writes nothing to the offer from the browser", async () => {
    const view = await open()
    await openPanel("east")
    const star = buttons().find((b) => (b.textContent || "").trim() === "القائمة القصيرة" && b.getAttribute("aria-pressed") === "false")
    await click(star)
    expect(calls.find((c) => c.url.includes("offers/decide"))?.body).toEqual({ action: "shortlist", offerId: "east" })
    view.unmount()
  })

  it("«استبعد» needs a reason: «سبب آخر» keeps the button shut until the reason has four characters, then posts it", async () => {
    const view = await open()
    await openPanel("quality")
    await click(buttons().find((b) => (b.textContent || "").trim() === "استبعد"))
    const submit = () => buttons().filter((b) => (b.textContent || "").trim() === "استبعد").at(-1) as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    await click(document.querySelector('input[value="other"]') as Element)
    expect(submit().disabled).toBe(true)
    const area = document.querySelector("#exclusion-text") as HTMLTextAreaElement
    await act(async () => void fireEvent.change(area, { target: { value: "ab" } }))
    expect(submit().disabled).toBe(true)
    await act(async () => void fireEvent.change(area, { target: { value: "السعر خارج الميزانية" } }))
    expect(submit().disabled).toBe(false)
    await click(submit())
    expect(calls.find((c) => c.url.includes("offers/decide"))?.body).toEqual({ action: "exclude", offerId: "quality", code: "other", text: "السعر خارج الميزانية" })
    view.unmount()
  })

  it("«اطلب سعراً أفضل»: one round, a reply-by day and a note — and says no other supplier's price or name is shown", async () => {
    const view = await open()
    await openPanel("mid")
    await click(buttons().find((b) => (b.textContent || "").trim() === "اطلب سعراً أفضل"))
    expect(text()).toContain("جولة واحدة لكل عرض")
    expect(text()).toContain("لا تُذكر له أسعار غيره ولا أسماؤهم.")
    await click(buttons().find((b) => (b.textContent || "").trim() === "أرسل الطلب"))
    const body = calls.find((c) => c.url.includes("offers/decide"))?.body as Record<string, unknown>
    expect(body).toMatchObject({ action: "bafo", offerId: "mid" })
    expect(String(body.replyBy)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(JSON.stringify(body)).not.toMatch(/quality|east|horizon|الجودة/)
    view.unmount()
  })

  it("an expired offer cannot be awarded: the panel offers «اطلب تأكيد السعر» and no «رسِّ…»", async () => {
    seed("offers/east", offerDoc("east", "الشرق", [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }, { rfqProductIndex: 1, unitPrice: 3.8 }], { validUntil: addDay(-2) }))
    const view = await open()
    await openPanel("east")
    expect(text()).toContain("انتهت صلاحية هذا العرض")
    expect(buttons().some((b) => (b.textContent || "").trim() === "اطلب تأكيد السعر")).toBe(true)
    expect(buttons().some((b) => (b.textContent || "").trim() === "رسِّ الطلب كله عليه")).toBe(false)
    await click(buttons().find((b) => (b.textContent || "").trim() === "اطلب تأكيد السعر"))
    await click(buttons().filter((b) => (b.textContent || "").trim() === "أرسل الطلب").at(-1))
    expect(calls.find((c) => c.url.includes("offers/decide"))?.body).toMatchObject({ action: "confirm-price", offerId: "east" })
    view.unmount()
  })

  it("an excluded offer shows its reason and «أعِده»", async () => {
    seed("offerDecisions/mid", { offerId: "mid", rfqId: "R1", organizationId: ORG, shortlist: null, exclusion: { code: "warranty", text: null, at: "x", byId: "u", byName: "نورة" }, log: [{ kind: "exclude", at: `${addDay(-1)}T10:00:00.000Z`, byId: "u", byName: "نورة", meta: { code: "warranty" } }], updatedAt: "x" })
    const view = await open()
    expect(text()).toContain("استُبعد: الضمان أقل من المطلوب")
    await openPanel("mid")
    expect(text()).toContain("استُبعد: الضمان أقل من المطلوب · نورة")
    await click(buttons().find((b) => (b.textContent || "").trim() === "أعِده"))
    expect(calls.find((c) => c.url.includes("offers/decide"))?.body).toEqual({ action: "restore", offerId: "mid" })
    view.unmount()
  })
})

describe("the off-platform supplier (RFQ-08)", () => {
  it("shows only what he typed, «لم يُتحقق منه», «جديد علينا», and the three ways to reach him — none of it blocks the award", async () => {
    const view = await open()
    const row = rowEls().find((r) => r.getAttribute("data-offer") === "hope") as HTMLElement
    await click(Array.from(row.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "التفاصيل"))
    const box = document.querySelector("[data-testid=off-platform-box]")?.textContent ?? ""
    for (const s of ["مورّد من خارج المنصة", "0551112222", "سعد", "لم يُتحقق منه", "لم يذكره", "جديد علينا: لا تقييم ولا سجل توريد بعد", "ولا يمنع هذا الترسية", "واتساب", "ادعُه إلى المنصة"]) expect(box).toContain(s)
    expect(box).not.toContain("يلزم تسجيله قبل الترسية")
    expect(buttons().some((b) => (b.textContent || "").trim() === "رسِّ الطلب كله عليه")).toBe(true)
    view.unmount()
  })
})

describe("the Inquiries tab (QA-01…04, G-06)", () => {
  it("shades the unanswered question, names its source — «زائر من الرابط — بلا اسم» — and the material; the answered one reads «أُجيب للجميع»", async () => {
    const view = await open("tab=inquiries")
    const q1 = document.querySelector("[data-inquiry=q1]") as HTMLElement
    const q2 = document.querySelector("[data-inquiry=q2]") as HTMLElement
    expect(q1.getAttribute("data-state")).toBe("waiting")
    expect(q1.className).toContain("bg-warning")
    expect(q1.textContent).toContain("زائر من الرابط — بلا اسم")
    expect(q1.textContent).toContain("رابط الزوار")
    expect(q1.textContent).toContain("عن زوايا حديد 50×50×5 مم")
    expect(q2.textContent).toContain("أُجيب للجميع")
    expect(q2.textContent).toContain("سنتان")
    expect(Array.from(document.querySelectorAll("[data-inquiry]")).map((e) => e.getAttribute("data-inquiry"))).toEqual(["q1", "q2"])
    view.unmount()
  })

  it("a nameless question can only be answered «للجميع»; a named one also «للسائل فقط»", async () => {
    seed("rfqs/R1/inquiries/q3", { kind: "ask", question: "هل الدفع آجل؟", supplierName: "الوسطى", organizationId: "mid", from: { orgId: "mid", anon: false }, via: "portal", answer: null, reply: null, createdAt: `${addDay(-1)}T09:00:00.000Z` })
    const view = await open("tab=inquiries")
    const q1 = document.querySelector("[data-inquiry=q1]") as HTMLElement
    const q3 = document.querySelector("[data-inquiry=q3]") as HTMLElement
    const labels = (el: HTMLElement) => Array.from(el.querySelectorAll("button")).map((b) => (b.textContent || "").trim())
    expect(labels(q1)).toContain("أجب للجميع")
    expect(labels(q1)).not.toContain("للسائل فقط")
    expect(q1.textContent).toContain("السائل بلا اسم: يُجاب للجميع فقط.")
    expect(labels(q3)).toEqual(expect.arrayContaining(["أجب للجميع", "للسائل فقط"]))
    view.unmount()
  })

  it("answers go to the inquiry route with their scope — and the clarification to everyone is a note", async () => {
    seed("rfqs/R1/inquiries/q3", { kind: "ask", question: "هل الدفع آجل؟", supplierName: "الوسطى", organizationId: "mid", from: { orgId: "mid", anon: false }, via: "portal", answer: null, reply: null, createdAt: `${addDay(-1)}T09:00:00.000Z` })
    const view = await open("tab=inquiries")
    const q3 = document.querySelector("[data-inquiry=q3]") as HTMLElement
    await act(async () => void fireEvent.change(q3.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "آجل 30 يوماً" } }))
    await click(Array.from(q3.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "للسائل فقط"))
    expect(calls.find((c) => c.url.includes("rfq/inquiry"))?.body).toEqual({ action: "answer", rfqId: "R1", inquiryId: "q3", text: "آجل 30 يوماً", scope: "asker" })

    await click(buttons().find((b) => (b.textContent || "").trim() === "أرسل توضيحاً لكل المدعوّين"))
    await act(async () => void fireEvent.change(document.querySelector('textarea[aria-label="أرسل توضيحاً لكل المدعوّين"]') as HTMLTextAreaElement, { target: { value: "التسليم بعد الظهر" } }))
    await click(buttons().find((b) => (b.textContent || "").trim() === "أرسل للجميع"))
    expect(calls.filter((c) => c.url.includes("rfq/inquiry")).at(-1)?.body).toEqual({ action: "note", rfqId: "R1", text: "التسليم بعد الظهر" })
    view.unmount()
  })

  it("«يغيّر النطاق؟ مدّد الموعد» tells the lifecycle bar to open its extend dialog", async () => {
    const heard: string[] = []
    const on = (e: Event) => heard.push((e as CustomEvent).detail.rfqId)
    window.addEventListener("proc:rfq:extend", on)
    const view = await open("tab=inquiries")
    await click(buttons().find((b) => (b.textContent || "").trim() === "يغيّر النطاق؟ مدّد الموعد"))
    expect(heard).toEqual(["R1"])
    window.removeEventListener("proc:rfq:extend", on)
    view.unmount()
  })
})

describe("a list that holds dozens (NFR-03)", () => {
  it("fifty offers build their rows in well under a second and show thirty at a time", async () => {
    const rfq = { pricingMode: "line", products: [{ name: "a", quantity: 10, unitOfMeasure: "م" }, { name: "b", quantity: 20, unitOfMeasure: "م" }] }
    const offers = Array.from({ length: 50 }, (_, i) => ({ id: `o${i}`, companyName: `مورد ${i}`, supplierId: `s${i}`, organizationId: `s${i}`, status: "قيد المراجعة", vatRegistered: true, leadDays: 3 + (i % 9), createdAt: `${addDay(-1)}T08:00:00.000Z`, lines: [{ rfqProductIndex: 0, unitPrice: 10 + i / 10 }, { rfqProductIndex: 1, unitPrice: 5 + i / 7 }] })) as RowOffer[]
    const t0 = performance.now()
    const { rows } = buildOfferRows({ rfq, offers, decisions: {}, today: TODAY })
    const built = performance.now() - t0
    expect(rows).toHaveLength(50)
    expect(built).toBeLessThan(500)
    resetFakeDb()
    setSignedIn(ORG)
    const t1 = performance.now()
    const view = render(<RfqOfferList rows={rows} rfq={rfq as never} today={TODAY} showPrices canShortlist canAsk fallbackName="؟" hasRecord={() => true} onOpen={() => {}} onToggleShortlist={() => {}} onClarify={() => {}} />)
    await flush()
    expect(performance.now() - t1).toBeLessThan(5000)
    expect(rowEls()).toHaveLength(30)
    expect(text()).toContain("يظهر 30 من 50")
    await click(buttons().find((b) => (b.textContent || "").trim() === "اعرض المزيد"))
    expect(rowEls()).toHaveLength(50)
    view.unmount()
  })
})

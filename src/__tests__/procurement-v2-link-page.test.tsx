/**
 * Procurement 2.0 — the visitor's page over the real message files (LNK-01…11, G-07): one header line, one trust sentence, the
 * registration card, a row per material with the sale-unit chips and the live total, the warranty row, four starred fields and
 * the rest folded, a code before the first send, the short sent page, an edit as the next version, the closed page with HIS
 * result, and a preview in which nothing can be done.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { installDomShims, missingKeys, setLocale } from "@/test-utils/render-world"
import { LinkPage } from "@/components/procurement/guest/LinkPage"
import { makeLinkApi } from "@/components/procurement/guest/link-api"
import type { LinkData, LinkMe } from "@/components/procurement/guest/link-types"

installDomShims()
jest.setTimeout(60_000)

const text = () => document.body.textContent ?? ""
const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

const lines: LinkData["rfq"]["lines"] = [
  { index: 0, name: "زوايا حديد", specs: "50×50×5", qty: 175, unit: "م", saleUnits: [{ lengthM: 6, ar: "قطعة 6 م", en: "piece 6 m" }, { lengthM: 12, ar: "قطعة 12 م", en: "piece 12 m" }], warrantyMonths: 24, needBy: "2026-11-01", place: null },
  { index: 1, name: "خشب ألواح", specs: "", qty: 320, unit: "م", saleUnits: [], warrantyMonths: null, needBy: null, place: null },
]
const data = (over: Partial<LinkData["rfq"]> = {}, canSubmit = true): LinkData => ({
  rfq: {
    id: "R1",
    number: "RFQ-2026/012",
    title: "زوايا حديد و خشب ألواح",
    places: [{ city: "الرياض", district: "السلي" }],
    closeDay: "2099-12-31",
    closeAt: "2099-12-31T20:59:59.999Z",
    closedAt: null,
    closedEarly: false,
    needBy: "2026-11-01",
    termsList: [{ pct: 100, days: 30 }],
    paymentTerms: null,
    delivery: { unload: "us", slot: "am" },
    accessNote: "البوابة 3 — اتصل بالمشرف",
    notes: null,
    attachments: [],
    lines,
    pricing: "line",
    lump: false,
    state: "open",
    cancelCode: null,
    ...over,
  },
  contractorName: "شركة الأمل",
  canSubmit,
  codeAvailable: true,
  queries: [{ question: "هل التنزيل عليكم؟", answer: "نعم، علينا", answeredAt: "2026-10-05" }, { question: "", answer: "الموقع يفتح السابعة", answeredAt: "2026-10-06", clarification: true }],
})

const me = (over: Partial<NonNullable<LinkMe["offer"]>> = {}, extra: Partial<LinkMe> = {}): LinkMe => ({
  offer: { id: "O1", n: 1, companyName: "الأفق", total: 3372, gross: 3877.8, vatRegistered: true, whole: false, validUntil: "2100-01-14", leadDays: 5, lines: [{ rfqProductIndex: 0, unitPrice: 74, packLen: 6, warrantyMonths: 24 }, { rfqProductIndex: 1, unitPrice: 3.6 }], skipped: [], note: "", contactName: "", email: "", vatNumber: "", advancePercent: null, creditDays: null, sentAt: "2026-10-13", verified: true, ...over },
  result: { kind: "open" },
  tasks: { bafo: null, questions: [] },
  ...extra,
})

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }
let calls: Call[]
let meState: LinkMe | null

beforeEach(() => {
  setLocale("ar")
  missingKeys.clear()
  calls = []
  meState = null
  window.localStorage.clear()
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method || "GET", headers: (init?.headers as Record<string, string>) || {}, body: init?.body })
    const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data: d }) })
    if (url.endsWith("/code")) return ok({ challengeId: "ch1", phoneMasked: "+9665****", testCode: "123456" })
    if (url.endsWith("/verify")) return ok({ session: { secret: "a".repeat(64), expiresAt: "2099-01-01T00:00:00.000Z" }, phoneMasked: "+9665****" })
    if (url.endsWith("/offer")) {
      meState = me({ n: calls.filter((c) => c.url.endsWith("/offer")).length })
      return ok({ offerId: "O1", n: 1, created: true, total: 3372, gross: 3877.8 })
    }
    if (url.endsWith("/me")) return ok(meState ?? { offer: null, result: null, tasks: { bafo: null, questions: [] } })
    if (url.endsWith("/ask")) return ok({ id: "q", named: false })
    return ok({})
  }) as unknown as typeof fetch
})

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const priceOf = (index: number) => (document.querySelector(`[data-line="${index}"] input[inputmode="decimal"]`) as HTMLInputElement)

describe("the form (LNK-02…07)", () => {
  it("one header line, one trust sentence, the registration card, no map and no coordinates", () => {
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    expect(text()).toContain("طلب 2026/012")
    expect(text()).toContain("زوايا حديد و خشب ألواح")
    expect(text()).toContain("يُغلق")
    expect(text()).toContain("الرياض — السلي")
    expect(text()).toContain("مطلوبة قبل")
    expect(text()).toContain("التنزيل علينا · صباحاً")
    expect(text()).toContain("البوابة 3 — اتصل بالمشرف")
    expect(text()).toContain("بلا حساب ولا عمولة. عرضك يصل شركة الأمل وحده، ولا يراه أي مورّد آخر، وقد يُرسى الطلب قبل موعده.")
    expect(text()).toContain("سجّل في مدماك مجاناً، وكن أول من يقدّم العرض")
    expect(text()).toContain("سجّل مجاناً")
    expect(document.querySelector('a[href*="maps"]')).toBeNull()
    expect(missingKeys.size).toBe(0)
  })

  it("a row per material with the unit chips from its sale units, the warranty it asks, and «لا أورّدها»", () => {
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    expect(document.querySelectorAll("[data-line]")).toHaveLength(2)
    const first = document.querySelector('[data-line="0"]') as HTMLElement
    expect(first.textContent).toContain("لكل م")
    expect(first.textContent).toContain("لكل قطعة 6 م")
    expect(first.textContent).toContain("لكل قطعة 12 م")
    expect(first.textContent).toContain("يُطلب ضمان")
    expect(first.textContent).toContain("سنتين")
    expect(first.textContent).toContain("لا أورّدها")
    const second = document.querySelector('[data-line="1"]') as HTMLElement
    expect(second.textContent).not.toContain("يُطلب ضمان")
    expect(second.textContent).not.toContain("لكل قطعة")
  })

  it("the line total is live: «30 قطعة 6 م = 180 م» for 175 m at 74 a piece, then the total with VAT and the net", () => {
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    const first = document.querySelector('[data-line="0"]') as HTMLElement
    fireEvent.click(Array.from(first.querySelectorAll("button")).find((b) => b.textContent === "لكل قطعة 6 م") as HTMLElement)
    type(priceOf(0), "74")
    expect(first.querySelector("[data-line-total]")?.textContent).toMatch(/30 قطعة 6 م = 180/)
    expect(first.querySelector("[data-line-total]")?.textContent).toContain("2,220")
    type(priceOf(1), "3.6")
    expect(document.querySelector("[data-total]")?.textContent).toMatch(/3,877\.8/)
    expect(text()).toContain("قبل الضريبة")
    fireEvent.click(screen.getByText("منشأتي غير مسجّلة في ضريبة القيمة المضافة"))
    expect(document.querySelector("[data-total]")?.textContent).toMatch(/3,372/)
    expect(text()).toContain("بلا ضريبة")
  })

  it("four mandatory fields are starred; payment terms, the VAT and whole-request toggles are there; the extras stay folded until opened", () => {
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    const starred = Array.from(document.querySelectorAll('label[for^="lk-"]')).filter((l) => l.textContent?.includes("*")).map((l) => l.getAttribute("for"))
    expect(starred).toEqual(["lk-days", "lk-valid", "lk-company", "lk-mobile"])
    expect(text()).toContain("شروط الدفع")
    expect(text()).toContain("عرضي للطلب كاملاً فقط")
    expect(document.querySelector("[data-extras]")).toBeNull()
    expect(document.getElementById("lk-note")).toBeNull()
    fireEvent.click(screen.getByText(/إضافات اختيارية/))
    expect(document.querySelector("[data-extras]")).not.toBeNull()
    for (const id of ["lk-note", "lk-contact", "lk-email", "lk-vat"]) expect(document.getElementById(id)).not.toBeNull()
  })

  it("shows ONE reason at a time under the button, with how many more — and the button waits", () => {
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    expect(document.getElementById("lk-warn")?.textContent).toBe("سعّر مادة واحدة على الأقل · و3 غيرها")
    expect((document.getElementById("lk-send") as HTMLButtonElement).disabled).toBe(true)
    type(priceOf(1), "3.6")
    type(field("اسم المنشأة *"), "الأفق")
    expect(document.getElementById("lk-warn")?.textContent).toContain("مدة التوريد بالأيام من 1 إلى 365")
  })

  it("the answered questions are listed without names, a clarification under the buyer's name", () => {
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    expect(text()).toContain("هل التنزيل عليكم؟")
    expect(text()).toContain("نعم، علينا")
    expect(text()).toContain("توضيح من المشتري")
    expect(text()).toContain("2 — بلا أسماء")
  })

  it("is the same page in English, with every message present", () => {
    setLocale("en")
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    expect(text()).toContain("No account, no commission.")
    expect(text()).toContain("Price what you supply")
    expect(text()).toContain("Send your quote")
    expect(missingKeys.size).toBe(0)
  })
})

describe("a code before the first send, then the short sent page and an edit as the next version (LNK-09, LNK-10)", () => {
  async function fillAndSend() {
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    type(priceOf(1), "3.6")
    fireEvent.click(Array.from((document.querySelector('[data-line="0"]') as HTMLElement).querySelectorAll("button")).find((b) => b.textContent === "لكل قطعة 6 م") as HTMLElement)
    type(priceOf(0), "74")
    type(field("التوريد خلال (أيام) *"), "5")
    type(field("اسم المنشأة *"), "الأفق")
    type(field("الجوال *"), "0551234567")
    await flush()
    expect((document.getElementById("lk-send") as HTMLButtonElement).disabled).toBe(false)
    await act(async () => void fireEvent.click(document.getElementById("lk-send") as HTMLElement))
    await flush()
  }

  it("asks for the code first, spends nothing until it is entered, then sends with the session it bought", async () => {
    await fillAndSend()
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["code"])
    expect(text()).toContain("أرسلنا رمزاً إلى +9665****")
    expect(text()).toContain("بيئة الاختبار — الرمز: 123456")
    expect(calls.some((c) => c.url.endsWith("/offer"))).toBe(false)

    fireEvent.change(screen.getByLabelText(/أرسلنا رمزاً/), { target: { value: "123456" } })
    await act(async () => void fireEvent.click(screen.getByText("تحقّق وأرسل")))
    await flush()
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["code", "verify", "offer", "me"])
    const sent = calls.find((c) => c.url.endsWith("/offer")) as Call
    expect(sent.method).toBe("POST")
    expect(sent.headers["x-link-session"]).toBe("a".repeat(64))
    const body = sent.body as FormData
    expect(JSON.parse(body.get("lines") as string)).toEqual([{ rfqProductIndex: 0, unitPrice: 74, packLen: 6, warrantyMonths: 24 }, { rfqProductIndex: 1, unitPrice: 3.6 }])
    expect([body.get("executionDuration"), body.get("phone"), body.get("vatRegistered"), body.get("companyName")]).toEqual(["5", "+966551234567", "true", "الأفق"])
    expect(missingKeys.size).toBe(0)
  })

  it("then shows the short page: the total with VAT and its validity, «قد يُرسى» and the way back — not the form", async () => {
    await fillAndSend()
    fireEvent.change(screen.getByLabelText(/أرسلنا رمزاً/), { target: { value: "123456" } })
    await act(async () => void fireEvent.click(screen.getByText("تحقّق وأرسل")))
    await flush()
    expect(text()).toContain("وصل عرضك إلى شركة الأمل")
    expect(text()).toMatch(/3,877\.8 ر\.س شامل الضريبة · صالح حتى/)
    expect(text()).toContain("وقد يُرسي قبل")
    expect(text()).toContain("عدّل عرضك")
    expect(text()).toContain("سجّل في مدماك مجاناً")
    expect(document.getElementById("lk-send")).toBeNull()
  })

  it("«عدّل عرضك» opens the form filled with his quote, the company locked, and the next send is a PUT with no second code", async () => {
    await fillAndSend()
    fireEvent.change(screen.getByLabelText(/أرسلنا رمزاً/), { target: { value: "123456" } })
    await act(async () => void fireEvent.click(screen.getByText("تحقّق وأرسل")))
    await flush()
    fireEvent.click(screen.getByText("عدّل عرضك"))
    await flush()
    expect(field("اسم المنشأة *").value).toBe("الأفق")
    expect(field("اسم المنشأة *").disabled).toBe(true)
    expect(field("التوريد خلال (أيام) *").value).toBe("5")
    expect((document.getElementById("lk-mobile") as HTMLInputElement).readOnly).toBe(true)
    expect(text()).toContain("مُتحقَّق")
    expect(text()).toContain("تعدّل عرضك المرسل")
    type(priceOf(0), "70")
    calls.length = 0
    await act(async () => void fireEvent.click(screen.getByText("أرسل التعديل")))
    await flush()
    expect(calls.map((c) => [c.method, c.url.split("/").pop()])).toEqual([["PUT", "offer"], ["POST", "me"]])
    expect(calls.some((c) => c.url.endsWith("/code"))).toBe(false)
  })
})

describe("a request that no longer takes quotes (LNK-11, G-07)", () => {
  it("shows no form at all — only the head, the closed card and the registration card", () => {
    render(<LinkPage data={data({ state: "closed", closedAt: "2026-10-25T20:59:59.999Z" }, false)} api={makeLinkApi("TOKEN")} />)
    expect(text()).toContain("انتهى موعد التقديم")
    expect(text()).toContain("وإن قدّمت قبل الإغلاق فنتيجتك تصلك هنا")
    expect(text()).toContain("أنا قدّمت عرضاً — أرني نتيجته")
    expect(document.getElementById("lk-send")).toBeNull()
    expect(document.querySelectorAll("[data-line]")).toHaveLength(0)
    expect(text()).toContain("سجّل مجاناً")
  })

  it("the page that was open when the request closed stops taking a quote: the server's refusal locks it", async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method || "GET", headers: {}, body: init?.body })
      if (url.endsWith("/offer")) return { ok: false, status: 409, json: async () => ({ error: true, code: "DEADLINE_PASSED" }) }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
    })
    window.localStorage.setItem("mdmak.link.session.TOKEN", JSON.stringify({ secret: "a".repeat(64), expiresAt: "2099-01-01T00:00:00.000Z", phone: "+966551234567" }))
    render(<LinkPage data={data()} api={makeLinkApi("TOKEN")} />)
    type(priceOf(1), "3.6")
    type(priceOf(0), "74")
    type(field("التوريد خلال (أيام) *"), "5")
    type(field("اسم المنشأة *"), "الأفق")
    type(field("الجوال *"), "0551234567")
    await flush()
    await act(async () => void fireEvent.click(document.getElementById("lk-send") as HTMLElement))
    await flush()
    expect(text()).toContain("انتهى موعد التقديم")
    expect(document.getElementById("lk-send")).toBeNull()
  })

  it.each([
    ["awarded", { kind: "awarded", poNumber: "PO-2026/014", orderUrl: "https://uat.mdmaktech.sa/po/abcdefghijklmnopqrstuv" }, "رُسّي عليك", "افتح أمر الشراء PO-2026/014"],
    ["lost", { kind: "lost" }, "لم يُرسَ عليك هذه المرة", null],
    ["review", { kind: "review" }, "أُغلق التقديم، وعرضك قيد الدراسة", null],
    ["cancelled", { kind: "cancelled", cancelCode: "spec" }, "أُلغي هذا الطلب", null],
  ] as const)("his result when %s", async (_n, result, title, cta) => {
    meState = me({}, { result: result as LinkMe["result"] })
    window.localStorage.setItem("mdmak.link.session.TOKEN", JSON.stringify({ secret: "a".repeat(64), expiresAt: "2099-01-01T00:00:00.000Z", phone: "+966551234567" }))
    render(<LinkPage data={data({ state: "awarded", closedAt: "2026-10-20T08:00:00.000Z" }, false)} api={makeLinkApi("TOKEN")} />)
    await flush()
    expect(text()).toContain(title)
    if (cta) {
      const link = screen.getByText(cta).closest("a") as HTMLAnchorElement
      expect(link.getAttribute("href")).toBe("https://uat.mdmaktech.sa/po/abcdefghijklmnopqrstuv")
    } else expect(document.querySelector('a[href*="/po/"]')).toBeNull()
    if (result.kind === "cancelled") expect(text()).toContain("تغيّرت المواصفة")
    expect(document.getElementById("lk-send")).toBeNull()
    expect(missingKeys.size).toBe(0)
  })

  it("what is asked of him after the close — a better price (never above his) and the question put to his quote", async () => {
    meState = me({}, { tasks: { bafo: { replyBy: "2099-12-31", note: "نحتاج أقل", total: 3372 }, questions: [{ id: "q1", question: "هل السعر شامل التنزيل؟" }] }, result: { kind: "review" } })
    window.localStorage.setItem("mdmak.link.session.TOKEN", JSON.stringify({ secret: "a".repeat(64), expiresAt: "2099-01-01T00:00:00.000Z", phone: "+966551234567" }))
    render(<LinkPage data={data({ state: "closed" }, false)} api={makeLinkApi("TOKEN")} />)
    await flush()
    expect(text()).toContain("طُلب منك")
    expect(text()).toContain("سعر أفضل — جولة واحدة حتى")
    expect(text()).toContain("لا يزيد على سعرك الحالي، ويبقى عرضك الأول في السجل.")
    expect(text()).toContain("هل السعر شامل التنزيل؟")
    expect(text()).toContain("أجب")
  })
})

describe("the buyer's preview: every act is inert (LNK-13)", () => {
  it("the form is shown but nothing can be typed or sent, and nothing is fetched", () => {
    render(<LinkPage data={data()} api={null} preview={{ me: null }} />)
    expect((document.getElementById("lk-send") as HTMLButtonElement).disabled).toBe(true)
    expect(field("اسم المنشأة *").disabled).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("as a visitor who quoted: his sent page, with the edit button off", () => {
    render(<LinkPage data={data()} api={null} preview={{ me: me() }} />)
    expect(text()).toContain("وصل عرضك إلى شركة الأمل")
    expect((screen.getByText("عدّل عرضك").closest("button") as HTMLButtonElement).disabled).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

/**
 * Procurement 2.0 — the RFQ page's remaining prototype gaps, rendered for real over the in-memory Firestore with the Arabic
 * messages: the header line with every site and the delivery options (RQ-02), the request in the path opening it (RQ-03), the
 * empty tab's «ذكّر من لم يقدّم» (RQ-05), «اختر الأقل لكل بند» actually picking (RQ-06) and the best cards above the comparison
 * (RQ-12), the whole row opening the panel with «موثّق / جديد علينا» apart (RQ-07), the pieces by name and his note (RQ-08), the
 * panel's per-line «الأقل» and a short warranty (RQ-09), «أكّد سعره» (RQ-10), «أضِفه إلى مورّدينا» (RQ-11), the expired cell's
 * «اطلب تأكيد السعر» (RQ-15), the awarded orders as links (RQ-17), the details' specs, piece rule and direct-over pill (RQ-20…22),
 * the visitor link after the round closed (RQ-23) and «مدّد الموعد» only while open (RQ-24).
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
import { installDomShims, missingKeys, pushed, setPathname, setSignedIn } from "@/test-utils/render-world"
import { RfqOffersView } from "@/components/contractor/RfqOffersView"
import { RfqTable } from "@/components/procurement/RfqTable"
import type { RfqRow } from "@/components/procurement/RfqCard"
import { buildRfqRows } from "@/lib/procurement/rfq-list"
import { riyadhDay } from "@/lib/hr/format"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const TODAY = riyadhDay()
const addDay = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, data: {} }) }))
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const buttons = () => Array.from(document.querySelectorAll("button")) as HTMLButtonElement[]
const byText = (label: string) => buttons().filter((b) => (b.textContent || "").trim() === label)
const rowEls = () => Array.from(document.querySelectorAll("[role=row][data-offer]")) as HTMLElement[]
const rowOf = (id: string) => rowEls().find((r) => r.getAttribute("data-offer") === id) as HTMLElement
const click = async (el: Element | undefined) => {
  expect(el).toBeDefined()
  await act(async () => void fireEvent.click(el as Element))
  await flush()
}

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

function world(rfq: Record<string, unknown> = {}, opts: { offers?: boolean } = {}) {
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
    viewsCount: 3,
    editorGroups: [
      { label: "الموقع أ", city: "الرياض", district: "العليا" },
      { label: "الموقع ب", city: "جدة", district: "" },
    ],
    deliveryOptions: { s1: { unload: "supplier", slot: "am" } },
    products: [
      { name: "زوايا حديد 50×50×5 مم", quantity: 175, unitOfMeasure: "م", description: "حديد مجلفن درجة 60", warrantyMonths: 24, saleUnits: [{ ar: "قطعة 6 م", en: "6 m piece", lengthM: 6 }, { ar: "قطعة 12 م", en: "12 m piece", lengthM: 12 }] },
      { name: "خشب ألواح", quantity: 320, unitOfMeasure: "م" },
    ],
    ...rfq,
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
    place: { label: "الموقع أ" },
    st: "rfq",
    status: "open",
    requesterIds: [],
    log: [],
  })
  if (opts.offers === false) return
  seed("offers/quality", offerDoc("quality", "مصنع الجودة", [{ rfqProductIndex: 0, unitPrice: 12.5, warrantyMonths: 12 }, { rfqProductIndex: 1, unitPrice: 3.6 }], { versions: [{ n: 1, at: addDay(-1), note: "السعر شامل التحميل", valid: addDay(30), total: 0 }] }))
  seed("offers/east", offerDoc("east", "الشرق", [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12, packKey: "قطعة 12 م" }, { rfqProductIndex: 1, unitPrice: 3.8 }]))
  seed("offers/mid", offerDoc("mid", "الوسطى", [{ rfqProductIndex: 0, unitPrice: 13.4 }, { rfqProductIndex: 1, unitPrice: 3.5 }], { versions: [{ n: 1, at: addDay(-3), valid: addDay(-1), total: 0 }, { n: 2, at: addDay(-1), valid: addDay(20), total: 0, reval: true }] }))
  seed("offers/hope", offerDoc("hope", "الأمل", [{ rfqProductIndex: 0, unitPrice: 14 }, { rfqProductIndex: 1, unitPrice: 4 }], { isGuestOffer: true, supplierId: "guest", organizationId: "guest", guestContact: { name: "سعد", phone: "0551112222", phoneVerified: true } }))
}

beforeEach(() => {
  resetFakeDb()
  setSignedIn(ORG)
  missingKeys.clear()
})

async function open(search = "") {
  setPathname("/contractor/rfqs/R1/offers", search)
  const view = render(<RfqOffersView rfqId="R1" />)
  await flush()
  return view
}

describe("the head of the page", () => {
  it("RQ-02: the line under the title names every delivery site and the delivery options", async () => {
    world()
    const view = await open()
    const sub = Array.from(document.querySelectorAll("header p")).map((p) => p.textContent || "").find((s) => s.includes("مادتان")) || ""
    expect(sub).toContain("جدة")
    expect(sub).toContain("العليا")
    expect(sub).toContain("التنزيل على المورّد · صباحاً")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("RQ-03: the request in the path opens it on the incoming desk", async () => {
    world()
    const view = await open()
    const link = document.querySelector("nav section a") as HTMLAnchorElement
    expect(link.getAttribute("href")).toContain("/contractor/rfqs/requests?seg=all&publish=")
    expect(link.textContent).toContain("04")
    view.unmount()
  })
})

describe("the offers tab", () => {
  it("RQ-05: with no offer yet the empty state also offers «ذكّر من لم يقدّم», which opens the lifecycle bar's remind dialog", async () => {
    world({}, { offers: false })
    const heard: string[] = []
    const on = (e: Event) => heard.push((e as CustomEvent).detail.rfqId)
    window.addEventListener("proc:rfq:remind", on)
    const view = await open()
    expect(text()).toContain("لا عروض بعد")
    const reminders = byText("ذكّر من لم يقدّم")
    expect(reminders.length).toBe(2)
    await click(reminders.at(-1))
    expect(heard).toEqual(["R1"])
    expect(document.querySelector("[role=dialog]")).not.toBeNull()
    window.removeEventListener("proc:rfq:remind", on)
    view.unmount()
  })

  it("RQ-07: the whole row opens the panel, and the subtitle tells verification apart from our record", async () => {
    world()
    const view = await open()
    expect(rowOf("quality").querySelector("[data-subtitle]")?.textContent).toBe("غير موثّق · جديد علينا")
    expect(rowOf("hope").querySelector("[data-subtitle]")?.textContent).toBe("من خارج المنصة · رابط الزوار")
    expect(text()).not.toContain("ما جرى")
    await click(rowOf("quality").querySelector("[role=cell]:nth-child(4)") as Element)
    expect(text()).toContain("ما جرى")
    view.unmount()
  })

  it("RQ-08: the piece tag names the piece, and his note is a tag of its own", async () => {
    world()
    const view = await open()
    expect(rowOf("east").textContent).toContain("بالقطعة: قطعة 12 م")
    expect(rowOf("quality").textContent).toContain("السعر شامل التحميل")
    view.unmount()
  })

  it("RQ-06: «اختر الأقل لكل بند» on the split card opens the comparison with the lowest per line picked", async () => {
    world()
    const view = await open()
    const split = document.querySelector("[data-testid=rfq-best-cards]") as HTMLElement
    await click(Array.from(split.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "اختر الأقل لكل بند"))
    expect(document.querySelector('[role="tab"][data-state="active"]')?.textContent).toContain("المقارنة")
    expect(text()).toContain("اختير 2 من 2")
    view.unmount()
  })
})

describe("the offer panel", () => {
  const openPanel = async (id: string) => click(Array.from(rowOf(id).querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "التفاصيل"))

  it("RQ-09: ★ «الأقل» on the lines where he is lowest, and a warranty below what the line asks in red", async () => {
    world()
    const view = await open()
    await openPanel("quality")
    const line0 = document.querySelector("[data-line='0']") as HTMLElement
    expect(line0.textContent).toContain("الأقل")
    expect(line0.querySelector("[data-warranty=short]")?.textContent).toContain("المطلوب 24 أشهر")
    expect(line0.querySelector("[data-warranty=short]")?.className).toContain("text-destructive")
    view.unmount()
  })

  it("RQ-10: the header says «غير موثّق» for a registered supplier without verified documents; «أكّد سعره» after a confirmation reply", async () => {
    world()
    const view = await open()
    await openPanel("mid")
    expect(text()).toContain("غير موثّق")
    expect(text()).toContain("أكّد سعره")
    view.unmount()
  })

  it("RQ-11: an off-platform supplier can be added to our suppliers from his offer", async () => {
    world()
    const view = await open()
    await openPanel("hope")
    const box = document.querySelector("[data-testid=off-platform-box]") as HTMLElement
    expect(box.textContent).toContain("أضِفه إلى مورّدينا")
    expect(box.textContent).not.toContain("يُضاف إلى موردينا حين ينضم")
    view.unmount()
  })
})

describe("the comparison tab", () => {
  it("RQ-12: the best cards sit above the grid", async () => {
    world()
    const view = await open("tab=compare")
    expect(document.querySelector("[data-testid=rfq-best-cards]")).not.toBeNull()
    expect(text()).toContain("الأقل لكل مادة")
    view.unmount()
  })

  it("RQ-15: an expired offer's cell asks for the price confirmation where the buyer decides", async () => {
    world()
    seed("offers/east", offerDoc("east", "الشرق", [{ rfqProductIndex: 0, unitPrice: 146, packLen: 12 }, { rfqProductIndex: 1, unitPrice: 3.8 }], { validUntil: addDay(-2) }))
    const view = await open("tab=compare")
    const ask = byText("اطلب تأكيد السعر")
    expect(ask.length).toBeGreaterThan(0)
    await click(ask[0])
    expect(byText("أرسل الطلب").length).toBeGreaterThan(0)
    view.unmount()
  })

  it("RQ-17: after the award, each order is a link to it", async () => {
    world({ status: "Awarded" })
    seed("purchaseOrders/po31", { organizationId: ORG, rfqId: "R1", offerId: "quality", docNumber: "PO-2026/031", supplierName: "مصنع الجودة", supplierOrgId: "quality", status: "approved", lines: [] })
    const view = await open("tab=compare")
    const link = Array.from(document.querySelectorAll("a")).find((a) => (a.getAttribute("href") || "").includes("po=po31"))
    expect(link).toBeDefined()
    view.unmount()
  })
})

describe("the details tab", () => {
  it("RQ-20 / RQ-21: the material's specification under its name, and what may be priced per piece", async () => {
    world()
    const view = await open("tab=details")
    expect(document.querySelector("[data-spec]")?.textContent).toBe("حديد مجلفن درجة 60")
    expect(text()).toContain("يُسمح بالتسعير بالقطعة: زوايا حديد 50×50×5 مم (قطعة 6 م أو قطعة 12 م). والمقارنة بوحدة الطلب.")
    view.unmount()
  })

  it("RQ-22: a direct award above the cap carries its reason in the details and a pill in the header", async () => {
    world({ directAward: true, dirOver: true, directWhy: "مورد وحيد للمادة", invitedSupplierOrgIds: ["quality"] })
    const view = await open("tab=details")
    expect(text()).toContain("إسناد مباشر فوق السقف: مورد وحيد للمادة")
    expect(Array.from(document.querySelectorAll("header span")).some((s) => (s.textContent || "") === "إسناد مباشر فوق السقف")).toBe(true)
    view.unmount()
  })

  it("RQ-23: the visitor link panel stays after the date passed, without copy/share, saying how it closed and how many offered through it", async () => {
    world({ deadline: addDay(-1) })
    const view = await open("tab=details")
    const caption = document.querySelector("[data-link-phase=closed]")?.textContent || ""
    expect(caption).toContain("مع الموعد")
    expect(caption).toContain("قدّم منه عرض واحد")
    expect(byText("انسخ")).toHaveLength(0)
    expect(text()).toContain("ما يراه المورّد الآن")
    view.unmount()
  })

  it("RQ-23: while open it works until the deadline", async () => {
    world()
    const view = await open("tab=details")
    expect(document.querySelector("[data-link-phase=open]")?.textContent).toContain("يعمل حتى")
    view.unmount()
  })
})

describe("the inquiries tab", () => {
  const ask = () => seed("rfqs/R1/inquiries/q1", { kind: "ask", question: "هل التسليم شامل التنزيل؟", from: { orgId: null, anon: true }, via: "link", answer: null, reply: null, createdAt: `${addDay(-2)}T09:00:00.000Z` })

  it("RQ-24: «يغيّر النطاق؟ مدّد الموعد» shows while open, and not once the date passed", async () => {
    world()
    ask()
    let view = await open("tab=inquiries")
    expect(byText("يغيّر النطاق؟ مدّد الموعد")).toHaveLength(1)
    view.unmount()
    resetFakeDb()
    setSignedIn(ORG)
    world({ deadline: addDay(-1) })
    ask()
    view = await open("tab=inquiries")
    expect(text()).toContain("هل التسليم شامل التنزيل؟")
    expect(byText("يغيّر النطاق؟ مدّد الموعد")).toHaveLength(0)
    view.unmount()
  })
})

describe("the RFQs list as rows (RQ-01)", () => {
  it("the whole row opens the RFQ, and an open RFQ the viewer runs has the visitor-link button at the row's end", async () => {
    world({}, { offers: false })
    const rfqs = [
      { id: "R1", title: "زوايا", status: "New", deadline: addDay(4), organizationId: ORG, createdByUserId: ORG, products: [] },
      { id: "R2", title: "خشب", status: "New", deadline: addDay(4), organizationId: ORG, createdByUserId: ORG, directAward: true, products: [] },
    ] as unknown as RfqRow[]
    const rows = buildRfqRows({ rfqs, offers: [], decisions: {}, orders: [], today: TODAY, tiePercent: 0.5, locale: "ar", siteLabel: () => "", categoryLabel: (k) => k })
    const share = jest.fn()
    pushed.length = 0
    const view = render(<RfqTable rows={rows} seesPrices canActOn={() => true} onGlance={() => {}} onReopen={() => {}} onShare={share} />)
    await flush()
    const links = buttons().filter((b) => b.getAttribute("aria-label") === "رابط الزوار")
    expect(links).toHaveLength(1)
    await click(links[0])
    expect(share).toHaveBeenCalledWith(rows[0])
    expect(pushed).toEqual([])
    await click(Array.from(document.querySelectorAll("tbody tr"))[1].querySelector("td:nth-child(2)") as Element)
    expect(pushed).toEqual(["/contractor/rfqs/R2/offers?tab=details"])
    view.unmount()
  })
})

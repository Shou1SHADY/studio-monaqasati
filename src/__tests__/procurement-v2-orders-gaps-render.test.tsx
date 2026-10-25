/**
 * Procurement 2.0 — the orders gaps against the prototype, rendered (PO-01…14): the line's spec chips, path and «= total» (or «ضمن
 * المبلغ الإجمالي»); the acceptance window — blue inside it, amber past it with the policy named; the off-platform reminder on
 * WhatsApp with the order link, posted in the conversation; the supplier's change request first in the next step; a 2.0 notice drawn
 * as a day and a word with its number and who recorded it; forwarding and «كما يراه المستلم» in place; «صعّد» past the window; a
 * receipt's PDF; the receiver named when a notice is recorded; «محادثاتي» with the step sentence; and the order-link PREVIEW that
 * never mints a link, never marks the supplier's read state and has nothing to press.
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
import { getAuth } from "firebase/auth"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import OrdersPage from "@/app/[locale]/(contractor)/contractor/rfqs/orders/page"
import { ChatsPage } from "@/components/procurement/chats/ChatsPage"
import { LinkOrderView, type LinkOrderActions } from "@/components/procurement/guest/LinkOrderView"
import type { PoLinkView } from "@/lib/po-link"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
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
  createdAt: ago(6),
  approverKind: "owner",
  approvedById: ORG,
  approvedByName: "المالك",
  approvedAt: ago(5),
  sentAt: ago(4),
  sentChannel: "portal",
  supplierAcceptedAt: ago(3),
  promisedDate: day(20),
  log: [],
  ...over,
})
const guest = { supplierOrgId: "guest", supplierUserId: null, isGuestSupplier: true, supplierName: "مؤسسة الندى", sentChannel: "whatsapp" }

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[]
const drawer = () => dialogs()[0]
const buttonIn = (root: ParentNode, name: string) => Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === name)

async function open(id: string) {
  setSignedIn(ORG)
  setPathname("/contractor/rfqs/orders", `po=${id}`)
  missingKeys.clear()
  render(<OrdersPage />)
  await flush()
  return drawer()?.textContent ?? ""
}

type Call = { url: string; body: Record<string, unknown> | null }
function mockFetch(answer: (url: string) => Record<string, unknown> = () => ({})): Call[] {
  const calls: Call[] = []
  ;(getAuth as jest.Mock).mockReturnValue({ currentUser: { getIdToken: async () => "tok" } })
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null })
    return { ok: true, json: async () => ({ success: true, data: answer(url) }) }
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "o@test.sa" })
  document.body.innerHTML = ""
})

describe("PO-01 · PO-11 — the lines", () => {
  it("shows the path and the spec chips under the name, and price × qty = total", async () => {
    seed("purchaseOrders/a", order({ lines: [line({ spec: "16 مم · G60", path: "الحديد › حديد التسليح" })] }))
    const text = await open("a")
    expect(missingKeys.size).toBe(0)
    expect(text).toContain("الحديد › حديد التسليح")
    const chips = Array.from(drawer().querySelectorAll("ul li")).map((li) => li.textContent)
    expect(chips).toEqual(expect.arrayContaining(["16 مم", "G60"]))
    expect(text).toMatch(/=[^\d]{0,8}30,000/)
  })

  it("a lump-sum line reads «ضمن المبلغ الإجمالي» and carries no price", async () => {
    seed("purchaseOrders/a", order({ lines: [line({ unitPrice: null })] }))
    const text = await open("a")
    expect(text).toContain("ضمن المبلغ الإجمالي")
  })
})

describe("PO-08 · PO-09 — after sending", () => {
  it("inside the acceptance window it simply waits — no «has not accepted»", async () => {
    seed("purchaseOrders/a", order({ status: "sent", sentAt: new Date().toISOString(), supplierAcceptedAt: null, promisedDate: null }))
    const text = await open("a")
    expect(text).toContain("أُرسل الأمر، وينتظر قبول المورد.")
    expect(text).not.toContain("لم يقبل المورد الأمر منذ")
  })

  it("past the window it is amber, names the policy, and «ألغِ الأمر» is a button", async () => {
    seed("purchaseOrders/a", order({ status: "sent", sentAt: ago(4), supplierAcceptedAt: null, promisedDate: null }))
    const text = await open("a")
    expect(text).toContain("لم يقبل المورد الأمر منذ")
    expect(text).toContain("مهلة القبول")
    expect(buttonIn(drawer(), "ألغِ الأمر")).toBeTruthy()
    expect(buttonIn(drawer(), "ذكّر المورد")).toBeTruthy()
  })

  it("an off-platform supplier is reminded on WhatsApp with the order link, and the reminder is posted in the conversation", async () => {
    seed("purchaseOrders/a", order({ ...guest, status: "sent", sentAt: ago(4), supplierAcceptedAt: null, promisedDate: null }))
    await open("a")
    const calls = mockFetch((url) => (url.endsWith("/message/link") ? { link: "https://mdmaktech.sa/po/abc" } : { poId: "a", seq: 1 }))
    const win = { location: { href: "" }, close: jest.fn() }
    const opener = jest.spyOn(window, "open").mockReturnValue(win as unknown as Window)
    await act(async () => void fireEvent.click(buttonIn(drawer(), "ذكّر المورد") as HTMLElement))
    await flush()
    const posted = calls.find((c) => c.url === "/api/procurement/po/message")
    expect(posted?.body).toMatchObject({ poId: "a", channel: "whatsapp" })
    expect(String(posted?.body?.text)).toContain("2026/001")
    expect(calls.some((c) => c.url === "/api/procurement/po/message/link")).toBe(true)
    expect(win.location.href).toMatch(/wa\.me/)
    expect(win.location.href).toContain(encodeURIComponent("https://mdmaktech.sa/po/abc"))
    opener.mockRestore()
  })
})

describe("PO-13 — the supplier's change request", () => {
  it("comes first in the next step, with the way to answer it, and the order counts under «يحتاج تصرّفنا»", async () => {
    seed("purchaseOrders/a", order({ ...guest, status: "sent", sentAt: new Date().toISOString(), supplierAcceptedAt: null, promisedDate: null, changeAsked: { at: new Date().toISOString(), seq: 1, text: "أطلب تعديل الموعد يومين" }, chat: { seq: 1, usSeq: 0, supSeq: 1, readBy: {} } }))
    const text = await open("a")
    expect(text).toContain("طلب المورّد تعديلاً: أطلب تعديل الموعد يومين")
    expect(buttonIn(drawer(), "ردّ في المحادثة")).toBeTruthy()
    const firstTab = document.querySelector('[role="tab"]') as HTMLElement
    expect(firstTab.textContent).toContain("1")
  })
})

describe("PO-03 · PO-04 · PO-05 · PO-06 · PO-07 · PO-10 — notices and receipts", () => {
  const notice = (over: Record<string, unknown> = {}) => ({
    poId: "a",
    poNumber: "PO-2026/001",
    contractorOrgId: ORG,
    supplierOrgId: "guest",
    supplierName: "مؤسسة الندى",
    status: "pending_confirmation",
    items: [],
    seq: 1,
    deliveryDate: `${day(2)}T00:00:00.000Z`,
    notes: "الشاحنة صباحاً",
    reportedBy: "onBehalf",
    recordedOnBehalf: { byId: "clerk", byName: "ريم", at: ago(0) },
    isGuestDelivery: true,
    createdAt: ago(0),
    ...over,
  })

  it("a 2.0 notice reads as its number, its day and its word, recorded on the supplier's behalf — no empty quantity, no driver", async () => {
    seed("purchaseOrders/a", order(guest))
    seed("deliveries/n1", notice())
    const text = await open("a")
    expect(missingKeys.size).toBe(0)
    expect(text).toContain("إ.ت-2026/001-1")
    expect(text).toContain("الشاحنة صباحاً")
    expect(text).toContain("سجّله ريم نيابةً عن المورّد")
    expect(text).not.toContain("السائق لم يُحدَّد")
  })

  it("«حوّل للمستلم» opens the forward form in the drawer instead of leaving it", async () => {
    seed("purchaseOrders/a", order(guest))
    seed("deliveries/n1", notice())
    await open("a")
    const before = dialogs().length
    await act(async () => void fireEvent.click(buttonIn(drawer(), "حوّل للمستلم") as HTMLElement))
    await flush()
    expect(dialogs().length).toBeGreaterThan(before)
    expect(document.body.textContent).toContain("حوّل الإشعار للمستلم")
  })

  it("forwarded and uncounted past the window: «صعّد» leads, and «كما يراه المستلم» opens the receiver's view", async () => {
    seed("purchaseOrders/a", order(guest))
    seed("deliveries/n1", notice({ deliveryDate: `${day(-4)}T00:00:00.000Z`, forwardedTo: { linkId: "k1", name: "خالد", userId: "u2", byName: "المالك", at: ago(5) } }))
    await open("a")
    expect(buttonIn(drawer(), "صعّد")).toBeTruthy()
    expect(buttonIn(drawer(), "ذكّر المستلم")).toBeTruthy()
    await act(async () => void fireEvent.click(buttonIn(drawer(), "كما يراه المستلم") as HTMLElement))
    await flush()
    expect(document.body.textContent).toContain("كما يراه المستلم")
    expect(dialogs().length).toBeGreaterThan(1)
  })

  it("a receipt row has its own PDF", async () => {
    seed("purchaseOrders/a", order({ lines: [line({ accepted: 4 })] }))
    seed("deliveries/g1", { poId: "a", contractorOrgId: ORG, status: "confirmed", docNumber: "GR-2026/004", confirmedAt: ago(1), deliveryDate: ago(1), lines: [{ poLineId: "l1", counted: 4, accepted: 4, rejected: 0, held: 0 }] })
    await open("a")
    const pdf = drawer().querySelector('button[aria-label="اطبع السند PDF"]') as HTMLElement
    expect(pdf).toBeTruthy()
    const win = { document: { write: jest.fn(), close: jest.fn() } }
    const opener = jest.spyOn(window, "open").mockReturnValue(win as unknown as Window)
    await act(async () => void fireEvent.click(pdf))
    expect(win.document.write).toHaveBeenCalled()
    opener.mockRestore()
  })
})

describe("PO-14 — recording a notice names who it goes to next", () => {
  it("the dialog names the site's receiver", async () => {
    seed("purchaseOrders/a", order({ ...guest, promisedDate: day(0) }))
    seed("procurementReceivers/r1", { organizationId: ORG, name: "خالد المستلم", title: "أمين المستودع", module: "warehouses", phone: "0500000000", warehouseIds: [] })
    await open("a")
    await act(async () => void fireEvent.click(buttonIn(drawer(), "سجّل إشعار تسليم") as HTMLElement))
    await flush()
    expect(document.body.textContent).toContain("ثم يُحوَّل لمستلم الموقع: خالد المستلم")
  })
})

describe("PO-02 · PO-12 — «محادثاتي»", () => {
  const view: PoLinkView = {
    no: "2026/001",
    company: "شركة البناء",
    supplierName: "مؤسسة الندى",
    state: "awaiting",
    ver: 1,
    acts: { accept: true, requestChange: true, decline: true, report: false, reply: true, acceptVersion: false },
    site: null,
    access: null,
    needBy: null,
    dueDate: "2026-11-30",
    promisedDate: null,
    acceptBy: "2026-11-01",
    terms: null,
    lines: [{ id: "l1", name: "حديد تسليح", quantity: 10, unit: "طن", price: 3000, pk: null, need: null, base: null, packName: null, cancelled: 0, spec: "16 مم · G60" }],
    total: { kind: "incl", amount: 34500, exVat: 30000 },
    receiver: null,
    notices: [],
    pendingVersion: null,
    cancel: null,
    decline: null,
    payment: null,
    thread: [],
    unread: 0,
  }

  it("the thread header reads the order's next step and who it waits on, and the supplier's name opens his file", async () => {
    seed("purchaseOrders/a", order({ status: "sent", sentAt: new Date().toISOString(), supplierAcceptedAt: null, promisedDate: null, chat: { seq: 1, usSeq: 1, supSeq: 0, readBy: {} } }))
    setSignedIn(ORG)
    setPathname("/contractor/chats", "po=a")
    missingKeys.clear()
    render(<ChatsPage />)
    await flush()
    expect(missingKeys.size).toBe(0)
    const header = document.querySelector("section[aria-label] header") as HTMLElement
    expect(header.textContent).toContain("المورد")
    expect(header.querySelector('a[href="/contractor/suppliers?supplier=sup1"]')).toBeTruthy()
  })

  it("«رابط الأمر كما يراه» opens a read-only preview: no link minted, nothing marked read, nothing to press", async () => {
    seed("purchaseOrders/a", order({ ...guest, status: "sent", sentAt: new Date().toISOString(), supplierAcceptedAt: null, promisedDate: null, chat: { seq: 1, usSeq: 1, supSeq: 0, readBy: {} } }))
    const calls = mockFetch((url) => (url.endsWith("/message/preview") ? { view } : {}))
    setSignedIn(ORG)
    setPathname("/contractor/chats", "po=a")
    render(<ChatsPage />)
    await flush()
    await act(async () => void fireEvent.click(buttonIn(document.body, "رابط الأمر كما يراه") as HTMLElement))
    await flush()
    expect(calls.map((c) => c.url)).toContain("/api/procurement/po/message/preview")
    expect(calls.map((c) => c.url)).not.toContain("/api/procurement/po/message/link")
    expect(document.body.textContent).toContain("معاينة — هذا ما يراه مؤسسة الندى")
    const sheet = dialogs()[dialogs().length - 1]
    expect(sheet.textContent).toContain("16 مم")
    const accept = buttonIn(sheet, "اقبل الأمر") ?? Array.from(sheet.querySelectorAll("fieldset button"))[0]
    expect(accept).toBeTruthy()
    expect((accept as HTMLButtonElement).closest("fieldset")?.disabled).toBe(true)
  })
})

describe("PO-02 — the link page's read-only mode", () => {
  const actions: LinkOrderActions = { accept: jest.fn(), decline: jest.fn(), askChange: jest.fn(), report: jest.fn(), acceptVersion: jest.fn() }
  const view = {
    no: "2026/014",
    company: "البنيان",
    supplierName: "مؤسسة الرمال",
    state: "awaiting",
    ver: 1,
    acts: { accept: true, requestChange: true, decline: true, report: false, reply: true, acceptVersion: false },
    site: null,
    access: null,
    needBy: null,
    dueDate: "2026-10-30",
    promisedDate: null,
    acceptBy: "2026-10-13",
    terms: null,
    lines: [{ id: "l1", name: "رمل أحمر", quantity: 20, unit: "م³", price: 88, pk: null, need: null, base: null, packName: null, cancelled: 0, spec: "ناعم · مغسول" }],
    total: { kind: "incl", amount: 2024, exVat: 1760 },
    receiver: null,
    notices: [],
    pendingVersion: null,
    cancel: null,
    decline: null,
    payment: null,
    thread: [],
    unread: 0,
  } as PoLinkView

  it("shows the spec chips; read-only puts every control behind a disabled fieldset, the live page keeps them", () => {
    const live = render(<LinkOrderView view={view} actions={actions} busy={false} />)
    expect(live.container.textContent).toContain("ناعم")
    expect(live.container.querySelector("fieldset")).toBeNull()
    live.unmount()
    const ro = render(<LinkOrderView view={view} actions={actions} busy={false} readOnly />)
    const fs = ro.container.querySelector("fieldset") as HTMLFieldSetElement
    expect(fs.disabled).toBe(true)
    expect(fs.querySelectorAll("button").length).toBeGreaterThan(0)
  })
})

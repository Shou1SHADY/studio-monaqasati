/**
 * Procurement 2.0 — «محادثاتي» and the order link, rendered for real (MSG-02, MSG-04, WF-17, WF-19, G-08, G-17): the list puts the
 * unread conversation first and finds a supplier or a number; a conversation shows the order's own events among the messages and
 * sends through the route; the order link shows exactly one state block — accept / decline / change, then the delivery report with
 * a day and a note and NO quantity field — and nothing to press on a cancelled order; numbers read as words.
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
import { ChatsPage } from "@/components/procurement/chats/ChatsPage"
import { LinkOrderView, type LinkOrderActions } from "@/components/procurement/guest/LinkOrderView"
import type { PoLinkView } from "@/lib/po-link"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const buttonIn = (root: ParentNode, name: string) => Array.from(root.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === name)

const po = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  docNumber: "PO-2026/001",
  status: "sent",
  basis: "rfq",
  rfqId: "r1",
  rfqTitle: "حديد",
  offerId: "o1",
  supplierOrgId: "sup1",
  supplierUserId: "su1",
  supplierName: "حديد الشرق",
  isGuestSupplier: false,
  lines: [{ id: "l1", name: "حديد", unit: "طن", quantity: 10, unitPrice: 3000, accepted: 0, rejected: 0, held: 0, cancelled: 0 }],
  totalExVat: 30000,
  vatRate: 0.15,
  preparedById: ORG,
  preparedByName: "المالك",
  createdAt: "2026-10-10T08:00:00Z",
  approverKind: "owner",
  approvedAt: "2026-10-11T08:00:00Z",
  sentAt: "2026-10-12T08:00:00Z",
  sentChannel: "portal",
  log: [{ at: "2026-10-12T08:00:00Z", byId: ORG, byName: "المالك", action: "sent", params: { channel: "portal" } }],
  ...over,
})
const chat = (over: Record<string, unknown> = {}) => ({ seq: 1, usSeq: 0, supSeq: 1, lastAt: "2026-10-14T08:00:00Z", lastText: "جاهزون للتوريد", lastBy: "sup", lastFile: false, readBy: {}, supReadSeq: 0, ...over })
const message = (seq: number, by: "us" | "sup", text: string, poId = "a") => ({ poId, organizationId: ORG, supplierOrgId: "sup1", seq, by, authorId: by === "us" ? ORG : "su1", authorName: "x", text, file: null, channel: "portal", at: `2026-10-14T0${seq}:00:00Z` })

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "o@test.sa" })
  document.body.innerHTML = ""
})

describe("«محادثاتي»", () => {
  beforeEach(() => {
    seed("purchaseOrders/a", po({ docNumber: "PO-2026/001", supplierName: "حديد الشرق", chat: chat({ readBy: { [ORG]: 1 } }) }))
    seed("purchaseOrders/b", po({ docNumber: "PO-2026/002", supplierName: "إسمنت الخليج", chat: chat({ lastAt: "2026-10-13T08:00:00Z", lastText: "هل وصلكم الأمر؟" }) }))
    seed("purchaseOrders/c", po({ docNumber: "PO-2026/003", supplierName: "ملغى", status: "cancelled" }))
    seed("purchaseOrders/g", po({ docNumber: "PO-2026/004", supplierName: "مؤسسة الندى", supplierOrgId: "guest", supplierUserId: null, isGuestSupplier: true, sentChannel: "whatsapp", chat: chat({ lastAt: "2026-10-12T10:00:00Z", readBy: { [ORG]: 1 }, lastText: "أؤكد الموعد" }) }))
    seed("poMessages/a__1", message(1, "sup", "جاهزون للتوريد", "a"))
  })

  async function open(search = "") {
    setSignedIn(ORG)
    setPathname("/contractor/chats", search)
    missingKeys.clear()
    render(<ChatsPage />)
    await flush()
  }

  it("one row per sent live order, the unread one first, then the latest; an off-platform supplier is marked WhatsApp", async () => {
    await open()
    expect(missingKeys.size).toBe(0)
    const rows = Array.from(document.querySelectorAll("section[aria-label] ul li")).map((li) => li.textContent ?? "")
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain("إسمنت الخليج")
    expect(rows[0]).toContain("هل وصلكم الأمر؟")
    expect(rows[1]).toContain("حديد الشرق")
    expect(rows[2]).toContain("مؤسسة الندى")
    expect(rows[2]).toContain("واتساب")
    expect(rows.join()).not.toContain("ملغى")
    expect(document.querySelectorAll('[aria-label="غير مقروءة"]')).toHaveLength(1)
  })

  it("a search finds a supplier or an order number across the list", async () => {
    await open()
    const input = document.querySelector('input[placeholder="ابحث بالمورّد أو رقم الأمر…"]') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { value: "الندى" } }))
    expect(document.querySelectorAll("section ul li")).toHaveLength(1)
    await act(async () => void fireEvent.change(input, { target: { value: "2026/002" } }))
    expect((document.querySelector("section ul li") as HTMLElement).textContent).toContain("إسمنت الخليج")
    await act(async () => void fireEvent.change(input, { target: { value: "لا شيء" } }))
    expect(document.body.textContent).toContain("لا نتائج.")
  })

  it("a conversation shows the order's own events among the messages, and sends through the route", async () => {
    await open("po=a")
    expect(document.body.textContent).toContain("أُرسل أمر الشراء ط.ش-2026/001 إلى بوابة المورّد")
    expect(document.body.textContent).toContain("جاهزون للتوريد")
    ;(getAuth as jest.Mock).mockReturnValue({ currentUser: { getIdToken: async () => "tok" } })
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    global.fetch = jest.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true, json: async () => ({ success: true, data: { poId: "a", seq: 2 } }) }
    }) as unknown as typeof fetch
    const box = document.querySelector('input[placeholder="اكتب رسالة للمورّد…"]') as HTMLInputElement
    await act(async () => void fireEvent.change(box, { target: { value: "تمام، نتابع" } }))
    await act(async () => void fireEvent.click(buttonIn(document.body, "أرسل") as HTMLElement))
    await flush()
    const sent = calls.find((c) => c.url === "/api/procurement/po/message")
    expect(sent?.body).toMatchObject({ poId: "a", text: "تمام، نتابع", channel: "portal" })
  })

  it("opening an unread conversation marks it read through the route", async () => {
    ;(getAuth as jest.Mock).mockReturnValue({ currentUser: { getIdToken: async () => "tok" } })
    const urls: string[] = []
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ success: true, data: { poId: "b" } }) }
    }) as unknown as typeof fetch
    await open("po=b")
    expect(urls).toContain("/api/procurement/po/message/read")
  })

  it("nothing sent yet: the empty state says when a conversation starts", async () => {
    resetFakeDb()
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البناء", email: "o@test.sa" })
    seed("purchaseOrders/x", po({ status: "approved", sentAt: null }))
    await open()
    expect(document.body.textContent).toContain("لا محادثات بعد")
    expect(document.body.textContent).toContain("تبدأ المحادثة حين يُرسل أمر الشراء.")
  })
})

describe("the order link page", () => {
  const view = (over: Partial<PoLinkView> = {}): PoLinkView => ({
    no: "2026/014",
    company: "البنيان الحديثة",
    supplierName: "مؤسسة الرمال",
    state: "awaiting",
    ver: 1,
    acts: { accept: true, requestChange: true, decline: true, report: false, reply: true, acceptVersion: false },
    site: { name: "موقع السلي", city: "الرياض", district: "السلي", address: "طريق الخرج", mapUrl: "https://maps.example/x" },
    access: null,
    needBy: null,
    dueDate: "2026-10-30",
    promisedDate: null,
    acceptBy: "2026-10-13",
    terms: "30 يوماً",
    lines: [{ id: "l1", name: "رمل أحمر", quantity: 20, unit: "م³", price: 88, pk: null, need: null, base: null, packName: null, cancelled: 0 }],
    total: { kind: "incl", amount: 2024, exVat: 1760 },
    receiver: null,
    notices: [],
    pendingVersion: null,
    cancel: null,
    decline: null,
    payment: null,
    thread: [],
    unread: 0,
    ...over,
  })
  const actions = (): LinkOrderActions & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      accept: async (d) => void calls.push(`accept:${d}`),
      decline: async (r, n) => void calls.push(`decline:${r}:${n}`),
      askChange: async (t) => void calls.push(`change:${t}`),
      report: async (o, n) => void calls.push(`report:${o}:${n}`),
      acceptVersion: async (n) => void calls.push(`version:${n}`),
    }
  }
  const show = (v: PoLinkView, a = actions()) => {
    missingKeys.clear()
    render(<LinkOrderView view={v} actions={a} busy={false} />)
    return a
  }

  it("before acceptance: the order as a word and a number, the place with its map, the total incl. VAT — and three buttons", async () => {
    const a = show(view())
    const text = document.body.textContent ?? ""
    expect(missingKeys.size).toBe(0)
    expect(text).toContain("أمر 2026/014")
    expect(text).not.toContain("ط.ش")
    expect(text).toContain("أمر شراء من البنيان الحديثة")
    expect(text).toContain("الرياض — السلي")
    expect(text).toContain("الموقع على الخريطة")
    expect(text).toContain("الإجمالي شامل الضريبة")
    expect(text).toContain("بانتظار قبولك")
    expect(text).toContain("القبول يعني الالتزام بالكميات والسعر وموعد التوريد")
    for (const name of ["اقبل الأمر", "اطلب تعديلاً", "اعتذر عن الأمر"]) expect(buttonIn(document.body, name)).toBeDefined()
    expect(buttonIn(document.body, "أبلغ بالتسليم")).toBeUndefined()
    await act(async () => void fireEvent.click(buttonIn(document.body, "اقبل الأمر") as HTMLElement))
    expect(a.calls).toEqual(["accept:null"])
  })

  it("«اعتذر» opens the four reasons; «سبب آخر» needs words before it can be sent", async () => {
    const a = show(view())
    await act(async () => void fireEvent.click(buttonIn(document.body, "اعتذر عن الأمر") as HTMLElement))
    for (const r of ["لا تتوفر الكمية", "تغيّر السعر", "لا أستطيع الموعد", "سبب آخر"]) expect(buttonIn(document.body, r)).toBeDefined()
    await act(async () => void fireEvent.click(buttonIn(document.body, "لا أستطيع الموعد") as HTMLElement))
    await act(async () => void fireEvent.click(buttonIn(document.body, "أرسل الاعتذار") as HTMLElement))
    expect(a.calls).toEqual(["decline:date:"])
    await act(async () => void fireEvent.click(buttonIn(document.body, "سبب آخر") as HTMLElement))
    expect((buttonIn(document.body, "أرسل الاعتذار") as HTMLButtonElement).disabled).toBe(true)
  })

  it("after acceptance: the receiver, a day and a note — and NO quantity field (G-08)", async () => {
    const a = show(view({ state: "accepted", acts: { accept: false, requestChange: false, decline: false, report: true, reply: true, acceptVersion: false }, receiver: { name: "أبو فهد", phone: "0551234567" }, notices: [{ id: "n1", seq: 1, date: "2026-10-15", note: "شاحنة 7 صباحاً", count: { accepted: 18, rejected: 2 } }] }))
    const text = document.body.textContent ?? ""
    expect(text).toContain("التاريخ والملاحظة فقط — والكميات يعدّها المستلم")
    expect(text).toContain("المستلم في الموقع")
    expect(text).toContain("أبو فهد")
    expect(text).toContain("عُدّ: قُبل 18 ورُفض 2")
    expect(document.querySelector('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]')).toBeNull()
    for (const name of ["اليوم", "غداً", "بعد غد"]) expect(buttonIn(document.body, name)).toBeDefined()
    await act(async () => void fireEvent.click(buttonIn(document.body, "غداً") as HTMLElement))
    await act(async () => void fireEvent.click(buttonIn(document.body, "أبلغ بالتسليم") as HTMLElement))
    expect(a.calls).toEqual(["report:1:"])
  })

  it("a cancelled order: «أُلغي هذا الأمر» with its reason, nothing to press (R-22)", () => {
    show(view({ state: "cancelled", acts: { accept: false, requestChange: false, decline: false, report: false, reply: false, acceptVersion: false }, cancel: { at: "2026-10-14T08:00:00Z", why: "لم تعد الحاجة قائمة" } }))
    const text = document.body.textContent ?? ""
    expect(text).toContain("أُلغي هذا الأمر")
    expect(text).toContain("لم تعد الحاجة قائمة")
    expect(text).toContain("لا قبول ولا تسليم عليه")
    expect(document.querySelectorAll("button")).toHaveLength(0)
  })

  it("declined and completed orders say so and offer nothing", () => {
    show(view({ state: "declined", acts: { accept: false, requestChange: false, decline: false, report: false, reply: true, acceptVersion: false }, decline: { at: "2026-10-13T08:00:00Z", reason: "price", note: "تغيّر السعر" } }))
    expect(document.body.textContent).toContain("اعتذرتَ عن هذا الأمر")
    expect(buttonIn(document.body, "اقبل الأمر")).toBeUndefined()
    cleanup()
    show(view({ state: "complete", acts: { accept: false, requestChange: false, decline: false, report: false, reply: true, acceptVersion: false } }))
    expect(document.body.textContent).toContain("اكتمل الأمر")
    expect(document.body.textContent).toContain("استُلم كاملاً. شكراً لك.")
  })

  it("a piece line reads the pieces and the metres; a lump sum names no unit price", () => {
    show(view({ lines: [{ id: "l1", name: "اسياخ", quantity: 30, unit: "قطعة 6 م", price: 74, pk: 6, need: 175, base: "م", packName: { ar: "قطعة 6 م", en: "6 m bar" }, cancelled: 0 }] }))
    expect(document.body.textContent).toContain("= 180 م (المطلوب 175)")
    cleanup()
    show(view({ lines: [{ id: "l1", name: "عمل", quantity: 1, unit: "مقطوعية", price: null, pk: null, need: null, base: null, packName: null, cancelled: 0 }], total: { kind: "lump", amount: 5000, exVat: 5000 } }))
    expect(document.body.textContent).toContain("المبلغ الإجمالي")
  })

  it("a change after sending waits for «قبلت الإصدار 2»", async () => {
    const a = show(view({ state: "accepted", ver: 2, acts: { accept: false, requestChange: false, decline: false, report: true, reply: true, acceptVersion: true }, pendingVersion: { n: 2, kind: "date", note: null, date: "2026-11-02" } }))
    expect(document.body.textContent).toContain("غيّر المشتري موعد التوريد")
    await act(async () => void fireEvent.click(buttonIn(document.body, "قبلت الإصدار 2") as HTMLElement))
    expect(a.calls).toEqual(["version:2"])
  })

  it("in English the same page reads in English", () => {
    setLocale("en")
    show(view())
    const text = document.body.textContent ?? ""
    expect(missingKeys.size).toBe(0)
    expect(text).toContain("Purchase order from البنيان الحديثة")
    expect(text).toContain("Total incl. VAT")
    expect(buttonIn(document.body, "Accept the order")).toBeDefined()
  })
})

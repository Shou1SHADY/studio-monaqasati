/**
 * Procurement 2.0 — finish pass, the demand side, rendered: «قادمة» with «نبّهني حين يصل», the team banner on Incoming («كما يراها صاحب
 * الطلب» · «المسار كاملاً»), a request with nothing left to buy, the request's status block, the review's attachments and internal
 * budget, «مختص» on a private recipient, and the RFQ page's «التسليم والشروط» and «الطلبات الواردة فيه».
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
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import RequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/requests/page"
import { UpcomingList } from "@/components/procurement/UpcomingList"
import { RequestStatusBlock } from "@/components/procurement/RequestStatusBlock"
import { EditorPublish, type PublishValues } from "@/components/procurement/rfq-editor/EditorPublish"
import { EditorReview, type ReviewModel } from "@/components/procurement/rfq-editor/EditorReview"
import { RfqRequestsPanel, RfqTermsPanel } from "@/components/procurement/rfq/RfqTermsPanel"
import { newTeamRequest } from "@/lib/procurement/incoming-ingest"
import { incomingDocId, type IncomingDoc } from "@/lib/procurement/incoming-state"
import { upcomingFromStock } from "@/lib/procurement/upcoming"
import type { RequestCard } from "@/lib/procurement/incoming-requests"
import type { RfqView } from "@/components/procurement/rfq/rfqOfferView"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const tree = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")
const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string; method?: string }) => {
    const u = String(url)
    if (u.includes("material-tree")) return { ok: true, json: async () => JSON.parse(tree) }
    calls.push({ url: u, method: init?.method || "GET", body: init?.body ? JSON.parse(init.body) : null })
    if (u.includes("upcoming-watch") && !init?.body) return { ok: true, json: async () => ({ success: true, data: { keys: [] } }) }
    return { ok: true, json: async () => ({ success: true, data: {} }) }
  })
})

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}
const text = () => document.body.textContent ?? ""
const tabs = () => Array.from(document.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]
const tab = (label: string) => tabs().find((t) => (t.textContent || "").startsWith(label))
const link = (label: string) => Array.from(document.querySelectorAll("a")).find((a) => (a.textContent || "").trim() === label)
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim().includes(label)) as HTMLButtonElement | undefined

const DAY = 86_400_000
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
const base = (id: string, no: string): IncomingDoc =>
  newTeamRequest({
    organizationId: ORG,
    id,
    no,
    seq: Number(no.slice(-3)),
    lines: [{ name: "الاسمنت العادي", unit: "كيس", quantity: 200 }],
    needBy: day(20),
    place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
    requestedBy: { id: "eng1", name: "م. فهد العتيبي" },
    requestedFor: { kind: "member", id: "eng1", name: "م. فهد العتيبي" },
    at: "2026-10-20T08:00:00.000Z",
  })
const put = (doc: IncomingDoc) => seed(`procIncoming/${incomingDocId(ORG, doc.mrKey)}`, doc as unknown as Record<string, unknown>)

beforeEach(() => {
  resetFakeDb()
  calls.length = 0
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG })
  setSignedIn(ORG)
  missingKeys.clear()
})

describe("«الواردة» without Project Management says where requests come from, and opens the requester's view and the full path", () => {
  it("the banner carries the prototype's sentence and two doors", async () => {
    put(base("a", "MAT-2026/021"))
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("بلا إدارة المشاريع: الطلبات يرفعها الفريق من «طلباتي» بدور «طالب مواد»")
    expect(link("كما يراها صاحب الطلب")?.getAttribute("href")).toBe("/contractor/rfqs/my-requests")
    expect(link("المسار كاملاً")?.getAttribute("href")).toBe("/contractor/rfqs/guide?from=incoming")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("with Project Management on there is no such banner", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: [] })
    put(base("a", "MAT-2026/021"))
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).not.toContain("بلا إدارة المشاريع: الطلبات يرفعها الفريق")
    view.unmount()
  })
})

describe("«قادمة» (INC-06)", () => {
  it("says «لا شيء قادم» with the sentence that it is for preparing, never for buying", async () => {
    setPathname("/contractor/rfqs/requests", "seg=upcoming")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("لا شيء قادم")
    expect(text()).toContain("«قادمة» للاستعداد لا للشراء: لا يُنشر طلب قبل اعتماده الفني.")
    view.unmount()
  })

  it("lists a project's request awaiting technical approval and counts it on the segment; «نبّهني حين يصل» watches it", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: [] })
    seed("projects/P1", { organizationId: ORG, name: "مجمع الياسمين" })
    seed("projects/P1/purchaseRequests/05", { pm: true, seq: 5, status: "pending", needBy: day(30), requestedByUserName: "م. فهد", createdAt: new Date().toISOString(), lines: [{ itemId: "i1", code: "05-01", key: "k", name: "اسياخ حديد التسليح 16", unit: "طن", qty: 12 }] })
    setPathname("/contractor/rfqs/requests", "seg=upcoming")
    const view = render(<RequestsPage />)
    await flush()
    expect(tab("قادمة")?.textContent).toBe("قادمة1")
    expect(text()).toContain("ط.م 05")
    expect(text()).toContain("مجمع الياسمين")
    expect(text()).toContain("بانتظار الاعتماد")
    expect(text()).toContain("بانتظار الاعتماد الفني من مدير المشروع منذ")
    const notify = button("نبّهني حين يصل")!
    expect(notify).toBeDefined()
    await act(async () => void fireEvent.click(notify))
    await flush()
    const post = calls.find((c) => c.url.includes("upcoming-watch") && c.method === "POST")
    expect(post?.body).toEqual({ key: "pm:P1:05", on: true })
    expect(button("ستُنبَّه")).toBeDefined()
    await act(async () => void fireEvent.click(button("ستُنبَّه")!))
    await flush()
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ key: "pm:P1:05", on: true }, { key: "pm:P1:05", on: false }])
    expect(button("نبّهني حين يصل")).toBeDefined()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("lists a stock item close above its minimum as «مخطط», with its last price column left out when none was paid", async () => {
    seed("warehouses/w1", { organizationId: ORG, name: "المستودع المركزي" })
    seed("warehouses/w1/inventoryItems/i1", { name: "اسمنت عادي", quantity: 110, minStockLevel: 100, unit: "كيس" })
    seed("warehouses/w1/inventoryItems/i2", { name: "رمل", quantity: 500, minStockLevel: 100, unit: "م³" })
    setPathname("/contractor/rfqs/requests", "seg=upcoming")
    const view = render(<RequestsPage />)
    await flush()
    expect(tab("قادمة")?.textContent).toBe("قادمة1")
    expect(text()).toContain("اسمنت عادي")
    expect(text()).not.toContain("رمل")
    expect(text()).toContain("مخطط")
    expect(text()).toContain("الرصيد 110 قريب من حدّه الأدنى 100")
    view.unmount()
  })
})

describe("a request with nothing left to buy", () => {
  it("opens its panel with the reason and no editor — each material is issued, made or waits for a reply", async () => {
    const d = base("held", "MAT-2026/031")
    put({ ...d, lines: d.lines.map((l) => ({ ...l, stk: { st: "wait" as const, at: new Date().toISOString() } })) })
    setPathname("/contractor/rfqs/requests", "publish=team:held&step=1")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("لا شيء للشراء الآن: كل مادة إما يصرفها المخزون أو تصنعها الورشة أو تنتظر ردّهما.")
    expect(button("التالي: النشر")).toBeUndefined()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

const card = (over: Partial<RequestCard>): RequestCard =>
  ({ key: "k", need: { incoming: undefined } as unknown as RequestCard["need"], rows: [], state: "new", buyLines: 1, remainder: false, lastOrderDay: null, lastOrderIn: null, needBy: null, draftId: null, selectable: true, rfqs: [], orders: [], withdrawal: null, changes: [], failed: null, ...over }) as RequestCard

describe("the request's status block", () => {
  const show = (c: RequestCard, extra: Partial<React.ComponentProps<typeof RequestStatusBlock>> = {}) => render(<RequestStatusBlock card={c} rfqDeadline="2026-11-05" order={null} {...extra} />)

  it("in an RFQ: its number and when it closes, and that Projects reads the same status", () => {
    const v = show(card({ state: "rfq", buyLines: 0, rfqs: [{ id: "R1", number: "RFQ-2026/004" }] }))
    expect(text()).toContain("في طلب عروض RFQ-2026/004 · تُغلق")
    expect(text()).toContain("وهذه الحالة نفسها تقرؤها إدارة المشاريع على كل مادة.")
    v.unmount()
  })

  it("in an order: its number, then the supplier and its date", () => {
    const v = show(card({ state: "order", buyLines: 0, orders: [{ id: "P1", number: "PO-2026/012" }] }), { order: { supplierName: "مورد الأفق", dueDate: "2026-11-09" } })
    expect(text()).toMatch(/في أمر شراء .*012 · مورد الأفق · موعده/)
    v.unmount()
  })

  it("complete · prepared · withdrawn · could not buy each say their sentence", () => {
    let v = show(card({ state: "done", buyLines: 0 }))
    expect(text()).toContain("اكتمل: استُلمت المواد كلها.")
    v.unmount()
    v = show(card({ state: "prepared" }))
    expect(text()).toContain("مُجهَّز: مسودة طلب عروض محفوظة. افتحها لتكمل.")
    v.unmount()
    v = show(card({ state: "withdrawn", buyLines: 0, withdrawal: { on: "2026-10-21", byName: "م. فهد" } }))
    expect(text()).toContain("قبل نشره، فانتقل إلى «انتهت».")
    v.unmount()
    v = show(card({ state: "failed", buyLines: 0, failed: { why: "غير متوفرة", alt: "مكافئ" } }))
    expect(text()).toContain("تعذّر الشراء: غير متوفرة. البديل المقترح: مكافئ.")
    v.unmount()
  })

  it("a new request with a material already in an RFQ names it, links it, and says the rest is here to publish", () => {
    const rows = [{ key: "r1", index: 0, name: "حديد 16", total: 12, unit: "طن", state: "rfq", link: { rfqId: "R9", rfqNumber: "RFQ-2026/009", poId: null, poNumber: null } }] as unknown as RequestCard["rows"]
    const v = show(card({ state: "partial", rows }))
    expect(text()).toContain("حديد 16")
    expect(text()).toContain("في عروض RFQ-2026/009")
    expect(link("في عروض RFQ-2026/009")?.getAttribute("href")).toBe("/contractor/rfqs/R9")
    expect(text()).toContain("والباقي هنا للنشر.")
    v.unmount()
  })
})

describe("UpcomingList", () => {
  const items = upcomingFromStock([{ id: "i1", warehouseId: "w1", warehouseName: "المستودع المركزي", name: "اسمنت عادي", unit: "كيس", quantity: 110, minStockLevel: 100 }])

  it("shows «مخطط», the watch state and the preparing-not-buying sentence; the button hands its key to the page", async () => {
    const onWatch = jest.fn(async () => true)
    const v = render(<UpcomingList items={items} loading={false} watched={new Set()} onWatch={onWatch} history={[]} />)
    expect(text()).toContain("مخطط")
    expect(text()).toContain("المستودع المركزي")
    await act(async () => void fireEvent.click(button("نبّهني حين يصل")!))
    expect(onWatch).toHaveBeenCalledWith("stock:w1:i1", true)
    v.unmount()
    const w = render(<UpcomingList items={items} loading={false} watched={new Set(["stock:w1:i1"])} onWatch={onWatch} history={[]} />)
    expect(button("ستُنبَّه")?.getAttribute("aria-pressed")).toBe("true")
    await act(async () => void fireEvent.click(button("ستُنبَّه")!))
    expect(onWatch).toHaveBeenLastCalledWith("stock:w1:i1", false)
    w.unmount()
  })
})

describe("the editor's review and publishing step", () => {
  const model = (over: Partial<ReviewModel> = {}): ReviewModel => ({ lines: 3, subs: 2, groups: 1, audience: "public", reach: 9, favourite: null, perSub: [], privateCount: 0, directName: null, deadline: "2026-10-25", daysToDeadline: 3, pricing: "line", link: true, terms: "100%", delivery: "x", files: [], budget: null, noSpec: [], outside: [], unitDiffers: [], ...over })

  it("lists the attachments and the internal budget with «لا يراها المورد» — only when there are", () => {
    const a = render(<EditorReview model={model()} fmtDay={(d) => d} />)
    expect(text()).not.toContain("لا يراها المورد")
    expect(text()).not.toContain("المرفقات")
    a.unmount()
    const b = render(<EditorReview model={model({ files: ["مخطط-الدور-الأرضي.pdf", "جدول-الكميات.pdf"], budget: "45,000" })} fmtDay={(d) => d} />)
    expect(text()).toContain("المرفقات")
    expect(text()).toContain("مخطط-الدور-الأرضي.pdf، جدول-الكميات.pdf")
    expect(text()).toContain("الميزانية الداخلية")
    expect(text()).toContain("45,000")
    expect(text()).toContain("لا يراها المورد")
    b.unmount()
  })

  const values = (over: Partial<PublishValues> = {}): PublishValues => ({ audience: "direct", deadline: "2026-10-30", pricing: "line", title: "ت", terms: [{ pct: "100", days: "30" }], termsSet: true, notes: "", budget: "", attachments: [], recipients: null, directSupplierOrgId: "", directReason: "", directNote: "", link: null, ...over })
  const mount = (v: PublishValues, extra: Partial<React.ComponentProps<typeof EditorPublish>> = {}) =>
    render(
      <EditorPublish
        values={v}
        onChange={() => undefined}
        publicReachCount={4}
        linesCount={2}
        favouriteName={null}
        recipientOptions={[{ orgId: "s1", name: "مورد الأفق", isFavorite: false }]}
        recipientFacts={new Map([["s1", { onTime: 90, crExpired: false }]])}
        selectedRecipients={["s1"]}
        directPool={[{ orgId: "s1", name: "مورد الأفق", platform: true, favourite: false }]}
        matching={new Set(["s1"])}
        estimate={null}
        directCap={5000}
        firstDeadline="2026-10-22"
        deadlineHint="hint"
        onInvite={() => undefined}
        onUpload={() => undefined}
        uploading={false}
        onRemoveAttachment={() => undefined}
        showProblems={false}
        {...extra}
      />,
    )

  it("«إسناد مباشر» says one supplier is chosen, offers the invitation and marks the matching ones «مختص»", () => {
    const v = mount(values())
    expect(text()).toContain("مورد واحد يُختار")
    expect(text()).toContain("لا تجد مورّدك؟ ادعُه إلى المنصة")
    expect(document.querySelector("option[value='s1']")?.textContent).toContain("مختص")
    v.unmount()
  })

  it("«خاص» marks the matching recipients «مختص»", () => {
    const v = mount(values({ audience: "private" }))
    expect(text()).toContain("مختص")
    v.unmount()
    const w = mount(values({ audience: "private" }), { matching: new Set<string>() })
    expect(text()).not.toContain("مختص")
    w.unmount()
  })

  it("the «خيارات أخرى» switch reads the prototype's one line", () => {
    const v = mount(values({ audience: "public" }))
    expect(text()).toContain("خيارات أخرى: الملاحظات والمرفقات · الميزانية الداخلية")
    v.unmount()
  })
})

describe("the RFQ page's «التفاصيل» tab: «التسليم والشروط» and «الطلبات الواردة فيه»", () => {
  const rfq = {
    id: "R1",
    status: "New",
    city: "الرياض",
    district: "حي الياسمين",
    deadline: "2026-11-05",
    notes: "التوريد على دفعتين",
    paymentTermsList: [{ pct: 30, days: 0 }, { pct: 70, days: 30 }],
    products: [{ name: "حديد", needBy: "2026-11-12" }, { name: "بلك", needBy: "2026-11-10" }],
    editorGroups: [{ label: "مجمع الياسمين", city: "الرياض", district: "حي الياسمين" }, { label: "برج العليا", city: "جدة", district: "" }],
    deliveryOptions: { a: { unload: "supplier", slot: "am", note: "البوابة الشمالية" } },
  } as unknown as RfqView

  it("says where it goes, when it is needed, how it is paid, the deadline, the delivery options, the access note and the notes — and extends the deadline while open", () => {
    const onExtend = jest.fn()
    const v = render(<RfqTermsPanel rfq={rfq} onExtend={onExtend} />)
    expect(text()).toContain("التسليم والشروط")
    expect(text()).toContain("التسليم في")
    expect(text()).toContain("الرياض")
    expect(text()).toContain("جدة")
    expect(text()).toContain("مطلوبة قبل")
    expect(text()).toContain("30% · 0 يوماً بعد الفاتورة + 70% · 30 يوماً بعد الفاتورة")
    expect(text()).toContain("الموعد النهائي")
    expect(text()).toContain("خيارات التسليم")
    expect(text()).toContain("التنزيل على المورّد · صباحاً")
    expect(text()).toContain("ملاحظة للوصول")
    expect(text()).toContain("البوابة الشمالية")
    expect(text()).toContain("ملاحظات للموردين")
    expect(text()).toContain("التوريد على دفعتين")
    fireEvent.click(button("مدّد الموعد")!)
    expect(onExtend).toHaveBeenCalled()
    v.unmount()
  })

  it("an RFQ closed early says so on the deadline row; a closed one offers no extension", () => {
    const closed = { ...rfq, status: "Awarded", closedEarly: { at: "2026-11-01", byName: "سعد", reason: "x" } } as unknown as RfqView
    const v = render(<RfqTermsPanel rfq={closed} onExtend={null} />)
    expect(text()).toMatch(/أُغلق .* قبل موعده/)
    expect(button("مدّد الموعد")).toBeUndefined()
    v.unmount()
  })

  it("lists the incoming requests whose materials it holds, each opening that request", () => {
    const doc = { ...base("a", "MAT-2026/021"), st: "rfq" as const }
    const v = render(<RfqRequestsPanel requests={[doc]} />)
    expect(text()).toContain("الطلبات الواردة فيه")
    expect(text()).toContain("ط.م-2026/021")
    expect(text()).toContain("في عروض")
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/contractor/rfqs/requests?seg=all&publish=team%3Aa&step=1")
    v.unmount()
    const none = render(<RfqRequestsPanel requests={[]} />)
    expect(text()).toBe("")
    none.unmount()
  })
})

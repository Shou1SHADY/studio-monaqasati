/**
 * Procurement 2.0 — «طلبات الشراء الواردة» over the STORED requests, «تعذّر الشراء», «طلباتي» and «طلبه» rendered for real
 * (WP-S2-03/05/08): the seven segments, a partly handled request kept in «جديدة» under «الباقي منه», the reason and the
 * alternative on an ended card, the could-not-buy dialog posting to the server, the requester's four steps with no price, and a
 * buyer raising a request on behalf of someone with no account.
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
import MyRequestsPage from "@/app/[locale]/(contractor)/contractor/rfqs/my-requests/page"
import { TeamRequestDialog } from "@/components/procurement/TeamRequestDialog"
import { newTeamRequest } from "@/lib/procurement/incoming-ingest"
import { incomingDocId, type IncomingDoc, type IncomingLine, type MyRequest } from "@/lib/procurement/incoming-state"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const tree = readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8")
const calls: Array<{ url: string; body: Record<string, unknown> | null }> = []
let mine: MyRequest[] = []

beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    const u = String(url)
    if (u.includes("material-tree")) return { ok: true, json: async () => JSON.parse(tree) }
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null })
    if (u.includes("team-requests") && !init?.body) return { ok: true, json: async () => ({ success: true, data: { requests: mine } }) }
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
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === label) as HTMLButtonElement | undefined

const DAY = 86_400_000
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
const lines3 = [
  { name: "الاسمنت العادي", unit: "كيس", quantity: 200 },
  { name: "حديد 16", unit: "طن", quantity: 12 },
  { name: "رمل لياسة", unit: "م³", quantity: 30 },
]
const base = (id: string, no: string, n = 3): IncomingDoc =>
  newTeamRequest({
    organizationId: ORG,
    id,
    no,
    seq: Number(no.slice(-3)),
    lines: lines3.slice(0, n),
    needBy: day(20),
    place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
    requestedBy: { id: "eng1", name: "م. فهد العتيبي" },
    requestedFor: { kind: "member", id: "eng1", name: "م. فهد العتيبي" },
    at: "2026-10-20T08:00:00.000Z",
  })
const put = (doc: IncomingDoc) => seed(`procIncoming/${incomingDocId(ORG, doc.mrKey)}`, doc as unknown as Record<string, unknown>)
const products = (id: string, n: number) => lines3.slice(0, n).map((l, line) => ({ name: l.name, unitOfMeasure: l.unit, needSource: { kind: "team_request", purchaseRequestId: id }, needLine: line }))
const failedLines = (doc: IncomingDoc): IncomingLine[] => doc.lines.map((l) => ({ ...l, ps: "fail" as const, fail: { code: "avail" as const, why: "المادة غير متوفرة في السوق", alt: "مكافئ من الخرج", at: "2026-10-21T08:00:00Z", by: "بدر" }, v: 2 }))

function world() {
  put(base("a", "MAT-2026/021"))
  put(base("b", "MAT-2026/022"))
  seed("rfqs/R1", { organizationId: ORG, status: "Awarded", rfqNumber: "RFQ-2026/001", deadline: day(5), products: products("b", 3), unawardedLines: [1, 2] })
  seed("purchaseOrders/PO9", { organizationId: ORG, status: "accepted", docNumber: "PO-2026/009", rfqId: "R1", lines: [{ id: "l0", name: "x", unit: "u", quantity: 200, unitPrice: 1, accepted: 0, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }] })
  put(base("c", "MAT-2026/023", 1))
  seed("rfqs/R2", { organizationId: ORG, status: "New", rfqNumber: "RFQ-2026/002", deadline: day(6), products: products("c", 1) })
  const d = base("d", "MAT-2026/024", 2)
  put({ ...d, lines: failedLines(d), st: "fail", status: "closed" })
  const w = base("w", "MAT-2026/025", 1)
  put({ ...w, st: "wd", status: "closed", withdrawn: { at: "2026-10-21T08:00:00Z", by: "eng1", name: "م. فهد العتيبي" } })
  put(base("e", "MAT-2026/026", 1))
  seed("rfqs/R3", { organizationId: ORG, status: "Awarded", rfqNumber: "RFQ-2026/003", products: products("e", 1) })
  seed("purchaseOrders/PO8", { organizationId: ORG, status: "accepted", docNumber: "PO-2026/008", rfqId: "R3", lines: [{ id: "l0", name: "x", unit: "u", quantity: 10, unitPrice: 1, accepted: 10, rejected: 0, held: 0, cancelled: 0, rfqProductIndex: 0 }] })
}

beforeEach(() => {
  resetFakeDb()
  calls.length = 0
  mine = []
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa", isVerified: true, profileCompleted: true })
  seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["project-management"] })
  seed(`procurementSettings/${ORG}`, { organizationId: ORG })
  setSignedIn(ORG)
  missingKeys.clear()
})

describe("«طلبات الشراء الواردة» reads the stored requests", () => {
  it("shows قادمة · جديدة · مُجهَّزة · في عروض · في أوامر · اكتملت · انتهت · الكل — and no «عند غيرنا»; a partly handled request is counted in «جديدة»", async () => {
    world()
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    for (const label of ["قادمة", "جديدة", "مُجهَّزة", "في عروض", "في أوامر", "اكتملت", "انتهت", "الكل"]) expect({ label, shown: Boolean(tab(label)) }).toEqual({ label, shown: true })
    expect(text()).not.toContain("عند غيرنا")
    const count = (label: string) => Number((tab(label)?.textContent || "").replace(label, ""))
    expect({ upcoming: count("قادمة"), new: count("جديدة"), prepared: count("مُجهَّزة"), rfq: count("في عروض"), order: count("في أوامر"), done: count("اكتملت"), ended: count("انتهت"), all: count("الكل") }).toEqual({ upcoming: 0, new: 2, prepared: 0, rfq: 1, order: 0, done: 1, ended: 2, all: 6 })
    expect(count("قادمة") + count("جديدة") + count("مُجهَّزة") + count("في عروض") + count("في أوامر") + count("اكتملت") + count("انتهت")).toBe(count("الكل"))
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("«جديدة»: the new request and the remainder of the partly awarded one, tagged «الباقي منه», each with its owner, its place and its last day", async () => {
    world()
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("ط.م-2026/021")
    expect(text()).toContain("ط.م-2026/022")
    expect(text()).toContain("الباقي منه")
    expect(text()).toContain("جزء منه في عروض أو أمر")
    expect(text()).toContain("طلبه م. فهد العتيبي")
    expect(text()).toContain("موقع التسليم: الرياض — الياسمين")
    expect(text()).toContain("آخر يوم للطلب")
    expect(text()).toContain("في أمر PO-2026/009")
    expect(text()).not.toContain("ط.م-2026/023")
    expect(button("انشره")).toBeDefined()
    expect(link("جهّزه")).toBeDefined()
    expect(button("تعذّر الشراء")).toBeDefined()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("«في عروض»: the request, its RFQ number and when it closes; «انتهت»: the reason and the alternative the requester reads", async () => {
    world()
    setPathname("/contractor/rfqs/requests", "seg=rfq")
    let view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("ط.م-2026/023")
    expect(text()).toContain("RFQ-2026/002")
    expect(text()).toContain("تُغلق")
    expect(text()).not.toContain("ط.م-2026/021")
    view.unmount()
    setPathname("/contractor/rfqs/requests", "seg=ended")
    view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("ط.م-2026/024")
    expect(text()).toContain("تعذّر الشراء: المادة غير متوفرة في السوق. البديل المقترح: مكافئ من الخرج. وأُبلغ من طلبه.")
    expect(text()).toContain("ط.م-2026/025")
    expect(button("انشره")).toBeUndefined()
    expect(button("تعذّر الشراء")).toBeUndefined()
    view.unmount()
    setPathname("/contractor/rfqs/requests", "seg=done")
    view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("ط.م-2026/026")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("«قادمة» is a shell: it explains itself and shows no request", async () => {
    world()
    setPathname("/contractor/rfqs/requests", "seg=upcoming")
    const view = render(<RequestsPage />)
    await flush()
    expect(text()).toContain("«قادمة» للاستعداد لا للشراء")
    expect(text()).not.toContain("ط.م-2026/021")
    view.unmount()
  })
})

describe("«تعذّر الشراء» from the card (WF-27, R-29)", () => {
  it("the button stays closed until a reason is chosen («سبب آخر» needs four characters), then posts the reason and the alternative", async () => {
    world()
    setPathname("/contractor/rfqs/requests", "")
    const view = render(<RequestsPage />)
    await flush()
    await act(async () => void fireEvent.click(document.querySelectorAll("button")[Array.from(document.querySelectorAll("button")).findIndex((b) => (b.textContent || "").trim() === "تعذّر الشراء")]))
    await flush()
    const close = () => button("أقفلها «تعذّر الشراء»") as HTMLButtonElement
    expect(close().disabled).toBe(true)
    await act(async () => void fireEvent.click(button("سبب آخر")!))
    const note = document.getElementById("rf-note") as HTMLInputElement
    await act(async () => void fireEvent.change(note, { target: { value: "xyz" } }))
    expect(close().disabled).toBe(true)
    await act(async () => void fireEvent.click(button("المادة غير متوفرة في السوق")!))
    expect(document.getElementById("rf-note")).toBeNull()
    expect(close().disabled).toBe(false)
    await act(async () => void fireEvent.change(document.getElementById("rf-alt") as HTMLInputElement, { target: { value: "مكافئ من الخرج" } }))
    await act(async () => void fireEvent.click(close()))
    await flush()
    const post = calls.find((c) => c.url.includes("/api/procurement/incoming") && c.body?.action === "fail")
    expect(post?.body).toMatchObject({ action: "fail", reason: "avail", note: null, alt: "مكافئ من الخرج" })
    expect(String(post?.body?.mrKey)).toMatch(/^team:(a|b)$/)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })
})

describe("«طلباتي» — the requester's page", () => {
  const request = (over: Partial<MyRequest>): MyRequest => ({
    id: "team:a",
    mrKey: "team:a",
    no: "MAT-2026/014",
    src: "team",
    place: { label: "مجمع الياسمين", city: "الرياض", district: "الياسمين" },
    needBy: day(20),
    createdAt: "2026-10-20T08:00:00.000Z",
    requestedFor: { kind: "member", name: "م. فهد" },
    requestedBy: "م. فهد",
    note: null,
    st: "new",
    step: "placed",
    lines: [{ name: "بلك اسمنتي 20", unit: "حبة", qty: 2000, kind: "buy" }],
    rfqNumber: null,
    poNumber: null,
    promisedDate: null,
    failed: null,
    withdrawable: true,
    ...over,
  })
  const requester = () => {
    seed("teamGroups/gReq", { organizationId: ORG, name: "طالب مواد", permissions: ["projects.view"] })
    seed("users/req1", { organizationId: ORG, organizationRole: "member", name: "م. فهد", defaultGroupId: "gReq" })
    setSignedIn("req1")
  }

  it("his page: the title, «طلب مواد جديد», the three cards, his role, each request with four steps and one line — no price, no supplier", async () => {
    requester()
    mine = [
      request({}),
      request({ id: "team:b", mrKey: "team:b", no: "MAT-2026/015", st: "po", step: "order", poNumber: "PO-2026/021", promisedDate: "2026-11-02", withdrawable: false, lines: [{ name: "حديد 16", unit: "طن", qty: 12, kind: "po" }] }),
      request({ id: "team:c", mrKey: "team:c", no: "MAT-2026/016", st: "fail", step: "failed", failed: { why: "الأسعار فوق الميزانية بكثير", alt: "مورد في الخرج" }, withdrawable: false }),
    ]
    setPathname("/contractor/rfqs/my-requests", "")
    const view = render(<MyRequestsPage />)
    await flush()
    expect(text()).toContain("طلباتي")
    expect(text()).toContain("دورك: طالب مواد")
    expect(text()).toContain("اطلب ما يحتاجه موقعك، وتابع حالته حتى يصل. الأسعار والموردون عند المشتريات.")
    expect(button("طلب مواد جديد")).toBeDefined()
    for (const card of ["اختر المادة والكمية", "الموقع والموعد", "أرسل وتابع", "كيف يسير طلبي بعد الإرسال؟"]) expect(text()).toContain(card)
    expect(text()).toContain("ط.م-2026/014")
    for (const step of ["عند المشتريات", "في عروض", "في أمر", "وصلت"]) expect(text()).toContain(step)
    expect(text()).toContain("عند المشتريات — لم يُنشر بعد")
    // The order is named as the prototype's `teamStatus` names it (IN-15): its number in Arabic and the supplier's date — never the supplier.
    expect(text()).toContain("في أمر ط.ش-2026/021 · موعد المورد")
    expect(text()).toContain("تعذّر الشراء: الأسعار فوق الميزانية بكثير. البديل المقترح: مورد في الخرج")
    expect(button("اسحبه")).toBeDefined()
    expect(document.querySelectorAll('button')).toBeTruthy()
    expect(text()).not.toContain("PO-2026/021")
    expect(text()).not.toContain("RFQ-")
    expect(text()).not.toMatch(/ر\.س|SAR|⃁/)
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("an owner who is not a requester sees no role line; with Projects in the package the page points to the project", async () => {
    setPathname("/contractor/rfqs/my-requests", "")
    let view = render(<MyRequestsPage />)
    await flush()
    expect(text()).not.toContain("دورك: طالب مواد")
    view.unmount()
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: [] })
    view = render(<MyRequestsPage />)
    await flush()
    expect(text()).toContain("المواد تُطلب من المشروع")
    expect(button("طلب مواد جديد")).toBeUndefined()
    view.unmount()
  })

  it("empty: he has asked for nothing yet", async () => {
    requester()
    setPathname("/contractor/rfqs/my-requests", "")
    const view = render(<MyRequestsPage />)
    await flush()
    expect(text()).toContain("لا طلبات بعد")
    view.unmount()
  })
})

describe("«طلبه» — raising a request on behalf (REQ-03)", () => {
  const open = async () => {
    const view = render(<TeamRequestDialog open onOpenChange={() => undefined} orgId={ORG} />)
    await flush()
    return view
  }

  it("a buyer picks a member, or a receiver with no account (disabled without a mobile); the choice goes with the request", async () => {
    seed("users/eng1", { organizationId: ORG, organizationRole: "member", name: "م. سامي الدوسري", email: "s@t.sa" })
    seed("procurementReceivers/r1", { organizationId: ORG, name: "سالم القحطاني", title: "مراقب موقع", module: "projects", phone: "0500000001", warehouseIds: [], active: true })
    seed("procurementReceivers/r2", { organizationId: ORG, name: "بلا جوال", title: "x", module: "projects", phone: "", warehouseIds: [], active: true })
    const view = await open()
    const select = document.getElementById("tr-for") as HTMLSelectElement
    expect(select).not.toBeNull()
    const options = Array.from(select.options).map((o) => [o.textContent, o.disabled])
    expect(options[0][0]).toBe("أنا")
    expect(options).toEqual(expect.arrayContaining([["م. سامي الدوسري", false], ["سالم القحطاني — بلا حساب", false], ["بلا جوال — بلا حساب", true]]))
    expect(text()).toContain("ترفعه نيابةً عمّن لا حساب له، وتصله حالته برسالة على جواله.")
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a member who only asks has no such field", async () => {
    seed("teamGroups/gReq", { organizationId: ORG, name: "طالب مواد", permissions: ["projects.view"] })
    seed("users/req1", { organizationId: ORG, organizationRole: "member", name: "م. فهد", defaultGroupId: "gReq" })
    setSignedIn("req1")
    const view = await open()
    expect(document.getElementById("tr-for")).toBeNull()
    view.unmount()
  })
})

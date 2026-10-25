/**
 * Procurement 2.0 prototype gaps — Today and Incoming (gap report 01: TD-01…05, IN-01…18).
 * Today: the row's icon is its KIND (the tile colour stays the urgency); questions are one row per RFQ; «الباقي منه» is a pill;
 * the invitations fold after five. Incoming: which panel a press opens (a prepared request with a saved draft reads only — never a
 * second draft), the request's stored history, the guide's way back and its on-behalf door, and the read-only request panel.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import fs from "fs"
import path from "path"
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { installDomShims, missingKeys, setLocale } from "@/test-utils/render-world"
import { todayTasks, type ProcWorld, type RfqFact, type Task } from "@/lib/procurement/today"
import { DEFAULT_POLICIES, type ProcActor } from "@/lib/procurement/types"
import { TodayItem, taskIcon } from "@/components/procurement/TodayItem"
import { TodayInvitations } from "@/components/procurement/TodayInvitations"
import { canFailRequest, requestEnded, requestPanelMode } from "@/lib/procurement/request-facts"
import { REQUEST_LOG_ACTS, requestLogRows } from "@/lib/procurement/request-log"
import { flowStations, guideBackHref, INCOMING_HREF, MY_REQUESTS_HREF, RAISE_HREF } from "@/lib/procurement/guide"
import { RequestReadPanel } from "@/components/procurement/RequestReadPanel"
import type { RequestCard } from "@/lib/procurement/incoming-requests"
import type { IncomingDoc } from "@/lib/procurement/incoming-state"
import { UpcomingList } from "@/components/procurement/UpcomingList"
import { TeamApprovalsSection } from "@/components/procurement/TeamApprovalsSection"
import type { TeamApprovalView } from "@/lib/procurement/team-approval"
import type { UpcomingItem } from "@/lib/procurement/upcoming"

installDomShims()

const NOW = new Date("2026-09-22T08:00:00Z")
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10)
const MANAGER: ProcActor = { uid: "mgr", name: "Manager", isOwner: false, canApprove: true, canPrepare: true, canExpedite: true, canReceive: false, seesPrices: true }
const rfq = (over: Partial<RfqFact> = {}): RfqFact => ({ id: "r1", status: "New", deadline: day(4), title: "Rebar for Tower A", number: "RFQ-2026/011", offersCount: 0, products: [{ name: "Rebar 12 mm", quantity: 100, unit: "t" }], ...over })
const world = (over: Partial<ProcWorld> = {}): ProcWorld => ({ orders: [], receipts: [], rfqs: [], offers: [], policies: DEFAULT_POLICIES, supplierFacts: {}, ...over })
const messages = (l: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${l}.json`), "utf8")) as Record<string, unknown>
const at = (obj: Record<string, unknown>, dotted: string): unknown => dotted.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), obj)

beforeEach(() => missingKeys.clear())

describe("Today — TD-02: one question row per RFQ", () => {
  it("counts the RFQ's unanswered questions on ONE row, quoting the first and counting the rest", () => {
    const queries = [1, 2, 3, 4, 5].map((n) => ({ id: `q${n}`, rfqId: "r1", question: `Q${n}`, answered: n === 5 }))
    const rows = todayTasks(world({ rfqs: [rfq()], rfqQueries: queries }), MANAGER, NOW).filter((x) => x.kind === "rfq_query")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: "rfq_query:r1", titleParams: { count: 4 }, subParams: { question: "Q1", more: 3 } })
  })

  it("a second RFQ has its own row", () => {
    const queries = [{ id: "a", rfqId: "r1", question: "A", answered: false }, { id: "b", rfqId: "r2", question: "B", answered: false }]
    const rows = todayTasks(world({ rfqs: [rfq(), rfq({ id: "r2", number: "RFQ-2026/012" })], rfqQueries: queries }), MANAGER, NOW).filter((x) => x.kind === "rfq_query")
    expect(rows.map((r) => r.id).sort()).toEqual(["rfq_query:r1", "rfq_query:r2"])
  })
})

const task = (over: Partial<Task>): Task => ({ id: "t", kind: "approve", chip: "po", tier: "normal", severity: "amber", due: 0, titleKey: "task.need_request.title", titleParams: { ref: "MAT-2026/004", place: "Site A", remainder: 0 }, subKey: "task.need_request.sub", subParams: { count: 1, date: day(2), when: "future", n: 2 }, subNs: "ProcToday", amount: null, basis: null, href: "/x", actionKey: "actions.publishRequest", ...over })

describe("Today — TD-01 / TD-03: the row's icon and the remainder pill", () => {
  it("the icon names the kind: request · RFQ · question · no live offer · order · receipt", () => {
    const iconOf = (kind: Task["kind"], chip: Task["chip"]) => {
      const Icon = taskIcon({ kind, chip })
      const { container, unmount } = render(<Icon />)
      const name = container.querySelector("svg")?.getAttribute("data-icon")
      unmount()
      return name
    }
    expect([iconOf("need_request", "req"), iconOf("rfq_award", "rfq"), iconOf("rfq_query", "rfq"), iconOf("rfq_no_live", "rfq"), iconOf("approve", "po"), iconOf("delivery_reported", "rcv")]).toEqual(["Inbox", "Scale", "Mail", "AlertTriangle", "FileText", "Truck"])
  })

  it("renders the kind's icon and «الباقي منه» as a pill, not inside the title", () => {
    const { container } = render(<ul><TodayItem task={task({ kind: "need_request", chip: "req", titleParams: { ref: "MAT-2026/004", place: "Site A", remainder: 1 } })} /></ul>)
    expect(container.querySelector("[data-icon='Inbox']")).not.toBeNull()
    const title = container.querySelector("p")
    expect(title?.textContent).toContain("الباقي منه")
    expect(title?.querySelector("span")?.textContent).toBe("الباقي منه")
    expect(missingKeys.size).toBe(0)
  })
})

describe("Today — a row in English with an Arabic title (UI review)", () => {
  it("keeps the sentence in the page's direction and isolates the title, so the English words stay in order", () => {
    setLocale("en")
    try {
      const { container } = render(
        <ul>
          <TodayItem task={task({ kind: "rfq_award", chip: "rfq", titleKey: "task.rfq_award.title", titleParams: { ref: "طلب عروض أسعار - حديد تسليح", count: 1 }, subKey: "task.rfq_award.sub", subParams: { title: "طلب عروض أسعار - حديد تسليح", date: "2026-09-12", when: "past", n: 43 }, actionKey: "actions.compareAward" })} />
        </ul>,
      )
      const [title, sub] = Array.from(container.querySelectorAll("p"))
      expect(title.getAttribute("dir")).toBeNull()
      expect(sub.getAttribute("dir")).toBeNull()
      expect(title.textContent).toBe("\u2068طلب عروض أسعار - حديد تسليح\u2069 closed with 1 offer")
      expect(sub.textContent).toMatch(/^\u2068طلب عروض أسعار - حديد تسليح\u2069 · award by /)
      expect(missingKeys.size).toBe(0)
    } finally {
      setLocale("ar")
    }
  })

  it("on a phone the buttons take the width beside the icon's indent — never the full row plus the indent", () => {
    const { container } = render(<ul><TodayItem task={task({})} /></ul>)
    const actions = container.querySelector("li > div:last-child") as HTMLElement
    expect(actions.className).toContain("max-sm:ms-11")
    expect(actions.className).toContain("max-sm:basis-[calc(100%-2.75rem)]")
    expect(actions.className).not.toMatch(/max-sm:basis-full/)
    expect(actions.querySelector("a")?.className).toContain("min-h-11")
  })
})

describe("Today — TD-05: the invitations fold after five", () => {
  it("shows five, then «عرض N أخرى» opens the rest", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, name: `Supplier ${i}`, state: "sent" as const, sentDay: day(-i), channel: null, verified: false }))
    render(<TodayInvitations rows={rows as unknown as Parameters<typeof TodayInvitations>[0]["rows"]} />)
    expect(screen.getAllByText(/^Supplier/)).toHaveLength(5)
    fireEvent.click(screen.getByRole("button", { name: /2/ }))
    expect(screen.getAllByText(/^Supplier/)).toHaveLength(7)
    expect(missingKeys.size).toBe(0)
  })
})

describe("Incoming — which panel a press opens (IN-02, IN-03)", () => {
  it("new and partial open the editor; prepared with a saved draft reads only; ended requests read only", () => {
    expect(requestPanelMode({ state: "new", draftId: null })).toBe("editor")
    expect(requestPanelMode({ state: "partial", draftId: null })).toBe("editor")
    expect(requestPanelMode({ state: "prepared", draftId: "d1" })).toBe("read")
    expect(requestPanelMode({ state: "prepared", draftId: null })).toBe("editor")
    for (const s of ["rfq", "order", "done", "failed", "withdrawn"] as const) expect(requestPanelMode({ state: s, draftId: null })).toBe("read")
  })

  it("ended requests are dimmed; «تعذّر الشراء» needs a stored request with something to buy", () => {
    expect(["done", "failed", "withdrawn"].every((s) => requestEnded(s as RequestCard["state"]))).toBe(true)
    expect(requestEnded("rfq")).toBe(false)
    expect(canFailRequest({ buyLines: 1, need: { incoming: {} } }, true)).toBe(true)
    expect(canFailRequest({ buyLines: 0, need: { incoming: {} } }, true)).toBe(false)
    expect(canFailRequest({ buyLines: 1, need: {} }, true)).toBe(false)
    expect(canFailRequest({ buyLines: 1, need: { incoming: {} } }, false)).toBe(false)
  })
})

describe("Incoming — the request's history (IN-05)", () => {
  const doc = { lines: [{ no: 1, name: "Rebar" }, { no: 2, name: "Mesh" }], log: [{ at: "2026-09-01T08:00:00Z", by: "Sara", act: "created" }, { at: "2026-09-03T08:00:00Z", by: "Badr", act: "rfq", line: 2, note: "RFQ-2026/011" }, { at: "2026-09-02T08:00:00Z", by: "x", act: "brand_new_act" }] } as unknown as IncomingDoc

  it("newest first, the line named, an unknown act kept under a neutral sentence", () => {
    const rows = requestLogRows(doc)
    expect(rows.map((r) => r.act)).toEqual(["rfq", "other", "created"])
    expect(rows[0]).toMatchObject({ by: "Badr", line: "Mesh", note: "RFQ-2026/011" })
    expect(rows[1].raw).toBe("brand_new_act")
    expect(requestLogRows(null)).toEqual([])
  })

  it("every act the server writes has its sentence in both languages", () => {
    for (const l of ["ar", "en"]) {
      const m = messages(l)
      for (const act of [...REQUEST_LOG_ACTS, "other"]) expect(typeof at(m, `Portal.Shared.rq_log_act_${act}`)).toBe("string")
    }
  })

  it("every act the incoming server names is one the screen knows", () => {
    const src = ["incoming-server.ts", "incoming-ingest.ts", "package-migration-server.ts", "team-approval-server.ts"].map((f) => {
      const p = path.join(process.cwd(), "src/lib/procurement", f)
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""
    })
    const named = new Set(src.flatMap((s) => Array.from(s.matchAll(/act: "([a-z_]+)"/g), (m) => m[1])))
    for (const act of named) expect(REQUEST_LOG_ACTS as readonly string[]).toContain(act)
  })
})

describe("The guide — IN-18 and the team approval line", () => {
  it("returns to where it was opened from", () => {
    expect(guideBackHref("incoming", "/contractor/rfqs/today", true)).toBe(INCOMING_HREF)
    expect(guideBackHref("incoming", "/contractor/rfqs/today", false)).toBe("/contractor/rfqs/today")
    expect(guideBackHref("mine", "/contractor/rfqs/today", true)).toBe(MY_REQUESTS_HREF)
    expect(guideBackHref(null, "/contractor/rfqs/today", true)).toBe("/contractor/rfqs/today")
    expect(guideBackHref(null, undefined, false)).toBe(MY_REQUESTS_HREF)
  })

  it("«ارفع طلباً نيابةً عنه» opens the dialog; without Projects station 1 says approval is optional", () => {
    const team = { pm: false, fin: false, mfg: false }
    const [first] = flowStations(team, team)
    expect(first.links.find((l) => l.labelKey === "btn.on_behalf_him")?.href).toBe(RAISE_HREF)
    expect(first.more).toContain("approval")
    expect(flowStations({ ...team, pm: true }, { ...team, pm: true })[0].more).not.toContain("approval")
  })
})

describe("Incoming — the request read only (IN-02, IN-03, IN-06, IN-07, IN-08)", () => {
  const doc = { src: "mfg", no: "WO-2026/063", productName: "Marble stairs", workOrderNo: "WO-2026/063", place: { label: "Workshop", city: "", district: "" }, lines: [{ no: 1, name: "Marble slab" }], log: [{ at: "2026-09-01T08:00:00Z", by: "Sara", act: "ingested" }] }
  const card = (over: Partial<RequestCard> = {}): RequestCard =>
    ({
      key: "mfg:wo1:pr1",
      need: { kind: "mfg", refLabel: "WO-2026/063", projectName: null, context: "Marble stairs", requestedBy: "Sara", approved: null, incoming: doc, stock: null, rfqId: null, rfqNumber: null, poId: null, poNumber: null },
      rows: [{ key: "row1", name: "Marble slab", unit: "m2", total: 22, open: 22, state: "rfq", index: 0 }],
      state: "rfq",
      buyLines: 0,
      remainder: false,
      lastOrderDay: null,
      lastOrderIn: null,
      needBy: day(30),
      draftId: null,
      selectable: false,
      rfqs: [{ id: "r1", number: "RFQ-2026/011" }],
      orders: [],
      withdrawal: null,
      changes: [],
      failed: null,
      ...over,
    }) as unknown as RequestCard

  it("shows every material with its state as a door to its line, the source chip, the product, and the history", () => {
    const onLine = jest.fn()
    render(<RequestReadPanel card={card()} rfqDeadline={day(4)} order={null} canAct onLine={onLine} />)
    fireEvent.click(screen.getByRole("button", { name: /Marble slab|رخام|Marble/ }))
    expect(onLine).toHaveBeenCalledWith("row1")
    expect(screen.getByTestId("source-mfg")).toBeTruthy()
    expect(screen.getByText(/Marble stairs · أمر التشغيل/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "افتح طلب العروض" }).getAttribute("href")).toBe("/contractor/rfqs/r1")
    expect(screen.getByText("السجل")).toBeTruthy()
    expect(missingKeys.size).toBe(0)
  })

  it("a prepared request offers «افتح المسودة» on its draft — never a second draft", () => {
    render(<RequestReadPanel card={card({ state: "prepared", draftId: "d9", buyLines: 1 })} rfqDeadline={null} order={null} canAct onLine={() => {}} />)
    expect(screen.getByRole("link", { name: "افتح المسودة" }).getAttribute("href")).toBe("/contractor/rfqs/new?edit=d9")
    expect(screen.queryByText("جهّزه")).toBeNull()
  })
})

describe("«قادمة» and «طلباتي» — the new sources render (IN-11, IN-12, IN-17)", () => {
  it("a team request awaiting approval names its approvers; a planned work order its number; a stock item its days and eta", () => {
    const items: UpcomingItem[] = [
      { key: "team:t1", kind: "team", ref: "MAT-2026/004", place: "Site", by: "Fahd", since: day(-2), lines: [{ name: "Cement", unit: "bag", qty: 5 }], needBy: day(10), stock: null, approvers: ["Owner", "Manager"] },
      { key: "wo:p", kind: "workorder", ref: null, place: "Marble countertop", by: null, since: null, lines: [{ name: "Slab", unit: "m2", qty: 6 }], needBy: day(20), stock: null, workOrder: { no: "WO-2026/063", product: "Marble countertop" } },
      { key: "stock:w:i", kind: "stock", ref: null, place: "Main", by: null, since: null, lines: [{ name: "Sand", unit: "m3", qty: 10 }], needBy: null, stock: { onHand: 280, min: 100 }, etaDays: 9, perDay: 20 },
    ]
    render(<UpcomingList items={items} loading={false} watched={new Set()} onWatch={async () => true} history={[]} />)
    expect(screen.getByText(/Owner أو Manager/)).toBeTruthy()
    expect(screen.getByText("أمر التشغيل WO-2026/063")).toBeTruthy()
    expect(screen.getByText(/يكفي 9 أيام/)).toBeTruthy()
    expect(screen.getByText("يُتوقع وصوله خلال 9 أيام")).toBeTruthy()
    expect(missingKeys.size).toBe(0)
  })

  it("the approver approves or returns with a reason; the requester reads who holds it and may withdraw", async () => {
    const calls: Array<Record<string, unknown>> = []
    global.fetch = jest.fn(async (_u: unknown, init?: { body?: string }) => {
      calls.push(JSON.parse(init?.body || "{}"))
      return { ok: true, json: async () => ({ success: true }) }
    }) as unknown as typeof fetch
    const view = (over: Partial<TeamApprovalView>): TeamApprovalView => ({ id: "t1", mrKey: "team:t1", no: "MAT-2026/004", st: "wait", place: { label: "Site", city: "", district: "" }, siteId: null, needBy: day(10), note: null, lines: [{ name: "Cement", unit: "bag", qty: 5, needBy: null, material: null }], requestedBy: "Fahd", requestedFor: "Fahd", sentAt: `${day(-3)}T08:00:00Z`, createdAt: `${day(-3)}T08:00:00Z`, waitingDays: 3, approvers: ["Owner", "Manager"], returned: null, canDecide: true, mine: false, overdue: true, ...over })
    const onChanged = jest.fn()
    render(<TeamApprovalsSection approvals={[view({}), view({ id: "t2", mrKey: "team:t2", no: "MAT-2026/005", canDecide: false, mine: true, overdue: false })]} orgId="own" onChanged={onChanged} />)
    expect(screen.getByText("بانتظار اعتمادك")).toBeTruthy()
    expect(screen.getByText(/مع Owner أو Manager للاعتماد/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "أعده للتعديل" }))
    const send = screen.getByRole("button", { name: "أعده" }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "راجع الكميات" }))
    expect(send.disabled).toBe(false)
    expect(missingKeys.size).toBe(0)
  })
})

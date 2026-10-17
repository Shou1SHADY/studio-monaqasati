/**
 * Supplier 1.0 — the lists' layout, the address, messages and notifications (audit of 15 Oct
 * 2026: MSG-01…03, NAV-03…06, NFR-03/05/07, RFQ-02/08/10, B-04; the frame and the home: supplier-free-unified-frame.test.tsx).
 * Each case fails on the code before the fix.
 */

import React from "react"
import { act, render, renderHook, screen } from "@testing-library/react"

jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }
let mockSearch = ""
let mockPath = "/supplier/rfqs"
jest.mock("@/i18n/routing", () => {
  const R = jest.requireActual<typeof import("react")>("react")
  return {
    Link: R.forwardRef<HTMLAnchorElement, { href: string; children?: React.ReactNode }>(function Link({ href, children, ...rest }, ref) {
      const { scroll: _s, ...props } = rest as Record<string, unknown>
      return R.createElement("a", { ref, href, ...props }, children)
    }),
    usePathname: () => mockPath,
    useRouter: () => mockRouter,
  }
})
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => mockPath,
  useParams: () => ({}),
  useRouter: () => mockRouter,
}))

const mockUpdateDoc = jest.fn(async (..._a: unknown[]) => undefined)
jest.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join("/") }),
  updateDoc: (...a: unknown[]) => mockUpdateDoc(...a),
  arrayRemove: (...v: unknown[]) => ({ __op: "arrayRemove", v }),
  arrayUnion: (...v: unknown[]) => ({ __op: "arrayUnion", v }),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  deleteField: jest.fn(),
  serverTimestamp: jest.fn(),
  increment: jest.fn(),
  writeBatch: jest.fn(),
}))
jest.mock("@/firebase", () => ({
  useFirestore: () => null,
  useUser: () => ({ user: null, isUserLoading: false }),
  useCollection: () => ({ data: null, isLoading: false }),
  useDoc: () => ({ data: null, isLoading: false }),
  useMemoFirebase: (f: () => unknown) => f(),
  useStorage: () => null,
  useAuth: () => null,
}))
jest.mock("@/hooks/useSupplierPlan", () => ({
  useSupplierPlan: jest.fn(() => ({ plan: "free", loading: true, orgId: null })),
}))
let mockFree: Record<string, unknown> = {}
jest.mock("@/components/supplier-free/ActionsProvider", () => ({ useActions: () => ({ open: jest.fn() }) }))
jest.mock("@/components/supplier-free/useFree", () => ({ useFree: () => mockFree }))

import { installDomShims, intlMock, setLocale } from "@/test-utils/render-world"
import { protoWorld } from "@/test-utils/supplier-free-world"
import { useSupplierPlan } from "@/hooks/useSupplierPlan"
import { chatOf, deriveWorld, type RawWorld } from "@/lib/supplier-free/derive"
import { createWorldLogic } from "@/lib/supplier-free/world-logic"
import { dayGroup, fmtN, leadWithName, makeFmt, relKey, riyadhDayOf } from "@/lib/supplier-free/format"
import type { Deal, World } from "@/lib/supplier-free/types"
import { readView, stk, useListSelection, useQueryState, writeView } from "@/components/supplier-free/ui"
import { connectionHref, freeChatTarget, messageThreads, FreeSearch } from "@/components/supplier-free/FreeInbox"
import { markChatRead, unreadMarks } from "@/components/supplier-free/DealSections"
import { closeContractors } from "@/components/supplier-free/FreeWorldProvider"
import { quoteGuard } from "@/components/supplier-free/QuoteDialog"
import { DealDrawer } from "@/components/supplier-free/DealDrawer"
import { PlanSwitch, SupplierPlanContext } from "@/components/supplier-free/PlanSwitch"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

installDomShims()

const ME = "sup1"
const raw = (over: Partial<RawWorld> = {}): RawWorld => ({
  today: "2026-10-11",
  myOrgId: ME,
  rfqs: [],
  offers: [],
  pos: [],
  deliveries: [],
  invoices: [],
  transfers: [],
  warranties: [],
  chats: [],
  contractors: { con1: { companyName: "Al Bina" } },
  links: [],
  invitations: [],
  archived: {},
  seen: {},
  declined: {},
  myUid: ME,
  questions: {},
  ...over,
})
const rfq = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  organizationId: "con1",
  rfqNumber: "RFQ-2026/031",
  title: "Block",
  category: "x",
  city: "Riyadh",
  status: "New",
  visibility: "public",
  createdAt: "2026-10-08T08:00:00.000Z",
  deadline: "2026-10-20",
  needBy: "2026-10-25",
  products: [{ name: "Block", quantity: 10, unitOfMeasure: "pc" }],
  ...over,
})

function makeFree(over: { world?: World; today?: string; ready?: boolean; profile?: Record<string, unknown> | null } = {}) {
  setLocale("en")
  const t = intlMock.useTranslations("SupplierFree")
  const today = over.today || "2026-10-11"
  const world: World = over.world || { deals: [], contractors: {}, invites: [], requests: [], arch: {}, seen: {} }
  const L = createWorldLogic(today, world)
  const fmt = makeFmt("en", { cur: t("cur"), thousand: t("unitK"), million: t("unitM") }, 2026)
  const pl = (k: string, n: number) => t(k, { n, c: fmtN(n) })
  const rel = (iso: string) => {
    const r = relKey(L.daysTo(iso))
    return r.key === "inX" || r.key === "agoX" ? t(r.key, { x: pl("pl_day", r.days) }) : t(r.key)
  }
  return {
    ready: over.ready ?? true,
    today,
    world,
    L,
    profile: over.profile === undefined ? { uid: "u1", orgId: "u1", name: "Sami Ali", companyName: "Al Noor Trading", phone: "+966512345678", email: "", city: "", specializations: [], coverageCities: [], isVerified: false, raw: {} } : over.profile,
    pos: [],
    refreshInvites: jest.fn(),
    rawRfq: () => null,
    rawOffer: () => null,
    poOf: () => null,
    archive: jest.fn(),
    markSeen: jest.fn(),
    t,
    tCat: t,
    locale: "en",
    isAr: false,
    fmt,
    pl,
    rel,
  }
}

beforeEach(() => {
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockUpdateDoc.mockClear()
  mockSearch = ""
  mockPath = "/supplier/rfqs"
})

// ---- NFR-05 / RFQ-02: every day is Riyadh's ----------------------------------------------------------------

describe("days are Riyadh days", () => {
  it("a request posted at 22:30 UTC is the next day's in Riyadh", () => {
    const w = deriveWorld(raw({ rfqs: [rfq({ createdAt: "2026-10-08T22:30:00.000Z" })] }))
    expect(w.deals[0].posted).toBe("2026-10-09")
  })
  it("a deadline stored as Riyadh midnight stays on its own day; a bare date stays as written", () => {
    expect(riyadhDayOf("2026-10-12T21:00:00.000Z")).toBe("2026-10-13")
    expect(riyadhDayOf("2026-10-13")).toBe("2026-10-13")
    expect(riyadhDayOf({ seconds: Date.parse("2026-10-08T22:30:00Z") / 1000 })).toBe("2026-10-09")
  })
})

// ---- MSG-02: the messages page ---------------------------------------------------------------------------------

describe("the conversations list", () => {
  it("reads the time every writer stamps (lastMessageAt) and orders on the full moment", () => {
    const a = chatOf({ id: "o1", lastMessage: "hi", lastMessageAt: "2026-10-10T08:00:00.000Z" }, ME, "o1")
    const b = chatOf({ id: "o2", lastMessage: "later", lastMessageAt: "2026-10-10T15:00:00.000Z" }, ME, "o2")
    expect(a.lastAt).toBe("2026-10-10")
    expect(a.lastTs).toBe(Date.parse("2026-10-10T08:00:00.000Z"))
    const deal = (id: string, chat: Deal["chat"]) => ({ id, chat }) as unknown as Deal
    expect(messageThreads([deal("A", a), deal("B", b)]).map((d) => d.id)).toEqual(["B", "A"])
  })
  it("knows the last message was his: by the sender stamp, else by who has not read it", () => {
    expect(chatOf({ lastMessage: "x", lastSenderId: ME }, ME, "o").mine).toBe(true)
    expect(chatOf({ lastMessage: "x", lastSenderId: "con-user" }, ME, "o").mine).toBe(false)
    expect(chatOf({ lastMessage: "x", unreadFor: ["con-user"] }, ME, "o").mine).toBe(true)
    expect(chatOf({ lastMessage: "x", unreadFor: [ME], unreadCounts: { [ME]: 2 } }, ME, "o")).toMatchObject({ mine: false, unread: 2 })
  })
})

// ---- MSG-01: reading the conversation -----------------------------------------------------------------------------

describe("reading the conversation", () => {
  it("takes only the reader off the unread list — the contractor's flag stays", async () => {
    await markChatRead({} as never, "o1", ME)
    const [ref, patch] = mockUpdateDoc.mock.calls[0] as [{ path: string }, Record<string, unknown>]
    expect(ref.path).toBe("chats/o1")
    expect(patch.unreadFor).toEqual({ __op: "arrayRemove", v: [ME] })
    expect(patch[`unreadCounts.${ME}`]).toBe(0)
  })
  it("marks the last unread messages from the other side", () => {
    const list = [{ senderId: "c" }, { senderId: ME }, { senderId: "c" }, { senderId: "c" }]
    expect([...unreadMarks(list, ME, 2)].sort()).toEqual([2, 3])
    expect(unreadMarks(list, ME, 0).size).toBe(0)
  })
})

// ---- MSG-03: notifications -------------------------------------------------------------------------------------

describe("notifications", () => {
  it("yesterday is the day before today (daysTo is negative in the past)", () => {
    expect(dayGroup("2026-10-10", "2026-10-11")).toBe("yesterday")
    expect(dayGroup("2026-10-11", "2026-10-11")).toBe("today")
    expect(dayGroup("2026-10-12", "2026-10-11")).toBe("date")
  })
  it("start with the contractor's name, once", () => {
    expect(leadWithName("New purchase order PO-1", "Al Bina")).toBe("Al Bina · New purchase order PO-1")
    expect(leadWithName("Al Bina reported a transfer", "Al Bina")).toBe("Al Bina reported a transfer")
    expect(leadWithName("Invitation to quote", "")).toBe("Invitation to quote")
  })
  it("a connection notice with no deal opens the connections, never a dead button", () => {
    expect(connectionHref("supplier_invite_received")).toBe("/supplier/connections?tab=inv")
    expect(connectionHref("supplier_connected")).toBe("/supplier/connections")
    expect(connectionHref("sup_request_declined")).toBe("/supplier/connections?tab=req")
    expect(connectionHref("po_sent")).toBeNull()
  })
})

// ---- NAV-03: badge colours from one place ---------------------------------------------------------------------

describe("sidebar badges", () => {
  it("Today is red only with an overdue task; connections and messages are information", () => {
    const { today, world } = protoWorld()
    const W = createWorldLogic(today, world)
    const late = W.allActs().some((a) => a.due && W.daysTo(a.due) < 0)
    expect(W.badges().home.tone).toBe(late ? "red" : "blue")
    expect(W.badges().connections.tone).toBe("blue")
    expect(W.badges().messages.tone).toBe("blue")
    const empty = createWorldLogic(today, { ...world, deals: [] })
    expect(empty.badges().home.tone).toBe("blue")
  })
})

// ---- NAV-06: the address --------------------------------------------------------------------------------------

describe("the address", () => {
  it("a segment, a tab or closing the drawer is a new history entry; replace only when asked", () => {
    const { result } = renderHook(() => useQueryState())
    act(() => result.current.set({ seg: "you" }))
    expect(mockRouter.push).toHaveBeenCalledWith("/supplier/rfqs?seg=you", { scroll: false })
    act(() => result.current.set({ deal: null }, { replace: true }))
    expect(mockRouter.replace).toHaveBeenCalledTimes(1)
  })
  it("a quote form never opens on an awarded or delivered deal", () => {
    expect(quoteGuard("deliver")).toBe(true)
    expect(quoteGuard("collect")).toBe(true)
    expect(quoteGuard("done")).toBe(true)
    expect(quoteGuard("new")).toBe(false)
    expect(quoteGuard("offered")).toBe(false)
  })
  it("a deep link to a deal waits for the world instead of saying 'not found'", () => {
    mockSearch = "deal=r1"
    mockFree = makeFree({ ready: false })
    render(<DealDrawer />)
    expect(screen.queryByText("Deal not found")).toBeNull()
    expect(screen.getAllByText("Loading your deals…").length).toBeGreaterThan(0)
  })
  it("an old /supplier/chat/<offer> link lands on its deal's conversation", () => {
    const deals = [{ id: "r9", chat: { chatId: "o9", last: "", lastAt: "", unread: 0 } }] as unknown as Deal[]
    expect(freeChatTarget(deals, "o9")).toBe("/supplier/chats?deal=r9&m=1")
    expect(freeChatTarget(deals, "zz")).toBe("/supplier/chats")
  })
})

// ---- RFQ-08 / RFQ-10: the lists' memory ------------------------------------------------------------------------

describe("cards or rows, remembered with storage blocked", () => {
  it("keeps the choice for the session when localStorage throws", () => {
    const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readView("t-opps")).toBe("cards")
    writeView("t-opps", "rows")
    expect(readView("t-opps")).toBe("rows")
    set.mockRestore()
    get.mockRestore()
  })
})

describe("bulk selection", () => {
  it("is emptied when the list changes, so it never archives a hidden card", () => {
    const { result, rerender } = renderHook(({ k }) => useListSelection(k), { initialProps: { k: "a" } })
    act(() => result.current[1]({ r1: true }))
    expect(result.current[0]).toEqual({ r1: true })
    rerender({ k: "b" })
    expect(result.current[0]).toEqual({})
  })
})

// ---- NFR-03 / RFQ-07 / OFR-11: rows on a phone ------------------------------------------------------------------

describe("rows stack on a phone", () => {
  it("every cell but the title carries its label and the table is a block under md", () => {
    const { today, world } = protoWorld()
    mockFree = makeFree({ world, today })
    const { container } = render(<FreeSearch q={world.deals[0].rfq} />)
    const table = container.querySelector("table") as HTMLTableElement
    expect(table.className).toContain("max-md:block")
    expect(container.querySelector("thead")?.className).toContain("max-md:hidden")
    const row = container.querySelector("tbody tr") as HTMLTableRowElement
    const cells = [...row.querySelectorAll("td")]
    expect(cells[0].getAttribute("data-l")).toBeNull()
    expect(cells.slice(1).every((c) => !!c.getAttribute("data-l"))).toBe(true)
    expect(stk.cell).toContain("max-md:before:content-[attr(data-l)]")
    // Nothing in the list scrolls sideways (the module header's tab rail is the portal's own and may).
    expect(container.querySelector("table")?.closest(".overflow-x-auto") ?? null).toBeNull()
  })
})

// ---- the plan is read once ------------------------------------------------------------------------------------

describe("PlanSwitch", () => {
  it("reads the layout's plan instead of subscribing again on every page", () => {
    ;(useSupplierPlan as jest.Mock).mockClear()
    render(
      <SupplierPlanContext.Provider value={{ plan: "free", loading: false, orgId: "o" }}>
        <PlanSwitch free={<p>free page</p>} full={<p>full page</p>} />
      </SupplierPlanContext.Provider>
    )
    expect(screen.getByText("free page")).toBeTruthy()
    expect(useSupplierPlan).not.toHaveBeenCalled()
  })
})

// ---- B-04: a public request's contractor keeps his number ----------------------------------------------------

describe("contractors the supplier deals with directly", () => {
  it("are those who invited him, ordered from him or are connected — not a public request's", () => {
    const close = closeContractors(
      ME,
      [{ organizationId: "pub" }, { organizationId: "inv", invitedSupplierOrgIds: [ME] }],
      [{ organizationId: "po" }],
      [{ contractorOrgId: "link", status: "active" }, { contractorOrgId: "pending", status: "pending" }],
      [{ invitedBy: "conn" }]
    )
    expect([...close].sort()).toEqual(["conn", "inv", "link", "po"])
  })
})

// ---- the new words exist in both languages ---------------------------------------------------------------------

describe("messages", () => {
  const A = (ar as unknown as { SupplierFree: Record<string, string> }).SupplierFree
  const E = (en as unknown as { SupplierFree: Record<string, string> }).SupplierFree
  it.each(["listSep", "loadingWorld", "newMsgs", "mYou", "abCrHint"])("%s", (k) => {
    expect(A[k]).toBeTruthy()
    expect(E[k]).toBeTruthy()
  })
})

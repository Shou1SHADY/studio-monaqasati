/**
 * Supplier 1.0 inside the unified portal (the owner's decision of 15 Oct 2026): a free supplier works in the same
 * PortalLayout and lands on the same PortalHomeView as everyone else. The plan shapes ONE registry that the sidebar,
 * the active module, the breadcrumbs, the app switcher and the home all read; the full plan and the contractor portal
 * are untouched. The home's figures and the sidebar's counts come from the world logic's own functions (G-04, NAV-03).
 */

import fs from "fs"
import path from "path"
import React from "react"
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react"

jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }
let mockPath = "/supplier/invoices"
let mockSearch = ""
jest.mock("@/i18n/routing", () => {
  const R = jest.requireActual<typeof import("react")>("react")
  return {
    Link: R.forwardRef<HTMLAnchorElement, { href: string; children?: React.ReactNode }>(function Link({ href, children, ...rest }, ref) {
      const { scroll: _s, prefetch: _p, ...props } = rest as Record<string, unknown>
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
jest.mock("next/image", () => ({ __esModule: true, default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }))
jest.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join("/") }),
  collection: (_db: unknown, ...segs: string[]) => ({ path: segs.join("/") }),
  query: (...a: unknown[]) => ({ q: a }),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  documentId: jest.fn(),
  updateDoc: jest.fn(),
  addDoc: jest.fn(),
  writeBatch: jest.fn(),
}))
jest.mock("firebase/auth", () => ({ getAuth: () => ({}), signOut: jest.fn(async () => undefined) }))
const mockUser = { uid: "uSupplier01", isAnonymous: false, emailVerified: true, providerData: [{ providerId: "phone" }] }
jest.mock("@/firebase", () => ({
  useFirestore: () => ({}),
  useUser: () => ({ user: mockUser, isUserLoading: false }),
  // The signed-in supplier's profile; every list is empty; no company has switched a module off.
  useDoc: (ref: { path?: string } | null) => ({
    data: ref?.path === "users/uSupplier01" ? { role: "Supplier", organizationId: "uSupplier01", organizationRole: "owner", name: "Sami Ali" } : null,
    isLoading: false,
  }),
  useCollection: () => ({ data: [], isLoading: false }),
  useMemoFirebase: (f: () => unknown) => f(),
}))
jest.mock("@/hooks/useResolvedProfile", () => ({ useResolvedProfile: () => ({ profile: { role: "Supplier" }, organizationId: "uSupplier01", isLoading: false }) }))
jest.mock("@/hooks/useActiveCompanyName", () => ({ useActiveCompanyName: () => "Al Noor Trading" }))
jest.mock("@/hooks/useSupplierOrdersById", () => ({ useSupplierOrdersById: () => ({ ordersById: new Map(), ready: true }) }))
jest.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, isOrgOwner: true, groups: [] }),
  legacyAwareRole: () => "owner",
}))
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }))
jest.mock("@/components/activities/ActivityBell", () => ({ ActivityBell: () => <span data-testid="activity-bell" /> }))
jest.mock("@/hooks/useSupplierPlan", () => ({ useSupplierPlan: jest.fn(() => ({ plan: "free", loading: false, orgId: "uSupplier01" })) }))

let mockFree: Record<string, unknown> = {}
let mockUnread: unknown[] = []
jest.mock("@/components/supplier-free/useFree", () => ({ useFree: () => mockFree }))
jest.mock("@/components/supplier-free/FreeWorldProvider", () => ({
  FreeWorldProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFreeWorld: () => mockFree,
  useWorldReady: () => true,
}))
jest.mock("@/components/supplier-free/FreeOverlays", () => ({ FreeOverlays: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
jest.mock("@/components/supplier-free/useFreeNotifications", () => ({
  stripEmoji: (s: string) => s,
  useFreeNotifications: () => ({ list: mockUnread, unread: mockUnread, markRead: jest.fn(), markAll: jest.fn() }),
}))

import { installDomShims, intlMock, setLocale } from "@/test-utils/render-world"
import {
  CONTRACTOR_COMPONENTS,
  SUPPLIER_COMMUNICATION_SECTION,
  SUPPLIER_COMPONENTS,
  resolveActiveContractorComponent,
  resolveActiveSupplierComponent,
  type PortalComponentDef,
} from "@/lib/portal-components"
import { FREE_SUPPLIER_NAV, SALES_ONLY_OFF, applyModuleSwitches, applySupplierPlan, supplierCommunicationSection, supplierRegistry } from "@/lib/company-modules"
import { freePathAllowed } from "@/lib/supplier-plan"
import { buildSupplierFreeDemo, demoWorld } from "@/lib/supplier-free/demo-seed"
import { createWorldLogic } from "@/lib/supplier-free/world-logic"
import { fmtN, makeFmt, relKey } from "@/lib/supplier-free/format"
import type { World } from "@/lib/supplier-free/types"
import type { Free } from "@/components/supplier-free/useFree"
import { usePortalRegistry } from "@/hooks/usePortalRegistry"
import { useModuleComponents } from "@/hooks/useCompanyModules"
import { PortalFrameContext } from "@/components/layout/portal-frame-context"
import { SupplierPlanContext } from "@/components/supplier-free/PlanSwitch"
import { SupplierPlanFrame } from "@/components/supplier-free/SupplierPlanFrame"
import { FreeHome } from "@/components/supplier-free/FreeHome"
import { DOMAIN_MODULE, freeHomeModel, freeNavBadges, taskHref, taskPage } from "@/components/supplier-free/home-model"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

installDomShims()

const TODAY = "2026-10-15"
const IDS = { supplier: "uSupplier01", contractorA: "uContractorA", receiverA: "uReceiverA", contractorB: "uContractorB" }
const { docs } = buildSupplierFreeDemo(IDS, TODAY, { inviteToken: "test-token" })
const DEMO = demoWorld(docs, IDS.supplier, TODAY)
const EMPTY: World = { deals: [], contractors: {}, invites: [], requests: [], arch: {}, seen: {} }

function makeFree(world: World = DEMO, locale: "ar" | "en" = "en", raw: Record<string, unknown> = {}): Free {
  setLocale(locale)
  const t = intlMock.useTranslations("SupplierFree")
  const L = createWorldLogic(TODAY, world)
  const fmt = makeFmt(locale, { cur: t("cur"), thousand: t("unitK"), million: t("unitM") }, 2026)
  const pl = (k: string, n: number) => t(k, { n, c: fmtN(n) })
  const rel = (iso: string) => {
    const r = relKey(L.daysTo(iso))
    return r.key === "inX" || r.key === "agoX" ? t(r.key, { x: pl("pl_day", r.days) }) : t(r.key)
  }
  return {
    ready: true,
    today: TODAY,
    world,
    L,
    profile: { uid: IDS.supplier, orgId: IDS.supplier, name: "Sami Ali", companyName: "Al Noor Trading", phone: "+966512345678", email: "", city: "", specializations: [], coverageCities: [], isVerified: false, raw },
    pos: [],
    refreshInvites: jest.fn(),
    rawRfq: () => null,
    rawOffer: () => null,
    poOf: () => null,
    archive: jest.fn(),
    markSeen: jest.fn(),
    t,
    tCat: t,
    locale,
    isAr: locale === "ar",
    fmt,
    pl,
    rel,
  } as unknown as Free
}

const hrefsOf = (c: PortalComponentDef) => c.sections.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.children || []).map((ch) => ch.href)]))
const byId = (list: PortalComponentDef[], id: string) => list.find((c) => c.id === id) as PortalComponentDef
const FREE = supplierRegistry("free")

beforeEach(() => {
  mockRouter.push.mockClear()
  mockRouter.replace.mockClear()
  mockPath = "/supplier/invoices"
  mockSearch = ""
  mockUnread = []
})

// ---- the full plan and the contractor portal are untouched ---------------------------------------------------------

describe("the full plan", () => {
  it("is today's registry, the same array, with nothing locked", () => {
    expect(applySupplierPlan(SUPPLIER_COMPONENTS, "full")).toBe(SUPPLIER_COMPONENTS)
    expect(supplierRegistry("full")).toBe(SUPPLIER_COMPONENTS)
    expect(supplierCommunicationSection("full")).toBe(SUPPLIER_COMMUNICATION_SECTION)
    expect(SUPPLIER_COMPONENTS.some((c) => c.planLocked)).toBe(false)
    const A = "/supplier/accounting"
    expect(Object.fromEntries(SUPPLIER_COMPONENTS.map((c) => [c.id, hrefsOf(c)]))).toEqual({
      procurement: ["/supplier/rfqs", "/supplier/offers", "/supplier/sales", "/supplier/sales/quotations", "/supplier/sales/orders", "/supplier/sales/fulfillment", "/supplier/sales/payments", "/supplier/sales/reports", "/supplier/sales/price-list", "/supplier/sales/settings"],
      warehouses: ["/supplier/warehouses", "/supplier/warehouses/waste", "/supplier/warehouses/delivery-notes", "/supplier/warehouses/manufacturing", "/supplier/warehouses/custody"],
      payments: [A, `${A}/locked`, "/supplier/invoices", "/supplier/guarantees", `${A}/sales-desk`, `${A}/hr-desk`, `${A}/income-statement`, `${A}/balance-sheet`, `${A}/cash-flow`, `${A}/equity`, `${A}/journal/new`, `${A}/journal`, `${A}/ledger`, `${A}/statements`, `${A}/settlements`, `${A}/trial-balance`, `${A}/chart-of-accounts`, `${A}/audit-trail`, `${A}/checks`, `${A}/periods`, `${A}/vat`, `${A}/settings`],
      hr: ["/supplier/hr", "/supplier/hr/people", "/supplier/hr/sites", "/supplier/hr/payroll", "/supplier/hr/settings", "/supplier/hr/me"],
      crm: ["/supplier/crm/dashboard", "/supplier/crm/leads", "/supplier/crm/opportunities", "/supplier/crm/activities", "/supplier/crm/settings"],
      manufacturing: ["/supplier/manufacturing", "/supplier/manufacturing/workshop", "/supplier/manufacturing/requests", "/supplier/manufacturing/products", "/supplier/manufacturing/settings"],
      users: ["/supplier/profile", "/supplier/profile?tab=legal", "/supplier/team"],
      "project-management": ["/supplier", "/supplier/orders", "/supplier/connections"],
      activities: ["/supplier/activities"],
      documents: ["/supplier/documents"],
    })
  })

  it("puts Invoices under Finance, and the sales-only switches still apply", () => {
    expect(resolveActiveSupplierComponent("/supplier/invoices").id).toBe("payments")
    expect(resolveActiveSupplierComponent("/supplier/invoices", supplierRegistry("full")).id).toBe("payments")
    const salesOnly = applyModuleSwitches(SUPPLIER_COMPONENTS, new Set(SALES_ONLY_OFF), "supplier").map((c) => c.id)
    expect(salesOnly).toEqual(["procurement", "users", "project-management", "activities", "documents"])
  })

  it("leaves the contractor portal alone, whatever the supplier plan in context", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <SupplierPlanContext.Provider value={{ plan: "free", loading: false, orgId: "o" }}>{children}</SupplierPlanContext.Provider>
    expect(renderHook(() => usePortalRegistry("contractor"), { wrapper }).result.current).toBe(CONTRACTOR_COMPONENTS)
    expect(renderHook(() => useModuleComponents("contractor"), { wrapper }).result.current).toBe(CONTRACTOR_COMPONENTS)
    expect(resolveActiveContractorComponent("/contractor/invoices").id).toBe("payments")
  })

  it("is what a supplier sees with no plan in context (a full page, a test)", () => {
    expect(renderHook(() => usePortalRegistry("supplier")).result.current).toBe(SUPPLIER_COMPONENTS)
    expect(renderHook(() => useModuleComponents("supplier")).result.current).toBe(SUPPLIER_COMPONENTS)
  })
})

// ---- the free plan's registry ----------------------------------------------------------------------------------------

describe("the free plan's registry", () => {
  it("keeps the free journey's pages under Sales, Order Management and Governance, and locks the rest", () => {
    expect(FREE.map((c) => c.id)).toEqual(SUPPLIER_COMPONENTS.map((c) => c.id))
    expect(hrefsOf(byId(FREE, "procurement"))).toEqual(["/supplier/rfqs", "/supplier/offers"])
    expect(hrefsOf(byId(FREE, "project-management"))).toEqual(["/supplier", "/supplier/orders", "/supplier/invoices", "/supplier/connections"])
    expect(hrefsOf(byId(FREE, "users"))).toEqual(["/supplier/profile"])
    const locked = FREE.filter((c) => c.planLocked).map((c) => c.id)
    expect(locked.sort()).toEqual(["activities", "crm", "documents", "hr", "manufacturing", "payments", "warehouses"])
    for (const id of locked) expect(byId(FREE, id).sections).toEqual([])
    // One user, the owner: nothing in the free menu waits on a permission.
    expect(FREE.flatMap((c) => c.sections.flatMap((s) => s.items)).every((i) => !i.requiredPermission && !i.requiredAnyPermission && !i.children)).toBe(true)
  })

  it("resolves Invoices & transfers to Order Management, and every free page to its module", () => {
    const at = (p: string) => resolveActiveSupplierComponent(p, FREE).id
    expect(at("/supplier/invoices")).toBe("project-management")
    expect(at("/supplier/orders")).toBe("project-management")
    expect(at("/supplier/connections")).toBe("project-management")
    expect(at("/supplier/rfqs")).toBe("procurement")
    expect(at("/supplier/offers")).toBe("procurement")
    expect(at("/supplier/profile")).toBe("users")
    expect(at("/supplier/chats")).toBe("project-management")
    expect(at("/supplier/search")).toBe("project-management")
  })

  it("links only to pages the free journey has, and every free page is reachable", () => {
    const comm = supplierCommunicationSection("free")
    const menu = [...FREE.flatMap(hrefsOf), ...comm.items.map((i) => i.href)]
    expect(menu.every(freePathAllowed)).toBe(true)
    expect(comm.items.map((i) => i.href)).toEqual(["/supplier/chats", "/supplier/notifications"])
    for (const p of ["/supplier", "/supplier/rfqs", "/supplier/offers", "/supplier/orders", "/supplier/invoices", "/supplier/connections", "/supplier/chats", "/supplier/profile", "/supplier/notifications"]) expect(menu).toContain(p)
    // The full portal's pages stay closed to him.
    for (const p of ["/supplier/accounting", "/supplier/team", "/supplier/team-chat", "/supplier/activities", "/supplier/documents", "/supplier/sales"]) expect(freePathAllowed(p)).toBe(false)
  })

  it("names its pages with the PRD's words in both languages (B-06)", () => {
    const S = { ar: (ar as unknown as { Portal: { Sidebar: Record<string, string> } }).Portal.Sidebar, en: (en as unknown as { Portal: { Sidebar: Record<string, string> } }).Portal.Sidebar }
    const F = { ar: (ar as unknown as { SupplierFree: Record<string, string> }).SupplierFree, en: (en as unknown as { SupplierFree: Record<string, string> }).SupplierFree }
    const same: Record<string, string> = {
      free_nav_rfqs: "navOpps",
      free_nav_offers: "navOffers",
      free_nav_orders: "navOrders",
      free_nav_invoices: "navInvoices",
      free_nav_connections: "navConnections",
      free_nav_account: "navAccount",
      free_nav_messages: "navMessages",
    }
    for (const l of ["ar", "en"] as const) for (const [k, f] of Object.entries(same)) expect(S[l][k]).toBe(F[l][f])
    expect(S.ar.free_nav_rfqs).toBe("طلبات التسعير")
    expect(S.ar.free_nav_offers).toBe("عروضي")
    const titles = [...FREE.flatMap((c) => c.sections.flatMap((s) => s.items.map((i) => i.titleKey))), ...supplierCommunicationSection("free").items.map((i) => i.titleKey)]
    for (const k of titles) {
      expect(S.ar[k]).toBeTruthy()
      expect(S.en[k]).toBeTruthy()
    }
    expect(Object.values(FREE_SUPPLIER_NAV).flat().length).toBe(7)
  })

  it("is what useModuleComponents gives a free supplier, whatever the module switches say", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <SupplierPlanContext.Provider value={{ plan: "free", loading: false, orgId: "o" }}>{children}</SupplierPlanContext.Provider>
    expect(renderHook(() => useModuleComponents("supplier"), { wrapper }).result.current).toBe(FREE)
    expect(renderHook(() => usePortalRegistry("supplier"), { wrapper }).result.current).toBe(FREE)
  })
})

// ---- the home's numbers ---------------------------------------------------------------------------------------------

describe("the free home's model", () => {
  const f = makeFree()
  const L = f.L
  const m = freeHomeModel(f)

  it("shows the world logic's three figures, as Today did (G-04)", () => {
    const k = L.dashK()
    expect(m.fresh).toBe(false)
    expect(m.kpis.map((x) => [x.key, x.value])).toEqual([
      ["acts", L.allActs().length],
      ["unsent", `⁦${f.fmt.cur} ${f.fmt.kM(k.accUnsent)}⁩`],
      ["owed", `⁦${f.fmt.cur} ${f.fmt.kM(k.owed)}⁩`],
    ])
    expect(m.kpis.map((x) => x.label)).toEqual(["Awaiting your reply", "Yours to deliver", "Owed to you"])
    expect(m.kpis[0].dot).toBe(L.allActs().some((a) => !!a.due && L.daysTo(a.due) < 0))
  })

  it("lists every task as a decision, in the one working order (G-12), each opening its deal over its page", () => {
    const acts = L.allActs()
    expect(acts.length).toBeGreaterThan(3)
    expect(m.decisions.length).toBe(acts.length)
    m.decisions.forEach((d, i) => {
      const a = acts[i]
      expect(d.id.startsWith(`${a.kind}:`)).toBe(true)
      expect(d.href).toBe(taskHref(a))
      expect(d.moduleId).toBe(DOMAIN_MODULE[a.kind === "aConnInvite" ? "links" : a.kind === "aInviteRfq" || a.kind === "aReduce" || a.kind === "aSample" ? "offers" : a.kind === "aPaySent" || a.kind === "aInvoice" ? "money" : "supply"])
      expect(d.metrics).toHaveLength(2)
      expect(d.actionLabel).toBeTruthy()
      if (a.deal) expect(d.href).toBe(`${taskPage(a)}?deal=${encodeURIComponent(a.deal)}`)
      const n = a.due ? L.daysTo(a.due) : null
      expect(d.chip?.tone ?? null).toBe(n == null ? null : n < 0 ? "destructive" : n <= 1 ? "warning" : null)
    })
    expect(m.decisions.some((d) => d.chip?.tone === "destructive")).toBe(true)
    const pageOf = (kind: string) => taskPage({ kind, due: null } as never)
    expect([pageOf("aInviteRfq"), pageOf("aReduce"), pageOf("aAcceptPO"), pageOf("aInvoice")]).toEqual(["/supplier/rfqs", "/supplier/offers", "/supplier/orders", "/supplier/invoices"])
    expect(taskHref({ kind: "aConnInvite", c: "x", due: null })).toBe("/supplier/connections?tab=inv")
  })

  it("counts the tiles with badges(): red waits on the supplier, blue is said in the line", () => {
    const b = L.badges()
    expect(m.badges.get("procurement") ?? 0).toBe(b.offers.n)
    expect(m.badges.get("project-management") ?? 0).toBe(b.orders.n + b.invoices.n)
    for (const id of m.badges.keys()) expect(m.urgentTiles.has(id)).toBe(true)
    const k = L.dashK()
    expect(m.tileStats.procurement).toBe(`Open: ${k.opps} · New: ${k.oppsNew}`)
  })

  it("gives the sidebar each page's own number, and the account its completion", () => {
    const b = L.badges()
    const nav = freeNavBadges(b, 60)
    expect(nav["/supplier/invoices"]).toEqual(b.invoices)
    expect(nav["/supplier/orders"]).toEqual(b.orders)
    expect(nav["/supplier/rfqs"]).toEqual(b.opps)
    expect(nav["/supplier/offers"]).toEqual(b.offers)
    expect(nav["/supplier"]).toEqual(b.home)
    expect(nav["/supplier/chats"]).toEqual(b.messages)
    expect(nav["/supplier/profile"]).toEqual({ n: "60%", tone: "muted" })
    expect(freeNavBadges(b, 100)["/supplier/profile"]).toBeUndefined()
  })

  it("a new account shows no figures and no zero lines — nothing yet (TDY-07)", () => {
    const fresh = freeHomeModel(makeFree(EMPTY))
    expect(fresh.fresh).toBe(true)
    expect(fresh.kpis).toEqual([])
    expect(fresh.decisions).toEqual([])
    expect(fresh.tileStats.procurement).toBeUndefined()
    expect(fresh.tileStats.users).toMatch(/Profile \d+% complete/)
  })

  it("writes no Arabic comma between words in its sources", () => {
    for (const file of ["FreeHome.tsx", "home-model.ts", "SupplierPlanFrame.tsx", "FreeOpps.tsx"]) {
      const src = fs.readFileSync(path.join(process.cwd(), "src/components/supplier-free", file), "utf8")
      expect(src.replace(/\/\/.*$/gm, "")).not.toMatch(/[}"]\s*،|"،/)
    }
  })
})

// ---- the home, rendered ----------------------------------------------------------------------------------------------

describe("the free home, rendered", () => {
  const openSubscription = jest.fn()
  const renderHome = (world: World = DEMO) => {
    mockFree = makeFree(world)
    mockPath = "/supplier"
    return render(
      <SupplierPlanContext.Provider value={{ plan: "free", loading: false, orgId: IDS.supplier }}>
        <PortalFrameContext.Provider value={{ openSubscription }}>
          <FreeHome />
        </PortalFrameContext.Provider>
      </SupplierPlanContext.Provider>
    )
  }

  it("is the portal home: the free modules open, the subscription's locked and saying what it adds", () => {
    renderHome()
    expect(screen.getByRole("link", { name: /Sales/ })).toHaveAttribute("href", "/supplier/rfqs")
    expect(screen.getByRole("link", { name: /Order Management/ })).toHaveAttribute("href", "/supplier/orders")
    expect(screen.queryByRole("link", { name: /Finance/ })).toBeNull()
    const adds = screen.getAllByRole("button", { name: "What a subscription adds" })
    expect(adds.length).toBe(7)
    fireEvent.click(adds[0])
    expect(openSubscription).toHaveBeenCalled()
    expect(screen.queryByText(/request access/i)).toBeNull()
    expect(screen.getByText("Free account")).toBeInTheDocument()
  })

  it("shows the three figures and the first decisions, each opening its deal", () => {
    renderHome()
    const W = createWorldLogic(TODAY, DEMO)
    expect(screen.getByText("Awaiting your reply")).toBeInTheDocument()
    expect(screen.getByText(String(W.allActs().length))).toBeInTheDocument()
    const first = taskHref(W.allActs()[0])
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === first)).toBe(true)
  })

  it("a new account: nothing yet and a way to complete the profile, no figures", () => {
    renderHome(EMPTY)
    expect(screen.getAllByText("Nothing yet").length).toBeGreaterThan(0)
    expect(screen.getByRole("link", { name: "Complete your profile" })).toHaveAttribute("href", "/supplier/profile")
    expect(screen.queryByText("Owed to you")).toBeNull()
  })
})

// ---- the frame ---------------------------------------------------------------------------------------------------------

describe("the free supplier's frame", () => {
  it("is the portal's own frame: its sidebar, module colour, bell and search — no second frame", () => {
    mockFree = makeFree()
    mockUnread = [{ id: "n1" }, { id: "n2" }]
    const W = mockFree.L as ReturnType<typeof createWorldLogic>
    const { container } = render(
      <SupplierPlanFrame>
        <p>the invoices page</p>
      </SupplierPlanFrame>
    )
    expect(screen.getByText("the invoices page")).toBeInTheDocument()
    // The module of /supplier/invoices on the free plan is Order Management (pm), not Finance.
    expect(container.querySelector("[data-accent]")?.getAttribute("data-accent")).toBe("pm")
    const nav = screen.getByRole("link", { name: /Invoices & transfers/ })
    expect(nav).toHaveAttribute("href", "/supplier/invoices")
    const n = W.badges().invoices.n
    if (n) expect(within(nav).getByTestId("nav-badge")).toHaveTextContent(String(n))
    expect(screen.getByRole("link", { name: /Orders & delivery/ })).toHaveAttribute("href", "/supplier/orders")
    expect(screen.getByRole("link", { name: /^Messages/ })).toHaveAttribute("href", "/supplier/chats")
    expect(screen.queryByRole("link", { name: /Team chat/i })).toBeNull()
    expect(screen.queryByText("Finance & Accounting")).toBeNull()
    expect(screen.getAllByText("Free account").length).toBeGreaterThan(0)
    // The bell counts what the notifications page counts: unread + connection invitations (MSG-04).
    expect(screen.getByTestId("portal-bell-count")).toHaveTextContent(String(2 + DEMO.invites.length))
    expect(screen.getByTestId("portal-bell-count").closest("a")).toHaveAttribute("href", "/supplier/notifications")
    expect(screen.queryByTestId("activity-bell")).toBeNull()
    // FreeFrame is gone: no subscription card, no second header.
    expect(screen.queryByText("You are on the free account")).toBeNull()
    expect(container.querySelectorAll("header").length).toBe(1)
    // The search box opens the free results page (NAV-04).
    const box = screen.getByRole("textbox", { name: /search/i })
    fireEvent.change(box, { target: { value: "steel" } })
    act(() => {
      fireEvent.submit(box.closest("form") as HTMLFormElement)
    })
    expect(mockRouter.push).toHaveBeenCalledWith("/supplier/search?q=steel")
  })

  it("sends a free account home from a page of the full portal", () => {
    mockFree = makeFree()
    mockPath = "/supplier/accounting"
    render(
      <SupplierPlanFrame>
        <p>a full-portal page</p>
      </SupplierPlanFrame>
    )
    expect(screen.queryByText("a full-portal page")).toBeNull()
    expect(mockRouter.replace).toHaveBeenCalledWith("/supplier")
  })
})

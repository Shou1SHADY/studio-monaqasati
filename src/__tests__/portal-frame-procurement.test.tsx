/**
 * Procurement 2.0 frame gaps over the REAL portal frame (FR-01…FR-05): Procurement's sidebar folds to icons and remembers
 * it across its pages, its top bar names the module and drops the second search box on its rail pages, and the package chip
 * shows the five units and opens Settings › Subscription for the owner — while another module's frame and the supplier
 * portal render as they did (the sidebar slides away and is not remembered, the top bar keeps its search, no identity).
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => {
  const world = jest.requireActual("@/test-utils/render-world")
  const React = jest.requireActual<typeof import("react")>("react")
  return {
    ...world.firebaseMock,
    useUser: () => {
      const base = world.firebaseMock.useUser()
      const user = React.useMemo(() => (base.user ? { ...base.user, isAnonymous: false, emailVerified: true, providerData: [] } : null), [base.user])
      return { ...base, user }
    },
  }
})
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: null }), signOut: async () => undefined }))
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)
jest.mock("next/image", () => ({ __esModule: true, default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }))
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/activities/ActivityBell", () => ({ ActivityBell: () => <span data-testid="activity-bell" /> }))

import React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, pushed, setLocale, setPathname, setSignedIn } from "@/test-utils/render-world"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { PortalLayout } from "@/components/layout/portal-layout"
import { forgetSidebarFold } from "@/hooks/useSidebarFold"
import { LIVE_SEARCH_TABS, PROC_TAB_PAGES, hidesTopBarSearch, isProcTabPage, searchHref } from "@/lib/procurement/frame"
import { PROC_TABS } from "@/lib/procurement/shell"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function open(pathname: string, uid = ORG) {
  setSignedIn(uid)
  setPathname(pathname, "")
  const view = render(
    <PortalLayout>
      <p data-testid="page-body">body</p>
    </PortalLayout>,
  )
  await flush()
  return view
}

const sidebar = () => document.querySelector("[data-side]") as HTMLElement
const toggle = () => document.querySelector('[data-sidebar="trigger"]') as HTMLElement
const topSearch = () => document.querySelector('header input[aria-label="بحث سريع..."]')

beforeEach(() => {
  resetFakeDb()
  setLocale("ar")
  missingKeys.clear()
  forgetSidebarFold()
  window.localStorage.clear()
  seed(`users/${ORG}`, { role: "Contractor", organizationId: ORG, organizationRole: "owner", name: "المالك", companyName: "شركة البنيان", email: "o@test.sa" })
  seed("teamGroups/g_exp", { organizationId: ORG, name: "expediter", key: null, permissions: ["po.expedite"] })
  seed("users/exp", { role: "Contractor", organizationId: ORG, organizationRole: "member", defaultGroupId: "g_exp", name: "سلمان", email: "e@test.sa" })
  seed("users/sup", { role: "Supplier", organizationId: "sup", organizationRole: "owner", name: "مورد", companyName: "مؤسسة التوريد", email: "s@test.sa" })
  seed("companyPlans/sup", { organizationId: "sup", supplierPlan: "full" })
})

describe("Procurement's sidebar folds to icons and remembers it (FR-02)", () => {
  it("folds to icons, each item named by its tooltip trigger, the counts become dots — and the next page opens folded", async () => {
    let view = await open("/contractor/rfqs/today")
    expect(document.querySelector('[data-testid="page-body"]')).toBeTruthy()
    expect(sidebar().getAttribute("data-state")).toBe("expanded")
    fireEvent.click(toggle())
    await flush()
    expect(sidebar().getAttribute("data-state")).toBe("collapsed")
    expect(sidebar().getAttribute("data-collapsible")).toBe("icon")
    expect(window.localStorage.getItem("pf-side")).toBe("min")
    expect(document.querySelector('[data-testid="sidebar-fold-module"]')).toBeTruthy()
    // Each label is hidden only in the folded state, by class: the links themselves stay.
    const label = Array.from(sidebar().querySelectorAll("a span")).find((s) => s.textContent === "طلبات العروض") as HTMLElement
    expect(label.className).toContain("group-data-[collapsible=icon]:hidden")
    view.unmount()

    view = await open("/contractor/rfqs/orders")
    expect(sidebar().getAttribute("data-state")).toBe("collapsed")
    fireEvent.click(toggle())
    await flush()
    expect(window.localStorage.getItem("pf-side")).toBe("full")
    view.unmount()
  })

  it("a reload reads the choice the browser kept", async () => {
    window.localStorage.setItem("pf-side", "min")
    const view = await open("/contractor/rfqs/today")
    expect(sidebar().getAttribute("data-state")).toBe("collapsed")
    view.unmount()
  })

  it("another module's sidebar still slides away, and opens again on the next page", async () => {
    let view = await open("/contractor/hr")
    fireEvent.click(toggle())
    await flush()
    expect(sidebar().getAttribute("data-collapsible")).toBe("offcanvas")
    expect(window.localStorage.getItem("pf-side")).toBeNull()
    view.unmount()
    view = await open("/contractor/hr")
    expect(sidebar().getAttribute("data-state")).toBe("expanded")
    view.unmount()
  })

  it("a folded Procurement leaves the next module open as before", async () => {
    window.localStorage.setItem("pf-side", "min")
    let view = await open("/contractor/rfqs/today")
    view.unmount()
    view = await open("/contractor/hr")
    expect(sidebar().getAttribute("data-state")).toBe("expanded")
    view.unmount()
  })

  it("Project Management's pages fold to icons too and share the choice (PM 1.1 UX-01)", async () => {
    // Inside a project, with no choice made yet, the sidebar starts folded — the project gets the whole width.
    let view = await open("/contractor/projects/P1")
    expect(sidebar().getAttribute("data-collapsible")).not.toBe("offcanvas")
    expect(sidebar().getAttribute("data-state")).toBe("collapsed")
    // Opening it is a choice, remembered across pages.
    fireEvent.click(toggle())
    await flush()
    expect(sidebar().getAttribute("data-state")).toBe("expanded")
    expect(window.localStorage.getItem("pf-side")).toBe("full")
    view.unmount()
    view = await open("/contractor/projects/P2")
    expect(sidebar().getAttribute("data-state")).toBe("expanded")
    view.unmount()
  })

  it("only a project's own page starts folded: the list, Today, the inbox and Procurement start open (PM 1.1 UX-01)", async () => {
    for (const path of ["/contractor/projects", "/contractor/projects/today", "/contractor/projects/inbox", "/contractor/rfqs/today"]) {
      forgetSidebarFold()
      window.localStorage.clear()
      const view = await open(path)
      expect({ path, state: sidebar().getAttribute("data-state") }).toEqual({ path, state: "expanded" })
      view.unmount()
    }
    // A folded choice made anywhere still holds on the list.
    forgetSidebarFold()
    window.localStorage.setItem("pf-side", "min")
    const view = await open("/contractor/projects")
    expect(sidebar().getAttribute("data-state")).toBe("collapsed")
    view.unmount()
  })
})

describe("the top bar on Procurement's pages (FR-01, FR-03, FR-04)", () => {
  it("names the module after the hub, with its line, and its rail pages carry one search — the page's own", async () => {
    const view = await open("/contractor/rfqs/requests")
    const identity = document.querySelector('[data-testid="module-identity"]') as HTMLElement
    expect(identity.textContent).toContain("المشتريات")
    expect(identity.textContent).toContain("الطلبات الواردة · العروض · أوامر الشراء")
    expect(topSearch()).toBeNull()
    expect([...missingKeys]).toEqual([])
    view.unmount()
  })

  it("a Procurement page off the rail drops the top bar's search too — it searched the RFQs, Procurement's own list (review 1 #3, review 3 #2)", async () => {
    for (const path of ["/contractor/rfqs/guide", "/contractor/rfqs/new", "/contractor/rfqs/abc/offers", "/contractor/rfqs/my-requests"]) {
      const view = await open(path)
      expect(document.querySelector('[data-testid="module-identity"]')).toBeTruthy()
      expect(topSearch()).toBeNull()
      view.unmount()
    }
  })

  it("the module's name never truncates and the identity never shrinks below it; its line shows only where the bar has room", async () => {
    const view = await open("/contractor/rfqs/settings")
    const identity = document.querySelector('[data-testid="module-identity"]') as HTMLElement
    expect(identity.className).toContain("shrink-0")
    expect(identity.className).not.toContain("min-w-0")
    const name = identity.querySelector("b") as HTMLElement
    expect(name.className).toContain("whitespace-nowrap")
    expect(name.className).not.toContain("truncate")
    expect((name.nextElementSibling as HTMLElement).className).toContain("xl:block")
    const units = document.querySelector('[data-testid="package-chip"] [role="img"]') as HTMLElement | null
    if (units) expect(units.className).toContain("xl:inline-flex")
    view.unmount()
  })

  it("the package chip shows the five units, the closed connector greyed, and opens Settings › Subscription for the owner", async () => {
    seed(`companyModules/${ORG}`, { organizationId: ORG, off: ["manufacturing"] })
    const view = await open("/contractor/rfqs/orders")
    const chip = document.querySelector('[data-testid="package-chip"]') as HTMLElement
    expect(chip.tagName).toBe("A")
    expect(chip.getAttribute("href")).toBe("/contractor/rfqs/settings?seg=sub")
    expect(chip.textContent).toBe("الباقة: الأساسية + المشاريع + المالية")
    const units = chip.querySelector('[role="img"]') as HTMLElement
    expect(units.getAttribute("aria-label")).toBe("المشتريات + المخزون + المشاريع + المالية")
    expect(units.querySelectorAll("span.grid")).toHaveLength(5)
    expect(units.querySelectorAll("span.border-dashed")).toHaveLength(1)
    view.unmount()
  })

  it("beside the unit icons (xl) the chip's words step aside instead of shrinking to «ا.»; the title keeps the name (UI review 2)", async () => {
    const view = await open("/contractor/rfqs/orders")
    const chip = document.querySelector('[data-testid="package-chip"]') as HTMLElement
    const words = [...chip.querySelectorAll("span")].find((s) => s.textContent?.startsWith("الباقة")) as HTMLElement
    expect(words.className).toContain("xl:hidden")
    expect(words.className).toContain("2xl:inline")
    expect(chip.getAttribute("title")).toBe(words.textContent)
    view.unmount()
  })

  it("the frame beside the sidebar never widens past the screen: a wide table scrolls inside its own box on a phone (UI review 2)", async () => {
    const view = await open("/contractor/rfqs/settings")
    // shadcn's SidebarInset is itself a <main>, the flex item beside the sidebar; the page's own <main> sits inside it.
    const [inset, page] = [...document.querySelectorAll("main")] as HTMLElement[]
    expect(inset.parentElement?.className).toContain("group/sidebar-wrapper")
    expect(inset.className).toContain("min-w-0")
    expect(page.className).toContain("min-w-0")
    view.unmount()
  })

  it("for a member who may not read the subscription the chip stays a plain label", async () => {
    const view = await open("/contractor/rfqs/orders", "exp")
    const chip = document.querySelector('[data-testid="package-chip"]') as HTMLElement
    expect(chip.tagName).toBe("SPAN")
    view.unmount()
  })
})

describe("the page's search (FR-01, FR-05)", () => {
  const head = async (pathname: string, search = "") => {
    setSignedIn(ORG)
    setPathname(pathname, search)
    pushed.length = 0
    const view = render(<ProcurementHeader title="t" description="d" />)
    await flush()
    return view
  }
  const box = () => document.querySelector('form[role="search"] input') as HTMLInputElement
  const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

  it("on the incoming requests it says «ابحث في هذه الصفحة…» and filters this page as you type, keeping the page's other parameters", async () => {
    const view = await head("/contractor/rfqs/requests", "view=mat")
    expect(box().placeholder).toBe("ابحث في هذه الصفحة…")
    fireEvent.change(box(), { target: { value: "حدي" } })
    fireEvent.change(box(), { target: { value: "حديد" } })
    expect(pushed).toEqual([])
    await wait(300)
    expect(pushed).toEqual(["/contractor/rfqs/requests?view=mat&search=%D8%AD%D8%AF%D9%8A%D8%AF"])
    expect(box().value).toBe("حديد")
    view.unmount()
  })

  it("the RFQs list filters in place too", async () => {
    const view = await head("/contractor/rfqs")
    fireEvent.change(box(), { target: { value: "x" } })
    fireEvent.submit(box().closest("form") as HTMLFormElement)
    expect(pushed).toEqual(["/contractor/rfqs?search=x"])
    view.unmount()
  })

  it("orders, receipts and suppliers filter in place as you type — the page's one search (review 2 #1)", async () => {
    for (const path of ["/contractor/rfqs/orders", "/contractor/goods-received", "/contractor/suppliers"]) {
      const view = await head(path, "filter=x")
      expect(box().placeholder).toBe("ابحث في هذه الصفحة…")
      // An empty box inherits the page's direction: no dir="auto" (it resolves an empty box to LTR), the icon at the start.
      expect(box().getAttribute("dir")).toBeNull()
      expect(box().className).toContain("ps-9")
      expect((box().previousElementSibling as Element).getAttribute("class")).toContain("start-3")
      fireEvent.change(box(), { target: { value: "PO" } })
      await wait(300)
      expect(pushed).toEqual([`${path}?filter=x&search=PO`])
      view.unmount()
    }
  })

  it("on a phone the rail comes right under the title, the three numbers follow as one compact row, and the rail fades at its end (review 1 #7, #18)", async () => {
    const view = await head("/contractor/rfqs/today")
    const kpis = document.querySelector('[data-testid="proc-kpis"]') as HTMLElement
    expect(kpis).toBeTruthy()
    // Phone: three to a row, ordered after the rail; from `sm` up, the old place and spacing.
    expect(kpis.className).toContain("grid-cols-3")
    expect(kpis.className).toContain("order-last")
    expect(kpis.className).toContain("sm:order-none")
    expect(kpis.className).not.toContain("grid-cols-1")
    const tile = kpis.querySelector("a") as HTMLElement
    expect(tile.className).toContain("sm:p-5")
    // The note: a pill from `sm` up, read out (not drawn) on a phone.
    const pill = tile.querySelector("p.rounded-full") as HTMLElement
    expect(pill.className).toContain("hidden")
    expect(pill.className).toContain("sm:inline-block")
    expect((tile.querySelector("span.sr-only") as HTMLElement).textContent).toBe(pill.textContent)
    const rail = document.querySelector('[data-testid="proc-rail"] ul') as HTMLElement
    expect(rail.className).toContain("rail-fade")
    expect(rail.className).toContain("pe-10")
    view.unmount()
  })

  it("Reports carries no search at all (review 2 #1)", async () => {
    const view = await head("/contractor/rfqs/reports")
    expect(box()).toBeNull()
    view.unmount()
  })

  it("a tab with no live list keeps the jump: nothing while typing, Enter opens the incoming requests on «all»", async () => {
    const view = await head("/contractor/rfqs/today")
    expect(box().placeholder).toBe("ابحث: مادة · مورد · رقم مستند…")
    fireEvent.change(box(), { target: { value: "x" } })
    await wait(300)
    expect(pushed).toEqual([])
    fireEvent.submit(box().closest("form") as HTMLFormElement)
    expect(pushed).toEqual(["/contractor/rfqs/requests?search=x&seg=all"])
    view.unmount()
  })
})

describe("every other frame renders as it did", () => {
  it("another contractor module: no module identity, no package chip, the top bar's search", async () => {
    const view = await open("/contractor/projects")
    expect(document.querySelector('[data-testid="page-body"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="module-identity"]')).toBeNull()
    expect(document.querySelector('[data-testid="package-chip"]')).toBeNull()
    expect(topSearch()).toBeTruthy()
    view.unmount()
  })

  it("the supplier portal: its sidebar slides away, the top bar keeps its search, no identity", async () => {
    const view = await open("/supplier/rfqs", "sup")
    expect(document.querySelector('[data-testid="page-body"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="module-identity"]')).toBeNull()
    expect(topSearch()).toBeTruthy()
    fireEvent.click(toggle())
    await flush()
    expect(sidebar().getAttribute("data-collapsible")).toBe("offcanvas")
    view.unmount()
  })
})

describe("the frame's Procurement lists", () => {
  it("the rail pages are the eight tabs", () => {
    expect([...PROC_TAB_PAGES].sort()).toEqual(PROC_TABS.map((t) => t.href).sort())
    expect(isProcTabPage("/contractor/rfqs")).toBe(true)
    expect(isProcTabPage("/contractor/rfqs/abc/offers")).toBe(false)
  })

  it("every Procurement page drops the top bar's search; another module keeps it", () => {
    expect(hidesTopBarSearch("/contractor/rfqs", null)).toBe(true)
    expect(hidesTopBarSearch("/contractor/rfqs/abc/offers", "procurement")).toBe(true)
    expect(hidesTopBarSearch("/contractor/projects", "projects")).toBe(false)
    expect(hidesTopBarSearch("/supplier/rfqs", "procurement")).toBe(false)
    expect([...LIVE_SEARCH_TABS].sort()).toEqual(["orders", "receipts", "requests", "rfqs", "suppliers"])
  })

  it("the page's own search keeps every other parameter and drops a blank term", () => {
    expect(searchHref("/contractor/rfqs/requests", new URLSearchParams("view=mat&seg=new"), " steel ")).toBe("/contractor/rfqs/requests?view=mat&seg=new&search=steel")
    expect(searchHref("/contractor/rfqs", new URLSearchParams("search=old"), "  ")).toBe("/contractor/rfqs")
  })
})

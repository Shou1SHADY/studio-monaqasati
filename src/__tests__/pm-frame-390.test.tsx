/**
 * PM 1.1 — the project frame on a 390 px phone and at full width (a5-ux: UX-01…05, 07, 09, 10, 13, 14, 18, 21).
 *
 * jsdom lays nothing out, so «no column is wider than the screen» is pinned by what makes it true: every grid a project's
 * decisions, money trail, certificates and portfolio Today sit in has a BOUNDED base track — `grid-cols-N` (Tailwind's
 * `repeat(N, minmax(0, 1fr))`) — and every `fr` track of an arbitrary template is `minmax(0, …)`. Without a base track
 * the implicit `auto` column takes the content's min-content: the Pulse measured 519 px and Certificates 622 px in a
 * 390 px screen (UX-09, the blocker). The rest: no width cap of its own and the sidebar folding to icons (UX-01), one
 * crumb row (UX-02), three compact KPI tiles with the riyal sign set apart (UX-03), Postpone behind «…» (UX-04), the
 * name not cut (UX-05), the sub-tabs in a wrapping tray (UX-07), the money trail 2×2 with figures never cut (UX-10),
 * dense decision rows and the subtitle inline in the panel head (UX-13/14), and the screen written to `?tab=` (UX-18).
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => {
  const nav = jest.requireActual("@/test-utils/render-world").navigationMock
  return { ...nav, useParams: () => ({ id: "P1", locale: "ar" }) }
})
jest.mock("@/ai/genkit", () => jest.requireActual("@/test-utils/render-world").aiMock)
jest.mock("@/components/layout/portal-layout", () => jest.requireActual("@/test-utils/render-world").portalLayoutMock)

import fs from "fs"
import path from "path"
import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, missingKeys, pushed, setPathname, setSignedIn } from "@/test-utils/render-world"
import ProjectPage from "@/app/[locale]/(contractor)/contractor/projects/[id]/page"
import { PmPortfolioToday } from "@/components/pm/PmPortfolioToday"
import { PortalBreadcrumbs, ownsTrail } from "@/components/layout/portal-breadcrumbs"
import { foldsToIcons } from "@/hooks/useSidebarFold"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { ModuleKpiStrip } from "@/components/module-ui/ModuleHeader"
import { DataTable } from "@/components/module-ui/DataTable"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { todayDay } from "@/lib/pm/format"
import { sectionsForKind } from "@/lib/pm/sections"
import { SAR_SIGN } from "@/lib/riyal"

installDomShims()
jest.setTimeout(60_000)

const ORG = "own"
const P = "P1"
const DAY = 86_400_000
const base = new Date(`${todayDay()}T00:00:00Z`).getTime()
const d = (n: number) => new Date(base + n * DAY).toISOString().slice(0, 10)
const iso = (n: number) => new Date(base + n * DAY + 9 * 3600_000).toISOString()

const TERMS = {
  payer: "owner",
  basis: "rem",
  advance: 0.1,
  advanceRecovery: "pro",
  retention: 0.05,
  retentionCap: 0.05,
  retentionRelease: "half",
  paymentDays: 30,
  consultantDays: 14,
  claimNoticeDays: 28,
  defectsDays: 365,
  damages: { on: true, weeklyRate: 0.005, cap: 0.1 },
}

function world() {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  seed(`projects/${P}`, {
    organizationId: ORG,
    contractorId: ORG,
    name: "مجمع الياسمين السكني — 5 فلل",
    location: "الرياض — حي الياسمين",
    budget: 4_658_000,
    status: "in_progress",
    projectType: "bld",
    clientName: "شركة الياسمين للتطوير العقاري",
    enabledSections: sectionsForKind("bld"),
    rfqIds: [],
    projectManagerId: ORG,
    projectManagerName: "المالك",
    pm: { no: "PJ-2026/001", lifecycle: "live", kind: "bld", startOn: d(-150), startedAt: d(-150), durationDays: 365, signedOn: d(-170), terms: TERMS, original: TERMS, acceptances: {}, sheetCount: 1, ipcCount: 1, retentionHeld: 0, advanceRecovered: 0, cutPool: 0 },
    createdAt: iso(-170),
  })
  const items = [
    { id: "i1", code: "02-01", qty: 1200, rate: 35, exec: 1200 },
    { id: "i2", code: "03-02", qty: 480, rate: 9500, exec: 200 },
  ]
  for (const i of items)
    seed(`projects/${P}/boqItems/${i.id}`, { itemNo: i.code, sheet: "BOQ", divisionNo: "02", descriptionAr: i.code, unit: "م³", quantity: i.qty, unitPrice: i.rate, estCost: i.rate * 0.8, totalPrice: i.qty * i.rate, executedQuantity: i.exec, billedQuantity: 0, groupId: null, isEditable: true })
  // A measurement sheet waiting for approval: a decision on the Pulse.
  seed(`projects/${P}/pmSheets/01`, { seq: 1, status: "wait", day: d(-3), by: ORG, byName: "المالك", lines: [{ itemId: "i2", code: "03-02", qty: 20, approved: null }], note: null, organizationId: ORG, createdAt: iso(-3) })
}

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

function atWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: px })
}

async function openProject(tab: string) {
  setSignedIn(ORG)
  setPathname(`/contractor/projects/${P}`, `tab=${tab}`)
  missingKeys.clear()
  const view = render(<ProjectPage />)
  await flush()
  return view
}

// ---------------------------------------------------------------------------
// The grid rule: a bounded base track, `minmax(0, …)` for every fr track
// ---------------------------------------------------------------------------

const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
const isGrid = (el: Element) => classesOf(el).includes("grid")
/** Why a grid can grow wider than its container, or null when it cannot. */
function unbounded(el: Element): string | null {
  const cls = classesOf(el)
  const responsive = cls.filter((c) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(c))
  if (responsive.length && !cls.some((c) => /^grid-cols-/.test(c))) return `no base track: ${el.getAttribute("class")}`
  for (const c of cls.filter((x) => /grid-cols-\[/.test(x))) {
    const tracks = c.slice(c.indexOf("[") + 1, c.lastIndexOf("]")).split(/_(?![^(]*\))/)
    const bare = tracks.filter((t) => /fr/.test(t) && !/^minmax\(0,/.test(t))
    if (bare.length) return `bare fr track in ${c}`
  }
  return null
}
/** Every grid between `el` and the document must be bounded. */
function gridAncestorsProblems(el: Element | null): string[] {
  const out: string[] = []
  for (let n = el?.parentElement ?? null; n; n = n.parentElement)
    if (isGrid(n)) {
      const why = unbounded(n)
      if (why) out.push(why)
    }
  return out
}
const panelTitled = (title: string) => Array.from(document.querySelectorAll("section h3")).find((h) => (h.textContent ?? "").includes(title))?.closest("section") ?? null

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")

beforeEach(() => {
  world()
  pushed.length = 0
  window.localStorage.clear()
})
afterEach(() => atWidth(1024))

describe("UX-09: nothing a project or portfolio Today shows can be wider than a 390 px phone", () => {
  it("the frame's grids all have a bounded base track — Pulse, money trail, certificates, info, QA, portfolio Today", () => {
    const files = [
      "src/components/pm/ProjectPulse.tsx",
      "src/components/pm/PulseMoneyTrail.tsx",
      "src/components/pm/PmPortfolioToday.tsx",
      "src/components/pm/CertificatesPanel.tsx",
      "src/app/[locale]/(contractor)/contractor/projects/[id]/page.tsx",
    ]
    const offenders: string[] = []
    for (const f of files)
      for (const m of read(f).matchAll(/className="([^"]*\bgrid\b[^"]*)"/g)) {
        const probe = document.createElement("div")
        probe.setAttribute("class", m[1])
        const why = unbounded(probe)
        if (why) offenders.push(`${f}: ${why}`)
      }
    expect(offenders).toEqual([])
  })

  it("on a phone the Pulse's decisions and money trail sit only in bounded grids", async () => {
    atWidth(390)
    const view = await openProject("pmToday")
    expect([...missingKeys]).toEqual([])
    const decisions = panelTitled("يحتاج قرارك")
    const trail = panelTitled("مسار المال")
    expect(decisions).not.toBeNull()
    expect(trail).not.toBeNull()
    expect(gridAncestorsProblems(decisions)).toEqual([])
    expect(gridAncestorsProblems(trail)).toEqual([])
    view.unmount()
  })

  it("portfolio Today's decision panel too, with dense rows and the filter in a wrapping tray (UX-13, UX-21)", async () => {
    atWidth(390)
    setSignedIn(ORG)
    setPathname("/contractor/projects/today")
    const view = render(<PmPortfolioToday />)
    await flush()
    const decisions = panelTitled("يحتاج قرارك")
    expect(decisions).not.toBeNull()
    expect(gridAncestorsProblems(decisions)).toEqual([])
    expect(decisions!.querySelectorAll("li[data-dense]").length).toBeGreaterThan(0)
    const tray = decisions!.querySelector('[role="tablist"]')
    expect(tray).not.toBeNull()
    expect(tray!.getAttribute("data-variant")).toBe("tray")
    expect(classesOf(tray!)).toContain("flex-wrap")
    view.unmount()
  })
})

describe("UX-01/02: the project takes the width, with one crumb row", () => {
  it("the page has no width cap of its own, and PM's pages fold the sidebar to icons like Procurement", async () => {
    const view = await openProject("pmToday")
    expect(document.querySelector(".max-w-5xl")).toBeNull()
    view.unmount()
    expect(foldsToIcons("/contractor/projects/P1")).toBe(true)
    expect(foldsToIcons("/contractor/projects")).toBe(true)
    expect(foldsToIcons("/contractor/projects/today")).toBe(true)
    expect(foldsToIcons("/contractor/rfqs")).toBe(true)
    expect(foldsToIcons("/contractor/hr")).toBe(false)
    expect(foldsToIcons("/contractor/projectsx")).toBe(false)
  })

  it("the portal's crumb bar steps aside on a project's page only — its head carries «المشاريع › number»", async () => {
    expect(ownsTrail("/contractor/projects/P1")).toBe(true)
    for (const p of ["/contractor/projects", "/contractor/projects/today", "/contractor/projects/inbox", "/contractor/projects/new", "/contractor/projects/P1/tenders"]) expect({ p, own: ownsTrail(p) }).toEqual({ p, own: false })
    setSignedIn(ORG)
    setPathname("/contractor/projects/P1")
    const here = render(<PortalBreadcrumbs />)
    await flush()
    expect(here.container.innerHTML).toBe("")
    here.unmount()
    setPathname("/contractor/projects/P1/tenders")
    const tenders = render(<PortalBreadcrumbs />)
    await flush()
    expect(tenders.container.querySelector("nav")).not.toBeNull()
    tenders.unmount()

    const view = await openProject("pmToday")
    const crumbs = screen.getByRole("navigation", { name: "مسار التنقل" })
    expect(crumbs.textContent).toContain("المشاريع")
    expect(crumbs.textContent).toContain("2026/001")
    view.unmount()
  })
})

describe("UX-03/04/05: the head on a phone", () => {
  it("three KPI tiles across with the riyal sign apart from the figure, the name whole, Postpone behind «…»", async () => {
    atWidth(390)
    const view = await openProject("pmToday")
    const kpis = screen.getByRole("list", { name: "المشروع في ثلاثة أرقام" })
    expect(classesOf(kpis)).toContain("grid-cols-3")
    expect(kpis.querySelectorAll(":scope > li")).toHaveLength(3)
    const units = Array.from(kpis.querySelectorAll("bdi")).filter((b) => b.textContent === SAR_SIGN)
    expect(units.length).toBeGreaterThan(0)
    const h1 = screen.getByRole("heading", { level: 1 })
    expect(h1.textContent).toContain("مجمع الياسمين السكني — 5 فلل")
    expect(h1.querySelector(".truncate")).toBeNull()
    // The icon tile is beside the heading, not inside it (it sat alone on a line).
    expect(h1.querySelector("svg")).toBeNull()
    // Postpone is a menu item now; the head's row carries the two acts and «…».
    expect(screen.getByRole("button", { name: "إجراءات أخرى" })).toBeTruthy()
    expect(Array.from(document.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === "أجّل المشروع")).toBe(false)
    view.unmount()
  })
})

describe("UX-07/18: the rail, the tray and the address", () => {
  it("sub-tabs sit in a wrapping tray; choosing a screen writes ?tab= (replace, no scroll) and keeps other params", async () => {
    setSignedIn(ORG)
    setPathname(`/contractor/projects/${P}`, "tab=pmToday&from=today&work=measure")
    const view = render(<ProjectPage />)
    await flush()
    const rail = screen.getByRole("navigation", { name: "أقسام المشروع" })
    expect(classesOf(rail)).toContain("sticky")
    const group = Array.from(rail.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("العقد"))!
    fireEvent.click(group)
    await flush()
    const last = pushed[pushed.length - 1]
    expect(last).toMatch(new RegExp(`^/contractor/projects/${P}\\?`))
    const q = new URLSearchParams(last.split("?")[1])
    expect(q.get("tab")).toBeTruthy()
    expect(q.get("tab")).not.toBe("pmToday")
    expect(q.get("from")).toBe("today")
    expect(q.get("work")).toBeNull()
    const tray = document.querySelector('[role="tablist"][data-variant="tray"]')
    expect(tray).not.toBeNull()
    expect(classesOf(tray!)).toContain("flex-wrap")
    view.unmount()
  })
})

describe("UX-10: the money trail", () => {
  it("2×2 below xl, arrows only from xl, figures never truncated", async () => {
    const view = await openProject("pmToday")
    const rows = document.querySelectorAll("[data-trail-row]")
    expect(rows.length).toBe(2)
    for (const r of Array.from(rows)) {
      expect(classesOf(r)).toContain("grid-cols-2")
      for (const arrow of Array.from(r.querySelectorAll('svg[data-icon="ChevronRight"]'))) expect(classesOf(arrow)).toEqual(expect.arrayContaining(["hidden", "xl:block"]))
    }
    const figures = Array.from(document.querySelectorAll("[data-trail-figure]"))
    expect(figures.length).toBe(8)
    for (const f of figures) expect(classesOf(f)).not.toContain("truncate")
    // The description is the panel's subtitle now, not a paragraph of its own in the body.
    expect(panelTitled("مسار المال")?.querySelector("header [data-panel-description]")).not.toBeNull()
    view.unmount()
  })
})

describe("the phase-2 primitives", () => {
  it("DecisionRow dense: one line from sm, age and amount inline before the action, under the text on a phone", () => {
    render(
      <ul>
        <DecisionRow dense severity="red" icon={() => null} title="Approve sheet 04" detail="Site engineer" age="3 days" ageDays={3} amount="⃁ 1,000" action={<button type="button">Open</button>} />
      </ul>
    )
    const li = document.querySelector("li[data-dense]")!
    expect(classesOf(li)).toEqual(expect.arrayContaining(["sm:flex-nowrap", "items-center"]))
    expect(classesOf(screen.getByText("Site engineer"))).toContain("line-clamp-1")
    const meta = screen.getByText("3 days").parentElement!
    expect(meta.nextElementSibling?.textContent).toBe("Open")
    expect(classesOf(meta)).toEqual(expect.arrayContaining(["max-sm:order-last", "max-sm:w-full"]))
  })

  it("Panel description sits in the header, inline from sm", () => {
    render(
      <Panel title="Decisions" description="2 urgent · oldest 12 days">
        <p>body</p>
      </Panel>
    )
    const desc = screen.getByText("2 urgent · oldest 12 days")
    expect(desc.closest("header")).not.toBeNull()
    expect(classesOf(desc)).toContain("sm:truncate")
    expect(classesOf(desc.parentElement!)).toContain("sm:flex-row")
  })

  it("SegmentedNav tray: muted track that wraps, the chosen segment lifted, 44 px on a phone; pills unchanged", () => {
    const segs = [
      { id: "a", label: "BOQ" },
      { id: "b", label: "Terms", count: 2 },
    ]
    const { rerender } = render(<SegmentedNav variant="tray" segments={segs} active="a" onSelect={() => {}} ariaLabel="Contract" />)
    expect(classesOf(screen.getByRole("tablist", { name: "Contract" }))).toEqual(expect.arrayContaining(["bg-muted", "flex-wrap"]))
    expect(classesOf(screen.getByRole("tab", { name: "BOQ" }))).toEqual(expect.arrayContaining(["bg-card", "shadow-sm", "min-h-11", "sm:min-h-9"]))
    rerender(<SegmentedNav segments={segs} active="a" onSelect={() => {}} ariaLabel="Contract" />)
    expect(classesOf(screen.getByRole("tab", { name: "BOQ" }))).toEqual(expect.arrayContaining(["bg-module", "rounded-full"]))
  })

  it("ModuleKpiStrip: three across always; an onClick tile is a button", () => {
    const hit = jest.fn()
    render(<ModuleKpiStrip label="k" kpis={[{ id: "a", label: "A", value: "1" }, { id: "b", label: "B", value: "2", onClick: hit }, { id: "c", label: "C", value: "3", unit: SAR_SIGN }]} />)
    expect(classesOf(screen.getByRole("list", { name: "k" }))).toContain("grid-cols-3")
    fireEvent.click(screen.getByRole("button"))
    expect(hit).toHaveBeenCalled()
  })

  it("DataTable row groups: a section row opens each run of one section", () => {
    const rows = [
      { id: "1", div: "02", name: "Excavation" },
      { id: "2", div: "02", name: "Backfill" },
      { id: "3", div: "03", name: "Concrete" },
    ]
    render(
      <DataTable
        columns={[{ key: "name", header: "Item", cell: (r: (typeof rows)[number]) => r.name, hideBelow: "md" }]}
        rows={rows}
        rowKey={(r) => r.id}
        caption="BOQ"
        labels={{ sortBy: (c) => `Sort by ${c}`, showMore: (n) => `Show ${n} more` }}
        empty={null}
        rowGroup={(r) => ({ key: r.div, label: `Division ${r.div}` })}
      />
    )
    expect(Array.from(document.querySelectorAll("[data-row-group]")).map((g) => g.textContent)).toEqual(["Division 02", "Division 03"])
    expect(document.querySelector("th[scope=colgroup]")?.getAttribute("colspan")).toBe("1")
    expect(classesOf(document.querySelector("td")!)).toEqual(expect.arrayContaining(["hidden", "md:table-cell"]))
  })

  it("EmptyState bare draws no box of its own inside a Panel", () => {
    render(<EmptyState bare icon={() => null} title="Nothing waits" />)
    const box = screen.getByText("Nothing waits").parentElement!
    expect(classesOf(box)).not.toContain("border-dashed")
    expect(classesOf(box)).toContain("py-6")
  })
})

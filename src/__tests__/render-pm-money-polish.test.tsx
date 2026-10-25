/**
 * PM 1.1 phase 2 — the money / contract / file panels polished (a5-ux: UX-11…17, UX-20, UX-22).
 *
 * jsdom lays nothing out, so the polish is pinned by what makes it true: the hand-made tables with a fixed `min-w-[…]`
 * are gone from these panels (they use module-ui `DataTable`, which turns into cards on a phone), the separate bordered
 * subtitle row under a Panel header is gone (the subtitle is the Panel's `description`), Terms shows «العقد الساري»
 * once with the record and the cash beside it as top-level panels, Handover and Closeout are flat rows instead of boxes,
 * the certificate drawer is wider with its title clear of the ×, and the handover copy no longer shows `prj:HND:…`.
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
import { installDomShims, missingKeys, setPathname, setSignedIn } from "@/test-utils/render-world"
import ProjectPage from "@/app/[locale]/(contractor)/contractor/projects/[id]/page"
import { todayDay } from "@/lib/pm/format"
import { sectionsForKind } from "@/lib/pm/sections"

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

const FILES = [
  "CertificatesPanel",
  "CertificateDrawer",
  "CertifyDialog",
  "PrepareCertificateDialog",
  "ProjectTermsPanel",
  "ContractInForce",
  "TermsCashPanel",
  "VariationsPanel",
  "ClaimsPanel",
  "CostPanel",
  "CvrPanel",
  "BoundaryPanel",
  "MatchPanel",
  "PmBudgetDecisions",
  "HandoverPanel",
  "CloseoutPanel",
  "WaitingOnOthers",
].map((f) => `src/components/pm/${f}.tsx`)
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8")
const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)

function world({ prov = false }: { prov?: boolean } = {}) {
  resetFakeDb()
  seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner", name: "المالك", email: "owner@test.sa" })
  seed(`projects/${P}`, {
    organizationId: ORG,
    contractorId: ORG,
    name: "مجمع الياسمين السكني",
    location: "الرياض",
    budget: 4_658_000,
    status: "in_progress",
    projectType: "bld",
    clientName: "شركة الياسمين",
    enabledSections: sectionsForKind("bld"),
    rfqIds: [],
    projectManagerId: ORG,
    projectManagerName: "المالك",
    pm: {
      no: "PJ-2026/001",
      lifecycle: prov ? "done" : "live",
      kind: "bld",
      startOn: d(-150),
      startedAt: d(-150),
      durationDays: 365,
      signedOn: d(-170),
      terms: TERMS,
      original: TERMS,
      acceptances: prov ? { prov: { on: d(-10), by: ORG, byName: "المالك" } } : {},
      sheetCount: 1,
      ipcCount: 1,
      retentionHeld: 20_000,
      advanceRecovered: 0,
      cutPool: 0,
    },
    createdAt: iso(-170),
  })
  seed(`projects/${P}/boqItems/i1`, { itemNo: "02-01", sheet: "BOQ", divisionNo: "02", descriptionAr: "حفر", unit: "م³", quantity: 1200, unitPrice: 35, estCost: 28, totalPrice: 42_000, executedQuantity: 1200, billedQuantity: 1200, groupId: null, isEditable: true })
  seed(`projects/${P}/pmCertificates/01`, {
    seq: 1,
    status: "int",
    lines: [],
    cutsIncluded: 0,
    gross: 42_000,
    recovery: 4_200,
    retention: 2_100,
    vat: 5_670,
    net: 41_370,
    terms: { advance: 0.1, retention: 0.05, retentionCap: 0.05 },
    contractValue: 4_658_000,
    prep: "qs1",
    prepName: "مهندس الكميات",
    prepOn: d(-5),
    organizationId: ORG,
    createdAt: iso(-5),
  })
}

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))))
}

async function openProject(tab: string) {
  setSignedIn(ORG)
  setPathname(`/contractor/projects/${P}`, `tab=${tab}`)
  missingKeys.clear()
  const view = render(<ProjectPage />)
  await flush()
  return view
}
const panelTitled = (title: string) => Array.from(document.querySelectorAll("section h3")).find((h) => (h.textContent ?? "").includes(title))?.closest("section") ?? null

afterEach(() => Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 }))

describe("the money panels' sources", () => {
  it("no hand-made table with a fixed min-w is left, and no bordered subtitle row under a panel header", () => {
    const offenders: string[] = []
    for (const f of FILES) {
      const src = read(f)
      if (/<table\b[^>]*min-w-\[/.test(src)) offenders.push(`${f}: <table> with a fixed min-w`)
      if (/className="border-b px-4 py-2 text-xs/.test(src)) offenders.push(`${f}: subtitle row under the header`)
    }
    expect(offenders).toEqual([])
  })

  it("the list panels use the shared DataTable", () => {
    for (const f of ["CertificatesPanel", "VariationsPanel", "CostPanel", "CvrPanel", "BoundaryPanel", "MatchPanel"]) expect({ f, table: /<DataTable\b/.test(read(`src/components/pm/${f}.tsx`)) }).toEqual({ f, table: true })
  })

  it("UX-22: the handover note names no developer key in either language", () => {
    for (const file of ["messages/ar.json", "messages/en.json"]) {
      const note = JSON.parse(read(file)).Portal.PM.hnd.event_note as string
      expect(note).not.toMatch(/prj:|HND/)
    }
  })

  it("the certify dialog tells the user Finance is told — never the event's developer key", () => {
    const code = read("src/components/pm/CertifyDialog.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(code).not.toMatch(/prj:IPC/)
    for (const file of ["messages/ar.json", "messages/en.json"]) {
      const ipc = JSON.parse(read(file)).Portal.PM.ipc as Record<string, string>
      expect(ipc.finance_event).not.toMatch(/prj:|مفتاح|\bkey\b/)
    }
  })
})

describe("Certificates (UX-11, UX-14, UX-20)", () => {
  it("the list is a DataTable with the subtitle in the head; a row opens a wider drawer whose title clears the × and whose callout has one icon", async () => {
    world()
    const view = await openProject("ipc")
    expect([...missingKeys]).toEqual([])
    const panel = panelTitled("المستخلصات")
    expect(panel).not.toBeNull()
    expect(panel!.querySelector("header [data-panel-description]")).not.toBeNull()
    const table = panel!.querySelector("table")
    expect(table).not.toBeNull()
    expect(classesOf(table!).some((c) => c.startsWith("min-w-"))).toBe(false)
    expect(table!.querySelector("thead.sticky")).not.toBeNull()
    // Totals sit in the table's footer.
    expect(table!.querySelector("tfoot")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /01/ }))
    await flush()
    const sheet = document.querySelector('[role="dialog"]')!
    expect(sheet).not.toBeNull()
    expect(classesOf(sheet)).toContain("sm:max-w-2xl")
    const header = sheet.querySelector("h2")!.closest("div.border-b")!
    expect(classesOf(header)).toContain("pe-12")
    for (const note of Array.from(sheet.querySelectorAll('[role="note"]'))) expect(note.querySelectorAll('svg[data-icon="Info"]').length).toBeLessThanOrEqual(1)
    view.unmount()
  })

  it("on a phone the certificates become cards, not a table", async () => {
    world()
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 })
    window.dispatchEvent(new Event("resize"))
    const view = await openProject("ipc")
    const panel = panelTitled("المستخلصات")
    expect(panel).not.toBeNull()
    expect(panel!.querySelector("table")).toBeNull()
    expect(panel!.querySelector("ul li")).not.toBeNull()
    view.unmount()
  })
})

describe("Terms (UX-15)", () => {
  it("«العقد الساري» is said once, and the record and the cash are panels of their own beside it", async () => {
    world()
    const view = await openProject("pmTerms")
    expect([...missingKeys]).toEqual([])
    const heads = Array.from(document.querySelectorAll("h3")).filter((h) => (h.textContent ?? "").trim() === "العقد الساري")
    expect(heads).toHaveLength(1)
    const contract = heads[0].closest("section")!
    const record = panelTitled("سجل العقد")
    const cash = panelTitled("ما يعنيه هذا العقد نقداً")
    expect(record).not.toBeNull()
    expect(cash).not.toBeNull()
    // Neither sits inside the contract panel: no panel in a panel.
    expect(contract.contains(record)).toBe(false)
    expect(contract.contains(cash)).toBe(false)
    expect(contract.querySelector("section")).toBeNull()
    expect(contract.querySelector('[role="tablist"]')?.getAttribute("data-variant")).toBe("tray")
    view.unmount()
  })
})

describe("Handover & Closeout (UX-15, UX-22)", () => {
  it("handover is one panel of flat rows — no bordered sub-columns — and no developer key", async () => {
    world()
    const view = await openProject("info")
    const panel = panelTitled("الاستلام والضمان")
    expect(panel).not.toBeNull()
    expect(panel!.querySelectorAll("[data-hnd-phase]").length).toBeGreaterThanOrEqual(2)
    for (const phase of Array.from(panel!.querySelectorAll("[data-hnd-phase]"))) expect(classesOf(phase)).not.toContain("border")
    expect(panel!.textContent).not.toMatch(/prj:HND/)
    expect(panel!.querySelector("header [data-panel-description]")).not.toBeNull()
    view.unmount()
  })

  it("closeout rows are divided by a line, not each a tinted box", async () => {
    world({ prov: true })
    const view = await openProject("pmClose")
    expect([...missingKeys]).toEqual([])
    const rows = document.querySelector("[data-close-rows]")
    expect(rows).not.toBeNull()
    expect(classesOf(rows!)).toContain("divide-y")
    for (const el of Array.from(rows!.querySelectorAll("li > *"))) {
      expect(classesOf(el)).not.toContain("border")
      expect(classesOf(el).some((c) => /^bg-(warning|success)\//.test(c))).toBe(false)
    }
    view.unmount()
  })
})

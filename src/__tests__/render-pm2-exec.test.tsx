/**
 * PM 1.1 phase 2 — the Execution panels' polish (a5-ux UX-11…17, UX-20, UX-23): tables are module-ui `DataTable`s
 * (sticky header, phone cards, no fixed `min-w`), a panel's subtitle sits in its header (`Panel description`), grids
 * have a bounded base track, the BOQ drawer is wide with its title clear of the ×, and the programme's edit pencil is
 * an `IconButton` in the row with by-section bars that take the row's width.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)

import fs from "fs"
import path from "path"
import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, messages, missingKeys, setSignedIn } from "@/test-utils/render-world"
import type { PmAccess } from "@/hooks/usePmAccess"
import { effectiveDuties, pmCan, pmCeiling, pmRefusal, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { PmBoqPanel } from "@/components/pm/PmBoqPanel"
import { SamplesPanel } from "@/components/pm/SamplesPanel"
import { NcrPanel } from "@/components/pm/NcrPanel"
import { PunchPanel } from "@/components/pm/PunchPanel"
import { ItpPanel } from "@/components/pm/ItpPanel"
import { ProgrammePanel } from "@/components/pm/ProgrammePanel"
import { addDays } from "@/lib/pm/programme"
import type { ContractTerms } from "@/lib/pm/terms"

installDomShims()

const today = todayDay()
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const accessOf = (ctx: PmContext): PmAccess => ({
  ctx,
  uid: "own",
  isLoading: false,
  duties: effectiveDuties(ctx.ceiling, ctx.seat),
  allowed: (a) => pmRefusal(ctx, a) === null,
  refusal: (a) => pmRefusal(ctx, a),
  has: (k) => pmCan(ctx, k),
})
const actor = { uid: "own", name: "Owner" }
const lookup = (key: string): string => {
  const v = key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), messages("ar"))
  return typeof v === "string" ? v : `MISSING:${key}`
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => {})
}

const ROOT = process.cwd()
const read = (f: string) => fs.readFileSync(path.join(ROOT, "src/components/pm", f), "utf8")
const FILES = [
  "PmBoqPanel.tsx",
  "BoqItemDialog.tsx",
  "BoqItemSupply.tsx",
  "MeasurementPanel.tsx",
  "WriteSheetDialog.tsx",
  "InspectionsPanel.tsx",
  "RequestInspectionDialog.tsx",
  "RecordResultDialog.tsx",
  "ItpPanel.tsx",
  "PunchPanel.tsx",
  "NcrPanel.tsx",
  "SamplesPanel.tsx",
  "ProgrammePanel.tsx",
  "WeeklyPlanPanel.tsx",
  "SitePanel.tsx",
  "SiteDialogs.tsx",
  "UnitsPanel.tsx",
  "UnitsPulsePanel.tsx",
  "UnitField.tsx",
  "WizardBoqEditor.tsx",
  "PulseExtras.tsx",
  "ProcLineFacts.tsx",
]

beforeEach(() => {
  resetFakeDb()
  missingKeys.clear()
  setSignedIn("own")
  seed("users/own", { organizationId: "own", organizationRole: "owner" })
  seed("projects/p1", { organizationId: "own", status: "working", pm: { no: "PJ-2026/014", lifecycle: "live" } })
})

describe("the Execution panels' source (UX-11/12/14/08)", () => {
  it("no hand-made table with a fixed min-width remains", () => {
    const offenders = FILES.filter((f) => /<table[^>]*min-w-\[/.test(read(f)) || /min-w-\[\d+(px|rem)\][^"]*"\s*>\s*<table/.test(read(f)) || /<table/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it("no panel subtitle sits in a bordered row of its own under the header", () => {
    const offenders = FILES.filter((f) => /<p className="border-b px-4 py-2 text-xs/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it("every grid has a bounded base track and no bare fr track", () => {
    const offenders: string[] = []
    for (const f of FILES)
      for (const m of read(f).matchAll(/className="([^"]*\bgrid\b[^"]*)"/g)) {
        const cls = m[1].split(/\s+/)
        if (cls.some((c) => /^(sm|md|lg|xl):grid-cols-/.test(c)) && !cls.some((c) => /^grid-cols-/.test(c))) offenders.push(`${f}: ${m[1]}`)
        for (const c of cls.filter((x) => /grid-cols-\[/.test(x)))
          if (c.slice(c.indexOf("[") + 1, c.lastIndexOf("]")).split(/_(?![^(]*\))/).some((t) => /fr/.test(t) && !/^minmax\(0,/.test(t))) offenders.push(`${f}: ${c}`)
      }
    expect(offenders).toEqual([])
  })
})

describe("the BOQ (UX-12, UX-20)", () => {
  const line = (id: string, over: Record<string, unknown>) =>
    seed(`projects/p1/boqItems/${id}`, { itemNo: "02-01", descriptionAr: "حفر", unit: "m3", quantity: 100, unitPrice: 20, estCost: 15, executedQuantity: 40, billedQuantity: 10, divisionNameAr: "أعمال الحفر", ...over })

  it("is a DataTable with the division as a section row that folds, and the item drawer is wide with its title clear of the ×", async () => {
    line("a", {})
    line("b", { itemNo: "03-01", descriptionAr: "خرسانة", divisionNameAr: "الخرسانة" })
    render(<PmBoqPanel projectId="p1" orgId="own" contractValue={4000} access={accessOf(owner)} actor={actor} />)
    await flush()
    expect([...missingKeys]).toEqual([])
    const table = document.querySelector("table")!
    expect(table.className).not.toMatch(/min-w-/)
    expect(table.querySelector("thead")!.className).toContain("sticky")
    expect(table.querySelector("caption")?.textContent).toBe(lookup("Portal.PM.boq.views"))
    expect(document.querySelectorAll("[data-row-group]")).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: lookup("Portal.PM.boq.group") }))
    expect(Array.from(document.querySelectorAll("[data-row-group] b")).map((b) => b.textContent)).toEqual(["أعمال الحفر", "الخرسانة"])
    expect(screen.getByText("حفر")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: lookup("Portal.PM.boq.collapse_section").replace("{name}", "أعمال الحفر") }))
    expect(screen.queryByText("حفر")).toBeNull()
    expect(document.querySelectorAll("[data-row-group]")).toHaveLength(2)

    fireEvent.click(screen.getByText("خرسانة"))
    await flush()
    const drawer = document.querySelector('[role="dialog"]')!
    expect(drawer.className).toContain("sm:max-w-2xl")
    expect(drawer.querySelector(".pe-12")).not.toBeNull()
  })

  it("the view filters are chips, not a second tab rail", async () => {
    line("a", {})
    render(<PmBoqPanel projectId="p1" orgId="own" contractValue={4000} access={accessOf(owner)} actor={actor} />)
    await flush()
    expect(document.querySelector('[role="tablist"]')).toBeNull()
    expect(screen.getByRole("group", { name: lookup("Portal.PM.boq.views") }).querySelectorAll("button[aria-pressed]")).toHaveLength(5)
  })
})

/** The panel (section) whose header holds the `data-panel-description` with this key's text. */
const descriptionOf = (key: string) => {
  const head = lookup(key).split("{")[0].trim()
  return Array.from(document.querySelectorAll("section > header [data-panel-description]")).find((d) => (d.textContent ?? "").includes(head)) ?? null
}

describe("the quality panels (UX-12/13/14/15)", () => {
  it("samples: a DataTable with the status column, the subtitle in the panel header", async () => {
    seed("projects/p1/pmSubmittals/01", { seq: 1, itemId: "i1", code: "03-01", supplier: "Saudi Readymix", what: "Concrete C40", rev: 1, status: "sub", day: addDays(today, -3), by: "own" })
    render(<SamplesPanel projectId="p1" orgId="own" items={[{ id: "i1", code: "03-01", description: "Concrete" }]} access={accessOf(owner)} actor={actor} />)
    await flush()
    expect([...missingKeys]).toEqual([])
    const table = document.querySelector("table")!
    expect(table.querySelector("caption")?.textContent).toBe(lookup("Portal.PM.sample.title2"))
    expect(Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent)).toContain(lookup("Portal.PM.sample.col_status"))
    expect(descriptionOf("Portal.PM.sample.sub2")).not.toBeNull()
  })

  it("NCR: the subtitle sits in the header, not in a bordered row under it", async () => {
    render(<NcrPanel projectId="p1" orgId="own" items={[]} access={accessOf(owner)} actor={actor} />)
    await flush()
    expect(descriptionOf("Portal.PM.ncr.sub")).not.toBeNull()
    expect(document.querySelector("p.border-b")).toBeNull()
  })

  it("punch: flat divide-y rows inside the panel, not bordered cards in it", async () => {
    seed("projects/p1/pmPunch/01", { seq: 1, what: "Cracked tile", location: "Villa 2 — kitchen", severity: "a", source: "cons", status: "open", day: today, by: "own" })
    render(<PunchPanel projectId="p1" orgId="own" access={accessOf(owner)} actor={actor} />)
    await flush()
    const row = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes("Cracked tile")).closest("li")!
    expect(row.className).not.toMatch(/rounded-xl border/)
    expect(row.parentElement!.className).toContain("divide-y")
    // The three figures stay three across on a phone.
    expect(document.querySelector("ul.grid-cols-3")).not.toBeNull()
  })

  it("ITP: a DataTable inside the panel (no frame of its own), subtitle in the header", async () => {
    seed("projects/p1/pmItp/01", { seq: 1, itemId: "i1", code: "03-01", stage: "Before pour", test: "Slump", freq: "Each truck", need: 2, party: "consultant", by: "own" })
    render(<ItpPanel projectId="p1" items={[{ id: "i1", code: "03-01", description: "Concrete" }]} access={accessOf(owner)} actor={actor} />)
    await flush()
    const table = document.querySelector("table")!
    expect(table.querySelector("caption")?.textContent).toBe(lookup("Portal.PM.itp.title"))
    expect(table.closest("section")?.querySelector("[data-panel-description]")?.textContent).toBe(lookup("Portal.PM.itp.sub"))
  })
})

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
} as unknown as ContractTerms

describe("the programme (UX-23)", () => {
  it("the activity's edit pencil is an IconButton in the row, and by-section bars take the row's width", async () => {
    seed("projects/p1/pmActivities/01", { seq: 1, name: "Footings", from: addDays(today, -20), to: addDays(today, 10), itemIds: ["i1"], pred: null, by: "own", at: today })
    const items = [
      { id: "i1", code: "03-01", description: "Footings", division: "Concrete", quantity: 100, rate: 10, executed: 30 },
      { id: "i2", code: "04-01", description: "Blocks", division: "Masonry", quantity: 100, rate: 10, executed: 5 },
    ]
    render(<ProgrammePanel projectId="p1" lifecycle="live" original={TERMS} startOn={addDays(today, -60)} durationDays={300} baseValue={2000} items={items} access={accessOf(owner)} actor={actor} />)
    await flush()
    expect([...missingKeys]).toEqual([])
    const pencil = screen.getByRole("button", { name: lookup("Portal.PM.prg.act_edit") })
    expect(pencil.parentElement?.tagName).toBe("LI")
    const sections = descriptionOf("Portal.PM.prg.sections_desc")!.closest("section")!
    const bars = Array.from(sections.querySelectorAll("li > div.rounded-full"))
    expect(bars.length).toBe(2)
    for (const b of bars) {
      expect(b.className).toContain("flex-1")
      expect(b.className).not.toMatch(/\bw-(32|48)\b/)
    }
  })
})

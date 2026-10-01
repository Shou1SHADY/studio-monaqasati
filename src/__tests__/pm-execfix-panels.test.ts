/**
 * PM 1.0 — the screens of the execution fixes, rendered for real in Arabic over
 * the in-memory Firestore: the weekly plan offers the close of a week left open
 * and words the party an obstacle waits on; the delivery units never print
 * "Infinity", show the retention the contract's release term frees from what is
 * held, refuse the set-up without a BOQ before the click, and split again.
 * (The rules themselves are in pm-execfix-week / -units / -docs.)
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)
jest.mock("next/navigation", () => jest.requireActual("@/test-utils/render-world").navigationMock)

import React from "react"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims } from "@/test-utils/render-world"
import { UnitsPanel } from "@/components/pm/UnitsPanel"
import { WeeklyPlanPanel } from "@/components/pm/WeeklyPlanPanel"
import type { PmAccess } from "@/hooks/usePmAccess"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"
import type { PmUnit } from "@/lib/pm/units"
import { weekStart } from "@/lib/pm/weekly-plan"

installDomShims()

const ctx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const access = { ctx, uid: "pm1", isLoading: false, duties: null, allowed: () => true, refusal: () => null, has: () => true } as unknown as PmAccess
const actor = { uid: "pm1", name: "Abdullah" }
const today = todayDay()
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ")
const sar = (n: number) => pmMoney(n).replace(/\s+/g, " ")
const button = (root: Element, label: string) => [...root.querySelectorAll("button")].find((b) => text(b).includes(label)) ?? null

const project = (terms: ContractTerms, pm: Record<string, unknown> = {}) =>
  seed("projects/p1", { organizationId: "org", budget: 100_000, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/004", lifecycle: "live", startedAt: shift(today, -70), terms, original: terms, ...pm } })

describe("the weekly plan screen", () => {
  const items = [{ id: "i1", code: "03-01", quantity: 100, rate: 10, executed: 0, unit: "m3" }]
  const panel = () => render(React.createElement(WeeklyPlanPanel, { projectId: "p1", items, sections: { docs: false, subm: false, wir: false, rfi: true, hse: false }, access, actor }))

  beforeEach(() => {
    resetFakeDb()
    project(defaultTerms())
  })

  it("offers the close of a week left open three weeks ago, before a new week is planned", () => {
    const week = weekStart(shift(today, -21))
    seed(`projects/p1/pmWeeks/${week}`, { week, status: "open", tasks: [{ activityId: "a1", name: "Frame", qty: 10, ready: true }], by: "pm1" })
    const { container } = panel()
    expect(button(container, "أقفِل الأسبوع")).not.toBeNull()
    expect(button(container, "خطة الأسبوع")).toBeNull()
    expect(text(container)).toContain("Frame")
  })

  it("an obstacle addressed to the consultant with no name typed reads «لدى الاستشاري», not the stored code", () => {
    seed("projects/p1/pmActivities/a1", { seq: 1, name: "Slab", from: shift(today, 1), to: shift(today, 6), itemIds: ["i1"], pred: null, by: "pm1", at: "" })
    seed("projects/p1/pmObstacles/rfi-01", { type: "rfi", seq: 1, title: "Duct clash", party: "consultant", partyName: "", itemIds: ["i1"], impact: "x", openOn: shift(today, -3), closeOn: null, by: "pm1" })
    const first = panel()
    expect(text(first.container)).toContain("Duct clash — لدى الاستشاري")
    expect(text(first.container)).not.toContain("consultant")
    first.unmount()

    seed("projects/p1/pmObstacles/rfi-01", { type: "rfi", seq: 1, title: "Duct clash", party: "consultant", partyName: "Al-Bina", itemIds: ["i1"], impact: "x", openOn: shift(today, -3), closeOn: null, by: "pm1" })
    expect(text(panel().container)).toContain("Duct clash — لدى Al-Bina")
  })
})

describe("the delivery units screen", () => {
  const items = [{ id: "a", code: "01", description: "Structure", unit: "m3", quantity: 100, rate: 1000, executed: 10 }]
  const panel = (terms: ContractTerms, list = items) => render(React.createElement(UnitsPanel, { projectId: "p1", items: list, startedOn: shift(today, -70), terms, access, actor }))
  const units = (lines: PmUnit["lines"], plan: string | null) => {
    seed("projects/p1/pmUnits/01", { seq: 1, name: "Villa 1", plan, ho: null, lines })
    seed("projects/p1/pmUnits/02", { seq: 2, name: "Villa 2", plan: null, ho: null, lines })
  }

  beforeEach(() => resetFakeDb())

  it("a unit whose planned day is today shows no rate — never «Infinity»", () => {
    const terms = defaultTerms({ retention: 0.1 })
    project(terms, { retentionHeld: 3000 })
    units({ a: { q: 50, ex: 5 } }, today)
    const { container } = panel(terms)
    expect(text(container)).toContain("Villa 1")
    expect(text(container)).not.toContain("Infinity")
  })

  it("shows what the handover frees: half of what is held against the unit, and nothing on a full release", () => {
    const half = defaultTerms({ retention: 0.1 })
    project(half, { retentionHeld: 3000 })
    units({ a: { q: 50, ex: 5 } }, null)
    const first = panel(half)
    // 3,000 held on a 100,000 BOQ: 1,500 against a 50,000 unit, half of it — not half of what the terms could hold (1,250).
    expect(text(first.container)).toContain(sar(750))
    expect(text(first.container)).not.toContain(sar(1250))
    first.unmount()

    const full = { ...half, retentionRelease: "full" as const }
    project(full, { retentionHeld: 3000 })
    const second = panel(full)
    expect(text(second.container)).not.toContain(sar(750))
    expect(text(second.container)).not.toContain(sar(1250))
  })

  it("before the BOQ has quantities the set-up is not offered", () => {
    const terms = defaultTerms()
    project(terms, { lifecycle: "plan" })
    expect((button(panel(terms, []).container, "أنشئ الوحدات") as HTMLButtonElement).disabled).toBe(true)
  })

  it("units set up before the BOQ are split again from the screen", async () => {
    const terms = defaultTerms()
    project(terms, { lifecycle: "plan" })
    seed("projects/p1/boqItems/a", { itemNo: "01", quantity: "100", unitPrice: "1000" })
    units({}, null)
    const { container } = panel(terms)
    const again = container.querySelector('button svg[data-icon="RefreshCw"]')?.closest("button") ?? null
    expect(again).not.toBeNull()
    await act(async () => {
      fireEvent.click(again as HTMLButtonElement)
    })
    await waitFor(() => expect(readDoc<PmUnit>("projects/p1/pmUnits/02")?.lines).toEqual({ a: { q: 50, ex: 0 } }))
    expect(readDoc<PmUnit>("projects/p1/pmUnits/01")?.lines).toEqual({ a: { q: 50, ex: 0 } })
  })
})

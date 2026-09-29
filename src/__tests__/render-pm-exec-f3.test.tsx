/**
 * The Execution screens this fix wave changed (V3-pm-exec 01, 02, 04, 06, 09),
 * rendered over the in-memory store: the plant row's regulatory gates and the
 * plant-day dialog's hours and day-rate explanation, the critical-path mark in
 * the three-week readiness, and the sheet dialog's header number. A string may
 * still be pending its merge into the message files — then it renders as
 * MISSING:<key>, which proves the screen asks for it.
 */

jest.mock("firebase/firestore", () => jest.requireActual("@/test-utils/render-world").firestoreMock)
jest.mock("@/firebase", () => jest.requireActual("@/test-utils/render-world").firebaseMock)
jest.mock("next-intl", () => jest.requireActual("@/test-utils/render-world").intlMock)
jest.mock("lucide-react", () => jest.requireActual("@/test-utils/render-world").lucideMock)
jest.mock("@/i18n/routing", () => jest.requireActual("@/test-utils/render-world").routingMock)

import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { installDomShims, messages, setSignedIn } from "@/test-utils/render-world"
import type { PmAccess } from "@/hooks/usePmAccess"
import { effectiveDuties, pmCan, pmCeiling, pmRefusal, type PmContext } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { addDays } from "@/lib/pm/programme"
import { PlantPanel } from "@/components/pm/PlantPanel"
import { WeeklyPlanPanel } from "@/components/pm/WeeklyPlanPanel"
import { WriteSheetDialog } from "@/components/pm/WriteSheetDialog"

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

const lookup = (key: string): string | null => {
  const v = key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), messages("ar"))
  return typeof v === "string" ? v : null
}
/** The key's Arabic text (up to its first placeholder), or its MISSING marker while pending. */
const shows = (key: string) => {
  const v = lookup(key)
  const text = document.body.textContent ?? ""
  return v ? text.includes(v.split("{")[0].trim()) : text.includes(`MISSING:${key}`)
}

beforeEach(() => {
  resetFakeDb()
  setSignedIn("own")
  seed("users/own", { organizationId: "own", organizationRole: "owner" })
  seed("projects/p1", { organizationId: "own", status: "working", pm: { no: "PJ-2026/014", lifecycle: "live", plantCount: 1, sheetCount: 6 } })
})

describe("plant on site (V3-pm-exec-01/02)", () => {
  const plant = (over: Record<string, unknown>) =>
    seed("projects/p1/pmPlant/01", {
      seq: 1,
      tag: "M-114",
      name: "Excavator",
      category: "heavy",
      ownership: "hire",
      qty: 1,
      dayRate: 1200,
      from: addDays(today, -10),
      to: addDays(today, 30),
      status: "use",
      handover: { on: addDays(today, -10), meter: 8420, condition: "ok", by: "own" },
      days: { [addDays(today, -1)]: "work" },
      licenceTo: addDays(today, 200),
      by: "own",
      ...over,
    })

  it("an unregistered unit shows the red gate; a service within 150 h the amber one", () => {
    plant({ hercNo: null, serviceAt: 8500 })
    render(<PlantPanel projectId="p1" orgId="own" access={accessOf(owner)} actor={actor} />)
    expect(shows("Portal.PM.plant.gate.herc")).toBe(true)
    expect(shows("Portal.PM.plant.gate.srv_in")).toBe(true)
  })

  it("the day dialog asks the hours of a working day and explains the day rate", () => {
    plant({ hercNo: "HE-1" })
    render(<PlantPanel projectId="p1" orgId="own" access={accessOf(owner)} actor={actor} />)
    act(() => {
      fireEvent.click(screen.getByText((_, el) => el?.tagName === "BUTTON" && (el.textContent ?? "").includes(lookup("Portal.PM.plant.log_today") ?? "MISSING:Portal.PM.plant.log_today")))
    })
    expect(shows("Portal.PM.plant.hours")).toBe(true)
    expect(shows("Portal.PM.plant.day_rate")).toBe(true)
  })
})

describe("three-week readiness (V3-pm-exec-04)", () => {
  it("marks the activities on the critical path", () => {
    const items = [{ id: "i1", code: "03-01", quantity: 100, rate: 10, executed: 0, unit: "m3" }]
    seed("projects/p1/pmActivities/01", { seq: 1, name: "Footings", from: addDays(today, -2), to: addDays(today, 5), itemIds: ["i1"], pred: null, by: "own", at: today })
    seed("projects/p1/pmActivities/02", { seq: 2, name: "Columns", from: addDays(today, 6), to: addDays(today, 15), itemIds: ["i1"], pred: "01", by: "own", at: today })
    render(<WeeklyPlanPanel projectId="p1" items={items} sections={{ docs: false, subm: false, wir: false, rfi: false, hse: false }} access={accessOf(owner)} actor={actor} />)
    const mark = lookup("Portal.PM.wwp.critical") ?? "MISSING:Portal.PM.wwp.critical"
    expect(screen.getAllByText(mark)).toHaveLength(2)
  })
})

describe("the measurement sheet dialog (V3-pm-exec-06/09)", () => {
  it("names the number the sheet will get", () => {
    render(
      <WriteSheetDialog open onOpenChange={() => {}} projectId="p1" access={accessOf(owner)} actor={actor} items={[]} basis="rem" lines={[]} inspections={[]} nextNo="014/07" />
    )
    expect((document.body.textContent ?? "").includes("014/07")).toBe(true)
  })
})

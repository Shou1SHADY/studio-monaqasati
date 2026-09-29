/**
 * PM 1.0 — indirect costs (the prototype's DIRECT register): a budget per kind
 * set by the manager; the spend read from what the books tag to the project and
 * the plant days logged — never an item's cost counted twice. They enter the
 * project's budget, committed figure and forecast.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { projectCost } from "@/lib/pm/cost"
import { indirectActuals, indirectKindOf, indirectRows } from "@/lib/pm/indirect"
import { PmIndirectError, setIndirectBudgets } from "@/lib/pm/indirect-writes"

const db = fakeFirestore as unknown as Firestore

describe("the spend", () => {
  it("maps booked accounts to kinds; items' own accounts and workshop labour are not indirect", () => {
    expect(indirectKindOf("510201")).toBe("stf")
    expect(indirectKindOf("510401")).toBe("eq")
    expect(indirectKindOf("510601")).toBe("eq")
    expect(indirectKindOf("510501")).toBe("ovh")
    expect(indirectKindOf("520301")).toBe("ins")
    expect(indirectKindOf("510101")).toBeNull()
    expect(indirectKindOf("510301")).toBeNull()
    expect(indirectKindOf("510701")).toBeNull()
    expect(indirectKindOf("110101")).toBeNull()
  })

  it("reads only this project's lines, skips reversed entries and site purchases items already carry, and adds logged plant days", () => {
    const { byKind, plantLogged } = indirectActuals(
      "p1",
      [
        { sourceType: "hr_pay", status: "posted", lines: [{ account: "510201", debit: 30_000, project: "p1" }, { account: "510201", debit: 9_000, project: "p2" }, { account: "210202", credit: 39_000 }] },
        { sourceType: "manual_voucher", status: "posted", lines: [{ account: "510501", debit: 4_000, project: "p1" }] },
        { sourceType: "manual_voucher", status: "reversed", lines: [{ account: "510501", debit: 99_000, project: "p1" }] },
        { sourceType: "pm_cash", status: "posted", lines: [{ account: "510501", debit: 700, project: "p1" }] },
      ],
      2_500
    )
    expect(byKind).toEqual({ stf: 30_000, eq: 2_500, ovh: 4_000, ins: 0 })
    expect(plantLogged).toBe(2_500)
  })

  it("rows show the kinds with a budget or a spend", () => {
    const r = indirectRows({ stf: 50_000, ins: 0 }, { stf: 30_000, eq: 2_500, ovh: 0, ins: 0 })
    expect(r.rows.map((x) => x.kind)).toEqual(["stf", "eq"])
    expect([r.budget, r.actual]).toEqual([50_000, 32_500])
  })
})

describe("the roll-up", () => {
  const base = { items: [{ id: "i1", code: "01", description: "", division: "", quantity: 10, rate: 100, executed: 5, estCost: 80 }], costs: new Map(), unassigned: { budget: null, budgetExecuted: null, committed: 0, actual: 0, paid: 0 }, variations: [], baseValue: 0, penalty: 0 }
  it("the budget, committed, actual and forecast carry the indirect costs; the planned margin falls", () => {
    const without = projectCost(base)
    const withIt = projectCost({ ...base, indirect: { budget: 200, actual: 50 } })
    expect(withIt.budget - without.budget).toBe(200)
    expect(withIt.actual - without.actual).toBe(50)
    expect(withIt.committed - without.committed).toBe(50)
    expect(withIt.forecastCost - without.forecastCost).toBe(200)
    expect(withIt.plannedMargin).toBe(without.plannedMargin - 200)
  })
  it("a spend above its budget forecasts the spend, not the budget", () => {
    expect(projectCost({ ...base, indirect: { budget: 100, actual: 300 } }).forecastCost - projectCost(base).forecastCost).toBe(300)
  })
})

describe("the budgets", () => {
  const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
  const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
  beforeEach(() => {
    resetFakeDb()
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/004", lifecycle: "live" } })
  })
  it("the manager sets them on the project; the site engineer cannot; a negative is refused", async () => {
    await setIndirectBudgets(db, pm, "p1", { stf: 620_000, eq: 270_000 })
    expect(readDoc<{ pm: { indirect: unknown; no: string } }>("projects/p1")?.pm).toMatchObject({ no: "PJ-2026/004", indirect: { stf: 620_000, eq: 270_000 } })
    await expect(setIndirectBudgets(db, site, "p1", { stf: 1 })).rejects.toBeInstanceOf(PmAccessError)
    await expect(setIndirectBudgets(db, pm, "p1", { ovh: -5 })).rejects.toBeInstanceOf(PmIndirectError)
  })
})

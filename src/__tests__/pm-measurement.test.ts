/**
 * PM 1.0 — measurement sheets (MS-01, MS-02, MS-04, CON-02, CON-05, WF-04;
 * AC-09's first half and AC-10's "start freezes"). The measurer is not the
 * approver; executed moves only on approval, capped at the remaining at
 * approval time on a lump sum; an unpriced item moves but adds no money; the
 * first approved sheet takes the project live and freezes the original.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { applySheet, overRemaining, remainingOf, rerateExcess, sheetAge, sheetBlocks, type MeasuredItem } from "@/lib/pm/measurement"
import { approveSheet, PmSheetError, returnSheet, writeSheet } from "@/lib/pm/measurement-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const pmA = { uid: "pm1", name: "Abdullah" }

const item = (id: string, quantity: number, rate: number, executed = 0): MeasuredItem => ({ id, quantity, rate, executed })

function seedProject(basis: "rem" | "lump", lifecycle = "live") {
  const terms = { ...defaultTerms(), basis }
  seed("projects/p1", { organizationId: "org", budget: 1_000_000, projectManagerId: "pm1", status: lifecycle === "plan" ? "approved_waiting_start" : "working", pm: { no: "PJ-2026/003", lifecycle, terms, original: lifecycle === "plan" ? null : terms } })
  seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "100", unitPrice: "118", executedQuantity: 90 })
  seed("projects/p1/boqItems/i2", { itemNo: "09-02-01", quantity: "50", unitPrice: "", executedQuantity: 0 })
}
const exec = (id: string) => (readDoc<Record<string, any>>(`projects/p1/boqItems/${id}`) as Record<string, any>).executedQuantity

beforeEach(() => resetFakeDb())

describe("the pure rules", () => {
  it("lump sum: capped at the remaining; re-measurement: not capped, excess over 125% re-rated (CON-05)", () => {
    const lines = [{ itemId: "i1", qty: 30 }]
    expect(applySheet(lines, [item("i1", 100, 10, 90)], "lump").lines[0].approved).toBe(10)
    expect(applySheet(lines, [item("i1", 100, 10, 90)], "rem").lines[0].approved).toBe(30)
    expect(overRemaining("lump", item("i1", 100, 10, 90), 30)).toBe(20)
    expect(overRemaining("rem", item("i1", 100, 10, 90), 30)).toBe(0)
    expect(rerateExcess(item("i1", 100, 10), 140)).toBe(15)
    expect(remainingOf(item("i1", 100, 10, 120))).toBe(0)
  })

  it("an unpriced item moves but adds no money (CON-02)", () => {
    const r = applySheet([{ itemId: "i2", qty: 12 }, { itemId: "i1", qty: 5 }], [item("i1", 100, 118), item("i2", 50, 0)], "rem")
    expect(r.moved).toBe(2)
    expect(r.value).toBe(590)
    expect(r.executed).toEqual({ i1: 5, i2: 12 })
  })

  it("a sheet needs lines with positive quantities on known items", () => {
    expect(sheetBlocks({ archived: false, lines: [], items: [] })).toEqual(["no_lines"])
    expect(sheetBlocks({ archived: false, lines: [{ itemId: "x", qty: 2 }], items: [{ id: "i1" }] })).toEqual(["unknown_item"])
    expect(sheetBlocks({ archived: false, lines: [{ itemId: "i1", qty: -2 }], items: [{ id: "i1" }] })).toEqual(["bad_qty"])
    expect(sheetBlocks({ archived: true, lines: [{ itemId: "i1", qty: 2 }], items: [{ id: "i1" }] })).toEqual(["archived"])
    expect(sheetAge("2026-09-25", "2026-09-27")).toBe(2)
  })
})

describe("the writes (WF-04)", () => {
  it("the site engineer's sheet moves nothing until the PM approves it (MS-01, MS-02)", async () => {
    seedProject("rem")
    const r = await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 5 }] })
    expect(r).toMatchObject({ seq: 1, self: false })
    expect(readDoc("projects/p1/pmSheets/01")).toMatchObject({ status: "wait", by: "se1", self: false })
    expect(exec("i1")).toBe(90)
    await expect(approveSheet(db, site, "p1", seA, 1)).rejects.toBeInstanceOf(PmAccessError)
    const a = await approveSheet(db, pm, "p1", pmA, 1)
    expect(a).toMatchObject({ moved: 1, value: 590 })
    expect(exec("i1")).toBe(95)
    expect(readDoc("projects/p1/pmSheets/01")).toMatchObject({ status: "ok", okBy: "pm1", self: false, lines: [{ itemId: "i1", qty: 5, approved: 5 }] })
    await expect(approveSheet(db, pm, "p1", pmA, 1)).rejects.toMatchObject({ code: "not_waiting" })
  })

  it("the cap is taken at approval time, not writing time (MS-02)", async () => {
    seedProject("lump")
    await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 8 }] })
    await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 8 }] })
    await approveSheet(db, pm, "p1", pmA, 1)
    expect(exec("i1")).toBe(98)
    await approveSheet(db, pm, "p1", pmA, 2)
    expect(exec("i1")).toBe(100)
    expect(readDoc<Record<string, any>>("projects/p1/pmSheets/02")!.lines[0].approved).toBe(2)
  })

  it("someone holding both duties self-approves, and it is recorded", async () => {
    seedProject("rem")
    const r = await writeSheet(db, pm, "p1", pmA, { day: "2026-09-27", lines: [{ itemId: "i2", qty: 10 }] })
    expect(r.self).toBe(true)
    expect(readDoc("projects/p1/pmSheets/01")).toMatchObject({ status: "ok", self: true, okBy: "pm1" })
    expect(exec("i2")).toBe(10)
  })

  it("the first approved sheet takes a planning project live and freezes the original (MS-04, TRM-02)", async () => {
    seedProject("rem", "plan")
    await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 1 }] })
    expect(readDoc<Record<string, any>>("projects/p1")!.pm.lifecycle).toBe("plan")
    const r = await approveSheet(db, pm, "p1", pmA, 1)
    expect(r.wentLive).toBe(true)
    const p = readDoc<Record<string, any>>("projects/p1")!
    expect(p.pm).toMatchObject({ lifecycle: "live", startedBy: "measurement", original: { basis: "rem" } })
    expect(p.status).toBe("working")
  })

  it("sending back moves nothing", async () => {
    seedProject("rem")
    await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 5 }] })
    await returnSheet(db, pm, "p1", pmA, 1, "Re-measure grid C")
    expect(readDoc("projects/p1/pmSheets/01")).toMatchObject({ status: "no", returnNote: "Re-measure grid C" })
    expect(exec("i1")).toBe(90)
  })

  it("nothing on an archived project, and nothing without lines", async () => {
    seedProject("rem", "closed")
    await expect(writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 5 }] })).rejects.toMatchObject({ code: "archived" })
    seedProject("rem")
    await expect(writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 0 }] })).rejects.toBeInstanceOf(PmSheetError)
  })
})

describe("what the audit of 2 Oct 2026 found on measurement", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require("@/lib/pm/measurement") as typeof import("@/lib/pm/measurement")

  it("re-measurement: an item at its contract quantity is still measured — extra quantity needs no variation (CON-05); a lump sum hides it", () => {
    const items = [item("i1", 100, 10, 100), item("i2", 50, 10, 20)]
    expect(m.openItems(items, "rem").open.map((i) => i.id)).toEqual(["i1", "i2"])
    expect(m.openItems(items, "rem").done).toBe(0)
    expect(m.openItems(items, "lump").open.map((i) => i.id)).toEqual(["i2"])
    expect(m.openItems(items).open.map((i) => i.id)).toEqual(["i2"])
  })

  it("the inspection gate goes with its section: switched off, a flagged item is measured (MS-03, the prototype's HAS('wir'))", () => {
    const flagged = [{ id: "i1", gate: { pmInspect: true, pmWir: null } }]
    const lines = [{ itemId: "i1", qty: 5 }]
    expect(m.sheetBlocks({ archived: false, lines, items: flagged })).toEqual(["not_measurable"])
    expect(m.sheetBlocks({ archived: false, lines, items: flagged, gateOn: false })).toEqual([])
  })

  it("the measuring day is checked in the write, not only in the dialog: never a future or malformed day", async () => {
    seedProject("rem")
    await expect(writeSheet(db, site, "p1", seA, { day: "2099-01-01", lines: [{ itemId: "i1", qty: 1 }] })).rejects.toMatchObject({ code: "blocked", blocks: ["bad_day"] })
    await expect(writeSheet(db, site, "p1", seA, { day: "soon", lines: [{ itemId: "i1", qty: 1 }] })).rejects.toMatchObject({ code: "blocked", blocks: ["bad_day"] })
  })

  it("a project whose inspections section is off measures a flagged item; with it on, the write refuses", async () => {
    seedProject("rem")
    seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: "100", unitPrice: "118", executedQuantity: 90, pmInspect: true, pmWir: null })
    await expect(writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 1 }] })).rejects.toMatchObject({ blocks: ["not_measurable"] })
    const p = readDoc<Record<string, unknown>>("projects/p1") as Record<string, unknown>
    seed("projects/p1", { ...p, enabledSections: ["contract", "procure", "docs"] })
    await expect(writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 1 }] })).resolves.toMatchObject({ seq: 1 })
  })
})

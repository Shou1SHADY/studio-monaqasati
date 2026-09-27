/**
 * PM 1.0 — inspections and the measurement gate (WIR-01…03, MS-03, WF-15).
 * A result is one of three and never saved without a choice; a failed
 * inspection is re-inspected as a numbered attempt; an item that requires
 * inspection is measured only when its last attempt passed — checked when the
 * sheet is written and again when it is approved.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { gateOf, isKnownStatus, measurable, requestBlocks, resultBlocks, type PmInspection } from "@/lib/pm/inspection"
import { recordResult, reinspect, requestInspection, setInspectionRequired } from "@/lib/pm/inspection-writes"
import { approveSheet, writeSheet } from "@/lib/pm/measurement-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const pmA = { uid: "pm1", name: "Abdullah" }

function seedProject() {
  const terms = defaultTerms()
  seed("projects/p1", { organizationId: "org", budget: 1e6, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live", terms, original: terms } })
  seed("projects/p1/boqItems/i1", { itemNo: "03-02-01", quantity: "100", unitPrice: "900", executedQuantity: 0, pmInspect: true })
  seed("projects/p1/boqItems/i2", { itemNo: "09-01-01", quantity: "50", unitPrice: "80", executedQuantity: 0 })
}
const wir = (n: string) => readDoc<PmInspection>(`projects/p1/pmInspections/${n}`) as PmInspection
const line = (id: string) => readDoc<Record<string, any>>(`projects/p1/boqItems/${id}`) as Record<string, any>

beforeEach(() => resetFakeDb())

describe("the pure rules", () => {
  it("the gate: free, passed (with or without comments), or blocked (MS-03)", () => {
    expect(gateOf({})).toBe("free")
    expect(gateOf({ pmInspect: true })).toBe("needs")
    expect(gateOf({ pmInspect: true, pmWir: "open" })).toBe("open")
    expect(gateOf({ pmInspect: true, pmWir: "fail" })).toBe("failed")
    expect(measurable({ pmInspect: true, pmWir: "cond" })).toBe(true)
    expect(measurable({ pmInspect: true, pmWir: "fail" })).toBe(false)
  })

  it("a result is one of three — no choice, no save (WIR-03); the state dictionary is closed", () => {
    expect(resultBlocks({ archived: false, status: "open", result: undefined })).toEqual(["no_choice"])
    expect(resultBlocks({ archived: false, status: "open", result: "maybe" })).toEqual(["no_choice"])
    expect(resultBlocks({ archived: false, status: "pass", result: "fail" })).toEqual(["not_open"])
    expect(isKnownStatus("cond")).toBe(true)
    expect(isKnownStatus(undefined)).toBe(false)
  })

  it("a request names the item, location, party (other stated) and day (WIR-01)", () => {
    expect(requestBlocks({ archived: false, itemId: null, location: " ", on: null, party: "other", partyText: "" })).toEqual(["no_item", "no_location", "no_date", "party_text"])
  })
})

describe("the writes and the gate", () => {
  it("an item requiring inspection cannot be measured before it passes", async () => {
    seedProject()
    await expect(writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 5 }] })).rejects.toMatchObject({ blocks: ["not_measurable"] })
    await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i2", qty: 5 }] })
    const seq = await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Villa 2 — slab", party: "consultant", on: "2026-09-28" })
    expect(seq).toBe(1)
    expect(line("i1").pmWir).toBe("open")
    await recordResult(db, site, "p1", seA, 1, { result: "pass" })
    expect(line("i1").pmWir).toBe("pass")
    await writeSheet(db, site, "p1", seA, { day: "2026-09-28", lines: [{ itemId: "i1", qty: 5 }] })
  })

  it("a failed inspection blocks, and re-inspection is the next numbered attempt with history (WIR-02)", async () => {
    seedProject()
    await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Grid C", party: "consultant", on: "2026-09-27" })
    await recordResult(db, site, "p1", seA, 1, { result: "fail", note: "Cover to rebar short" })
    await expect(recordResult(db, site, "p1", seA, 1, { result: "pass" })).rejects.toMatchObject({ blocks: ["not_open"] })
    await reinspect(db, site, "p1", seA, 1, { on: "2026-09-29" })
    expect(wir("01")).toMatchObject({ status: "open" })
    expect(wir("01").attempts.map((a) => [a.n, a.result])).toEqual([
      [1, "fail"],
      [2, null],
    ])
    await recordResult(db, site, "p1", seA, 1, { result: "cond", note: "Fix spacers" })
    expect(line("i1").pmWir).toBe("cond")
  })

  it("the gate runs again at approval: a sheet written before a failure is not approved", async () => {
    seedProject()
    await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Grid C", party: "consultant", on: "2026-09-27" })
    await recordResult(db, site, "p1", seA, 1, { result: "pass" })
    await writeSheet(db, site, "p1", seA, { day: "2026-09-27", lines: [{ itemId: "i1", qty: 5 }] })
    await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Grid D", party: "consultant", on: "2026-09-28" })
    await recordResult(db, site, "p1", seA, 2, { result: "fail" })
    await expect(approveSheet(db, pm, "p1", pmA, 1)).rejects.toMatchObject({ blocks: ["not_measurable"] })
  })

  it("a result without a choice is refused by the write too (WIR-03)", async () => {
    seedProject()
    await requestInspection(db, site, "p1", seA, { itemId: "i1", location: "Grid C", party: "consultant", on: "2026-09-27" })
    await expect(recordResult(db, site, "p1", seA, 1, { result: null })).rejects.toMatchObject({ blocks: ["no_choice"] })
    expect(wir("01").status).toBe("open")
  })

  it("inspections are quality's; which items require one is approve's", async () => {
    seedProject()
    await expect(requestInspection(db, qs, "p1", { uid: "qs1", name: null }, { itemId: "i1", location: "x", party: "internal", on: "2026-09-27" })).rejects.toBeInstanceOf(PmAccessError)
    await expect(setInspectionRequired(db, site, "p1", [{ itemId: "i2", on: true }])).rejects.toBeInstanceOf(PmAccessError)
    await setInspectionRequired(db, pm, "p1", [{ itemId: "i2", on: true }])
    expect(line("i2").pmInspect).toBe(true)
  })
})

/**
 * PM 1.0 — switching sections (SEC-01…05, INV-17): on is immediate; off needs a
 * reason ("other" stated) and no blocker — money and custody block — core
 * sections never switch off; every switch is logged, by approve only.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { PmSectionsError, switchBlocks, switchOffBlockers, switchSections } from "@/lib/pm/sections-governance"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const none = { storeLines: 0, uncollected: 0 }

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", enabledSections: ["contract", "procure", "store", "receive", "ipc"], pm: { no: "PJ-2026/003", lifecycle: "live" } })
})

describe("the rules", () => {
  it("money and custody block; nothing else does (SEC-03)", () => {
    expect(switchOffBlockers(["store"], { storeLines: 3, uncollected: 0 })).toEqual(["store_stock"])
    expect(switchOffBlockers(["ipc"], { storeLines: 3, uncollected: 1 })).toEqual(["uncollected"])
    expect(switchOffBlockers(["docs"], { storeLines: 3, uncollected: 1 })).toEqual([])
  })

  it("off needs a reason, other stated; core never switches off; on needs none", () => {
    expect(switchBlocks({ archived: false, turnedOn: [], turnedOff: ["contract", "ipc"], reason: "other", reasonText: " ", facts: none })).toEqual(["core", "reason_text"])
    expect(switchBlocks({ archived: false, turnedOn: ["docs"], turnedOff: [], reason: null, facts: none })).toEqual([])
  })
})

describe("the write", () => {
  it("logs who, what and why, and keeps the data", async () => {
    await switchSections(db, pm, "p1", { uid: "pm1", name: "Abdullah" }, { next: ["contract", "procure", "store", "receive"], reason: "module", facts: none })
    const p = readDoc<{ enabledSections: string[]; pm: { secLog: Array<Record<string, unknown>> } }>("projects/p1")!
    expect(p.enabledSections).toEqual(["contract", "procure", "store", "receive"])
    expect(p.pm.secLog[0]).toMatchObject({ off: ["ipc"], on: [], reason: "module", by: "pm1" })
  })

  it("refuses a switch-off with stock left, and anyone without approve", async () => {
    await expect(switchSections(db, pm, "p1", { uid: "pm1", name: null }, { next: ["contract", "procure", "ipc"], reason: "scope", facts: { storeLines: 2, uncollected: 0 } })).rejects.toBeInstanceOf(PmSectionsError)
    await expect(switchSections(db, site, "p1", { uid: "se1", name: null }, { next: ["contract", "procure"], reason: "scope", facts: none })).rejects.toBeInstanceOf(PmAccessError)
  })
})

describe("C-47 — variations, claims and programme follow their sections", () => {
  const { pmTabVisible } = jest.requireActual("@/lib/pm/sections") as typeof import("@/lib/pm/sections")
  it("a project whose sections predate the gate keeps every tab", () => {
    expect(pmTabVisible(["contract", "procure", "ipc"], "vo", 0)).toBe(true)
  })
  it("a modern project shows a tab only when its section is on or it holds records", () => {
    expect(pmTabVisible(["contract", "claim"], "vo", 0)).toBe(false)
    expect(pmTabVisible(["contract", "claim"], "vo", 2)).toBe(true)
    expect(pmTabVisible(["contract", "claim"], "claim", 0)).toBe(true)
  })
})

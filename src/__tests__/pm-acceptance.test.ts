/**
 * PM 1.0 — provisional and final handover (WF-25, IPC-05, PN-03, INV-09).
 * Provisional at ≥ 99% progress by value; final after it and with no open punch
 * item; each sends prj:HND once; the defects period comes from the contract in
 * force; half the retention is claimable at provisional on a "half" term.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { defectsEnd, finalBlocks, progressOf, provisionalBlocks, retentionClaimable } from "@/lib/pm/acceptance"
import { PmAcceptanceError, recordFinal, recordProvisional } from "@/lib/pm/acceptance-writes"
import { PM_EVENTS } from "@/lib/pm/events"
import { raisePunch, recordConfirmation, recordFix } from "@/lib/pm/punch-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }
const seA = { uid: "se1", name: "Omar" }

function seedProject(executed: number) {
  const terms = { ...defaultTerms({ retention: 0.1 }), defectsDays: 180 }
  seed("projects/p1", { organizationId: "org", budget: 1e6, projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/004", lifecycle: "live", terms, original: terms, retentionHeld: 40_000 } })
  seed("projects/p1/boqItems/i1", { itemNo: "01", quantity: "100", unitPrice: "1000", executedQuantity: executed })
  seed("projects/p1/boqItems/i2", { itemNo: "02", quantity: "10", unitPrice: "", executedQuantity: 0 })
}

beforeEach(() => resetFakeDb())

describe("the pure rules", () => {
  it("progress is by value over priced items only", () => {
    expect(progressOf([{ quantity: 100, rate: 1000, executed: 99 }, { quantity: 10, rate: 0, executed: 0 }])).toBe(99)
    expect(progressOf([{ quantity: 10, rate: 0, executed: 10 }])).toBeNull()
  })

  it("provisional at 99%, once; final after it and with the punch list closed (INV-09, PN-03)", () => {
    expect(provisionalBlocks({ archived: false, lifecycle: "live", acceptances: {}, progress: 98.9 })).toEqual(["progress"])
    expect(finalBlocks({ archived: false, lifecycle: "live", acceptances: {}, openPunch: 0 })).toEqual(["no_provisional"])
    expect(finalBlocks({ archived: false, lifecycle: "live", acceptances: { prov: { on: "x", by: "u" } }, openPunch: 2 })).toEqual(["punch_open"])
  })

  it("the defects period is the contract's; half the retention at provisional on a half term (IPC-05)", () => {
    expect(defectsEnd("2026-09-27", 180)).toBe("2027-03-26")
    expect(retentionClaimable(40_000, "half", { prov: { on: "x", by: "u" } })).toBe(20_000)
    expect(retentionClaimable(40_000, "full", { prov: { on: "x", by: "u" } })).toBe(0)
    expect(retentionClaimable(40_000, "full", { prov: { on: "x", by: "u" }, final: { on: "y", by: "u" } })).toBe(40_000)
  })
})

describe("the writes", () => {
  it("provisional refused below 99%; recorded at 99% with prj:HND:prov", async () => {
    seedProject(90)
    await expect(recordProvisional(db, pm, "p1", pmA)).rejects.toMatchObject({ blocks: ["progress"] })
    seedProject(99)
    await expect(recordProvisional(db, site, "p1", seA)).rejects.toBeInstanceOf(PmAccessError)
    await recordProvisional(db, pm, "p1", pmA)
    expect((readDoc<Record<string, any>>("projects/p1") as Record<string, any>).pm.acceptances.prov).toMatchObject({ by: "pm1" })
    expect(readDoc(`${PM_EVENTS}/prj:HND:PJ-2026_004:prov`)).toMatchObject({ kind: "HND", amount: 20_000 })
  })

  it("final waits for every punch item to be confirmed, then the project is handed over", async () => {
    seedProject(100)
    await recordProvisional(db, pm, "p1", pmA)
    const n = await raisePunch(db, site, "p1", seA, { what: "Paint", location: "Lobby", severity: "b", source: "cons" })
    await recordFix(db, site, "p1", seA, n)
    await expect(recordFinal(db, pm, "p1", pmA)).rejects.toBeInstanceOf(PmAcceptanceError)
    await recordConfirmation(db, site, "p1", seA, n)
    await recordFinal(db, pm, "p1", pmA)
    const p = readDoc<Record<string, any>>("projects/p1") as Record<string, any>
    expect(p.pm).toMatchObject({ lifecycle: "done", acceptances: { final: { by: "pm1" } } })
    expect(listCollection<{ key: string }>(PM_EVENTS).map((e) => e.key).sort()).toEqual(["prj:HND:PJ-2026/004:final", "prj:HND:PJ-2026/004:prov"])
  })
})

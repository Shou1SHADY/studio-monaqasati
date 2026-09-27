/**
 * PM 1.0 — the punch list (PN-01…03, WF-17). An exact location and who raised
 * it ("other" stated); open → fixed → closed, and "fixed" is not "closed" until
 * the raising party's confirmation is recorded.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { isOpenPunch, punchBlocks, punchStepBlocks, type PunchItem } from "@/lib/pm/punch"
import { PmPunchError, raisePunch, recordConfirmation, recordFix } from "@/lib/pm/punch-writes"

const db = fakeFirestore as unknown as Firestore
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const seA = { uid: "se1", name: "Omar" }
const item = (n: string) => readDoc<PunchItem>(`projects/p1/pmPunch/${n}`) as PunchItem

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
})

describe("the punch list", () => {
  it("needs what, where, and who raised it — other stated (PN-01, RSN-01)", () => {
    expect(punchBlocks({ archived: false, what: " ", location: "", source: "oth", sourceText: "" })).toEqual(["no_what", "no_location", "source_text"])
    expect(punchStepBlocks({ archived: false, status: "open", step: "confirm" })).toEqual(["wrong_state"])
  })

  it("fixed is not closed until the raiser's confirmation is recorded (PN-02)", async () => {
    const seq = await raisePunch(db, site, "p1", seA, { what: "Hairline crack", location: "Villa 1 — stair", severity: "a", source: "cons" })
    expect(item("01")).toMatchObject({ status: "open", severity: "a", source: "cons" })
    await expect(recordConfirmation(db, site, "p1", seA, seq)).rejects.toBeInstanceOf(PmPunchError)
    await recordFix(db, site, "p1", seA, seq, "Re-plastered")
    expect(item("01")).toMatchObject({ status: "fix" })
    expect(isOpenPunch(item("01"))).toBe(true)
    await recordConfirmation(db, site, "p1", seA, seq)
    expect(item("01")).toMatchObject({ status: "done", conf: { party: "cons", by: "se1" } })
    expect(isOpenPunch(item("01"))).toBe(false)
  })

  it("is quality's — the QS office records none", async () => {
    await expect(raisePunch(db, qs, "p1", { uid: "qs1", name: null }, { what: "x", location: "y", severity: "b", source: "int" })).rejects.toBeInstanceOf(PmAccessError)
  })
})

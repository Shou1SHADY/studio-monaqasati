/**
 * PM 1.0 — bringing a pre-PM project in as it stands: its measured quantities
 * stay approved executed, its claims become what is billed (per line, and the
 * retention and advance they took), its status gives its stage, a live one's
 * original freezes now, and the owner's manager is seated. Owner only, once.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { adoptProject, legacyBilling, PmAdoptError } from "@/lib/pm/adopt-writes"
import type { ContractTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const owner = { uid: "owner", name: "Marco" }

beforeEach(() => {
  resetFakeDb()
  seed("projects/old", { organizationId: "owner", name: "Tower", status: "working", budget: 1_000_000, ipcTerms: { retentionPercent: 5, advanceRecoveryPercent: 10 } })
  seed("projects/old/boqItems/i1", { itemNo: "01", quantity: 100, unitPrice: 1000, executedQuantity: 60 })
  seed("projects/old/ipcClaims/c1", { status: "collected", lines: [{ boqItemId: "i1", currentQty: 40 }, { boqItemId: "gone", currentQty: 5 }], totals: { retention: 2_000, advanceRecovery: 4_000 } })
})

describe("adopting a legacy project", () => {
  it("sums what the legacy claims billed", () => {
    const b = legacyBilling([{ lines: [{ boqItemId: "a", currentQty: 2 }], totals: { retention: 1, advanceRecovery: 2 } }, { lines: [{ boqItemId: "a", currentQty: 3 }] }])
    expect(b.billedByItem.get("a")).toBe(5)
    expect(b).toMatchObject({ retentionHeld: 1, advanceRecovered: 2 })
  })

  it("joins as it stands and seats the manager", async () => {
    const { projectNo } = await adoptProject(db, "old", owner, { isOwner: true, managerId: "pm1", managerName: "Abdullah", startOn: "2026-02-01", durationDays: 300 })
    expect(projectNo).toMatch(/^PJ-\d{4}\/\d{3}$/)
    const p = readDoc<{ projectManagerId: string; pm: { lifecycle: string; terms: ContractTerms; original: ContractTerms; retentionHeld: number; advanceRecovered: number; startedBy: string } }>("projects/old")!
    expect(p.projectManagerId).toBe("pm1")
    expect(p.pm).toMatchObject({ lifecycle: "live", retentionHeld: 2_000, advanceRecovered: 4_000, startedBy: "adoption" })
    expect(p.pm.terms).toMatchObject({ retention: 0.05, advance: 0.1 })
    expect(p.pm.original).toEqual(p.pm.terms)
    expect(readDoc("projects/old/boqItems/i1")).toMatchObject({ executedQuantity: 60, billedQuantity: 40 })
    expect(readDoc("projects/old/members/pm1")).toMatchObject({ pmRole: "pm", off: [], to: null })
  })

  it("is the owner's, and happens once", async () => {
    await expect(adoptProject(db, "old", owner, { isOwner: false, managerId: "pm1", managerName: null, startOn: null, durationDays: 10 })).rejects.toBeInstanceOf(PmAdoptError)
    await adoptProject(db, "old", owner, { isOwner: true, managerId: "pm1", managerName: null, startOn: null, durationDays: 10 })
    await expect(adoptProject(db, "old", owner, { isOwner: true, managerId: "pm1", managerName: null, startOn: null, durationDays: 10 })).rejects.toMatchObject({ code: "already" })
  })

  it("a project not started stays in planning, its original not yet frozen", async () => {
    seed("projects/new", { organizationId: "owner", status: "todo" })
    await adoptProject(db, "new", owner, { isOwner: true, managerId: "pm1", managerName: null, startOn: null, durationDays: 90 })
    expect(readDoc<{ pm: { lifecycle: string; original: unknown } }>("projects/new")!.pm).toMatchObject({ lifecycle: "plan", original: null })
  })
})

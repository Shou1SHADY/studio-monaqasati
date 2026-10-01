/**
 * PM 1.0 — the advance term reaches Finance (WF-01 step 4, IPC-02). prj:ADV was
 * sent only when the project was born: a handover with no advance, completed
 * with one before Start, never told Finance — the receivable was never opened
 * while every certificate recovered an advance nobody had asked for. Going live
 * (Start, or the first approved measurement) sends it once if none was sent.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { PM_EVENTS, type PmEvent } from "@/lib/pm/events"
import { writeSheet } from "@/lib/pm/measurement-writes"
import { savePlanTerms, startProject } from "@/lib/pm/project-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const P = "projects/p1"
const pmCtx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const actor = { uid: "pm1", name: "Abdullah" }
const events = () => listCollection(PM_EVENTS) as unknown as PmEvent[]

function project(advance: number, over: Record<string, unknown> = {}) {
  seed(P, {
    organizationId: ORG,
    name: "Villas",
    projectManagerId: "pm1",
    budget: 1_000_000,
    status: "approved_waiting_start",
    pm: { no: "PJ-2026/001", lifecycle: "plan", terms: defaultTerms({ advance, retention: 0.05 }), original: null, durationDays: 100 },
    ...over,
  })
  seed(`${P}/boqItems/i1`, { itemNo: "03-01", unit: "m3", quantity: 100, unitPrice: 5_000, executedQuantity: 0, billedQuantity: 0 })
}

beforeEach(() => resetFakeDb())

describe("the advance set before Start reaches Finance at Start", () => {
  it("born without an advance, completed with 10%: Start sends prj:ADV on the contract value", async () => {
    project(0)
    await savePlanTerms(db, pmCtx, "p1", defaultTerms({ advance: 0.1, retention: 0.05 }), actor)
    expect(events()).toHaveLength(0)
    await startProject(db, pmCtx, "p1", 1, actor)
    expect(events()).toHaveLength(1)
    // Priced BOQ: 100 × 5,000 = 500,000 — the value in force, not the handover's figure.
    expect(readDoc(`${PM_EVENTS}/org__prj:ADV:PJ-2026_001`)).toMatchObject({ kind: "ADV", organizationId: ORG, projectId: "p1", amount: 50_000, by: "pm1", params: { rate: 0.1, contractValue: 500_000 } })
  })

  it("never a second one: an advance Finance already holds is not sent again, under the old id or the new", async () => {
    project(0.1)
    seed(`${PM_EVENTS}/prj:ADV:PJ-2026_001`, { key: "prj:ADV:PJ-2026/001", kind: "ADV", organizationId: ORG, projectId: "p1", amount: 100_000 })
    await startProject(db, pmCtx, "p1", 1, actor)
    expect(events()).toHaveLength(1)
  })

  it("no advance, or nobody pays: nothing is sent", async () => {
    project(0)
    await startProject(db, pmCtx, "p1", 1, actor)
    expect(events()).toHaveLength(0)
    resetFakeDb()
    project(0.1, { pm: { no: "PJ-2026/001", lifecycle: "plan", terms: { ...defaultTerms({ advance: 0.1, retention: 0.05 }), payer: "none" }, original: null, durationDays: 100 } })
    await startProject(db, pmCtx, "p1", 1, actor)
    expect(events()).toHaveLength(0)
  })

  it("the first approved measurement starts the project — and sends it too", async () => {
    project(0.1)
    const r = await writeSheet(db, pmCtx, "p1", actor, { day: new Date().toISOString().slice(0, 10), lines: [{ itemId: "i1", qty: 10 }] })
    expect(r.wentLive).toBe(true)
    expect(readDoc(`${PM_EVENTS}/org__prj:ADV:PJ-2026_001`)).toMatchObject({ kind: "ADV", amount: 50_000 })
  })
})

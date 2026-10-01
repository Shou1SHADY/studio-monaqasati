/**
 * PM 1.0 — the Finance outbox across organisations (INV-15, §11). Project
 * numbers are drawn per organisation, so two companies both own PJ-2026/001.
 * With the event's document id being the key alone, the second company's event
 * landed on the first's document: under the rules an update (refused, with the
 * whole transaction — no handover accepted, no certificate certified); and
 * without rules, a silent overwrite. The id carries the organisation; Finance's
 * journal source id stays the key, as posted entries are keyed by it.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { CrmOpportunity } from "@/lib/crm"
import { eventDocId, pmEventDocId, PM_EVENTS, type PmEvent } from "@/lib/pm/events"
import { acceptHandover, sendHandoverFile } from "@/lib/pm/handover-writes"

const db = fakeFirestore as unknown as Firestore

async function born(org: string, managerUid: string): Promise<string> {
  seed(`crmOpportunities/o-${org}`, { organizationId: org, state: "won", stage: "won" })
  const id = await sendHandoverFile(db, {
    organizationId: org,
    actor: { uid: `crm-${org}`, name: "Sara" },
    opportunity: { id: `o-${org}`, title: `Tower of ${org}`, contactId: "c1", contactName: "Client", stageHistory: [] } as unknown as CrmOpportunity,
    clientType: "private",
    location: "Riyadh",
    contractNumber: "C-1",
    value: 1_000_000,
    durationDays: 300,
    signedOn: "2026-09-16",
    startOn: "2026-11-20",
    advance: 0.1,
    retention: 0.05,
    kind: "bld",
    note: null,
    to: managerUid,
    toName: "Manager",
  })
  const { projectNo } = await acceptHandover(db, { uid: managerUid, name: "Manager" }, id, { kind: "bld", location: null, enabledSections: ["contract", "procure"], manager: { uid: managerUid, name: "Manager", groupId: null } })
  return projectNo
}

describe("the outbox id carries the organisation", () => {
  beforeEach(() => resetFakeDb())

  it("two companies with the same project number each keep their own advance event", async () => {
    const noA = await born("orgA", "pmA")
    const noB = await born("orgB", "pmB")
    expect(noA).toBe(noB) // the numbers are per organisation: both are the year's first

    const events = listCollection<PmEvent>(PM_EVENTS)
    expect(events.map((e) => e.organizationId).sort()).toEqual(["orgA", "orgB"])
    expect(readDoc<PmEvent>(`${PM_EVENTS}/${pmEventDocId("orgA", `prj:ADV:${noA}`)}`)).toMatchObject({ organizationId: "orgA", kind: "ADV", amount: 100_000 })
    expect(readDoc<PmEvent>(`${PM_EVENTS}/${pmEventDocId("orgB", `prj:ADV:${noB}`)}`)).toMatchObject({ organizationId: "orgB", kind: "ADV", amount: 100_000 })
  })

  it("the document id is `{org}__{key}`; the journal's source id stays the key alone", () => {
    expect(pmEventDocId("orgA", "prj:IPC:PJ-2026/014:01")).toBe("orgA__prj:IPC:PJ-2026_014:01")
    expect(eventDocId("prj:IPC:PJ-2026/014:01")).toBe("prj:IPC:PJ-2026_014:01")
  })
})

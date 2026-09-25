/**
 * PM 1.0 slice 2, the writes: CRM sends a handover FILE (no project), and only
 * the manager it names answers it — accept (the project is born with its
 * number, manager seat and one advance event), return, or pass it on. Then the
 * terms are completed before start, and Start freezes the original.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { CrmOpportunity } from "@/lib/crm"
import { PM_EVENTS } from "@/lib/pm/events"
import { PM_HANDOVERS, type PmHandover } from "@/lib/pm/handover"
import { acceptHandover, reassignHandover, returnHandover, sendHandoverFile, PmHandoverError } from "@/lib/pm/handover-writes"
import { savePlanTerms, startProject, PmProjectError } from "@/lib/pm/project-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const ORG = "owner-uid"
const crm = { uid: "crm1", name: "Sara" }
const pm = { uid: "pm1", name: "Abdullah" }
const other = { uid: "pm2", name: "Fahad" }

const opportunity = { id: "o1", title: "Al-Yasmin Compound", contactId: "c1", contactName: "Al-Yasmin Development", stageHistory: [] } as unknown as CrmOpportunity

async function send(over: Partial<Parameters<typeof sendHandoverFile>[1]> = {}) {
  seed("crmOpportunities/o1", { organizationId: ORG, state: "won", stage: "won" })
  return sendHandoverFile(db, {
    organizationId: ORG,
    actor: crm,
    opportunity,
    clientType: "private",
    location: "Riyadh",
    contractNumber: "C-2026/007",
    value: 22_400_000,
    durationDays: 540,
    signedOn: "2026-09-16",
    startOn: "2026-11-20",
    advance: 0.1,
    retention: 0.05,
    kind: "bld",
    note: null,
    to: pm.uid,
    toName: pm.name,
    ...over,
  })
}
const file = (id: string) => readDoc<PmHandover>(`${PM_HANDOVERS}/${id}`) as PmHandover
const accept = (id: string, actor = pm) => acceptHandover(db, actor, id, { kind: "bld", location: null, enabledSections: ["contract", "procure"], groupId: "g-pm" })

beforeEach(() => resetFakeDb())

describe("CRM sends a file — it creates no project (HO-01)", () => {
  it("writes a waiting file addressed to the manager, and marks the deal handed over without a project", async () => {
    const id = await send()
    expect(file(id)).toMatchObject({ status: "wait", to: "pm1", value: 22_400_000, durationDays: 540, advance: 0.1 })
    expect(listCollection("projects")).toHaveLength(0)
    expect(readDoc("crmOpportunities/o1")).toMatchObject({ state: "handed_over", handoverStatus: "pending", pmHandoverId: id, projectId: null, durationDays: 540 })
  })
})

describe("the addressed manager accepts (HO-02, WF-01)", () => {
  it("creates the project 'plan' with its number, the PM seat, the default terms and one advance event", async () => {
    const id = await send()
    const { projectId, projectNo } = await accept(id)
    expect(projectNo).toBe(`PJ-${new Date().getUTCFullYear()}/001`)
    const project = readDoc<Record<string, unknown>>(`projects/${projectId}`) as Record<string, any>
    expect(project).toMatchObject({ organizationId: ORG, pmHandoverId: id, projectManagerId: "pm1", budget: 22_400_000, status: "approved_waiting_start" })
    expect(project.pm).toMatchObject({ no: projectNo, lifecycle: "plan", durationDays: 540, original: null })
    expect(project.pm.terms).toMatchObject({ advance: 0.1, retention: 0.05, retentionCap: 0.05, paymentDays: 30 })
    expect(readDoc(`projects/${projectId}/members/pm1`)).toMatchObject({ pmRole: "pm", viaHandover: true, groupId: "g-pm" })
    expect(file(id)).toMatchObject({ status: "acc", projectId })
    expect(readDoc("crmOpportunities/o1")).toMatchObject({ projectId, handoverStatus: "accepted" })
    const events = listCollection<{ key: string; amount: number }>(PM_EVENTS)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ key: `prj:ADV:${projectNo}`, amount: 2_240_000 })
  })

  it("the second project of the year draws the next number", async () => {
    await accept(await send())
    const { projectNo } = await accept(await send())
    expect(projectNo).toMatch(/\/002$/)
  })

  it("no advance, or nobody pays: no advance event", async () => {
    await accept(await send({ advance: null }))
    expect(listCollection(PM_EVENTS)).toHaveLength(0)
  })

  it("only the manager it names may answer, and only once", async () => {
    const id = await send()
    await expect(accept(id, other)).rejects.toMatchObject({ code: "not_yours" })
    await accept(id)
    await expect(accept(id)).rejects.toMatchObject({ code: "not_waiting" })
    expect(listCollection("projects")).toHaveLength(1)
  })

  it("a file without a value, a duration or a signature cannot be accepted — and creates nothing", async () => {
    const id = await send({ value: 0, signedOn: null })
    await expect(accept(id)).rejects.toBeInstanceOf(PmHandoverError)
    expect(listCollection("projects")).toHaveLength(0)
    expect(file(id).status).toBe("wait")
  })
})

describe("return and reassign (HO-03, HO-04)", () => {
  it("returning names what is missing and gives the deal back to CRM, won", async () => {
    const id = await send()
    await returnHandover(db, pm, id, { missing: ["boq", "dwg"], note: "Need the priced BOQ", missingText: "BOQ، drawings" })
    expect(file(id)).toMatchObject({ status: "ret", returned: { missing: ["boq", "dwg"], note: "Need the priced BOQ", by: "pm1" } })
    expect(readDoc("crmOpportunities/o1")).toMatchObject({ state: "won", handoverStatus: "rejected", pmHandoverId: null })
    await expect(returnHandover(db, pm, id, { missing: ["boq"], missingText: "x" })).rejects.toMatchObject({ code: "not_waiting" })
  })

  it("reassigning keeps it waiting for the new manager, records why, and only they can then accept", async () => {
    const id = await send()
    await expect(reassignHandover(db, pm, id, { to: "pm2", toName: "Fahad", reason: "other", reasonText: " " })).rejects.toMatchObject({ code: "invalid" })
    await reassignHandover(db, pm, id, { to: "pm2", toName: "Fahad", reason: "load" })
    expect(file(id)).toMatchObject({ status: "wait", to: "pm2" })
    expect(file(id).reassigns?.[0]).toMatchObject({ from: "pm1", to: "pm2", reason: "load", by: "pm1" })
    await expect(accept(id, pm)).rejects.toMatchObject({ code: "not_yours" })
    await accept(id, other)
    expect(file(id).status).toBe("acc")
  })
})

describe("terms before start, and Start (TRM-01, TRM-02, WF-03)", () => {
  it("terms save only while the project is not started; Start needs a BOQ and freezes the original", async () => {
    const { projectId } = await accept(await send())
    const terms = { ...defaultTerms({ advance: 0.1, retention: 0.05 }), paymentDays: 45 }
    await savePlanTerms(db, projectId, terms)
    await expect(startProject(db, projectId, 0)).rejects.toMatchObject({ code: "blocked", blocks: ["no_boq"] })
    await startProject(db, projectId, 12)
    const pmBlock = (readDoc<Record<string, any>>(`projects/${projectId}`) as Record<string, any>).pm
    expect(pmBlock).toMatchObject({ lifecycle: "live", original: { paymentDays: 45 } })
    expect(pmBlock.startedAt).toBeTruthy()
    await expect(savePlanTerms(db, projectId, { ...terms, paymentDays: 60 })).rejects.toBeInstanceOf(PmProjectError)
    await expect(startProject(db, projectId, 12)).rejects.toMatchObject({ code: "blocked", blocks: ["not_plan"] })
  })

  it("invalid terms are refused before any write", async () => {
    const { projectId } = await accept(await send())
    await expect(savePlanTerms(db, projectId, { ...defaultTerms(), advance: 2 })).rejects.toMatchObject({ code: "invalid" })
  })
})

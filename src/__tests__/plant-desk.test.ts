/**
 * The equipment desk (Warehouses → equipment desk): the approved equipment
 * requests of the company's projects, waiting for the store keeper's answer —
 * who sees them, in what order, who is told, and what an answer may and may not
 * do. Until this desk existed an approved request went nowhere and the site
 * typed the desk's answer itself.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { daysToNeed, deskAnswered, deskQueue, deskReplyBlocks, deskSummary, deskUrgency, withDesk, type DeskRequest } from "@/lib/pm/plant-desk"
import { PlantDeskError, answerPlantRequest } from "@/lib/pm/plant-desk-writes"
import type { PmPlantRequest } from "@/lib/pm/supply"
import { decidePlant, requestPlant } from "@/lib/pm/supply-writes"

const db = fakeFirestore as unknown as Firestore
const TODAY = "2026-10-05"

const request = (over: Partial<DeskRequest> = {}): DeskRequest => ({
  id: "01",
  seq: 1,
  category: "light",
  what: "Generator",
  activityId: null,
  from: "2026-10-10",
  to: "2026-10-20",
  qty: 1,
  operator: false,
  whyK: "site",
  why: null,
  status: "go",
  day: "2026-10-01",
  by: "se1",
  byName: "Site",
  projectId: "p1",
  projectName: "Villas",
  projectNo: "PJ-2026/001",
  ...over,
})

describe("what waits on the desk", () => {
  it("is an approved request nobody has answered and the site has not received", () => {
    expect(withDesk(request())).toBe(true)
    expect(withDesk(request({ status: "wait" }))).toBe(false)
    expect(withDesk(request({ status: "rej" }))).toBe(false)
    expect(withDesk(request({ rep: { k: "alloc", unit: "G-1", on: TODAY, by: "st1" } }))).toBe(false)
    expect(withDesk(request({ got: { plantSeq: 1, on: TODAY, by: "se1" } }))).toBe(false)
  })

  it("is in the order it must be answered: the earliest need-by date first, then project, then number", () => {
    const queue = deskQueue([
      request({ id: "03", seq: 3, from: "2026-10-12", projectName: "A" }),
      request({ id: "01", seq: 1, from: "2026-10-08", projectName: "B" }),
      request({ id: "02", seq: 2, from: "2026-10-08", projectName: "A" }),
      request({ id: "09", seq: 9, status: "wait" }),
    ])
    expect(queue.map((r) => [r.projectName, r.seq])).toEqual([
      ["A", 2],
      ["B", 1],
      ["A", 3],
    ])
  })

  it("shows the recent answers, newest first, and only answered approved requests", () => {
    const rep = (on: string) => ({ k: "none" as const, on, by: "st1" })
    const answered = deskAnswered([
      request({ id: "01", seq: 1, rep: rep("2026-10-01") }),
      request({ id: "02", seq: 2, rep: rep("2026-10-04") }),
      request({ id: "03", seq: 3 }),
      request({ id: "04", seq: 4, status: "rej", rep: rep("2026-10-05") }),
    ])
    expect(answered.map((r) => r.seq)).toEqual([2, 1])
    expect(deskAnswered([request({ seq: 1, rep: rep("2026-10-01") }), request({ seq: 2, rep: rep("2026-10-02") })], 1).map((r) => r.seq)).toEqual([2])
  })
})

describe("how urgent an unanswered request is", () => {
  it("counts the days to the need-by date and marks late, soon and later", () => {
    expect(daysToNeed({ from: "2026-10-08" }, TODAY)).toBe(3)
    expect(deskUrgency({ from: "2026-10-04" }, TODAY)).toBe("late")
    expect(deskUrgency({ from: TODAY }, TODAY)).toBe("soon")
    expect(deskUrgency({ from: "2026-10-08" }, TODAY)).toBe("soon")
    expect(deskUrgency({ from: "2026-10-09" }, TODAY)).toBe("later")
  })

  it("summarises only what still waits", () => {
    const rows = [
      request({ seq: 1, from: "2026-10-01" }),
      request({ seq: 2, from: "2026-10-07" }),
      request({ seq: 3, from: "2026-11-01" }),
      request({ seq: 4, from: "2026-10-01", rep: { k: "alloc", unit: "G", on: TODAY, by: "st1" } }),
    ]
    expect(deskSummary(rows, TODAY)).toEqual({ waiting: 3, late: 1, soon: 1 })
  })
})

describe("answering", () => {
  const ok = { projectClosed: false, r: request(), k: "alloc" as const, unit: "GEN-04", free: "", text: "", on: TODAY, today: TODAY }

  it("needs the detail that kind of answer carries", () => {
    expect(deskReplyBlocks(ok)).toEqual([])
    expect(deskReplyBlocks({ ...ok, unit: " " })).toContain("no_unit")
    expect(deskReplyBlocks({ ...ok, k: "late", free: "" })).toContain("no_free")
    expect(deskReplyBlocks({ ...ok, k: "alt", text: "" })).toContain("no_text")
    expect(deskReplyBlocks({ ...ok, k: "none" })).toEqual([])
    expect(deskReplyBlocks({ ...ok, k: null })).toContain("no_kind")
  })

  it("is once, on an approved request, in an open project, and never dated in the future", () => {
    expect(deskReplyBlocks({ ...ok, projectClosed: true })).toContain("archived")
    expect(deskReplyBlocks({ ...ok, r: request({ status: "wait" }) })).toContain("not_with_desk")
    expect(deskReplyBlocks({ ...ok, r: request({ rep: { k: "none", on: TODAY, by: "st1" } }) })).toContain("replied")
    expect(deskReplyBlocks({ ...ok, on: "2026-10-06" })).toContain("future")
  })
})

describe("the writes", () => {
  const P = "projects/p1"
  const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
  const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
  const pmActor = { uid: "pm1", name: "PM" }
  const siteActor = { uid: "se1", name: "Site" }
  const storeActor = { uid: "st1", name: "Store keeper" }
  const input = { category: "light" as const, what: "Generator", activityId: null, activityName: null, hasActivities: false, from: "2026-10-10", to: "2026-10-20", qty: 2, operator: false, whyK: "site" as const, why: null }

  beforeEach(() => {
    resetFakeDb()
    seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed("teamGroups/desk", { organizationId: "org", permissions: ["warehouses.manage"] })
    seed("teamGroups/site", { organizationId: "org", permissions: ["pm.site"] })
    seed("users/st1", { organizationId: "org", organizationRole: "member", defaultGroupId: "desk" })
    seed("users/se1", { organizationId: "org", organizationRole: "member", defaultGroupId: "site" })
    seed("users/pm1", { organizationId: "org", organizationRole: "member", defaultGroupId: "site" })
  })

  const approved = (over: Record<string, unknown> = {}) =>
    seed(`${P}/pmPlantRequests/01`, { seq: 1, category: "light", what: "Generator", qty: 2, from: "2026-10-10", to: "2026-10-20", status: "go", by: "se1", byName: "Site", organizationId: "org", ...over })

  it("an approved request is told to the store keepers the moment it is approved, not to the site or the approver", async () => {
    const asked = await requestPlant(fakeFirestore as unknown as Firestore, site, "p1", siteActor, input)
    expect(asked.status).toBe("wait")
    expect(listCollection("users/st1/notifications")).toHaveLength(0)
    await decidePlant(db, pm, "p1", pmActor, 1, true)
    const [n] = listCollection<{ type: string; link: string; i18n: { params: Record<string, unknown> } }>("users/st1/notifications")
    expect(n).toMatchObject({ type: "plant_requested", link: "/contractor/warehouses/equipment", i18n: { params: { no: "01", what: "Generator", qty: 2, project: "Villas", actor: "PM" } } })
    expect(listCollection("users/se1/notifications")).toHaveLength(0)
    expect(listCollection("users/pm1/notifications")).toHaveLength(0)
  })

  it("a manager's own request is approved by writing it, so the desk is told at once; a rejection tells nobody", async () => {
    expect((await requestPlant(db, pm, "p1", pmActor, input)).status).toBe("go")
    expect(listCollection("users/st1/notifications")).toHaveLength(1)
    resetFakeDb()
    seed(P, { organizationId: "org", name: "Villas", projectManagerId: "pm1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed("teamGroups/desk", { organizationId: "org", permissions: ["warehouses.manage"] })
    seed("users/st1", { organizationId: "org", organizationRole: "member", defaultGroupId: "desk" })
    await requestPlant(db, site, "p1", siteActor, input)
    await decidePlant(db, pm, "p1", pmActor, 1, false)
    expect(listCollection("users/st1/notifications")).toHaveLength(0)
  })

  it("the desk's answer is recorded as the desk's, once, and the requester is told what it was", async () => {
    approved()
    await answerPlantRequest(db, storeActor, "p1", 1, { k: "alloc", unit: " GEN-04 ", on: TODAY })
    expect(readDoc(`${P}/pmPlantRequests/01`)).toMatchObject({ rep: { k: "alloc", unit: "GEN-04", by: "st1", byName: "Store keeper", via: "desk" } })
    const [n] = listCollection<{ type: string; link: string; i18n: { params: Record<string, unknown> } }>("users/se1/notifications")
    expect(n).toMatchObject({ type: "plant_answered", link: "/contractor/projects/p1", i18n: { params: { no: "01", what: "Generator", project: "Villas", reply: "@pn_plant_reply_alloc" } } })
    await expect(answerPlantRequest(db, storeActor, "p1", 1, { k: "none", on: TODAY })).rejects.toMatchObject({ code: "blocked", blocks: ["replied"] })
  })

  it("keeps only what its kind carries: a unit for an allocation, a date for busy, nothing for none", async () => {
    approved()
    await answerPlantRequest(db, storeActor, "p1", 1, { k: "late", free: "2026-10-15", unit: "ignored", text: " back from repair ", on: TODAY })
    expect(readDoc<{ rep: Record<string, unknown> }>(`${P}/pmPlantRequests/01`)?.rep).toMatchObject({ k: "late", free: "2026-10-15", unit: null, text: "back from repair" })
  })

  it("refuses a request that is not approved, a closed project, a missing request and a future date, and tells nobody", async () => {
    approved({ status: "wait" })
    await expect(answerPlantRequest(db, storeActor, "p1", 1, { k: "none", on: TODAY })).rejects.toMatchObject({ blocks: ["not_with_desk"] })
    approved()
    await expect(answerPlantRequest(db, storeActor, "p1", 1, { k: "none", on: "2999-01-01" })).rejects.toMatchObject({ blocks: ["future"] })
    await expect(answerPlantRequest(db, storeActor, "p1", 7, { k: "none", on: TODAY })).rejects.toMatchObject({ code: "missing" })
    seed(P, { organizationId: "org", name: "Villas", pm: { no: "PJ-2026/001", lifecycle: "closed" } })
    await expect(answerPlantRequest(db, storeActor, "p1", 1, { k: "none", on: TODAY })).rejects.toBeInstanceOf(PlantDeskError)
    expect(readDoc<{ rep?: unknown }>(`${P}/pmPlantRequests/01`)?.rep).toBeUndefined()
    expect(listCollection("users/se1/notifications")).toHaveLength(0)
  })

  it("is not for a project without the project-management block", async () => {
    seed(P, { organizationId: "org", name: "Legacy" })
    approved()
    await expect(answerPlantRequest(db, storeActor, "p1", 1, { k: "none", on: TODAY })).rejects.toMatchObject({ code: "not_pm_project" })
  })

  it("the old site-side shape still reads: a request answered by the site has no desk marker", () => {
    const r: PmPlantRequest = { ...request(), rep: { k: "alloc", unit: "G-1", on: TODAY, by: "se1" } }
    expect(r.rep?.via).toBeUndefined()
    expect(withDesk(r)).toBe(false)
  })
})

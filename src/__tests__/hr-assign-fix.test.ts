/**
 * HR 1.0 — the assignment correction (AS-03, WF-13): a supervisor who has a
 * worker on his site who is not on his list raises a correction — not a
 * manpower request (that one is Projects') — and the HR manager corrects the
 * assignment from the day named (or declines with a reason). The usual
 * blocks still hold: an expired iqama never goes to a site.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import { assignFixBlocks, type AssignFix } from "@/lib/hr/sites"
import { decideAssignFix, raiseAssignFix } from "@/lib/hr/site-writes"
import type { HrEmployee } from "@/lib/hr/employee"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
const sup: HrContext = { uid: "sup", owner: false, roles: new Set(["supervisor"]), employeeId: null, sites: ["s1"] }
const gov: HrContext = { ...hrm, uid: "gro", roles: new Set(["gov"]) }
const TODAY = "2026-10-05"

const worker = { organizationId: ORG, no: 3, names: { ar: "كريم" }, idNo: "2100000001", nationality: "eg", siteId: "s2", status: "active", join: "2025-01-01", source: "local", docs: { iqama: "2027-01-01" } }
const fixes = () => listCollection<AssignFix>("hrAssignFixes")

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { ...worker })
})

describe("the rule", () => {
  it("someone placed elsewhere, from a day not in the future, once at a time", () => {
    const e = { ...worker, id: "e1" } as unknown as HrEmployee
    expect(assignFixBlocks(e, "s1", "2026-10-01", TODAY, false)).toEqual([])
    expect(assignFixBlocks({ ...e, siteId: "s1" }, "s1", "2026-10-01", TODAY, false)).toEqual(["same_place"])
    expect(assignFixBlocks(e, "s1", "2026-10-06", TODAY, false)).toEqual(["future"])
    expect(assignFixBlocks(e, "s1", "", TODAY, false)).toEqual(["no_date"])
    expect(assignFixBlocks({ ...e, status: "left" }, "s1", "2026-10-01", TODAY, false)).toEqual(["left"])
    expect(assignFixBlocks(e, "s1", "2026-10-01", TODAY, true)).toEqual(["pending"])
  })
})

describe("raise and decide", () => {
  it("the supervisor names the worker by his ID number — he reads no record outside his site (RL-01); the HR manager resolves it and corrects from the day named", async () => {
    await expect(raiseAssignFix(db, sup, ORG, { uid: "sup", name: "Khalid" }, { idNo: "2100000001", name: "كريم", siteId: "s9", since: "2026-10-01", note: "" }, { today: TODAY })).rejects.toMatchObject({ code: "not_your_site" })
    await expect(raiseAssignFix(db, gov, ORG, { uid: "gro", name: null }, { employeeId: "e1", siteId: "s1", since: "2026-10-01", note: "" }, { today: TODAY })).rejects.toMatchObject({ code: "no_role" })
    // Picking the record itself would read another site's employee — refused before any read.
    await expect(raiseAssignFix(db, sup, ORG, { uid: "sup", name: "Khalid" }, { employeeId: "e1", siteId: "s1", since: "2026-10-01", note: "" }, { today: TODAY })).rejects.toMatchObject({ blocks: ["by_id"] })
    await expect(raiseAssignFix(db, sup, ORG, { uid: "sup", name: "Khalid" }, { idNo: " ", name: "", siteId: "s1", since: "2026-10-01", note: "" }, { today: TODAY })).rejects.toMatchObject({ blocks: ["no_id", "no_name"] })
    const id = await raiseAssignFix(db, sup, ORG, { uid: "sup", name: "Khalid" }, { idNo: "2100 000001", name: "كريم", siteId: "s1", since: "2026-10-01", note: "works with my masons" }, { today: TODAY })
    expect(fixes()).toEqual([expect.objectContaining({ employeeId: null, idNo: "2100000001", employeeName: "كريم", fromSiteId: null, siteId: "s1", since: "2026-10-01", state: "pending", by: "sup" })])
    await expect(raiseAssignFix(db, sup, ORG, { uid: "sup", name: "Khalid" }, { idNo: "2100000001", name: "كريم", siteId: "s1", since: "2026-10-01", note: "" }, { today: TODAY })).rejects.toMatchObject({ blocks: ["pending"] })
    await expect(decideAssignFix(db, sup, id, { uid: "sup", name: null }, "approve", "")).rejects.toMatchObject({ code: "no_role" })
    await decideAssignFix(db, hrm, id, { uid: "hrm", name: "Sara" }, "approve", "", { today: TODAY })
    expect(readDoc<HrEmployee>("employees/e1")?.siteId).toBe("s1")
    expect(readDoc<AssignFix>(`hrAssignFixes/${id}`)).toMatchObject({ state: "done", decision: { by: "hrm" }, employeeId: "e1", employeeName: "كريم", fromSiteId: "s2" })
    expect(listCollection<{ kind: string; params: Record<string, unknown> }>("employees/e1/log")).toEqual([expect.objectContaining({ kind: "moved", params: { from: "s2", to: "s1", on: "2026-10-01" } })])
  })

  it("a number that names no current record — or two — is not guessed: the HR manager declines or corrects the records", async () => {
    const id = await raiseAssignFix(db, sup, ORG, { uid: "sup", name: null }, { idNo: "999", name: "مجهول", siteId: "s1", since: "2026-10-01", note: "" }, { today: TODAY })
    await expect(decideAssignFix(db, hrm, id, { uid: "hrm", name: null }, "approve", "", { today: TODAY })).rejects.toMatchObject({ blocks: ["no_match"] })
    seed("employees/e2", { ...worker, no: 4 })
    const twice = await raiseAssignFix(db, sup, ORG, { uid: "sup", name: null }, { idNo: "2100000001", name: "كريم", siteId: "s1", since: "2026-10-01", note: "" }, { today: TODAY })
    await expect(decideAssignFix(db, hrm, twice, { uid: "hrm", name: null }, "approve", "", { today: TODAY })).rejects.toMatchObject({ blocks: ["many_match"] })
    await decideAssignFix(db, hrm, id, { uid: "hrm", name: null }, "decline", "no such worker")
    expect(readDoc<AssignFix>(`hrAssignFixes/${id}`)?.state).toBe("declined")
  })

  it("the HR manager raises it on the record itself; an expired iqama is never corrected onto a site; a decline needs a reason", async () => {
    seed("employees/e1", { ...worker, docs: { iqama: "2026-09-01" } })
    const id = await raiseAssignFix(db, hrm, ORG, { uid: "hrm", name: null }, { employeeId: "e1", siteId: "s1", since: "2026-10-01", note: "" }, { today: TODAY })
    expect(readDoc<AssignFix>(`hrAssignFixes/${id}`)).toMatchObject({ employeeId: "e1", idNo: "2100000001", fromSiteId: "s2" })
    await expect(decideAssignFix(db, hrm, id, { uid: "hrm", name: null }, "approve", "", { today: TODAY })).rejects.toMatchObject({ blocks: ["iqama_expired"] })
    await expect(decideAssignFix(db, hrm, id, { uid: "hrm", name: null }, "decline", " ")).rejects.toMatchObject({ blocks: ["no_reason"] })
    await decideAssignFix(db, hrm, id, { uid: "hrm", name: null }, "decline", "renew the iqama first")
    expect(readDoc<AssignFix>(`hrAssignFixes/${id}`)?.state).toBe("declined")
    expect(readDoc<HrEmployee>("employees/e1")?.siteId).toBe("s2")
  })

  it("the rules: raised by the site's supervisor or the HR manager, decided by the HR manager only — who fills in the record a number resolves to", () => {
    const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8")
    const block = rules.slice(rules.indexOf("match /hrAssignFixes/{fixId}"), rules.indexOf("match /hrRequests/{requestId}"))
    expect(block).toMatch(/\(hrManager\(\) \|\| hrSupervises\(request\.resource\.data\.siteId\)\)/)
    expect(block).toMatch(/request\.resource\.data\.state == 'pending'/)
    expect(block).toMatch(/hrManager\(\)\s*&& resource\.data\.state == 'pending'/)
    expect(block).toMatch(/changedKeys\(\)\.hasOnly\(\['state', 'decision', 'employeeId', 'employeeName', 'fromSiteId', 'updatedAt'\]\)/)
    // RL-01 — a supervisor lists his own site's corrections only (the panel and the one-open check ask by site).
    expect(block).toMatch(/allow get, list: if isOrgMember\(resource\.data\.organizationId\) && \(hrOffice\(\) \|\| hrSupervises\(resource\.data\.siteId\)\);/)
    expect(block).not.toMatch(/hrStaff\(\)/)
    expect(block).toMatch(/allow delete: if false;/)
  })
})

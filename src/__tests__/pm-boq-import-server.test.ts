/** @jest-environment node */
/**
 * BOQ Import PM 1.0 — the write runs on the server: the guard (`boq.import`) and the freeze run in the
 * transaction on the project and its lines as they stand. A new BOQ replaces the old one; a hand edit
 * updates the lines it names and removes the ones it left out; after the start, after an approved
 * measurement or with a line locked into a tender nothing is written; another company's project reads
 * as missing; the site engineer cannot.
 */

import { FakeAdminDb } from "@/test-utils/fake-admin-firestore"

const mockDb = new FakeAdminDb()
jest.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => mockDb,
  getAdminAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (!t.startsWith("tok:")) throw new Error("bad token")
      return { uid: t.slice(4) }
    },
  }),
}))
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }))

import { applyBoqImport, BoqImportError, boqImportSchema, type BoqImportInput } from "@/lib/pm/boq-import-server"
import { POST } from "@/app/api/pm/boq-import/route"

const db = mockDb as never
const TODAY = "2026-10-25"

const line = (key: string, over: Partial<BoqImportInput["payload"]["lines"][number]> = {}) => ({
  key,
  existingId: null,
  code: "03-01",
  descriptionAr: "خرسانة مسلحة",
  descriptionEn: "Reinforced concrete",
  unit: "م³",
  quantity: 10,
  rate: 950,
  section: "s1",
  sheet: "الورقة",
  row: 5,
  ...over,
})
const input = (over: Partial<BoqImportInput["payload"]> = {}, projectId = "p1"): BoqImportInput => ({
  projectId,
  payload: { source: "file", fileName: "boq.xlsx", edit: false, sections: [{ key: "s1", code: "03", text: "الأعمال الخرسانية" }], lines: [line("a"), line("b", { code: "03-02", rate: null, section: null })], ...over },
})
const items = () => mockDb.list("projects/p1/boqItems")

beforeEach(() => {
  mockDb.docs.clear()
  mockDb.seed("users/org1", { name: "Owner", organizationId: "org1" })
  mockDb.seed("users/pm1", { name: "Abdullah", organizationId: "org1", organizationRole: "member", defaultGroupId: "gPm" })
  mockDb.seed("users/se1", { name: "Fahd", organizationId: "org1", organizationRole: "member", defaultGroupId: "gSite" })
  mockDb.seed("users/x1", { name: "Other", organizationId: "org9", organizationRole: "member" })
  mockDb.seed("teamGroups/gPm", { organizationId: "org1", permissions: ["pm.manage"] })
  mockDb.seed("teamGroups/gSite", { organizationId: "org1", permissions: ["pm.site"] })
  mockDb.seed("projects/p1", { organizationId: "org1", projectManagerId: "pm1", pm: { no: "PJ-2026/003", lifecycle: "plan" } })
  mockDb.seed("projects/p1/members/pm1", { userId: "pm1", pmRole: "pm" })
  mockDb.seed("projects/p1/members/se1", { userId: "se1", pmRole: "site" })
})

describe("a new BOQ", () => {
  it("is written line by line with its section, its source and the owner's name — a line with no rate is unpriced", async () => {
    expect(await applyBoqImport(db, "pm1", input(), TODAY)).toEqual({ written: 2, removed: 0 })
    const rows = items()
    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.itemNo === "03-01")!
    expect(a).toMatchObject({
      descriptionAr: "خرسانة مسلحة",
      descriptionEn: "Reinforced concrete",
      unit: "م³",
      quantity: 10,
      unitPrice: 950,
      divisionNo: "03",
      divisionNameAr: "03 · الأعمال الخرسانية",
      srcKind: "file",
      srcFile: "boq.xlsx",
      srcSheet: "الورقة",
      srcRow: 5,
      srcBy: "pm1",
      srcByName: "Abdullah",
      srcDay: TODAY,
      executedQuantity: 0,
      billedQuantity: 0,
      isEditable: true,
      tenderId: null,
      groupId: null,
      estCost: null,
    })
    expect(rows.find((r) => r.itemNo === "03-02")).toMatchObject({ unitPrice: 0, divisionNo: "03", divisionNameAr: "" })
  })

  it("replaces what was there, groups included, and records a hand-typed BOQ as such", async () => {
    mockDb.seed("projects/p1/boqItems/old1", { itemNo: "01", quantity: 1, executedQuantity: 0 })
    mockDb.seed("projects/p1/boqItems/old2", { itemNo: "02", quantity: 1 })
    mockDb.seed("projects/p1/boqGroups/g1", { titleAr: "قسم", categoryAr: "" })
    expect(await applyBoqImport(db, "org1", input({ source: "manual", fileName: null }), TODAY)).toEqual({ written: 2, removed: 2 })
    expect(mockDb.get("projects/p1/boqItems/old1")).toBeUndefined()
    expect(mockDb.get("projects/p1/boqGroups/g1")).toBeUndefined()
    expect(items().every((r) => r.srcKind === "manual" && r.srcFile === null && r.srcByName === "Owner")).toBe(true)
  })
})

describe("editing the current BOQ by hand", () => {
  beforeEach(() => {
    mockDb.seed("projects/p1/boqItems/i1", { itemNo: "03-01", descriptionAr: "قديم", quantity: 4, unitPrice: 10, estCost: 7, executedQuantity: 0, srcKind: "file", srcFile: "first.xlsx", srcBy: "org1", srcByName: "Owner", srcDay: "2026-10-01", isEditable: true })
    mockDb.seed("projects/p1/boqItems/i2", { itemNo: "03-02", descriptionAr: "يُحذف", quantity: 1, executedQuantity: 0, isEditable: true })
  })

  it("updates the lines it names (keeping their cost and their first source), adds new ones, removes the rest", async () => {
    const edit = input({ edit: true, fileName: null, source: "manual", lines: [line("a", { existingId: "i1", quantity: 6, rate: 12 }), line("n", { code: "03-09" })] })
    expect(await applyBoqImport(db, "pm1", edit, TODAY)).toEqual({ written: 2, removed: 1 })
    expect(mockDb.get("projects/p1/boqItems/i2")).toBeUndefined()
    expect(mockDb.get("projects/p1/boqItems/i1")).toMatchObject({ quantity: 6, unitPrice: 12, estCost: 7, srcFile: "first.xlsx", srcByName: "Owner", srcEditedBy: "pm1", srcEditedByName: "Abdullah", srcEditedDay: TODAY })
    const added = items().find((r) => r.itemNo === "03-09")!
    expect(added).toMatchObject({ srcKind: "file", srcFile: "first.xlsx", srcEditedByName: "Abdullah", executedQuantity: 0 })
  })

  it("refuses a line that is not in this project's BOQ, and a line named twice", async () => {
    await expect(applyBoqImport(db, "pm1", input({ edit: true, lines: [line("a", { existingId: "nope" })] }), TODAY)).rejects.toMatchObject({ code: "INVALID", blocks: ["unknown_line"] })
    await expect(applyBoqImport(db, "pm1", input({ edit: true, lines: [line("a", { existingId: "i1" }), line("b", { existingId: "i1" })] }), TODAY)).rejects.toMatchObject({ code: "INVALID" })
    expect(items()).toHaveLength(2)
  })
})

describe("who, and until when", () => {
  it("the site engineer only views; another company's project reads as missing; a person with no profile is refused", async () => {
    await expect(applyBoqImport(db, "se1", input(), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 })
    await expect(applyBoqImport(db, "x1", input(), TODAY)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 })
    await expect(applyBoqImport(db, "ghost", input(), TODAY)).rejects.toMatchObject({ code: "NO_PROFILE" })
    expect(items()).toHaveLength(0)
  })

  it("after the start nothing is written — the change goes by change order", async () => {
    mockDb.seed("projects/p1", { organizationId: "org1", projectManagerId: "pm1", pm: { lifecycle: "live" } })
    await expect(applyBoqImport(db, "pm1", input(), TODAY)).rejects.toMatchObject({ code: "BLOCKED", blocks: ["started"] })
  })

  it("a measured line freezes the BOQ even while the project is still planning, and a line locked into a tender does too", async () => {
    mockDb.seed("projects/p1/boqItems/m1", { itemNo: "01", quantity: 5, executedQuantity: 2 })
    await expect(applyBoqImport(db, "pm1", input(), TODAY)).rejects.toMatchObject({ code: "BLOCKED", blocks: ["measured"] })
    mockDb.seed("projects/p1/boqItems/m1", { itemNo: "01", quantity: 5, executedQuantity: 0, isEditable: false })
    await expect(applyBoqImport(db, "pm1", input(), TODAY)).rejects.toMatchObject({ code: "BLOCKED", blocks: ["locked"] })
    expect(mockDb.get("projects/p1/boqItems/m1")).toBeDefined()
  })

  it("an archived project (it is past planning), a project that is not a PM project, and a malformed payload are refused", async () => {
    mockDb.seed("projects/p1", { organizationId: "org1", pm: { lifecycle: "closed" } })
    await expect(applyBoqImport(db, "org1", input(), TODAY)).rejects.toMatchObject({ code: "BLOCKED", blocks: ["started"] })
    mockDb.seed("projects/p1", { organizationId: "org1" })
    await expect(applyBoqImport(db, "org1", input(), TODAY)).rejects.toMatchObject({ code: "NOT_PM_PROJECT" })
    await expect(applyBoqImport(db, "org1", input({ lines: [] }), TODAY)).rejects.toMatchObject({ code: "INVALID", blocks: ["empty"] })
    await expect(applyBoqImport(db, "org1", input({ lines: [line("a", { descriptionAr: "", descriptionEn: "" })] }), TODAY)).rejects.toBeInstanceOf(BoqImportError)
  })
})

describe("the route", () => {
  const req = (body: unknown, token?: string) =>
    new Request("http://x/api/pm/boq-import", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }) as never

  it("signed in, a valid body, and the consistent answer shapes", async () => {
    expect((await POST(req(input()))).status).toBe(401)
    expect((await POST(req({ projectId: "p1" }, "tok:pm1"))).status).toBe(400)
    const refused = await POST(req(input(), "tok:se1"))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ error: true, code: "FORBIDDEN" })
    const ok = await POST(req(input(), "tok:pm1"))
    expect(await ok.json()).toMatchObject({ success: true, data: { written: 2, removed: 0 } })
  })

  it("the schema bounds the payload: 5000 lines, a finite quantity, a non-negative rate", () => {
    const base = input()
    expect(boqImportSchema.safeParse(base).success).toBe(true)
    expect(boqImportSchema.safeParse({ ...base, payload: { ...base.payload, lines: [line("a", { quantity: Number.POSITIVE_INFINITY })] } }).success).toBe(false)
    expect(boqImportSchema.safeParse({ ...base, payload: { ...base.payload, lines: [line("a", { rate: -1 })] } }).success).toBe(false)
    expect(boqImportSchema.safeParse({ ...base, payload: { ...base.payload, lines: Array.from({ length: 5001 }, (_, i) => line(`k${i}`)) } }).success).toBe(false)
    expect(boqImportSchema.safeParse({ ...base, projectId: "a/b" }).success).toBe(false)
  })
})

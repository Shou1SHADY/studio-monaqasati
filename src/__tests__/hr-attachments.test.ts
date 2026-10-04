/**
 * HR 1.0 — attachments on the employee record (EM-07): the file goes to
 * Storage under the org and the employee; the record keeps an append-only
 * entry with its kind, name and path (never a public link); attached by the
 * HR manager or government relations; images and PDFs, 15 MB at most.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import fs from "fs"
import path from "path"
import { fakeFirestore, listCollection, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import { attachmentBlocks, attachmentPath, type EmployeeFile } from "@/lib/hr/attachments"
import { attachEmployeeFile } from "@/lib/hr/employee-writes"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
const gov: HrContext = { ...hrm, uid: "gro", roles: new Set(["gov"]) }
const sup: HrContext = { ...hrm, uid: "sup", roles: new Set(["supervisor"]), sites: ["s1"] }

beforeEach(() => {
  resetFakeDb()
  seed("employees/e1", { organizationId: ORG, no: 1, names: { ar: "أحمد" }, siteId: "s1", status: "active", join: "2024-01-01" })
})

describe("the rule", () => {
  it("images and PDFs, at most 15 MB, of a known kind, under this employee's folder", () => {
    const p = attachmentPath(ORG, "e1", "إقامة أحمد (scan).pdf", 1700000000000)
    expect(p).toBe("organizations/org/hr/employees/e1/1700000000000_إقامة_أحمد_scan_.pdf")
    const ok = { kind: "iqama", name: "x.pdf", size: 1000, contentType: "application/pdf", path: p }
    expect(attachmentBlocks(ok, { orgId: ORG, employeeId: "e1" })).toEqual([])
    expect(attachmentBlocks({ ...ok, size: 16 * 1024 * 1024 })).toEqual(["too_big"])
    expect(attachmentBlocks({ ...ok, contentType: "application/zip" })).toEqual(["bad_type"])
    expect(attachmentBlocks({ ...ok, kind: "selfie" })).toEqual(["bad_kind"])
    expect(attachmentBlocks(ok, { orgId: ORG, employeeId: "e2" })).toEqual(["bad_path"])
  })
})

describe("the write", () => {
  const meta = { kind: "contract" as const, name: "contract.pdf", size: 2048, contentType: "application/pdf", path: attachmentPath(ORG, "e1", "contract.pdf", 1) }

  it("the HR manager or government relations attaches; the entry names the file, the log says so", async () => {
    await expect(attachEmployeeFile(db, sup, "e1", { uid: "sup", name: null }, meta)).rejects.toMatchObject({ code: "no_role" })
    await attachEmployeeFile(db, gov, "e1", { uid: "gro", name: "Majed" }, meta)
    const files = listCollection<EmployeeFile>("employees/e1/files")
    expect(files).toEqual([expect.objectContaining({ organizationId: ORG, employeeId: "e1", kind: "contract", name: "contract.pdf", path: meta.path, by: "gro" })])
    expect(files[0]).not.toHaveProperty("url")
    expect(listCollection<{ kind: string }>("employees/e1/log").map((l) => l.kind)).toEqual(["file_attached"])
    await expect(attachEmployeeFile(db, hrm, "e1", { uid: "hrm", name: null }, { ...meta, path: "organizations/other/x.pdf" })).rejects.toMatchObject({ blocks: ["bad_path"] })
  })

  it("the rules: append-only, attached by HR or government relations in their own name, never read by a supervisor", () => {
    const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")
    const block = rules.slice(rules.indexOf("match /files/{fileId}"), rules.indexOf("match /employeePay/{employeeId}"))
    expect(block).toMatch(/allow update, delete: if false;/)
    expect(block).toMatch(/request\.resource\.data\.by == request\.auth\.uid/)
    expect(block).toMatch(/\(hrManager\(\) \|\| hrRole\('hr\.gov'\)\)/)
    const read = block.slice(block.indexOf("allow read"), block.indexOf("allow create"))
    expect(read).not.toMatch(/hrStaff\(\)|hr\.supervisor/)
  })

  it("storage.rules name the folder: org members with an HR hand, images and PDFs up to 15 MB", () => {
    const storage = fs.readFileSync(path.join(process.cwd(), "storage.rules"), "utf8")
    expect(storage).toMatch(/match \/organizations\/\{orgId\}\/hr\/employees\/\{employeeId\}\/\{fileName\}/)
    expect(storage).toMatch(/request\.resource\.size < 15 \* 1024 \* 1024/)
  })
})

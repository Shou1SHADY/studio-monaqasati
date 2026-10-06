/**
 * The equipment desk's write in firestore.rules: the store keeper of the company
 * answers an approved, unanswered request in an open project, once, and changes
 * nothing else. The Jest suites run over an in-memory Firestore with no rules,
 * so the rule text is pinned here the way hr-rules.test.ts pins HR's.
 */
import fs from "fs"
import path from "path"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")

function plantBlock(): string {
  const start = rules.indexOf("match /pmPlantRequests/{plantId} {")
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const next = rest.search(/\n {6}(match \/|\/\/ PM 1\.0)/)
  return next < 0 ? rest : rest.slice(0, next)
}

function updates(body: string): string[] {
  const clean = body.replace(/\/\/[^\n]*/g, "")
  return [...clean.matchAll(/allow update: if ([\s\S]*?);/g)].map((m) => m[1])
}

describe("pmPlantRequests: the equipment desk's answer", () => {
  const body = plantBlock()
  const desk = updates(body).find((u) => u.includes("warehouses.manage")) ?? ""

  it("has a rule for the store keeper at all", () => {
    expect(desk).not.toBe("")
  })

  it("is for the company's own store keeper in an open project, not for whoever can edit the project", () => {
    expect(desk).toContain("inOpenProject(projectId)")
    expect(desk).toContain("hasOrgPermission('warehouses.manage')")
    expect(desk).not.toContain("pmDuty")
    expect(desk).not.toContain("pmOpen")
  })

  it("answers an approved request nobody has answered, once", () => {
    expect(desk).toContain("resource.data.status == 'go'")
    expect(desk).toContain("resource.data.get('rep', null) == null")
  })

  it("accepts only the four answers, in the keeper's own name", () => {
    expect(desk).toContain("request.resource.data.rep.k in ['alloc', 'late', 'alt', 'none']")
    expect(desk).toContain("request.resource.data.rep.by == request.auth.uid")
  })

  it("changes nothing but the answer: not the status, the dates, the quantity or who asked", () => {
    expect(desk).toContain("changedKeys().hasOnly(['rep', 'updatedAt'])")
  })

  it("leaves the project's own paths as they were: the manager decides, the site receives and records", () => {
    const all = updates(body)
    expect(all.some((u) => u.includes("pmOpen(projectId, 'approve')") && u.includes("request.resource.data.status in ['go', 'rej']"))).toBe(true)
    expect(all.some((u) => u.includes("pmOpen(projectId, 'req')") && u.includes("rep.k in ['alloc', 'late', 'alt', 'none']"))).toBe(true)
    expect(body).toContain("allow read: if inProject(projectId);")
  })
})

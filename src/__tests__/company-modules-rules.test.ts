/**
 * companyModules in firestore.rules: the platform admin switches a company's optional components, the
 * company's own members read theirs, nobody else reads anything, and nothing is deleted.
 */
import fs from "fs"
import path from "path"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "")

function block(): string {
  const start = rules.indexOf("match /companyModules/{orgId} {")
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const next = rest.search(/\n {4}(match \/|function |\/\/ [A-Z])/)
  return strip(next < 0 ? rest : rest.slice(0, next))
}
const rule = (body: string, kind: string) => body.match(new RegExp(`allow ${kind}[^:]*: if ([\\s\\S]*?);`))?.[1] ?? ""

describe("companyModules rules", () => {
  const body = block()

  it("is read by the company's own members and by the admin", () => {
    const get = rule(body, "get")
    expect(get).toContain("isAdmin()")
    expect(get).toContain("isOrgMember(orgId)")
  })

  it("is listed by the admin only", () => {
    expect(rule(body, "list")).toBe("isAdmin()")
  })

  it("is written by the admin only, as a list", () => {
    const write = rule(body, "create, update")
    expect(write).toContain("isAdmin()")
    expect(write).toContain("request.resource.data.off is list")
    expect(write).not.toContain("isOrgMember")
  })

  it("is never deleted", () => {
    expect(rule(body, "delete")).toBe("false")
  })
})

describe("the purchase-order budget gate in firestore.rules", () => {
  const fn = (name: string) => {
    const start = rules.indexOf(`function ${name}(`)
    expect(start).toBeGreaterThan(-1)
    const end = rules.indexOf("\n    }", start)
    return strip(rules.slice(start, end))
  }

  it("stands down for a company whose Project Management is switched off, so the order can still be approved", () => {
    const gate = fn("poPmBudgetClear")
    expect(gate).toContain("pmSwitchedOff(resource.data.organizationId)")
    const off = fn("pmSwitchedOff")
    expect(off).toContain("companyModules")
    expect(off).toContain("'project-management' in")
  })

  it("is still the gate for approval and self-issue when Project Management is on", () => {
    const body = rules.slice(rules.indexOf("function poApproves()"), rules.indexOf("function poReturns()"))
    expect(body).toContain("poPmBudgetClear()")
    const self = rules.slice(rules.indexOf("function poSelfIssues()"), rules.indexOf("function poDecidesHold()"))
    expect(self).toContain("poPmBudgetClear()")
  })
})

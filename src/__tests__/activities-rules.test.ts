/**
 * The activities collection in firestore.rules: the company reads and plans them,
 * the assignee / the planner / the owner changes an OPEN one and only its closing
 * and date fields, and nothing is ever deleted. The Jest suites run over an
 * in-memory Firestore with no rules, so the rule text is pinned here.
 */
import fs from "fs"
import path from "path"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")

function block(): string {
  const start = rules.indexOf("match /activities/{activityId} {")
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const next = rest.search(/\n {4}(match \/|\/\/ [A-Z])/)
  return (next < 0 ? rest : rest.slice(0, next)).replace(/\/\/[^\n]*/g, "")
}

const rule = (body: string, kind: string) => body.match(new RegExp(`allow ${kind}[^:]*: if ([\\s\\S]*?);`))?.[1] ?? ""

describe("activities rules", () => {
  const body = block()

  it("is read by the company's own members (or the admin), nobody else", () => {
    const read = rule(body, "get, list")
    expect(read).toContain("isOrgMember(resource.data.organizationId)")
    expect(read).toContain("isAdmin()")
  })

  it("is created by a member of the company, in his own name, open", () => {
    const create = rule(body, "create")
    expect(create).toContain("createsInOrg()")
    expect(create).toContain("request.resource.data.createdById == request.auth.uid")
    expect(create).toContain("request.resource.data.status == 'open'")
  })

  it("gives it only to a person of the same company, or to himself", () => {
    const create = rule(body, "create")
    expect(create).toContain("request.resource.data.assigneeId == request.auth.uid")
    expect(create).toContain("users/$(request.resource.data.assigneeId)")
    expect(create).toContain("get('organizationId', '') == request.resource.data.organizationId")
  })

  it("keeps the summary a non-empty string of at most 120", () => {
    const create = rule(body, "create")
    expect(create).toContain("summary.size() > 0")
    expect(create).toContain("summary.size() <= 120")
  })

  it("lets the assignee, the planner or the owner change an open one — and no one else", () => {
    const update = rule(body, "update")
    expect(update).toContain("keepsOrg()")
    expect(update).toContain("resource.data.status == 'open'")
    expect(update).toContain("resource.data.assigneeId == request.auth.uid")
    expect(update).toContain("resource.data.createdById == request.auth.uid")
    expect(update).toContain("isOrgOwner()")
  })

  it("changes only the date and the closing fields, to one of the three states, in the closer's own name", () => {
    const update = rule(body, "update")
    expect(update).toContain("changedKeys().hasOnly(['status', 'dueOn', 'doneOn', 'doneById', 'doneByName', 'feedback', 'updatedAt'])")
    expect(update).toContain("request.resource.data.status in ['open', 'done', 'cancelled']")
    expect(update).toContain("request.resource.data.get('doneById', request.auth.uid) == request.auth.uid")
  })

  it("is never deleted", () => {
    expect(rule(body, "delete")).toBe("false")
  })
})

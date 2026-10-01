/**
 * PM 1.0 — what the Jest suites cannot see. The write layers are tested over an
 * in-memory Firestore that has no rules, so a rule that lets too much through
 * (or refuses a legitimate write) passes every test. These pin the properties of
 * firestore.rules the audit of 1 Oct 2026 fixed, against the text of the file:
 *
 *  - an invitation is an authorization: a client never writes what it grants,
 *    and holding one never lets an account rewrite its own organisation or role;
 *  - `list` on projects, handover files and events is the caller's organisation's;
 *  - an event's id carries its organisation (two companies both have PJ-2026/001);
 *  - a seat never raises a person above his own group, and only the owner
 *    appoints the project manager or adopts a project into PM;
 *  - the supply boundary: an award tells the request its order, nothing of a PM
 *    request is bought before the manager's approval, a stop reaches the order
 *    at whatever stage it is.
 */
import fs from "fs"
import path from "path"
import { pmEventDocId } from "@/lib/pm/events"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "")

/** A `match /<name>/{…}` block at the given indent, to its closing brace. */
function block(name: string, indent = 4): string {
  const pad = " ".repeat(indent)
  const start = rules.search(new RegExp(`\\n${pad}match /${name}/\\{`))
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const end = rest.search(new RegExp(`\\n${pad}\\}\\n`))
  return end < 0 ? rest : rest.slice(0, end)
}
const allow = (body: string, op: string): string[] =>
  [...strip(body).matchAll(/allow ([a-z, ]+): if ([\s\S]*?);/g)].filter((m) => m[1].split(",").map((s) => s.trim()).includes(op)).map((m) => m[2])
const fn = (name: string): string => {
  const start = rules.search(new RegExp(`\\n    function ${name}\\(`))
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  return strip(rest.slice(0, rest.search(/\n    \}\n/)))
}

describe("an invitation is an authorization", () => {
  const inv = block("invitations")

  it("is written only by the server — a client could otherwise invite himself anywhere as anything", () => {
    expect(allow(inv, "create")).toEqual(["isAdmin()"])
  })

  it("is answered, cancelled or re-sent — never rewritten: no update branch may change organisation, role or group", () => {
    const [update] = allow(inv, "update")
    const lists = [...update.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map((m) => m[1])
    expect(lists).toHaveLength(3)
    for (const keys of lists) expect(keys).not.toMatch(/organizationId|role|groupId|email|invitedBy|type|contractorOrgId/)
    expect(update).toMatch(/resource\.data\.get\('status', 'pending'\) == 'pending'/)
  })

  it("holding one never lets an account rewrite its own organisation or role", () => {
    const self = allow(block("users"), "update").join("\n")
    expect(self).not.toMatch(/invitations/)
  })
})

describe("a company's projects, handover files and events are listed only by that company", () => {
  it.each([
    ["projects", /resource\.data\.organizationId == getOrganizationId\(\)/],
    ["pmHandovers", /isOrgMember\(resource\.data\.organizationId\)/],
    ["pmEvents", /isOrgMember\(resource\.data\.organizationId\)/],
  ])("%s", (name, scoped) => {
    const lists = allow(block(name as string), "list")
    expect(lists.length).toBeGreaterThan(0)
    for (const l of lists) expect(l).toMatch(scoped as RegExp)
  })
})

describe("an event's id carries its organisation", () => {
  it("the rule builds the id exactly as the writers do", () => {
    const [create] = allow(block("pmEvents"), "create")
    expect(create).toMatch(/eventId == request\.resource\.data\.organizationId \+ '__' \+ request\.resource\.data\.key\.replace\('\/', '_'\)/)
    // Until both branches run the new build the rule also takes the old id (the key alone);
    // nothing else is accepted.
    expect(create.match(/eventId ==/g)).toHaveLength(2)
    expect(pmEventDocId("orgA", "prj:IPC:PJ-2026/001:01")).toBe("orgA__prj:IPC:PJ-2026_001:01")
    expect(pmEventDocId("orgA", "prj:ADV:PJ-2026/001")).not.toBe(pmEventDocId("orgB", "prj:ADV:PJ-2026/001"))
  })

  it("an event is never rewritten or removed", () => {
    expect(strip(block("pmEvents"))).toMatch(/allow update, delete: if false;/)
  })
})

describe("the team: a seat narrows, the owner appoints", () => {
  it("a seat's group is the person's own — never a higher one", () => {
    expect(fn("pmSeatGroupOk")).toMatch(/request\.resource\.data\.groupId == get\(\S*users\/\$\(memberId\)\)\.data\.get\('defaultGroupId', null\)/)
    const members = block("members", 6)
    expect((members.match(/pmSeatGroupOk\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it("a project with no manager is one whose manager id is a real string — null is not a manager", () => {
    const duty = fn("pmDuty")
    expect(duty).toMatch(/get\('projectManagerId', ''\) is string/)
    expect(duty).toMatch(/get\('projectManagerId', ''\) != ''/)
  })

  it("only the owner changes the project manager, and only the owner adopts a project into PM", () => {
    const updates = allow(block("projects"), "update").join("\n")
    expect(updates).toMatch(/pmCeilingHas\('admin'\)[\s\S]{0,200}hasOnly\(\['projectManagerId', 'projectManagerName', 'updatedAt'\]\)/)
    expect(updates).toMatch(/!\('pm' in request\.resource\.data\) \|\| pmCeilingHas\('admin'\)/)
  })
})

describe("the supply boundary", () => {
  const requests = block("purchaseRequests", 6)
  const updates = allow(requests, "update")

  it("the award records its order on the request — once, and only an order that names the request's RFQ", () => {
    const award = updates.find((u) => /hasOnly\(\['poId', 'poNumber', 'lineLinks', 'updatedAt'\]\)/.test(u))
    expect(award).toBeDefined()
    expect(award).toMatch(/resource\.data\.get\('poId', null\) == null/)
    expect(award).toMatch(/getAfter\(\S*purchaseOrders\/\$\(request\.resource\.data\.poId\)\)\.data\.get\('rfqId', ''\) == resource\.data\.rfqId/)
    // The key check comes before any lookup: an award writes many documents in one transaction.
    expect((award as string).indexOf("hasOnly")).toBeLessThan((award as string).indexOf("inProjectOrg"))
  })

  it("nothing of a PM request is decided or bought before the project manager's approval (REQ-02)", () => {
    const pending = updates.filter((u) => /resource\.data\.status == 'pending'/.test(u) && !/pmDuty|requestedByUserId == request\.auth\.uid/.test(u))
    expect(pending.length).toBeGreaterThanOrEqual(3)
    for (const u of pending) expect(u).toMatch(/resource\.data\.get\('pm', false\) != true/)
  })

  it("recording a sample reply lifts the mark off `items` and nothing else", () => {
    const lift = updates.find((u) => /hasOnly\(\['items', 'updatedAt'\]\)/.test(u))
    expect(lift).toBeDefined()
    expect(lift).toMatch(/pmDuty\(projectId, 'measure'\) \|\| pmDuty\(projectId, 'approve'\)/)
    expect(lift).toMatch(/items\.size\(\) == resource\.data\.get\('items', \[\]\)\.size\(\)/)
  })

  it("a stop reaches the order at whatever stage it is, and an order raised for several projects through the request that names it", () => {
    const stop = fn("poPmStops")
    expect(stop).toMatch(/poFrom\(\) in \['awaiting_approval', 'approved', 'sent', 'accepted'\]/)
    expect(stop).toMatch(/pmRequestNamesOrder\(projectId, entry, resource\.id\)/)
    expect(stop).toMatch(/hasOnly\(\['pmCancels', 'pmCancelKey', 'updatedAt'\]\)/)
  })
})

describe("money that Finance records after the project team is done", () => {
  it("a collection is recorded on a certificate even after the project is archived; the team's acts are not", () => {
    const [update] = allow(block("pmCertificates", 6), "update")
    expect(update).toMatch(/projectOpen\(projectId\) && \(/)
    expect(update).toMatch(/collected/)
  })

  it("plant: a day rate is set by whoever sees money — never on a tool, never zero", () => {
    const rate = allow(block("pmPlant", 6), "update").find((u) => /hasOnly\(\['dayRate', 'rateSet', 'updatedAt'\]\)/.test(u))
    expect(rate).toBeDefined()
    expect(rate).toMatch(/pmCeilingHas\('money'\)/)
    expect(rate).toMatch(/dayRate > 0/)
  })
})

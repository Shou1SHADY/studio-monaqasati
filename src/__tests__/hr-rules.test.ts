/**
 * HR 1.0 — what the Jest suites cannot see: they run the write layers over an
 * in-memory Firestore that has no rules, so a rule that refuses a legitimate
 * write passes every test and fails every user. These pin the properties of
 * firestore.rules that the HR write layers rely on (audit of 1 Oct 2026):
 *
 *  - a document with a FIXED id is read before it exists (the first sheet of a
 *    month, preparing a payroll, "never sent twice", "no exit yet"): its `get`
 *    must answer a missing document — `resource.data` on one is an evaluation
 *    error, and an error refuses;
 *  - the employee's first log entry is written in the transaction that creates
 *    him: the rule must look at the record as the transaction leaves it;
 *  - who a record is linked to decides whose pay a person reads (RL-03), and
 *    nobody changes the wage or bank of his own record (RL-02).
 */
import fs from "fs"
import path from "path"
import { HR_ROLE_PERMISSION } from "@/lib/hr/access"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")

/** The body of a top-level `match /<collection>/{…}` block. */
function block(collection: string): string {
  const start = rules.search(new RegExp(`\\n    match /${collection}/\\{`))
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const next = rest.slice(1).search(/\n    match \//)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

/** One `allow <ops>: if …;` statement of a block, comments stripped. */
function allow(body: string, op: string): string[] {
  const clean = body.replace(/\/\/[^\n]*/g, "")
  return [...clean.matchAll(/allow ([a-z, ]+): if ([\s\S]*?);/g)].filter((m) => m[1].split(",").map((s) => s.trim()).includes(op)).map((m) => m[2])
}

describe("a fixed-id document is readable before it exists", () => {
  // collection → the client read that happens while the document is still missing
  const READ_BEFORE_CREATE: Record<string, string> = {
    hrAttendance: "recordDay / declareMissing / closeMonth and payroll's check read the site's month first",
    hrPayrolls: "preparePayroll reads the month's payroll before the first prepare",
    hrEvents: "approvePayroll and approveSettlement read the event to send it once",
    hrExits: "startExit checks that no exit exists",
    hrSettlements: "the exit panel listens to a settlement that is not approved yet",
    employeePay: "changePay reads the pay of a joiner recorded without one",
    hrViolations: "the sheet checks a violation is not already recorded",
  }

  it.each(Object.entries(READ_BEFORE_CREATE))("%s — %s", (collection) => {
    const gets = allow(block(collection), "get")
    expect(gets.length).toBeGreaterThan(0)
    for (const g of gets) {
      expect(g).toMatch(/resource == null/)
      // Nothing dereferences the stored document outside a branch that first ruled out a missing one.
      const firstUse = g.indexOf("resource.data")
      if (firstUse >= 0) expect(g.indexOf("resource == null")).toBeLessThan(firstUse)
    }
  })

  it("a missing document is still nobody's to read without an HR or Finance hand", () => {
    for (const c of Object.keys(READ_BEFORE_CREATE)) for (const g of allow(block(c), "get")) expect(g).toMatch(/hrRole\(|hrSeesPay\(\)|hrFinance\(\)|hrStaff\(\)/)
  })
})

describe("the employee's log", () => {
  const log = block("employees")
  const create = log.slice(log.indexOf("match /log/{entryId}"))

  it("the first entry is judged on the record as its own transaction leaves it", () => {
    const [rule] = allow(create, "create")
    expect(rule).toMatch(/getAfter\(/)
    expect(rule).not.toMatch(/[^r]get\(\/databases/)
    expect(rule).toMatch(/request\.resource\.data\.by == request\.auth\.uid/)
  })

  it("is never changed or deleted (EM-06)", () => {
    expect(create).toMatch(/allow update, delete: if false;/)
  })
})

describe("pay stays with those who may see it (RL-02, RL-03)", () => {
  const employees = block("employees")
  const pay = block("employeePay")

  it("government relations renews documents and nothing else on the record", () => {
    const [update] = allow(employees.slice(0, employees.indexOf("match /log/")), "update")
    expect(update).toMatch(/hrRole\('hr\.gov'\) && changedKeys\(\)\.hasOnly\(\['docs', 'updatedAt'\]\)/)
  })

  it("the link to a user is the HR manager's, never onto or off himself", () => {
    const [update] = allow(employees.slice(0, employees.indexOf("match /log/")), "update")
    expect(update).toMatch(/request\.resource\.data\.get\('userId', null\) == resource\.data\.get\('userId', null\)/)
    expect(update).toMatch(/request\.resource\.data\.get\('userId', null\) != request\.auth\.uid && resource\.data\.get\('userId', null\) != request\.auth\.uid/)
  })

  it("nobody changes the wage or bank of his own record; an advance is never one's own to rewrite", () => {
    const [update] = allow(pay, "update")
    // The cheap check first: a payroll approval writes many pay documents in one transaction, and the
    // record lookup behind hrOwnRecord() must not run for each of them (twenty lookups a transaction).
    expect(update).toMatch(/hrManager\(\) && \(changedKeys\(\)\.hasOnly\(\['advance', 'retro', 'updatedAt'\]\) \|\| isOrgOwner\(\) \|\| !hrOwnRecord\(employeeId\)\)/)
    expect(update).toMatch(/changedKeys\(\)\.hasOnly\(\['advance', 'updatedAt'\]\)\s*&& \(isOrgOwner\(\) \|\| !hrOwnRecord\(employeeId\)\)/)
  })

  it("payrolls, events, payslips and settlements are closed to roles without pay", () => {
    for (const c of ["hrPayrolls", "hrEvents", "hrSettlements"]) for (const g of allow(block(c), "get")) expect(g).not.toMatch(/hrStaff\(\)|hr\.gov|hr\.supervisor/)
  })
})

describe("the roles are the ones access.ts names", () => {
  it("every role's permission id is a role the rules know", () => {
    for (const perm of Object.values(HR_ROLE_PERMISSION)) expect(rules).toContain(`hrRole('${perm}')`)
  })
})

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
import { HR_GUARD, HR_ROLE_PERMISSION, HR_ROLES, hrPeopleScope, hrScopeAt, type HrRole } from "@/lib/hr/access"
import { closeBlocks } from "@/lib/hr/attendance"
import { riyadhDay } from "@/lib/hr/format"
import { mayCancel, type HrRequest } from "@/lib/hr/requests"
import { STATUTORY } from "@/lib/hr/statutory"
import { mayObject } from "@/lib/hr/violations"

const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8").replace(/\r\n/g, "\n")

/** The body of a top-level `match /<collection>/{…}` block. */
function block(collection: string): string {
  const start = rules.search(new RegExp(`\\n    match /${collection}/\\{`))
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start + 1)
  const next = rest.slice(1).search(/\n    match \//)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

/** The body of a top-level rules function, comments stripped. */
function fn(name: string): string {
  const start = rules.indexOf(`function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const rest = rules.slice(start)
  const end = rest.search(/\n    (function |match |\/\/)/)
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\/\/[^\n]*/g, "")
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
    for (const c of Object.keys(READ_BEFORE_CREATE)) for (const g of allow(block(c), "get")) expect(g).toMatch(/hrRole\(|hrSeesPay\(\)|hrFinance\(\)|hrStaff\(\)|hrOffice\(\)/)
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
    // `slip` (My file's projection of the approved line, me-writes.ts) rides with the advance: written per line.
    expect(update).toMatch(/hrManager\(\) && \(changedKeys\(\)\.hasOnly\(\['advance', 'retro', 'slip', 'updatedAt'\]\) \|\| isOrgOwner\(\) \|\| !hrOwnRecord\(employeeId\)\)/)
    expect(update).toMatch(/changedKeys\(\)\.hasOnly\(\['advance', 'updatedAt'\]\)\s*&& \(isOrgOwner\(\) \|\| !hrOwnRecord\(employeeId\)\)/)
  })

  it("payrolls, events, payslips and settlements are closed to roles without pay", () => {
    for (const c of ["hrPayrolls", "hrEvents", "hrSettlements"]) for (const g of allow(block(c), "get")) expect(g).not.toMatch(/hrStaff\(\)|hr\.gov|hr\.supervisor/)
  })
})

describe("who decides follows the employee (RL-02, LV-05)", () => {
  it("a request for an HR manager — whoever files it — must name management", () => {
    const [create] = allow(block("hrRequests"), "create")
    expect(create).toMatch(/request\.resource\.data\.deciderLevel == 'management'\s*\|\| !\(request\.resource\.data\.employeeUserId is string\) \|\| !hrUserManages\(request\.resource\.data\.employeeUserId\)/)
    // Not "only when he files his own": the filer is not the test.
    expect(create).not.toMatch(/employeeUserId != request\.auth\.uid \|\| !hrManager\(\)/)
  })

  it("the employee's standing is read from his own default group, a missing user being nobody", () => {
    const fn = rules.slice(rules.indexOf("function hrUserManages("), rules.indexOf("function hrSeesPay("))
    expect(fn).toMatch(/exists\(path\) &&/)
    expect(fn).toMatch(/groupGrants\(get\(path\)\.data\.get\('defaultGroupId', null\), 'employees\.manage'\)/)
  })
})

describe("what HR sends Finance (§7.2)", () => {
  it("government relations who records a renewal sends its fee as a payment request — and nothing else (DC-03)", () => {
    const [create] = allow(block("hrEvents"), "create")
    expect(create).toMatch(/hrManager\(\) \|\| \(hrRole\('hr\.gov'\) && request\.resource\.data\.kind == 'PR' && request\.resource\.data\.key\.matches\('hr:PR:\.\*'\)\)/)
    // Never rewritten: Finance alone updates an event, and only its state.
    const [update] = allow(block("hrEvents"), "update")
    expect(update).toMatch(/hrFinance\(\)/)
    expect(update).not.toMatch(/hr\.gov/)
  })
})

describe("the roles are the ones access.ts names", () => {
  it("every role's permission id is a role the rules know", () => {
    for (const perm of Object.values(HR_ROLE_PERMISSION)) expect(rules).toContain(`hrRole('${perm}')`)
  })
})

describe("letters (EM-08, WF-24)", () => {
  const letters = block("hrLetters")
  const figures = block("hrLetterPay")

  it("a letter carries no pay: its create shape has no figure; the figures sit apart, closed to roles without pay", () => {
    const [create] = allow(letters, "create")
    expect(create).toMatch(/keys\(\)\.hasOnly\(/)
    expect(create).not.toMatch(/basic|housing|transport|wage/)
    for (const g of allow(figures, "get")) expect(g).not.toMatch(/hrStaff\(\)|hr\.gov|hr\.supervisor/)
    expect(allow(figures, "get")[0]).toMatch(/hrSeesPay\(\) \|\| resource\.data\.employeeUserId == request\.auth\.uid/)
  })

  it("government relations reads only the letters it signs", () => {
    const [read] = allow(letters, "get")
    expect(read).toMatch(/resource\.data\.signerLevel == 'gov' && hrRole\('hr\.gov'\)/)
  })

  it("the figures equal the employee's pay, copied while the letter is open by a hand that may read it", () => {
    const [write] = allow(figures, "create")
    expect(write).toMatch(/hrSamePay\(request\.resource\.data, get\(\/databases\/\$\(database\)\/documents\/employeePay\//)
    expect(write).toMatch(/hrSeesPay\(\) \|\| hrOwnRecord\(request\.resource\.data\.employeeId\)/)
    expect(write).toMatch(/resource == null \|\| get\(\/databases\/\$\(database\)\/documents\/hrLetters\/\$\(letterId\)\)\.data\.state == 'pending'/)
    // Written in the same transaction as the letter: judged on the letter as that transaction leaves it.
    expect(write).toMatch(/getAfter\(\/databases\/\$\(database\)\/documents\/hrLetters\//)
  })

  it("signed once, by its level, never by the employee himself (the owner excepted); a decline has its reason", () => {
    const [update] = allow(letters, "update")
    expect(update).toMatch(/resource\.data\.state == 'pending'/)
    expect(update).toMatch(/resource\.data\.employeeUserId != request\.auth\.uid \|\| isOrgOwner\(\)/)
    expect(update).toMatch(/decision\.note\.size\(\) > 0/)
    expect(update).toMatch(/serial\.matches\('LT-\[0-9\]\{4\}\/\[0-9\]\+'\)/)
    expect(allow(letters, "delete")).toEqual(["false"])
  })
})

describe("reports read what each reader may (RP-02)", () => {
  it("government relations lists the attendance months — the monthly attendance report carries no pay", () => {
    // hrOffice() — every HR role but the supervisor — includes government relations.
    expect(fn("hrOffice")).toContain("hrRole('hr.gov')")
    for (const op of ["list", "get"]) for (const r of allow(block("hrAttendance"), op)) expect(r).toContain("hrOffice()")
  })

  it("…and never the payrolls or the pay (RL-03)", () => {
    for (const c of ["hrPayrolls", "employeePay"]) for (const r of allow(block(c), "list")) expect(r).not.toContain("hrRole('hr.gov')")
  })
})

// ---------------------------------------------------------------------------
// §3 #18 — what only the client used to hold, held by the server too
// ---------------------------------------------------------------------------

/** The rules' day arithmetic, re-done in JS: request.time + 3 h read as UTC fields (hrToday), an ISO day made a
 * number (hrNum), Riyadh's midnight opening an ISO day (hrDayStart). The text tests below pin the rules to it. */
const ruleToday = (at: Date) => {
  const t = new Date(at.getTime() + 3 * 3_600_000)
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate()
}
const ruleNum = (s: string) => Number(s.replace(/-/g, ""))
const ruleDayStart = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) - 3 * 3_600_000

describe("the server counts days as the client does — in Riyadh", () => {
  it("hrToday is request.time + 3 hours read as a yyyymmdd number; hrNum strips the dashes; hrDayStart is Riyadh's midnight", () => {
    expect(fn("hrToday")).toMatch(/let t = request\.time \+ duration\.value\(3, 'h'\); return t\.year\(\) \* 10000 \+ t\.month\(\) \* 100 \+ t\.day\(\);/)
    // `replace` takes a pattern and replaces EVERY match: "2026-10-05" → 20261005.
    expect(fn("hrNum")).toMatch(/return int\(s\.replace\('-', ''\)\);/)
    expect(fn("hrDayStart")).toMatch(/let p = s\.split\('-'\); return timestamp\.date\(int\(p\[0\]\), int\(p\[1\]\), int\(p\[2\]\)\) - duration\.value\(3, 'h'\);/)
  })

  it.each(["2026-10-04T20:59:59Z", "2026-10-04T21:00:00Z", "2026-12-31T21:30:00Z", "2027-02-28T23:00:00Z"])("at %s the rules' day is todayDay()'s", (iso) => {
    const at = new Date(iso)
    expect(ruleToday(at)).toBe(ruleNum(riyadhDay(at)))
  })
})

describe("attendance (AT-03, AT-04)", () => {
  const att = block("hrAttendance")
  const sheet = () => fn("hrSheetOk")

  it("both writes go through hrSheetOk — the create with no declarations before it, the update with the stored ones", () => {
    expect(allow(att, "create")[0]).toMatch(/hrSheetOk\(\[\]\)/)
    expect(allow(att, "update")[0]).toMatch(/hrSheetOk\(resource\.data\.get\('declarations', \[\]\)\)/)
    // The old "anything, if the HR manager or supervisor writes it" is gone.
    expect(att).not.toMatch(/\|\| hrManager\(\) \|\| hrSupervises\(resource\.data\.siteId\)\);/)
  })

  it("declarations are append-only: unchanged, or the old ones kept as they were and ONE added in the writer's own name", () => {
    expect(sheet()).toMatch(/d == before/)
    expect(sheet()).toMatch(/\(hrManager\(\) \|\| hrSupervises\(request\.resource\.data\.siteId\)\)/)
    expect(sheet()).toMatch(/d\.size\(\) == before\.size\(\) \+ 1 && d\[0:before\.size\(\)\] == before && d\[before\.size\(\)\]\.by == request\.auth\.uid/)
  })

  it("a month is closed only after it ended — today above yyyymm31 — and the client's closeBlocks agree", () => {
    expect(sheet()).toMatch(/request\.resource\.data\.get\('closed', null\) == null \|\| hrToday\(\) > hrNum\(request\.resource\.data\.month\) \* 100 \+ 31/)
    const serverAllows = (month: string, today: string) => ruleNum(today) > ruleNum(month) * 100 + 31
    for (const [month, today] of [["2026-09", "2026-09-30"], ["2026-09", "2026-10-01"], ["2026-12", "2026-12-31"], ["2026-12", "2027-01-01"], ["2026-02", "2026-02-28"]] as const) {
      const client = !closeBlocks({ month, today, closed: false, missing: [], policy: "warn" }).blocks.includes("not_over")
      expect({ month, today, server: serverAllows(month, today) }).toEqual({ month, today, server: client })
    }
  })

  it("WF-04 — a recorded day is locked: an update may add a day, never change or remove one already there", () => {
    expect(allow(att, "update")[0]).toMatch(/!request\.resource\.data\.days\.diff\(resource\.data\.days\)\.affectedKeys\(\)\.hasAny\(resource\.data\.days\.keys\(\)\)/)
  })
})

describe("manpower requests (AS-02, WF-12)", () => {
  const [update] = allow(block("manpowerRequests"), "update")

  it("the HR manager answers an open request — the answer and its state only", () => {
    expect(update).toMatch(/resource\.data\.state == 'open' && \(\s*\(request\.resource\.data\.state == 'answered' && hrManager\(\)\s*&& changedKeys\(\)\.hasOnly\(\['state', 'answer', 'updatedAt'\]\)\)/)
  })

  it("Projects accepts an answered plan once — whoever asked, or the project's editor — touching nothing else", () => {
    expect(update).toMatch(/resource\.data\.state == 'answered' && changedKeys\(\)\.hasOnly\(\['accepted', 'updatedAt'\]\) && resource\.data\.get\('accepted', null\) == null/)
    expect(update).toMatch(/resource\.data\.requested\.by == request\.auth\.uid \|\| hasProjectPermission\(resource\.data\.projectId, 'projects\.edit'\)/)
  })

  it("an arrival by government relations moves the visa count and its reservation, nothing else of the file", () => {
    const gov = allow(block("hrSettings"), "update").find((r) => r.includes("hr.gov")) ?? ""
    expect(gov).toMatch(/affectedKeys\(\)\.hasOnly\(\['visas', 'visasReserved'\]\)/)
    expect(gov).toMatch(/request\.resource\.data\.establishment\.visas == resource\.data\.establishment\.visas - 1/)
  })
})

describe("penalties (PN-02, PN-04)", () => {
  const [update] = allow(block("hrViolations"), "update")

  it("applied only after a hearing held between the violation and today, and notified today — the objection clock's start", () => {
    expect(update).toMatch(/request\.resource\.data\.hearing\.on >= resource\.data\.on && hrNum\(request\.resource\.data\.hearing\.on\) <= hrToday\(\)/)
    expect(update).toMatch(/hrNum\(request\.resource\.data\.notifiedOn\) == hrToday\(\)/)
  })

  it("the employee objects within 15 days of the notice — on the server as in mayObject()", () => {
    const days = STATUTORY.penalties.objectionDays
    expect(update).toMatch(new RegExp(`request\\.time < hrDayStart\\(resource\\.data\\.notifiedOn\\) \\+ duration\\.value\\(${days + 1}, 'd'\\)`))
    const notifiedOn = "2026-09-20"
    for (const iso of ["2026-10-05T20:59:00Z", "2026-10-05T21:00:00Z", "2026-09-20T10:00:00Z"]) {
      const at = new Date(iso)
      const server = at.getTime() < ruleDayStart(notifiedOn) + (days + 1) * 86_400_000
      expect({ iso, server }).toEqual({ iso, server: mayObject({ state: "applied", notifiedOn }, riyadhDay(at)) })
    }
  })
})

describe("cancel before it starts (LV-07)", () => {
  it("an approved leave is cancelled only before its first day, in Riyadh — as mayCancel()", () => {
    const [update] = allow(block("hrRequests"), "update")
    expect(update).toMatch(/resource\.data\.state == 'approved' && resource\.data\.kind == 'leave' && \(hrManager\(\) \|\| resource\.data\.employeeUserId == request\.auth\.uid\) && hrToday\(\) < hrNum\(resource\.data\.leave\.from\)/)
    const hr = { uid: "h", owner: false, roles: new Set(["manager"] as const), employeeId: null, sites: [] }
    // …and the employee himself (owner default 5): the same day boundary.
    const own = { uid: "w", owner: false, roles: new Set<never>(), employeeId: "e", sites: [] }
    for (const [from, today] of [["2026-10-06", "2026-10-05"], ["2026-10-05", "2026-10-05"], ["2026-10-04", "2026-10-05"]] as const) {
      const r = { state: "approved" as const, kind: "leave" as const, employeeId: "e", leave: { from, type: "annual" } as HrRequest["leave"] }
      expect({ from, today, server: ruleNum(today) < ruleNum(from) }).toEqual({ from, today, server: mayCancel(hr, r, today) })
      expect({ from, today, server: ruleNum(today) < ruleNum(from) }).toEqual({ from, today, server: mayCancel(own, r, today) })
    }
  })

  it("his days come back with it — exactly that leave's, in the same write, named by `undo` (never a balance he sets)", () => {
    const employees = block("employees")
    const updates = allow(employees.slice(0, employees.indexOf("match /log/")), "update")
    const own = updates.find((u) => u.includes("hrUndo("))
    expect(own).toMatch(/resource\.data\.get\('userId', ''\) == request\.auth\.uid\s*&& changedKeys\(\)\.hasOnly\(\['leaveTaken', 'undo', 'updatedAt'\]\)\s*&& hrUndo\(employeeId, request\.resource\.data\.undo\)/)
    const f = fn("hrUndo")
    expect(f).toMatch(/b\.employeeId == e && b\.state == 'approved' && getAfter\(p\)\.data\.state == 'cancelled'/)
    expect(f).toMatch(/request\.resource\.data\.leaveTaken == resource\.data\.leaveTaken - b\.leave\.fromBalance/)
  })
})

describe("a supervisor reads his own workplaces only (RL-01)", () => {
  it("hrOffice() is every HR role but the supervisor; hrStaff() adds him", () => {
    const office = fn("hrOffice")
    for (const r of ["manager", "gov", "payroll", "management"] as const) expect(office).toContain(`hrRole('${HR_ROLE_PERMISSION[r]}')`)
    expect(office).not.toContain("hr.supervisor")
    expect(fn("hrStaff")).toMatch(/return hrOffice\(\) \|\| hrRole\('hr\.supervisor'\);/)
  })

  it.each([
    ["employees", /hrOffice\(\) \|\| resource\.data\.get\('userId', ''\) == request\.auth\.uid \|\| hrSupervises\(resource\.data\.siteId\)/],
    ["hrInjuries", /hrOffice\(\) \|\| resource\.data\.get\('employeeUserId', ''\) == request\.auth\.uid \|\| hrSupervises\(resource\.data\.siteId\)/],
    ["hrRequests", /resource\.data\.kind in \['leave', 'attfix'\] && \(hrRole\('hr\.gov'\) \|\| hrSupervises\(resource\.data\.siteId\)\)/],
  ])("%s — the company for the office, the supervisor by the record's workplace (a site-by-site query the rule can prove)", (c, re) => {
    for (const op of ["get", "list"]) {
      const [r] = allow(block(c), op)
      expect(r).toMatch(re as RegExp)
      expect(r).not.toMatch(/hrStaff\(\)/)
    }
  })

  it("the employee's log, by the record's workplace", () => {
    const employees = block("employees")
    const [read] = allow(employees.slice(employees.indexOf("match /log/{entryId}")), "read")
    expect(read).toMatch(/hrOffice\(\) \|\| hrOwnRecord\(employeeId\) \|\| hrSupervises\(hrEmp\(employeeId\)\.get\('siteId', '-'\)\)/)
  })

  it("the client asks the same way: the whole company for the office, a supervisor's own sites one by one, nobody's without a role", () => {
    const ctx = (roles: HrRole[], sites: string[] = ["s1"], owner = false) => ({ owner, roles: new Set(roles), sites })
    expect(hrPeopleScope(ctx(["supervisor"]))).toEqual(["s1"])
    expect(hrPeopleScope(ctx(["supervisor", "gov"]))).toBeNull()
    for (const r of ["manager", "gov", "payroll", "management"] as HrRole[]) expect(hrPeopleScope(ctx([r]))).toBeNull()
    expect(hrPeopleScope(ctx([], [], true))).toBeNull()
    expect(hrPeopleScope(ctx([]))).toEqual([])
    expect(hrScopeAt(["s1"], "s2")).toEqual([])
    expect(hrScopeAt(["s1"], "s1")).toEqual(["s1"])
    expect(hrScopeAt(null, "s2")).toBeNull()
  })
})

describe("the matrix, where the server was laxer than the client (RL-01, RL-02)", () => {
  it("a supervisor's violation or injury is on the PERSON's workplace — read from the record, not one he names", () => {
    expect(fn("hrOnSite")).toMatch(/d\.get\('siteId', null\) is string && d\.siteId == hrEmp\(d\.employeeId\)\.get\('siteId', null\) && hrSupervises\(d\.siteId\)/)
    for (const c of ["hrViolations", "hrInjuries"]) {
      const [create] = allow(block(c), "create")
      expect(create).toMatch(/hrManager\(\) \|\| hrOnSite\(request\.resource\.data\)/)
      expect(create).not.toMatch(/is string && hrSupervises\(request\.resource\.data\.siteId\)/)
    }
    // …and the injured person named is the record's: his user is the one who then reads it.
    expect(allow(block("hrInjuries"), "create")[0]).toMatch(/request\.resource\.data\.employeeUserId == hrEmp\(request\.resource\.data\.employeeId\)\.get\('userId', null\)/)
  })

  it("a request carries the employee's own workplace — it decides which supervisor endorses and reads it", () => {
    expect(allow(block("hrRequests"), "create")[0]).toMatch(/request\.resource\.data\.get\('siteId', null\) == hrEmp\(request\.resource\.data\.employeeId\)\.get\('siteId', null\)/)
  })

  it("an IBAN payroll fixed is approved by a different hand; management sets one only on the HR manager's own record", () => {
    const [update] = allow(block("employeePay"), "update")
    expect(update).toMatch(/request\.resource\.data\.get\('ibanState', ''\) != 'ok' \|\| resource\.data\.get\('ibanState', ''\) != 'fixed'\s*\|\| resource\.data\.get\('ibanFixedBy', ''\) != request\.auth\.uid \|\| isOrgOwner\(\)/)
    expect(update).toMatch(/request\.resource\.data\.ibanState == 'ok'\)\)\s*&& hrUserManages\(hrEmp\(employeeId\)\.get\('userId', '-'\)\)/)
  })

  it("management changes the HR manager's pay (EM-04, RL-02) — his figures and history only, never its own record's", () => {
    const [update] = allow(block("employeePay"), "update")
    const clause = update.slice(update.indexOf("(hrRole('hr.management') && !hrOwnRecord(employeeId)"))
    expect(clause).toMatch(/^\(hrRole\('hr\.management'\) && !hrOwnRecord\(employeeId\)\s*&& \(changedKeys\(\)\.hasOnly\(\['basic', 'housing', 'transport', 'steps', 'retro', 'updatedAt'\]\)/)
    // …and only where the record's user is an HR manager (his DEFAULT group, as access.ts reads it).
    expect(clause).toMatch(/&& hrUserManages\(hrEmp\(employeeId\)\.get\('userId', '-'\)\)\)+$/)
  })

  it("the line manager writes his probation view and nothing else of the record (EM-05)", () => {
    const updates = allow(block("employees"), "update")
    const view = updates.find((u) => u.includes("probationView"))
    expect(view).toBeDefined()
    expect(view).toMatch(/changedKeys\(\)\.hasOnly\(\['probationView', 'updatedAt'\]\)/)
    expect(view).toMatch(/request\.resource\.data\.probationView\.by == request\.auth\.uid/)
    // The manager the card names, or the workplace's supervisor — no one else.
    expect(view).toMatch(/hrSupervises\(resource\.data\.siteId\) \|\| hrEmp\(resource\.data\.managerId\)\.get\('userId', ''\) == request\.auth\.uid/)
  })

  it("government relations records a work injury (DC-07, owner default 4) — the guard and the rule agree", () => {
    expect(HR_GUARD["injury.record"].roles).toContain("gov")
    const [create] = allow(block("hrInjuries"), "create")
    expect(create).toMatch(/hrManager\(\) \|\| hrOnSite\(request\.resource\.data\) \|\| hrRole\('hr\.gov'\)/)
    // …a violation stays the HR manager's and the site's supervisor's.
    expect(allow(block("hrViolations"), "create")[0]).not.toMatch(/hr\.gov/)
  })

  it("a raise is a request kind (EM-04): carrying pay, it is read by pay roles and the employee only", () => {
    const [create] = allow(block("hrRequests"), "create")
    expect(create).toMatch(/kind in \['leave', 'advance', 'data', 'attfix', 'raise'\]/)
    const [read] = allow(block("hrRequests"), "get")
    // Only a leave is opened to government relations and supervisors.
    expect(read).not.toMatch(/'raise'/)
    // …a leave or an attendance correction (no money either) — never a raise.
    expect(read).toMatch(/resource\.data\.kind in \['leave', 'attfix'\] && \(hrRole\('hr\.gov'\)/)
  })
})

describe("access.ts and the rules name the same roles", () => {
  /** Every permission id the rules pass to hrRole(…) — the HR role ids, and nothing else. */
  const ruleIds = [...new Set([...rules.replace(/\/\/[^\n]*/g, "").matchAll(/hrRole\('([a-z.]+)'\)/g)].map((m) => m[1]))].sort()
  const permOf = (roles: readonly HrRole[]) => roles.map((r) => HR_ROLE_PERMISSION[r]).sort()

  it("the ids are HR_ROLE_PERMISSION's, both ways", () => {
    expect(ruleIds).toEqual(Object.values(HR_ROLE_PERMISSION).sort())
    // The ternary in hrLetters names its ids as plain strings — still role ids.
    for (const id of [...rules.matchAll(/'(hr\.[a-z]+|employees\.manage)'/g)].map((m) => m[1])) expect(Object.values(HR_ROLE_PERMISSION)).toContain(id)
  })

  it("hrSeesPay() is HR_GUARD['pay.view']; hrManager() is the HR manager's id", () => {
    const pay = [...fn("hrSeesPay").matchAll(/hrRole\('([a-z.]+)'\)/g)].map((m) => m[1]).sort()
    expect(pay).toEqual(permOf(HR_GUARD["pay.view"].roles))
    expect(fn("hrManager")).toContain(`hrRole('${HR_ROLE_PERMISSION.manager}')`)
  })

  it("hrOffice() is exactly the roles hrPeopleScope() gives the whole company", () => {
    const office = [...fn("hrOffice").matchAll(/hrRole\('([a-z.]+)'\)/g)].map((m) => m[1]).sort()
    const whole = HR_ROLES.filter((r) => hrPeopleScope({ owner: false, roles: new Set([r]), sites: [] }) === null)
    expect(office).toEqual(permOf(whole))
  })

  it("the rules read a role from the DEFAULT group, as hrRolesOf() does — the owner holding every one", () => {
    expect(fn("hrRole")).toMatch(/return isOrgOwner\(\) \|\| groupGrants\(memberDefaultGroupId\(\), perm\);/)
  })
})

describe("Finance records the month's GOSI payment on the payroll (PY-09)", () => {
  it("Finance's clause lets `gosiPaid` change — and only Finance's", () => {
    const [update] = allow(block("hrPayrolls"), "update")
    const clauses = update.split("||")
    expect(clauses.find((c) => c.includes("hrFinance()"))).toContain("'gosiPaid'")
    for (const c of clauses.filter((x) => !x.includes("hrFinance()"))) expect(c).not.toContain("gosiPaid")
  })
})

describe("My file and self-service (package A)", () => {
  it("an attendance correction is filed like any request and decided by the supervisor who keeps the sheet — never his own", () => {
    const [create] = allow(block("hrRequests"), "create")
    expect(create).toMatch(/request\.resource\.data\.kind in \['leave', 'advance', 'data', 'attfix', 'raise'\]/)
    // The filer, the company, the employee's user and "himself or the HR manager" — one helper with letters.
    expect(create).toMatch(/hrFiledFor\(request\.resource\.data\)/)
    expect(fn("hrFiledFor")).toMatch(/\(hrManager\(\) \|\| d\.employeeUserId == request\.auth\.uid\)/)
    const [update] = allow(block("hrRequests"), "update")
    expect(update).toMatch(/\(resource\.data\.kind == 'attfix' && hrSupervises\(resource\.data\.siteId\)\)/)
    // …inside the decide clause, which keeps hrNotOwn().
    const decide = update.slice(update.indexOf("// decide"), update.indexOf("// Finance decides"))
    expect(decide === "" ? update : decide).toMatch(/hrNotOwn\(\)/)
  })

  it("his attendance is projected onto his record by whoever keeps the sheet — that key and nothing else", () => {
    const employees = block("employees")
    const [update] = allow(employees.slice(0, employees.indexOf("match /log/")), "update")
    expect(update).toMatch(/changedKeys\(\)\.hasOnly\(\['att', 'updatedAt'\]\) && \(hrRole\('hr\.payroll'\) \|\| hrSupervises\(resource\.data\.siteId\)\)/)
  })
})

describe("government platforms and the pre-Mudad check (package F2, GV-02…05, PY-08)", () => {
  const body = () => block("hrGovTasks")

  it("the platform records are read by the HR office roles only — before they exist too (a task recorded once is read first)", () => {
    const [get] = allow(body(), "get")
    expect(get).toMatch(/\(resource == null \|\| inOrg\(\)\) && hrOffice\(\)/)
    expect(get).not.toMatch(/hrStaff\(\)|hr\.supervisor/)
  })

  it("created in the writer's own name under `{orgId}__{key}`, of the three kinds; only a reconciliation is replaced; nothing is deleted", () => {
    const [create] = allow(body(), "create")
    expect(create).toMatch(/createsInOrg\(\) && hrOffice\(\)/)
    expect(create).toMatch(/id == request\.resource\.data\.organizationId \+ '__' \+ request\.resource\.data\.key/)
    expect(create).toMatch(/request\.resource\.data\.by == request\.auth\.uid/)
    expect(create).toMatch(/request\.resource\.data\.kind in \['done', 'task', 'recon'\]/)
    const [update] = allow(body(), "update")
    expect(update).toMatch(/resource\.data\.kind == 'recon'/)
    expect(update).toMatch(/request\.resource\.data\.key == resource\.data\.key/)
    expect(allow(body(), "delete")).toEqual(["false"])
  })

  it("the justifications and the Mudad status ride the payroll — payroll or the HR manager, those two keys only, never Finance's clause", () => {
    const [update] = allow(block("hrPayrolls"), "update")
    expect(update).toMatch(/\|\| \(changedKeys\(\)\.hasOnly\(\['just', 'mudad', 'updatedAt'\]\) && \(hrManager\(\) \|\| hrRole\('hr\.payroll'\)\)\)/)
    for (const c of update.split("||").filter((x) => x.includes("hrFinance()"))) expect(c).not.toMatch(/'just'|'mudad'/)
  })

  it("Qiwa's documented basic is a pay figure: it rides employeePay, whose writers are pay roles — never government relations", () => {
    const [update] = allow(block("employeePay"), "update")
    expect(update).not.toContain("hr.gov")
  })
})

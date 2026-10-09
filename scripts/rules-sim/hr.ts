import { execSync } from "child_process"
import fs from "fs"
import path from "path"

const UAT_PROJECT = "mdmaktech-uat"
type Data = Record<string, unknown>
type Method = "get" | "list" | "create" | "update" | "delete"

interface HrCase {
  name: string
  uid: string | null
  method: Method
  path: string
  before?: Data
  after?: Data
  overrides?: Record<string, Data | null>
  afterDocs?: Record<string, Data | null>
  expect: "ALLOW" | "DENY"
}

const ROOT = "/databases/(default)/documents/"
const rulesSource = () => fs.readFileSync(process.env.RULES_FILE ?? path.join(process.cwd(), "firestore.rules"), "utf8")
const token = () => execSync("gcloud auth print-access-token", { encoding: "utf8", env: process.env }).trim()
const decode = (p: string) => decodeURIComponent(p).replace("/databases/(default)/documents/", "")

interface TestResult {
  state: string
  debugMessages?: string[]
  errorPosition?: unknown
  functionCalls?: Array<{ function: string; args: string[] }>
}

let cachedToken = ""
let tokenAt = 0
const bearer = () => {
  if (!cachedToken || Date.now() - tokenAt > 15 * 60 * 1000) {
    cachedToken = token()
    tokenAt = Date.now()
  }
  return cachedToken
}

async function call(testCase: unknown, mocks: unknown[]): Promise<TestResult> {
  const body = JSON.stringify({ source: { files: [{ name: "firestore.rules", content: rulesSource() }] }, testSuite: { testCases: [{ ...(testCase as object), functionMocks: mocks }] } })
  let last = "rules test failed"
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${UAT_PROJECT}:test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer()}`, "x-goog-user-project": UAT_PROJECT, "Content-Type": "application/json" },
        body,
      })
      const text = await res.text()
      let json: { testResults?: TestResult[]; error?: { message: string; code?: number } } = {}
      try {
        json = JSON.parse(text)
      } catch {
        last = "non-JSON answer (" + res.status + ")"
      }
      if (json.testResults) return json.testResults[0]
      if (json.error) last = json.error.message
      if (res.status === 401 || /invalid authentication/i.test(last)) tokenAt = 0
    } catch (e) {
      last = (e as Error).message
    }
    await new Promise((r) => setTimeout(r, Math.min(1500 * (attempt + 1), 15000)))
  }
  throw new Error(last)
}

interface Result {
  name: string
  expected: "ALLOW" | "DENY"
  got: "ALLOW" | "DENY"
  ok: boolean
  detail: string
  calls: number
}

// Same as sim.ts, with two differences: documents the case does not override do not exist (every case builds its own synthetic
// company, nothing is read from UAT), and getAfter()/existsAfter() are mocked too (the rules use them for hrAttfixOk,
// hrUndo, the first employee log entry and hrLetterPay) from `afterDocs`, else from the same document as get() reads.
async function simulate(c: HrCase): Promise<Result> {
  const known = new Map<string, Data | null>()
  const testCase = {
    expectation: "ALLOW",
    request: { auth: c.uid ? { uid: c.uid, token: {} } : null, path: ROOT + c.path, method: c.method, time: new Date().toISOString(), ...(c.after ? { resource: { data: c.after } } : {}) },
    resource: c.before ? { data: c.before } : null,
  }
  const resolve = (p: string): Data | null => (c.overrides && p in c.overrides ? c.overrides[p] : null)
  const after = (p: string): Data | null => (c.afterDocs && p in c.afterDocs ? c.afterDocs[p] : known.get(p) ?? null)
  let r: TestResult = { state: "FAILURE" }
  let rounds = 0
  for (; rounds < 14; rounds++) {
    const mocks = [...known].flatMap(([p, d]) => {
      const a = after(p)
      return [
        { function: "exists", args: [{ exactValue: ROOT + p }], result: { value: d !== null } },
        { function: "get", args: [{ exactValue: ROOT + p }], result: d === null ? { undefined: {} } : { value: { data: d } } },
        { function: "existsAfter", args: [{ exactValue: ROOT + p }], result: { value: a !== null } },
        { function: "getAfter", args: [{ exactValue: ROOT + p }], result: a === null ? { undefined: {} } : { value: { data: a } } },
      ]
    })
    r = await call(testCase, mocks)
    const wanted = [...new Set((r.functionCalls ?? []).map((f) => decode(f.args[0])))].filter((p) => !known.has(p))
    if (wanted.length === 0 || r.state === "SUCCESS") break
    for (const p of wanted) known.set(p, resolve(p))
  }
  const got = r.state === "SUCCESS" ? "ALLOW" : "DENY"
  const detail = (r.debugMessages ?? []).join(" | ").slice(0, 400)
  return { name: c.name, expected: c.expect, got, ok: got === c.expect, detail, calls: known.size }
}

async function runAll(cases: HrCase[]): Promise<number> {
  let bad = 0
  const only = process.env.ONLY
  const wanted = process.env.NAMES_FILE ? new Set(fs.readFileSync(process.env.NAMES_FILE, "utf8").split("\n").map((s) => s.replace(/\r$/, ""))) : null
  const list = wanted ? cases.filter((c) => wanted.has(c.name)) : only ? cases.filter((c) => c.name.includes(only)) : cases
  const names = new Set<string>()
  for (const c of list) {
    if (names.has(c.name)) console.log(`WARN duplicate case name: ${c.name}`)
    names.add(c.name)
  }
  const out: Result[] = []
  let doneCount = 0
  const queue = [...list]
  const workers = Array.from({ length: Number(process.env.PAR ?? 4) }, async () => {
    for (;;) {
      const c = queue.shift()
      if (!c) return
      let r: Result
      try {
        r = await simulate(c)
      } catch (e) {
        r = { name: c.name, expected: c.expect, got: c.expect === "ALLOW" ? "DENY" : "ALLOW", ok: false, detail: `ERROR ${(e as Error).message}`, calls: 0 }
      }
      out[list.indexOf(c)] = r
      if (++doneCount % 50 === 0) console.error(`${doneCount}/${list.length} done`)
    }
  })
  await Promise.all(workers)
  for (const r of out) {
    if (!r.ok) bad++
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  (expected ${r.expected}, got ${r.got})${r.ok ? "" : "  " + r.detail}${/maximum of 1000/.test(r.detail) ? " [LIMIT 1000 expressions]" : ""}`)
  }
  console.log(`\n${list.length - bad}/${list.length} as expected`)
  return bad
}

// ---------------------------------------------------------------------------
// The synthetic company
// ---------------------------------------------------------------------------

const ORG = "hrt-org"
const OTHER = "hrt-other-org"
const U = {
  owner: ORG,
  hrm: "u-hrm",
  hrm2: "u-hrm2",
  gov: "u-gov",
  pay: "u-pay",
  sup1: "u-sup1",
  sup2: "u-sup2",
  mgmt: "u-mgmt",
  fin: "u-fin",
  inv: "u-inv",
  plain: "u-plain",
  emp1: "u-emp1",
  emp2: "u-emp2",
  star: "u-star",
  stranger: "u-stranger",
  otherOwner: OTHER,
}
const G: Record<string, string[]> = {
  hrm: ["employees.manage"],
  hrm2: ["employees.manage"],
  gov: ["hr.gov"],
  pay: ["hr.payroll"],
  sup1: ["hr.supervisor"],
  sup2: ["hr.supervisor"],
  mgmt: ["hr.management"],
  fin: ["invoices.manage"],
  inv: ["warehouses.manage"],
  plain: [],
  emp1: [],
  emp2: [],
  star: ["*"],
}
const memberDocs = (): Record<string, Data | null> => {
  const o: Record<string, Data | null> = {
    [`users/${ORG}`]: { organizationId: ORG, role: "Contractor" },
    [`users/${OTHER}`]: { organizationId: OTHER, role: "Contractor" },
    [`users/${U.stranger}`]: { organizationId: OTHER, organizationRole: "member", defaultGroupId: "g-stranger", role: "Contractor" },
    "teamGroups/g-stranger": { organizationId: OTHER, permissions: ["*"] },
  }
  for (const [k, perms] of Object.entries(G)) {
    o[`users/${U[k as keyof typeof U]}`] = { organizationId: ORG, organizationRole: "member", defaultGroupId: `g-${k}`, role: "Contractor" }
    o[`teamGroups/g-${k}`] = { organizationId: ORG, permissions: perms }
  }
  return o
}

const S1 = "site1"
const S2 = "site2"
const world = (): Record<string, Data | null> => ({
  ...memberDocs(),
  [`hrSites/${S1}`]: { organizationId: ORG, type: "project", name: "S1", supervisorUserId: U.sup1, active: true },
  [`hrSites/${S2}`]: { organizationId: ORG, type: "workshop", name: "S2", supervisorUserId: U.sup2, active: true },
  "employees/e1": { organizationId: ORG, no: 1, userId: U.emp1, siteId: S1, status: "active", leaveTaken: 5, names: { ar: "a" }, docs: {}, join: "2025-01-01" },
  "employees/e2": { organizationId: ORG, no: 2, userId: U.emp2, siteId: S2, status: "active", leaveTaken: 0, names: { ar: "b" }, docs: {}, join: "2025-01-01" },
  "employees/e3": { organizationId: ORG, no: 3, userId: null, siteId: null, status: "active", leaveTaken: 0, names: { ar: "c" }, docs: {}, join: "2025-01-01" },
  "employees/ehm": { organizationId: ORG, no: 4, userId: U.hrm, siteId: null, status: "active", leaveTaken: 0, names: { ar: "m" }, docs: {}, join: "2024-01-01" },
  "employees/ehm2": { organizationId: ORG, no: 5, userId: U.hrm2, siteId: S1, status: "active", leaveTaken: 0, names: { ar: "m2" }, docs: {}, join: "2024-01-01" },
  "employeePay/e1": { organizationId: ORG, employeeId: "e1", basic: 4000, housing: 1000, transport: 400, retro: [], advance: null },
  "employeePay/e2": { organizationId: ORG, employeeId: "e2", basic: 3000, housing: 750, transport: 300, retro: [], advance: null },
  "employeePay/ehm": { organizationId: ORG, employeeId: "ehm", basic: 9000, housing: 2250, transport: 900, retro: [], advance: null },
})

const T = "2026-10-08T00:00:00.000Z"
const T2 = "2026-10-08T01:00:00.000Z"
const stampOf = (by: string) => ({ by, byName: "n", at: T })

const riyadhDay = (offsetDays = 0) => new Date(Date.now() + 3 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)

const cases: HrCase[] = []
const add = (c: Omit<HrCase, "overrides"> & { overrides?: Record<string, Data | null> }) => cases.push({ ...c, overrides: { ...world(), ...(c.overrides ?? {}) } })
const allow = (name: string, uid: string | null, method: Method, p: string, before: Data | undefined, after: Data | undefined, extra: { overrides?: Record<string, Data | null>; afterDocs?: Record<string, Data | null> } = {}) =>
  add({ name, uid, method, path: p, before, after, expect: "ALLOW", ...extra })
const deny = (name: string, uid: string | null, method: Method, p: string, before: Data | undefined, after: Data | undefined, extra: { overrides?: Record<string, Data | null>; afterDocs?: Record<string, Data | null> } = {}) =>
  add({ name, uid, method, path: p, before, after, expect: "DENY", ...extra })

// ---------------------------------------------------------------------------
// Shared shapes (built the way the client builds them)
// ---------------------------------------------------------------------------

const today = riyadhDay()
const M = today.slice(0, 7)
const PM = "2026-08"
const E = (id: string): Data => world()[`employees/${id}`] as Data
const P = (id: string): Data => world()[`employeePay/${id}`] as Data
const ALL_MEMBERS = [U.hrm, U.gov, U.pay, U.sup1, U.mgmt, U.fin, U.inv, U.plain, U.emp1, U.emp2] as const
const nameOf = (uid: string) => Object.entries(U).find(([, v]) => v === uid)?.[0] ?? uid
const writers = (list: readonly string[]) => new Set(list)

/** One ALLOW case per user in `yes`, one DENY per user in `no`. */
type Maybe = Data | undefined | ((uid: string) => Data | undefined)
const val = (v: Maybe, uid: string) => (typeof v === "function" ? v(uid) : v)
function matrix(label: string, method: Method, p: string, before: Maybe, after: Maybe, yes: readonly string[], no: readonly string[], extra: { overrides?: Record<string, Data | null>; afterDocs?: Record<string, Data | null> } = {}) {
  for (const uid of yes) allow(`${label} — ${nameOf(uid)}`, uid, method, p, val(before, uid), val(after, uid), extra)
  for (const uid of no) deny(`${label} — ${nameOf(uid)}`, uid, method, p, val(before, uid), val(after, uid), extra)
}

const newEmp = (over: Data = {}): Data => ({
  organizationId: ORG, no: 6, names: { ar: "n", en: null }, nationality: "bd", gender: "m", idNo: null, trade: "mason", category: "labour", siteId: S1, managerId: null, userId: null,
  join: "2026-10-01", since: null, source: "hire", contract: { type: "open", end: null }, siteSince: "2026-10-01", probation: { end: "2026-12-30", consentOn: null, decision: null, decidedOn: null },
  status: "active", docs: { contract: null }, education: null, leaveTaken: 0, openingLeave: 0, sick: null, hajjTaken: false, name: "n", createdAt: T, updatedAt: T, ...over,
})
const patch = (before: Data, p: Data): Data => ({ ...before, ...p })
const logEntry = (by: string, kind = "created"): Data => ({ organizationId: ORG, at: T, by, byName: "n", kind, params: {}, source: "hr" })

// ---------------------------------------------------------------------------
// hrSettings
// ---------------------------------------------------------------------------

const settings: Data = { organizationId: ORG, features: ["punch"], policies: { advanceMonths: 3 }, establishment: { visas: 5, visasReserved: 2 }, log: [] }
matrix("hrSettings get", "get", `hrSettings/${ORG}`, settings, undefined, [U.hrm, U.gov, U.pay, U.sup1, U.mgmt, U.plain, U.emp1, U.owner], [U.stranger])
deny("hrSettings get — unauthenticated", null, "get", `hrSettings/${ORG}`, settings, undefined)
deny("hrSettings get — other company's owner", U.otherOwner, "get", `hrSettings/${ORG}`, settings, undefined)
const settingsSaved = patch(settings, { policies: { advanceMonths: 4 }, log: [{ at: T }], updatedAt: T, updatedBy: U.hrm })
matrix("hrSettings saveHrSettings update", "update", `hrSettings/${ORG}`, settings, settingsSaved, [U.hrm, U.owner, U.star], [U.gov, U.pay, U.sup1, U.mgmt, U.fin, U.plain, U.emp1, U.stranger])
allow("hrSettings saveHrSettings first save (create)", U.hrm, "create", `hrSettings/${ORG}`, undefined, settingsSaved)
deny("hrSettings create — other organizationId in body", U.hrm, "create", `hrSettings/${ORG}`, undefined, patch(settingsSaved, { organizationId: OTHER }))
deny("hrSettings create — supervisor", U.sup1, "create", `hrSettings/${ORG}`, undefined, settingsSaved)
const visaSpend = patch(settings, { establishment: { visas: 4, visasReserved: 1 } })
allow("hrSettings visa arrival (createEmployee) — government relations lowers visas and reservation", U.gov, "update", `hrSettings/${ORG}`, settings, visaSpend)
allow("hrSettings visa arrival — HR manager", U.hrm, "update", `hrSettings/${ORG}`, settings, visaSpend)
allow("hrSettings batchStep visa issue — gov lowers visas only", U.gov, "update", `hrSettings/${ORG}`, settings, patch(settings, { establishment: { visas: 2, visasReserved: 2 } }))
deny("hrSettings gov raises visas", U.gov, "update", `hrSettings/${ORG}`, settings, patch(settings, { establishment: { visas: 9, visasReserved: 2 } }))
deny("hrSettings gov keeps visas equal", U.gov, "update", `hrSettings/${ORG}`, settings, patch(settings, { establishment: { visas: 5, visasReserved: 1 } }))
deny("hrSettings gov changes another establishment field", U.gov, "update", `hrSettings/${ORG}`, settings, patch(settings, { establishment: { visas: 4, visasReserved: 2, cr: "x" } }))
deny("hrSettings gov writes updatedAt beside the visa", U.gov, "update", `hrSettings/${ORG}`, settings, patch(settings, { establishment: { visas: 4, visasReserved: 2 }, updatedAt: T2 }))
deny("hrSettings gov changes policies", U.gov, "update", `hrSettings/${ORG}`, settings, patch(settings, { policies: { advanceMonths: 9 } }))
deny("hrSettings payroll lowers visas", U.pay, "update", `hrSettings/${ORG}`, settings, visaSpend)
allow("hrSettings manpower answer reserves visas (HR manager, updatedAt)", U.hrm, "update", `hrSettings/${ORG}`, settings, patch(settings, { establishment: { visas: 5, visasReserved: 3 }, updatedAt: T2 }))
deny("hrSettings delete — owner", U.owner, "delete", `hrSettings/${ORG}`, settings, undefined)

// ---------------------------------------------------------------------------
// hrCounters (the permanent employee number) and mfgCounters (request/letter/opening numbers)
// ---------------------------------------------------------------------------

const counter: Data = { organizationId: ORG, lastEmployeeNo: 5, updatedAt: T }
matrix("hrCounters get", "get", `hrCounters/${ORG}`, counter, undefined, [U.hrm, U.gov, U.plain, U.emp1], [U.stranger])
matrix("hrCounters create (first employee)", "create", `hrCounters/${ORG}`, undefined, { organizationId: ORG, lastEmployeeNo: 1, updatedAt: T }, [U.hrm, U.gov], [U.pay, U.sup1, U.mgmt, U.emp1, U.stranger])
matrix("hrCounters next number", "update", `hrCounters/${ORG}`, counter, patch(counter, { lastEmployeeNo: 6 }), [U.hrm, U.gov], [U.pay, U.sup1, U.mgmt, U.fin, U.emp1, U.stranger])
deny("hrCounters number goes backwards", U.hrm, "update", `hrCounters/${ORG}`, counter, patch(counter, { lastEmployeeNo: 4 }))
deny("hrCounters number unchanged", U.hrm, "update", `hrCounters/${ORG}`, counter, patch(counter, { lastEmployeeNo: 5 }))
deny("hrCounters jumps by more than 500", U.hrm, "update", `hrCounters/${ORG}`, counter, patch(counter, { lastEmployeeNo: 506 }))
deny("hrCounters number is not an int", U.hrm, "update", `hrCounters/${ORG}`, counter, patch(counter, { lastEmployeeNo: "6" }))
const mfgCounter: Data = { organizationId: ORG, type: "LV", year: 2026, last: 3, updatedAt: T }
allow("mfgCounters draw first request number — plain employee", U.emp1, "create", `mfgCounters/${ORG}__LV__2026`, undefined, patch(mfgCounter, { last: 1 }))
allow("mfgCounters draw next request number — plain employee", U.emp1, "update", `mfgCounters/${ORG}__LV__2026`, mfgCounter, patch(mfgCounter, { last: 4 }))
deny("mfgCounters draw — other company", U.stranger, "update", `mfgCounters/${ORG}__LV__2026`, mfgCounter, patch(mfgCounter, { last: 4 }))

// ---------------------------------------------------------------------------
// hrSites
// ---------------------------------------------------------------------------

const site1 = (): Data => world()[`hrSites/${S1}`] as Data
const newSite: Data = { name: "New", nameEn: null, type: "workshop", projectId: null, endDate: null, supervisorEmployeeId: null, supervisorUserId: U.sup2, updatedAt: T, updatedBy: U.hrm, organizationId: ORG, active: true, createdAt: T }
matrix("hrSites get", "get", `hrSites/${S1}`, site1(), undefined, [U.hrm, U.gov, U.pay, U.sup1, U.sup2, U.mgmt, U.plain, U.emp1], [U.stranger])
deny("hrSites get — unauthenticated", null, "get", `hrSites/${S1}`, site1(), undefined)
matrix("hrSites saveSite create", "create", "hrSites/new1", undefined, newSite, [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.mgmt, U.emp1, U.stranger])
deny("hrSites create — bad type", U.hrm, "create", "hrSites/new1", undefined, patch(newSite, { type: "garage" }))
deny("hrSites create — empty name", U.hrm, "create", "hrSites/new1", undefined, patch(newSite, { name: "" }))
deny("hrSites create — into another company", U.hrm, "create", "hrSites/new1", undefined, patch(newSite, { organizationId: OTHER }))
matrix("hrSites saveSite / setSiteActive update", "update", `hrSites/${S1}`, site1(), patch(site1(), { name: "S1b", updatedAt: T, updatedBy: U.hrm }), [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.mgmt, U.emp1, U.stranger])
allow("hrSites saveAttendanceSource / saveSiteShifts (att, shifts) — HR manager", U.hrm, "update", `hrSites/${S1}`, site1(), patch(site1(), { att: { source: "sheet" }, shifts: { on: false }, updatedAt: T, updatedBy: U.hrm }))
deny("hrSites update — type outside the list", U.hrm, "update", `hrSites/${S1}`, site1(), patch(site1(), { type: "garage" }))
deny("hrSites update — move to another company", U.hrm, "update", `hrSites/${S1}`, site1(), patch(site1(), { organizationId: OTHER }))
deny("hrSites update — site's own supervisor", U.sup1, "update", `hrSites/${S1}`, site1(), patch(site1(), { att: { source: "app" } }))
deny("hrSites delete — owner", U.owner, "delete", `hrSites/${S1}`, site1(), undefined)

// ---------------------------------------------------------------------------
// fleetVehicles
// ---------------------------------------------------------------------------

const vehicle: Data = { organizationId: ORG, plate: "ABC 123", kind: "truck", updatedAt: T }
matrix("fleetVehicles get", "get", "fleetVehicles/v1", vehicle, undefined, [U.hrm, U.gov, U.sup1, U.plain, U.emp1], [U.stranger])
matrix("fleetVehicles create", "create", "fleetVehicles/v1", undefined, vehicle, [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.mgmt, U.emp1, U.stranger])
matrix("fleetVehicles update", "update", "fleetVehicles/v1", vehicle, patch(vehicle, { plate: "XYZ 9" }), [U.hrm], [U.gov, U.sup1, U.emp1, U.stranger])
deny("fleetVehicles update — change company", U.hrm, "update", "fleetVehicles/v1", vehicle, patch(vehicle, { organizationId: OTHER }))

// ---------------------------------------------------------------------------
// employees — reads
// ---------------------------------------------------------------------------

matrix("employees get e1 (site1)", "get", "employees/e1", E("e1"), undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1, U.emp1, U.owner, U.star], [U.sup2, U.emp2, U.plain, U.fin, U.inv, U.stranger])
matrix("employees list e1 (site1)", "list", "employees/e1", E("e1"), undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1, U.emp1], [U.sup2, U.emp2, U.plain, U.fin, U.stranger])
matrix("employees get e3 (unassigned)", "get", "employees/e3", E("e3"), undefined, [U.hrm, U.gov, U.pay, U.mgmt], [U.sup1, U.sup2, U.emp1, U.plain])
deny("employees get — unauthenticated", null, "get", "employees/e1", E("e1"), undefined)

// ---------------------------------------------------------------------------
// employees — create (createEmployee) and the first log entry
// ---------------------------------------------------------------------------

matrix("employees create (createEmployee)", "create", "employees/new1", undefined, newEmp(), [U.hrm, U.gov, U.owner, U.star], [U.pay, U.sup1, U.mgmt, U.fin, U.plain, U.emp1, U.stranger])
deny("employees create — carries a salary field", U.hrm, "create", "employees/new1", undefined, newEmp({ salary: 3000 }))
deny("employees create — into another company's id", U.hrm, "create", "employees/new1", undefined, newEmp({ organizationId: OTHER }))
deny("employees create — unauthenticated", null, "create", "employees/new1", undefined, newEmp())
const firstLog = { overrides: { "employees/new1": null }, afterDocs: { "employees/new1": newEmp() } }
allow("employees/log first entry in the creating transaction — HR manager", U.hrm, "create", "employees/new1/log/l1", undefined, logEntry(U.hrm), firstLog)
deny("employees/log first entry — plain member in his own name", U.plain, "create", "employees/new1/log/l1", undefined, logEntry(U.plain), firstLog)
allow("employees/log first entry — government relations creating", U.gov, "create", "employees/new1/log/l1", undefined, logEntry(U.gov), firstLog)
deny("employees/log entry in another person's name", U.hrm, "create", "employees/new1/log/l1", undefined, logEntry(U.gov), firstLog)
deny("employees/log entry into another company's employee", U.stranger, "create", "employees/new1/log/l1", undefined, logEntry(U.stranger), firstLog)

// ---------------------------------------------------------------------------
// employees — updates the client makes
// ---------------------------------------------------------------------------

const e1 = E("e1")
const e3 = E("e3")
matrix("employees assignEmployee (siteId, siteSince, move)", "update", "employees/e3", e3, patch(e3, { siteId: S1, siteSince: today, move: null, updatedAt: T2 }), [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.mgmt, U.fin, U.plain, U.emp1, U.stranger])
matrix("employees assignEmployee scheduled (move)", "update", "employees/e3", e3, patch(e3, { move: { to: S1, on: riyadhDay(5), by: U.hrm, byName: "n", at: T, mr: null }, updatedAt: T2 }), [U.hrm], [U.gov, U.pay, U.sup1, U.mgmt])
allow("employees manpower plan (planned) — HR manager", U.hrm, "update", "employees/e3", e3, patch(e3, { planned: { siteId: S1, on: riyadhDay(5), requestId: "mr1", no: "MP-1" }, updatedAt: T2 }))
allow("employees startWork (status, join, probation)", U.hrm, "update", "employees/e3", patch(e3, { status: "expected" }), patch(e3, { status: "active", join: today, probation: { end: "2027-01-01" }, updatedAt: T2 }))
allow("employees decideProbation (probation)", U.hrm, "update", "employees/e1", e1, patch(e1, { probation: { end: "2026-12-01", decision: "confirmed", decidedOn: today }, updatedAt: T2 }))
deny("employees decideProbation — management", U.mgmt, "update", "employees/e1", e1, patch(e1, { probation: { end: "2026-12-01", decision: "confirmed", decidedOn: today }, updatedAt: T2 }))
allow("employees startExit (status, lastDay, probation)", U.hrm, "update", "employees/e1", e1, patch(e1, { status: "leaving", lastDay: "2026-11-01", updatedAt: T2 }))
allow("employees approveSettlement (status left)", U.hrm, "update", "employees/e1", patch(e1, { status: "leaving" }), patch(e1, { status: "left", updatedAt: T2 }))
allow("employees recordOpeningBalance (openingLeave, opening)", U.hrm, "update", "employees/e1", e1, patch(e1, { openingLeave: 12, opening: { leave: 12, at: T, by: U.hrm, byName: "n" }, updatedAt: T2 }))
allow("employees changePay promotion (trade, category)", U.hrm, "update", "employees/e1", e1, patch(e1, { trade: "foreman", category: "staff", updatedAt: T2 }))
allow("employees setLineManager (managerId)", U.hrm, "update", "employees/e1", e1, patch(e1, { managerId: "e2", updatedAt: T2 }))
allow("employees training certs (certs.x)", U.hrm, "update", "employees/e1", e1, patch(e1, { certs: { safety: "2027-10-01" }, updatedAt: T2 }))
allow("employees review band D (pip)", U.hrm, "update", "employees/e1", e1, patch(e1, { pip: { until: "2026-12-01", by: U.hrm, byName: "n", cycleId: "c1" }, updatedAt: T2 }))
allow("employees assignment correction decided (siteId only)", U.hrm, "update", "employees/e3", e3, patch(e3, { siteId: S2, updatedAt: T2 }))
allow("employees applyPlannedMove (planned cleared)", U.hrm, "update", "employees/e1", patch(e1, { planned: { siteId: S2, on: today, requestId: "m", no: "1" } }), patch(e1, { siteId: S2, siteSince: today, planned: null, updatedAt: T2 }))
allow("employees tickOnboarding by government relations (onb)", U.gov, "update", "employees/e1", e1, patch(e1, { onb: { qiwa: stampOf(U.gov) }, updatedAt: T2 }))
allow("employees recordRenewal by government relations (docs.iqama)", U.gov, "update", "employees/e1", e1, patch(e1, { docs: { iqama: "2028-01-01" }, updatedAt: T2 }))
allow("employees recordDocNumbers by government relations (docs.no)", U.gov, "update", "employees/e1", e1, patch(e1, { docs: { no: { passport: "P1" } }, updatedAt: T2 }))
allow("employees Muqeem reconciliation takes the iqama date (gov)", U.gov, "update", "employees/e1", e1, patch(e1, { docs: { iqama: "2028-02-02" }, updatedAt: T2 }))
deny("employees government relations changes status", U.gov, "update", "employees/e1", e1, patch(e1, { status: "left", updatedAt: T2 }))
deny("employees government relations assigns a site", U.gov, "update", "employees/e1", e1, patch(e1, { siteId: S2, updatedAt: T2 }))
deny("employees government relations writes the pay-linked userId", U.gov, "update", "employees/e1", e1, patch(e1, { userId: U.gov, updatedAt: T2 }))
deny("employees payroll renewal (docs)", U.pay, "update", "employees/e1", e1, patch(e1, { docs: { iqama: "2028-01-01" }, updatedAt: T2 }))
deny("employees no-change of permanent number", U.hrm, "update", "employees/e1", e1, patch(e1, { no: 99, updatedAt: T2 }))
deny("employees move to another company", U.hrm, "update", "employees/e1", e1, patch(e1, { organizationId: OTHER, updatedAt: T2 }))
deny("employees add salary field", U.hrm, "update", "employees/e1", e1, patch(e1, { salary: 5000, updatedAt: T2 }))
deny("employees update — other company's HR manager", U.stranger, "update", "employees/e1", e1, patch(e1, { siteId: S2, updatedAt: T2 }))
deny("employees update — unauthenticated", null, "update", "employees/e1", e1, patch(e1, { siteId: S2, updatedAt: T2 }))
const attPatch = (b: Data, extra: Data = {}) => patch(b, { att: { month: M, days: {}, closed: false }, updatedAt: T2, ...extra })
matrix("employees att projection (recordDay/declareMissing/closeMonth) on e1 (site1)", "update", "employees/e1", e1, attPatch(e1), [U.sup1, U.pay, U.hrm], [U.sup2, U.gov, U.mgmt, U.emp1, U.plain, U.stranger])
matrix("employees att projection on e3 (unassigned)", "update", "employees/e3", e3, attPatch(e3), [U.pay, U.hrm], [U.sup1, U.sup2, U.gov])
deny("employees att projection with a status change", U.sup1, "update", "employees/e1", e1, attPatch(e1, { status: "left" }))
const shiftPatch = patch(e1, { shift: { id: "a", from: today, prev: null }, updatedAt: T2 })
matrix("employees setEmployeeShift on e1", "update", "employees/e1", e1, shiftPatch, [U.sup1, U.hrm], [U.pay, U.sup2, U.gov, U.mgmt, U.emp1])
allow("employees saveSiteShifts clears shifts (shift null) — HR manager", U.hrm, "update", "employees/e1", patch(e1, { shift: { id: "a" } }), patch(e1, { shift: null, updatedAt: T2 }))
const hrmEmp = E("ehm")
allow("employees management applies the HR manager's own leave effects", U.mgmt, "update", "employees/ehm", hrmEmp, patch(hrmEmp, { leaveTaken: 3, updatedAt: T2 }))
allow("employees management applies the HR manager's sick/hajj effects", U.mgmt, "update", "employees/ehm", hrmEmp, patch(hrmEmp, { sick: { year: 1, days: 3 }, hajjTaken: true, updatedAt: T2 }))
allow("employees management applies the HR manager's data update (contact)", U.mgmt, "update", "employees/ehm", hrmEmp, patch(hrmEmp, { contact: { phone: "05" }, updatedAt: T2 }))
deny("employees management changes the HR manager's status", U.mgmt, "update", "employees/ehm", hrmEmp, patch(hrmEmp, { status: "left", updatedAt: T2 }))
allow("OBS employees management may also change an ORDINARY employee's leaveTaken (rule is not limited to the HR manager's record)", U.mgmt, "update", "employees/e1", e1, patch(e1, { leaveTaken: 99, updatedAt: T2 }))
// data update (ES-03): approved leave effects by HR manager on any record
allow("employees decideRequest data update (contact.x) — HR manager", U.hrm, "update", "employees/e1", e1, patch(e1, { contact: { phone: "05" }, updatedAt: T2 }))
// linking a user
allow("employees linkUser — HR manager links a free record to a user", U.hrm, "update", "employees/e3", e3, patch(e3, { userId: U.plain, updatedAt: T2 }))
deny("employees linkUser — HR manager links the record to HIMSELF", U.hrm, "update", "employees/e3", e3, patch(e3, { userId: U.hrm, updatedAt: T2 }))
deny("employees linkUser — HR manager unlinks HIMSELF from his own record", U.hrm, "update", "employees/ehm", hrmEmp, patch(hrmEmp, { userId: null, updatedAt: T2 }))
allow("employees linkUser — owner links himself", U.owner, "update", "employees/e3", e3, patch(e3, { userId: U.owner, updatedAt: T2 }))
// line manager's probation view
const withMgr = { overrides: { "employees/emgr": { organizationId: ORG, no: 9, userId: U.plain, siteId: null, status: "active", names: { ar: "g" } }, "employees/e1": patch(e1, { managerId: "emgr" }) } }
const probView = { rating: 2, recommend: "confirm", note: null }
allow("employees recordProbationView — site supervisor in his own name", U.sup1, "update", "employees/e1", e1, patch(e1, { probationView: { by: U.sup1, byName: "n", at: T, ...probView }, updatedAt: T2 }))
deny("employees recordProbationView — supervisor of ANOTHER site", U.sup2, "update", "employees/e1", e1, patch(e1, { probationView: { by: U.sup2, byName: "n", at: T, ...probView }, updatedAt: T2 }))
allow("employees recordProbationView — the line manager named on the card (no HR role)", U.plain, "update", "employees/e1", patch(e1, { managerId: "emgr" }), patch(e1, { managerId: "emgr", probationView: { by: U.plain, byName: "n", at: T, ...probView }, updatedAt: T2 }), withMgr)
deny("employees recordProbationView — a member who is not the line manager", U.emp2, "update", "employees/e1", patch(e1, { managerId: "emgr" }), patch(e1, { managerId: "emgr", probationView: { by: U.emp2, byName: "n", at: T, ...probView }, updatedAt: T2 }), withMgr)
deny("employees recordProbationView — view signed by someone else", U.sup1, "update", "employees/e1", e1, patch(e1, { probationView: { by: U.sup2, byName: "n", at: T, ...probView }, updatedAt: T2 }))
// the employee himself: withdraw an approved leave (LV-07)
const approvedLeave = { organizationId: ORG, kind: "leave", employeeId: "e1", employeeUserId: U.emp1, state: "approved", leave: { type: "annual", from: riyadhDay(10), to: riyadhDay(12), fromBalance: 3 } }
const undoOv = { overrides: { "hrRequests/r1": approvedLeave }, afterDocs: { "hrRequests/r1": { ...approvedLeave, state: "cancelled" } } }
allow("employees LV-07 employee withdraws his own approved leave (leaveTaken back, undo)", U.emp1, "update", "employees/e1", e1, patch(e1, { leaveTaken: 2, undo: "r1", updatedAt: T2 }), undoOv)
deny("employees LV-07 — wrong number of days returned", U.emp1, "update", "employees/e1", e1, patch(e1, { leaveTaken: 0, undo: "r1", updatedAt: T2 }), undoOv)
deny("employees LV-07 — request not cancelled in the same write", U.emp1, "update", "employees/e1", e1, patch(e1, { leaveTaken: 2, undo: "r1", updatedAt: T2 }), { overrides: undoOv.overrides, afterDocs: { "hrRequests/r1": approvedLeave } })
deny("employees LV-07 — request belongs to another employee", U.emp1, "update", "employees/e1", e1, patch(e1, { leaveTaken: 2, undo: "r1", updatedAt: T2 }), { overrides: { "hrRequests/r1": { ...approvedLeave, employeeId: "e2" } }, afterDocs: { "hrRequests/r1": { ...approvedLeave, employeeId: "e2", state: "cancelled" } } })
deny("employees LV-07 — someone else's record", U.emp2, "update", "employees/e1", e1, patch(e1, { leaveTaken: 2, undo: "r1", updatedAt: T2 }), undoOv)
deny("employees employee raises his own leaveTaken without an undo", U.emp1, "update", "employees/e1", e1, patch(e1, { leaveTaken: 0, updatedAt: T2 }))
deny("employees employee edits his own status", U.emp1, "update", "employees/e1", e1, patch(e1, { status: "left", updatedAt: T2 }))
deny("employees employee edits his own site", U.emp1, "update", "employees/e1", e1, patch(e1, { siteId: S2, updatedAt: T2 }))
deny("employees employee sets his own openingLeave", U.emp1, "update", "employees/e1", e1, patch(e1, { openingLeave: 500, updatedAt: T2 }))
deny("employees delete — owner", U.owner, "delete", "employees/e1", e1, undefined)

// ---------------------------------------------------------------------------
// employees/log and employees/files
// ---------------------------------------------------------------------------

const l = logEntry(U.hrm, "moved")
const logRead = ["hrm", "gov", "pay", "mgmt"].map((k) => U[k as keyof typeof U])
matrix("employees/log read (e1, site1)", "get", "employees/e1/log/l1", l, undefined, [...logRead, U.sup1, U.emp1, U.owner], [U.sup2, U.emp2, U.plain, U.fin, U.stranger])
allow("employees/log append on an existing record — HR manager", U.hrm, "create", "employees/e1/log/l1", undefined, logEntry(U.hrm, "moved"))
deny("employees/log append — other company's user in his own name", U.stranger, "create", "employees/e1/log/l1", undefined, logEntry(U.stranger, "moved"))
deny("employees/log append — plain member who is not the employee", U.plain, "create", "employees/e1/log/l1", undefined, logEntry(U.plain, "moved"))
deny("employees/log append — another employee", U.emp2, "create", "employees/e1/log/l1", undefined, logEntry(U.emp2, "moved"))
allow("employees/log append — supervisor (violation_recorded, shift_changed)", U.sup1, "create", "employees/e1/log/l1", undefined, logEntry(U.sup1, "violation_recorded"))
allow("employees/log append — payroll", U.pay, "create", "employees/e1/log/l1", undefined, logEntry(U.pay, "iban_fixed"))
allow("employees/log append — management (review_approved)", U.mgmt, "create", "employees/e1/log/l1", undefined, logEntry(U.mgmt, "review_approved"))
allow("employees/log append — the employee himself (request filed)", U.emp1, "create", "employees/e1/log/l1", undefined, logEntry(U.emp1, "leave_filed"))
allow("OBS employees/log append — supervisor of ANOTHER site writes on e1's log (rule only checks hrStaff)", U.sup2, "create", "employees/e1/log/l1", undefined, logEntry(U.sup2, "violation_recorded"))
deny("employees/log append — finance member (no HR role)", U.fin, "create", "employees/e1/log/l1", undefined, logEntry(U.fin))
deny("employees/log append — in another's name", U.hrm, "create", "employees/e1/log/l1", undefined, logEntry(U.gov))
deny("employees/log edit — HR manager", U.hrm, "update", "employees/e1/log/l1", l, patch(l, { kind: "x" }))
deny("employees/log delete — owner", U.owner, "delete", "employees/e1/log/l1", l, undefined)

const file: Data = { organizationId: ORG, employeeId: "e1", kind: "bank", name: "iban.pdf", path: `organizations/${ORG}/hr/employees/e1/f1.pdf`, size: 10, contentType: "application/pdf", by: U.hrm, byName: "n", at: T, note: null }
matrix("employees/files read (e1)", "get", "employees/e1/files/f1", file, undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.emp1], [U.sup1, U.sup2, U.emp2, U.plain, U.fin, U.stranger])
matrix("employees/files attach (attachEmployeeFile)", "create", "employees/e1/files/f1", undefined, (uid) => patch(file, { by: uid }), [U.hrm, U.gov], [U.pay, U.sup1, U.mgmt, U.emp1, U.stranger])
deny("employees/files attach — path outside the employee's folder", U.hrm, "create", "employees/e1/files/f1", undefined, patch(file, { path: `organizations/${ORG}/hr/employees/e2/f1.pdf` }))
deny("employees/files attach — another company's folder", U.hrm, "create", "employees/e1/files/f1", undefined, patch(file, { path: `organizations/${OTHER}/hr/employees/e1/f1.pdf` }))
deny("employees/files attach — names another employee", U.hrm, "create", "employees/e1/files/f1", undefined, patch(file, { employeeId: "e2" }))
deny("employees/files attach — in another's name", U.hrm, "create", "employees/e1/files/f1", undefined, patch(file, { by: U.gov }))
deny("employees/files edit", U.hrm, "update", "employees/e1/files/f1", file, patch(file, { name: "x" }))
deny("employees/files delete", U.owner, "delete", "employees/e1/files/f1", file, undefined)
// the HR manager files the bank letter while approving a data request (decideRequest)
allow("employees/files attach on approving a data request — HR manager", U.hrm, "create", "employees/e1/files/f9", undefined, patch(file, { note: "HQ-2026/001" }))

// ---------------------------------------------------------------------------
// employeePay
// ---------------------------------------------------------------------------

const pay1 = P("e1")
const pay2 = P("e2")
const payHm = P("ehm")
matrix("employeePay get (e2)", "get", "employeePay/e2", pay2, undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.emp2, U.owner], [U.gov, U.sup1, U.sup2, U.emp1, U.plain, U.inv, U.stranger])
deny("employeePay get — unauthenticated", null, "get", "employeePay/e2", pay2, undefined)
matrix("employeePay get a record that does not exist yet (first wage)", "get", "employeePay/e3", undefined, undefined, [U.hrm, U.pay, U.mgmt, U.fin], [U.gov, U.sup1, U.emp1, U.plain])
matrix("employeePay list", "list", "employeePay/e2", pay2, undefined, [U.hrm, U.pay, U.mgmt], [U.gov, U.sup1, U.fin, U.emp2, U.plain, U.stranger])
matrix("employeePay create (createEmployee with a wage)", "create", "employeePay/new1", undefined, { organizationId: ORG, employeeId: "new1", basic: 3000, housing: 750, transport: 300, iban: null, bank: null, ibanState: null, advance: null, retro: [], updatedAt: T }, [U.hrm, U.owner], [U.gov, U.pay, U.mgmt, U.fin, U.sup1, U.emp1, U.stranger], { overrides: { "employees/new1": newEmp() } })
deny("employeePay create — into another company", U.hrm, "create", "employeePay/new1", undefined, { organizationId: OTHER, employeeId: "new1", basic: 3000, updatedAt: T })

const changePay2 = patch(pay2, { basic: 3300, housing: 825, transport: 330, steps: [{ from: "2026-10-01", basic: 3300 }], retro: [], updatedAt: T2 })
matrix("employeePay changePay on e2", "update", "employeePay/e2", pay2, changePay2, [U.hrm, U.owner], [U.pay, U.gov, U.sup1, U.emp2, U.fin, U.plain, U.stranger])
deny("employeePay changePay by management on an ORDINARY employee", U.mgmt, "update", "employeePay/e2", pay2, changePay2)
deny("employeePay changePay on HIS OWN record by the HR manager", U.hrm, "update", "employeePay/ehm", payHm, patch(payHm, { basic: 12000, steps: [{ from: "2026-10-01" }], updatedAt: T2 }))
allow("employeePay changePay on the HR manager's record by management (EM-04, RL-02)", U.mgmt, "update", "employeePay/ehm", payHm, patch(payHm, { basic: 12000, housing: 3000, transport: 1200, steps: [{ from: "2026-10-01" }], retro: [], updatedAt: T2 }))
deny("employeePay management changes the HR manager's record — plus an iban", U.mgmt, "update", "employeePay/ehm", payHm, patch(payHm, { basic: 12000, iban: "SA1", updatedAt: T2 }))
deny("employeePay management changes pay of a record whose user is NOT an HR manager", U.mgmt, "update", "employeePay/e1", pay1, patch(pay1, { basic: 5000, steps: [{ from: "2026-10-01" }], updatedAt: T2 }))
allow("employeePay applyRaises (performance) on an ordinary record — HR manager", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { basic: 3300, housing: 825, transport: 330, steps: [{ from: "2026-11-01" }], updatedAt: T2 }))
allow("employeePay applyRaises on the HR manager's record — management", U.mgmt, "update", "employeePay/ehm", payHm, patch(payHm, { basic: 9900, housing: 2475, transport: 990, steps: [{ from: "2026-11-01" }], updatedAt: T2 }))
allow("employeePay recordCommission (commissions) — HR manager on another's record", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { commissions: [{ id: "x", month: "2026-09", amount: 500, reason: "q", at: T, by: U.hrm }], updatedAt: T2 }))
deny("employeePay recordCommission on HIS OWN record", U.hrm, "update", "employeePay/ehm", payHm, patch(payHm, { commissions: [{ id: "x", month: "2026-09", amount: 500 }], updatedAt: T2 }))
allow("employeePay recordOpeningBalance advance — HR manager", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { advance: { amount: 600, balance: 600, instalment: 300 }, updatedAt: T2 }))
allow("employeePay decideRequest approves an advance (merge set) — HR manager", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { advance: { amount: 600, balance: 600, instalment: 300 }, updatedAt: T2 }))
allow("employeePay approvePayroll takes an instalment / clears retro / settlement clears the advance", U.hrm, "update", "employeePay/e2", patch(pay2, { advance: { amount: 600, balance: 600, instalment: 300 }, retro: [{ id: "a" }] }), patch(pay2, { advance: { amount: 600, balance: 300, instalment: 300 }, retro: [], updatedAt: T2 }))
allow("employeePay approvePayroll on the HR manager's OWN record (advance/retro/slip only)", U.hrm, "update", "employeePay/ehm", payHm, patch(payHm, { advance: null, retro: [], slip: { month: PM }, updatedAt: T2 }))
allow("employeePay projectSlips (slip) — HR manager", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { slip: { month: PM, state: "finance" }, updatedAt: T2 }))
deny("employeePay slip written by payroll", U.pay, "update", "employeePay/e2", pay2, patch(pay2, { slip: { month: PM }, updatedAt: T2 }))
deny("employeePay slip written by finance", U.fin, "update", "employeePay/e2", pay2, patch(pay2, { slip: { month: PM }, updatedAt: T2 }))
allow("employeePay Qiwa documented basic (qiwaBasic) — HR manager", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { qiwaBasic: 3000, qiwaAt: T, updatedAt: T2 }))
const fixed = patch(pay2, { iban: "SA0000000000000000000001", ibanState: "fixed", ibanFixedBy: U.pay, updatedAt: T2 })
allow("employeePay fixIban — payroll officer", U.pay, "update", "employeePay/e2", pay2, fixed)
deny("employeePay fixIban — payroll names someone else as the fixer", U.pay, "update", "employeePay/e2", pay2, patch(fixed, { ibanFixedBy: U.hrm }))
deny("employeePay fixIban — also changes the wage", U.pay, "update", "employeePay/e2", pay2, patch(fixed, { basic: 9999 }))
deny("employeePay fixIban — state ok straight away", U.pay, "update", "employeePay/e2", pay2, patch(fixed, { ibanState: "ok" }))
deny("employeePay fixIban — government relations", U.gov, "update", "employeePay/e2", pay2, fixed)
allow("employeePay fixIban — owner (no payroll officer)", U.owner, "update", "employeePay/e2", pay2, patch(fixed, { ibanFixedBy: U.owner }))
const fixedBefore = patch(pay2, { iban: "SA0000000000000000000001", ibanState: "fixed", ibanFixedBy: U.pay })
allow("employeePay approveIban — a DIFFERENT hand (HR manager)", U.hrm, "update", "employeePay/e2", fixedBefore, patch(fixedBefore, { ibanState: "ok", updatedAt: T2 }))
deny("employeePay approveIban — the same hand that fixed it", U.hrm, "update", "employeePay/e2", patch(fixedBefore, { ibanFixedBy: U.hrm }), patch(fixedBefore, { ibanFixedBy: U.hrm, ibanState: "ok", updatedAt: T2 }))
allow("employeePay approveIban — owner who fixed it himself (flagged)", U.owner, "update", "employeePay/e2", patch(fixedBefore, { ibanFixedBy: U.owner }), patch(fixedBefore, { ibanFixedBy: U.owner, ibanState: "ok", updatedAt: T2 }))
deny("employeePay approveIban — payroll", U.pay, "update", "employeePay/e2", fixedBefore, patch(fixedBefore, { ibanState: "ok", updatedAt: T2 }))
const ibanOkHm = patch(payHm, { iban: "SA0000000000000000000009", ibanState: "ok", updatedAt: T2 })
allow("employeePay data update of the HR manager's IBAN approved by management", U.mgmt, "update", "employeePay/ehm", payHm, ibanOkHm)
deny("employeePay HR manager approves HIS OWN iban data update (iban key outside advance/retro/slip)", U.hrm, "update", "employeePay/ehm", payHm, ibanOkHm)
allow("employeePay decideRequest IBAN data update (merge set) — HR manager on another's record", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { iban: "SA0000000000000000000002", ibanState: "ok", updatedAt: T2 }))
allow("employeePay fin:RETURNED — Finance marks the IBAN returned", U.fin, "update", "employeePay/e2", pay2, patch(pay2, { ibanState: "returned", updatedAt: T2 }))
deny("employeePay Finance sets any other ibanState", U.fin, "update", "employeePay/e2", pay2, patch(pay2, { ibanState: "ok", updatedAt: T2 }))
deny("employeePay Finance changes the wage", U.fin, "update", "employeePay/e2", pay2, patch(pay2, { basic: 1, ibanState: "returned", updatedAt: T2 }))
allow("employeePay financeDecideAdvance approves (merge set advance) — Finance", U.fin, "update", "employeePay/e2", pay2, patch(pay2, { advance: { amount: 6000, balance: 6000, instalment: 1500 }, updatedAt: T2 }))
deny("employeePay Finance advance on his own wage (n/a): payroll writes advance", U.pay, "update", "employeePay/e2", pay2, patch(pay2, { advance: { amount: 1, balance: 1, instalment: 1 }, updatedAt: T2 }))
allow("employeePay management approves the HR manager's advance", U.mgmt, "update", "employeePay/ehm", payHm, patch(payHm, { advance: { amount: 900, balance: 900, instalment: 300 }, updatedAt: T2 }))
deny("employeePay another company", U.stranger, "update", "employeePay/e2", pay2, changePay2)
deny("employeePay move to another company", U.hrm, "update", "employeePay/e2", pay2, patch(pay2, { organizationId: OTHER, updatedAt: T2 }))
deny("employeePay supervisor", U.sup1, "update", "employeePay/e1", pay1, patch(pay1, { advance: null, updatedAt: T2 }))
deny("employeePay employee changes own wage", U.emp1, "update", "employeePay/e1", pay1, patch(pay1, { basic: 99999, updatedAt: T2 }))
deny("employeePay delete — owner", U.owner, "delete", "employeePay/e2", pay2, undefined)

// ---------------------------------------------------------------------------
// hrAttendance
// ---------------------------------------------------------------------------

const attId = (site: string, month: string) => `hrAttendance/${ORG}__${site}__${month}`
const attDoc = (site: string, month: string, over: Data = {}): Data => ({ organizationId: ORG, siteId: site, month, days: {}, declarations: [], closed: null, ...over })
const sheetOf = (by: string, over: Data = {}): Data => ({ by, byName: "n", at: T, listed: ["e1"], ex: {}, unlisted: [], ...over })
const day2 = `${M}-02`
const closedMark = { by: U.hrm, byName: "n", at: T, asIs: false, missing: [] }
const att1 = attDoc(S1, M)
const att1Rec = attDoc(S1, M, { days: { [day2]: sheetOf(U.sup1, { ex: { e1: { status: "abs" } } }) } })

matrix("hrAttendance get (site1)", "get", attId(S1, M), att1, undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1, U.owner], [U.sup2, U.emp1, U.plain, U.fin, U.stranger])
matrix("hrAttendance get a month that does not exist yet", "get", attId(S1, M), undefined, undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1, U.sup2], [U.emp1, U.plain, U.fin])
matrix("hrAttendance list", "list", attId(S1, M), att1, undefined, [U.hrm, U.gov, U.pay, U.mgmt], [U.sup1, U.emp1, U.stranger])
deny("hrAttendance get — unauthenticated", null, "get", attId(S1, M), att1, undefined)

const firstSheet = (by: string) => attDoc(S1, M, { days: { [day2]: sheetOf(by) }, updatedAt: T })
matrix("hrAttendance recordDay — first sheet of the month (create)", "create", attId(S1, M), undefined, (uid) => firstSheet(uid), [U.hrm, U.pay, U.sup1, U.owner], [U.sup2, U.gov, U.mgmt, U.fin, U.emp1, U.plain, U.stranger])
deny("hrAttendance create — document id does not match site+month", U.hrm, "create", attId(S2, M), undefined, firstSheet(U.hrm))
deny("hrAttendance create — id names the wrong company", U.hrm, "create", `hrAttendance/${OTHER}__${S1}__${M}`, undefined, firstSheet(U.hrm))
const firstDecl = attDoc(S1, M, { declarations: [{ days: [day2], employees: ["e1"], ack: true, by: U.sup1, byName: "n", at: T, note: "x" }], updatedAt: T })
allow("hrAttendance declareMissing — first document of the month by the supervisor", U.sup1, "create", attId(S1, M), undefined, firstDecl)
deny("hrAttendance declareMissing — payroll cannot declare", U.pay, "create", attId(S1, M), undefined, patch(firstDecl, { declarations: [{ days: [day2], employees: ["e1"], ack: true, by: U.pay, byName: "n", at: T, note: "x" }] }))
const closedNew = attDoc(S1, PM, { closed: closedMark, updatedAt: T })
matrix("hrAttendance closeMonth — month with no document, ended (create)", "create", attId(S1, PM), undefined, closedNew, [U.hrm, U.pay, U.sup1], [U.sup2, U.gov, U.mgmt])
deny("hrAttendance closeMonth — current month not over", U.hrm, "create", attId(S1, M), undefined, attDoc(S1, M, { closed: closedMark, updatedAt: T }))

const addDay = (b: Data, by: string): Data => patch(b, { days: { ...(b.days as Data), [`${M}-03`]: sheetOf(by) }, updatedAt: T2 })
matrix("hrAttendance recordDay — add a day to the month", "update", attId(S1, M), att1Rec, (uid) => addDay(att1Rec, uid), [U.hrm, U.pay, U.sup1, U.owner], [U.sup2, U.gov, U.mgmt, U.fin, U.emp1, U.stranger])
deny("hrAttendance update — a recorded day is locked (overwrite)", U.sup1, "update", attId(S1, M), att1Rec, patch(att1Rec, { days: { [day2]: sheetOf(U.sup1, { ex: {} }) }, updatedAt: T2 }))
deny("hrAttendance update — HR manager overwrites a recorded day", U.hrm, "update", attId(S1, M), att1Rec, patch(att1Rec, { days: { [day2]: sheetOf(U.hrm, { ex: {} }) }, updatedAt: T2 }))
deny("hrAttendance update — delete a recorded day", U.hrm, "update", attId(S1, M), att1Rec, patch(att1Rec, { days: {}, updatedAt: T2 }))
const closedDoc = attDoc(S1, PM, { days: { [`${PM}-02`]: sheetOf(U.sup1) }, closed: closedMark })
for (const uid of [U.hrm, U.owner, U.sup1, U.pay, U.star]) {
  deny(`hrAttendance CLOSED month — add a day — ${nameOf(uid)}`, uid, "update", attId(S1, PM), closedDoc, patch(closedDoc, { days: { ...(closedDoc.days as Data), [`${PM}-03`]: sheetOf(uid) }, updatedAt: T2 }))
  deny(`hrAttendance CLOSED month — declaration — ${nameOf(uid)}`, uid, "update", attId(S1, PM), closedDoc, patch(closedDoc, { declarations: [{ days: [`${PM}-05`], employees: ["e1"], ack: true, by: uid, byName: "n", at: T, note: "x" }], updatedAt: T2 }))
  deny(`hrAttendance CLOSED month — closing again — ${nameOf(uid)}`, uid, "update", attId(S1, PM), closedDoc, patch(closedDoc, { closed: { ...closedMark, by: uid }, updatedAt: T2 }))
}
deny("hrAttendance CLOSED month — punch import (pd) after the closing", U.sup1, "update", attId(S1, PM), closedDoc, patch(closedDoc, { pd: { [`${PM}-03`]: { e1: { in: "07:00" } } }, imports: [{ by: U.sup1 }], updatedAt: T2 }))
deny("hrAttendance update — change the month", U.hrm, "update", attId(S1, M), att1Rec, patch(att1Rec, { month: "2026-11", updatedAt: T2 }))
deny("hrAttendance update — change the site", U.hrm, "update", attId(S1, M), att1Rec, patch(att1Rec, { siteId: S2, updatedAt: T2 }))
deny("hrAttendance update — change the company", U.hrm, "update", attId(S1, M), att1Rec, patch(att1Rec, { organizationId: OTHER, updatedAt: T2 }))
allow("hrAttendance punch import / fixPunch (pd, pdx, xs, imports) — supervisor on his site", U.sup1, "update", attId(S1, M), att1Rec, patch(att1Rec, { pd: { [`${M}-03`]: { e1: { in: "07:00" } } }, xs: {}, imports: [{ by: U.sup1 }], updatedAt: T2 }))
allow("hrAttendance punch import — payroll", U.pay, "update", attId(S1, M), att1Rec, patch(att1Rec, { pd: { [`${M}-03`]: { e1: { in: "07:00" } } }, imports: [{ by: U.pay }], updatedAt: T2 }))
deny("hrAttendance punch import — supervisor of another site", U.sup2, "update", attId(S1, M), att1Rec, patch(att1Rec, { pd: {}, imports: [], updatedAt: T2 }))

const decl = (by: string, over: Data = {}) => ({ days: [`${M}-05`], employees: ["e1"], ack: true, by, byName: "n", at: T, note: "x", ...over })
const oneDecl = patch(att1Rec, { declarations: [decl(U.sup1)] })
matrix("hrAttendance declareMissing — append ONE declaration", "update", attId(S1, M), att1Rec, (uid) => patch(att1Rec, { declarations: [decl(uid)], updatedAt: T2 }), [U.hrm, U.sup1, U.owner], [U.pay, U.sup2, U.gov, U.mgmt, U.emp1])
deny("hrAttendance declareMissing — appended entry in someone else's name", U.sup1, "update", attId(S1, M), att1Rec, patch(att1Rec, { declarations: [decl(U.hrm)], updatedAt: T2 }))
deny("hrAttendance declareMissing — two entries at once", U.sup1, "update", attId(S1, M), att1Rec, patch(att1Rec, { declarations: [decl(U.sup1), decl(U.sup1, { days: [`${M}-06`] })], updatedAt: T2 }))
deny("hrAttendance declareMissing — rewrite an earlier declaration", U.sup1, "update", attId(S1, M), oneDecl, patch(oneDecl, { declarations: [decl(U.sup1, { note: "changed" }), decl(U.sup1, { days: [`${M}-06`] })], updatedAt: T2 }))
deny("hrAttendance declareMissing — remove a declaration", U.hrm, "update", attId(S1, M), oneDecl, patch(oneDecl, { declarations: [], updatedAt: T2 }))
allow("hrAttendance declareMissing — second declaration appended", U.sup1, "update", attId(S1, M), oneDecl, patch(oneDecl, { declarations: [decl(U.sup1), decl(U.sup1, { days: [`${M}-06`] })], updatedAt: T2 }))

const pastDoc = attDoc(S1, PM, { days: { [`${PM}-02`]: sheetOf(U.sup1) } })
matrix("hrAttendance closeMonth — month ended", "update", attId(S1, PM), pastDoc, (uid) => patch(pastDoc, { closed: { ...closedMark, by: uid }, updatedAt: T2 }), [U.hrm, U.pay, U.sup1], [U.sup2, U.gov, U.mgmt, U.emp1])
deny("hrAttendance closeMonth — current month still running", U.hrm, "update", attId(S1, M), att1Rec, patch(att1Rec, { closed: closedMark, updatedAt: T2 }))
// PT-07 — an approved attendance correction changes ONE worker's entry on a recorded day
const fixBefore = attDoc(S1, M, { days: { [day2]: sheetOf(U.sup1, { listed: ["e1", "e2"], ex: { e1: { status: "abs" }, e2: { status: "sick" } } }) } })
const fixAfter = (over: Data = {}) => patch(fixBefore, { days: { [day2]: sheetOf(U.sup1, { listed: ["e1", "e2"], ex: { e2: { status: "sick" } } }) }, fixReq: "rq1", updatedAt: T2, ...over })
const fixReqDoc = (by: string, over: Data = {}) => ({ organizationId: ORG, kind: "attfix", state: "approved", decision: { by, byName: "n", at: T, note: null }, siteId: S1, employeeId: "e1", attfix: { type: "abs", day: day2, reason: "x" }, ...over })
for (const uid of [U.sup1, U.hrm]) allow(`hrAttendance PT-07 approved correction removes one worker's absence — ${nameOf(uid)}`, uid, "update", attId(S1, M), fixBefore, fixAfter(), { overrides: { "hrRequests/rq1": fixReqDoc(uid) }, afterDocs: { "hrRequests/rq1": fixReqDoc(uid) } })
deny("hrAttendance PT-07 — request is not approved in the same write", U.sup1, "update", attId(S1, M), fixBefore, fixAfter(), { afterDocs: { "hrRequests/rq1": fixReqDoc(U.sup1, { state: "pending" }) } })
deny("hrAttendance PT-07 — decision recorded under another user", U.sup1, "update", attId(S1, M), fixBefore, fixAfter(), { afterDocs: { "hrRequests/rq1": fixReqDoc(U.hrm) } })
deny("hrAttendance PT-07 — request for another workplace", U.sup1, "update", attId(S1, M), fixBefore, fixAfter(), { afterDocs: { "hrRequests/rq1": fixReqDoc(U.sup1, { siteId: S2 }) } })
deny("hrAttendance PT-07 — write also changes another worker's entry", U.sup1, "update", attId(S1, M), fixBefore, patch(fixBefore, { days: { [day2]: sheetOf(U.sup1, { listed: ["e1", "e2"], ex: {} }) }, fixReq: "rq1", updatedAt: T2 }), { afterDocs: { "hrRequests/rq1": fixReqDoc(U.sup1) } })
deny("hrAttendance PT-07 — write also changes another day", U.sup1, "update", attId(S1, M), fixBefore, fixAfter({ days: { [day2]: sheetOf(U.sup1, { listed: ["e1", "e2"], ex: { e2: { status: "sick" } } }), [`${M}-04`]: sheetOf(U.sup1) } }), { afterDocs: { "hrRequests/rq1": fixReqDoc(U.sup1) } })
deny("hrAttendance PT-07 — correction names a different day", U.sup1, "update", attId(S1, M), fixBefore, fixAfter(), { afterDocs: { "hrRequests/rq1": fixReqDoc(U.sup1, { attfix: { type: "abs", day: `${M}-09`, reason: "x" } }) } })
deny("hrAttendance PT-07 — no fixReq at all", U.sup1, "update", attId(S1, M), fixBefore, patch(fixBefore, { days: { [day2]: sheetOf(U.sup1, { listed: ["e1", "e2"], ex: { e2: { status: "sick" } } }) }, updatedAt: T2 }))
deny("hrAttendance PT-07 — correction of a CLOSED month", U.sup1, "update", attId(S1, M), patch(fixBefore, { closed: closedMark }), fixAfter(), { afterDocs: { "hrRequests/rq1": fixReqDoc(U.sup1) } })
deny("hrAttendance delete — owner", U.owner, "delete", attId(S1, M), att1Rec, undefined)

// ---------------------------------------------------------------------------
// hrRequests
// ---------------------------------------------------------------------------

const reqBase = (over: Data = {}): Data => ({
  organizationId: ORG, kind: "leave", employeeId: "e1", employeeUserId: U.emp1, employeeName: "a", siteId: S1, lineManagerId: null, lineManagerUserId: null, deciderLevel: "manager",
  filedBy: { by: U.emp1, byName: "a", at: T, note: null }, onBehalf: false, state: "pending", createdAt: T, no: "LV-2026/001",
  leave: { type: "annual", from: riyadhDay(10), to: riyadhDay(12), days: 3, balance: 20, fromBalance: 3, unpaidDays: 0, travel: false, sick: null, note: null }, updatedAt: T, ...over,
})
const advBody = { advance: { amount: 600, reason: "r", instalment: 300, months: 2, overLimit: false } }
const filedBy = (uid: string) => ({ by: uid, byName: "n", at: T, note: null })

// reads
const leaveReq = reqBase()
const advReq = reqBase({ kind: "advance", leave: undefined, ...advBody, no: "AD-2026/001" })
delete (advReq as Data).leave
const dataReq = reqBase({ kind: "data", data: { field: "phone", value: "05" }, no: "HQ-2026/001" })
delete (dataReq as Data).leave
matrix("hrRequests get a LEAVE of e1 (site1)", "get", "hrRequests/r1", leaveReq, undefined, [U.hrm, U.pay, U.mgmt, U.gov, U.sup1, U.emp1, U.owner], [U.sup2, U.emp2, U.fin, U.plain, U.inv, U.stranger])
matrix("hrRequests get an ADVANCE of e1", "get", "hrRequests/r1", advReq, undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.emp1], [U.gov, U.sup1, U.sup2, U.emp2, U.plain, U.stranger])
matrix("hrRequests get a DATA update of e1", "get", "hrRequests/r1", dataReq, undefined, [U.hrm, U.pay, U.mgmt, U.emp1], [U.gov, U.sup1, U.fin, U.emp2, U.plain])
matrix("hrRequests list an advance", "list", "hrRequests/r1", advReq, undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.emp1], [U.gov, U.sup1, U.emp2])
deny("hrRequests get — unauthenticated", null, "get", "hrRequests/r1", leaveReq, undefined)

// create — fileRequest
const createReq = (uid: string, over: Data = {}) => reqBase({ filedBy: filedBy(uid), ...over })
allow("hrRequests fileRequest leave — the employee for himself", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1))
allow("hrRequests fileRequest advance — the employee for himself", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { kind: "advance", ...advBody, leave: undefined }))
allow("hrRequests fileRequest data — the employee for himself", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { kind: "data", data: { field: "phone", value: "05" }, leave: undefined }))
allow("hrRequests fileRequest attfix — the employee for himself", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { kind: "attfix", attfix: { type: "abs", day: today, reason: "x" }, leave: undefined }))
allow("hrRequests fileRequest raise — HR manager for e2", U.hrm, "create", "hrRequests/r1", undefined, createReq(U.hrm, { employeeId: "e2", employeeUserId: U.emp2, siteId: S2, kind: "raise", raise: { basic: 4000 }, onBehalf: true, leave: undefined }))
allow("hrRequests fileRequest — HR manager on behalf of e1", U.hrm, "create", "hrRequests/r1", undefined, createReq(U.hrm, { onBehalf: true }))
allow("hrRequests fileRequest — HR manager's OWN request goes to management", U.hrm, "create", "hrRequests/r1", undefined, createReq(U.hrm, { employeeId: "ehm", employeeUserId: U.hrm, siteId: null, deciderLevel: "management" }))
deny("hrRequests fileRequest — HR manager's own request still addressed to the manager", U.hrm, "create", "hrRequests/r1", undefined, createReq(U.hrm, { employeeId: "ehm", employeeUserId: U.hrm, siteId: null, deciderLevel: "manager" }))
deny("hrRequests fileRequest — another HR manager files for the HR manager at manager level", U.hrm2, "create", "hrRequests/r1", undefined, createReq(U.hrm2, { employeeId: "ehm", employeeUserId: U.hrm, siteId: null, deciderLevel: "manager", onBehalf: true }))
allow("hrRequests fileRequest — another HR manager files for the HR manager at management level", U.hrm2, "create", "hrRequests/r1", undefined, createReq(U.hrm2, { employeeId: "ehm", employeeUserId: U.hrm, siteId: null, deciderLevel: "management", onBehalf: true }))
deny("hrRequests fileRequest — an employee files for ANOTHER employee", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { employeeId: "e2", employeeUserId: U.emp2, siteId: S2 }))
deny("hrRequests fileRequest — supervisor files for his worker", U.sup1, "create", "hrRequests/r1", undefined, createReq(U.sup1, { onBehalf: true }))
deny("hrRequests fileRequest — government relations files for someone", U.gov, "create", "hrRequests/r1", undefined, createReq(U.gov, { onBehalf: true }))
deny("hrRequests fileRequest — management files for someone", U.mgmt, "create", "hrRequests/r1", undefined, createReq(U.mgmt, { onBehalf: true }))
deny("hrRequests fileRequest — filedBy names someone else", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.hrm))
deny("hrRequests fileRequest — siteId differs from the record's", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { siteId: S2 }))
deny("hrRequests fileRequest — employeeUserId differs from the record's link", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { employeeUserId: U.emp2 }))
deny("hrRequests fileRequest — already approved", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { state: "approved" }))
deny("hrRequests fileRequest — financeHold set at filing", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { financeHold: true }))
deny("hrRequests fileRequest — unknown kind", U.emp1, "create", "hrRequests/r1", undefined, createReq(U.emp1, { kind: "bonus" }))
deny("hrRequests fileRequest — other company", U.stranger, "create", "hrRequests/r1", undefined, createReq(U.stranger))
deny("hrRequests fileRequest — unauthenticated", null, "create", "hrRequests/r1", undefined, createReq(U.emp1))
allow("hrRequests fileRequest — employee without a platform user cannot file; HR manager files with employeeUserId null", U.hrm, "create", "hrRequests/r1", undefined, createReq(U.hrm, { employeeId: "e3", employeeUserId: null, siteId: null, onBehalf: true }))

// update — endorse
const endorsed = (uid: string) => patch(leaveReq, { state: "endorsed", endorsement: { by: uid, byName: "n", at: T, note: null }, updatedAt: T2 })
allow("hrRequests endorse — site supervisor", U.sup1, "update", "hrRequests/r1", leaveReq, endorsed(U.sup1))
deny("hrRequests endorse — supervisor of another site", U.sup2, "update", "hrRequests/r1", leaveReq, endorsed(U.sup2))
deny("hrRequests endorse — HR manager (not a supervisor / line manager)", U.hrm, "update", "hrRequests/r1", leaveReq, endorsed(U.hrm))
allow("hrRequests endorse — the line manager named on the request (no HR role)", U.plain, "update", "hrRequests/r1", patch(leaveReq, { lineManagerUserId: U.plain, lineManagerId: "emgr" }), patch(endorsed(U.plain), { lineManagerUserId: U.plain, lineManagerId: "emgr" }))
deny("hrRequests endorse — the employee himself even if named line manager", U.emp1, "update", "hrRequests/r1", patch(leaveReq, { lineManagerUserId: U.emp1 }), patch(endorsed(U.emp1), { lineManagerUserId: U.emp1 }))
deny("hrRequests endorse — an advance", U.sup1, "update", "hrRequests/r1", advReq, patch(advReq, { state: "endorsed", endorsement: filedBy(U.sup1), updatedAt: T2 }))

// decide
const decision = (uid: string, over: Data = {}) => ({ by: uid, byName: "n", at: T, note: null, ownFlagged: false, ...over })
const approveLeave = (uid: string, b: Data = leaveReq): Data => patch(b, { state: "approved", decision: decision(uid), updatedAt: T2 })
matrix("hrRequests decideRequest approve leave (manager level)", "update", "hrRequests/r1", leaveReq, (uid) => approveLeave(uid), [U.hrm, U.owner, U.star], [U.pay, U.gov, U.sup1, U.mgmt, U.fin, U.emp1, U.plain, U.stranger])
allow("hrRequests decideRequest approve an ENDORSED leave — HR manager", U.hrm, "update", "hrRequests/r1", patch(leaveReq, { state: "endorsed" }), approveLeave(U.hrm, patch(leaveReq, { state: "endorsed" })))
allow("hrRequests decideRequest decline with a reason — HR manager", U.hrm, "update", "hrRequests/r1", leaveReq, patch(leaveReq, { state: "declined", decision: decision(U.hrm, { note: "no" }), updatedAt: T2 }))
const mgmtLeave = reqBase({ employeeId: "ehm", employeeUserId: U.hrm, siteId: null, deciderLevel: "management", filedBy: filedBy(U.hrm) })
allow("hrRequests decideRequest — HR manager's own leave decided by management", U.mgmt, "update", "hrRequests/r1", mgmtLeave, approveLeave(U.mgmt, mgmtLeave))
deny("hrRequests decideRequest — HR manager's own leave: another HR manager", U.hrm2, "update", "hrRequests/r1", mgmtLeave, approveLeave(U.hrm2, mgmtLeave))
deny("hrRequests decideRequest — HR manager decides HIS OWN leave", U.hrm, "update", "hrRequests/r1", mgmtLeave, approveLeave(U.hrm, mgmtLeave))
deny("hrRequests decideRequest — HR manager decides his own at manager level (hrNotOwn)", U.hrm, "update", "hrRequests/r1", patch(mgmtLeave, { deciderLevel: "manager" }), approveLeave(U.hrm, patch(mgmtLeave, { deciderLevel: "manager" })))
allow("hrRequests decideRequest — owner decides his own (flagged)", U.owner, "update", "hrRequests/r1", patch(mgmtLeave, { employeeUserId: U.owner }), patch(approveLeave(U.owner, mgmtLeave), { employeeUserId: U.owner, decision: decision(U.owner, { ownFlagged: true }) }))
deny("hrRequests decideRequest — management on a manager-level request", U.mgmt, "update", "hrRequests/r1", leaveReq, approveLeave(U.mgmt))
deny("hrRequests decideRequest — the decision rewrites the leave's owner", U.hrm, "update", "hrRequests/r1", leaveReq, patch(approveLeave(U.hrm), { employeeId: "e2" }))
deny("hrRequests decideRequest — also changes the kind", U.hrm, "update", "hrRequests/r1", leaveReq, patch(approveLeave(U.hrm), { kind: "advance" }))
deny("hrRequests decideRequest — also rewrites filedBy", U.hrm, "update", "hrRequests/r1", leaveReq, patch(approveLeave(U.hrm), { filedBy: filedBy(U.hrm) }))
deny("hrRequests decideRequest — a request already approved", U.hrm, "update", "hrRequests/r1", approveLeave(U.hrm), patch(approveLeave(U.hrm), { state: "declined", updatedAt: T2 }))
deny("hrRequests decideRequest — other company", U.stranger, "update", "hrRequests/r1", leaveReq, approveLeave(U.stranger))
allow("hrRequests decideRequest advance above the limit goes to Finance (state finance, financeHold)", U.hrm, "update", "hrRequests/r1", advReq, patch(advReq, { state: "finance", financeHold: true, decision: decision(U.hrm), advance: { ...(advBody.advance), overLimit: true }, updatedAt: T2 }))
deny("hrRequests decideRequest leave sent to Finance", U.hrm, "update", "hrRequests/r1", leaveReq, patch(leaveReq, { state: "finance", financeHold: true, decision: decision(U.hrm), updatedAt: T2 }))
allow("hrRequests decideRequest approve data update", U.hrm, "update", "hrRequests/r1", dataReq, patch(dataReq, { state: "approved", decision: decision(U.hrm), updatedAt: T2 }))
allow("hrRequests changePay approves a raise request — HR manager", U.hrm, "update", "hrRequests/r1", reqBase({ kind: "raise", leave: undefined, raise: { basic: 4000 } }), patch(reqBase({ kind: "raise", leave: undefined, raise: { basic: 4000 } }), { state: "approved", decision: decision(U.hrm), updatedAt: T2 }))
allow("hrRequests changePay approves the HR manager's own raise request — management", U.mgmt, "update", "hrRequests/r1", patch(mgmtLeave, { kind: "raise" }), patch(mgmtLeave, { kind: "raise", state: "approved", decision: decision(U.mgmt), updatedAt: T2 }))
// finance
const finReq = patch(advReq, { state: "finance", financeHold: true, decision: decision(U.hrm) })
allow("hrRequests financeDecideAdvance approve — Finance", U.fin, "update", "hrRequests/r1", finReq, patch(finReq, { state: "approved", finance: filedBy(U.fin), updatedAt: T2 }))
allow("hrRequests financeDecideAdvance decline — Finance", U.fin, "update", "hrRequests/r1", finReq, patch(finReq, { state: "declined", finance: filedBy(U.fin), updatedAt: T2 }))
allow("hrRequests financeDecideAdvance — owner", U.owner, "update", "hrRequests/r1", finReq, patch(finReq, { state: "approved", finance: filedBy(U.owner), updatedAt: T2 }))
deny("hrRequests financeDecideAdvance — HR manager", U.hrm, "update", "hrRequests/r1", finReq, patch(finReq, { state: "approved", finance: filedBy(U.hrm), updatedAt: T2 }))
deny("hrRequests financeDecideAdvance — Finance approves HIS OWN advance", U.fin, "update", "hrRequests/r1", patch(finReq, { employeeUserId: U.fin }), patch(finReq, { employeeUserId: U.fin, state: "approved", finance: filedBy(U.fin), updatedAt: T2 }))
const apprAdv = patch(advReq, { state: "approved", decision: decision(U.hrm) })
allow("hrRequests payAdvance (payout) — Finance", U.fin, "update", "hrRequests/r1", apprAdv, patch(apprAdv, { payout: filedBy(U.fin), updatedAt: T2 }))
deny("hrRequests payAdvance — HR manager", U.hrm, "update", "hrRequests/r1", apprAdv, patch(apprAdv, { payout: filedBy(U.hrm), updatedAt: T2 }))
deny("hrRequests payAdvance — payroll", U.pay, "update", "hrRequests/r1", apprAdv, patch(apprAdv, { payout: filedBy(U.pay), updatedAt: T2 }))
// return from leave, exit visa
const apprLeave = approveLeave(U.hrm)
allow("hrRequests recordReturn — site supervisor", U.sup1, "update", "hrRequests/r1", apprLeave, patch(apprLeave, { returned: { on: today, by: U.sup1, byName: "n", at: T, lateDays: 0 }, updatedAt: T2 }))
allow("hrRequests recordReturn — HR manager", U.hrm, "update", "hrRequests/r1", apprLeave, patch(apprLeave, { returned: { on: today, by: U.hrm, byName: "n", at: T, lateDays: 0 }, updatedAt: T2 }))
deny("hrRequests recordReturn — supervisor of another site", U.sup2, "update", "hrRequests/r1", apprLeave, patch(apprLeave, { returned: { on: today, by: U.sup2 }, updatedAt: T2 }))
deny("hrRequests recordReturn — payroll", U.pay, "update", "hrRequests/r1", apprLeave, patch(apprLeave, { returned: { on: today, by: U.pay }, updatedAt: T2 }))
deny("hrRequests recordReturn — recorded a second time", U.hrm, "update", "hrRequests/r1", patch(apprLeave, { returned: { on: today } }), patch(apprLeave, { returned: { on: today, again: true }, updatedAt: T2 }))
allow("hrRequests recordExitVisa — government relations", U.gov, "update", "hrRequests/r1", apprLeave, patch(apprLeave, { exitVisa: filedBy(U.gov), updatedAt: T2 }))
allow("hrRequests recordExitVisa — HR manager", U.hrm, "update", "hrRequests/r1", apprLeave, patch(apprLeave, { exitVisa: filedBy(U.hrm), updatedAt: T2 }))
deny("hrRequests recordExitVisa — government relations for his OWN leave", U.gov, "update", "hrRequests/r1", patch(apprLeave, { employeeUserId: U.gov }), patch(apprLeave, { employeeUserId: U.gov, exitVisa: filedBy(U.gov), updatedAt: T2 }))
deny("hrRequests recordExitVisa — second time", U.gov, "update", "hrRequests/r1", patch(apprLeave, { exitVisa: filedBy(U.gov) }), patch(apprLeave, { exitVisa: filedBy(U.hrm), updatedAt: T2 }))
deny("hrRequests recordExitVisa — payroll", U.pay, "update", "hrRequests/r1", apprLeave, patch(apprLeave, { exitVisa: filedBy(U.pay), updatedAt: T2 }))
// cancel
const cancelled = (b: Data, uid: string) => patch(b, { state: "cancelled", cancel: filedBy(uid), updatedAt: T2 })
allow("hrRequests cancelRequest pending — the employee", U.emp1, "update", "hrRequests/r1", leaveReq, cancelled(leaveReq, U.emp1))
allow("hrRequests cancelRequest pending — HR manager", U.hrm, "update", "hrRequests/r1", leaveReq, cancelled(leaveReq, U.hrm))
deny("hrRequests cancelRequest pending — another employee", U.emp2, "update", "hrRequests/r1", leaveReq, cancelled(leaveReq, U.emp2))
deny("hrRequests cancelRequest pending — supervisor", U.sup1, "update", "hrRequests/r1", leaveReq, cancelled(leaveReq, U.sup1))
allow("hrRequests cancelRequest endorsed — the employee", U.emp1, "update", "hrRequests/r1", patch(leaveReq, { state: "endorsed" }), cancelled(patch(leaveReq, { state: "endorsed" }), U.emp1))
allow("hrRequests cancelRequest approved leave not started — the employee (LV-07)", U.emp1, "update", "hrRequests/r1", apprLeave, cancelled(apprLeave, U.emp1))
allow("hrRequests cancelRequest approved leave not started — HR manager", U.hrm, "update", "hrRequests/r1", apprLeave, cancelled(apprLeave, U.hrm))
const startedLeave = approveLeave(U.hrm, reqBase({ leave: { type: "annual", from: riyadhDay(-1), to: riyadhDay(3), days: 4, fromBalance: 4 } }))
deny("hrRequests cancelRequest approved leave already started — the employee", U.emp1, "update", "hrRequests/r1", startedLeave, cancelled(startedLeave, U.emp1))
deny("hrRequests cancelRequest approved leave already started — HR manager", U.hrm, "update", "hrRequests/r1", startedLeave, cancelled(startedLeave, U.hrm))
const startsToday = approveLeave(U.hrm, reqBase({ leave: { type: "annual", from: today, to: riyadhDay(3), days: 4, fromBalance: 4 } }))
deny("hrRequests cancelRequest approved leave starting TODAY — the employee", U.emp1, "update", "hrRequests/r1", startsToday, cancelled(startsToday, U.emp1))
const apprAdv2 = patch(advReq, { state: "approved", decision: decision(U.hrm) })
deny("hrRequests cancelRequest approved advance", U.emp1, "update", "hrRequests/r1", apprAdv2, cancelled(apprAdv2, U.emp1))
deny("hrRequests cancelRequest approved advance — HR manager", U.hrm, "update", "hrRequests/r1", apprAdv2, cancelled(apprAdv2, U.hrm))
// attfix decisions
const attfixReq = reqBase({ kind: "attfix", leave: undefined, attfix: { type: "abs", day: today, reason: "x" } })
delete (attfixReq as Data).leave
allow("hrRequests decideAttfix approve — site supervisor", U.sup1, "update", "hrRequests/r1", attfixReq, patch(attfixReq, { state: "approved", decision: decision(U.sup1), updatedAt: T2 }))
allow("hrRequests decideAttfix approve — HR manager", U.hrm, "update", "hrRequests/r1", attfixReq, patch(attfixReq, { state: "approved", decision: decision(U.hrm), updatedAt: T2 }))
allow("hrRequests decideAttfix decline — site supervisor", U.sup1, "update", "hrRequests/r1", attfixReq, patch(attfixReq, { state: "declined", decision: decision(U.sup1, { note: "no" }), updatedAt: T2 }))
deny("hrRequests decideAttfix — supervisor of another site", U.sup2, "update", "hrRequests/r1", attfixReq, patch(attfixReq, { state: "approved", decision: decision(U.sup2), updatedAt: T2 }))
deny("hrRequests decideAttfix — payroll", U.pay, "update", "hrRequests/r1", attfixReq, patch(attfixReq, { state: "approved", decision: decision(U.pay), updatedAt: T2 }))
deny("hrRequests decideAttfix — the employee himself", U.emp1, "update", "hrRequests/r1", attfixReq, patch(attfixReq, { state: "approved", decision: decision(U.emp1), updatedAt: T2 }))
deny("hrRequests supervisor decides a LEAVE (not an attfix)", U.sup1, "update", "hrRequests/r1", leaveReq, approveLeave(U.sup1))
deny("hrRequests delete — owner", U.owner, "delete", "hrRequests/r1", leaveReq, undefined)

// ---------------------------------------------------------------------------
// hrPayrolls
// ---------------------------------------------------------------------------

const prId = (key: string) => `hrPayrolls/${ORG}__${key}`
const payrollDoc = (state: string, over: Data = {}): Data => ({ organizationId: ORG, month: PM, key: PM, kind: "main", state, lines: [{ employeeId: "e1", net: 4000 }], totals: { people: 1 }, prepared: stampOf(U.pay), approved: null, updatedAt: T, ...over })
const prepared = payrollDoc("prepared")
matrix("hrPayrolls get", "get", prId(PM), prepared, undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.owner], [U.gov, U.sup1, U.emp1, U.plain, U.inv, U.stranger])
matrix("hrPayrolls get a month that is not prepared yet", "get", prId(PM), undefined, undefined, [U.hrm, U.pay, U.mgmt, U.fin], [U.gov, U.sup1, U.emp1])
matrix("hrPayrolls list", "list", prId(PM), prepared, undefined, [U.hrm, U.pay, U.mgmt, U.fin], [U.gov, U.sup1, U.emp1])
deny("hrPayrolls get — unauthenticated", null, "get", prId(PM), prepared, undefined)

matrix("hrPayrolls preparePayroll (create)", "create", prId(PM), undefined, (uid) => payrollDoc("prepared", { prepared: stampOf(uid) }), [U.hrm, U.pay, U.owner], [U.gov, U.mgmt, U.fin, U.sup1, U.emp1, U.stranger])
deny("hrPayrolls create — prepared.by is someone else", U.hrm, "create", prId(PM), undefined, payrollDoc("prepared", { prepared: stampOf(U.pay) }))
deny("hrPayrolls create — born approved", U.hrm, "create", prId(PM), undefined, payrollDoc("approved", { prepared: stampOf(U.hrm) }))
deny("hrPayrolls create — id does not match org+key", U.hrm, "create", prId("2026-07"), undefined, payrollDoc("prepared", { prepared: stampOf(U.hrm) }))
allow("hrPayrolls prepareSupplementary (key -D) — payroll officer", U.pay, "create", prId(`${PM}-D`), undefined, payrollDoc("prepared", { key: `${PM}-D`, kind: "supplementary", lines: [], supplementary: [{ employeeId: "e1", net: 100 }] }))
matrix("hrPayrolls recompute a prepared payroll", "update", prId(PM), prepared, (uid) => patch(prepared, { lines: [{ employeeId: "e1", net: 4100 }], prepared: stampOf(uid), updatedAt: T2 }), [U.hrm, U.pay, U.owner], [U.gov, U.mgmt, U.fin, U.sup1, U.emp1, U.stranger])
deny("hrPayrolls recompute — prepared.by stays another's", U.hrm, "update", prId(PM), prepared, patch(prepared, { lines: [], prepared: stampOf(U.pay), updatedAt: T2 }))
const approvedAfter = (uid: string, over: Data = {}) => patch(prepared, { state: "approved", approved: stampOf(uid), ownFlagged: false, updatedAt: T2, ...over })
allow("hrPayrolls approvePayroll — HR manager who did not prepare it", U.hrm, "update", prId(PM), prepared, approvedAfter(U.hrm))
allow("hrPayrolls approvePayroll — '*' group member", U.star, "update", prId(PM), prepared, approvedAfter(U.star))
deny("hrPayrolls approvePayroll — HR manager approves what HE prepared", U.hrm, "update", prId(PM), payrollDoc("prepared", { prepared: stampOf(U.hrm) }), approvedAfter(U.hrm, { prepared: stampOf(U.hrm) }))
allow("hrPayrolls approvePayroll — owner approves what he prepared (ownFlagged)", U.owner, "update", prId(PM), payrollDoc("prepared", { prepared: stampOf(U.owner) }), approvedAfter(U.owner, { prepared: stampOf(U.owner), ownFlagged: true }))
deny("hrPayrolls approvePayroll — payroll officer", U.pay, "update", prId(PM), prepared, approvedAfter(U.pay))
deny("hrPayrolls approvePayroll — management", U.mgmt, "update", prId(PM), prepared, approvedAfter(U.mgmt))
deny("hrPayrolls approvePayroll — Finance", U.fin, "update", prId(PM), prepared, approvedAfter(U.fin))
deny("hrPayrolls approvePayroll — also rewrites the lines", U.hrm, "update", prId(PM), prepared, approvedAfter(U.hrm, { lines: [{ employeeId: "e1", net: 1 }] }))
deny("hrPayrolls approvePayroll — across companies", U.stranger, "update", prId(PM), prepared, approvedAfter(U.stranger))
const approvedP = payrollDoc("approved", { approved: stampOf(U.hrm) })
const postedP = payrollDoc("posted", { approved: stampOf(U.hrm), posted: { ...stampOf(U.fin), entry: "j1" } })
const paidP = payrollDoc("paid", { approved: stampOf(U.hrm), paid: { ...stampOf(U.fin), date: today } })
allow("hrPayrolls postHrEvent (state posted) — Finance", U.fin, "update", prId(PM), approvedP, patch(approvedP, { state: "posted", posted: { ...stampOf(U.fin), entry: "j1" }, updatedAt: T2 }))
allow("hrPayrolls recordPayrollPaid (accounting off: approved → paid) — Finance", U.fin, "update", prId(PM), approvedP, patch(approvedP, { state: "paid", paid: { ...stampOf(U.fin), date: today }, updatedAt: T2 }))
allow("hrPayrolls recordPayrollPaid (posted → paid) — Finance", U.fin, "update", prId(PM), postedP, patch(postedP, { state: "paid", paid: { ...stampOf(U.fin), date: today }, updatedAt: T2 }))
allow("hrPayrolls recordPayrollPaid — owner", U.owner, "update", prId(PM), postedP, patch(postedP, { state: "paid", paid: { ...stampOf(U.owner), date: today }, updatedAt: T2 }))
deny("hrPayrolls posting — HR manager", U.hrm, "update", prId(PM), approvedP, patch(approvedP, { state: "posted", posted: stampOf(U.hrm), updatedAt: T2 }))
deny("hrPayrolls posting — payroll officer", U.pay, "update", prId(PM), approvedP, patch(approvedP, { state: "posted", posted: stampOf(U.pay), updatedAt: T2 }))
deny("hrPayrolls paid → posted", U.fin, "update", prId(PM), paidP, patch(paidP, { state: "posted", updatedAt: T2 }))
deny("hrPayrolls posting — also changes the lines", U.fin, "update", prId(PM), approvedP, patch(approvedP, { state: "posted", lines: [], updatedAt: T2 }))
deny("hrPayrolls Finance reopens to prepared", U.fin, "update", prId(PM), approvedP, patch(approvedP, { state: "prepared", updatedAt: T2 }))
deny("hrPayrolls payroll recomputes an APPROVED payroll", U.pay, "update", prId(PM), approvedP, patch(approvedP, { state: "prepared", prepared: stampOf(U.pay), updatedAt: T2 }))
allow("hrPayrolls recordGosiPaid on a posted payroll — Finance", U.fin, "update", prId(PM), postedP, patch(postedP, { gosiPaid: { ...stampOf(U.fin), date: today, amount: 100, entry: null }, updatedAt: T2 }))
allow("hrPayrolls recordGosiPaid on a paid payroll — Finance", U.fin, "update", prId(PM), paidP, patch(paidP, { gosiPaid: { ...stampOf(U.fin), date: today, amount: 100, entry: null }, updatedAt: T2 }))
allow("hrPayrolls markReturned (returned.e1) on a paid payroll — Finance", U.fin, "update", prId(PM), paidP, patch(paidP, { returned: { e1: { ...stampOf(U.fin), reason: "x", date: today } }, updatedAt: T2 }))
allow("hrPayrolls payHeldLine (paidHeld.e1) on a paid payroll — Finance", U.fin, "update", prId(PM), paidP, patch(paidP, { paidHeld: { e1: { ...stampOf(U.fin), date: today } }, updatedAt: T2 }))
deny("hrPayrolls markReturned — HR manager", U.hrm, "update", prId(PM), paidP, patch(paidP, { returned: { e1: stampOf(U.hrm) }, updatedAt: T2 }))
allow("hrPayrolls justifyMudadFinding (just) — payroll officer", U.pay, "update", prId(PM), approvedP, patch(approvedP, { just: { f1: { why: "x", ...stampOf(U.pay) } }, updatedAt: T2 }))
allow("hrPayrolls justifyMudadFinding (just) — HR manager", U.hrm, "update", prId(PM), approvedP, patch(approvedP, { just: { f1: { why: "x", ...stampOf(U.hrm) } }, updatedAt: T2 }))
allow("hrPayrolls recordMudadStatus (mudad) on a paid payroll — payroll officer", U.pay, "update", prId(PM), paidP, patch(paidP, { mudad: { pct: 100, note: null, ...stampOf(U.pay) }, updatedAt: T2 }))
deny("hrPayrolls justification — Finance", U.fin, "update", prId(PM), approvedP, patch(approvedP, { just: { f1: { why: "x" } }, updatedAt: T2 }))
deny("hrPayrolls justification — government relations", U.gov, "update", prId(PM), approvedP, patch(approvedP, { just: { f1: { why: "x" } }, updatedAt: T2 }))
deny("hrPayrolls key changed", U.hrm, "update", prId(PM), prepared, patch(prepared, { key: "2026-07", updatedAt: T2 }))
deny("hrPayrolls delete — owner", U.owner, "delete", prId(PM), prepared, undefined)

// ---------------------------------------------------------------------------
// hrEvents (the outbox to Finance)
// ---------------------------------------------------------------------------

const evKey = (k: string) => `hrEvents/${ORG}__${k}`
const evDoc = (key: string, kind: string, over: Data = {}): Data => ({ organizationId: ORG, key, kind, month: PM, payrollId: `${ORG}__${PM}`, payrollKey: PM, state: "sent", sent: stampOf(U.hrm), createdAt: T, ...over })
const payEv = evDoc(`hr:PAY:${PM}`, "PAY")
matrix("hrEvents get", "get", evKey(`hr:PAY:${PM}`), payEv, undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.owner], [U.gov, U.sup1, U.emp1, U.plain, U.stranger])
matrix("hrEvents get an event that does not exist yet (never sent twice)", "get", evKey(`hr:PAY:${PM}`), undefined, undefined, [U.hrm, U.pay, U.mgmt, U.fin], [U.gov, U.sup1, U.emp1])
matrix("hrEvents approvePayroll creates hr:PAY", "create", evKey(`hr:PAY:${PM}`), undefined, payEv, [U.hrm, U.owner], [U.pay, U.fin, U.mgmt, U.gov, U.sup1, U.emp1, U.stranger])
allow("hrEvents approvePayroll creates hr:EOS", U.hrm, "create", evKey(`hr:EOS:${PM}`), undefined, evDoc(`hr:EOS:${PM}`, "EOS"))
allow("hrEvents settlement creates hr:FS", U.hrm, "create", evKey("hr:FS:4"), undefined, evDoc("hr:FS:4", "FS", { settlementId: `${ORG}__e1`, net: 100 }))
allow("hrEvents recordSessionResult creates hr:TRN", U.hrm, "create", evKey("hr:TRN:s1"), undefined, evDoc("hr:TRN:s1", "TRN", { session: "s1" }))
const feeEv = evDoc("hr:PR:DOC:1:iqama:2028-01-01", "PR", { prType: "doc", amount: 650, employeeId: "e1", sent: stampOf(U.gov) })
allow("hrEvents recordRenewal creates hr:PR (fee) — government relations", U.gov, "create", evKey("hr:PR:DOC:1:iqama:2028-01-01"), undefined, feeEv)
allow("hrEvents recordRenewal creates hr:PR (fee) — HR manager", U.hrm, "create", evKey("hr:PR:DOC:1:iqama:2028-01-01"), undefined, feeEv)
deny("hrEvents government relations creates hr:PAY", U.gov, "create", evKey(`hr:PAY:${PM}`), undefined, patch(payEv, { sent: stampOf(U.gov) }))
deny("hrEvents government relations creates a PR with a non-PR key", U.gov, "create", evKey("hr:FS:4"), undefined, evDoc("hr:FS:4", "PR"))
deny("hrEvents created already posted", U.hrm, "create", evKey(`hr:PAY:${PM}`), undefined, patch(payEv, { state: "posted" }))
deny("hrEvents id does not match key", U.hrm, "create", evKey("hr:PAY:2026-07"), undefined, payEv)
deny("hrEvents update by the HR manager", U.hrm, "update", evKey(`hr:PAY:${PM}`), payEv, patch(payEv, { state: "posted", updatedAt: T2 }))
allow("hrEvents postHrEvent — Finance", U.fin, "update", evKey(`hr:PAY:${PM}`), payEv, patch(payEv, { state: "posted", posted: stampOf(U.fin), entryId: "j1", updatedAt: T2 }))
allow("hrEvents payFeeRequest / payTrainingCost / recordPayrollPaid — Finance", U.fin, "update", evKey(`hr:PAY:${PM}`), patch(payEv, { state: "posted" }), patch(payEv, { state: "paid", paid: { ...stampOf(U.fin), date: today }, entryId: null, updatedAt: T2 }))
deny("hrEvents Finance changes the amounts", U.fin, "update", evKey(`hr:PAY:${PM}`), payEv, patch(payEv, { state: "posted", debit: [], updatedAt: T2 }))
deny("hrEvents Finance sets state back to sent", U.fin, "update", evKey(`hr:PAY:${PM}`), patch(payEv, { state: "posted" }), patch(payEv, { state: "sent", updatedAt: T2 }))
deny("hrEvents delete — owner", U.owner, "delete", evKey(`hr:PAY:${PM}`), payEv, undefined)

// ---------------------------------------------------------------------------
// hrPayslips
// ---------------------------------------------------------------------------

const slipId = `${ORG}__${PM}__e1`
const slip: Data = { organizationId: ORG, payrollId: `${ORG}__${PM}`, key: PM, month: PM, kind: "main", employeeId: "e1", employeeUserId: U.emp1, line: { net: 4000 }, paidOn: today, createdAt: T }
matrix("hrPayslips get e1's payslip", "get", `hrPayslips/${slipId}`, slip, undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.emp1, U.owner], [U.gov, U.sup1, U.emp2, U.plain, U.stranger])
matrix("hrPayslips list", "list", `hrPayslips/${slipId}`, slip, undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.emp1], [U.gov, U.sup1, U.emp2])
const paidOv = { overrides: { [prId(PM)]: paidP } }
matrix("hrPayslips writePayslips after payment (create)", "create", `hrPayslips/${slipId}`, undefined, slip, [U.fin, U.owner], [U.hrm, U.pay, U.mgmt, U.gov, U.emp1, U.stranger], paidOv)
deny("hrPayslips create — payroll only posted (payment not yet recorded)", U.fin, "create", `hrPayslips/${slipId}`, undefined, slip, { overrides: { [prId(PM)]: postedP } })
deny("hrPayslips create — payroll approved", U.fin, "create", `hrPayslips/${slipId}`, undefined, slip, { overrides: { [prId(PM)]: approvedP } })
deny("hrPayslips create — id does not match payroll+employee", U.fin, "create", `hrPayslips/${ORG}__${PM}__e2`, undefined, slip, paidOv)
deny("hrPayslips update", U.fin, "update", `hrPayslips/${slipId}`, slip, patch(slip, { paidOn: "x" }))
deny("hrPayslips delete", U.owner, "delete", `hrPayslips/${slipId}`, slip, undefined)

// ---------------------------------------------------------------------------
// hrViolations
// ---------------------------------------------------------------------------

const vOn = riyadhDay(-3)
const vId = (emp = "e1", code = "late") => `hrViolations/${ORG}__${emp}__${vOn}__${code}`
const violation = (by: string, over: Data = {}): Data => ({ organizationId: ORG, employeeId: "e1", employeeUserId: U.emp1, employeeName: "a", siteId: S1, code: "late", on: vOn, note: null, source: "manual", state: "recorded", recorded: stampOf(by), updatedAt: T, ...over })
const vRec = violation(U.sup1)
matrix("hrViolations get a recorded one", "get", vId(), vRec, undefined, [U.hrm, U.pay, U.mgmt, U.sup1, U.emp1, U.owner], [U.sup2, U.gov, U.emp2, U.fin, U.plain, U.stranger])
matrix("hrViolations get a record that does not exist (the sheet's check)", "get", vId(), undefined, undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1, U.sup2], [U.emp1, U.plain, U.fin])
matrix("hrViolations list", "list", vId(), vRec, undefined, [U.hrm, U.pay, U.mgmt, U.emp1], [U.sup1, U.gov, U.emp2])
matrix("hrViolations recordViolation / sheet violation on e1 (site1)", "create", vId(), undefined, (uid) => violation(uid), [U.hrm, U.sup1, U.owner], [U.sup2, U.gov, U.pay, U.mgmt, U.fin, U.emp1, U.stranger])
deny("hrViolations create — supervisor on an UNASSIGNED worker", U.sup1, "create", vId("e3"), undefined, violation(U.sup1, { employeeId: "e3", employeeUserId: null, siteId: null }))
allow("hrViolations create — HR manager on an UNASSIGNED worker", U.hrm, "create", vId("e3"), undefined, violation(U.hrm, { employeeId: "e3", employeeUserId: null, siteId: null }))
deny("hrViolations create — document id does not match", U.sup1, "create", vId("e1", "absent"), undefined, violation(U.sup1))
deny("hrViolations create — employeeUserId differs from the record's link", U.hrm, "create", vId(), undefined, violation(U.hrm, { employeeUserId: U.emp2 }))
deny("hrViolations create — siteId in the body differs from the employee's", U.sup1, "create", vId(), undefined, violation(U.sup1, { siteId: S2 }))
deny("hrViolations create — born applied", U.hrm, "create", vId(), undefined, violation(U.hrm, { state: "applied" }))
deny("hrViolations create — recorded.by is someone else", U.hrm, "create", vId(), undefined, violation(U.sup1))
const applied = (uid: string, over: Data = {}) => patch(vRec, { state: "applied", hearing: { on: riyadhDay(-1), note: null }, step: 0, stepKind: "warning", amount: 0, deductMonth: M, notifiedOn: today, decision: stampOf(uid), updatedAt: T2, ...over })
matrix("hrViolations decidePenalty apply (hearing held, notified today)", "update", vId(), vRec, (uid) => applied(uid), [U.hrm, U.owner], [U.sup1, U.pay, U.mgmt, U.gov, U.emp1, U.stranger])
deny("hrViolations apply — hearing BEFORE the violation", U.hrm, "update", vId(), vRec, applied(U.hrm, { hearing: { on: riyadhDay(-9), note: null } }))
deny("hrViolations apply — hearing in the future", U.hrm, "update", vId(), vRec, applied(U.hrm, { hearing: { on: riyadhDay(3), note: null } }))
deny("hrViolations apply — notifiedOn is not today", U.hrm, "update", vId(), vRec, applied(U.hrm, { notifiedOn: riyadhDay(-1) }))
deny("hrViolations apply — HR manager's OWN violation", U.hrm, "update", vId(), violation(U.sup1, { employeeId: "ehm", employeeUserId: U.hrm }), patch(applied(U.hrm), { employeeId: "ehm", employeeUserId: U.hrm }))
allow("hrViolations apply — owner on his own (flagged)", U.owner, "update", vId(), violation(U.sup1, { employeeUserId: U.owner }), patch(applied(U.owner), { employeeUserId: U.owner }))
deny("hrViolations apply — also changes the code", U.hrm, "update", vId(), vRec, applied(U.hrm, { code: "absent" }))
deny("hrViolations apply — also changes the employee", U.hrm, "update", vId(), vRec, applied(U.hrm, { employeeId: "e2" }))
allow("hrViolations decidePenalty dismiss with a reason", U.hrm, "update", vId(), vRec, patch(vRec, { state: "dismissed", decision: { ...stampOf(U.hrm), note: "no" }, updatedAt: T2 }))
deny("hrViolations dismiss — supervisor", U.sup1, "update", vId(), vRec, patch(vRec, { state: "dismissed", decision: { ...stampOf(U.sup1), note: "no" }, updatedAt: T2 }))
const objectedAfter = (b: Data, uid: string) => patch(b, { state: "objected", objection: { ...stampOf(uid), text: "unfair" }, updatedAt: T2 })
const appliedNow = applied(U.hrm)
allow("hrViolations objectPenalty — the employee within 15 days", U.emp1, "update", vId(), appliedNow, objectedAfter(appliedNow, U.emp1))
deny("hrViolations objectPenalty — 20 days after the notice", U.emp1, "update", vId(), patch(appliedNow, { notifiedOn: riyadhDay(-20) }), objectedAfter(patch(appliedNow, { notifiedOn: riyadhDay(-20) }), U.emp1))
allow("hrViolations objectPenalty — on the 15th day after the notice", U.emp1, "update", vId(), patch(appliedNow, { notifiedOn: riyadhDay(-15) }), objectedAfter(patch(appliedNow, { notifiedOn: riyadhDay(-15) }), U.emp1))
deny("hrViolations objectPenalty — HR manager files it for him", U.hrm, "update", vId(), appliedNow, objectedAfter(appliedNow, U.hrm))
deny("hrViolations objectPenalty — another employee", U.emp2, "update", vId(), appliedNow, objectedAfter(appliedNow, U.emp2))
deny("hrViolations objectPenalty — a recorded (not yet applied) violation", U.emp1, "update", vId(), vRec, objectedAfter(vRec, U.emp1))
const objectedNow = objectedAfter(appliedNow, U.emp1)
const decidedObj = (b: Data, uid: string, state: string) => patch(b, { state, deductMonth: M, objectionDecision: { ...stampOf(uid), note: "ok" }, updatedAt: T2 })
matrix("hrViolations decideObjection uphold", "update", vId(), objectedNow, (uid) => decidedObj(objectedNow, uid, "upheld"), [U.hrm, U.owner], [U.sup1, U.pay, U.mgmt, U.emp1, U.gov])
allow("hrViolations decideObjection cancel", U.hrm, "update", vId(), objectedNow, decidedObj(objectedNow, U.hrm, "cancelled"))
deny("hrViolations decideObjection — own record", U.hrm, "update", vId(), patch(objectedNow, { employeeUserId: U.hrm }), patch(decidedObj(objectedNow, U.hrm, "upheld"), { employeeUserId: U.hrm }))
deny("hrViolations recorded → upheld (skipping the steps)", U.hrm, "update", vId(), vRec, patch(vRec, { state: "upheld", objectionDecision: stampOf(U.hrm), deductMonth: M, updatedAt: T2 }))
deny("hrViolations delete — owner", U.owner, "delete", vId(), vRec, undefined)

// ---------------------------------------------------------------------------
// hrExits and hrSettlements
// ---------------------------------------------------------------------------

const exId = `${ORG}__e1`
const exitDoc = (over: Data = {}): Data => ({ organizationId: ORG, employeeId: "e1", employeeUserId: U.emp1, employeeName: "a", no: 1, siteId: S1, reason: "resignation", noticeOn: null, lastDay: riyadhDay(20), art77: false, note: null, state: "leaving", started: stampOf(U.hrm), custody: { state: "requested", requestedAt: T }, tasks: {}, updatedAt: T, ...over })
const clearedCustody = { state: "cleared", requestedAt: T, by: U.inv, byName: "n", at: T, shortfall: null, note: null }
const exLeaving = exitDoc()
matrix("hrExits get", "get", `hrExits/${exId}`, exLeaving, undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.fin, U.inv, U.emp1, U.owner], [U.emp2, U.plain, U.stranger])
allow("OBS hrExits get — a supervisor reads ANY workplace's exit (hrStaff, not site-scoped)", U.sup2, "get", `hrExits/${exId}`, exLeaving, undefined)
matrix("hrExits get a record that does not exist (startExit checks first)", "get", `hrExits/${exId}`, undefined, undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.fin, U.inv], [U.emp1, U.plain])
matrix("hrExits startExit (create)", "create", `hrExits/${exId}`, undefined, (uid) => exitDoc({ started: stampOf(uid) }), [U.hrm, U.owner], [U.gov, U.pay, U.mgmt, U.sup1, U.fin, U.inv, U.emp1, U.stranger])
deny("hrExits startExit — the HR manager's own exit", U.hrm, "create", `hrExits/hrt-org__ehm`, undefined, exitDoc({ employeeId: "ehm", employeeUserId: U.hrm }))
deny("hrExits startExit — custody not 'requested'", U.hrm, "create", `hrExits/${exId}`, undefined, exitDoc({ custody: { state: "cleared" } }))
deny("hrExits startExit — born settled", U.hrm, "create", `hrExits/${exId}`, undefined, exitDoc({ state: "settled" }))
deny("hrExits startExit — id does not match company+employee", U.hrm, "create", `hrExits/${ORG}__e2`, undefined, exitDoc())
deny("hrExits startExit — started.by is someone else", U.hrm, "create", `hrExits/${exId}`, undefined, exitDoc({ started: stampOf(U.gov) }))
matrix("hrExits clearCustody", "update", `hrExits/${exId}`, exLeaving, patch(exLeaving, { custody: clearedCustody, updatedAt: T2 }), [U.inv, U.owner], [U.hrm, U.gov, U.pay, U.fin, U.emp1, U.stranger])
allow("hrExits clearCustody — warehouses.receive member", U.inv, "update", `hrExits/${exId}`, exLeaving, patch(exLeaving, { custody: { ...clearedCustody, shortfall: 50 }, updatedAt: T2 }))
deny("hrExits clearCustody twice", U.inv, "update", `hrExits/${exId}`, patch(exLeaving, { custody: clearedCustody }), patch(exLeaving, { custody: { ...clearedCustody, shortfall: 1 }, updatedAt: T2 }))
matrix("hrExits setExitTask (tasks.x)", "update", `hrExits/${exId}`, exLeaving, patch(exLeaving, { tasks: { gosi: stampOf(U.gov) }, updatedAt: T2 }), [U.hrm, U.gov], [U.pay, U.sup1, U.fin, U.inv, U.emp1])
const exCleared = exitDoc({ custody: clearedCustody })
matrix("hrExits approveSettlement (leaving → settled)", "update", `hrExits/${exId}`, exCleared, (uid) => patch(exCleared, { state: "settled", settled: stampOf(uid), updatedAt: T2 }), [U.hrm, U.owner], [U.gov, U.pay, U.mgmt, U.fin, U.inv, U.emp1])
deny("hrExits approveSettlement — custody not cleared", U.hrm, "update", `hrExits/${exId}`, exLeaving, patch(exLeaving, { state: "settled", settled: stampOf(U.hrm), updatedAt: T2 }))
deny("hrExits approveSettlement — HR manager's own exit", U.hrm, "update", `hrExits/hrt-org__ehm`, exitDoc({ employeeId: "ehm", employeeUserId: U.hrm, custody: clearedCustody }), patch(exitDoc({ employeeId: "ehm", employeeUserId: U.hrm, custody: clearedCustody }), { state: "settled", settled: stampOf(U.hrm), updatedAt: T2 }))
const exSettled = exitDoc({ custody: clearedCustody, state: "settled", settled: stampOf(U.hrm) })
matrix("hrExits paySettlement (settled → paid)", "update", `hrExits/${exId}`, exSettled, patch(exSettled, { state: "paid", paid: { ...stampOf(U.fin), date: today }, updatedAt: T2 }), [U.fin, U.owner], [U.hrm, U.gov, U.pay, U.inv, U.emp1])
deny("hrExits leaving → paid (skipping settlement)", U.fin, "update", `hrExits/${exId}`, exCleared, patch(exCleared, { state: "paid", paid: stampOf(U.fin), updatedAt: T2 }))
deny("hrExits update names another employee", U.hrm, "update", `hrExits/${exId}`, exCleared, patch(exCleared, { employeeId: "e2", state: "settled", settled: stampOf(U.hrm) }))
deny("hrExits delete — owner", U.owner, "delete", `hrExits/${exId}`, exLeaving, undefined)

const settlement = (over: Data = {}): Data => ({ organizationId: ORG, employeeId: "e1", employeeUserId: U.emp1, no: 1, lastDay: riyadhDay(20), net: 5000, state: "approved", approved: stampOf(U.hrm), updatedAt: T, ...over })
const exClearedOv = { overrides: { [`hrExits/${exId}`]: exCleared } }
matrix("hrSettlements get", "get", `hrSettlements/${exId}`, settlement(), undefined, [U.hrm, U.pay, U.mgmt, U.fin, U.emp1, U.owner], [U.gov, U.sup1, U.inv, U.emp2, U.plain, U.stranger])
matrix("hrSettlements get that does not exist", "get", `hrSettlements/${exId}`, undefined, undefined, [U.hrm, U.pay, U.mgmt, U.fin], [U.gov, U.sup1, U.emp1])
matrix("hrSettlements approveSettlement (create)", "create", `hrSettlements/${exId}`, undefined, (uid) => settlement({ approved: stampOf(uid) }), [U.hrm, U.owner], [U.gov, U.pay, U.mgmt, U.fin, U.sup1, U.emp1, U.stranger], exClearedOv)
deny("hrSettlements create — custody not cleared", U.hrm, "create", `hrSettlements/${exId}`, undefined, settlement(), { overrides: { [`hrExits/${exId}`]: exLeaving } })
deny("hrSettlements create — no exit started", U.hrm, "create", `hrSettlements/${exId}`, undefined, settlement(), { overrides: { [`hrExits/${exId}`]: null } })
deny("hrSettlements create — the HR manager's own settlement", U.hrm, "create", `hrSettlements/hrt-org__ehm`, undefined, settlement({ employeeId: "ehm", employeeUserId: U.hrm }), { overrides: { "hrExits/hrt-org__ehm": exitDoc({ employeeId: "ehm", employeeUserId: U.hrm, custody: clearedCustody }) } })
deny("hrSettlements create — born paid", U.hrm, "create", `hrSettlements/${exId}`, undefined, settlement({ state: "paid" }), exClearedOv)
matrix("hrSettlements paySettlement (approved → paid)", "update", `hrSettlements/${exId}`, settlement(), patch(settlement(), { state: "paid", paid: { ...stampOf(U.fin), date: today }, entryId: null, updatedAt: T2 }), [U.fin, U.owner], [U.hrm, U.pay, U.mgmt, U.gov, U.emp1])
deny("hrSettlements pay — also edits the net", U.fin, "update", `hrSettlements/${exId}`, settlement(), patch(settlement(), { state: "paid", net: 1, updatedAt: T2 }))
deny("hrSettlements delete", U.owner, "delete", `hrSettlements/${exId}`, settlement(), undefined)

// ---------------------------------------------------------------------------
// hrLetters and hrLetterPay
// ---------------------------------------------------------------------------

const letter = (uid: string, over: Data = {}): Data => ({ organizationId: ORG, kind: "sal", title: null, purpose: null, addressee: "x", lang: "ar", employeeId: "e1", employeeUserId: U.emp1, employeeName: "a", signerLevel: "manager", filedBy: { by: uid, byName: "n", at: T, note: null }, onBehalf: uid !== U.emp1, state: "pending", createdAt: T, updatedAt: T, ...over })
const pend = letter(U.emp1)
matrix("hrLetters get a manager-level letter", "get", "hrLetters/L1", pend, undefined, [U.hrm, U.pay, U.mgmt, U.emp1, U.owner], [U.gov, U.sup1, U.emp2, U.plain, U.fin, U.stranger])
matrix("hrLetters get a gov-level letter", "get", "hrLetters/L1", letter(U.emp1, { signerLevel: "gov", kind: "emb" }), undefined, [U.hrm, U.pay, U.mgmt, U.gov, U.emp1], [U.sup1, U.emp2, U.fin])
allow("hrLetters fileLetter — the employee for himself", U.emp1, "create", "hrLetters/L1", undefined, letter(U.emp1))
allow("hrLetters fileLetter — HR manager for an employee", U.hrm, "create", "hrLetters/L1", undefined, letter(U.hrm))
allow("hrLetters fileLetter — gov-level embassy letter by the employee", U.emp1, "create", "hrLetters/L1", undefined, letter(U.emp1, { kind: "emb", signerLevel: "gov" }))
allow("hrLetters fileLetter — HR manager's own letter, management level", U.hrm, "create", "hrLetters/L1", undefined, letter(U.hrm, { employeeId: "ehm", employeeUserId: U.hrm, signerLevel: "management", onBehalf: false }))
deny("hrLetters fileLetter — employee for ANOTHER employee", U.emp1, "create", "hrLetters/L1", undefined, letter(U.emp1, { employeeId: "e2", employeeUserId: U.emp2 }))
deny("hrLetters fileLetter — government relations for someone", U.gov, "create", "hrLetters/L1", undefined, letter(U.gov))
deny("hrLetters fileLetter — management for someone", U.mgmt, "create", "hrLetters/L1", undefined, letter(U.mgmt))
deny("hrLetters fileLetter — an extra field", U.emp1, "create", "hrLetters/L1", undefined, letter(U.emp1, { salary: 1 }))
deny("hrLetters fileLetter — unknown kind", U.emp1, "create", "hrLetters/L1", undefined, letter(U.emp1, { kind: "visa" }))
deny("hrLetters fileLetter — unknown signer level", U.emp1, "create", "hrLetters/L1", undefined, letter(U.emp1, { signerLevel: "owner" }))
deny("hrLetters fileLetter — born issued", U.emp1, "create", "hrLetters/L1", undefined, letter(U.emp1, { state: "issued" }))
deny("hrLetters fileLetter — other company", U.stranger, "create", "hrLetters/L1", undefined, letter(U.stranger))
const issuePatch = (b: Data, uid: string, over: Data = {}): Data => patch(b, { state: "issued", serial: "LT-2026/001", issuedOn: today, text: null, card: { no: 1 }, head: { name: null, cr: null, mol: null }, travel: null, decision: { ...stampOf(uid), role: "manager", ownFlagged: false }, updatedAt: T2, ...over })
const declinePatch = (b: Data, uid: string, note = "no"): Data => patch(b, { state: "declined", decision: { ...stampOf(uid), note, role: "manager", ownFlagged: false }, updatedAt: T2 })
matrix("hrLetters issueLetter — manager-level", "update", "hrLetters/L1", pend, (uid) => issuePatch(pend, uid), [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.fin, U.emp1, U.stranger])
const govLetter = letter(U.emp1, { kind: "emb", signerLevel: "gov" })
allow("hrLetters issueLetter — gov-level by government relations", U.gov, "update", "hrLetters/L1", govLetter, issuePatch(govLetter, U.gov))
allow("hrLetters issueLetter — gov-level by the HR manager standing in", U.hrm, "update", "hrLetters/L1", govLetter, issuePatch(govLetter, U.hrm))
deny("hrLetters issueLetter — gov-level by management", U.mgmt, "update", "hrLetters/L1", govLetter, issuePatch(govLetter, U.mgmt))
const mgLetter = letter(U.hrm, { employeeId: "ehm", employeeUserId: U.hrm, signerLevel: "management" })
allow("hrLetters issueLetter — management-level (the HR manager's own) by management", U.mgmt, "update", "hrLetters/L1", mgLetter, issuePatch(mgLetter, U.mgmt))
deny("hrLetters issueLetter — management-level by the HR manager himself", U.hrm, "update", "hrLetters/L1", mgLetter, issuePatch(mgLetter, U.hrm))
deny("hrLetters issueLetter — management-level by another HR manager", U.hrm2, "update", "hrLetters/L1", mgLetter, issuePatch(mgLetter, U.hrm2))
deny("hrLetters issueLetter — manager-level letter for the signer's own record", U.hrm, "update", "hrLetters/L1", letter(U.hrm, { employeeId: "ehm", employeeUserId: U.hrm }), issuePatch(letter(U.hrm, { employeeId: "ehm", employeeUserId: U.hrm }), U.hrm))
allow("hrLetters issueLetter — owner signs his own (flagged)", U.owner, "update", "hrLetters/L1", letter(U.owner, { employeeUserId: U.owner }), issuePatch(letter(U.owner, { employeeUserId: U.owner }), U.owner))
deny("hrLetters issueLetter — serial in a wrong format", U.hrm, "update", "hrLetters/L1", pend, issuePatch(pend, U.hrm, { serial: "X-1" }))
deny("hrLetters issueLetter — decision recorded under another user", U.hrm, "update", "hrLetters/L1", pend, issuePatch(pend, U.gov))
deny("hrLetters issueLetter — also edits the addressee", U.hrm, "update", "hrLetters/L1", pend, issuePatch(pend, U.hrm, { addressee: "other" }))
deny("hrLetters issueLetter — already issued", U.hrm, "update", "hrLetters/L1", issuePatch(pend, U.hrm), issuePatch(issuePatch(pend, U.hrm), U.hrm, { serial: "LT-2026/002" }))
allow("hrLetters declineLetter — with a reason", U.hrm, "update", "hrLetters/L1", pend, declinePatch(pend, U.hrm))
deny("hrLetters declineLetter — without a reason", U.hrm, "update", "hrLetters/L1", pend, declinePatch(pend, U.hrm, ""))
deny("hrLetters declineLetter — payroll", U.pay, "update", "hrLetters/L1", pend, declinePatch(pend, U.pay))
deny("hrLetters delete", U.owner, "delete", "hrLetters/L1", pend, undefined)

const lpay = (emp = "e1", userId: string | null = U.emp1, over: Data = {}): Data => ({ organizationId: ORG, employeeId: emp, employeeUserId: userId, basic: 4000, housing: 1000, transport: 400, updatedAt: T, ...over })
const lpOv = (emp = "e1", userId: string | null = U.emp1, state = "pending") => ({ overrides: { "hrLetters/L1": letter(U.emp1, { employeeId: emp, employeeUserId: userId, state }) }, afterDocs: { "hrLetters/L1": letter(U.emp1, { employeeId: emp, employeeUserId: userId, state }) } })
matrix("hrLetterPay get", "get", "hrLetterPay/L1", lpay(), undefined, [U.hrm, U.pay, U.mgmt, U.emp1], [U.gov, U.sup1, U.emp2, U.fin, U.plain, U.stranger])
allow("hrLetterPay fileLetter — the employee copies his own figures", U.emp1, "create", "hrLetterPay/L1", undefined, lpay(), lpOv())
allow("hrLetterPay fileLetter — HR manager copies the employee's figures", U.hrm, "create", "hrLetterPay/L1", undefined, lpay(), lpOv())
deny("hrLetterPay fileLetter — figures differ from employeePay", U.emp1, "create", "hrLetterPay/L1", undefined, lpay("e1", U.emp1, { basic: 9000 }), lpOv())
deny("hrLetterPay fileLetter — for another employee's pay", U.emp1, "create", "hrLetterPay/L1", undefined, lpay("e2", U.emp2, { basic: 3000, housing: 750, transport: 300 }), lpOv("e2", U.emp2))
deny("hrLetterPay fileLetter — government relations", U.gov, "create", "hrLetterPay/L1", undefined, lpay(), lpOv())
deny("hrLetterPay fileLetter — supervisor", U.sup1, "create", "hrLetterPay/L1", undefined, lpay(), lpOv())
deny("hrLetterPay fileLetter — letter names another employee than the copy", U.emp1, "create", "hrLetterPay/L1", undefined, lpay(), lpOv("e2", U.emp2))
deny("hrLetterPay fileLetter — extra field", U.emp1, "create", "hrLetterPay/L1", undefined, lpay("e1", U.emp1, { net: 1 }), lpOv())
allow("hrLetterPay issueLetter refresh while pending — HR manager", U.hrm, "update", "hrLetterPay/L1", lpay("e1", U.emp1, { basic: 3900 }), lpay(), lpOv())
allow("hrLetterPay issueLetter refresh while pending — payroll officer", U.pay, "update", "hrLetterPay/L1", lpay("e1", U.emp1, { basic: 3900 }), lpay(), lpOv())
deny("hrLetterPay refresh after the letter was issued", U.hrm, "update", "hrLetterPay/L1", lpay("e1", U.emp1, { basic: 3900 }), lpay(), lpOv("e1", U.emp1, "issued"))
deny("hrLetterPay delete", U.owner, "delete", "hrLetterPay/L1", lpay(), undefined)

// ---------------------------------------------------------------------------
// hrInjuries
// ---------------------------------------------------------------------------

const injury = (by: string, over: Data = {}): Data => ({ organizationId: ORG, employeeId: "e1", employeeUserId: U.emp1, employeeName: "a", siteId: S1, on: riyadhDay(-1), description: "cut", due: riyadhDay(2), recorded: stampOf(by), report: null, updatedAt: T, ...over })
matrix("hrInjuries get (e1, site1)", "get", "hrInjuries/i1", injury(U.sup1), undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1, U.emp1], [U.sup2, U.emp2, U.fin, U.plain, U.stranger])
matrix("hrInjuries list", "list", "hrInjuries/i1", injury(U.sup1), undefined, [U.hrm, U.gov, U.sup1, U.emp1], [U.sup2, U.emp2])
matrix("hrInjuries recordInjury on e1 (site1)", "create", "hrInjuries/i1", undefined, (uid) => injury(uid), [U.hrm, U.gov, U.sup1, U.owner], [U.sup2, U.pay, U.mgmt, U.fin, U.emp1, U.stranger])
deny("hrInjuries create — employeeUserId differs from the record's link", U.hrm, "create", "hrInjuries/i1", undefined, injury(U.hrm, { employeeUserId: U.emp2 }))
deny("hrInjuries create — report pre-filled", U.hrm, "create", "hrInjuries/i1", undefined, injury(U.hrm, { report: { no: "1" } }))
deny("hrInjuries create — recorded.by is someone else", U.hrm, "create", "hrInjuries/i1", undefined, injury(U.gov))
deny("hrInjuries create — supervisor on an unassigned worker", U.sup1, "create", "hrInjuries/i1", undefined, injury(U.sup1, { employeeId: "e3", employeeUserId: null, siteId: null }))
allow("hrInjuries create — government relations on an unassigned worker", U.gov, "create", "hrInjuries/i1", undefined, injury(U.gov, { employeeId: "e3", employeeUserId: null, siteId: null }))
const rep = (uid: string) => patch(injury(U.sup1), { report: { no: "G1", on: today, by: uid, byName: "n" }, updatedAt: T2 })
matrix("hrInjuries recordInjuryReport", "update", "hrInjuries/i1", injury(U.sup1), (uid) => rep(uid), [U.gov, U.hrm, U.owner], [U.sup1, U.pay, U.mgmt, U.emp1, U.stranger])
deny("hrInjuries report a second time", U.gov, "update", "hrInjuries/i1", patch(injury(U.sup1), { report: { no: "G0" } }), rep(U.gov))
deny("hrInjuries report also edits the description", U.gov, "update", "hrInjuries/i1", injury(U.sup1), patch(rep(U.gov), { description: "other" }))
deny("hrInjuries delete", U.owner, "delete", "hrInjuries/i1", injury(U.sup1), undefined)

// ---------------------------------------------------------------------------
// hrAssignFixes
// ---------------------------------------------------------------------------

const fix = (by: string, siteId = S1, over: Data = {}): Data => ({ organizationId: ORG, siteId, since: today, note: null, by, byName: "n", at: T, state: "pending", decision: null, employeeId: null, idNo: "123", employeeName: "w", fromSiteId: null, updatedAt: T, ...over })
matrix("hrAssignFixes get (site1)", "get", "hrAssignFixes/f1", fix(U.sup1), undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1], [U.sup2, U.emp1, U.fin, U.plain, U.stranger])
matrix("hrAssignFixes raiseAssignFix on site1", "create", "hrAssignFixes/f1", undefined, (uid) => fix(uid), [U.hrm, U.sup1, U.owner], [U.sup2, U.gov, U.pay, U.mgmt, U.emp1, U.stranger])
deny("hrAssignFixes raise — supervisor for the UNASSIGNED pseudo-site", U.sup1, "create", "hrAssignFixes/f1", undefined, fix(U.sup1, "__unassigned"))
allow("hrAssignFixes raise — HR manager for the unassigned pseudo-site", U.hrm, "create", "hrAssignFixes/f1", undefined, fix(U.hrm, "__unassigned"))
deny("hrAssignFixes raise — born done", U.hrm, "create", "hrAssignFixes/f1", undefined, fix(U.hrm, S1, { state: "done" }))
deny("hrAssignFixes raise — raised in another's name", U.hrm, "create", "hrAssignFixes/f1", undefined, fix(U.sup1))
const fixDone = (uid: string, over: Data = {}) => patch(fix(U.sup1), { state: "done", decision: { by: uid, byName: "n", at: T, note: "moved" }, employeeId: "e3", employeeName: "c", fromSiteId: null, updatedAt: T2, ...over })
matrix("hrAssignFixes decideAssignFix", "update", "hrAssignFixes/f1", fix(U.sup1), (uid) => fixDone(uid), [U.hrm, U.owner], [U.sup1, U.gov, U.pay, U.mgmt, U.emp1, U.stranger])
allow("hrAssignFixes decideAssignFix decline", U.hrm, "update", "hrAssignFixes/f1", fix(U.sup1), patch(fix(U.sup1), { state: "declined", decision: { by: U.hrm, byName: "n", at: T, note: "no" }, updatedAt: T2 }))
deny("hrAssignFixes decide a second time", U.hrm, "update", "hrAssignFixes/f1", fixDone(U.hrm), patch(fixDone(U.hrm), { state: "declined", updatedAt: T2 }))
deny("hrAssignFixes decide — also changes the site raised for", U.hrm, "update", "hrAssignFixes/f1", fix(U.sup1), fixDone(U.hrm, { siteId: S2 }))
deny("hrAssignFixes delete", U.owner, "delete", "hrAssignFixes/f1", fix(U.sup1), undefined)

// ---------------------------------------------------------------------------
// hrGovTasks
// ---------------------------------------------------------------------------

const govId = (k: string) => `hrGovTasks/${ORG}__${k}`
const govDoc = (key: string, kind: string, by: string, over: Data = {}): Data => ({ organizationId: ORG, kind, key, pf: "qiwa", code: "pay", employeeId: "e1", ...stampOf(by), updatedAt: T, ...over })
matrix("hrGovTasks get", "get", govId("k1"), govDoc("k1", "task", U.gov), undefined, [U.hrm, U.gov, U.pay, U.mgmt], [U.sup1, U.emp1, U.fin, U.plain, U.stranger])
matrix("hrGovTasks get that does not exist", "get", govId("k1"), undefined, undefined, [U.hrm, U.gov, U.pay, U.mgmt], [U.sup1, U.emp1, U.fin])
matrix("hrGovTasks recordPlatformDone (create kind done)", "create", govId("k1"), undefined, (uid) => govDoc("k1", "done", uid), [U.gov, U.hrm], [U.sup1, U.emp1, U.fin, U.stranger])
allow("hrGovTasks recordQiwaPayTask (kind task) — written beside a pay change by the HR manager", U.hrm, "create", govId("k2"), undefined, govDoc("k2", "task", U.hrm, { on: today }))
allow("hrGovTasks recordQiwaPayTask — beside a pay change by management", U.mgmt, "create", govId("k2"), undefined, govDoc("k2", "task", U.mgmt, { on: today }))
allow("hrGovTasks saveReconciliation (kind recon) — government relations", U.gov, "create", govId("recon:muqeem"), undefined, govDoc("recon:muqeem", "recon", U.gov, { pf: "muqeem" }))
deny("hrGovTasks create — unknown kind", U.gov, "create", govId("k1"), undefined, govDoc("k1", "note", U.gov))
deny("hrGovTasks create — id does not match key", U.gov, "create", govId("k3"), undefined, govDoc("k1", "done", U.gov))
deny("hrGovTasks create — by is someone else", U.gov, "create", govId("k1"), undefined, govDoc("k1", "done", U.hrm))
allow("hrGovTasks reconciliation replaced — same author", U.gov, "update", govId("recon:muqeem"), govDoc("recon:muqeem", "recon", U.hrm), govDoc("recon:muqeem", "recon", U.gov, { diff: 3, updatedAt: T2 }))
deny("hrGovTasks a done record is never rewritten", U.gov, "update", govId("k1"), govDoc("k1", "done", U.gov), govDoc("k1", "done", U.gov, { ref: "x" }))
deny("hrGovTasks a task is never rewritten", U.hrm, "update", govId("k2"), govDoc("k2", "task", U.hrm), govDoc("k2", "task", U.hrm, { due: "x" }))
deny("hrGovTasks reconciliation replaced — by is someone else", U.gov, "update", govId("recon:muqeem"), govDoc("recon:muqeem", "recon", U.gov), govDoc("recon:muqeem", "recon", U.hrm))
deny("hrGovTasks delete", U.owner, "delete", govId("k1"), govDoc("k1", "done", U.gov), undefined)

// ---------------------------------------------------------------------------
// hrHiring
// ---------------------------------------------------------------------------

const opening = (over: Data = {}): Data => ({ organizationId: ORG, kind: "opening", pay: false, no: "OP-2026/001", trade: "mason", q: 2, filled: 0, siteId: S1, need: "x", track: "batch", state: "open", opened: stampOf(U.hrm), batch: { stage: "auth", visas: 0 }, updatedAt: T, ...over })
const cand = (over: Data = {}): Data => ({ organizationId: ORG, kind: "candidate", pay: false, openingId: "o1", trade: "mason", siteId: S1, names: { ar: "x" }, stage: "int", sc: { rec: true }, offer: null, employeeId: null, updatedAt: T, ...over })
const candPay = (over: Data = {}): Data => ({ organizationId: ORG, kind: "offer", pay: true, candidateId: "c1", openingId: "o1", ask: 3000, basic: null, updatedAt: T, ...over })
matrix("hrHiring get an opening", "get", "hrHiring/o1", opening(), undefined, [U.hrm, U.gov, U.pay, U.mgmt], [U.sup1, U.emp1, U.fin, U.stranger])
matrix("hrHiring get a candidate's pay document", "get", "hrHiring/c1__pay", candPay(), undefined, [U.hrm, U.pay, U.mgmt], [U.gov, U.sup1, U.emp1])
matrix("hrHiring get a document that does not exist (first offer)", "get", "hrHiring/c1__pay", undefined, undefined, [U.hrm], [U.gov, U.pay, U.mgmt, U.sup1])
matrix("hrHiring list openings", "list", "hrHiring/o1", opening(), undefined, [U.hrm, U.gov, U.pay, U.mgmt], [U.sup1, U.emp1])
matrix("hrHiring openOpening / addCandidate / pay doc (create)", "create", "hrHiring/o1", undefined, opening(), [U.hrm, U.owner], [U.gov, U.pay, U.mgmt, U.sup1, U.emp1, U.stranger])
allow("hrHiring addCandidate (candidate)", U.hrm, "create", "hrHiring/c1", undefined, cand())
allow("hrHiring addCandidate (candidate pay)", U.hrm, "create", "hrHiring/c1__pay", undefined, candPay())
matrix("hrHiring makeOffer / screenCandidate / answerOffer on a candidate", "update", "hrHiring/c1", cand(), patch(cand(), { stage: "offer", offer: { state: "sent" }, updatedAt: T2 }), [U.hrm], [U.pay, U.sup1, U.emp1, U.stranger])
allow("hrHiring makeOffer (pay doc) — HR manager", U.hrm, "update", "hrHiring/c1__pay", candPay(), patch(candPay(), { basic: 3200, updatedAt: T2 }))
deny("hrHiring government relations edits a candidate's pay doc", U.gov, "update", "hrHiring/c1__pay", candPay(), patch(candPay(), { basic: 9, updatedAt: T2 }))
deny("hrHiring management edits a candidate's pay doc", U.mgmt, "update", "hrHiring/c1__pay", candPay(), patch(candPay(), { basic: 9, updatedAt: T2 }))
allow("hrHiring batchStep (batch) — government relations", U.gov, "update", "hrHiring/o1", opening(), patch(opening(), { batch: { stage: "test", visas: 0, agency: "a" }, updatedAt: T2 }))
allow("hrHiring createEmployee fills the opening (filled, state, batch) — government relations", U.gov, "update", "hrHiring/o1", opening(), patch(opening(), { filled: 1, state: "filled", batch: { stage: "arr", visas: 1 }, updatedAt: T2 }))
allow("hrHiring createEmployee marks the candidate hired (stage, employeeId) — government relations", U.gov, "update", "hrHiring/c1", cand({ stage: "acc" }), patch(cand({ stage: "acc" }), { stage: "hired", employeeId: "e9", updatedAt: T2 }))
deny("hrHiring government relations edits the opening's headcount", U.gov, "update", "hrHiring/o1", opening(), patch(opening(), { q: 50, updatedAt: T2 }))
deny("hrHiring government relations touches a pay doc via stage", U.gov, "update", "hrHiring/c1__pay", candPay(), patch(candPay(), { stage: "hired", updatedAt: T2 }))
allow("hrHiring decidePosition approve (state, okBy) — management", U.mgmt, "update", "hrHiring/o1", opening({ state: "wait" }), patch(opening({ state: "wait" }), { state: "open", okBy: stampOf(U.mgmt), updatedAt: T2 }))
allow("hrHiring decidePosition decline (state closed) — management", U.mgmt, "update", "hrHiring/o1", opening({ state: "wait" }), patch(opening({ state: "wait" }), { state: "closed", closedBy: stampOf(U.mgmt), updatedAt: T2 }))
allow("hrHiring decideOffer approve (offer) — management", U.mgmt, "update", "hrHiring/c1", cand({ stage: "offer", offer: { state: "mg" } }), patch(cand({ stage: "offer", offer: { state: "mg" } }), { offer: { state: "sent", okBy: stampOf(U.mgmt) }, updatedAt: T2 }))
allow("hrHiring decideOffer return (stage int, offer null) — management", U.mgmt, "update", "hrHiring/c1", cand({ stage: "offer", offer: { state: "mg" } }), patch(cand({ stage: "offer", offer: { state: "mg" } }), { stage: "int", offer: null, updatedAt: T2 }))
deny("hrHiring management edits the opening's headcount", U.mgmt, "update", "hrHiring/o1", opening(), patch(opening(), { q: 50, updatedAt: T2 }))
deny("hrHiring management on a pay doc", U.mgmt, "update", "hrHiring/c1__pay", candPay(), patch(candPay(), { offer: {}, updatedAt: T2 }))
deny("hrHiring kind changed", U.hrm, "update", "hrHiring/o1", opening(), patch(opening(), { kind: "candidate", updatedAt: T2 }))
deny("hrHiring delete", U.owner, "delete", "hrHiring/o1", opening(), undefined)

// ---------------------------------------------------------------------------
// hrTraining and hrReviews
// ---------------------------------------------------------------------------

const session = (over: Data = {}): Data => ({ organizationId: ORG, kind: "session", course: "safety", at: "2026-11-01", seats: 10, ppl: ["e1"], state: "plan", by: U.hrm, updatedAt: T, ...over })
matrix("hrTraining get", "get", "hrTraining/s1", session(), undefined, [U.hrm, U.gov, U.sup1, U.emp1, U.plain], [U.stranger])
matrix("hrTraining scheduleSession (create)", "create", "hrTraining/s1", undefined, session(), [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.mgmt, U.emp1, U.stranger])
matrix("hrTraining recordSessionResult (update)", "update", "hrTraining/s1", session(), patch(session(), { state: "done", abs: [], done: stampOf(U.hrm), event: null, updatedAt: T2 }), [U.hrm], [U.gov, U.sup1, U.mgmt, U.emp1])

const cycleId = `${ORG}__2026-01-01`
const cycle = (over: Data = {}): Data => ({ organizationId: ORG, kind: "cycle", open: "2026-01-01", close: "2026-12-31", year: "2026", raise: null, ...stampOf(U.hrm), updatedAt: T, ...over })
const review = (over: Data = {}): Data => ({ organizationId: ORG, kind: "review", cycleId, employeeId: "e1", employeeUserId: U.emp1, employeeName: "a", siteId: S1, raterEmployeeId: null, raterUserId: U.sup1, hrm: false, st: "draft", rec: {}, updatedAt: T, ...over })
const revId = `hrReviews/${cycleId}__e1`
matrix("hrReviews get a cycle", "get", `hrReviews/${cycleId}`, cycle(), undefined, [U.hrm, U.gov, U.pay, U.mgmt, U.sup1, U.emp1, U.plain], [U.stranger])
matrix("hrReviews get a DRAFT review of e1 (rater sup1)", "get", revId, review(), undefined, [U.hrm, U.mgmt, U.sup1, U.owner], [U.emp1, U.gov, U.pay, U.sup2, U.emp2, U.plain, U.fin, U.stranger])
matrix("hrReviews get an APPROVED review of e1", "get", revId, review({ st: "ok" }), undefined, [U.hrm, U.mgmt, U.sup1, U.emp1], [U.emp2, U.gov, U.pay, U.sup2])
const selfDoc = (over: Data = {}): Data => ({ organizationId: ORG, kind: "self", st: "self", review: `${cycleId}__e1`, employeeId: "e1", employeeUserId: U.emp1, sc: {}, note: null, at: T, ...over })
allow("hrReviews get a self-assessment — the rater of the review it belongs to", U.sup1, "get", `hrReviews/${cycleId}__e1__self`, selfDoc(), undefined, { overrides: { [revId]: review() } })
allow("hrReviews get a self-assessment — the employee himself", U.emp1, "get", `hrReviews/${cycleId}__e1__self`, selfDoc(), undefined, { overrides: { [revId]: review() } })
deny("hrReviews get a self-assessment — another employee", U.emp2, "get", `hrReviews/${cycleId}__e1__self`, selfDoc(), undefined, { overrides: { [revId]: review() } })
matrix("hrReviews openCycle (create cycle)", "create", `hrReviews/${cycleId}`, undefined, cycle(), [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.mgmt, U.emp1, U.stranger])
matrix("hrReviews openCycle (create review)", "create", revId, undefined, review(), [U.hrm], [U.gov, U.pay, U.sup1, U.mgmt, U.emp1])
deny("hrReviews create a review already scored", U.hrm, "create", revId, undefined, review({ sc: { o: "A" } }))
allow("hrReviews submitSelfReview — the employee for himself", U.emp1, "create", `hrReviews/${cycleId}__e1__self`, undefined, selfDoc())
deny("hrReviews submitSelfReview — for another employee", U.emp2, "create", `hrReviews/${cycleId}__e1__self`, undefined, selfDoc())
deny("hrReviews submitSelfReview — wrong document id", U.emp1, "create", `hrReviews/${cycleId}__e1__x`, undefined, selfDoc())
const approveRev = (b: Data, uid: string) => patch(b, { st: "ok", score: 80, band: "B", okBy: uid, okByName: "n", okAt: T, updatedAt: T2 })
const sentRev = review({ st: "done" })
matrix("hrReviews approveReviews (a rater's review)", "update", revId, sentRev, (uid) => approveRev(sentRev, uid), [U.hrm, U.owner], [U.mgmt, U.sup1, U.emp1, U.gov, U.pay, U.stranger])
const mgRev = review({ st: "done", raterUserId: null, hrm: true, employeeId: "ehm", employeeUserId: U.hrm })
allow("hrReviews approveReviews — management approves the HR manager's (no rater)", U.mgmt, "update", revId, mgRev, approveRev(mgRev, U.mgmt))
deny("hrReviews approveReviews — HR manager approves HIS OWN", U.hrm, "update", revId, mgRev, approveRev(mgRev, U.hrm))
deny("hrReviews approveReviews — the review is already a self-assessment", U.hrm, "update", `hrReviews/${cycleId}__e1__self`, selfDoc(), patch(selfDoc(), { st: "ok" }))
allow("hrReviews returnReviews (st draft) — HR manager", U.hrm, "update", revId, sentRev, patch(sentRev, { st: "draft", updatedAt: T2 }))
const graded = (uid: string) => patch(review(), { sc: { o: "A" }, rated: stampOf(uid), updatedAt: T2 })
allow("hrReviews gradeWorker — the rater", U.sup1, "update", revId, review(), graded(U.sup1))
allow("hrReviews submitStaffReview — the rater (sc, need, note, st done)", U.sup1, "update", revId, review(), patch(review(), { sc: { g: 3, q: 3, i: 3, t: 3 }, need: null, note: null, st: "done", rated: stampOf(U.sup1), updatedAt: T2 }))
deny("hrReviews grade — a user who is not the rater", U.sup2, "update", revId, review(), graded(U.sup2))
deny("hrReviews grade — after the review was sent", U.sup1, "update", revId, sentRev, graded(U.sup1))
deny("hrReviews grade — rater also writes the band", U.sup1, "update", revId, review(), patch(graded(U.sup1), { band: "A" }))
deny("hrReviews grade — rater approves his own set (st ok)", U.sup1, "update", revId, review(), patch(review(), { st: "ok", updatedAt: T2 }))
allow("hrReviews acknowledgeReview — the employee", U.emp1, "update", revId, review({ st: "ok" }), patch(review({ st: "ok" }), { st: "ack", ackAt: T, updatedAt: T2 }))
deny("hrReviews acknowledgeReview — before approval", U.emp1, "update", revId, review(), patch(review(), { st: "ack", ackAt: T, updatedAt: T2 }))
deny("hrReviews acknowledgeReview — another employee", U.emp2, "update", revId, review({ st: "ok" }), patch(review({ st: "ok" }), { st: "ack", ackAt: T, updatedAt: T2 }))
allow("hrReviews proposeRaises (cycle raise) — HR manager", U.hrm, "update", `hrReviews/${cycleId}`, cycle(), patch(cycle(), { raise: { state: "mg", eff: "2026-12-01" }, updatedAt: T2 }))
allow("hrReviews decideRaises (cycle raise) — management", U.mgmt, "update", `hrReviews/${cycleId}`, cycle({ raise: { state: "mg" } }), patch(cycle({ raise: { state: "mg" } }), { raise: { state: "ok" }, updatedAt: T2 }))
deny("hrReviews decideRaises — also edits the cycle's dates", U.mgmt, "update", `hrReviews/${cycleId}`, cycle(), patch(cycle(), { raise: { state: "ok" }, close: "2027-01-01", updatedAt: T2 }))
allow("hrReviews applyRaises marks the review raised — HR manager", U.hrm, "update", revId, review({ st: "ok" }), patch(review({ st: "ok" }), { raised: { on: "2026-12-01", at: T }, updatedAt: T2 }))
allow("hrReviews applyRaises marks the HR manager's review raised — management", U.mgmt, "update", revId, review({ st: "ok", raterUserId: null, hrm: true, employeeId: "ehm", employeeUserId: U.hrm }), patch(review({ st: "ok", raterUserId: null, hrm: true, employeeId: "ehm", employeeUserId: U.hrm }), { raised: { on: "2026-12-01", at: T }, updatedAt: T2 }))

// ---------------------------------------------------------------------------
// manpowerRequests
// ---------------------------------------------------------------------------

const mpDoc = (by: string, over: Data = {}): Data => ({ organizationId: ORG, no: "MP-2026/001", projectId: "p1", projectName: "P", siteId: S1, trade: "mason", count: 3, from: today, note: null, state: "open", requested: stampOf(by), answer: null, updatedAt: T, ...over })
const pmProject: Data = { organizationId: ORG, projectManagerId: U.plain, pmHandoverId: "h1", pm: { no: "PJ-1" } }
const projOv = { overrides: { "projects/p1": pmProject } }
matrix("manpowerRequests get", "get", "manpowerRequests/m1", mpDoc(U.plain), undefined, [U.hrm, U.gov, U.sup1, U.plain, U.emp1, U.owner], [U.stranger])
allow("manpowerRequests raiseManpowerRequest — the PM project's manager", U.plain, "create", "manpowerRequests/m1", undefined, mpDoc(U.plain), projOv)
allow("manpowerRequests raiseManpowerRequest — owner", U.owner, "create", "manpowerRequests/m1", undefined, mpDoc(U.owner), projOv)
deny("manpowerRequests raise — a member with no project permission", U.emp1, "create", "manpowerRequests/m1", undefined, mpDoc(U.emp1), projOv)
deny("manpowerRequests raise — requested.by is someone else", U.plain, "create", "manpowerRequests/m1", undefined, mpDoc(U.owner), projOv)
deny("manpowerRequests raise — born answered", U.plain, "create", "manpowerRequests/m1", undefined, mpDoc(U.plain, { state: "answered" }), projOv)
deny("manpowerRequests raise — answer pre-filled", U.plain, "create", "manpowerRequests/m1", undefined, mpDoc(U.plain, { answer: { by: U.plain } }), projOv)
deny("manpowerRequests raise — other company", U.stranger, "create", "manpowerRequests/m1", undefined, mpDoc(U.stranger), projOv)
const answered = (b: Data) => patch(b, { state: "answered", answer: { plan: [], by: U.hrm }, updatedAt: T2 })
matrix("manpowerRequests answerManpowerRequest", "update", "manpowerRequests/m1", mpDoc(U.plain), answered(mpDoc(U.plain)), [U.hrm, U.owner], [U.gov, U.pay, U.sup1, U.mgmt, U.plain, U.emp1, U.stranger])
allow("manpowerRequests withdraw — the requester", U.plain, "update", "manpowerRequests/m1", mpDoc(U.plain), patch(mpDoc(U.plain), { state: "withdrawn", updatedAt: T2 }))
deny("manpowerRequests withdraw — someone else", U.emp1, "update", "manpowerRequests/m1", mpDoc(U.plain), patch(mpDoc(U.plain), { state: "withdrawn", updatedAt: T2 }))
const ans = answered(mpDoc(U.plain))
allow("manpowerRequests acceptManpowerPlan — the requester", U.plain, "update", "manpowerRequests/m1", ans, patch(ans, { accepted: stampOf(U.plain), updatedAt: T2 }), projOv)
deny("manpowerRequests acceptManpowerPlan — a stranger to the project", U.emp1, "update", "manpowerRequests/m1", ans, patch(ans, { accepted: stampOf(U.emp1), updatedAt: T2 }), projOv)
deny("manpowerRequests acceptManpowerPlan twice", U.plain, "update", "manpowerRequests/m1", patch(ans, { accepted: stampOf(U.plain) }), patch(ans, { accepted: stampOf(U.hrm), updatedAt: T2 }), projOv)
deny("manpowerRequests delete", U.owner, "delete", "manpowerRequests/m1", mpDoc(U.plain), undefined)

// ---------------------------------------------------------------------------

runAll(cases).then((bad) => process.exit(bad ? 1 : 0))

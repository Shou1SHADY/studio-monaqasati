// Project Management + Accounting + core rules, run against the REAL firestore.rules through Google's rules-test API.
// Hermetic: every document the rules may read is in BASE_WORLD / the case's `over`; anything else answers "does not exist".
// Same request/mocks shape as sim.ts, but the known documents are mocked up front (one or two API rounds per case),
// the gcloud token is fetched once and cases run in parallel. UAT is not read and nothing is written anywhere.

import { createHash } from "crypto"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import type { Method } from "./sim"

type D = Record<string, unknown>
type Over = Record<string, D | null>
type Expect = "ALLOW" | "DENY"

interface Spec {
  name: string
  uid: string | null
  method: Method
  path: string
  expect: Expect
  before?: D
  after?: D
  over?: Over
  nullResource?: boolean
}

const PROJECT = "mdmaktech-uat"
const ROOT = "/databases/(default)/documents/"
const NOW = "2026-10-08T10:00:00Z"
const TODAY = "2026-10-08"

const rules = fs.readFileSync(process.env.RULES_FILE ?? path.join(process.cwd(), "firestore.rules"), "utf8")
let cachedToken = ""
const token = () => (cachedToken ||= execSync("gcloud auth print-access-token", { encoding: "utf8", env: process.env }).trim())
const decode = (p: string) => decodeURIComponent(p).replace(ROOT, "")

interface TestResult {
  state: string
  debugMessages?: string[]
  functionCalls?: Array<{ function: string; args: string[] }>
  visitedExpressions?: Array<{ sourcePosition?: { line?: number }; value?: unknown }>
  errors?: unknown
}

async function callMany(cases: Array<{ testCase: unknown; mocks: unknown[] }>): Promise<TestResult[]> {
  const body = JSON.stringify({
    source: { files: [{ name: "firestore.rules", content: rules }] },
    testSuite: { testCases: cases.map((c) => ({ ...(c.testCase as object), functionMocks: c.mocks })) },
  })
  let last = "rules test failed"
  for (let attempt = 0; attempt < 40; attempt++) {
    const t0 = Date.now()
    let res: Response
    try {
      res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.API_TIMEOUT ?? 100000)),
      headers: { Authorization: `Bearer ${token()}`, "x-goog-user-project": PROJECT, "Content-Type": "application/json" },
      body,
      })
    } catch (err) {
      last = (err as Error).message
      if (process.env.VERBOSE) console.error("fetch failed", attempt, last.slice(0, 100), Date.now() - t0, "ms")
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    const json = (await res.json().catch(() => ({ error: { message: "bad json " + res.status } }))) as { testResults?: TestResult[]; error?: { message: string } }
    if (process.env.VERBOSE) console.error("api", cases.length, "cases", Date.now() - t0, "ms", res.status)
    if (json.testResults && json.testResults.length === cases.length) return json.testResults
    last = json.error?.message ?? last
    if (res.status === 401) cachedToken = ""
    if (process.env.VERBOSE) console.error("retry", attempt, last.slice(0, 160))
    await new Promise((r) => setTimeout(r, Math.min(3000 * (attempt + 1), 15000)))
  }
  throw new Error(last)
}

interface Outcome {
  spec: Spec
  got: Expect
  ok: boolean
  stray: string[]
  detail: string
  limit: boolean
}

interface State {
  spec: Spec
  all: Map<string, D | null>
  known: Map<string, D | null>
  preloaded: Set<string>
  r: TestResult | null
  done: boolean
}

const requestOf = (spec: Spec) => ({
  expectation: "ALLOW",
  request: { auth: spec.uid ? { uid: spec.uid, token: {} } : null, path: ROOT + spec.path, method: spec.method, ...(spec.after ? { resource: { data: spec.after } } : {}) },
  ...(spec.before ? { resource: { data: spec.before } } : spec.nullResource ? { resource: null } : {}),
})
const mocksOf = (known: Map<string, D | null>) =>
  [...known].flatMap(([p, d]) => [
    { function: "exists", args: [{ exactValue: ROOT + p }], result: { value: d !== null } },
    { function: "get", args: [{ exactValue: ROOT + p }], result: d === null ? { undefined: {} } : { value: { data: d } } },
  ])

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++])
    })
  )
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveCacheSoon = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveCache(), 200)
}
const CACHE_FILE = process.env.CACHE ?? ""
type Cached = { got: Expect; detail: string; limit: boolean; stray: string[]; visited?: number }
const cache: Record<string, Cached> = CACHE_FILE && fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {}
const saveCache = () => CACHE_FILE && fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
const rulesHash = createHash("sha1").update(rules).digest("hex")
const keyOf = (spec: Spec, world: Over) => createHash("sha1").update(rulesHash + JSON.stringify(spec) + JSON.stringify(world)).digest("hex")

async function evaluate(specs: Spec[], world: Over): Promise<Outcome[]> {
  const fresh = new Map<string, Outcome>()
  const missing = specs.filter((sp) => !cache[keyOf(sp, world)])
  const states: State[] = missing.map((spec) => {
    const all = new Map<string, D | null>(Object.entries({ ...world, ...(spec.over ?? {}) }))
    const seed = new Set<string>(Object.keys(spec.over ?? {}))
    if (spec.uid) {
      seed.add(`users/${spec.uid}`)
      const g = all.get(`users/${spec.uid}`)?.defaultGroupId
      if (typeof g === "string") seed.add(`teamGroups/${g}`)
      seed.add(`projects/${P}/members/${spec.uid}`)
    }
    seed.add(`projects/${P}`)
    const known = new Map<string, D | null>(process.env.FULL ? all : [...seed].map((p) => [p, all.get(p) ?? null] as [string, D | null]))
    return { spec, all, known, preloaded: new Set(known.keys()), r: null, done: false }
  })
  for (let round = 0; round < 8; round++) {
    const todo = states.filter((s) => !s.done)
    if (!todo.length) break
    const size = Number(process.env.CHUNK ?? 6)
    const chunks: State[][] = []
    for (let i = 0; i < todo.length; i += size) chunks.push(todo.slice(i, i + size))
    await pool(chunks, Number(process.env.CONC ?? 6), async (chunk) => {
      const results = await callMany(chunk.map((s) => ({ testCase: requestOf(s.spec), mocks: mocksOf(s.known) })))
      saveCacheSoon()
      chunk.forEach((s, i) => {
        const r = results[i]
        s.r = r
        const wanted = [...new Set((r.functionCalls ?? []).map((f) => decode(f.args[0])))].filter((p) => !s.known.has(p))
        if (wanted.length === 0 || r.state === "SUCCESS") {
          s.done = true
          const debug = process.env.DBG && s.spec.name.includes(process.env.DBG)
          if (!debug) {
            cache[keyOf(s.spec, world)] = {
              got: r.state === "SUCCESS" ? "ALLOW" : "DENY",
              detail: (r.debugMessages ?? []).join(" | ").slice(0, 220),
              limit: /1000 expressions|maximum of/i.test(JSON.stringify({ ...r, visitedExpressions: undefined })),
              stray: [...s.known.keys()].filter((p) => !s.all.has(p)),
              visited: (r.visitedExpressions ?? []).length,
            }
          }
        } else for (const p of wanted) s.known.set(p, s.all.get(p) ?? null)
      })
    })
  }
  const computed = states.map((s) => {
    const r = s.r ?? { state: "FAILURE" }
    const got: Expect = r.state === "SUCCESS" ? "ALLOW" : "DENY"
    const msgs = (r.debugMessages ?? []).join(" | ")
    const falseLines = (r.visitedExpressions ?? []).filter((v) => typeof v.value === "object" && v.value !== null && (v.value as Record<string, unknown>).boolValue === false).map((v) => v.sourcePosition?.line)
    const debug = process.env.DBG && s.spec.name.includes(process.env.DBG)
    return {
      spec: s.spec,
      got,
      ok: got === s.spec.expect,
      stray: [...s.known.keys()].filter((p) => !s.all.has(p)),
      detail: `${msgs.slice(0, 220)}${debug ? " FALSE@" + JSON.stringify(falseLines) + " " + JSON.stringify({ ...r, visitedExpressions: undefined }).slice(0, 1500) : ""}`,
      limit: /1000 expressions|maximum of/i.test(JSON.stringify({ ...r, visitedExpressions: undefined })),
      visited: (r.visitedExpressions ?? []).length,
    }
  })
  computed.forEach((o) => fresh.set(o.spec.name, o))
  return specs.map((sp) => {
    const hit = cache[keyOf(sp, world)]
    if (hit) return { spec: sp, ...hit, ok: hit.got === sp.expect }
    return fresh.get(sp.name) as Outcome
  })
}

const ORG = "t-org"
const U = {
  owner: ORG,
  legacy: "u-legacy",
  pmm: "u-pmm",
  bare: "u-bare",
  cost: "u-cost",
  site: "u-site",
  appr: "u-appr",
  fin: "u-fin",
  acct: "u-acct",
  closer: "u-closer",
  crm: "u-crm",
  edit: "u-edit",
  wh: "u-wh",
  teamm: "u-teamm",
  buyer: "u-buyer",
  plain: "u-plain",
  newbie: "u-newbie",
  hse: "u-hse",
  other: "u-other",
  otherOwner: "o-owner",
  admin: "u-admin",
  sup: "u-sup",
  sup2: "u-sup2",
}
const P = "p1"
const CO = "o-org"

const user = (organizationId: string, extra: D = {}): D => ({ organizationId, role: "Contractor", organizationRole: "member", ...extra })
const group = (permissions: string[], organizationId = ORG): D => ({ organizationId, permissions, isSystem: false })

const TERMS: D = { advance: 0.1, retention: 0.1, retentionCap: 0.05, retentionRelease: "half", defectsDays: 365, basis: "rem", payer: "client", paymentDays: 30 }

const mkPm = (lifecycle: string, extra: D = {}): D => ({
  no: "PJ-2026/001",
  lifecycle,
  kind: "bld",
  startOn: "2026-09-01",
  durationDays: 100,
  signedOn: "2026-08-20",
  terms: TERMS,
  original: lifecycle === "plan" ? null : TERMS,
  startedAt: lifecycle === "plan" ? null : "2026-09-01T00:00:00.000Z",
  sheetCount: 0,
  addendaCount: 0,
  signedCount: 0,
  ipcCount: 0,
  retentionHeld: 0,
  advanceRecovered: 0,
  cutPool: 0,
  wirCount: 0,
  punchCount: 0,
  ncrCount: 0,
  claimCount: 0,
  sampleCount: 0,
  voCount: 0,
  ...extra,
})
const mkProject = (lifecycle: string, over: D = {}, pmExtra: D = {}): D => ({
  organizationId: ORG,
  contractorId: U.pmm,
  name: "P",
  budget: 1000000,
  status: lifecycle === "plan" ? "approved_waiting_start" : "working",
  projectType: "bld",
  clientName: "C",
  projectManagerId: U.pmm,
  projectManagerName: "PM",
  pmHandoverId: "h1",
  sourceOpportunityId: "o1",
  enabledSections: [],
  pm: mkPm(lifecycle, pmExtra),
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})
const legacyProject = (over: D = {}): D => ({ organizationId: ORG, contractorId: U.owner, name: "L", budget: 5000, status: "planning", enabledSections: [], createdAt: NOW, ...over })
const withPm = (p: D, patch: D, top: D = {}): D => ({ ...p, ...top, pm: { ...(p.pm as D), ...patch }, updatedAt: NOW })

const seat = (uid: string, pmRole: string, extra: D = {}): D => ({ userId: uid, pmRole, off: [], from: "2026-01-01", to: null, organizationId: ORG, groupId: null, ...extra })
const seatPath = (uid: string) => `projects/${P}/members/${uid}`

const BASE_WORLD: Over = {
  [`users/${U.owner}`]: { organizationId: ORG, role: "Contractor", organizationRole: "owner" },
  [`users/${U.legacy}`]: { organizationId: ORG, role: "Contractor" },
  [`users/${U.pmm}`]: user(ORG, { defaultGroupId: "g-pm" }),
  [`users/${U.bare}`]: user(ORG, { defaultGroupId: "g-pmbare" }),
  [`users/${U.cost}`]: user(ORG, { defaultGroupId: "g-cost" }),
  [`users/${U.site}`]: user(ORG, { defaultGroupId: "g-site" }),
  [`users/${U.appr}`]: user(ORG, { defaultGroupId: "g-pm" }),
  [`users/${U.fin}`]: user(ORG, { defaultGroupId: "g-fin" }),
  [`users/${U.acct}`]: user(ORG, { defaultGroupId: "g-acct" }),
  [`users/${U.closer}`]: user(ORG, { defaultGroupId: "g-closer" }),
  [`users/${U.crm}`]: user(ORG, { defaultGroupId: "g-crm" }),
  [`users/${U.edit}`]: user(ORG, { defaultGroupId: "g-edit" }),
  [`users/${U.wh}`]: user(ORG, { defaultGroupId: "g-wh" }),
  [`users/${U.teamm}`]: user(ORG, { defaultGroupId: "g-team" }),
  [`users/${U.buyer}`]: user(ORG, { defaultGroupId: "g-buyer" }),
  [`users/${U.plain}`]: user(ORG),
  [`users/${U.newbie}`]: user(ORG, { defaultGroupId: "g-site" }),
  [`users/${U.other}`]: user(CO, { defaultGroupId: "g-oth" }),
  [`users/${U.otherOwner}`]: { organizationId: CO, role: "Contractor", organizationRole: "owner" },
  [`users/${U.admin}`]: { organizationId: "adm", role: "Admin", organizationRole: "owner" },
  [`users/${U.hse}`]: user(ORG, { defaultGroupId: "g-site" }),
  [`users/${U.sup}`]: { organizationId: U.sup, role: "Supplier", organizationRole: "owner" },
  [`users/${U.sup2}`]: { organizationId: U.sup2, role: "Supplier", organizationRole: "owner" },
  "teamGroups/g-pm": group(["projects.view", "projects.edit", "pm.manage"]),
  "teamGroups/g-pmbare": group(["pm.manage"]),
  "teamGroups/g-cost": group(["projects.view", "pm.cost"]),
  "teamGroups/g-site": group(["projects.view", "pm.site"]),
  "teamGroups/g-fin": group(["projects.view", "projects.publish", "offers.view", "offers.accept", "po.approve", "invoices.manage", "accounting.view", "accounting.post"]),
  "teamGroups/g-acct": group(["accounting.view", "accounting.post", "accounting.close"]),
  "teamGroups/g-closer": group(["accounting.close"]),
  "teamGroups/g-crm": group(["projects.view", "crm.close"]),
  "teamGroups/g-edit": group(["projects.view", "projects.edit"]),
  "teamGroups/g-wh": group(["warehouses.manage"]),
  "teamGroups/g-team": group(["team.manage"]),
  "teamGroups/g-buyer": group(["po.approve"]),
  "teamGroups/g-oth": group(["*"], CO),
  [`projects/${P}`]: mkProject("live"),
  [seatPath(U.pmm)]: seat(U.pmm, "pm"),
  [seatPath(U.cost)]: seat(U.cost, "qs"),
  [seatPath(U.site)]: seat(U.site, "site"),
  [seatPath(U.appr)]: seat(U.appr, "other"),
  [seatPath(U.hse)]: seat(U.hse, "hse"),
  [`pmSettings/${ORG}`]: null,
  [`companyModules/${ORG}`]: null,
}

const cases: Spec[] = []
const add = (name: string, uid: string | null, method: Method, p: string, expect: Expect, o: { before?: D; after?: D; over?: Over; nullResource?: boolean } = {}) => {
  cases.push({ name, uid, method, path: p, expect, ...o })
}
const closed = (): Over => ({ [`projects/${P}`]: mkProject("closed") })
const plan = (): Over => ({ [`projects/${P}`]: mkProject("plan") })
const done = (): Over => ({ [`projects/${P}`]: mkProject("done") })
const projPath = `projects/${P}`

// ---------------------------------------------------------------- projects: create
{
  const legacyNew = legacyProject({ contractorId: U.owner })
  add("projects create legacy: owner", U.owner, "create", "projects/n1", "ALLOW", { after: legacyNew })
  add("projects create legacy: pm.manage+projects.edit member", U.pmm, "create", "projects/n1", "ALLOW", { after: legacyProject({ contractorId: U.pmm }) })
  add("projects create legacy: projects.edit only (no create ceiling, G-28)", U.edit, "create", "projects/n1", "DENY", { after: legacyProject({ contractorId: U.edit }) })
  add("projects create legacy: carries a pm block", U.pmm, "create", "projects/n1", "DENY", { after: { ...legacyProject(), pm: mkPm("plan") } })
  add("projects create legacy: other company data", U.owner, "create", "projects/n1", "DENY", { after: legacyProject({ organizationId: CO }) })
  add("projects create legacy: unauthenticated", null, "create", "projects/n1", "DENY", { after: legacyNew })
  add("projects create legacy: supplier role", U.sup, "create", "projects/n1", "DENY", { after: legacyProject({ organizationId: U.sup }) })
  add("projects create: CRM handover (crm.close + sourceOpportunityId)", U.crm, "create", "projects/n1", "ALLOW", { after: legacyProject({ sourceOpportunityId: "opp1" }) })
  add("projects create: crm.close without sourceOpportunityId", U.crm, "create", "projects/n1", "DENY", { after: legacyProject() })

  const accepted = (uid: string, over: D = {}): D => ({
    ...mkProject("plan", { contractorId: uid, pmHandoverId: "h1", projectManagerId: U.pmm }),
    ...over,
  })
  const handover = (over: D = {}): D => ({ organizationId: ORG, status: "wait", to: U.pmm, requestedBy: U.crm, opportunityId: "o1", ...over })
  const h = (o: D): Over => ({ "pmHandovers/h1": handover(o) })
  add("projects create: addressed manager accepts the handover file", U.pmm, "create", "projects/n1", "ALLOW", { after: accepted(U.pmm), over: h({}) })
  add("projects create: owner accepts a file addressed to another", U.owner, "create", "projects/n1", "ALLOW", { after: accepted(U.owner), over: h({}) })
  add("projects create: file already accepted", U.pmm, "create", "projects/n1", "DENY", { after: accepted(U.pmm), over: h({ status: "acc" }) })
  add("projects create: file addressed to someone else, not owner", U.cost, "create", "projects/n1", "DENY", { after: accepted(U.cost), over: h({}) })
  add("projects create: file of another company", U.pmm, "create", "projects/n1", "DENY", { after: accepted(U.pmm), over: h({ organizationId: CO }) })
  add("projects create: contractorId is not the acceptor", U.pmm, "create", "projects/n1", "DENY", { after: accepted(U.pmm, { contractorId: U.owner }), over: h({}) })
  add("projects create: no project manager named", U.pmm, "create", "projects/n1", "DENY", { after: accepted(U.pmm, { projectManagerId: "" }), over: h({}) })

  const manual = (uid: string, over: D = {}, pmOver: D = {}): D => ({
    ...mkProject("plan", { contractorId: uid, projectManagerId: U.pmm }),
    pmHandoverId: undefined,
    sourceOpportunityId: undefined,
    pm: { ...mkPm("plan"), manual: true, ...pmOver },
    ...over,
  })
  const clean = (d: D): D => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined))
  add("projects create manual PM project: pm.manage", U.bare, "create", "projects/n1", "ALLOW", { after: clean(manual(U.bare)) })
  add("projects create manual PM project: owner", U.owner, "create", "projects/n1", "ALLOW", { after: clean(manual(U.owner)) })
  add("projects create manual PM project: pm.cost (no create key)", U.cost, "create", "projects/n1", "DENY", { after: clean(manual(U.cost)) })
  add("projects create manual PM project: pm.site", U.site, "create", "projects/n1", "DENY", { after: clean(manual(U.site)) })
  add("projects create manual PM project: born live", U.bare, "create", "projects/n1", "DENY", { after: clean(manual(U.bare, {}, { lifecycle: "live" })) })
  add("projects create manual PM project: original pre-frozen", U.bare, "create", "projects/n1", "DENY", { after: clean(manual(U.bare, {}, { original: TERMS })) })
  add("projects create manual PM project: no manager", U.bare, "create", "projects/n1", "DENY", { after: clean(manual(U.bare, { projectManagerId: null })) })
  add("projects create manual PM project: contractorId not the creator", U.bare, "create", "projects/n1", "DENY", { after: clean(manual(U.bare, { contractorId: U.owner })) })
}

// ---------------------------------------------------------------- projects: PM updates
{
  const plans = mkProject("plan")
  const live = mkProject("live")
  const doneP = mkProject("done")
  const termsEdited = { ...TERMS, advance: 0.2 }
  const up = (name: string, uid: string | null, before: D, after: D, expect: Expect, over?: Over) => add(name, uid, "update", projPath, expect, { before, after, over: { [projPath]: before, ...(over ?? {}) } })

  const planTerms = { ...withPm(plans, { terms: termsEdited, termsBy: U.pmm, termsOn: TODAY }) }
  up("project terms before start: project manager (pm.manage)", U.pmm, plans, planTerms, "ALLOW")
  up("project terms before start: owner", U.owner, plans, planTerms, "ALLOW")
  up("project terms before start: QS (money + all)", U.cost, plans, planTerms, "ALLOW")
  up("project terms before start: site engineer", U.site, plans, planTerms, "DENY")
  up("project terms before start: plain member", U.plain, plans, planTerms, "DENY")
  up("project terms before start: other company", U.other, plans, planTerms, "DENY")
  up("project terms before start: unauthenticated", null, plans, planTerms, "DENY")
  up("project terms AFTER start (frozen): project manager", U.pmm, live, withPm(live, { terms: termsEdited }), "DENY")
  up("project terms AFTER start (frozen): owner", U.owner, live, withPm(live, { terms: termsEdited }), "DENY")
  up("project original rewritten after start: owner", U.owner, live, withPm(live, { original: termsEdited }), "DENY")
  up("project original rewritten after start: project manager", U.pmm, live, withPm(live, { original: null }), "DENY")

  const started = withPm(plans, { lifecycle: "live", original: TERMS, startedAt: NOW, startedBy: "start" }, { status: "working" })
  up("start project: project manager", U.pmm, plans, started, "ALLOW")
  up("start project: owner", U.owner, plans, started, "ALLOW")
  up("start project: approver seat 'other' (approve duty)", U.appr, plans, started, "ALLOW")
  up("start project: QS", U.cost, plans, started, "DENY")
  up("start project: site engineer", U.site, plans, started, "DENY")
  up("start project: project manager name cannot also change the budget", U.pmm, plans, { ...started, budget: 1 }, "DENY")

  up("go live by measurement: approver self-approving a sheet", U.pmm, plans, withPm(plans, { lifecycle: "live", original: TERMS, startedAt: NOW, startedBy: "measurement", sheetCount: 1 }, { status: "working" }), "ALLOW")

  up("pm.sheetCount: site engineer (measure)", U.site, live, withPm(live, { sheetCount: 1 }), "ALLOW")
  up("pm.sheetCount: QS (measure)", U.cost, live, withPm(live, { sheetCount: 1 }), "ALLOW")
  up("pm.sheetCount: plain member", U.plain, live, withPm(live, { sheetCount: 1 }), "DENY")
  up("pm.sheetCount + lifecycle in one write by a measurer", U.site, live, withPm(live, { sheetCount: 1, lifecycle: "done" }), "DENY")
  up("certificate totals: QS (prep)", U.cost, live, withPm(live, { ipcCount: 1, lastIpcOn: TODAY, retentionHeld: 100, advanceRecovered: 50, cutPool: 0 }), "ALLOW")
  up("certificate totals: PM", U.pmm, live, withPm(live, { ipcCount: 1, lastIpcOn: TODAY, retentionHeld: 100, advanceRecovered: 50, cutPool: 0 }), "ALLOW")
  up("certificate totals: site engineer", U.site, live, withPm(live, { ipcCount: 1, retentionHeld: 100 }), "DENY")
  up("pm.wirCount: site engineer (qa)", U.site, live, withPm(live, { wirCount: 1 }), "ALLOW")
  up("pm.punchCount: site engineer (qa)", U.site, live, withPm(live, { punchCount: 1 }), "ALLOW")
  up("pm.ncrCount: site engineer (qa)", U.site, live, withPm(live, { ncrCount: 1 }), "ALLOW")
  up("pm.wirCount: QS (no qa)", U.cost, live, withPm(live, { wirCount: 1 }), "DENY")
  up("pm.claimCount: QS (prep)", U.cost, live, withPm(live, { claimCount: 1 }), "ALLOW")
  up("pm.claimCount: site engineer", U.site, live, withPm(live, { claimCount: 1 }), "DENY")
  up("pm.sampleCount: site engineer (measure)", U.site, live, withPm(live, { sampleCount: 1 }), "ALLOW")
  up("pm.voCount: QS (vo)", U.cost, live, withPm(live, { voCount: 1 }), "ALLOW")
  up("pm.voCount: site engineer", U.site, live, withPm(live, { voCount: 1 }), "DENY")
  up("pm.subcontractCount: QS (sub)", U.cost, live, withPm(live, { subcontractCount: 1 }), "ALLOW")
  up("pm.subCustodyCount: site engineer (req)", U.site, live, withPm(live, { subCustodyCount: 1 }), "ALLOW")
  up("pm.letterCount + lettersOut: QS (corr)", U.cost, live, withPm(live, { letterCount: 1, lettersOut: 1 }), "ALLOW")
  up("pm.mrCount/pettyCount/plantCount: site engineer (req)", U.site, live, withPm(live, { mrCount: 1, pettyCount: 1, plantCount: 1, plantReqCount: 1 }), "ALLOW")
  up("pm.grnCount: site engineer (rcv)", U.site, live, withPm(live, { grnCount: 1 }), "ALLOW")
  up("pm.rfiCount/obstacleCount: site engineer (daily)", U.site, live, withPm(live, { rfiCount: 1, obstacleCount: 1 }), "ALLOW")
  up("pm.incidentCount/permitCount: hse officer", U.hse, live, withPm(live, { incidentCount: 1, permitCount: 1 }), "ALLOW")
  up("pm.addendaCount: QS (prep draft)", U.cost, live, withPm(live, { addendaCount: 1 }), "ALLOW")
  up("addendum drafted+signed in one step: PM", U.pmm, live, withPm(live, { addendaCount: 1, signedCount: 1, inForce: termsEdited }), "ALLOW")
  up("addendum signed: PM (signedCount + inForce)", U.pmm, withPm(live, { addendaCount: 1 }), withPm(live, { addendaCount: 1, signedCount: 1, inForce: termsEdited }), "ALLOW")
  up("addendum signed count by QS (prep only)", U.cost, live, withPm(live, { addendaCount: 1, signedCount: 1, inForce: termsEdited }), "DENY")
  up("owner appoints the project manager", U.owner, live, { ...live, projectManagerId: U.appr, projectManagerName: "N", updatedAt: NOW }, "ALLOW")
  up("PM replaces the project manager himself", U.pmm, live, { ...live, projectManagerId: U.appr, projectManagerName: "N", updatedAt: NOW }, "DENY")
  up("file location + consultant: PM (approve)", U.pmm, live, { ...live, location: "Riyadh", consultant: "X", updatedAt: NOW }, "ALLOW")
  up("file location + consultant: site engineer", U.site, live, { ...live, location: "Riyadh", consultant: "X", updatedAt: NOW }, "DENY")
  up("hold project: PM", U.pmm, live, withPm(live, { lifecycle: "hold", holdSince: TODAY, holdWhy: "x" }, { status: "hold" }), "ALLOW")
  up("hold project: site engineer", U.site, live, withPm(live, { lifecycle: "hold", holdSince: TODAY, holdWhy: "x" }, { status: "hold" }), "DENY")
  const held = mkProject("hold")
  up("resume project: PM", U.pmm, held, withPm(held, { lifecycle: "live", holdSince: null, holdWhy: null, holdLog: [{ since: TODAY }] }, { status: "working" }), "ALLOW")
  up("switch sections: PM", U.pmm, live, { ...withPm(live, { secLog: [{ on: ["store"] }] }), enabledSections: ["store"] }, "ALLOW")
  up("switch sections: site engineer", U.site, live, { ...withPm(live, { secLog: [{ on: ["store"] }] }), enabledSections: ["store"] }, "DENY")
  up("switch sections that also rewrites the budget", U.pmm, live, { ...withPm(live, { secLog: [{ on: ["store"] }] }), enabledSections: ["store"], budget: 1 }, "DENY")
  up("provisional acceptance: PM", U.pmm, live, withPm(live, { acceptances: { prov: { on: TODAY, by: U.pmm } }, retentionFreed: 10 }), "ALLOW")
  up("provisional acceptance: QS", U.cost, live, withPm(live, { acceptances: { prov: { on: TODAY, by: U.cost } } }), "DENY")
  up("final acceptance: PM (lifecycle done, remaining_payment)", U.pmm, live, withPm(live, { acceptances: { final: { on: TODAY } }, lifecycle: "done", retentionFreed: 10 }, { status: "remaining_payment" }), "ALLOW")
  up("retention released by Finance (invoices.manage)", U.fin, doneP, withPm(doneP, { retentionReleased: true }), "ALLOW")
  up("retention released by plain member", U.plain, doneP, withPm(doneP, { retentionReleased: true }), "DENY")
  up("retention half released by Finance", U.fin, doneP, withPm(doneP, { retentionHalfReleased: true }), "ALLOW")
  up("retentionReleased flag (Finance-only) set by the PM (approve)", U.pmm, doneP, withPm(doneP, { retentionReleased: true }), "DENY")
  up("retentionReleased flag turned back off by Finance", U.fin, withPm(doneP, { retentionReleased: true }), withPm(doneP, { retentionReleased: false }), "DENY")
  up("close and archive: PM", U.pmm, doneP, withPm(doneP, { lifecycle: "closed", fin: { value: 1 }, closedOn: TODAY, closedBy: U.pmm }), "ALLOW")
  up("close and archive: QS", U.cost, doneP, withPm(doneP, { lifecycle: "closed", fin: { value: 1 }, closedOn: TODAY, closedBy: U.cost }), "DENY")
  const clo = mkProject("closed")
  up("closed project: PM updates anything", U.pmm, clo, withPm(clo, { sheetCount: 1 }), "DENY")
  up("closed project: owner updates anything", U.owner, clo, withPm(clo, { sheetCount: 1 }), "DENY")
  up("closed project: Finance releases retention", U.fin, clo, withPm(clo, { retentionReleased: true }), "DENY")
  up("closed project: platform admin", U.admin, clo, withPm(clo, { sheetCount: 1 }), "ALLOW")

  const leg = legacyProject()
  const adopted = { ...leg, pm: mkPm("plan", { adopted: { on: TODAY, by: U.owner } }), projectManagerId: U.pmm, projectManagerName: "PM", updatedAt: NOW }
  up("adopt legacy project into PM 1.0: owner", U.owner, leg, adopted, "ALLOW")
  up("adopt legacy project into PM 1.0: member with projects.edit", U.edit, leg, adopted, "DENY")
  up("adopt legacy project into PM 1.0: pm.manage member (not admin)", U.pmm, leg, adopted, "DENY")
  up("legacy project edit: projects.edit member", U.edit, leg, { ...leg, name: "renamed", status: "in_progress", updatedAt: NOW }, "ALLOW")
  up("legacy project edit: member without projects.edit", U.site, leg, { ...leg, name: "renamed", updatedAt: NOW }, "DENY")
  up("legacy project edit: other company", U.other, leg, { ...leg, name: "renamed", updatedAt: NOW }, "DENY")
  up("legacy project rfqIds link by projects.publish", U.fin, leg, { ...leg, rfqIds: ["r1"], updatedAt: NOW }, "ALLOW")
  up("project handover answer by addressed PM (legacy handover block)", U.cost, { ...leg, handover: { pmId: U.cost, status: "pending" } }, { ...leg, handover: { pmId: U.cost, status: "accepted" }, updatedAt: NOW }, "ALLOW")
}

// ---------------------------------------------------------------- projects: reads / deletes
{
  const live = mkProject("live")
  add("projects get: same company", U.site, "get", projPath, "ALLOW", { before: live })
  add("projects get: other company", U.other, "get", projPath, "DENY", { before: live })
  add("projects get: unauthenticated", null, "get", projPath, "DENY", { before: live })
  add("projects list: own organization", U.site, "list", projPath, "ALLOW", { before: live })
  add("projects list: other organization", U.other, "list", projPath, "DENY", { before: live })
  add("projects delete: PM project by owner", U.owner, "delete", projPath, "DENY", { before: live })
  add("projects delete: PM project by admin", U.admin, "delete", projPath, "ALLOW", { before: live })
  add("projects delete: legacy project by owner (projects.delete)", U.owner, "delete", projPath, "ALLOW", { before: legacyProject(), over: { [projPath]: legacyProject() } })
}

// ---------------------------------------------------------------- team seats
{
  const live = mkProject("live")
  const newSeat = (uid: string, role: string, extra: D = {}): D => ({
    userId: uid,
    groupId: "g-site",
    organizationId: ORG,
    addedBy: U.owner,
    pmRole: role,
    roleName: null,
    off: [],
    from: TODAY,
    to: null,
    why: null,
    byOut: null,
    log: [{ at: NOW, by: U.owner, act: "assign", role, off: [] }],
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  })
  const sp = seatPath(U.newbie)
  add("seat assign site: owner", U.owner, "create", sp, "ALLOW", { after: newSeat(U.newbie, "site") })
  add("seat assign site: QS (holds all)", U.cost, "create", sp, "ALLOW", { after: newSeat(U.newbie, "site") })
  add("seat assign site: PM (approve)", U.pmm, "create", sp, "ALLOW", { after: newSeat(U.newbie, "site") })
  add("seat assign site: site engineer", U.site, "create", sp, "DENY", { after: newSeat(U.newbie, "site") })
  add("seat assign site: plain member", U.plain, "create", sp, "DENY", { after: newSeat(U.newbie, "site") })
  add("seat assign site: other company", U.other, "create", sp, "DENY", { after: newSeat(U.newbie, "site") })
  add("seat assign site: unauthenticated", null, "create", sp, "DENY", { after: newSeat(U.newbie, "site") })
  add("seat assign project manager: owner", U.owner, "create", sp, "ALLOW", { after: newSeat(U.newbie, "pm") })
  add("seat assign project manager: PM (not admin)", U.pmm, "create", sp, "DENY", { after: newSeat(U.newbie, "pm") })
  add("seat assign with a group that widens him", U.owner, "create", sp, "DENY", { after: newSeat(U.newbie, "site", { groupId: "g-pm" }) })
  add("seat assign without a group (default stays)", U.owner, "create", sp, "ALLOW", { after: newSeat(U.newbie, "site", { groupId: null }) })
  add("seat assign already exited", U.owner, "create", sp, "DENY", { after: newSeat(U.newbie, "site", { to: TODAY }) })
  add("seat assign on a closed project", U.owner, "create", sp, "DENY", { after: newSeat(U.newbie, "site"), over: closed() })
  add("seat assign role 'other' named", U.owner, "create", sp, "ALLOW", { after: newSeat(U.newbie, "other", { roleName: "Surveyor" }) })
  add("seat assign unknown role", U.owner, "create", sp, "DENY", { after: newSeat(U.newbie, "boss") })

  const cur = seat(U.site, "site")
  add("seat duties change: PM", U.pmm, "update", seatPath(U.site), "ALLOW", { before: cur, after: { ...cur, off: ["req"], log: [{ act: "duties" }], updatedAt: NOW } })
  add("seat duties change: owner", U.owner, "update", seatPath(U.site), "ALLOW", { before: cur, after: { ...cur, off: ["req"], log: [{ act: "duties" }], updatedAt: NOW } })
  add("seat duties change: site engineer himself", U.site, "update", seatPath(U.site), "DENY", { before: cur, after: { ...cur, off: [], pmRole: "pm", updatedAt: NOW } })
  add("seat promote to project manager: PM", U.pmm, "update", seatPath(U.site), "DENY", { before: cur, after: { ...cur, pmRole: "pm", updatedAt: NOW } })
  add("seat promote to project manager: owner", U.owner, "update", seatPath(U.site), "ALLOW", { before: cur, after: { ...cur, pmRole: "pm", updatedAt: NOW } })
  const pmSeat = seat(U.pmm, "pm")
  add("seat of the project manager changed by the PM", U.appr, "update", seatPath(U.pmm), "DENY", { before: pmSeat, after: { ...pmSeat, off: ["vo"], updatedAt: NOW } })
  add("seat of the project manager exited by owner", U.owner, "update", seatPath(U.pmm), "ALLOW", { before: pmSeat, after: { ...pmSeat, to: TODAY, why: "left", byOut: U.owner, log: [{ act: "remove" }], updatedAt: NOW } })
  add("seat exit (removeSeat): PM closes a site seat", U.pmm, "update", seatPath(U.site), "ALLOW", { before: cur, after: { ...cur, to: TODAY, why: "done", byOut: U.pmm, log: [{ act: "remove" }], updatedAt: NOW } })
  add("seat exit: QS (all) closes a site seat", U.cost, "update", seatPath(U.site), "ALLOW", { before: cur, after: { ...cur, to: TODAY, why: "done", byOut: U.cost, log: [{ act: "remove" }], updatedAt: NOW } })
  add("seat handed over to the new manager (outgoing closed)", U.owner, "update", seatPath(U.pmm), "ALLOW", { before: pmSeat, after: { ...pmSeat, to: TODAY, why: "handed", byOut: U.owner, log: [{ act: "remove" }], updatedAt: NOW } })
  add("seat exit on a closed project", U.owner, "update", seatPath(U.site), "DENY", { before: cur, after: { ...cur, to: TODAY, why: "x", updatedAt: NOW }, over: closed() })
  add("seat delete on a PM project: owner", U.owner, "delete", seatPath(U.site), "DENY", { before: cur })
  add("seat delete on a PM project: admin", U.admin, "delete", seatPath(U.site), "ALLOW", { before: cur })

  const handSeat = (uid: string, role: string): D => ({ userId: uid, groupId: "g-pm", organizationId: ORG, addedBy: uid, viaHandover: true, pmRole: role, off: [], from: TODAY, to: null, createdAt: NOW })
  add("handover seat: accepted PM seats himself", U.pmm, "create", seatPath(U.pmm), "ALLOW", { after: handSeat(U.pmm, "pm"), over: { [seatPath(U.pmm)]: null, ...plan() } })
  add("handover seat: someone else seats himself as pm", U.cost, "create", seatPath(U.cost), "DENY", { after: handSeat(U.cost, "pm"), over: { [seatPath(U.cost)]: null, ...plan() } })
  const ownerAccepted = mkProject("plan", { contractorId: U.owner, projectManagerId: U.pmm })
  add("handover seat: acceptor (owner) seats the named PM", U.owner, "create", seatPath(U.pmm), "ALLOW", { after: { ...handSeat(U.pmm, "pm"), addedBy: U.owner }, over: { [seatPath(U.pmm)]: null, [projPath]: ownerAccepted } })
  add("handover seat: acceptor (owner) seats a site engineer", U.owner, "create", seatPath(U.site), "ALLOW", { after: { ...handSeat(U.site, "site"), groupId: "g-site", addedBy: U.owner }, over: { [seatPath(U.site)]: null, [projPath]: ownerAccepted } })
  add("handover seat: acceptor seats a QS", U.owner, "create", seatPath(U.cost), "ALLOW", { after: { ...handSeat(U.cost, "qs"), groupId: "g-cost", addedBy: U.owner }, over: { [seatPath(U.cost)]: null, [projPath]: ownerAccepted } })
  add("handover seat: acceptor seats a site engineer after start", U.owner, "create", seatPath(U.site), "ALLOW", { after: { ...handSeat(U.site, "site"), groupId: "g-site", addedBy: U.owner }, over: { [seatPath(U.site)]: null, [projPath]: mkProject("live", { contractorId: U.owner }) } })
  const manSeat = (uid: string, role: string): D => ({ userId: uid, groupId: null, organizationId: ORG, addedBy: U.bare, viaManual: true, pmRole: role, off: [], from: TODAY, to: null, createdAt: NOW })
  const manualProject = mkProject("plan", { contractorId: U.bare, projectManagerId: U.pmm }, { manual: true })
  add("manual project seat: creator seats the PM", U.bare, "create", seatPath(U.pmm), "ALLOW", { after: manSeat(U.pmm, "pm"), over: { [seatPath(U.pmm)]: null, [projPath]: manualProject } })
  add("manual project seat: creator seats a site engineer", U.bare, "create", seatPath(U.site), "ALLOW", { after: manSeat(U.site, "site"), over: { [seatPath(U.site)]: null, [projPath]: manualProject } })
  add("manual project seat: creator seats a QS", U.bare, "create", seatPath(U.cost), "DENY", { after: manSeat(U.cost, "qs"), over: { [seatPath(U.cost)]: null, [projPath]: manualProject } })
  const adoptSeat: D = { userId: U.pmm, organizationId: ORG, addedBy: U.owner, pmRole: "pm", off: [], from: TODAY, to: null, updatedAt: NOW }
  add("adopt: owner seats the PM (merge create)", U.owner, "create", seatPath(U.pmm), "ALLOW", { after: adoptSeat, over: { [seatPath(U.pmm)]: null } })
  add("adopt: owner seats the PM (merge onto existing seat)", U.owner, "update", seatPath(U.pmm), "ALLOW", { before: seat(U.pmm, "pm"), after: { ...seat(U.pmm, "pm"), addedBy: U.owner, updatedAt: NOW } })
  const legacyMember: D = { userId: U.newbie, groupId: "g-site", addedBy: U.owner, createdAt: NOW }
  const lp = legacyProject()
  add("legacy project member add: team.manage", U.teamm, "create", seatPath(U.newbie), "ALLOW", { after: legacyMember, over: { [projPath]: lp } })
  add("legacy project member add: owner", U.owner, "create", seatPath(U.newbie), "ALLOW", { after: legacyMember, over: { [projPath]: lp } })
  add("legacy project member add: plain member", U.plain, "create", seatPath(U.newbie), "DENY", { after: legacyMember, over: { [projPath]: lp } })
  add("legacy project member delete: owner", U.owner, "delete", seatPath(U.newbie), "ALLOW", { before: legacyMember, over: { [projPath]: lp } })
  add("legacy project member read: another company", U.other, "get", seatPath(U.pmm), "DENY", { before: seat(U.pmm, "pm") })
  add("CRM handover seat (crm.close, viaHandover)", U.crm, "create", seatPath(U.pmm), "ALLOW", { after: { userId: U.pmm, groupId: null, viaHandover: true, addedBy: U.crm }, over: { [seatPath(U.pmm)]: null, [projPath]: legacyProject({ sourceOpportunityId: "o1" }) } })
  void live
}

// ---------------------------------------------------------------- BOQ
{
  const item = (over: D = {}): D => ({ itemNo: "1.1", descriptionAr: "a", descriptionEn: "a", unit: "m", quantity: 100, unitPrice: 10, estCost: 8, divisionNo: "1", tenderId: null, isEditable: true, groupId: null, executedQuantity: 20, billedQuantity: 0, createdAt: NOW, updatedAt: NOW, ...over })
  const bp = `projects/${P}/boqItems/b1`
  const fields = (r: D = {}): D => ({ itemNo: "1.1", descriptionAr: "a", descriptionEn: "a", unit: "m", quantity: 100, unitPrice: 0, estCost: null, divisionNo: "1", tenderId: null, isEditable: true, groupId: null, executedQuantity: 0, billedQuantity: 0, createdAt: NOW, updatedAt: NOW, ...r })
  add("boq import: owner", U.owner, "create", bp, "ALLOW", { after: fields() })
  add("boq import: pm.manage (create key) with projects.edit", U.pmm, "create", bp, "ALLOW", { after: fields() })
  add("boq import: pm.manage alone (no projects.edit)", U.bare, "create", bp, "ALLOW", { after: fields(), over: { [seatPath(U.bare)]: seat(U.bare, "pm") } })
  add("boq import: QS (no create key)", U.cost, "create", bp, "DENY", { after: fields() })
  add("boq import: site engineer", U.site, "create", bp, "DENY", { after: fields() })
  add("boq import: other company", U.other, "create", bp, "DENY", { after: fields() })
  add("boq import: closed project", U.owner, "create", bp, "DENY", { after: fields(), over: closed() })
  add("boq import: project manager of the handover (isPmProjectManager)", U.cost, "create", bp, "ALLOW", { after: fields(), over: { [projPath]: mkProject("plan", { projectManagerId: U.cost }) } })

  const before = item({ executedQuantity: 0 })
  const edit = { ...before, quantity: 120, descriptionAr: "b", updatedAt: NOW }
  add("boq edit line in planning (saveBoqItem): owner", U.owner, "update", bp, "ALLOW", { before, after: edit, over: plan() })
  add("boq edit line in planning (saveBoqItem): PM with projects.edit", U.pmm, "update", bp, "ALLOW", { before, after: edit, over: plan() })
  add("boq edit line in planning (saveBoqItem): pm.manage WITHOUT projects.edit (client guard = create key)", U.bare, "update", bp, "ALLOW", { before, after: edit, over: { ...plan(), [seatPath(U.bare)]: seat(U.bare, "pm") } })
  add("boq edit quantity after start: owner", U.owner, "update", bp, "DENY", { before, after: edit })
  add("boq edit a line locked into a tender", U.owner, "update", bp, "DENY", { before: { ...before, isEditable: false }, after: { ...edit }, over: plan() })

  add("boq executed (approved sheet): PM", U.pmm, "update", bp, "ALLOW", { before, after: { ...before, executedQuantity: 5, updatedAt: NOW } })
  add("boq executed (approved sheet): owner", U.owner, "update", bp, "ALLOW", { before, after: { ...before, executedQuantity: 5, updatedAt: NOW } })
  add("boq executed: site engineer (measure but not approve)", U.site, "update", bp, "DENY", { before, after: { ...before, executedQuantity: 5, updatedAt: NOW } })
  add("boq executed: QS", U.cost, "update", bp, "DENY", { before, after: { ...before, executedQuantity: 5, updatedAt: NOW } })
  add("boq executed: projects.edit member on a PM project", U.edit, "update", bp, "DENY", { before, after: { ...before, executedQuantity: 5, updatedAt: NOW } })
  add("boq executed: approver on a closed project", U.pmm, "update", bp, "DENY", { before, after: { ...before, executedQuantity: 5, updatedAt: NOW }, over: closed() })

  const ex = item({ executedQuantity: 20, billedQuantity: 0 })
  add("boq billed (certificate prepared): QS", U.cost, "update", bp, "ALLOW", { before: ex, after: { ...ex, billedQuantity: 20, updatedAt: NOW } })
  add("boq billed: PM", U.pmm, "update", bp, "ALLOW", { before: ex, after: { ...ex, billedQuantity: 20, updatedAt: NOW } })
  add("boq billed above executed", U.cost, "update", bp, "DENY", { before: ex, after: { ...ex, billedQuantity: 25, updatedAt: NOW } })
  add("boq billed: site engineer", U.site, "update", bp, "DENY", { before: ex, after: { ...ex, billedQuantity: 5, updatedAt: NOW } })
  add("boq billed on withdrawal (back to 0): QS", U.cost, "update", bp, "ALLOW", { before: { ...ex, billedQuantity: 20 }, after: { ...ex, billedQuantity: 0, updatedAt: NOW } })
  add("adopt: legacy billed quantity above executed (legacy claim billed more)", U.owner, "update", bp, "ALLOW", { before: ex, after: { ...ex, billedQuantity: 30, updatedAt: NOW } })

  add("boq inspection result (pmWir): site engineer (qa)", U.site, "update", bp, "ALLOW", { before: ex, after: { ...ex, pmWir: "pass", updatedAt: NOW } })
  add("boq inspection result: unknown state", U.site, "update", bp, "DENY", { before: ex, after: { ...ex, pmWir: "great", updatedAt: NOW } })
  add("boq inspection result: QS", U.cost, "update", bp, "DENY", { before: ex, after: { ...ex, pmWir: "pass", updatedAt: NOW } })
  add("boq inspection required (pmInspect): PM", U.pmm, "update", bp, "ALLOW", { before: ex, after: { ...ex, pmInspect: true, updatedAt: NOW } })
  add("boq inspection required: site engineer", U.site, "update", bp, "DENY", { before: ex, after: { ...ex, pmInspect: true, updatedAt: NOW } })
  add("boq sample state (pmSub, pmSubRev): site engineer (measure)", U.site, "update", bp, "ALLOW", { before: ex, after: { ...ex, pmSub: "sub", pmSubRev: 1, updatedAt: NOW } })
  add("boq sample state: QS", U.cost, "update", bp, "ALLOW", { before: ex, after: { ...ex, pmSub: "sub", pmSubRev: 1, updatedAt: NOW } })
  add("boq sample reply (pmSub appA): PM", U.pmm, "update", bp, "ALLOW", { before: ex, after: { ...ex, pmSub: "appA", updatedAt: NOW } })
  add("boq sample required (pmSample): PM", U.pmm, "update", bp, "ALLOW", { before: ex, after: { ...ex, pmSample: true, updatedAt: NOW } })
  add("boq sample required: site engineer", U.site, "update", bp, "DENY", { before: ex, after: { ...ex, pmSample: true, updatedAt: NOW } })

  const unpriced = item({ unitPrice: 0, estCost: null })
  const priced = (by: string): D => ({ ...unpriced, unitPrice: 55, estCost: 40, pricedBy: by, pricedByName: "n", pricedOn: TODAY, updatedAt: NOW })
  add("boq price an unpriced line: QS (prep + money)", U.cost, "update", bp, "ALLOW", { before: unpriced, after: priced(U.cost) })
  add("boq price an unpriced line: PM", U.pmm, "update", bp, "ALLOW", { before: unpriced, after: priced(U.pmm) })
  add("boq price an unpriced line: site engineer", U.site, "update", bp, "DENY", { before: unpriced, after: priced(U.site) })
  add("boq re-price an already priced line: QS", U.cost, "update", bp, "DENY", { before: item({ unitPrice: 10 }), after: priced(U.cost) })
  add("boq price with another user's name in pricedBy", U.cost, "update", bp, "DENY", { before: unpriced, after: priced(U.pmm) })

  add("boq delete in planning: owner", U.owner, "delete", bp, "ALLOW", { before: item(), over: plan() })
  add("boq delete after start: owner", U.owner, "delete", bp, "DENY", { before: item() })
  add("boq group create: owner", U.owner, "create", `projects/${P}/boqGroups/g1`, "ALLOW", { after: { name: "G", organizationId: ORG } })
  add("boq group create: pm.manage alone (wizard batch with items)", U.bare, "create", `projects/${P}/boqGroups/g1`, "ALLOW", { after: { name: "G", organizationId: ORG }, over: { [seatPath(U.bare)]: seat(U.bare, "pm") } })
  add("boq group create: site engineer", U.site, "create", `projects/${P}/boqGroups/g1`, "DENY", { after: { name: "G", organizationId: ORG } })
  add("boq read: same company", U.site, "get", bp, "ALLOW", { before: item() })
  add("boq read: other company", U.other, "get", bp, "DENY", { before: item() })
}

// ---------------------------------------------------------------- measurement sheets
{
  const sp = `projects/${P}/pmSheets/0001`
  const line = { itemId: "b1", code: null, qty: 5, unit: null, approved: null }
  const wait = (uid: string): D => ({ seq: 1, status: "wait", day: TODAY, by: uid, byName: "n", lines: [line], note: null, files: [], okBy: null, okByName: null, okAt: null, self: false, returnNote: null, organizationId: ORG, createdAt: NOW })
  const ok = (uid: string): D => ({ ...wait(uid), status: "ok", okBy: uid, okByName: "n", okAt: NOW, self: true })
  add("sheet write (wait): site engineer", U.site, "create", sp, "ALLOW", { after: wait(U.site) })
  add("sheet write (wait): QS", U.cost, "create", sp, "ALLOW", { after: wait(U.cost) })
  add("sheet write (self-approved ok): PM", U.pmm, "create", sp, "ALLOW", { after: ok(U.pmm) })
  add("sheet write (self-approved ok): site engineer (no approve)", U.site, "create", sp, "DENY", { after: ok(U.site) })
  add("sheet write (wait): plain member", U.plain, "create", sp, "DENY", { after: wait(U.plain) })
  add("sheet write (wait): by someone else's name", U.site, "create", sp, "DENY", { after: wait(U.cost) })
  add("sheet write (wait): closed project", U.site, "create", sp, "DENY", { after: wait(U.site), over: closed() })
  add("sheet write (wait): other company", U.other, "create", sp, "DENY", { after: wait(U.other) })
  add("sheet write (wait): unauthenticated", null, "create", sp, "DENY", { after: wait(U.site) })
  add("sheet write with no lines", U.site, "create", sp, "DENY", { after: { ...wait(U.site), lines: [] } })
  const approved: D = { ...wait(U.site), status: "ok", lines: [{ ...line, approved: 5 }], okBy: U.pmm, okByName: "PM", okAt: NOW, self: false, updatedAt: NOW }
  add("sheet approve (approveSheet): PM", U.pmm, "update", sp, "ALLOW", { before: wait(U.site), after: approved })
  add("sheet approve: owner", U.owner, "update", sp, "ALLOW", { before: wait(U.site), after: { ...approved, okBy: U.owner } })
  add("sheet approve: site engineer", U.site, "update", sp, "DENY", { before: wait(U.site), after: { ...approved, okBy: U.site } })
  add("sheet approve: QS", U.cost, "update", sp, "DENY", { before: wait(U.site), after: { ...approved, okBy: U.cost } })
  add("sheet approve naming another approver", U.pmm, "update", sp, "DENY", { before: wait(U.site), after: { ...approved, okBy: U.owner } })
  add("sheet approve an already approved sheet", U.pmm, "update", sp, "DENY", { before: { ...wait(U.site), status: "ok" }, after: approved })
  add("sheet return (returnSheet): PM", U.pmm, "update", sp, "ALLOW", { before: wait(U.site), after: { ...wait(U.site), status: "no", okBy: U.pmm, okByName: "PM", okAt: NOW, returnNote: "redo", updatedAt: NOW } })
  add("sheet approve on a closed project", U.pmm, "update", sp, "DENY", { before: wait(U.site), after: approved, over: closed() })
  add("sheet read: same company", U.site, "get", sp, "ALLOW", { before: wait(U.site) })
  add("sheet delete: PM", U.pmm, "delete", sp, "DENY", { before: wait(U.site) })
}

// ---------------------------------------------------------------- inspections, punch, ncr
{
  const ip = `projects/${P}/pmInspections/0001`
  const attempt = { n: 1, on: TODAY, result: null, note: null, by: U.site, byName: "n", rBy: null, rByName: null, rAt: null, files: [] }
  const insp: D = { seq: 1, itemId: "b1", code: "1.1", location: "L1", unit: null, party: "cons", partyText: null, status: "open", attempts: [attempt], organizationId: ORG, createdAt: NOW }
  add("inspection request: site engineer (qa)", U.site, "create", ip, "ALLOW", { after: insp })
  add("inspection request: PM", U.pmm, "create", ip, "ALLOW", { after: insp })
  add("inspection request: QS (no qa)", U.cost, "create", ip, "DENY", { after: insp })
  add("inspection request: no location", U.site, "create", ip, "DENY", { after: { ...insp, location: "" } })
  add("inspection request: closed project", U.site, "create", ip, "DENY", { after: insp, over: closed() })
  add("inspection request: other company", U.other, "create", ip, "DENY", { after: insp })
  const result: D = { ...insp, status: "pass", attempts: [{ ...attempt, result: "pass", rBy: U.site, rAt: NOW }], updatedAt: NOW }
  add("inspection result pass: site engineer", U.site, "update", ip, "ALLOW", { before: insp, after: result })
  add("inspection result: QS", U.cost, "update", ip, "DENY", { before: insp, after: result })
  add("inspection result: unknown state", U.site, "update", ip, "DENY", { before: insp, after: { ...result, status: "meh" } })
  const failed: D = { ...insp, status: "fail", attempts: [{ ...attempt, result: "fail" }] }
  add("inspection reinspect after fail: site engineer", U.site, "update", ip, "ALLOW", { before: failed, after: { ...failed, status: "open", attempts: [...(failed.attempts as D[]), { ...attempt, n: 2 }], updatedAt: NOW } })
  add("inspection reinspect without a new attempt", U.site, "update", ip, "DENY", { before: failed, after: { ...failed, status: "open", updatedAt: NOW } })
  add("inspection read: same company", U.cost, "get", ip, "ALLOW", { before: insp })

  const pp = `projects/${P}/pmPunch/0001`
  const punch: D = { seq: 1, what: "w", location: "L", severity: "a", source: "cons", sourceText: null, status: "open", day: TODAY, by: U.site, byName: "n", itemId: null, unit: null, files: [], fix: null, conf: null, organizationId: ORG, createdAt: NOW }
  add("punch raise: site engineer (qa)", U.site, "create", pp, "ALLOW", { after: punch })
  add("punch raise: QS", U.cost, "create", pp, "DENY", { after: { ...punch, by: U.cost } })
  add("punch raise without location", U.site, "create", pp, "DENY", { after: { ...punch, location: "" } })
  add("punch raise in another's name", U.site, "create", pp, "DENY", { after: { ...punch, by: U.pmm } })
  add("punch fix: site engineer", U.site, "update", pp, "ALLOW", { before: punch, after: { ...punch, status: "fix", fix: { on: TODAY, by: U.site }, updatedAt: NOW } })
  add("punch confirm: site engineer", U.site, "update", pp, "ALLOW", { before: { ...punch, status: "fix" }, after: { ...punch, status: "done", conf: { on: TODAY, by: U.site }, updatedAt: NOW } })
  add("punch skip a step (open to done)", U.site, "update", pp, "DENY", { before: punch, after: { ...punch, status: "done", updatedAt: NOW } })
  add("punch fix on a closed project", U.site, "update", pp, "DENY", { before: punch, after: { ...punch, status: "fix", updatedAt: NOW }, over: closed() })

  const np = `projects/${P}/pmNcrs/0001`
  const ncr: D = { seq: 1, itemId: "", code: null, what: null, severity: "maj", root: "bad mix", cost: 100, status: "open", day: TODAY, by: U.site, byName: "n", files: [], plan: null, accepted: null, organizationId: ORG, createdAt: NOW }
  add("ncr raise: site engineer (qa)", U.site, "create", np, "ALLOW", { after: ncr })
  add("ncr raise: QS", U.cost, "create", np, "DENY", { after: { ...ncr, by: U.cost } })
  add("ncr raise: no root cause", U.site, "create", np, "DENY", { after: { ...ncr, root: "" } })
  add("ncr plan: site engineer", U.site, "update", np, "ALLOW", { before: ncr, after: { ...ncr, status: "plan", plan: { on: TODAY, text: "fix" }, updatedAt: NOW } })
  add("ncr accept: site engineer", U.site, "update", np, "ALLOW", { before: { ...ncr, status: "plan" }, after: { ...ncr, status: "done", accepted: { on: TODAY }, updatedAt: NOW } })
  add("ncr plan: also edits the cost field (money holder revising cost)", U.pmm, "update", np, "ALLOW", { before: ncr, after: { ...ncr, status: "plan", plan: { on: TODAY, text: "fix", cost: 50 }, updatedAt: NOW } })
}

// ---------------------------------------------------------------- addenda
{
  const ap = `projects/${P}/pmAddenda/0001`
  const draft = (uid: string, over: D = {}): D => ({
    seq: 1, day: TODAY, by: uid, byName: "n", reason: "scope", reasonText: null, changes: [{ field: "advance", from: 0.1, to: 0.2 }], note: null, files: [],
    status: "draft", signedOn: null, signedSeq: null, signedBy: null, signedByName: null, signatory: null, voidOn: null, voidBy: null, voidByName: null, voidReason: null, voidText: null, organizationId: ORG, createdAt: NOW, ...over,
  })
  add("addendum draft: QS (prep)", U.cost, "create", ap, "ALLOW", { after: draft(U.cost) })
  add("addendum draft: PM", U.pmm, "create", ap, "ALLOW", { after: draft(U.pmm) })
  add("addendum draft: site engineer", U.site, "create", ap, "DENY", { after: draft(U.site) })
  add("addendum draft before start (planning)", U.pmm, "create", ap, "DENY", { after: draft(U.pmm), over: plan() })
  add("addendum draft on a closed project", U.pmm, "create", ap, "DENY", { after: draft(U.pmm), over: closed() })
  add("addendum draft without changes", U.pmm, "create", ap, "DENY", { after: draft(U.pmm, { changes: [] }) })
  add("addendum draft in another's name", U.cost, "create", ap, "DENY", { after: draft(U.pmm) })
  add("addendum draft+signed in one step: PM", U.pmm, "create", ap, "ALLOW", { after: draft(U.pmm, { status: "signed", signedOn: TODAY, signedSeq: 1, signedBy: U.pmm }) })
  add("addendum draft+signed in one step: QS", U.cost, "create", ap, "DENY", { after: draft(U.cost, { status: "signed", signedOn: TODAY, signedSeq: 1, signedBy: U.cost }) })
  add("addendum draft on a held project", U.pmm, "create", ap, "ALLOW", { after: draft(U.pmm), over: { [projPath]: mkProject("hold") } })
  add("addendum read: PM (approve)", U.pmm, "get", ap, "ALLOW", { before: draft(U.cost) })
  add("addendum read: QS (money)", U.cost, "get", ap, "ALLOW", { before: draft(U.cost) })
  add("addendum read: site engineer (AMD-10)", U.site, "get", ap, "DENY", { before: draft(U.cost) })
  add("addendum read: plain member", U.plain, "get", ap, "DENY", { before: draft(U.cost) })
  add("addendum read: other company", U.other, "get", ap, "DENY", { before: draft(U.cost) })
  const signed: D = { ...draft(U.cost), status: "signed", signedOn: TODAY, signedSeq: 1, signedBy: U.pmm, signedByName: "PM", signatory: "X", updatedAt: NOW }
  add("addendum sign: PM", U.pmm, "update", ap, "ALLOW", { before: draft(U.cost), after: signed })
  add("addendum sign with files appended: PM", U.pmm, "update", ap, "ALLOW", { before: draft(U.cost), after: { ...signed, files: [{ url: "u", name: "n" }] } })
  add("addendum sign: QS", U.cost, "update", ap, "DENY", { before: draft(U.cost), after: { ...signed, signedBy: U.cost } })
  add("addendum sign naming another signer", U.pmm, "update", ap, "DENY", { before: draft(U.cost), after: { ...signed, signedBy: U.owner } })
  add("addendum sign an already signed one", U.pmm, "update", ap, "DENY", { before: signed, after: { ...signed, signatory: "Y" } })
  add("addendum sign on a closed project", U.pmm, "update", ap, "DENY", { before: draft(U.cost), after: signed, over: closed() })
  const voided = (by: string): D => ({ ...draft(U.cost), status: "void", voidOn: TODAY, voidBy: by, voidByName: "n", voidReason: "withdrawn", voidText: null, updatedAt: NOW })
  add("addendum withdraw by its drafter (QS, prep)", U.cost, "update", ap, "ALLOW", { before: draft(U.cost), after: voided(U.cost) })
  add("addendum withdraw by PM (approve)", U.pmm, "update", ap, "ALLOW", { before: draft(U.cost), after: voided(U.pmm) })
  add("addendum withdraw by site engineer", U.site, "update", ap, "DENY", { before: draft(U.cost), after: voided(U.site) })
  add("addendum delete: PM", U.pmm, "delete", ap, "DENY", { before: draft(U.cost) })
}

// ---------------------------------------------------------------- certificates
{
  const cp = `projects/${P}/pmCertificates/0001`
  const cert = (prep: string, over: D = {}): D => ({
    seq: 1, status: "int", lines: [], voLines: [], cutsIncluded: 0, periodFrom: null, periodTo: TODAY, checks: [], gross: 1000, recovery: 100, retention: 100, vat: 135, net: 935,
    terms: TERMS, contractValue: 1000000, prep, prepName: "n", prepOn: TODAY, appr: null, apprName: null, apprOn: null, selfApp: false, certified: null, cut: null, cutReason: null, consultantRef: null, certOn: null, certBy: null, certByName: null, dueOn: null, submitted: null, organizationId: ORG, createdAt: NOW, ...over,
  })
  add("certificate prepare: QS (prep+ipc+client)", U.cost, "create", cp, "ALLOW", { after: cert(U.cost) })
  add("certificate prepare: PM", U.pmm, "create", cp, "ALLOW", { after: cert(U.pmm) })
  add("certificate prepare: site engineer", U.site, "create", cp, "DENY", { after: cert(U.site) })
  add("certificate prepare: prep recorded as someone else", U.cost, "create", cp, "DENY", { after: cert(U.pmm) })
  add("certificate prepare: zero gross", U.cost, "create", cp, "DENY", { after: cert(U.cost, { gross: 0 }) })
  add("certificate prepare: born certified", U.cost, "create", cp, "DENY", { after: cert(U.cost, { status: "appr" }) })
  add("certificate prepare: closed project", U.cost, "create", cp, "DENY", { after: cert(U.cost), over: closed() })
  add("certificate prepare: other company", U.other, "create", cp, "DENY", { after: cert(U.other) })
  add("certificate prepare: unauthenticated", null, "create", cp, "DENY", { after: cert(U.cost) })
  const sub = (by: string, self: boolean, prep = U.cost): D => ({ ...cert(prep), status: "sub", appr: by, apprName: "n", apprOn: TODAY, selfApp: self, updatedAt: NOW })
  add("certificate internal approval: PM (not the preparer)", U.pmm, "update", cp, "ALLOW", { before: cert(U.cost), after: sub(U.pmm, false) })
  add("certificate internal approval: owner (not the preparer)", U.owner, "update", cp, "ALLOW", { before: cert(U.cost), after: sub(U.owner, false) })
  add("certificate internal approval: QS (no ipcOk)", U.cost, "update", cp, "DENY", { before: cert(U.pmm), after: sub(U.cost, false, U.pmm) })
  add("certificate SELF-approval, no company setting", U.pmm, "update", cp, "DENY", { before: cert(U.pmm), after: sub(U.pmm, true, U.pmm) })
  add("certificate SELF-approval claimed as selfApp=false", U.pmm, "update", cp, "DENY", { before: cert(U.pmm), after: sub(U.pmm, false, U.pmm) })
  add("certificate SELF-approval with the company setting on", U.pmm, "update", cp, "ALLOW", { before: cert(U.pmm), after: sub(U.pmm, true, U.pmm), over: { [`pmSettings/${ORG}`]: { organizationId: ORG, selfApproval: true } } })
  add("certificate SELF-approval with the setting explicitly off", U.pmm, "update", cp, "DENY", { before: cert(U.pmm), after: sub(U.pmm, true, U.pmm), over: { [`pmSettings/${ORG}`]: { organizationId: ORG, selfApproval: false } } })
  add("certificate approval records another approver's name", U.pmm, "update", cp, "DENY", { before: cert(U.cost), after: sub(U.owner, false) })
  add("certificate approval on a closed project", U.pmm, "update", cp, "DENY", { before: cert(U.cost), after: sub(U.pmm, false), over: closed() })
  const certified = (by: string, v: number): D => ({ ...cert(U.cost), status: "appr", certBy: by, certByName: "n", certified: v, cut: 1000 - v, certOn: TODAY, dueOn: "2026-11-07", updatedAt: NOW })
  add("certificate certify: PM (ipcOk)", U.pmm, "update", cp, "ALLOW", { before: { ...cert(U.cost), status: "sub" }, after: certified(U.pmm, 900) })
  add("certificate certify in full: PM", U.pmm, "update", cp, "ALLOW", { before: { ...cert(U.cost), status: "sub" }, after: certified(U.pmm, 1000) })
  add("certificate certify above gross", U.pmm, "update", cp, "DENY", { before: { ...cert(U.cost), status: "sub" }, after: certified(U.pmm, 1200) })
  add("certificate certify: QS", U.cost, "update", cp, "DENY", { before: { ...cert(U.cost), status: "sub" }, after: certified(U.cost, 900) })
  add("certificate certify before internal approval (int to appr)", U.pmm, "update", cp, "DENY", { before: cert(U.cost), after: certified(U.pmm, 900) })
  const voided = (by: string): D => ({ ...cert(U.cost), status: "void", voidBy: by, voidByName: "n", voidOn: TODAY, updatedAt: NOW })
  add("certificate withdraw: its preparer (QS)", U.cost, "update", cp, "ALLOW", { before: cert(U.cost), after: voided(U.cost) })
  add("certificate withdraw: PM (approve)", U.pmm, "update", cp, "ALLOW", { before: cert(U.cost), after: voided(U.pmm) })
  add("certificate withdraw: site engineer", U.site, "update", cp, "DENY", { before: cert(U.cost), after: voided(U.site) })
  add("certificate withdraw after submission", U.cost, "update", cp, "DENY", { before: { ...cert(U.cost), status: "sub" }, after: voided(U.cost) })
  const apprd = { ...certified(U.pmm, 900), status: "appr" }
  const collect = (collected: number, status: string): D => ({ ...apprd, status, collected, collections: [{ on: TODAY, amount: 100, by: U.fin }], collectedOn: TODAY, updatedAt: NOW })
  add("certificate collection (part): Finance", U.fin, "update", cp, "ALLOW", { before: apprd, after: collect(0.1, "part") })
  add("certificate collection (paid): Finance", U.fin, "update", cp, "ALLOW", { before: { ...apprd, status: "part", collected: 0.1 }, after: collect(1, "paid") })
  add("certificate collection on a CLOSED project: Finance", U.fin, "update", cp, "ALLOW", { before: apprd, after: collect(0.1, "part"), over: closed() })
  add("certificate collection: PM (no invoices.manage)", U.pmm, "update", cp, "DENY", { before: apprd, after: collect(0.1, "part") })
  add("certificate collection: QS", U.cost, "update", cp, "DENY", { before: apprd, after: collect(0.1, "part") })
  add("certificate collection: share goes down", U.fin, "update", cp, "DENY", { before: { ...apprd, status: "part", collected: 0.5 }, after: collect(0.2, "part") })
  add("certificate collection: paid with a share under 1", U.fin, "update", cp, "DENY", { before: apprd, after: collect(0.5, "paid") })
  add("certificate collection of a not-yet-certified one", U.fin, "update", cp, "DENY", { before: { ...cert(U.cost), status: "sub" }, after: collect(0.1, "part") })
  add("certificate collection: other company Finance", U.other, "update", cp, "DENY", { before: apprd, after: collect(0.1, "part") })
  add("certificate read: PM (money)", U.pmm, "get", cp, "ALLOW", { before: cert(U.cost) })
  add("certificate read: QS (money)", U.cost, "get", cp, "ALLOW", { before: cert(U.cost) })
  add("certificate read: Finance (invoices.manage)", U.fin, "get", cp, "ALLOW", { before: cert(U.cost) })
  add("certificate read: site engineer", U.site, "get", cp, "DENY", { before: cert(U.cost) })
  add("certificate read: other company", U.other, "get", cp, "DENY", { before: cert(U.cost) })
  add("certificate delete: PM", U.pmm, "delete", cp, "DENY", { before: cert(U.cost) })
}

// ---------------------------------------------------------------- variations, submittals, claims
{
  const vp = `projects/${P}/pmVariations/0001`
  const vo = (uid: string, over: D = {}): D => ({ seq: 1, title: "t", source: "client", sourceText: null, instructionNo: null, day: TODAY, loggedOn: TODAY, itemIds: [], days: 0, files: [], value: 500, cost: 400, executedPct: 0, status: "draft", by: uid, byName: "n", decision: null, organizationId: ORG, createdAt: NOW, ...over })
  add("variation log: QS (vo)", U.cost, "create", vp, "ALLOW", { after: vo(U.cost) })
  add("variation log: PM", U.pmm, "create", vp, "ALLOW", { after: vo(U.pmm) })
  add("variation log: site engineer", U.site, "create", vp, "DENY", { after: vo(U.site) })
  add("variation log: born approved", U.cost, "create", vp, "DENY", { after: vo(U.cost, { status: "appr" }) })
  add("variation log: negative value", U.cost, "create", vp, "DENY", { after: vo(U.cost, { value: -1 }) })
  add("variation log: closed project", U.cost, "create", vp, "DENY", { after: vo(U.cost), over: closed() })
  add("variation price a draft: QS", U.cost, "update", vp, "ALLOW", { before: vo(U.cost), after: { ...vo(U.cost), value: 600, cost: 450, instructionNo: "I1", updatedAt: NOW } })
  add("variation submit (draft to wait): QS", U.cost, "update", vp, "ALLOW", { before: vo(U.cost), after: { ...vo(U.cost), status: "wait", updatedAt: NOW } })
  add("variation submit with zero value", U.cost, "update", vp, "DENY", { before: vo(U.cost, { value: 0 }), after: { ...vo(U.cost, { value: 0 }), status: "wait", updatedAt: NOW } })
  add("variation progress on an approved one: QS", U.cost, "update", vp, "ALLOW", { before: vo(U.cost, { status: "appr" }), after: { ...vo(U.cost, { status: "appr" }), executedPct: 0.5, updatedAt: NOW } })
  const waiting = vo(U.cost, { status: "wait" })
  add("variation approve: PM", U.pmm, "update", vp, "ALLOW", { before: waiting, after: { ...waiting, status: "appr", decision: { on: TODAY, by: U.pmm, byName: "n", ref: null, reason: null, files: [] }, updatedAt: NOW } })
  add("variation approve: QS (vo, no approve)", U.cost, "update", vp, "DENY", { before: waiting, after: { ...waiting, status: "appr", decision: { on: TODAY, by: U.cost }, updatedAt: NOW } })
  add("variation reject with reason: PM", U.pmm, "update", vp, "ALLOW", { before: waiting, after: { ...waiting, status: "rej", decision: { on: TODAY, by: U.pmm, reason: "no" }, updatedAt: NOW } })
  add("variation reject without reason: PM", U.pmm, "update", vp, "DENY", { before: waiting, after: { ...waiting, status: "rej", decision: { on: TODAY, by: U.pmm, reason: "" }, updatedAt: NOW } })
  add("variation approve dated before it was asked", U.pmm, "update", vp, "DENY", { before: waiting, after: { ...waiting, status: "appr", decision: { on: "2026-01-01", by: U.pmm }, updatedAt: NOW } })
  const apprVo = vo(U.cost, { status: "appr", executedPct: 0.5, billedPct: 0 })
  add("variation billed share moved by a certificate: QS", U.cost, "update", vp, "ALLOW", { before: apprVo, after: { ...apprVo, billedPct: 0.5, updatedAt: NOW } })
  add("variation billed share above executed", U.cost, "update", vp, "DENY", { before: apprVo, after: { ...apprVo, billedPct: 0.9, updatedAt: NOW } })
  add("variation billed share: site engineer", U.site, "update", vp, "DENY", { before: apprVo, after: { ...apprVo, billedPct: 0.1, updatedAt: NOW } })

  const sp = `projects/${P}/pmSubmittals/0001`
  const smp = (uid: string, over: D = {}): D => ({ seq: 1, itemId: "b1", code: "1.1", supplier: "S", what: null, rev: 1, status: "sub", day: TODAY, by: uid, byName: "n", files: [], reply: null, organizationId: ORG, createdAt: NOW, ...over })
  add("sample submit: site engineer (measure)", U.site, "create", sp, "ALLOW", { after: smp(U.site) })
  add("sample submit: QS (measure)", U.cost, "create", sp, "ALLOW", { after: smp(U.cost) })
  add("sample submit: plain member", U.plain, "create", sp, "DENY", { after: smp(U.plain) })
  add("sample submit: born approved", U.site, "create", sp, "DENY", { after: smp(U.site, { status: "appA" }) })
  add("sample reply approved: site engineer (measure)", U.site, "update", sp, "ALLOW", { before: smp(U.site), after: { ...smp(U.site), status: "appA", reply: { on: TODAY, by: U.site }, updatedAt: NOW } })
  add("sample reply rejected: PM", U.pmm, "update", sp, "ALLOW", { before: smp(U.site), after: { ...smp(U.site), status: "rej", reply: { on: TODAY, by: U.pmm }, updatedAt: NOW } })
  add("sample reply unknown", U.pmm, "update", sp, "DENY", { before: smp(U.site), after: { ...smp(U.site), status: "maybe", updatedAt: NOW } })
  add("sample reply twice", U.pmm, "update", sp, "DENY", { before: smp(U.site, { status: "appA" }), after: { ...smp(U.site), status: "rej", updatedAt: NOW } })

  const cp = `projects/${P}/pmClaims/0001`
  const clm = (uid: string, over: D = {}): D => ({ seq: 1, kind: "time", cause: "weather", eventOn: TODAY, causedBy: null, causedByText: null, daysAsked: 5, amountAsked: 0, status: "draft", by: uid, byName: "n", noticeOn: null, submittedOn: null, response: null, revision: null, obstacleId: null, organizationId: ORG, createdAt: NOW, ...over })
  add("claim draft: QS (prep)", U.cost, "create", cp, "ALLOW", { after: clm(U.cost) })
  add("claim draft logged straight as noticed: QS", U.cost, "create", cp, "ALLOW", { after: clm(U.cost, { status: "notice", noticeOn: TODAY }) })
  add("claim draft: site engineer", U.site, "create", cp, "DENY", { after: clm(U.site) })
  add("claim draft: no cause", U.cost, "create", cp, "DENY", { after: clm(U.cost, { cause: "" }) })
  add("claim notice sent: QS", U.cost, "update", cp, "ALLOW", { before: clm(U.cost), after: { ...clm(U.cost), status: "notice", noticeOn: TODAY, updatedAt: NOW } })
  add("claim submit: PM (approve)", U.pmm, "update", cp, "ALLOW", { before: clm(U.cost, { status: "notice" }), after: { ...clm(U.cost, { status: "notice" }), status: "sub", submittedOn: TODAY, daysAsked: 5, amountAsked: 0, updatedAt: NOW } })
  add("claim submit: QS", U.cost, "update", cp, "DENY", { before: clm(U.cost, { status: "notice" }), after: { ...clm(U.cost, { status: "notice" }), status: "sub", submittedOn: TODAY, updatedAt: NOW } })
  const sub = clm(U.cost, { status: "sub" })
  add("claim respond (granted days): PM", U.pmm, "update", cp, "ALLOW", { before: sub, after: { ...sub, status: "appr", response: { on: TODAY, by: U.pmm, byName: "n", days: 3, amount: 0, ref: null }, revision: 1, updatedAt: NOW } })
  add("claim respond rejected (0 days): PM", U.pmm, "update", cp, "ALLOW", { before: sub, after: { ...sub, status: "rej", response: { on: TODAY, by: U.pmm, days: 0, amount: 0 }, revision: null, updatedAt: NOW } })
  add("claim respond: QS", U.cost, "update", cp, "DENY", { before: sub, after: { ...sub, status: "appr", response: { on: TODAY, by: U.cost, days: 3 }, updatedAt: NOW } })
  add("claim respond with negative days", U.pmm, "update", cp, "DENY", { before: sub, after: { ...sub, status: "appr", response: { on: TODAY, by: U.pmm, days: -1 }, updatedAt: NOW } })
  add("claim granted days draw the programme revision on the project", U.pmm, "update", projPath, "ALLOW", { before: mkProject("live"), after: withPm(mkProject("live"), { programmeRev: 1 }) })
}

// ---------------------------------------------------------------- plant requests, subcontracts, sub certificates
{
  const pr = `projects/${P}/pmPlantRequests/0001`
  const req = (uid: string, status = "wait", over: D = {}): D => ({ seq: 1, what: "crane", status, by: uid, byName: "n", organizationId: ORG, createdAt: NOW, ...over })
  add("plant request: site engineer (req)", U.site, "create", pr, "ALLOW", { after: req(U.site) })
  add("plant request: QS (no req)", U.cost, "create", pr, "DENY", { after: req(U.cost) })
  add("plant request born approved: site engineer", U.site, "create", pr, "DENY", { after: req(U.site, "go") })
  add("plant request decision: PM", U.pmm, "update", pr, "ALLOW", { before: req(U.site), after: { ...req(U.site), status: "go", decidedBy: U.pmm, decidedByName: "n", decidedOn: TODAY, updatedAt: NOW } })
  add("plant request decision: site engineer", U.site, "update", pr, "DENY", { before: req(U.site), after: { ...req(U.site), status: "go", decidedBy: U.site, updatedAt: NOW } })
  add("plant request desk answer: store keeper (warehouses.manage)", U.wh, "update", pr, "ALLOW", { before: req(U.site, "go"), after: { ...req(U.site, "go"), rep: { k: "alloc", by: U.wh }, updatedAt: NOW } })
  add("plant request site reply: site engineer (req)", U.site, "update", pr, "ALLOW", { before: req(U.site, "go"), after: { ...req(U.site, "go"), rep: { k: "none", by: U.site }, updatedAt: NOW } })
  add("plant request received: site engineer", U.site, "update", pr, "ALLOW", { before: req(U.site, "go", { rep: { k: "alloc", by: U.wh } }), after: { ...req(U.site, "go", { rep: { k: "alloc", by: U.wh } }), got: { plantSeq: 1, on: TODAY, by: U.site }, updatedAt: NOW } })

  const sc = `projects/${P}/pmSubcontracts/0001`
  const contract = (uid: string, value = 50000): D => ({ seq: 1, party: { name: "Sub Co" }, lines: [{ itemId: "b1" }], value, retention: 0.05, paid: 0, by: uid, byName: "n", organizationId: ORG, createdAt: NOW })
  add("subcontract register: owner", U.owner, "create", sc, "ALLOW", { after: { ...contract(U.owner, 900000), seq: 1 } })
  add("subcontract register within 75k: PM", U.pmm, "create", sc, "ALLOW", { after: contract(U.pmm) })
  add("subcontract register above 75k: PM", U.pmm, "create", sc, "DENY", { after: contract(U.pmm, 80000) })
  add("subcontract register: QS (sub, no approve key)", U.cost, "create", sc, "DENY", { after: contract(U.cost) })
  add("subcontract paid by Finance", U.fin, "update", sc, "ALLOW", { before: contract(U.pmm), after: { ...contract(U.pmm), paid: 1000, updatedAt: NOW } })
  add("subcontract paid by Finance goes down", U.fin, "update", sc, "DENY", { before: { ...contract(U.pmm), paid: 1000 }, after: { ...contract(U.pmm), paid: 10, updatedAt: NOW } })
  add("subcontract paid by PM", U.pmm, "update", sc, "DENY", { before: contract(U.pmm), after: { ...contract(U.pmm), paid: 1000, updatedAt: NOW } })
  add("subcontract certified lines by ipcOk: PM", U.pmm, "update", sc, "ALLOW", { before: contract(U.pmm), after: { ...contract(U.pmm), lines: [{ itemId: "b1", certified: 5 }], updatedAt: NOW } })

  const scc = `projects/${P}/pmSubCertificates/0001`
  const sce = (prep: string, over: D = {}): D => ({ seq: 1, status: "int", gross: 5000, prep, prepName: "n", lines: [], organizationId: ORG, createdAt: NOW, ...over })
  add("sub certificate prepare: QS (sub)", U.cost, "create", scc, "ALLOW", { after: sce(U.cost) })
  add("sub certificate prepare: site engineer", U.site, "create", scc, "DENY", { after: sce(U.site) })
  const okc = (by: string, self: boolean, base: D = sce(U.cost)): D => ({ ...base, status: "ok", appr: by, apprName: "n", apprOn: TODAY, selfApp: self, updatedAt: NOW })
  add("sub certificate approve: PM (not preparer)", U.pmm, "update", scc, "ALLOW", { before: sce(U.cost), after: okc(U.pmm, false) })
  add("sub certificate approve: its preparer", U.pmm, "update", scc, "DENY", { before: sce(U.pmm), after: okc(U.pmm, true, sce(U.pmm)) })
  add("sub certificate approve above 75k: PM", U.pmm, "update", scc, "DENY", { before: sce(U.cost, { gross: 90000 }), after: okc(U.pmm, false, sce(U.cost, { gross: 90000 })) })
  add("sub certificate approve above 75k: owner", U.owner, "update", scc, "ALLOW", { before: sce(U.cost, { gross: 90000 }), after: okc(U.owner, false, sce(U.cost, { gross: 90000 })) })
  add("sub certificate payment: Finance", U.fin, "update", scc, "ALLOW", { before: { ...sce(U.cost), status: "ok" }, after: { ...sce(U.cost), status: "ok", paidOn: TODAY, paidAmount: 4000, paidBy: U.fin, paidByName: "n", updatedAt: NOW } })
  add("sub certificate payment twice: Finance", U.fin, "update", scc, "DENY", { before: { ...sce(U.cost), status: "ok", paidOn: TODAY }, after: { ...sce(U.cost), status: "ok", paidOn: TODAY, paidAmount: 4000, paidBy: U.fin, updatedAt: NOW } })
  add("sub certificate payment: PM", U.pmm, "update", scc, "DENY", { before: { ...sce(U.cost), status: "ok" }, after: { ...sce(U.cost), status: "ok", paidOn: TODAY, paidAmount: 4000, paidBy: U.pmm, updatedAt: NOW } })
}

// ---------------------------------------------------------------- legacy project subcollections + finance of a project
{
  const lp = legacyProject()
  const ov: Over = { [projPath]: lp }
  const cp = `projects/${P}/ipcClaims/c1`
  const claim: D = { status: "submitted", submittedByUserId: U.owner, lines: [], totals: {}, organizationId: ORG }
  add("legacy ipc claim submit: owner", U.owner, "create", cp, "ALLOW", { after: claim, over: ov })
  add("legacy ipc claim submit: Finance (invoices.manage)", U.fin, "create", cp, "ALLOW", { after: { ...claim, submittedByUserId: U.fin }, over: ov })
  add("legacy ipc claim submit: plain member", U.plain, "create", cp, "DENY", { after: { ...claim, submittedByUserId: U.plain }, over: ov })
  add("legacy ipc claim collect: Finance", U.fin, "update", cp, "ALLOW", { before: claim, after: { ...claim, status: "collected", collectedAt: NOW, updatedAt: NOW }, over: ov })
  add("legacy ipc claim collect: plain member", U.plain, "update", cp, "DENY", { before: claim, after: { ...claim, status: "collected", collectedAt: NOW, updatedAt: NOW }, over: ov })
  add("legacy ipc claim edit after submit: owner", U.owner, "update", cp, "DENY", { before: claim, after: { ...claim, totals: { retention: 5 }, updatedAt: NOW }, over: ov })
  const mp = `projects/${P}/measurements/m1`
  add("measurement ledger entry: projects.edit", U.edit, "create", mp, "ALLOW", { after: { recordedByUserId: U.edit, quantity: 5, organizationId: ORG }, over: ov })
  add("measurement ledger entry: plain member", U.plain, "create", mp, "DENY", { after: { recordedByUserId: U.plain, quantity: 5 }, over: ov })
  add("measurement claim stamp: Finance", U.fin, "update", mp, "ALLOW", { before: { recordedByUserId: U.edit, claimId: null }, after: { recordedByUserId: U.edit, claimId: "c1" }, over: ov })
  add("waste record: projects.edit", U.edit, "create", `projects/${P}/wasteRecords/w1`, "ALLOW", { after: { recordedByUserId: U.edit }, over: ov })
  add("finance audit log entry: any member", U.plain, "create", `projects/${P}/financeAuditLog/a1`, "ALLOW", { after: { actorId: U.plain }, over: ov })
  add("finance audit log entry on a closed PM project", U.plain, "create", `projects/${P}/financeAuditLog/a1`, "DENY", { after: { actorId: U.plain }, over: closed() })
  add("purchase request raise: any member", U.plain, "create", `projects/${P}/purchaseRequests/r1`, "ALLOW", { after: { requestedByUserId: U.plain, status: "pending" }, over: ov })
}

// ---------------------------------------------------------------- pmHandovers, pmEvents, pmSettings
{
  const file = (over: D = {}): D => ({ organizationId: ORG, status: "wait", to: U.pmm, toName: "PM", opportunityId: "o1", requestedBy: U.crm, reassigns: [], returned: null, projectId: null, acceptedAt: null, title: "T", value: 1000, ...over })
  const hp = "pmHandovers/h1"
  add("handover send: CRM (crm.close)", U.crm, "create", hp, "ALLOW", { after: file() })
  add("handover send: member without crm.close", U.site, "create", hp, "DENY", { after: file({ requestedBy: U.site }) })
  add("handover send: other company file", U.crm, "create", hp, "DENY", { after: file({ organizationId: CO }) })
  add("handover send: requestedBy someone else", U.crm, "create", hp, "DENY", { after: file({ requestedBy: U.owner }) })
  add("handover send: born accepted", U.crm, "create", hp, "DENY", { after: file({ status: "acc" }) })
  add("handover send: unauthenticated", null, "create", hp, "DENY", { after: file() })
  const acc = { ...file(), status: "acc", projectId: "p9", acceptedAt: NOW, acceptedBy: U.pmm, acceptNote: null }
  add("handover accept: addressed manager", U.pmm, "update", hp, "ALLOW", { before: file(), after: acc })
  add("handover accept: owner of a file addressed to another", U.owner, "update", hp, "ALLOW", { before: file(), after: { ...acc, acceptedBy: U.owner } })
  add("handover accept: a different member", U.cost, "update", hp, "DENY", { before: file(), after: acc })
  add("handover accept: other company", U.other, "update", hp, "DENY", { before: file(), after: acc })
  add("handover reassign: addressed manager", U.pmm, "update", hp, "ALLOW", { before: file(), after: { ...file(), to: U.cost, toName: "Q", reassigns: [{ from: U.pmm, to: U.cost, by: U.pmm }] } })
  add("handover return: addressed manager", U.pmm, "update", hp, "ALLOW", { before: file(), after: { ...file(), status: "ret", returned: { missing: ["a"], by: U.pmm } } })
  add("handover answer again after accepted", U.pmm, "update", hp, "DENY", { before: { ...file(), status: "acc" }, after: { ...file(), status: "wait" } })
  add("handover answer touching the value", U.pmm, "update", hp, "DENY", { before: file(), after: { ...acc, value: 1 } })
  add("handover read: same company", U.site, "get", hp, "ALLOW", { before: file() })
  add("handover read: other company", U.other, "get", hp, "DENY", { before: file() })
  add("handover delete: owner", U.owner, "delete", hp, "DENY", { before: file() })

  const key = "prj:ADV:PJ-2026/001"
  const evId = `${ORG}__prj:ADV:PJ-2026_001`
  const ev = (over: D = {}): D => ({ organizationId: ORG, key, by: U.pmm, kind: "ADV", params: {}, at: NOW, ...over })
  add("event send (idempotency id): PM", U.pmm, "create", `pmEvents/${evId}`, "ALLOW", { after: ev() })
  add("event send: site engineer (any member)", U.site, "create", `pmEvents/${evId}`, "ALLOW", { after: ev({ by: U.site }) })
  add("event send under the key alone (pre-1 Oct id)", U.pmm, "create", "pmEvents/prj:ADV:PJ-2026_001", "DENY", { after: ev() })
  add("event send for another company", U.pmm, "create", `pmEvents/${evId}`, "DENY", { after: ev({ organizationId: CO }) })
  add("event send naming another sender", U.pmm, "create", `pmEvents/${evId}`, "DENY", { after: ev({ by: U.owner }) })
  add("event send second time (exists, becomes update)", U.pmm, "update", `pmEvents/${evId}`, "DENY", { before: ev(), after: ev({ at: "x" }) })
  add("event delete", U.owner, "delete", `pmEvents/${evId}`, "DENY", { before: ev() })
  add("event read: same company", U.fin, "get", `pmEvents/${evId}`, "ALLOW", { before: ev() })
  add("event read: other company", U.other, "get", `pmEvents/${evId}`, "DENY", { before: ev() })
  add("event send: unauthenticated", null, "create", `pmEvents/${evId}`, "DENY", { after: ev() })

  const sett = (over: D = {}): D => ({ organizationId: ORG, selfApproval: true, selfApprovalBy: U.owner, selfApprovalByName: "n", selfApprovalOn: TODAY, updatedAt: NOW, ...over })
  add("pm settings first save: owner", U.owner, "create", `pmSettings/${ORG}`, "ALLOW", { after: sett(), nullResource: true })
  add("pm settings toggle (merge update): owner", U.owner, "update", `pmSettings/${ORG}`, "ALLOW", { before: sett(), after: sett({ selfApproval: false }) })
  add("pm settings: PM (not owner)", U.pmm, "create", `pmSettings/${ORG}`, "DENY", { after: sett({ selfApprovalBy: U.pmm }) })
  add("pm settings: owner of another company", U.otherOwner, "create", `pmSettings/${ORG}`, "DENY", { after: sett({ selfApprovalBy: U.otherOwner }) })
  add("pm settings: recorded under someone else", U.owner, "create", `pmSettings/${ORG}`, "DENY", { after: sett({ selfApprovalBy: U.pmm }) })
  add("pm settings: extra field", U.owner, "create", `pmSettings/${ORG}`, "DENY", { after: sett({ rogue: 1 }) })
  add("pm settings read: member", U.site, "get", `pmSettings/${ORG}`, "ALLOW", { before: sett() })
  add("pm settings read: other company", U.other, "get", `pmSettings/${ORG}`, "DENY", { before: sett() })
  add("pm settings delete: owner", U.owner, "delete", `pmSettings/${ORG}`, "DENY", { before: sett() })
}

// ---------------------------------------------------------------- accounting
{
  const lineA = { account: "1101", debit: 100, credit: 0, project: null, projectName: null, costCenter: null, branch: null, party: null, partyName: null, note: null }
  const lineB = { ...lineA, account: "4101", debit: 0, credit: 100 }
  const entry = (over: D = {}): D => ({
    organizationId: ORG, entryNumber: 5, date: TODAY, period: "2026-10", kind: "auto", sourceType: "goods_receipt", sourceId: "d1", description: "GR", lines: [lineA, lineB], totalDebit: 100, totalCredit: 100,
    status: "posted", reversesEntryId: null, reversedByEntryId: null, createdByUserId: U.plain, createdByUserName: "n", createdAt: NOW, updatedAt: NOW, ...over,
  })
  const jp = (src = "goods_receipt", id = "d1") => `accounting_journal/${ORG}__${src}__${id}`
  add("journal auto entry: plain member (no group)", U.plain, "create", jp(), "ALLOW", { after: entry() })
  add("journal auto entry: site engineer (certificate prepared)", U.site, "create", jp("ipc_claim", "c1"), "ALLOW", { after: entry({ sourceType: "ipc_claim" }) })
  add("journal auto entry: Finance paying a sub certificate", U.fin, "create", jp("pm_sub_payment", "e1"), "ALLOW", { after: entry({ sourceType: "pm_sub_payment" }) })
  add("journal auto entry: owner", U.owner, "create", jp(), "ALLOW", { after: entry() })
  add("journal auto entry: unbalanced", U.plain, "create", jp(), "DENY", { after: entry({ totalCredit: 99 }) })
  add("journal auto entry: other company data", U.plain, "create", jp(), "DENY", { after: entry({ organizationId: CO }) })
  add("journal auto entry: other company user", U.other, "create", jp(), "DENY", { after: entry() })
  add("journal auto entry: unauthenticated", null, "create", jp(), "DENY", { after: entry() })
  add("journal auto entry into a CLOSED period (client-only lock)", U.plain, "create", jp(), "DENY", { after: entry(), over: { [`accounting_periods/${ORG}__2026-10`]: { organizationId: ORG, period: "2026-10", status: "closed" } } })
  add("journal manual voucher: accountant", U.acct, "create", jp("manual_voucher", "v1"), "ALLOW", { after: entry({ kind: "manual", sourceType: "manual_voucher", sourceId: "v1" }) })
  add("journal manual voucher: Finance (accounting.post)", U.fin, "create", jp("manual_voucher", "v1"), "ALLOW", { after: entry({ kind: "manual", sourceType: "manual_voucher", sourceId: "v1" }) })
  add("journal manual voucher draft: Finance", U.fin, "create", jp("manual_voucher", "v1"), "ALLOW", { after: entry({ kind: "manual", sourceType: "manual_voucher", sourceId: "v1", status: "draft" }) })
  add("journal manual voucher: plain member", U.plain, "create", jp("manual_voucher", "v1"), "DENY", { after: entry({ kind: "manual", sourceType: "manual_voucher", sourceId: "v1" }) })
  add("journal manual voucher: PM", U.pmm, "create", jp("manual_voucher", "v1"), "DENY", { after: entry({ kind: "manual", sourceType: "manual_voucher", sourceId: "v1" }) })
  add("journal manual voucher: unbalanced accountant", U.acct, "create", jp("manual_voucher", "v1"), "DENY", { after: entry({ kind: "manual", sourceType: "manual_voucher", sourceId: "v1", totalDebit: 101 }) })
  add("journal settlement (manual kind): Finance", U.fin, "create", jp("settlement", "s1"), "ALLOW", { after: entry({ kind: "manual", sourceType: "settlement", sourceId: "s1" }) })
  add("journal zakat provision (manual kind): Finance", U.fin, "create", jp("zakat_provision", "z1"), "ALLOW", { after: entry({ kind: "manual", sourceType: "zakat_provision", sourceId: "z1" }) })
  add("journal opening balances: accountant", U.acct, "create", jp("opening", "OPEN-2026"), "ALLOW", { after: entry({ kind: "opening", sourceType: "opening", sourceId: "OPEN-2026" }) })
  add("journal opening balances: plain member", U.plain, "create", jp("opening", "OPEN-2026"), "DENY", { after: entry({ kind: "opening", sourceType: "opening", sourceId: "OPEN-2026" }) })
  add("journal auto entry REPLAY at the same id (idempotent set) by a non-accountant", U.plain, "update", jp(), "ALLOW", { before: entry(), after: entry({ updatedAt: "2026-10-09T00:00:00Z", createdAt: "2026-10-09T00:00:00Z", entryNumber: 6 }) })
  add("journal auto entry REPLAY at the same id (idempotent set) by an accountant", U.acct, "update", jp(), "ALLOW", { before: entry(), after: entry({ updatedAt: "2026-10-09T00:00:00Z", createdAt: "2026-10-09T00:00:00Z", entryNumber: 6 }) })

  const reversal = entry({ kind: "manual", sourceId: "d1__reversal", reversesEntryId: `${ORG}__goods_receipt__d1`, lines: [lineB, lineA] })
  add("journal reversal entry: accountant", U.acct, "create", jp("goods_receipt", "d1__reversal"), "ALLOW", { after: reversal })
  add("journal reversal entry: plain member", U.plain, "create", jp("goods_receipt", "d1__reversal"), "DENY", { after: reversal })
  add("journal stamp reversedBy on the original: accountant", U.acct, "update", jp(), "ALLOW", { before: entry(), after: entry({ reversedByEntryId: "x", updatedAt: "2026-10-09T00:00:00Z" }) })
  add("journal stamp reversedBy: plain member", U.plain, "update", jp(), "DENY", { before: entry(), after: entry({ reversedByEntryId: "x", updatedAt: NOW }) })
  add("journal promote draft to posted: accountant", U.acct, "update", jp(), "ALLOW", { before: entry({ status: "draft" }), after: entry({ status: "posted", updatedAt: "2026-10-09T00:00:00Z" }) })
  add("journal edit the money of a posted entry: accountant", U.acct, "update", jp(), "DENY", { before: entry(), after: entry({ totalDebit: 200, totalCredit: 200, lines: [{ ...lineA, debit: 200 }, { ...lineB, credit: 200 }] }) })
  add("journal edit the date: accountant", U.acct, "update", jp(), "DENY", { before: entry(), after: entry({ date: "2026-09-01" }) })
  add("journal move to another company: accountant", U.acct, "update", jp(), "DENY", { before: entry(), after: entry({ organizationId: CO }) })
  add("journal delete a draft: accountant", U.acct, "delete", jp(), "ALLOW", { before: entry({ status: "draft" }) })
  add("journal delete a posted entry: accountant", U.acct, "delete", jp(), "DENY", { before: entry() })
  add("journal delete a posted entry: owner", U.owner, "delete", jp(), "DENY", { before: entry() })
  add("journal delete a draft: plain member", U.plain, "delete", jp(), "DENY", { before: entry({ status: "draft" }) })
  add("journal read: any member", U.plain, "get", jp(), "ALLOW", { before: entry() })
  add("journal read: other company", U.other, "get", jp(), "DENY", { before: entry() })
  add("journal read: unauthenticated", null, "get", jp(), "DENY", { before: entry() })
  add("journal list: any member", U.site, "list", jp(), "ALLOW", { before: entry() })

  const acc = (over: D = {}): D => ({ organizationId: ORG, code: "1101", nameAr: "a", nameEn: "a", type: "asset", ...over })
  add("account create: accountant", U.acct, "create", `accounting_accounts/${ORG}__1101`, "ALLOW", { after: acc() })
  add("account create: Finance", U.fin, "create", `accounting_accounts/${ORG}__1101`, "ALLOW", { after: acc() })
  add("account create: plain member", U.plain, "create", `accounting_accounts/${ORG}__1101`, "DENY", { after: acc() })
  add("account create: other company data", U.acct, "create", `accounting_accounts/${ORG}__1101`, "DENY", { after: acc({ organizationId: CO }) })
  add("account rename: accountant", U.acct, "update", `accounting_accounts/${ORG}__1101`, "ALLOW", { before: acc(), after: acc({ nameAr: "b" }) })
  add("account rename: plain member", U.plain, "update", `accounting_accounts/${ORG}__1101`, "DENY", { before: acc(), after: acc({ nameAr: "b" }) })
  add("account delete: accountant", U.acct, "delete", `accounting_accounts/${ORG}__1101`, "ALLOW", { before: acc() })
  add("account read: member", U.site, "get", `accounting_accounts/${ORG}__1101`, "ALLOW", { before: acc() })

  const per = { organizationId: ORG, period: "2026-10", status: "closed", closedAt: NOW, closedByUserId: U.acct }
  add("period close: accounting.close holder", U.acct, "create", `accounting_periods/${ORG}__2026-10`, "ALLOW", { after: per })
  add("period close: Finance (accounting.post only)", U.fin, "create", `accounting_periods/${ORG}__2026-10`, "DENY", { after: per })
  add("period close: plain member", U.plain, "create", `accounting_periods/${ORG}__2026-10`, "DENY", { after: per })
  add("period close: other company data", U.acct, "create", `accounting_periods/${ORG}__2026-10`, "DENY", { after: { ...per, organizationId: CO } })
  add("period reopen: accounting.close holder", U.acct, "update", `accounting_periods/${ORG}__2026-10`, "ALLOW", { before: per, after: { ...per, status: "open" } })
  add("period reopen: Finance", U.fin, "update", `accounting_periods/${ORG}__2026-10`, "DENY", { before: per, after: { ...per, status: "open" } })
  add("period read: any member", U.site, "get", `accounting_periods/${ORG}__2026-10`, "ALLOW", { before: per })
  add("period read: other company", U.other, "get", `accounting_periods/${ORG}__2026-10`, "DENY", { before: per })

  const st = (over: D = {}): D => ({ organizationId: ORG, enabled: true, fiscalYearStartMonth: 1, displayScale: "units", branchReports: false, updatedAt: NOW, updatedByUserId: U.acct, updatedByUserName: "n", ...over })
  add("accounting settings first save: accounting.close holder", U.acct, "create", `accounting_settings/${ORG}`, "ALLOW", { after: st() })
  add("accounting settings first save: Finance (accounting.post only; the screen is gated by accounting.close too)", U.fin, "create", `accounting_settings/${ORG}`, "DENY", { after: st() })
  add("accounting settings update: owner", U.owner, "update", `accounting_settings/${ORG}`, "ALLOW", { before: st(), after: st({ displayScale: "thousands" }) })
  add("accounting settings update: plain member", U.plain, "update", `accounting_settings/${ORG}`, "DENY", { before: st(), after: st({ enabled: false }) })
  add("accounting settings read: member", U.site, "get", `accounting_settings/${ORG}`, "ALLOW", { before: st() })
  add("accounting settings read: other company", U.other, "get", `accounting_settings/${ORG}`, "DENY", { before: st() })

  const zk = (over: D = {}): D => ({ organizationId: ORG, fiscalYear: 2026, rateBasis: "gregorian", overrides: {}, adjustments: [], updatedAt: NOW, updatedByUserId: U.fin, updatedByUserName: "n", ...over })
  add("zakat schedule first save: Finance (accounting.post)", U.fin, "create", `accounting_zakat/${ORG}__2026`, "ALLOW", { after: zk(), nullResource: true })
  add("zakat schedule overwrite (setDoc on existing): Finance", U.fin, "update", `accounting_zakat/${ORG}__2026`, "ALLOW", { before: zk(), after: zk({ rateBasis: "hijri" }) })
  add("zakat schedule: plain member", U.plain, "create", `accounting_zakat/${ORG}__2026`, "DENY", { after: zk() })
  add("zakat schedule: wrong doc id", U.fin, "create", `accounting_zakat/${ORG}__2025`, "DENY", { after: zk() })
  add("zakat schedule: other company id", U.fin, "create", `accounting_zakat/${CO}__2026`, "DENY", { after: zk({ organizationId: CO }) })
  add("zakat schedule delete: owner", U.owner, "delete", `accounting_zakat/${ORG}__2026`, "DENY", { before: zk() })
  add("zakat schedule read missing (answers missing, not denied)", U.site, "get", `accounting_zakat/${ORG}__2025`, "ALLOW", { nullResource: true })
  add("zakat schedule read: other company", U.other, "get", `accounting_zakat/${ORG}__2026`, "DENY", { before: zk() })
}

// ---------------------------------------------------------------- invoices, guarantees
{
  const inv = (over: D = {}): D => ({ clientName: "C", issueDate: TODAY, dueDate: TODAY, rfqId: null, notes: null, vatPercent: 15, items: [{ description: "d", quantity: 1, unitPrice: 5 }], organizationId: U.sup, invoiceNumber: "INV-1", status: "draft", createdAt: NOW, updatedAt: NOW, ...over })
  add("invoice create: supplier into own org", U.sup, "create", "invoices/i1", "ALLOW", { after: inv() })
  add("invoice create: into another org", U.sup, "create", "invoices/i1", "DENY", { after: inv({ organizationId: U.sup2 }) })
  add("invoice create: unauthenticated", null, "create", "invoices/i1", "DENY", { after: inv() })
  add("invoice status change: same org", U.sup, "update", "invoices/i1", "ALLOW", { before: inv(), after: inv({ status: "sent" }) })
  add("invoice update: other org", U.sup2, "update", "invoices/i1", "DENY", { before: inv(), after: inv({ status: "paid" }) })
  add("invoice move to another org: member", U.sup, "update", "invoices/i1", "DENY", { before: inv(), after: inv({ organizationId: U.sup2 }) })
  add("invoice delete: same org", U.sup, "delete", "invoices/i1", "ALLOW", { before: inv() })
  add("invoice delete: other org", U.sup2, "delete", "invoices/i1", "DENY", { before: inv() })
  add("invoice read: same org", U.sup, "get", "invoices/i1", "ALLOW", { before: inv() })
  add("invoice read: other org", U.sup2, "get", "invoices/i1", "DENY", { before: inv() })
  add("invoice (contractor org) delete by a member without invoices.manage", U.plain, "delete", "invoices/i1", "ALLOW", { before: inv({ organizationId: ORG }) })

  const gu = (over: D = {}): D => ({ rfqId: "r1", offerId: "of1", contractorOrgId: ORG, contractorId: U.owner, supplierOrgId: U.sup, supplierId: U.sup, itemName: "x", hasGuarantee: true, fileUrl: "u", filePath: "p", fileType: "pdf", expirationDate: "2027-01-01", status: "pending_review", createdAt: NOW, ...over })
  add("guarantee submit: supplier", U.sup, "create", "guarantees/g1", "ALLOW", { after: gu() })
  add("guarantee submit 'none': supplier", U.sup, "create", "guarantees/g1", "ALLOW", { after: gu({ hasGuarantee: false, status: "none", fileUrl: null }) })
  add("guarantee submit for another supplier org", U.sup, "create", "guarantees/g1", "DENY", { after: gu({ supplierOrgId: U.sup2 }) })
  add("guarantee submit: contractor", U.owner, "create", "guarantees/g1", "DENY", { after: gu() })
  add("guarantee submit born accepted: supplier", U.sup, "create", "guarantees/g1", "DENY", { after: gu({ status: "accepted" }) })
  add("guarantee review accept: contractor owner (deliveries.confirm)", U.owner, "update", "guarantees/g1", "ALLOW", { before: gu(), after: gu({ status: "accepted", reviewedAt: NOW, reviewedByUserId: U.owner }) })
  add("guarantee review reject: contractor owner", U.owner, "update", "guarantees/g1", "ALLOW", { before: gu(), after: gu({ status: "rejected", reviewedAt: NOW, reviewedByUserId: U.owner }) })
  add("guarantee review: member without deliveries.confirm", U.plain, "update", "guarantees/g1", "DENY", { before: gu(), after: gu({ status: "accepted", reviewedAt: NOW, reviewedByUserId: U.plain }) })
  add("guarantee resubmit after rejection: supplier", U.sup, "update", "guarantees/g1", "ALLOW", { before: gu({ status: "rejected" }), after: gu({ status: "pending_review", expirationDate: "2027-06-01" }) })
  add("guarantee edit after accepted: supplier", U.sup, "update", "guarantees/g1", "DENY", { before: gu({ status: "accepted" }), after: gu({ status: "pending_review" }) })
  add("guarantee edit: other supplier", U.sup2, "update", "guarantees/g1", "DENY", { before: gu(), after: gu({ status: "none" }) })
  add("guarantee read: contractor of the offer", U.owner, "get", "guarantees/g1", "ALLOW", { before: gu() })
  add("guarantee read: unrelated company", U.other, "get", "guarantees/g1", "DENY", { before: gu() })
}

// ---------------------------------------------------------------- core: users, teamGroups, organizations, invitations, accessRequests, companyModules
{
  const urp = (uid: string) => `users/${uid}`
  add("user self update: profile field", U.plain, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), phone: "05", updatedAt: NOW } })
  add("user self update: lastLoginAt", U.plain, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), lastLoginAt: NOW } })
  add("user self update: twoFactorEnabled", U.owner, "update", urp(U.owner), "ALLOW", { before: BASE_WORLD[urp(U.owner)] as D, after: { ...(BASE_WORLD[urp(U.owner)] as D), twoFactorEnabled: true } })
  add("user self escalate: organizationId into another company", U.plain, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), organizationId: CO } })
  add("user self escalate: organizationRole to owner", U.plain, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), organizationRole: "owner" } })
  add("user self escalate: defaultGroupId", U.plain, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), defaultGroupId: "g-pm" } })
  add("user self escalate: role Admin (login auto-promote)", U.plain, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), role: "Admin" } })
  add("user update by another member", U.site, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), phone: "05" } })
  add("user update by admin", U.admin, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), phone: "05" } })
  add("user create by owner (client self-registration)", U.owner, "create", urp("x"), "DENY", { after: user(ORG) })
  add("user create by admin", U.admin, "create", urp("x"), "ALLOW", { after: user(ORG) })
  add("user delete by owner", U.owner, "delete", urp(U.plain), "DENY", { before: user(ORG) })
  add("user get: another company", U.other, "get", urp(U.plain), "ALLOW", { before: user(ORG) })
  add("user get: unauthenticated", null, "get", urp(U.plain), "DENY", { before: user(ORG) })
  add("user list: unauthenticated", null, "list", urp(U.plain), "DENY", { before: user(ORG) })

  const sw = (uid: string, org: string, role = "Contractor"): D => ({ before: { organizationId: uid, role: "Contractor", organizationRole: "owner", primaryRole: "Contractor" }, after: { organizationId: org, role, organizationRole: "owner", primaryRole: "Contractor", updatedAt: NOW } }) as unknown as D
  const sw1 = sw(U.plain, "o2") as unknown as { before: D; after: D }
  add("company switch into own secondary company (organizations/o2)", U.plain, "update", urp(U.plain), "ALLOW", { before: sw1.before, after: sw1.after, over: { "organizations/o2": { ownerUserId: U.plain, role: "Contractor", name: "Two" } } })
  add("company switch into a company owned by someone else", U.plain, "update", urp(U.plain), "DENY", { before: sw1.before, after: sw1.after, over: { "organizations/o2": { ownerUserId: U.owner, role: "Contractor", name: "Two" } } })
  add("company switch to a company whose doc is missing", U.plain, "update", urp(U.plain), "DENY", { before: sw1.before, after: sw1.after, over: { "organizations/o2": null } })
  const back = { before: { organizationId: "o2", role: "Supplier", organizationRole: "owner", primaryRole: "Contractor" }, after: { organizationId: U.plain, role: "Contractor", organizationRole: "owner", primaryRole: "Contractor", updatedAt: NOW } }
  add("company switch back to the primary company", U.plain, "update", urp(U.plain), "ALLOW", { before: back.before, after: back.after })
  const anchor = { before: { organizationId: U.plain, role: "Contractor", organizationRole: "owner" }, after: { organizationId: U.plain, role: "Contractor", organizationRole: "owner", primaryRole: "Contractor", orgMemberships: [{ organizationId: "o2" }] } }
  add("add company: anchor primaryRole + orgMemberships", U.plain, "update", urp(U.plain), "ALLOW", anchor)
  add("add company: anchor a different primaryRole", U.plain, "update", urp(U.plain), "DENY", { before: anchor.before, after: { ...anchor.after, primaryRole: "Supplier" } })

  const ownerOf = (uid: string) => ({ before: user(ORG), after: { ...user(ORG), defaultGroupId: uid } })
  add("assign member group: owner", U.owner, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), defaultGroupId: "g-site" } })
  add("assign member group to none (null): owner", U.owner, "update", urp(U.site), "ALLOW", { before: user(ORG, { defaultGroupId: "g-site" }), after: { ...user(ORG, { defaultGroupId: "g-site" }), defaultGroupId: null } })
  add("assign member group: LEGACY owner (no organizationRole field, team UI shows him as owner)", U.legacy, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), defaultGroupId: "g-site" } })
  add("assign member group: member with team.manage", U.teamm, "update", urp(U.plain), "DENY", ownerOf("g-site"))
  add("assign member group: another company's owner", U.otherOwner, "update", urp(U.plain), "DENY", ownerOf("g-site"))
  add("assign member group: owner also changing role", U.owner, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), defaultGroupId: "g-site", role: "Admin" } })
  add("remove member (revert to solo org): owner", U.owner, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), organizationId: U.plain, organizationRole: "owner", defaultGroupId: null } })
  add("remove member naming a different org: owner", U.owner, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), organizationId: CO, organizationRole: "owner", defaultGroupId: null } })
  add("remove member: LEGACY owner", U.legacy, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), organizationId: U.plain, organizationRole: "owner", defaultGroupId: null } })
  add("buyer categories: owner", U.owner, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), procurementCategories: ["c1"], updatedAt: NOW } })
  add("buyer categories: po.approve member", U.buyer, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), procurementCategories: ["c1"], updatedAt: NOW } })
  add("buyer categories: LEGACY owner", U.legacy, "update", urp(U.plain), "ALLOW", { before: user(ORG), after: { ...user(ORG), procurementCategories: ["c1"], updatedAt: NOW } })
  add("buyer categories: plain member", U.site, "update", urp(U.plain), "DENY", { before: user(ORG), after: { ...user(ORG), procurementCategories: ["c1"], updatedAt: NOW } })
  add("buyer rating: contractor updates supplier user rating (published-rating write)", U.owner, "update", urp(U.sup), "ALLOW", { before: BASE_WORLD[urp(U.sup)] as D, after: { ...(BASE_WORLD[urp(U.sup)] as D), rating: 4.5, reviewsCount: 3 } })
  add("notification to another user: any signed-in", U.pmm, "create", `users/${U.cost}/notifications/n1`, "ALLOW", { after: { title: "t", message: "m", read: false, createdAt: NOW } })
  add("notification to another user: unauthenticated", null, "create", `users/${U.cost}/notifications/n1`, "DENY", { after: { title: "t" } })
  add("notification read: own", U.cost, "get", `users/${U.cost}/notifications/n1`, "ALLOW", { before: { title: "t" } })
  add("notification read: someone else's", U.pmm, "get", `users/${U.cost}/notifications/n1`, "DENY", { before: { title: "t" } })
  add("notification mark read: own", U.cost, "update", `users/${U.cost}/notifications/n1`, "ALLOW", { before: { title: "t", read: false }, after: { title: "t", read: true } })

  const grp = (over: D = {}): D => ({ organizationId: ORG, key: null, name: "G", permissions: ["projects.view"], isSystem: false, createdAt: NOW, updatedAt: NOW, ...over })
  add("team group create: owner", U.owner, "create", "teamGroups/tg1", "ALLOW", { after: grp() })
  add("team group seeded create (isSystem super_admin): owner", U.owner, "create", `teamGroups/${ORG}_super_admin`, "ALLOW", { after: grp({ key: "super_admin", permissions: ["*"], isSystem: true }) })
  add("team group create: LEGACY owner (no organizationRole field)", U.legacy, "create", "teamGroups/tg1", "ALLOW", { after: grp() })
  add("team group create: member with team.manage", U.teamm, "create", "teamGroups/tg1", "DENY", { after: grp() })
  add("team group create: for another company", U.owner, "create", "teamGroups/tg1", "DENY", { after: grp({ organizationId: CO }) })
  add("team group create: unauthenticated", null, "create", "teamGroups/tg1", "DENY", { after: grp() })
  add("team group edit permissions: owner", U.owner, "update", "teamGroups/tg1", "ALLOW", { before: grp(), after: grp({ permissions: ["projects.view", "pm.manage"], updatedAt: NOW }) })
  add("team group rename a seeded one (key null): owner", U.owner, "update", "teamGroups/tg1", "ALLOW", { before: grp({ key: "finance" }), after: grp({ key: null, name: "Money", updatedAt: NOW }) })
  add("team group edit system group: owner", U.owner, "update", "teamGroups/tg1", "DENY", { before: grp({ isSystem: true, permissions: ["*"] }), after: grp({ isSystem: true, permissions: ["projects.view"] }) })
  add("team group edit: LEGACY owner", U.legacy, "update", "teamGroups/tg1", "ALLOW", { before: grp(), after: grp({ permissions: ["pm.site"], updatedAt: NOW }) })
  add("team group edit moving it to another company: owner", U.owner, "update", "teamGroups/tg1", "DENY", { before: grp(), after: grp({ organizationId: CO }) })
  add("team group delete: owner", U.owner, "delete", "teamGroups/tg1", "ALLOW", { before: grp() })
  add("team group delete system: owner", U.owner, "delete", "teamGroups/tg1", "DENY", { before: grp({ isSystem: true }) })
  add("team group delete: LEGACY owner", U.legacy, "delete", "teamGroups/tg1", "ALLOW", { before: grp() })
  add("team group read: member of the company", U.site, "get", "teamGroups/tg1", "ALLOW", { before: grp() })
  add("team group read: other company", U.other, "get", "teamGroups/tg1", "DENY", { before: grp() })

  const org = (over: D = {}): D => ({ name: "Two", crNumber: null, ownerUserId: U.plain, role: "Contractor", createdAt: NOW, ...over })
  add("organization create: its own owner", U.plain, "create", "organizations/o2", "ALLOW", { after: org() })
  add("organization create naming another owner", U.plain, "create", "organizations/o2", "DENY", { after: org({ ownerUserId: U.owner }) })
  add("organization create as Supplier with specializations", U.plain, "create", "organizations/o2", "DENY", { after: org({ role: "Supplier", specializations: ["a"] }) })
  add("organization rename: its owner", U.plain, "update", "organizations/o2", "ALLOW", { before: org(), after: org({ name: "Three" }) })
  add("organization rename: another user", U.owner, "update", "organizations/o2", "DENY", { before: org(), after: org({ name: "Three" }) })
  add("organization delete: owner", U.plain, "delete", "organizations/o2", "DENY", { before: org() })

  const inv = (over: D = {}): D => ({ email: "a@b.sa", invitedBy: U.owner, type: "team_invite", status: "pending", inviteToken: "t", organizationId: ORG, ...over })
  add("invitation create from the client (any user)", U.owner, "create", "invitations/i1", "DENY", { after: inv() })
  add("invitation cancel: the inviter", U.owner, "update", "invitations/i1", "ALLOW", { before: inv(), after: inv({ status: "cancelled" }) })
  add("invitation cancel: someone else", U.site, "update", "invitations/i1", "DENY", { before: inv(), after: inv({ status: "cancelled" }) })
  add("invitation widened by the inviter (org changed)", U.owner, "update", "invitations/i1", "DENY", { before: inv(), after: inv({ organizationId: CO }) })
  add("invitation delete: the inviter", U.owner, "delete", "invitations/i1", "ALLOW", { before: inv() })
  add("invitation delete: another member", U.site, "delete", "invitations/i1", "DENY", { before: inv() })
  add("invitation list: the inviter", U.owner, "list", "invitations/i1", "ALLOW", { before: inv() })
  add("invitation list: someone else", U.site, "list", "invitations/i1", "DENY", { before: inv() })

  const ar = (over: D = {}): D => ({ organizationId: ORG, requesterId: U.site, requesterName: "n", moduleId: "payments", status: "pending", createdAt: NOW, ...over })
  add("access request create: member for his own org", U.site, "create", "accessRequests/a1", "ALLOW", { after: ar() })
  add("access request create: in another member's name", U.site, "create", "accessRequests/a1", "DENY", { after: ar({ requesterId: U.cost }) })
  add("access request create: for another org", U.site, "create", "accessRequests/a1", "DENY", { after: ar({ organizationId: CO }) })
  add("access request create: born approved", U.site, "create", "accessRequests/a1", "DENY", { after: ar({ status: "approved" }) })
  add("access request read: the owner of a primary org", U.owner, "get", "accessRequests/a1", "ALLOW", { before: ar() })
  add("access request resolve: the owner of a primary org", U.owner, "update", "accessRequests/a1", "ALLOW", { before: ar(), after: ar({ status: "approved" }) })
  const secondary = "o2"
  add("access request read: owner of a SECONDARY company (org id is not his uid)", U.plain, "get", "accessRequests/a1", "ALLOW", { before: ar({ organizationId: secondary }), over: { [urp(U.plain)]: { organizationId: secondary, role: "Contractor", organizationRole: "owner" }, "organizations/o2": { ownerUserId: U.plain } } })
  add("access request resolve: owner of a SECONDARY company", U.plain, "update", "accessRequests/a1", "ALLOW", { before: ar({ organizationId: secondary }), after: ar({ organizationId: secondary, status: "approved" }), over: { [urp(U.plain)]: { organizationId: secondary, role: "Contractor", organizationRole: "owner" }, "organizations/o2": { ownerUserId: U.plain } } })
  add("access request resolve: another member", U.cost, "update", "accessRequests/a1", "DENY", { before: ar(), after: ar({ status: "approved" }) })
  add("access request read: another member", U.cost, "get", "accessRequests/a1", "DENY", { before: ar() })

  const mods = (over: D = {}): D => ({ organizationId: ORG, off: ["hr"], ...over })
  add("company modules set: platform admin", U.admin, "create", `companyModules/${ORG}`, "ALLOW", { after: mods() })
  add("company modules set: company owner", U.owner, "create", `companyModules/${ORG}`, "DENY", { after: mods() })
  add("company modules update: platform admin", U.admin, "update", `companyModules/${ORG}`, "ALLOW", { before: mods(), after: mods({ off: [] }) })
  add("company modules update without a list", U.admin, "update", `companyModules/${ORG}`, "DENY", { before: mods(), after: mods({ off: "hr" }) })
  add("company modules read: own company member", U.site, "get", `companyModules/${ORG}`, "ALLOW", { before: mods() })
  add("company modules read: other company", U.other, "get", `companyModules/${ORG}`, "DENY", { before: mods() })
  add("company modules list: member", U.site, "list", `companyModules/${ORG}`, "DENY", { before: mods() })
  add("company modules delete: admin", U.admin, "delete", `companyModules/${ORG}`, "DENY", { before: mods() })
}

// ---------------------------------------------------------------- counters on the project: every role against every counter
{
  const live = mkProject("live")
  const roles: Array<[string, string, string[] | "all"]> = [
    ["owner", U.owner, "all"],
    ["PM", U.pmm, ["measure", "qa", "hse", "req", "rcv", "sub", "approve", "vo", "prep", "ipc", "ipcOk", "client", "corr"]],
    ["approver seat", U.appr, ["measure", "qa", "hse", "req", "rcv", "sub", "approve", "vo", "prep", "ipc", "ipcOk", "client", "corr"]],
    ["QS", U.cost, ["measure", "prep", "ipc", "vo", "client", "corr", "sub"]],
    ["site engineer", U.site, ["measure", "daily", "qa", "req", "rcv"]],
    ["hse officer", U.hse, ["daily", "hse"]],
  ]
  const counters: Array<[string, D, string[]]> = [
    ["sheetCount", { sheetCount: 1 }, ["measure"]],
    ["ipcCount+retentionHeld", { ipcCount: 1, lastIpcOn: TODAY, retentionHeld: 10, advanceRecovered: 5, cutPool: 0 }, ["prep", "ipcOk", "approve"]],
    ["wirCount", { wirCount: 1 }, ["qa"]],
    ["punchCount", { punchCount: 1 }, ["qa"]],
    ["ncrCount", { ncrCount: 1 }, ["qa"]],
    ["claimCount", { claimCount: 1 }, ["prep", "approve"]],
    ["sampleCount", { sampleCount: 1 }, ["measure", "approve"]],
    ["voCount", { voCount: 1 }, ["vo"]],
    ["subcontractCount", { subcontractCount: 1, subCertCount: 1 }, ["sub"]],
    ["subCustodyCount", { subCustodyCount: 1 }, ["req"]],
    ["letterCount", { letterCount: 1, lettersOut: 1 }, ["corr"]],
    ["addendaCount", { addendaCount: 1 }, ["prep"]],
    ["mrCount", { mrCount: 1, pettyCount: 1, plantCount: 1, plantReqCount: 1 }, ["req"]],
    ["grnCount", { grnCount: 1 }, ["rcv"]],
    ["rfiCount", { rfiCount: 1, obstacleCount: 1 }, ["daily", "approve"]],
    ["incidentCount", { incidentCount: 1, permitCount: 1 }, ["hse"]],
    ["docCount", { docCount: 1 }, ["approve"]],
  ]
  for (const [role, uid, duties] of roles) {
    for (const [counter, patch, needs] of counters) {
      const holdsApprove = duties === "all" || duties.includes("approve")
      const genericQs = role === "QS"
      const ok = duties === "all" || holdsApprove || genericQs || needs.some((n) => (duties as string[]).includes(n))
      add(`counter ${counter}: ${role}`, uid, "update", projPath, ok ? "ALLOW" : "DENY", { before: live, after: withPm(live, patch), over: { [projPath]: live } })
    }
  }
}

// ---------------------------------------------------------------- site records, letters, documents, petty cash
{
  const base = (uid: string): D => ({ by: uid, byName: "n", organizationId: ORG, createdAt: NOW })
  const dp = `projects/${P}/pmDaily/${TODAY}`
  const daily = (uid: string, over: D = {}): D => ({ day: TODAY, labour: 5, plant: 1, done: "poured", obstacle: null, files: [], ...base(uid), ...over })
  add("daily report: site engineer (daily)", U.site, "create", dp, "ALLOW", { after: daily(U.site) })
  add("daily report: PM (pm.manage has no daily key, client agrees)", U.pmm, "create", dp, "DENY", { after: daily(U.pmm) })
  add("daily report: owner", U.owner, "create", dp, "ALLOW", { after: daily(U.owner) })
  add("daily report: QS (no daily)", U.cost, "create", dp, "DENY", { after: daily(U.cost) })
  add("daily report: closed project", U.site, "create", dp, "DENY", { after: daily(U.site), over: closed() })
  add("daily report: doc id is not the day", U.site, "create", `projects/${P}/pmDaily/2026-10-07`, "DENY", { after: daily(U.site) })
  add("daily report rewrite", U.site, "update", dp, "DENY", { before: daily(U.site), after: daily(U.site, { done: "x" }) })

  const op = `projects/${P}/pmObstacles/rfi-0001`
  const obs = (uid: string, over: D = {}): D => ({ type: "rfi", seq: 1, title: "t", party: "consultant", partyName: null, itemIds: [], codes: [], impact: "delay", openOn: TODAY, closeOn: null, answer: null, chases: [], ...base(uid), ...over })
  add("obstacle open: site engineer (daily)", U.site, "create", op, "ALLOW", { after: obs(U.site) })
  add("obstacle open: PM (approve)", U.pmm, "create", op, "ALLOW", { after: obs(U.pmm) })
  add("obstacle open: QS", U.cost, "create", op, "DENY", { after: obs(U.cost) })
  add("obstacle chase: QS (any live seat)", U.cost, "update", op, "ALLOW", { before: obs(U.site), after: { ...obs(U.site), chases: [{ on: TODAY, by: U.cost, byName: "n" }], updatedAt: NOW } })
  add("obstacle chase: plain member", U.plain, "update", op, "DENY", { before: obs(U.site), after: { ...obs(U.site), chases: [{ on: TODAY, by: U.plain }], updatedAt: NOW } })
  add("obstacle close: site engineer", U.site, "update", op, "ALLOW", { before: obs(U.site), after: { ...obs(U.site), closeOn: TODAY, answer: "ok", closedBy: U.site, closedByName: "n", updatedAt: NOW } })
  add("obstacle close: QS", U.cost, "update", op, "DENY", { before: obs(U.site), after: { ...obs(U.site), closeOn: TODAY, answer: "ok", closedBy: U.cost, updatedAt: NOW } })
  add("obstacle counter on the project: site engineer", U.site, "update", projPath, "ALLOW", { before: mkProject("live"), after: withPm(mkProject("live"), { rfiCount: 1 }) })

  const ip = `projects/${P}/pmIncidents/0001`
  const inc = (uid: string, over: D = {}): D => ({ seq: 1, type: "near", what: "w", action: "a", day: TODAY, lostDays: 0, files: [], ...base(uid), ...over })
  add("incident log: hse officer", U.hse, "create", ip, "ALLOW", { after: inc(U.hse) })
  add("incident log: site engineer (site template has no hse)", U.site, "create", ip, "DENY", { after: inc(U.site) })
  add("incident log lost-time with days: hse officer", U.hse, "create", ip, "ALLOW", { after: inc(U.hse, { type: "lti", lostDays: 3 }) })
  add("incident log non-LTI with lost days", U.hse, "create", ip, "DENY", { after: inc(U.hse, { lostDays: 3 }) })
  add("incident log: QS", U.cost, "create", ip, "DENY", { after: inc(U.cost) })
  add("incident edit", U.site, "update", ip, "DENY", { before: inc(U.site), after: inc(U.site, { what: "x" }) })
  const pp = `projects/${P}/pmPermits/0001`
  add("work permit: hse officer", U.hse, "create", pp, "ALLOW", { after: { seq: 1, title: "t", who: "w", from: TODAY, to: TODAY, ...base(U.hse) } })

  const lp = `projects/${P}/pmLetters/0001`
  const letter = (uid: string, over: D = {}): D => ({ seq: 1, no: "PJ-1/OUT-1", dir: "out", party: "cons", subject: "s", day: TODAY, due: 7, status: "out", links: [], file: null, reply: null, ...base(uid), ...over })
  add("letter log: QS (corr)", U.cost, "create", lp, "ALLOW", { after: letter(U.cost) })
  add("letter log incoming: PM", U.pmm, "create", lp, "ALLOW", { after: letter(U.pmm, { dir: "in", status: "in" }) })
  add("letter log: site engineer (no corr)", U.site, "create", lp, "DENY", { after: letter(U.site) })
  add("letter log: status not matching direction", U.cost, "create", lp, "DENY", { after: letter(U.cost, { status: "rep" }) })
  add("letter reply: QS", U.cost, "update", lp, "ALLOW", { before: letter(U.cost), after: { ...letter(U.cost), status: "rep", reply: { text: "ok", on: TODAY, by: U.cost, byName: "n", file: null }, updatedAt: NOW } })
  add("letter reply by site engineer", U.site, "update", lp, "DENY", { before: letter(U.cost), after: { ...letter(U.cost), status: "rep", reply: { text: "ok", on: TODAY, by: U.site }, updatedAt: NOW } })

  const dcp = `projects/${P}/pmDocs/0001`
  const docu = (uid: string, over: D = {}): D => ({ seq: 1, name: "Plan A", type: "dwg", revisions: [{ code: "A", day: TODAY, by: uid, byName: "n", file: null }], file: null, day: TODAY, ...base(uid), ...over })
  add("document register: PM (approve)", U.pmm, "create", dcp, "ALLOW", { after: docu(U.pmm) })
  add("document register: site engineer", U.site, "create", dcp, "DENY", { after: docu(U.site) })
  add("document register: unknown type", U.pmm, "create", dcp, "DENY", { after: docu(U.pmm, { type: "other" }) })
  add("document revision: PM", U.pmm, "update", dcp, "ALLOW", { before: docu(U.pmm), after: { ...docu(U.pmm), revisions: [...(docu(U.pmm).revisions as D[]), { code: "B", day: TODAY, by: U.pmm, byName: "n", file: null }], updatedAt: NOW } })
  add("document revision replacing history", U.pmm, "update", dcp, "DENY", { before: docu(U.pmm), after: { ...docu(U.pmm), revisions: [{ code: "B", day: TODAY, by: U.pmm }], updatedAt: NOW } })
  add("document counter on the project: PM", U.pmm, "update", projPath, "ALLOW", { before: mkProject("live"), after: withPm(mkProject("live"), { docCount: 1 }) })
  add("document counter on the project: site engineer", U.site, "update", projPath, "DENY", { before: mkProject("live"), after: withPm(mkProject("live"), { docCount: 1 }) })

  const pet = `projects/${P}/pmPetty/0001`
  const petty = (uid: string, amount: number): D => ({ seq: 1, amount, what: "nails", supplier: "S", ...base(uid) })
  add("petty purchase within cap: site engineer (req)", U.site, "create", pet, "ALLOW", { after: petty(U.site, 2500) })
  add("petty purchase above cap", U.site, "create", pet, "DENY", { after: petty(U.site, 3500) })
  add("petty purchase: QS", U.cost, "create", pet, "DENY", { after: petty(U.cost, 100) })
  add("programme activity: PM (approve)", U.pmm, "create", `projects/${P}/pmActivities/0001`, "ALLOW", { after: { by: U.pmm, name: "Excavation", from: "2026-10-01", to: "2026-10-10", seq: 1, organizationId: ORG } })
  add("programme activity: site engineer", U.site, "create", `projects/${P}/pmActivities/0001`, "DENY", { after: { by: U.site, name: "Excavation", from: "2026-10-01", to: "2026-10-10", seq: 1 } })
}

async function runAll(all: Spec[]): Promise<number> {
  token()
  const results = await evaluate(all, BASE_WORLD)
  saveCache()
  let bad = 0
  for (const r of results) {
    if (!r.ok) bad++
    const flag = r.limit ? "  [1000-EXPRESSION LIMIT]" : ""
    const stray = r.stray.length ? `  [read outside world: ${r.stray.join(", ")}]` : ""
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.spec.name}  (expected ${r.spec.expect}, got ${r.got})${r.ok ? "" : "  " + r.detail}${flag}${stray}${r.visited === undefined ? "" : ` {visited=${r.visited}}`}`)
  }
  console.log(`
${all.length - bad}/${all.length} as expected`)
  return bad
}

const only = process.env.ONLY
const names = process.env.NAMES_FILE ? new Set(fs.readFileSync(process.env.NAMES_FILE, "utf8").split(String.fromCharCode(10))) : null
runAll(cases.filter((c) => (only ? c.name.includes(only) : true) && (names ? names.has(c.name) : true))).then((bad) => process.exit(bad ? 1 : 0))

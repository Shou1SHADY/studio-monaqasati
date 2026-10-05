/**
 * HR 1.0 — training and performance (optional `train` / `perf`; PRD TR-01…06, PF-01…07, forms 27/28; the
 * prototype's CERTS · reqCerts · certGaps · COURSES · SESSIONS · rvSheet · rvScore · raters · raisePlan ·
 * applyRaise). Certificates are dated documents on the record, required by trade and workplace; a gap on someone
 * at work (past the induction's three days) is red and needs a session; a session's result issues them and an
 * external course's cost goes to Finance once. A review cycle names each person's rater from the line-manager
 * chain; workers get one grade, staff four criteria; the record weighs 20%; the HR manager calibrates and approves
 * per rater (never his own); raises by band go to management as one decision and are applied as pay steps — the
 * HR manager's own by management (RL-02). No amount on a review, a log or a notification (RL-03).
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext, HrRole } from "@/lib/hr/access"
import { hrAllowed } from "@/lib/hr/access"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import { growthTodayItems, perfKpis, trainingKpis } from "@/lib/hr/growth-today"
import { HR_NOTICE_COPY_AR } from "@/lib/hr/notify"
import { payOn } from "@/lib/hr/pay"
import {
  approvedRaise,
  bandOf,
  cycleBlocks,
  cycleId,
  firstOfNextMonth,
  mayApplyRaise,
  mayRate,
  raisedBasic,
  raisePlan,
  raters,
  recordFacts,
  reviewEligible,
  reviewId,
  reviewScore,
  selfId,
  type HrReview,
  type ReviewCycle,
} from "@/lib/hr/performance"
import { acknowledgeReview, applyRaises, approveReviews, decideRaises, gradeWorker, openCycle, proposeRaises, returnReviews, sendDrafts, submitSelfReview, submitStaffReview } from "@/lib/hr/performance-writes"
import type { HrSite } from "@/lib/hr/sites"
import { DEFAULT_HR_POLICIES, resolveHrPolicies } from "@/lib/hr/statutory"
import { leakage } from "@/lib/hr/today"
import { certExpiry, certGaps, courseOf, gapBad, reqCerts, scheduleBlocks, sessionPool, trainHours, trainingCost, type TrainingSession } from "@/lib/hr/training"
import { payTrainingCost, postHrTraining, recordSessionResult, scheduleSession, type TrainingCostEvent } from "@/lib/hr/training-writes"

const db = fakeFirestore as unknown as Firestore
const ORG = "org"
const TODAY = "2026-10-05"
const ctx = (roles: HrRole[], over: Partial<HrContext> = {}): HrContext => ({ uid: "u1", owner: false, roles: new Set(roles), employeeId: null, sites: [], ...over })
const hrm = ctx(["manager"], { uid: "hrm", employeeId: "e_hrm" })
const mgmt = ctx(["management"], { uid: "mg", employeeId: "e_mg" })
const sup = ctx(["supervisor"], { uid: "sup", employeeId: "e_sup", sites: ["s1"] })
const worker = ctx([], { uid: "wu", employeeId: "w1" })
const who = (c: HrContext) => ({ uid: c.uid, name: c.uid })

const sites: HrSite[] = [
  { id: "s1", organizationId: ORG, name: "Tower", type: "project", projectId: "p1", active: true, supervisorUserId: "sup", supervisorEmployeeId: "e_sup" },
  { id: "ws", organizationId: ORG, name: "Workshop", type: "workshop", active: true },
  { id: "hq", organizationId: ORG, name: "HQ", type: "hq", active: true },
]
const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: ORG, no: 1, names: { ar: `م ${id}` }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: "s1", join: "2024-01-01", source: "local", contract: { type: "open" }, probation: { end: "2024-03-30", decision: "confirmed" }, status: "active", docs: {}, leaveTaken: 0, ...over }) as HrEmployee
const siteType = (id: string | null | undefined) => sites.find((s) => s.id === id)?.type ?? null
const inbox = (uid: string) => listCollection<{ type: string; message: string }>(`users/${uid}/notifications`)

// ---------------------------------------------------------------------------
// Training — pure
// ---------------------------------------------------------------------------

describe("which certificates a person needs (TR-01, the prototype's reqCerts)", () => {
  it("induction on a site/workshop/warehouse/fleet; height for the climbing trades on a project; first aid by trade", () => {
    expect(reqCerts(emp("a", { trade: "carpenter" }), "project")).toEqual(["ind", "hgt"])
    expect(reqCerts(emp("a", { trade: "carpenter", siteId: "ws" }), "workshop")).toEqual(["ind"])
    expect(reqCerts(emp("a", { trade: "foreman" }), "project")).toEqual(["ind", "hgt", "fa"])
    expect(reqCerts(emp("a", { trade: "safety", siteId: "hq" }), "hq")).toEqual(["fa"])
    expect(reqCerts(emp("a", { trade: "accountant", siteId: "hq" }), "hq")).toEqual([])
    // None before he arrives, none unassigned.
    expect(reqCerts(emp("a", { status: "expected" }), "project")).toEqual([])
    expect(reqCerts(emp("a", { siteId: "__bench__" }), "project")).toEqual([])
  })

  it("a gap is red when missing or expired on someone at work — the induction after a three-day grace", () => {
    const fresh = emp("n", { join: "2026-10-03" })
    const old = emp("o", { certs: { ind: "2026-09-01" } })
    const soon = emp("s", { certs: { ind: "2026-10-20" } })
    const ok = emp("k", { certs: { ind: "2027-06-01" } })
    const gaps = certGaps([fresh, old, soon, ok], siteType, TODAY)
    expect(gaps.map((g) => [g.employeeId, g.state])).toEqual([["n", "missing"], ["o", "expired"], ["s", "d30"]])
    const bad = gaps.filter((g) => gapBad(g, [fresh, old, soon].find((e) => e.id === g.employeeId), TODAY)).map((g) => g.employeeId)
    expect(bad).toEqual(["o"]) // the joiner of two days ago is in his grace; an expiring one is amber
    expect(gapBad(gaps[0], { ...fresh, join: "2026-10-01" }, TODAY)).toBe(true)
  })

  it("a pass is valid for the course's months; a session needs a day not past, seats, and people within them", () => {
    expect(certExpiry("2026-10-05", "ind")).toBe("2027-10-05")
    expect(certExpiry("2026-01-31", "hgt")).toBe("2028-01-31")
    expect(scheduleBlocks({ course: "ind", at: "2026-10-04", seats: 0, ppl: [] }, TODAY)).toEqual(["past", "bad_seats", "no_one"])
    expect(scheduleBlocks({ course: "ind", at: TODAY, seats: 1, ppl: ["a", "b"] }, TODAY)).toEqual(["over_seats"])
    expect(scheduleBlocks({ course: "hgt", at: TODAY, seats: 2, ppl: ["a"] }, TODAY)).toEqual([])
  })

  it("the session's pool: the certificate's gaps not booked yet, worst first — or the people reviews named", () => {
    const people = [emp("a", { certs: { ind: "2026-10-20" } }), emp("b"), emp("c", { certs: { ind: "2026-09-01" } }), emp("d", { siteId: "ws" })]
    const gaps = certGaps(people, siteType, TODAY)
    const booked: TrainingSession = { id: "t", organizationId: ORG, kind: "session", course: "ind", at: "2026-10-10", siteId: "s1", seats: 5, ppl: ["d"], names: {}, siteIds: ["ws"], state: "plan", by: "hrm", byName: null, createdAt: "" }
    const byId = (id: string) => people.find((e) => e.id === id)
    expect(sessionPool(courseOf("ind")!, { gaps, sessions: [booked], needs: [], byId, today: TODAY })).toEqual(["b", "c", "a"])
    expect(sessionPool(courseOf("ind")!, { gaps, sessions: [], needs: [], byId, today: TODAY, siteId: "ws" })).toEqual(["d"])
    expect(sessionPool(courseOf("sup")!, { gaps, sessions: [], needs: [{ employeeId: "x", need: "sup" }, { employeeId: "y", need: "xl" }], byId, today: TODAY })).toEqual(["x"])
  })

  it("an external course's cost: attendees × price, split over their workplaces' cost kinds (a project carries its id)", () => {
    expect(trainingCost(courseOf("fa")!, ["s1", "s1", "ws"], sites)).toEqual({ amount: 840, lines: [{ costKind: "direct", projectId: "p1", amount: 560 }, { costKind: "workshop", projectId: null, amount: 280 }] })
    expect(trainingCost(courseOf("ind")!, ["s1"], sites).amount).toBe(0) // internal: no cost
    const entry = postHrTraining({ key: "hr:TRN:t1", course: "fa", count: 3, lines: trainingCost(courseOf("fa")!, ["s1", "s1", "ws"], sites).lines }, { date: TODAY })
    expect(entry.lines.reduce((a, l) => a + (l.debit ?? 0), 0)).toBe(entry.lines.reduce((a, l) => a + (l.credit ?? 0), 0))
    expect(entry.lines[0]).toMatchObject({ account: "520104", debit: 560, project: "p1" })
    expect(entry.description).not.toMatch(/م a/) // no person named in the org-readable journal
  })
})

// ---------------------------------------------------------------------------
// Training — writes
// ---------------------------------------------------------------------------

describe("scheduling a session and recording its result (WF-20, form 28)", () => {
  beforeEach(() => {
    resetFakeDb()
    for (const e of [emp("w1", { userId: "wu" }), emp("w2"), emp("w3", { siteId: "ws" })]) seed(`employees/${e.id}`, e as unknown as Record<string, unknown>)
  })

  it("only the HR manager schedules; the site's supervisor is told who of his goes, and when", async () => {
    const people = [{ id: "w1", name: "م w1", siteId: "s1" }, { id: "w2", name: "م w2", siteId: "s1" }]
    await expect(scheduleSession(db, sup, ORG, who(sup), { course: "fa", at: "2026-10-12", seats: 6, people }, { sites, today: TODAY })).rejects.toMatchObject({ code: "no_role" })
    await expect(scheduleSession(db, hrm, ORG, who(hrm), { course: "fa", at: "2026-10-01", seats: 6, people }, { sites, today: TODAY })).rejects.toMatchObject({ blocks: ["past"] })
    const id = await scheduleSession(db, hrm, ORG, who(hrm), { course: "fa", at: "2026-10-12", seats: 6, people }, { sites, today: TODAY })
    expect(readDoc<TrainingSession>(`hrTraining/${id}`)).toMatchObject({ state: "plan", siteId: null, ppl: ["w1", "w2"], siteIds: ["s1"] })
    expect(inbox("sup").map((n) => n.type)).toEqual(["hr_training_scheduled"])
    expect(inbox("sup")[0].message).toContain("2")
  })

  it("the result: certificates from the session's day for those who attended, a log entry each, the cost to Finance once", async () => {
    seed("hrTraining/t1", { organizationId: ORG, kind: "session", course: "fa", at: "2026-10-04", siteId: null, seats: 6, ppl: ["w1", "w2", "w3"], names: {}, siteIds: ["s1", "ws"], state: "plan", by: "hrm", byName: null, createdAt: "" })
    const employeeSites = new Map([["w1", "s1"], ["w2", "s1"], ["w3", "ws"]])
    const r = await recordSessionResult(db, hrm, who(hrm), "t1", { absent: ["w2"] }, { sites, employeeSites, today: TODAY })
    expect(r).toEqual({ passed: 2, cost: 560 })
    expect(readDoc<HrEmployee>("employees/w1")?.certs?.fa).toBe("2028-10-04")
    expect(readDoc<HrEmployee>("employees/w2")?.certs?.fa).toBeUndefined()
    expect(listCollection<{ kind: string }>("employees/w1/log").map((l) => l.kind)).toEqual(["cert_passed"])
    expect(listCollection("employees/w2/log")).toEqual([])
    expect(readDoc<TrainingSession>("hrTraining/t1")).toMatchObject({ state: "done", abs: ["w2"], event: "hr:TRN:t1" })
    const ev = readDoc<TrainingCostEvent>(`hrEvents/${ORG}__hr:TRN:t1`)!
    expect(ev).toMatchObject({ kind: "TRN", state: "sent", amount: 560, count: 2 })
    // Recorded once: a second time is refused.
    await expect(recordSessionResult(db, hrm, who(hrm), "t1", { absent: [] }, { sites, employeeSites, today: TODAY })).rejects.toMatchObject({ blocks: ["not_planned"] })
    // Finance pays it: the event moves to paid (Accounting off: recorded without an entry), and only once.
    const fin = { uid: "fin", name: "F", allowed: true }
    await payTrainingCost(db, fin, ORG, ev, { accountingOn: false, date: TODAY })
    expect(readDoc<TrainingCostEvent>(`hrEvents/${ORG}__hr:TRN:t1`)?.state).toBe("paid")
    await expect(payTrainingCost(db, fin, ORG, ev, { accountingOn: false, date: TODAY })).rejects.toMatchObject({ blocks: ["stale"] })
    await expect(payTrainingCost(db, { ...fin, allowed: false }, ORG, ev, { accountingOn: false, date: TODAY })).rejects.toMatchObject({ code: "no_role" })
  })

  it("not before the day, and an internal course sends no cost", async () => {
    seed("hrTraining/t2", { organizationId: ORG, kind: "session", course: "ind", at: "2026-10-08", siteId: "s1", seats: 6, ppl: ["w1"], names: {}, siteIds: ["s1"], state: "plan", by: "hrm", byName: null, createdAt: "" })
    await expect(recordSessionResult(db, hrm, who(hrm), "t2", { absent: [] }, { sites, employeeSites: new Map(), today: TODAY })).rejects.toMatchObject({ blocks: ["not_yet"] })
    const r = await recordSessionResult(db, hrm, who(hrm), "t2", { absent: [] }, { sites, employeeSites: new Map([["w1", "s1"]]), today: "2026-10-08" })
    expect(r.cost).toBe(0)
    expect(listCollection("hrEvents")).toEqual([])
    expect(trainHours([readDoc<TrainingSession>("hrTraining/t2")!], "2026")).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Performance — pure
// ---------------------------------------------------------------------------

describe("the score (PF-04, the prototype's rvScore) and its band", () => {
  it("a worker's grade or the staff average × 80% + the record × 20%, one decimal", () => {
    expect(reviewScore("labour", { o: 3 }, { abs: 0, pen: 0 })).toBe(4.8) // 4.7 × .8 + 5 × .2
    expect(reviewScore("labour", { o: 2 }, { abs: 2, pen: 1 })).toBe(3.3) // 3.6 × .8 + 2 × .2
    expect(reviewScore("staff", { g: 5, q: 4, i: 4, t: 5 }, { abs: 0, pen: 0 })).toBe(4.6)
    expect(reviewScore("staff", { g: 5, q: 4, i: 4 }, { abs: 0, pen: 0 })).toBeNull() // incomplete
    expect(reviewScore("labour", { o: 1 }, { abs: 9, pen: 0 }, 0.5)).toBe(1.5) // the record never below 1
    expect([4.3, 4.29, 3.5, 2.5, 2.4].map(bandOf)).toEqual(["A", "B", "B", "C", "D"])
  })

  it("the record: absences of this and last month, penalties applied with an amount in 180 days, an injury", () => {
    const e = { id: "w1", att: { m: { "2026-09": { absent: 2, ot: 5 }, "2026-10": { absent: 1, ot: 1 }, "2026-08": { absent: 9 } } } }
    const violations = [
      { employeeId: "w1", state: "applied" as const, on: "2026-09-10", amount: 100 },
      { employeeId: "w1", state: "applied" as const, on: "2026-09-11", amount: 0 }, // a warning: no amount
      { employeeId: "w1", state: "cancelled" as const, on: "2026-09-12", amount: 100 },
      { employeeId: "w1", state: "upheld" as const, on: "2026-01-01", amount: 100 }, // older than 180 days
    ]
    expect(recordFacts(e, { violations, injuries: [{ employeeId: "w1" }], today: TODAY })).toEqual({ abs: 3, pen: 1, ot: 6, injury: true })
  })

  it("six months at work to be in a cycle; one cycle at a time, closing after opening", () => {
    expect(reviewEligible(emp("a", { join: "2026-04-08" }), TODAY)).toBe(true)
    expect(reviewEligible(emp("a", { join: "2026-04-09" }), TODAY)).toBe(false)
    expect(reviewEligible(emp("a", { status: "leaving" }), TODAY)).toBe(false)
    expect(cycleBlocks({ open: TODAY, close: TODAY }, null)).toEqual(["close_before_open"])
    expect(cycleBlocks({ open: TODAY, close: "2026-11-01" }, { close: "2026-10-10" })).toEqual(["running"])
  })

  it("calibration flags a rater mostly outstanding (≥5 sent, >60% A) and one grade for almost all (≥10, ≥90%)", () => {
    const r = (i: number, rater: string, o: 1 | 2 | 3, st: HrReview["st"] = "done") => ({ id: `r${i}`, organizationId: ORG, kind: "review", cycleId: "c", employeeId: `x${i}`, employeeUserId: null, employeeName: "", employeeNo: i, trade: "mason", category: "labour", siteId: "s1", raterEmployeeId: rater, raterUserId: rater, raterName: rater, st, sc: { o }, rec: { abs: 0, pen: 0, ot: 0, injury: false } }) as HrReview
    const list = [...Array.from({ length: 6 }, (_, i) => r(i, "A", 3)), ...Array.from({ length: 10 }, (_, i) => r(10 + i, "B", 2)), r(30, "B", 2, "draft")]
    const rows = raters(list, 0.2)
    const a = rows.find((x) => x.key === "A")!
    const b = rows.find((x) => x.key === "B")!
    expect([a.flag, a.flat, a.pend, a.pA]).toEqual([true, false, 6, 100])
    expect([b.flag, b.flat, b.pend, b.all.length]).toEqual([false, true, 10, 11])
  })

  it("the raise plan over APPROVED reviews: wage × band %, loaded with employer GOSI and the EOS accrual; pending ones apart", () => {
    const rv = (id: string, o: 1 | 2 | 3, st: HrReview["st"]) => ({ id, organizationId: ORG, kind: "review", cycleId: "c", employeeId: id, employeeUserId: null, employeeName: "", employeeNo: 1, trade: "mason", category: "labour", siteId: "s1", raterEmployeeId: null, raterUserId: null, raterName: null, st, sc: { o }, rec: { abs: 0, pen: 0, ot: 0, injury: false } }) as HrReview
    const pays = new Map([["a", { basic: 4000, housing: 1000, transport: 400 }], ["b", { basic: 3000, housing: 750, transport: 300 }], ["c", { basic: 2000, housing: 500, transport: 200 }]])
    const people = new Map([["a", emp("a")], ["b", emp("b")], ["c", emp("c")]])
    const plan = raisePlan([rv("a", 3, "ok"), rv("b", 2, "ack"), rv("c", 3, "done")], { pct: { A: 7, B: 4, C: 2, D: 0 }, weight: 0.2, pays, people, today: TODAY })
    expect(plan.byBand.A).toEqual(["a"])
    expect(plan.byBand.B).toEqual(["b"]) // 3.6 × .8 + 5 × .2 = 3.9
    expect(plan.cost).toEqual({ A: 378, B: 162, C: 0, D: 0 }) // 5,400 × 7% · 4,050 × 4%
    expect(plan.total).toBe(540)
    expect(plan.loaded).toBe(Math.round(378 * 1.02 + 378 / 24) + Math.round(162 * 1.02 + 162 / 24))
    expect([plan.rest, plan.n]).toEqual([1, 2])
    expect(raisedBasic(4000, 7)).toBe(4280)
    expect(raisedBasic(3333, 4)).toBe(3470)
    expect(firstOfNextMonth("2026-10-05")).toBe("2026-11-01")
    expect(firstOfNextMonth("2026-12-31")).toBe("2027-01-01")
  })

  it("whose hand: the rater named grades (never his own); management applies an HR manager's raise, the HR manager everyone else's", () => {
    const r = { raterUserId: "sup", employeeUserId: "wu", employeeId: "w1", hrm: false }
    expect([mayRate(sup, r), mayRate(hrm, r), mayRate(mgmt, r)]).toEqual([true, false, false])
    expect(mayRate(mgmt, { ...r, raterUserId: null })).toBe(true)
    expect(mayRate(worker, { ...r, raterUserId: null })).toBe(false)
    expect([mayApplyRaise(hrm, r), mayApplyRaise(mgmt, r)]).toEqual([true, false])
    const theHrm = { raterUserId: null, employeeUserId: "hrm", employeeId: "e_hrm", hrm: true }
    expect([mayApplyRaise(hrm, theHrm), mayApplyRaise(mgmt, theHrm)]).toEqual([false, true])
    expect(hrAllowed(mgmt, "perf.raise.decide")).toBe(true)
    expect(hrAllowed(hrm, "perf.raise.decide")).toBe(false)
  })

  it("the policies: raise % by band A7/B4/C2/D0 and the record weight 20% by default, bounded", () => {
    expect(DEFAULT_HR_POLICIES).toMatchObject({ raiseA: 7, raiseB: 4, raiseC: 2, raiseD: 0, recordWeight: 0.2 })
    expect(resolveHrPolicies({ raiseA: 30, raiseB: 3.3, recordWeight: 0.9 })).toMatchObject({ raiseA: 7, raiseB: 3.5, recordWeight: 0.2 })
  })
})

// ---------------------------------------------------------------------------
// Performance — the cycle, end to end
// ---------------------------------------------------------------------------

describe("a review cycle end to end (WF-21/22)", () => {
  const people = [
    emp("e_hrm", { userId: "hrm", category: "staff", trade: "hrOfficer", nationality: "sa", siteId: "hq" }),
    emp("e_mg", { userId: "mg", category: "staff", trade: "manager", siteId: "hq" }),
    emp("e_sup", { userId: "sup", category: "staff", trade: "foreman", siteId: "s1" }),
    emp("w1", { userId: "wu", siteId: "s1" }),
    emp("w2", { siteId: "s1" }),
    emp("new", { siteId: "s1", join: "2026-08-01" }),
  ]
  const cyc = cycleId(ORG, TODAY)
  const rv = (id: string) => readDoc<HrReview>(`hrReviews/${reviewId(cyc, id)}`)!
  const cycleDoc = () => ({ ...readDoc<ReviewCycle>(`hrReviews/${cyc}`)!, id: cyc })
  const recOf = () => ({ abs: 0, pen: 0, ot: 0, injury: false })

  beforeEach(async () => {
    resetFakeDb()
    // The team the role-addressed notices resolve against (each member's default group).
    seed("teamGroups/g_hrm", { organizationId: ORG, permissions: ["employees.manage"] })
    seed("teamGroups/g_mg", { organizationId: ORG, permissions: ["hr.management"] })
    seed("teamGroups/g_sup", { organizationId: ORG, permissions: ["hr.supervisor"] })
    seed(`users/${ORG}`, { organizationId: ORG, organizationRole: "owner" })
    for (const [uid, g] of [["hrm", "g_hrm"], ["mg", "g_mg"], ["sup", "g_sup"]]) seed(`users/${uid}`, { organizationId: ORG, organizationRole: "member", defaultGroupId: g })
    for (const e of people) seed(`employees/${e.id}`, e as unknown as Record<string, unknown>)
    for (const e of people) seed(`employeePay/${e.id}`,{ organizationId: ORG, employeeId: e.id, basic: 4000, housing: 1000, transport: 400 })
    await openCycle(db, hrm, ORG, who(hrm), { open: TODAY, close: "2026-11-04" }, { employees: people, sites, current: null, recOf, hrManagerEmployeeIds: ["e_hrm"] })
  })

  it("opens with a review per eligible person, its rater from the chain; the HR manager's is management's; raters are told", () => {
    expect(listCollection<HrReview>("hrReviews").filter((r) => r.kind === "review").map((r) => r.employeeId).sort()).toEqual(["e_hrm", "e_mg", "e_sup", "w1", "w2"])
    expect(rv("w1")).toMatchObject({ st: "draft", raterEmployeeId: "e_sup", raterUserId: "sup", hrm: false })
    expect(rv("e_hrm")).toMatchObject({ raterUserId: null, hrm: true })
    expect("sc" in rv("w1")).toBe(false) // the rules let the HR manager create a review only without a grade
    expect(inbox("sup").map((n) => n.type)).toContain("hr_cycle_opened")
  })

  it("the rater grades his workers (the same grade again clears it) and sends; nobody else may", async () => {
    const r = { ...rv("w1"), id: reviewId(cyc, "w1") }
    await expect(gradeWorker(db, hrm, who(hrm), r, 3, { cycle: cycleDoc(), today: TODAY })).rejects.toMatchObject({ code: "no_role" })
    await gradeWorker(db, sup, who(sup), r, 3, { cycle: cycleDoc(), today: TODAY })
    expect(rv("w1").sc).toEqual({ o: 3 })
    await gradeWorker(db, sup, who(sup), { ...r, sc: { o: 3 } }, null, { cycle: cycleDoc(), today: TODAY })
    expect(rv("w1").sc).toBeNull()
    await gradeWorker(db, sup, who(sup), r, 2, { cycle: cycleDoc(), today: TODAY })
    await expect(gradeWorker(db, sup, who(sup), r, 2, { cycle: cycleDoc(), today: "2026-11-05" })).rejects.toMatchObject({ blocks: ["closed"] })
    const n = await sendDrafts(db, sup, who(sup), [{ ...rv("w1"), id: reviewId(cyc, "w1") }, { ...rv("w2"), id: reviewId(cyc, "w2") }], { cycle: cycleDoc(), today: TODAY })
    expect(n).toBe(1) // w2 has no grade yet
    expect(rv("w1").st).toBe("done")
    expect(inbox("hrm").map((x) => x.type)).toContain("hr_reviews_sent")
  })

  it("staff: four criteria all required, a training need; the employee's self-assessment is his, once", async () => {
    const r = { ...rv("e_sup"), id: reviewId(cyc, "e_sup") }
    // e_sup's line manager: the senior staff member of the tower — none but him; the chain ends at management.
    expect(r.raterUserId).toBeNull()
    await expect(submitStaffReview(db, mgmt, who(mgmt), r, { g: 4, q: 4, i: 4, t: 0 }, { cycle: cycleDoc(), today: TODAY })).rejects.toMatchObject({ blocks: ["incomplete"] })
    await submitStaffReview(db, mgmt, who(mgmt), r, { g: 5, q: 4, i: 4, t: 5, need: "sup", note: "جيد" }, { cycle: cycleDoc(), today: TODAY })
    expect(rv("e_sup")).toMatchObject({ st: "done", need: "sup", sc: { g: 5, q: 4, i: 4, t: 5 } })
    const supSelf = ctx([], { uid: "sup", employeeId: "e_sup" })
    await submitSelfReview(db, supSelf, who(supSelf), people[2], cycleDoc(), { g: 5, q: 5, i: 5, t: 5, note: "" }, { today: TODAY })
    expect(readDoc(`hrReviews/${selfId(reviewId(cyc, "e_sup"))}`)).toMatchObject({ kind: "self", st: "self", employeeUserId: "sup" })
    await expect(submitSelfReview(db, worker, who(worker), people[2], cycleDoc(), { g: 5, q: 5, i: 5, t: 5 }, { today: TODAY })).rejects.toMatchObject({ code: "no_role" })
    await expect(submitSelfReview(db, worker, who(worker), people[3], cycleDoc(), { g: 5, q: 5, i: 5, t: 5 }, { today: TODAY })).rejects.toMatchObject({ blocks: ["incomplete"] }) // labour: no self-assessment
  })

  it("approval per rater freezes the score and band, opens a plan for D, logs without an amount and tells the employee; return sends drafts back", async () => {
    const id = reviewId(cyc, "w1")
    await gradeWorker(db, sup, who(sup), { ...rv("w1"), id }, 1, { cycle: cycleDoc(), today: TODAY })
    await sendDrafts(db, sup, who(sup), [{ ...rv("w1"), id }], { cycle: cycleDoc(), today: TODAY })
    await returnReviews(db, hrm, who(hrm), [{ ...rv("w1"), id }], { close: "2026-11-04" })
    expect(rv("w1").st).toBe("draft")
    expect(inbox("sup").map((n) => n.type)).toContain("hr_reviews_returned")
    await sendDrafts(db, sup, who(sup), [{ ...rv("w1"), id }], { cycle: cycleDoc(), today: TODAY })
    await approveReviews(db, hrm, who(hrm), [{ ...rv("w1"), id }], { year: "2026", recOf: () => ({ abs: 2, pen: 0, ot: 0, injury: false }), today: TODAY })
    expect(rv("w1")).toMatchObject({ st: "ok", score: 2.2, band: "D", rec: { abs: 2 } })
    expect(readDoc<HrEmployee>("employees/w1")?.pip).toMatchObject({ until: "2026-12-04", by: "hrm" })
    const log = listCollection<{ kind: string; params: Record<string, unknown> }>("employees/w1/log")
    expect(log.map((l) => l.kind)).toEqual(["review_approved"])
    expect(JSON.stringify(log)).not.toMatch(/4000|basic/)
    expect(inbox("wu").map((n) => n.type)).toEqual(["hr_review_ready"])
    // His own review is never the HR manager's to approve.
    const own = { ...rv("e_hrm"), id: reviewId(cyc, "e_hrm"), st: "done" as const, sc: { g: 4, q: 4, i: 4, t: 4 } }
    await expect(approveReviews(db, hrm, who(hrm), [own], { year: "2026", recOf, today: TODAY })).rejects.toMatchObject({ blocks: ["nothing"] })
    // The employee acknowledges.
    await acknowledgeReview(db, worker, { ...rv("w1"), id })
    expect(rv("w1")).toMatchObject({ st: "ack" })
    await expect(acknowledgeReview(db, sup, { ...rv("w1"), id })).rejects.toMatchObject({ code: "no_role" })
  })

  it("raises: one proposal to management, one decision; the HR manager applies all but HR managers', management his — never twice", async () => {
    const approve = async (eid: string, c: HrContext, sc: HrReview["sc"]) => {
      seed(`hrReviews/${reviewId(cyc, eid)}`, { ...rv(eid), st: "ok", sc, score: null })
    }
    await approve("w1", hrm, { o: 3 })
    await approve("w2", hrm, { o: 2 })
    await approve("e_hrm", mgmt, { g: 5, q: 5, i: 5, t: 5 })
    const reviews = () => listCollection<HrReview>("hrReviews").filter((r) => r.kind === "review")
    const pays = new Map(people.map((e) => [e.id, { basic: 4000, housing: 1000, transport: 400 }]))
    const plan = raisePlan(reviews(), { pct: { A: 7, B: 4, C: 2, D: 0 }, weight: 0.2, pays, people: new Map(people.map((e) => [e.id, e])), today: TODAY })
    await expect(proposeRaises(db, mgmt, who(mgmt), cycleDoc(), plan, { A: 7, B: 4, C: 2, D: 0 }, { today: TODAY })).rejects.toMatchObject({ code: "no_role" })
    await proposeRaises(db, hrm, who(hrm), cycleDoc(), plan, { A: 7, B: 4, C: 2, D: 0 }, { today: TODAY })
    expect(cycleDoc().raise).toMatchObject({ state: "mg", eff: "2026-11-01", n: 3 })
    expect(inbox("mg").map((n) => n.type)).toContain("hr_raises_proposed")
    await expect(applyRaises(db, hrm, who(hrm), cycleDoc(), reviews(), { today: TODAY })).rejects.toMatchObject({ blocks: ["not_decided"] })
    await expect(decideRaises(db, hrm, who(hrm), cycleDoc(), true)).rejects.toMatchObject({ code: "no_role" })
    await decideRaises(db, mgmt, who(mgmt), cycleDoc(), true)
    expect(cycleDoc().raise).toMatchObject({ state: "ok", okBy: "mg" })
    expect(inbox("hrm").map((n) => n.type)).toContain("hr_raises_decided")
    // The HR manager applies w1 (A +7%) and w2 (B +4%) — not his own.
    expect(await applyRaises(db, hrm, who(hrm), cycleDoc(), reviews(), { today: TODAY })).toBe(2)
    const pay = (id: string) => readDoc<EmployeePay>(`employeePay/${id}`)!
    expect(pay("w1").basic).toBe(4000) // in force today: unchanged until the first of next month
    expect(payOn(pay("w1"), "2026-11-01")).toMatchObject({ basic: 4280, housing: 1070, transport: 428 })
    expect(payOn(pay("w2"), "2026-11-01").basic).toBe(4160)
    expect(approvedRaise(pay("w1"), "2026-11-01")).toEqual({ from: 4000, to: 4280, on: "2026-11-01" })
    expect(pay("e_hrm").steps ?? []).toEqual([])
    expect(rv("w1").raised).toMatchObject({ on: "2026-11-01" })
    expect(JSON.stringify(rv("w1"))).not.toMatch(/4280/) // no amount on a review
    // Never twice.
    expect(await applyRaises(db, hrm, who(hrm), cycleDoc(), reviews(), { today: TODAY })).toBe(0)
    // Management applies the HR manager's (RL-02).
    expect(await applyRaises(db, mgmt, who(mgmt), cycleDoc(), reviews(), { today: TODAY })).toBe(1)
    expect(payOn(pay("e_hrm"), "2026-11-01").basic).toBe(4280)
  })

  it("management returns the proposal: it is cleared", async () => {
    seed(`hrReviews/${reviewId(cyc, "w1")}`, { ...rv("w1"), st: "ok", sc: { o: 3 } })
    const plan = raisePlan(listCollection<HrReview>("hrReviews").filter((r) => r.kind === "review"), { pct: { A: 7, B: 4, C: 2, D: 0 }, weight: 0.2, pays: new Map([["w1", { basic: 4000, housing: 1000, transport: 400 }]]), people: new Map([["w1", people[3]]]), today: TODAY })
    await proposeRaises(db, hrm, who(hrm), cycleDoc(), plan, { A: 7, B: 4, C: 2, D: 0 }, { today: TODAY })
    await decideRaises(db, mgmt, who(mgmt), cycleDoc(), false)
    expect(cycleDoc().raise).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Today's rows and the tab's numbers
// ---------------------------------------------------------------------------

describe("Today's growth rows (x5Decisions) — each for the hand that acts, none leaking (TD-03)", () => {
  const people = [emp("w1", { certs: { ind: "2026-09-01" } }), emp("w2"), emp("w3", { join: "2026-10-04" })]
  const session: TrainingSession = { id: "t1", organizationId: ORG, kind: "session", course: "ind", at: TODAY, siteId: "s1", seats: 5, ppl: ["w1"], names: {}, siteIds: ["s1"], state: "plan", by: "hrm", byName: null, createdAt: "" }
  const cycle: ReviewCycle = { id: "c", organizationId: ORG, kind: "cycle", open: "2026-10-01", close: "2026-10-31", year: "2026", raise: null, by: "hrm", byName: null, at: "" }
  const review = (id: string, st: HrReview["st"], rater: string | null) => ({ id, organizationId: ORG, kind: "review", cycleId: "c", employeeId: id, employeeUserId: null, employeeName: id, employeeNo: 1, trade: "mason", category: "labour", siteId: "s1", raterEmployeeId: rater, raterUserId: rater, raterName: rater, st, sc: st === "draft" ? null : { o: 3 }, rec: { abs: 0, pen: 0, ot: 0, injury: false } }) as HrReview
  const base = { today: TODAY, renewWindowDays: 60, recordWeight: 0.2, employees: people, sites, sessions: [session], cycle, reviews: [review("w1", "done", "sup"), review("w2", "draft", "sup")] }
  const both = new Set(["train", "perf"] as const)

  it("HR manager: on duty without a certificate (red, the booked counted), the session due, reviews awaiting approval", () => {
    const items = growthTodayItems({ ...base, ctx: hrm, features: both })
    expect(items.map((x) => [x.kind, x.severity, x.params.count])).toEqual([
      ["train_gaps", "red", 2], // w1 expired, w2 missing — w3 within his three days
      ["train_session", "amber", 1],
      ["perf_pending", "blue", 1],
    ])
    expect(items[0].facts?.[0]).toEqual({ k: "train_booked", p: { n: 1 } })
    expect(leakage(items)).toBe(0)
  })

  it("the supervisor: his workers without a certificate and the next session; his team to rate", () => {
    const items = growthTodayItems({ ...base, ctx: sup, features: both })
    expect(items.map((x) => x.kind)).toEqual(["train_gaps_mine", "perf_rate"])
    expect(items[0].facts?.[0]).toEqual({ k: "train_next", p: { date: TODAY } })
    expect(items[0].action).toBe("view")
  })

  it("management decides the proposal (a monthly figure only to pay roles); a switch off removes its rows", () => {
    const pays = new Map([["w1", { employeeId: "w1", organizationId: ORG, basic: 4000, housing: 1000, transport: 400 }]])
    const withRaise = { ...cycle, raise: { state: "mg" as const, eff: "2026-11-01", pct: { A: 7, B: 4, C: 2, D: 0 }, n: 1, by: "hrm", byName: null, at: "" } }
    const items = growthTodayItems({ ...base, ctx: mgmt, features: both, cycle: withRaise, reviews: [review("w1", "ok", "sup")], pays })
    expect(items.map((x) => x.kind)).toEqual(["perf_raises"])
    expect(items[0].facts?.[0]).toEqual({ k: "perf_raise_cost", p: { cost: 378 } })
    expect(growthTodayItems({ ...base, ctx: hrm, features: new Set(["perf"] as const) }).map((x) => x.kind)).toEqual(["perf_pending"])
    expect(growthTodayItems({ ...base, ctx: hrm, features: new Set() })).toEqual([])
  })

  it("the tab's numbers: training's three, the office's and the rater's — money hidden without pay", () => {
    expect(trainingKpis({ ...base, scope: null }).map((k) => [k.id, k.value])).toEqual([["train_bad", 2], ["train_soon", 0], ["train_planned", 1]])
    expect(trainingKpis({ ...base, scope: ["ws"] })[0].value).toBe(0)
    const office = perfKpis({ ...base, ctx: mgmt, pct: { A: 7, B: 4, C: 2, D: 0 }, pays: null })
    expect(office.map((k) => k.id)).toEqual(["perf_done", "perf_pending_hr", "perf_raises"])
    expect(office[2].hidden).toBe(true)
    expect(perfKpis({ ...base, ctx: sup, pct: { A: 7, B: 4, C: 2, D: 0 }, pays: null }).map((k) => [k.id, k.value])).toEqual([["perf_team_sent", 1], ["perf_drafts", 0], ["perf_team_wait", 1]])
  })
})

describe("notifications name no amount (RL-03)", () => {
  it("the growth notices carry no riyal and no figure placeholder for money", () => {
    for (const k of ["hr_training_scheduled", "hr_training_cost", "hr_cycle_opened", "hr_reviews_sent", "hr_reviews_returned", "hr_review_ready", "hr_raises_proposed", "hr_raises_decided"] as const) {
      const c = HR_NOTICE_COPY_AR[k]
      expect(`${c.title} ${c.message}`).not.toMatch(/amount|total|cost\}|﷼|⃁/)
    }
  })
})

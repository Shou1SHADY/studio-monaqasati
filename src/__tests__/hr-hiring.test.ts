/**
 * HR 1.0 — hiring and onboarding (HI-01…08, WF-17/18, ST-03; optional: hire).
 * An opening is born from a fact — a new position waits for management when
 * the policy blocks, a replacement and a manpower request's "hire" remainder
 * open at once — and carries an honest date from its furthest stage. The
 * individuals track: candidate → interview (scorecard; not recommended =
 * rejected) → offer in the band (above → management) → accepted → converted
 * through createEmployee in one transaction. The batch track: agency → trade
 * test → visas issued (taken out of the free balance once, as a lot of the
 * trade with its arrival date, which coverage offers) → arrivals by name, each
 * spending the LOT, never the balance again. Money sits on its own document.
 * Today shows each role its rows, and none with the switch off.
 */
jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { listCollection, readDoc, resetFakeDb, seed, fakeFirestore } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import type { HrContext } from "@/lib/hr/access"
import type { HrEmployee } from "@/lib/hr/employee"
import { createEmployee } from "@/lib/hr/employee-writes"
import { todayDay } from "@/lib/hr/format"
import {
  bandOf,
  batchBlocks,
  candidateBlocks,
  leadShortfall,
  offerCheck,
  offerFigures,
  onboardingItems,
  onboardingList,
  openingEta,
  openingLate,
  positionCost,
  prefillFromCandidate,
  replacementSuggestions,
  saudiPct,
  saudiPctAfter,
  saudiPctProjected,
  VISA_LEAD_DAYS,
  visaLots,
  type Candidate,
  type Opening,
} from "@/lib/hr/hiring"
import { addCandidate, answerOffer, batchStep, closeOpening, decideOffer, decidePosition, makeOffer, openOpening, recordScorecard, registerArrivals, screenCandidate, tickOnboarding } from "@/lib/hr/hiring-writes"
import type { HiringWorld } from "@/lib/hr/hiring-today"
import { answerManpowerRequest, coverage, COVERAGE, type ManpowerRequest } from "@/lib/hr/manpower"
import { addDays, DEFAULT_HR_POLICIES, resolveHrPolicies } from "@/lib/hr/statutory"
import { hrTabCounts, leakage, todayItems, type TodayInput } from "@/lib/hr/today"

const db = fakeFirestore as unknown as Firestore
const today = todayDay()
const P = DEFAULT_HR_POLICIES
const H = { uid: "hrm", name: "مدير الموارد" }
const hrm: HrContext = { uid: "hrm", owner: false, roles: new Set(["manager"]), employeeId: null, sites: [] }
const gov: HrContext = { uid: "gro", owner: false, roles: new Set(["gov"]), employeeId: null, sites: [] }
const mgmt: HrContext = { uid: "mg", owner: false, roles: new Set(["management"]), employeeId: null, sites: [] }

const emp = (id: string, over: Partial<HrEmployee> = {}): HrEmployee =>
  ({ id, organizationId: "org", no: 1, names: { ar: id }, nationality: "eg", gender: "m", trade: "mason", category: "labour", siteId: "s1", join: "2025-01-01", source: "local", contract: { type: "open" }, probation: { end: "2025-03-31", decision: "confirmed" }, status: "active", docs: { iqama: "2027-12-31" }, leaveTaken: 0, ...over }) as HrEmployee

const opening = (over: Partial<Opening> = {}): Opening => ({
  id: "j1",
  organizationId: "org",
  kind: "opening",
  pay: false,
  no: "JOB-2026/001",
  trade: "accountant",
  q: 1,
  siteId: "s1",
  need: addDays(today, 30),
  src: "new",
  ref: null,
  track: "ind",
  state: "open",
  filled: 0,
  why: null,
  opened: { by: "hrm", byName: null, at: `${today}T08:00:00Z` },
  batch: null,
  ...over,
})
const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c1",
  organizationId: "org",
  kind: "candidate",
  pay: false,
  openingId: "j1",
  trade: "accountant",
  siteId: "s1",
  names: { ar: "مرشح", en: "Candidate" },
  nat: "eg",
  gender: "m",
  src: "ref",
  phone: null,
  stage: "new",
  added: { by: "hrm", byName: null, at: "" },
  intAt: null,
  sc: null,
  offer: null,
  why: null,
  employeeId: null,
  ...over,
})
const rec = <T extends { id: string }>({ id: _id, ...r }: T) => r

function seedWorld(visas = 10) {
  resetFakeDb()
  seed("users/org", { organizationId: "org", organizationRole: "owner", name: "Owner" })
  seed("hrSettings/org", { organizationId: "org", features: ["hire"], establishment: { visas } })
  seed("hrSites/s1", { organizationId: "org", name: "Tower", type: "project", active: true })
}

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

describe("policies, band and cost (HI-05, ST-03)", () => {
  it("the band is 90–120% of the trade's reference wage, to the nearest 50; both strict switches default to block", () => {
    expect(P).toMatchObject({ offerBandLow: 0.9, offerBandHigh: 1.2, jobApprove: "block", offerBand: "block" })
    expect(bandOf("accountant", P)).toEqual([6750, 9000])
    expect(bandOf("nope", P)).toBeNull()
    expect(resolveHrPolicies({ offerBandLow: 1.5, offerBandHigh: 0.5, jobApprove: "warn", offerBand: "x" as never })).toMatchObject({ offerBandLow: 0.9, offerBandHigh: 1.2, jobApprove: "warn", offerBand: "block" })
  })

  it("a position's monthly cost = ref × (1 + allowances) × 1.12 × count; an offer's company cost adds the employer's GOSI and EOS", () => {
    expect(positionCost("accountant", 2, P)).toBe(Math.round(7500 * 1.35 * 1.12) * 2)
    // A Saudi joining now is on the new scheme (12.25% of basic + housing); wage/24 for end of service.
    expect(offerFigures(8000, "sa", P, today)).toEqual({ wage: 10800, cost: Math.round(10800 + 0.1225 * 10000 + 10800 / 24) })
    expect(offerFigures(8000, "eg", P, today).cost).toBe(Math.round(10800 + 0.02 * 10000 + 10800 / 24))
  })

  it("an offer above the band is held for management under the strict policy, sent with a warning under the other", () => {
    const base = { basic: 9500, start: addDays(today, 40), until: addDays(today, 7), nat: "sa", trade: "accountant", need: addDays(today, 30) }
    const strict = offerCheck(base, P, today)
    expect(strict).toMatchObject({ blocks: [], over: true, held: true })
    expect(strict.warnings).toEqual(["above_band", "start_after_need"])
    expect(offerCheck(base, { ...P, offerBand: "warn" }, today)).toMatchObject({ over: true, held: false })
    expect(offerCheck({ ...base, basic: 3500, trade: "cashier" }, P, today).warnings).toContain("saudi_below_nitaqat")
    expect(offerCheck({ ...base, basic: 0, until: addDays(today, -1) }, P, today).blocks).toEqual(["bad_basic", "until_past"])
  })

  it("a Saudi-only trade takes no non-Saudi candidate (HI-08); a name in either language is enough", () => {
    expect(candidateBlocks({ nameAr: "", nameEn: "Ali", nat: "eg", trade: "cashier", ask: null })).toEqual(["saudi_only"])
    expect(candidateBlocks({ nameAr: "", nameEn: "", nat: "sa", trade: "cashier", ask: 0 })).toEqual(["no_name", "bad_ask"])
    expect(candidateBlocks({ nameAr: "علي", nameEn: null, nat: "sa", trade: "cashier", ask: null })).toEqual([])
  })
})

describe("the honest date (HI-03)", () => {
  it("a batch by its stage; the recruitment lead is the manpower coverage's", () => {
    expect(VISA_LEAD_DAYS).toBe(COVERAGE.visaLeadDays)
    const b = (stage: "auth" | "test" | "visa" | "arr", eta: string | null = null) => opening({ track: "batch", batch: { stage, agency: "A", nat: "bd", sel: 4, eta, issued: 0, visas: 0, reserved: 0 } })
    expect(openingEta(b("auth"), [], today)).toEqual({ date: addDays(today, 90), why: "auth" })
    expect(openingEta(b("test"), [], today).date).toBe(addDays(today, 75))
    expect(openingEta(b("visa", "2026-12-01"), [], today).date).toBe("2026-12-01")
    expect(openingEta(b("arr"), [], today).date).toBe(today)
  })

  it("individuals by the furthest candidate: accepted start · offer + 21 · interviews + 30 · else 45; late when after the need", () => {
    const o = opening({ need: addDays(today, 25) })
    expect(openingEta(o, [], today)).toEqual({ date: addDays(today, 45), why: "none" })
    expect(openingLate(o, [], today)).toBe(20)
    expect(openingEta(o, [cand({ stage: "int" })], today).why).toBe("interviews")
    expect(openingEta(o, [cand({ stage: "offer" })], today).date).toBe(addDays(today, 21))
    expect(openingEta(o, [cand({ stage: "acc", offer: { by: "", byName: null, at: "", start: addDays(today, 10), until: today, ct: "open", state: "acc", over: false } })], today)).toEqual({ date: addDays(today, 10), why: "accepted" })
    // Waiting for management is not late yet.
    expect(openingLate({ ...o, state: "wait" }, [], today)).toBe(0)
    expect(leadShortfall(addDays(today, 30), "batch", today)).toBe(60)
    expect(leadShortfall(addDays(today, 50), "ind", today)).toBe(0)
  })
})

describe("Saudization, exits, onboarding, prefill", () => {
  const people = [emp("a", { nationality: "sa" }), emp("b"), emp("c"), emp("d", { status: "expected" })]
  it("now, after one more, and if every accepted offer and every open batch joins", () => {
    expect(saudiPct(people)).toBe(33.3)
    expect(saudiPctAfter(people, "sa")).toBe(50)
    const batch = opening({ id: "j2", track: "batch", q: 3, batch: { stage: "visa", agency: "", nat: "bd", sel: 3, eta: today, issued: 3, visas: 3, reserved: 0 } })
    expect(saudiPctProjected(people, [cand({ stage: "acc", nat: "sa" })], [batch])).toBe(Math.round((2 / 7) * 1000) / 10)
  })

  it("an exit without a replacement is a suggestion until one is opened for him", () => {
    const leaving = emp("x", { status: "leaving", lastDay: addDays(today, 20) })
    expect(replacementSuggestions([leaving, emp("y")], []).map((e) => e.id)).toEqual(["x"])
    expect(replacementSuggestions([leaving], [opening({ src: "rep", ref: "x" })])).toEqual([])
  })

  it("onboarding reads the record (iqama with its clock, insurance, IBAN for pay roles, line manager) and ticks Qiwa / GOSI", () => {
    const j = emp("n", { join: addDays(today, -5), docs: {} })
    expect(onboardingList([j, emp("old")], today).map((e) => e.id)).toEqual(["n"])
    const items = onboardingItems(j, { employees: [j], supervisorOf: () => null, hasIban: null })
    expect(items.map((x) => [x.key, x.ok])).toEqual([
      ["qiwa", false],
      ["gosi", false],
      ["iqama", false],
      ["insurance", false],
      ["iban", false],
      ["manager", true],
    ])
    expect(items.find((x) => x.key === "iqama")?.due).toBe(addDays(j.join, 90))
    expect(items.find((x) => x.key === "iban")?.unknown).toBe(true)
  })

  it("the conversion is prefilled from the offer: a Saudi local, others a transfer; contract term; start never before today", () => {
    const c = cand({ stage: "acc", nat: "sa", offer: { by: "", byName: null, at: "", start: addDays(today, -3), until: today, ct: "y2", state: "acc", over: false } })
    expect(prefillFromCandidate(c, opening(), 7000, today)).toMatchObject({ source: "local", join: today, contractType: "fixed", contractEnd: addDays(today, 730), basic: "7000", siteId: "s1", trade: "accountant" })
    expect(prefillFromCandidate({ ...c, nat: "eg" }, opening(), null, today)).toMatchObject({ source: "transfer", basic: "" })
  })
})

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

describe("openings (HI-01, ST-03)", () => {
  beforeEach(() => seedWorld())
  const input = { trade: "accountant", q: 1, siteId: "s1", need: addDays(today, 30), track: "ind" as const }

  it("a new position waits for management under the strict policy and opens at once under the other; a replacement never waits", async () => {
    const a = await openOpening(db, hrm, "org", H, input)
    expect(a).toMatchObject({ state: "wait", no: `JOB-${today.slice(0, 4)}/001` })
    expect(readDoc(`hrHiring/${a.id}`)).toMatchObject({ kind: "opening", pay: false, src: "new", state: "wait", filled: 0 })
    expect((await openOpening(db, hrm, "org", H, input, { policies: { ...P, jobApprove: "warn" } })).state).toBe("open")
    const r = await openOpening(db, hrm, "org", H, { ...input, why: "ignored", replaces: { employeeId: "x", name: "خالد" } })
    expect(readDoc(`hrHiring/${r.id}`)).toMatchObject({ state: "open", src: "rep", ref: "x", refLabel: "خالد", why: null })
    await expect(openOpening(db, gov, "org", H, input)).rejects.toMatchObject({ code: "no_role" })
    await expect(openOpening(db, hrm, "org", H, { ...input, siteId: null, q: 0 })).rejects.toMatchObject({ blocks: ["bad_count", "no_site"] })
  })

  it("management approves or declines a position — nobody else; a batch with issued visas cannot be closed", async () => {
    const a = await openOpening(db, hrm, "org", H, input)
    await expect(decidePosition(db, hrm, a.id, H, "approve")).rejects.toMatchObject({ code: "no_role" })
    await decidePosition(db, mgmt, a.id, { uid: "mg", name: null }, "approve")
    expect(readDoc(`hrHiring/${a.id}`)).toMatchObject({ state: "open", okBy: { by: "mg" } })
    await expect(decidePosition(db, mgmt, a.id, { uid: "mg", name: null }, "approve")).rejects.toMatchObject({ blocks: ["stale"] })
    seed("hrHiring/jb", rec(opening({ id: "jb", track: "batch", batch: { stage: "visa", agency: "A", nat: "bd", sel: 2, eta: today, issued: 2, visas: 2, reserved: 0 } })))
    await expect(closeOpening(db, hrm, "jb", H)).rejects.toMatchObject({ blocks: ["visas_issued"] })
    await closeOpening(db, hrm, a.id, H)
    expect(readDoc(`hrHiring/${a.id}`)).toMatchObject({ state: "closed" })
  })
})

describe("the individuals track (WF-17)", () => {
  beforeEach(() => {
    seedWorld()
    seed("hrHiring/j1", rec(opening()))
  })

  it("candidate → interview → scorecard → offer → accepted → converted, the money on its own document", async () => {
    const id = await addCandidate(db, hrm, H, "j1", { nameAr: "سلطان", nameEn: "Sultan", nat: "sa", gender: "m", src: "ref", phone: null, ask: 8000 })
    const c0 = readDoc<Record<string, unknown>>(`hrHiring/${id}`)!
    expect(c0).toMatchObject({ kind: "candidate", pay: false, stage: "new", trade: "accountant" })
    expect(c0).not.toHaveProperty("ask")
    expect(readDoc(`hrHiring/${id}__pay`)).toMatchObject({ kind: "offer", pay: true, candidateId: id, ask: 8000, basic: null })

    await screenCandidate(db, hrm, id, H, "interview", { today })
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "int", intAt: addDays(today, 2) })
    await expect(makeOffer(db, hrm, id, H, { basic: 8000, start: addDays(today, 20), until: addDays(today, 7), ct: "open" })).rejects.toMatchObject({ blocks: ["stale"] })
    await recordScorecard(db, hrm, id, H, { t: 4, x: 4, b: 5, rec: true })
    const r = await makeOffer(db, hrm, id, H, { basic: 8000, start: addDays(today, 20), until: addDays(today, 7), ct: "y1" }, { today })
    expect(r.held).toBe(false)
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "offer", offer: { state: "sent", ct: "y1", over: false } })
    expect(readDoc(`hrHiring/${id}`)).not.toHaveProperty("basic")
    expect(readDoc(`hrHiring/${id}__pay`)).toMatchObject({ ask: 8000, basic: 8000 })
    await answerOffer(db, hrm, id, H, "acc")
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "acc", offer: { state: "acc" } })

    // Government relations converts — the record links to its opening and candidate in the same write.
    const e = await createEmployee(db, gov, "org", { uid: "gro", name: null }, { source: "local", nameAr: "سلطان", nameEn: "Sultan", nationality: "sa", gender: "m", trade: "accountant", siteId: "s1", join: today, contractType: "open", docs: {}, hiring: { openingId: "j1", candidateId: id } }, { visas: null })
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "hired", employeeId: e.id })
    expect(readDoc("hrHiring/j1")).toMatchObject({ filled: 1, state: "filled" })
    expect(readDoc(`employees/${e.id}`)).toMatchObject({ hiredFrom: { openingId: "j1", no: "JOB-2026/001", candidateId: id }, onb: {} })
    expect(listCollection<{ kind: string }>(`employees/${e.id}/log`).map((l) => l.kind)).toEqual(["created", "hired"])
    // The opening is filled: nobody else joins through it.
    await expect(createEmployee(db, hrm, "org", H, { source: "local", nameAr: "آخر", nationality: "sa", gender: "m", trade: "accountant", siteId: "s1", join: today, contractType: "open", docs: {}, hiring: { openingId: "j1" } }, { visas: null })).rejects.toMatchObject({ blocks: ["opening_closed"] })
  })

  it("not recommended = rejected; a candidate not accepted cannot be converted; Saudi-only blocks a non-Saudi", async () => {
    const id = await addCandidate(db, hrm, H, "j1", { nameAr: "أحمد", nameEn: null, nat: "eg", gender: "m", src: "walk", phone: null, ask: null })
    expect(readDoc(`hrHiring/${id}__pay`)).toBeNull()
    await screenCandidate(db, hrm, id, H, "interview")
    await recordScorecard(db, hrm, id, H, { t: 2, x: 2, b: 3, rec: false })
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "rej", why: "not_recommended", sc: { rec: false } })
    await expect(createEmployee(db, hrm, "org", H, { source: "transfer", nameAr: "أحمد", nationality: "eg", gender: "m", trade: "accountant", siteId: "s1", join: today, contractType: "open", docs: {}, hiring: { openingId: "j1", candidateId: id } }, { visas: null })).rejects.toMatchObject({ blocks: ["stale"] })
    seed("hrHiring/j9", rec(opening({ id: "j9", trade: "cashier" })))
    await expect(addCandidate(db, hrm, H, "j9", { nameAr: "راجو", nameEn: null, nat: "in", gender: "m", src: "walk", phone: null, ask: null })).rejects.toMatchObject({ blocks: ["saudi_only"] })
  })

  it("an offer above the band waits for management, who approves (sent) or returns it (back to the interview)", async () => {
    const id = await addCandidate(db, hrm, H, "j1", { nameAr: "ريم", nameEn: null, nat: "sa", gender: "f", src: "agency", phone: null, ask: null })
    await screenCandidate(db, hrm, id, H, "interview")
    await recordScorecard(db, hrm, id, H, { t: 5, x: 4, b: 4, rec: true })
    expect((await makeOffer(db, hrm, id, H, { basic: 9500, start: addDays(today, 20), until: addDays(today, 7), ct: "open" }, { today })).held).toBe(true)
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ offer: { state: "mg", over: true } })
    // The HR manager cannot answer for the candidate while management holds it, nor approve it himself.
    await expect(answerOffer(db, hrm, id, H, "acc")).rejects.toMatchObject({ blocks: ["stale"] })
    await expect(decideOffer(db, hrm, id, H, "approve")).rejects.toMatchObject({ code: "no_role" })
    await decideOffer(db, mgmt, id, { uid: "mg", name: null }, "return")
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "int", offer: null })
    await makeOffer(db, hrm, id, H, { basic: 9500, start: addDays(today, 20), until: addDays(today, 7), ct: "open" }, { today })
    await decideOffer(db, mgmt, id, { uid: "mg", name: null }, "approve")
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "offer", offer: { state: "sent", okBy: { by: "mg" } } })
    await answerOffer(db, hrm, id, H, "dec")
    expect(readDoc(`hrHiring/${id}`)).toMatchObject({ stage: "rej", why: "declined", offer: { state: "dec" } })
  })
})

describe("the recruitment batch and its visas (WF-18, HI-07) — no visa counted twice", () => {
  const batch = (over: Partial<Opening> = {}) => rec(opening({ id: "jb", trade: "steelFixer", q: 3, track: "batch", batch: { stage: "auth", agency: null, nat: null, sel: null, eta: null, issued: 0, visas: 0, reserved: 0 }, ...over }))

  it("authorised → test → visas issued (blocked when the free visas do not cover it) → arrivals spend the lot, not the balance", async () => {
    seedWorld(2)
    seed("hrHiring/jb", batch())
    await batchStep(db, gov, "jb", { uid: "gro", name: null }, { agency: "مكتب الخليج", nat: "bd", sel: 3 })
    expect(readDoc("hrHiring/jb")).toMatchObject({ batch: { stage: "test", agency: "مكتب الخليج", nat: "bd", sel: 3 } })
    await expect(batchStep(db, gov, "jb", { uid: "gro", name: null }, { eta: addDays(today, 40) })).rejects.toMatchObject({ blocks: ["not_enough_visas"] })
    seed("hrSettings/org", { organizationId: "org", features: ["hire"], establishment: { visas: 5, visasReserved: 1 } })
    const r = await batchStep(db, gov, "jb", { uid: "gro", name: null }, { eta: addDays(today, 40) })
    expect(r).toEqual({ stage: "visa", issued: 3 })
    // Taken out of the balance ONCE, at issue; the reservation of an earlier plan is untouched.
    expect(readDoc("hrSettings/org")).toMatchObject({ establishment: { visas: 2, visasReserved: 1 } })
    expect(readDoc("hrHiring/jb")).toMatchObject({ batch: { stage: "visa", issued: 3, visas: 3, eta: addDays(today, 40) } })

    const o = { ...(readDoc<Opening>("hrHiring/jb") as Opening), id: "jb" }
    const out = await registerArrivals(db, gov, "org", { uid: "gro", name: null }, o, "MOHAMMAD RAHIM\nABDUL KARIM\n", { today })
    expect(out).toEqual({ created: 2, failed: [] })
    // The balance did not move again: each arrival spent one visa of the lot.
    expect(readDoc("hrSettings/org")).toMatchObject({ establishment: { visas: 2, visasReserved: 1 } })
    expect(readDoc("hrHiring/jb")).toMatchObject({ filled: 2, state: "open", batch: { stage: "arr", visas: 1 } })
    const people = listCollection<HrEmployee & { hiredFrom?: unknown }>("employees")
    expect(people).toHaveLength(2)
    expect(people[0]).toMatchObject({ source: "visa", nationality: "bd", trade: "steelFixer", siteId: "s1", status: "active", hiredFrom: { openingId: "jb" } })
    // Government relations records them without pay.
    expect(listCollection("employeePay")).toHaveLength(0)
    const o2 = { ...(readDoc<Opening>("hrHiring/jb") as Opening), id: "jb" }
    await expect(registerArrivals(db, gov, "org", { uid: "gro", name: null }, o2, "A\nB", { today })).rejects.toMatchObject({ blocks: ["too_many"] })
    await registerArrivals(db, hrm, "org", H, o2, "LAST ONE", { today, seesPay: true })
    expect(readDoc("hrHiring/jb")).toMatchObject({ filled: 3, state: "filled", batch: { visas: 0 } })
    expect(listCollection("employeePay")).toHaveLength(1)
  })

  it("coverage offers the lot at its arrival date; a plan reserves it on the lot; the arrival takes the reservation back", async () => {
    seedWorld(0)
    const eta = addDays(today, 20)
    seed("hrHiring/jb", batch({ trade: "mason", batch: { stage: "visa", agency: "A", nat: "bd", sel: 3, eta, issued: 3, visas: 3, reserved: 0 } }))
    const lots = visaLots([{ ...(readDoc<Opening>("hrHiring/jb") as Opening), id: "jb" }])
    expect(lots).toEqual([{ openingId: "jb", no: "JOB-2026/001", trade: "mason", nat: "bd", eta, free: 3 }])
    const from = addDays(today, 10)
    const c = coverage({ trade: "mason", count: 4, from, today, siteId: "s1", employees: [], sites: [], visas: 0, lots })
    expect(c.rows.map((r) => [r.source, r.date, r.late, r.lotId])).toEqual([
      ["visa", eta, true, "jb"],
      ["visa", eta, true, "jb"],
      ["visa", eta, true, "jb"],
    ])
    expect(c.short).toBe(1)
    seed("manpowerRequests/m1", { organizationId: "org", no: "MP-2026/004", projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 4, from, state: "open", requested: { by: "pm", byName: null, at: "" }, answer: null })
    await answerManpowerRequest(db, hrm, "m1", H, { rows: c.rows.slice(0, 2), excluded: [], rest: "hire" }, { hire: true, today })
    expect(readDoc("hrHiring/jb")).toMatchObject({ batch: { visas: 3, reserved: 2 } })
    expect(readDoc("hrSettings/org")).toMatchObject({ establishment: { visas: 0 } })
    // HI-01 — the "hire" remainder opened an opening, born of the request, open at once.
    const m = readDoc<ManpowerRequest>("manpowerRequests/m1")!
    expect(m.answer).toMatchObject({ rest: "hire", openingId: expect.any(String), openingNo: expect.stringMatching(/^JOB-/) })
    expect(readDoc(`hrHiring/${m.answer!.openingId}`)).toMatchObject({ kind: "opening", src: "mr", ref: "m1", refLabel: "MP-2026/004", q: 2, need: from, state: "open", track: "batch", siteId: "s1" })
    // Reserved visas are not offered again.
    expect(visaLots([{ ...(readDoc<Opening>("hrHiring/jb") as Opening), id: "jb" }])[0].free).toBe(1)
    // The arrival spends the lot AND takes a reservation back.
    const o = { ...(readDoc<Opening>("hrHiring/jb") as Opening), id: "jb" }
    await registerArrivals(db, hrm, "org", H, o, "ONE", { today })
    expect(readDoc("hrHiring/jb")).toMatchObject({ batch: { visas: 2, reserved: 1 } })
  })

  it("with Hiring off, a 'hire' remainder opens nothing", async () => {
    seedWorld(0)
    seed("manpowerRequests/m2", { organizationId: "org", projectId: "p1", projectName: "Tower", siteId: "s1", trade: "mason", count: 1, from: today, state: "open", requested: { by: "pm", byName: null, at: "" }, answer: null })
    await answerManpowerRequest(db, hrm, "m2", H, { rows: [], excluded: [], rest: "hire" })
    expect(readDoc<ManpowerRequest>("manpowerRequests/m2")!.answer).not.toHaveProperty("openingId")
    expect(listCollection("hrHiring")).toHaveLength(0)
  })

  it("a single visa arrival outside a batch still spends one of the balance", async () => {
    seedWorld(2)
    await createEmployee(db, gov, "org", { uid: "gro", name: null }, { source: "visa", nameAr: "وافد", nationality: "bd", gender: "m", trade: "mason", siteId: null, join: today, contractType: "open", docs: {} }, { visas: 2 })
    expect(readDoc("hrSettings/org")).toMatchObject({ establishment: { visas: 1 } })
  })
})

describe("onboarding ticks (HI-06)", () => {
  it("government relations ticks Qiwa and GOSI once, in the log; a supervisor may not", async () => {
    seedWorld()
    seed("employees/n1", rec(emp("n1", { join: today })))
    await tickOnboarding(db, gov, "n1", { uid: "gro", name: "ع" }, "qiwa")
    expect(readDoc("employees/n1")).toMatchObject({ onb: { qiwa: { by: "gro" } } })
    expect(listCollection<{ kind: string }>("employees/n1/log").map((l) => l.kind)).toEqual(["onb_qiwa"])
    await expect(tickOnboarding(db, gov, "n1", { uid: "gro", name: null }, "qiwa")).rejects.toMatchObject({ blocks: ["stale"] })
    const sup: HrContext = { uid: "s", owner: false, roles: new Set(["supervisor"]), employeeId: null, sites: ["s1"] }
    await expect(tickOnboarding(db, sup, "n1", { uid: "s", name: null }, "gosi")).rejects.toMatchObject({ code: "no_role" })
  })
})

// ---------------------------------------------------------------------------
// Today (TD-01…03) — each role its rows, none with the switch off
// ---------------------------------------------------------------------------

describe("Today's hiring rows", () => {
  const sites = [{ id: "s1", organizationId: "org", name: "Tower", type: "project" as const, active: true }]
  const openings: Opening[] = [
    opening({ id: "late", need: addDays(today, -5) }),
    opening({ id: "wait", state: "wait", why: "owner asks", q: 2 }),
    opening({ id: "b", track: "batch", trade: "steelFixer", batch: { stage: "visa", agency: "Gulf", nat: "bd", sel: 2, eta: addDays(today, 30), issued: 2, visas: 2, reserved: 0 } }),
  ]
  const candidates: Candidate[] = [
    cand({ id: "n", openingId: "late" }),
    cand({ id: "acc", openingId: "late", stage: "acc", offer: { by: "hrm", byName: null, at: "", start: addDays(today, 3), until: today, ct: "open", state: "acc", over: false } }),
    cand({ id: "mg", openingId: "late", stage: "offer", offer: { by: "hrm", byName: null, at: "", start: addDays(today, 3), until: today, ct: "open", state: "mg", over: true } }),
  ]
  const hiring: HiringWorld = { openings, candidates, pays: new Map([["mg", { id: "mg__pay", organizationId: "org", kind: "offer", pay: true, candidateId: "mg", openingId: "late", ask: null, basic: 9500 }]]), policies: P }
  const base = (ctx: HrContext, h: HiringWorld | null): TodayInput => ({
    ctx,
    today,
    renewWindowDays: 60,
    employees: [emp("j", { join: addDays(today, -3), siteId: "s1" })],
    sites,
    lastMonth: [],
    thisMonth: [],
    injuries: [],
    exits: [],
    requests: [],
    payrolls: [],
    pays: new Map(),
    govHeld: true,
    hiring: h,
  })
  const kinds = (ctx: HrContext, h: HiringWorld | null = hiring) => todayItems(base(ctx, h)).filter((x) => /job_|cand_|batch_|onb_|offer_/.test(x.kind))

  it("the HR manager: a late opening and the candidates waiting on him", () => {
    const rows = kinds(hrm)
    expect(rows.map((x) => x.kind).sort()).toEqual(["cand_wait", "job_late"])
    expect(rows.find((x) => x.kind === "cand_wait")).toMatchObject({ params: { n: 2 }, facts: [{ k: "cand_split", p: { a: 1, b: 0, c: 1 } }], href: "hiring?seg=cand" })
    expect(rows.find((x) => x.kind === "job_late")).toMatchObject({ href: "hiring?job=late", params: { trade: "accountant", site: "Tower", n: 8 }, facts: [{ k: "needed", p: { date: addDays(today, -5) } }, { k: "expected", p: { date: addDays(today, 3) } }, { k: "eta_accepted" }] })
  })

  it("government relations: convert the accepted, the batch's next step, joiners without Qiwa / GOSI — never an amount", () => {
    const rows = kinds(gov)
    expect(rows.map((x) => x.kind).sort()).toEqual(["batch_visa", "cand_accepted", "onb_missing"])
    expect(rows.find((x) => x.kind === "cand_accepted")).toMatchObject({ href: "hiring?job=late&convert=acc", action: "convert" })
    expect(JSON.stringify(rows)).not.toMatch(/9500|cost|basic/)
    // The HR manager carries them when nobody holds government relations.
    expect(todayItems({ ...base(hrm, hiring), govHeld: false }).some((x) => x.kind === "cand_accepted")).toBe(true)
  })

  it("management: the new position with its monthly cost, and the offer above the band against its ceiling", () => {
    const rows = kinds(mgmt)
    expect(rows.map((x) => x.kind).sort()).toEqual(["job_approve", "offer_above"])
    expect(rows.find((x) => x.kind === "job_approve")?.facts).toEqual([
      { k: "quote", p: { text: "owner asks" } },
      { k: "cost_month", p: { cost: positionCost("accountant", 2, P) } },
    ])
    expect(rows.find((x) => x.kind === "offer_above")?.facts).toContainEqual({ k: "offer_vs_ceiling", p: { basic: 9500, ceiling: 9000 } })
  })

  it("no row with the switch off; nothing another module holds carries an action; the tab counts open and waiting openings", () => {
    for (const ctx of [hrm, gov, mgmt]) expect(kinds(ctx, null)).toEqual([])
    for (const ctx of [hrm, gov, mgmt]) expect(leakage(todayItems(base(ctx, hiring)))).toBe(0)
    const items = todayItems(base(hrm, hiring))
    expect(hrTabCounts({ ctx: hrm, items, decisions: items.length, urgent: false, employees: [], manpower: [], payrolls: [], requests: [], openings }).hiring).toEqual({ count: 3, urgent: true })
  })

  it("an issued lot still to arrive enters the manpower row's coverage on Today", () => {
    const m = { id: "m", organizationId: "org", projectId: "p", projectName: "P", siteId: "s1", trade: "steelFixer", count: 2, from: addDays(today, 40), state: "open", requested: { by: "x", byName: null, at: "" } } as ManpowerRequest
    const row = (h: HiringWorld | null) => todayItems({ ...base(hrm, h), manpower: [m], visas: 0 }).find((x) => x.kind === "manpower")
    expect(row(hiring)?.facts?.[0]).toEqual({ k: "coverage", p: { onTime: 2, late: 0, short: 0 } })
    expect(row(null)?.facts?.[0]).toEqual({ k: "coverage", p: { onTime: 0, late: 0, short: 2 } })
  })
})

describe("the batch's step blocks", () => {
  it("each stage asks for its own facts", () => {
    const o = opening({ q: 3, track: "batch", batch: { stage: "auth", agency: null, nat: null, sel: null, eta: null, issued: 0, visas: 0, reserved: 0 } })
    expect(batchBlocks(o, { agency: " ", sel: -1 }, 0)).toEqual(["no_agency", "bad_sel"])
    expect(batchBlocks({ ...o, batch: { ...o.batch!, stage: "test" } }, { eta: null }, 2)).toEqual(["not_enough_visas", "no_eta"])
    expect(batchBlocks({ ...o, batch: { ...o.batch!, stage: "visa", visas: 3 } }, { names: [] }, 0)).toEqual(["no_names"])
  })
})

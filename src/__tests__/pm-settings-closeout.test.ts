/**
 * PM 1.0 — closeout rows for the store, subcontractors (SC-04) and letters;
 * lessons; the sections census, blockers and log (SEC-02…04); the boundary's
 * event counts; the sub-tab badges.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { eventStats, boundaryLog } from "@/lib/pm/boundary"
import { closeBlocks, closeoutRows, projectLessons, subDues, type CloseInput } from "@/lib/pm/closeout"
import { closeAndArchive } from "@/lib/pm/closeout-writes"
import { blockerDetails, PmSectionsError, sectionCensus, sectionLogRows, switchBlocks, switchOffBlockers, switchSections } from "@/lib/pm/sections-governance"
import type { PmSubcontract } from "@/lib/pm/subcontract"
import { tabBadges } from "@/lib/pm/tab-badges"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }

const base: CloseInput = {
  hasClient: false,
  acceptances: { prov: { on: "2026-06-01", by: "pm1" }, final: { on: "2026-09-01", by: "pm1" } },
  punch: [],
  items: [],
  cutPool: 0,
  certificates: [],
  retentionHeld: 0,
  retentionReleased: false,
  today: "2026-09-27",
}

const contract = (over: Partial<PmSubcontract> = {}): PmSubcontract => ({
  id: "01",
  seq: 1,
  party: { name: "Al-Itqan" },
  partyKey: "n:al-itqan",
  retention: 0.1,
  startOn: "2026-05-01",
  endOn: null,
  note: null,
  lines: [{ itemId: "i1", code: "01", description: null, unit: "m2", qty: 10, rate: 100, value: 1000, certified: 0.5 }],
  value: 1000,
  paid: 0,
  by: "pm1",
  on: "2026-05-01",
  ...over,
})

beforeEach(() => resetFakeDb())

describe("closeout rows (C-37)", () => {
  it("store, subcontractors and letters join only when given, in the prototype's order", () => {
    expect(closeoutRows(base).map((r) => r.key)).toEqual(["punch", "ncr", "prov", "final", "unpriced"])
    const rows = closeoutRows({ ...base, storeLines: 0, subs: { due: 0, pending: 0 }, letters: [] })
    expect(rows.map((r) => r.key)).toEqual(["punch", "ncr", "store", "prov", "final", "unpriced", "subs", "corr"])
    expect(closeBlocks(rows)).toEqual([])
  })

  it("stock, sub dues, a sub certificate awaiting approval and an open letter each block", () => {
    expect(closeBlocks(closeoutRows({ ...base, storeLines: 2 })).map((r) => r.key)).toEqual(["store"])
    expect(closeBlocks(closeoutRows({ ...base, subs: { due: 450, pending: 0 } })).map((r) => r.key)).toEqual(["subs"])
    expect(closeBlocks(closeoutRows({ ...base, subs: { due: 0.4, pending: 1 } }))[0]).toMatchObject({ key: "subs", m: 1 })
    expect(closeBlocks(closeoutRows({ ...base, letters: [{ status: "rep" }, { status: "in" }] }))).toEqual([{ key: "corr", ok: false, n: 1 }])
  })

  it("SC-04: dues are certified minus paid, per party above half a riyal", () => {
    expect(subDues([contract()], [])).toEqual({ due: 500, pending: 0 })
    expect(subDues([contract({ paid: 499.7 })], [{ status: "int" }, { status: "ok" }])).toEqual({ due: 0, pending: 1 })
  })

  it("an open letter refuses close and archive through the gate", async () => {
    const terms = { ...defaultTerms(), payer: "none" as const }
    seed("projects/p1", { organizationId: "org", budget: 0, projectManagerId: "pm1", status: "remaining_payment", enabledSections: ["contract", "procure"], pm: { no: "PJ-2026/005", lifecycle: "done", terms, original: terms, acceptances: base.acceptances } })
    seed("projects/p1/pmLetters/01", { seq: 1, status: "out", dir: "out", day: "2026-09-01", due: 7 })
    await expect(closeAndArchive(db, pm, "p1", { uid: "pm1", name: null })).rejects.toMatchObject({ code: "blocked", blocks: ["corr"] })
  })
})

describe("lessons (C-38)", () => {
  it("rework cost from NCRs, obstacles closed and their average, the team", () => {
    expect(
      projectLessons({
        ncrs: [{ cost: 1200 }, { cost: 300.5 }],
        obstacles: [{ openOn: "2026-05-01", closeOn: "2026-05-11" }, { openOn: "2026-06-01", closeOn: "2026-06-05" }, { openOn: "2026-07-01" }],
        seats: 4,
      })
    ).toEqual({ rework: 1500.5, ncrs: 2, obstaclesClosed: 2, avgResponseDays: 7, team: 4 })
    expect(projectLessons({ ncrs: [], obstacles: [], seats: 0 }).avgResponseDays).toBeNull()
  })
})

describe("sections (C-41…C-44)", () => {
  const facts = { storeLines: 2, storeValue: 800, uncollected: 1, uncollectedAmount: 5000, certificates: 3, subcontracts: 1, subDue: 700, subPending: 0, voWaiting: 2, variations: 3 }

  it("the census: what the section holds, money and custody red, paperwork amber", () => {
    expect(sectionCensus("store", facts)).toEqual([
      { key: "stock_lines", value: 2, money: false, level: "r" },
      { key: "stock_value", value: 800, money: true, level: "r" },
    ])
    expect(sectionCensus("vo", facts).map((r) => [r.key, r.level])).toEqual([["variations", ""], ["vo_waiting", "w"]])
    expect(sectionCensus("docs", facts)).toEqual([])
  })

  it("SC-04: subcontractor dues block switching the section off, with the amount", () => {
    expect(switchOffBlockers(["subs"], facts)).toEqual(["sub_dues"])
    expect(switchOffBlockers(["subs"], { storeLines: 0, uncollected: 0, subDue: 0, subPending: 1 })).toEqual(["sub_dues"])
    expect(switchOffBlockers(["subs"], { storeLines: 0, uncollected: 0, subDue: 0.3 })).toEqual([])
    expect(blockerDetails(["store", "ipc", "subs"], facts).map((b) => [b.key, b.amount])).toEqual([["store_stock", 800], ["uncollected", 5000], ["sub_dues", 700]])
  })

  it("the reasons are the prototype's; a legacy reason is refused for new writes", () => {
    expect(switchBlocks({ archived: false, turnedOn: [], turnedOff: ["docs"], reason: "later", facts: { storeLines: 0, uncollected: 0 } })).toEqual([])
    expect(switchBlocks({ archived: false, turnedOn: [], turnedOff: ["docs"], reason: "client_scope" as never, facts: { storeLines: 0, uncollected: 0 } })).toEqual(["no_reason"])
  })

  it("the log: one row per section, newest first, capped", () => {
    const rows = sectionLogRows([
      { on: ["docs"], off: [], by: "a", at: "2026-09-01T10:00:00Z" },
      { on: [], off: ["store", "receive"], reason: "other", reasonText: "client supplies", by: "b", byName: "Badr", at: "2026-09-20T10:00:00Z" },
    ])
    expect(rows.map((r) => [r.id, r.on, r.reasonText])).toEqual([["store", false, "client supplies"], ["receive", false, "client supplies"], ["docs", true, null]])
    expect(sectionLogRows([{ on: ["a", "b", "c"], off: [], by: "x", at: "1" }], 2)).toHaveLength(2)
  })

  it("the write reads the blockers itself when not given them", async () => {
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", enabledSections: ["contract", "procure", "subs"], pm: { no: "PJ-2026/003", lifecycle: "live" } })
    seed("projects/p1/pmSubcontracts/01", { ...contract() })
    await expect(switchSections(db, pm, "p1", { uid: "pm1", name: null }, { next: ["contract", "procure"], reason: "scope" })).rejects.toBeInstanceOf(PmSectionsError)
    await expect(switchSections(db, pm, "p1", { uid: "pm1", name: null }, { next: ["contract", "procure"], reason: "scope" })).rejects.toMatchObject({ blocks: ["sub_dues"] })
  })
})

describe("boundary (C-45) and badges (C-46)", () => {
  it("counts this project's events per kind with the last date", () => {
    const stats = eventStats([
      { kind: "IPC", at: "2026-08-01T00:00:00Z" },
      { kind: "IPC", at: "2026-09-01T00:00:00Z" },
      { kind: "ADV", at: "2026-05-01T00:00:00Z" },
    ])
    expect(stats.find((s) => s.kind === "IPC")).toMatchObject({ sent: 2, last: "2026-09-01T00:00:00Z" })
    expect(stats.find((s) => s.kind === "BUD")).toMatchObject({ sent: 0, last: null })
    expect(boundaryLog([{ at: "1" }, { at: "3" }, { at: "2" }]).map((e) => e.at)).toEqual(["3", "2", "1"])
  })

  it("badges: red where the prototype is red, absent at zero", () => {
    const b = tabBadges({
      today: "2026-09-27",
      hasManager: false,
      liveSeats: 3,
      inspections: [{ status: "open" }, { status: "fail" }],
      letters: [{ status: "out", day: "2026-09-01", due: 7 }],
      subCertificates: [{ status: "ok" }],
      claimNoticeLate: true,
    })
    expect(b).toEqual({ team: { n: "!", tone: "bad" }, pmClaims: { n: "!", tone: "bad" }, pmWir: { n: 1, tone: "bad" }, pmCorr: { n: 1, tone: "bad" } })
    expect(tabBadges({ today: "2026-09-27", hasManager: true, liveSeats: 2 }).team).toEqual({ n: 2, tone: "warn" })
  })
})

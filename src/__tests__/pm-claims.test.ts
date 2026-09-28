/**
 * PM 1.0 — claims and extensions of time (CLM-01…03, PRG-02, §8): the notice
 * deadline from the event, a mandatory response with days unless rejected,
 * granted days issuing a programme revision, and delay damages on the
 * effective duration — never in planning.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { claimBlocks, claimStepBlocks, delayAndDamages, noticeAfter, noticeDaysLeft, penaltyAvoided, grantedDays, noticeDeadline, noticeLate, programmeRevision, respondBlocks, type PmClaim } from "@/lib/pm/claim"
import { draftClaim, PmClaimError, respondToClaim, sendClaimNotice, submitClaim } from "@/lib/pm/claim-writes"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const qsA = { uid: "qs1", name: "Mona" }
const pmA = { uid: "pm1", name: "Abdullah" }
const claim = (n: string) => readDoc<PmClaim>(`projects/p1/pmClaims/${n}`) as PmClaim
const terms = defaultTerms()

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", pm: { no: "PJ-2026/003", lifecycle: "live" } })
})

describe("the rules", () => {
  it("the notice deadline runs from the event; a draft past it is late (CLM-01)", () => {
    expect(noticeDeadline("2026-08-01", terms)).toBe("2026-08-29")
    expect(noticeLate({ status: "draft", eventOn: "2026-08-01" }, terms, "2026-08-29")).toBe(false)
    expect(noticeLate({ status: "draft", eventOn: "2026-08-01" }, terms, "2026-08-30")).toBe(true)
    expect(noticeLate({ status: "notice", eventOn: "2026-08-01" }, terms, "2026-12-01")).toBe(false)
  })

  it("a claim needs what happened and a past event; none before start — days wait for submission (C-24)", () => {
    expect(claimBlocks({ archived: false, lifecycle: "plan", kind: "both", cause: " ", eventOn: "2099-01-01", daysAsked: 0, amountAsked: 0, today: "2026-09-27" })).toEqual(["not_started", "no_cause", "event_date"])
    expect(claimBlocks({ archived: false, lifecycle: "live", kind: "time", cause: "x", eventOn: "2026-09-01", daysAsked: 0, amountAsked: 0, today: "2026-09-27", causedBy: "oth", causedByText: " " })).toEqual(["cause_text"])
    expect(claimStepBlocks({ archived: false, status: "notice", step: "submit", kind: "both", daysAsked: 0, amountAsked: 0 })).toEqual(["no_days", "no_amount"])
    expect(claimStepBlocks({ archived: false, status: "notice", step: "submit", kind: "time", daysAsked: 12, amountAsked: 0 })).toEqual([])
  })

  it("notice helpers and the penalty an extension avoids (C-23, C-25)", () => {
    expect(noticeDaysLeft({ status: "draft", eventOn: "2026-09-20" }, terms, "2026-09-27")).toBe(21)
    expect(noticeDaysLeft({ status: "notice", eventOn: "2026-09-20" }, terms, "2026-09-27")).toBeNull()
    expect(noticeAfter({ eventOn: "2026-09-01", noticeOn: "2026-09-08" })).toBe(7)
    const input = { lifecycle: "live", startOn: "2026-01-01", effectiveDays: 200, progress: 20, contractValue: 1_000_000, damages: { on: true, weeklyRate: 0.005, cap: 0.1 }, today: "2026-05-11" }
    expect(penaltyAvoided({ kind: "time", daysAsked: 200 }, input)).toBeGreaterThan(0)
    expect(penaltyAvoided({ kind: "cost", daysAsked: 200 }, input)).toBe(0)
    expect(delayAndDamages({ ...input, curveK: 2 })!.planned).toBeGreaterThan(delayAndDamages(input)!.planned)
  })

  it("a response is mandatory; days are mandatory unless rejected (CLM-02)", () => {
    const sub = { archived: false, status: "sub" as const, kind: "time" as const }
    expect(respondBlocks({ ...sub, response: undefined, days: null, amount: null })).toEqual(["no_choice"])
    expect(respondBlocks({ ...sub, response: "part", days: null, amount: null })).toEqual(["days_required"])
    expect(respondBlocks({ ...sub, response: "rej", days: null, amount: null })).toEqual([])
  })

  it("damages run on the effective duration, capped, never in planning (PRG-02)", () => {
    const damages = { on: true, weeklyRate: 0.005, cap: 0.1 }
    const r = delayAndDamages({ lifecycle: "live", startOn: "2026-01-01", effectiveDays: 200, progress: 20, contractValue: 1_000_000, damages, today: "2026-05-11" })
    expect(r).toEqual({ planned: 65, delayDays: 90, damages: 60_000 })
    expect(delayAndDamages({ lifecycle: "live", startOn: "2026-01-01", effectiveDays: 400, progress: 20, contractValue: 1_000_000, damages, today: "2026-05-11" })?.delayDays).toBe(50)
    expect(delayAndDamages({ lifecycle: "plan", startOn: "2026-01-01", effectiveDays: 200, progress: 0, contractValue: 1e6, damages, today: "2026-12-01" })).toBeNull()
    expect(delayAndDamages({ lifecycle: "live", startOn: "2026-01-01", effectiveDays: 200, progress: null, contractValue: 1e6, damages, today: "2026-12-01" })).toBeNull()
  })
})

describe("the writes", () => {
  it("drafted → notice → submitted → answered; granted days issue revision R1 (CLM-03)", async () => {
    const seq = await draftClaim(db, qs, "p1", qsA, { kind: "time", cause: "Late drawings", eventOn: "2026-09-01", daysAsked: 30, amountAsked: 0 })
    expect(claim("01")).toMatchObject({ status: "draft", daysAsked: 30, amountAsked: 0 })
    await sendClaimNotice(db, qs, "p1", seq)
    await expect(submitClaim(db, qs, "p1", seq)).rejects.toBeInstanceOf(PmAccessError)
    const late = await draftClaim(db, qs, "p1", qsA, { kind: "time", cause: "Rain", eventOn: "2026-09-02", daysAsked: 0, amountAsked: 0, noticeToday: true, causedBy: "force" })
    expect(claim("02")).toMatchObject({ status: "notice", causedBy: "force", daysAsked: 0 })
    await expect(submitClaim(db, pm, "p1", late)).rejects.toBeInstanceOf(PmClaimError)
    await submitClaim(db, pm, "p1", late, { daysAsked: 6 })
    expect(claim("02")).toMatchObject({ status: "sub", daysAsked: 6 })
    await submitClaim(db, pm, "p1", seq)
    await expect(respondToClaim(db, pm, "p1", pmA, seq, { response: null, days: null, amount: null })).rejects.toBeInstanceOf(PmClaimError)
    const r = await respondToClaim(db, pm, "p1", pmA, seq, { response: "part", days: 20, amount: null })
    expect(r.revision).toBe(1)
    const c = claim("01")
    expect(c).toMatchObject({ status: "part", revision: 1, response: { days: 20, by: "pm1" } })
    expect(grantedDays([c])).toBe(20)
    expect(programmeRevision([c])).toBe(1)
  })

  it("a rejection grants nothing and issues no revision", async () => {
    const seq = await draftClaim(db, pm, "p1", pmA, { kind: "both", cause: "Access denied", eventOn: "2026-09-10", daysAsked: 10, amountAsked: 50_000 })
    await sendClaimNotice(db, pm, "p1", seq)
    await submitClaim(db, pm, "p1", seq)
    const r = await respondToClaim(db, pm, "p1", pmA, seq, { response: "rej", days: null, amount: null })
    expect(r.revision).toBeNull()
    expect(claim("01").response).toMatchObject({ days: 0, amount: 0 })
    expect(grantedDays([claim("01")])).toBe(0)
  })

  it("the site engineer drafts none", async () => {
    await expect(draftClaim(db, site, "p1", { uid: "se1", name: null }, { kind: "time", cause: "x", eventOn: "2026-09-01", daysAsked: 1, amountAsked: 0 })).rejects.toBeInstanceOf(PmAccessError)
  })
})

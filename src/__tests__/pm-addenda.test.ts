/**
 * PM 1.0 — contract addenda (AMD-01…10, WF-08, INV-22, INV-23; AC-07/AC-08 and
 * the qa_amend pack). A draft changes nothing; the signature puts it in force in
 * signing order and keeps the original; a financial addendum sends prj:AMD once;
 * a draft overtaken by another signature cannot be signed; the cap can never
 * fall below the retention held — checked at draft AND at signing; withdrawing
 * deletes nothing; nothing before start or after archive.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import {
  addendumNo,
  amendedBy,
  amendmentEvent,
  capBelowHeld,
  contractRecord,
  draftAge,
  draftBlocks,
  earliestSignDay,
  inForce,
  signBlocks,
  staleChanges,
  withdrawBlocks,
  type PmAddendum,
} from "@/lib/pm/addenda"
import { draftAddendum, PmAddendumError, signAddendum, withdrawAddendum } from "@/lib/pm/addendum-writes"
import { PM_EVENTS } from "@/lib/pm/events"
import { todayDay } from "@/lib/pm/format"
import { defaultTerms, type ContractTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const original: ContractTerms = { ...defaultTerms({ advance: 0.1, retention: 0.1 }), retentionCap: 0.05 }
const today = todayDay()
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

const ctx = (perm: string, role: "pm" | "qs" | "site", uid: string): PmContext => ({ ceiling: pmCeiling({ owner: false, permissions: [perm] }), seat: { uid, role }, archived: false })
const pm = ctx("pm.manage", "pm", "pm1")
const qs = ctx("pm.cost", "qs", "qs1")
const site = ctx("pm.site", "site", "se1")
const pmA = { uid: "pm1", name: "Abdullah" }
const qsA = { uid: "qs1", name: "Huda" }

function seedProject(pmOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  seed("projects/p1", {
    organizationId: "org",
    budget: 10_000_000,
    projectManagerId: "pm1",
    status: "working",
    pm: { no: "PJ-2026/007", lifecycle: "live", terms: original, original, startedAt: "2026-09-01T00:00:00Z", ...pmOver },
    ...over,
  })
}
const addendum = (seq: number) => readDoc<PmAddendum>(`projects/p1/pmAddenda/${addendumNo(seq)}`) as PmAddendum
const allAddenda = () => listCollection<PmAddendum>("projects/p1/pmAddenda")

beforeEach(() => resetFakeDb())

describe("the pure rules", () => {
  it("a draft changes nothing; in force = original + signed in signing order (INV-22)", () => {
    const a1 = { status: "signed" as const, signedSeq: 2, changes: [{ key: "paymentDays" as const, from: 45, to: 60 }] }
    const a2 = { status: "signed" as const, signedSeq: 1, changes: [{ key: "paymentDays" as const, from: 30, to: 45 }] }
    const d = { status: "draft" as const, signedSeq: null, changes: [{ key: "paymentDays" as const, from: 60, to: 90 }] }
    expect(inForce(original, [a1, a2, d]).paymentDays).toBe(60)
    expect(original.paymentDays).toBe(30)
  })

  it("a changed term makes the draft stale, showing both values (AMD-05)", () => {
    expect(staleChanges([{ key: "retention", from: 0.1, to: 0.05 }], { ...original, retention: 0.08 })).toEqual([{ key: "retention", drafted: 0.1, now: 0.08 }])
    expect(staleChanges([{ key: "retention", from: 0.1, to: 0.05 }], original)).toEqual([])
  })

  it("10% up to a 5% cap is allowed; a cap below the retention held is refused (RET-01, AMD-09)", () => {
    expect(draftBlocks({ lifecycle: "live", archived: false, terms: original, next: { ...original, retention: 0.1, retentionCap: 0.05, paymentDays: 45 }, reason: "client", contractValue: 1e7, retentionHeld: 0 })).toEqual([])
    expect(capBelowHeld([{ key: "retentionCap", from: 0.05, to: 0.02 }], 10_000_000, 250_000)).toEqual({ cap: 200_000, held: 250_000 })
    expect(capBelowHeld([{ key: "retentionCap", from: 0.05, to: 0.03 }], 10_000_000, 250_000)).toBeNull()
  })

  it("drafts need a start, a change, a reason (other stated) and valid terms", () => {
    const base = { archived: false, terms: original, contractValue: 1e7, retentionHeld: 0 }
    expect(draftBlocks({ ...base, lifecycle: "plan", next: { ...original, paymentDays: 45 }, reason: "client" })).toEqual(["not_started"])
    expect(draftBlocks({ ...base, lifecycle: "live", next: original, reason: "client" })).toEqual(["no_change"])
    expect(draftBlocks({ ...base, lifecycle: "live", next: { ...original, paymentDays: 45 }, reason: "other", reasonText: " " })).toEqual(["reason_text"])
    expect(draftBlocks({ ...base, lifecycle: "live", next: { ...original, advance: 3 }, reason: "ours" })).toEqual(["invalid_terms"])
    expect(draftBlocks({ ...base, lifecycle: "closed", archived: true, next: { ...original, paymentDays: 45 }, reason: "ours" })).toEqual(["archived"])
  })

  it("the signing date is not before the draft or the last signature, never in the future (AMD-04)", () => {
    const a = { status: "draft" as const, day: "2026-09-10", changes: [{ key: "paymentDays" as const, from: 30, to: 45 }] }
    const base = { lifecycle: "live", archived: false, addendum: a, terms: original, today: "2026-09-27", contractValue: 1e7, retentionHeld: 0 }
    expect(signBlocks({ ...base, signedOn: "2026-09-09", lastSignedOn: null })).toEqual(["before_draft"])
    expect(signBlocks({ ...base, signedOn: "2026-09-11", lastSignedOn: "2026-09-12" })).toEqual(["before_last"])
    expect(signBlocks({ ...base, signedOn: "2026-09-28", lastSignedOn: null })).toEqual(["future"])
    expect(signBlocks({ ...base, signedOn: "2026-09-12", lastSignedOn: "2026-09-12" })).toEqual([])
    expect(earliestSignDay("2026-09-10", "2026-09-12")).toBe("2026-09-12")
  })

  it("withdrawing needs a reason; other is stated (AMD-06, RSN-01)", () => {
    expect(withdrawBlocks({ addendum: { status: "draft" }, reason: null })).toEqual(["no_reason"])
    expect(withdrawBlocks({ addendum: { status: "draft" }, reason: "other", reasonText: "" })).toEqual(["reason_text"])
    expect(withdrawBlocks({ addendum: { status: "signed" }, reason: "refused" })).toEqual(["not_draft"])
  })

  it("prj:AMD only for a financial term, carrying only the financial changes (AMD-08)", () => {
    const base = { organizationId: "o", projectId: "p", projectNo: "PJ-2026/007", signedOn: "2026-09-27", by: "u", at: "x" }
    expect(amendmentEvent({ ...base, addendum: { seq: 1, changes: [{ key: "claimNoticeDays", from: 28, to: 42 }] } })).toBeNull()
    const e = amendmentEvent({ ...base, addendum: { seq: 3, changes: [{ key: "claimNoticeDays", from: 28, to: 42 }, { key: "paymentDays", from: 30, to: 45 }] } })
    expect(e?.key).toBe("prj:AMD:PJ-2026/007:3")
    expect(e?.changes).toEqual([{ key: "paymentDays", from: 30, to: 45 }])
  })

  it("the record lists signed and withdrawn, newest first; drafts wait apart with their age", () => {
    const mk = (seq: number, status: PmAddendum["status"], d: string): PmAddendum => ({ id: addendumNo(seq), seq, status, day: "2026-09-01", by: "u", reason: "client", changes: [], signedOn: status === "signed" ? d : null, voidOn: status === "void" ? d : null })
    expect(contractRecord([mk(1, "signed", "2026-09-05"), mk(2, "void", "2026-09-09"), mk(3, "draft", "")]).map((a) => a.seq)).toEqual([2, 1])
    expect(draftAge("2026-09-20", "2026-09-27")).toBe(7)
    const signed = { ...mk(1, "signed", "2026-09-05"), signedSeq: 1, changes: [{ key: "retention" as const, from: 0.1, to: 0.05 }] }
    expect(amendedBy([signed]).retention?.seq).toBe(1)
  })
})

describe("the writes (WF-08)", () => {
  it("the QS drafts; the draft changes nothing; the PM signs; in force moves and the original stays", async () => {
    seedProject()
    const seq = await draftAddendum(db, qs, "p1", qsA, { next: { ...original, paymentDays: 45 }, reason: "client" })
    expect(seq).toBe(1)
    expect(addendum(1)).toMatchObject({ status: "draft", by: "qs1", changes: [{ key: "paymentDays", from: 30, to: 45 }] })
    expect(readDoc<Record<string, any>>("projects/p1")!.pm.addendaCount).toBe(1)
    await expect(signAddendum(db, qs, "p1", qsA, 1, { signedOn: today })).rejects.toBeInstanceOf(PmAccessError)
    await signAddendum(db, pm, "p1", pmA, 1, { signedOn: today, signatory: "Eng. Salem (client)" })
    expect(addendum(1)).toMatchObject({ status: "signed", signedSeq: 1, signedBy: "pm1", signatory: "Eng. Salem (client)" })
    const p = readDoc<Record<string, any>>("projects/p1")!
    expect(p.pm.original.paymentDays).toBe(30)
    expect(inForce(p.pm.original, allAddenda()).paymentDays).toBe(45)
    expect(readDoc(`${PM_EVENTS}/org__prj:AMD:PJ-2026_007:1`)).toMatchObject({ kind: "AMD", changes: [{ key: "paymentDays", from: 30, to: 45 }] })
    expect(listCollection(PM_EVENTS)).toHaveLength(1)
  })

  it("a non-financial addendum sends nothing to Finance", async () => {
    seedProject()
    await draftAddendum(db, pm, "p1", pmA, { next: { ...original, claimNoticeDays: 42 }, reason: "settle" })
    await signAddendum(db, pm, "p1", pmA, 1, { signedOn: today })
    expect(listCollection(PM_EVENTS)).toHaveLength(0)
  })

  it("two drafts on one term: the second is stale once the first is signed (AMD-05)", async () => {
    seedProject()
    await draftAddendum(db, qs, "p1", qsA, { next: { ...original, retention: 0.05 }, reason: "client" })
    await draftAddendum(db, qs, "p1", qsA, { next: { ...original, retention: 0.07 }, reason: "ours" })
    await signAddendum(db, pm, "p1", pmA, 1, { signedOn: today })
    await expect(signAddendum(db, pm, "p1", pmA, 2, { signedOn: today })).rejects.toMatchObject({ code: "blocked", blocks: ["stale"] })
    await withdrawAddendum(db, qs, "p1", qsA, 2, { reason: "replaced" })
    expect(addendum(2)).toMatchObject({ status: "void", voidReason: "replaced", voidBy: "qs1" })
    expect(allAddenda()).toHaveLength(2)
  })

  it("a cap below held is refused at draft, and again at signing when a certificate raised it in between (AC-08)", async () => {
    seedProject({ retentionHeld: 250_000 })
    await expect(draftAddendum(db, pm, "p1", pmA, { next: { ...original, retentionCap: 0.02 }, reason: "client" })).rejects.toMatchObject({ blocks: ["cap_below_held"] })
    seedProject({ retentionHeld: 250_000 })
    await draftAddendum(db, pm, "p1", pmA, { next: { ...original, retentionCap: 0.03 }, reason: "client" })
    const p = readDoc<Record<string, any>>("projects/p1")!
    seed("projects/p1", { ...p, pm: { ...p.pm, retentionHeld: 320_000 } })
    await expect(signAddendum(db, pm, "p1", pmA, 1, { signedOn: today })).rejects.toMatchObject({ blocks: ["cap_below_held"] })
  })

  it("the signature date order is enforced by the write", async () => {
    seedProject()
    await draftAddendum(db, pm, "p1", pmA, { next: { ...original, paymentDays: 45 }, reason: "client" })
    await expect(signAddendum(db, pm, "p1", pmA, 1, { signedOn: yesterday })).rejects.toMatchObject({ blocks: ["before_draft"] })
    await expect(signAddendum(db, pm, "p1", pmA, 1, { signedOn: "2999-01-01" })).rejects.toMatchObject({ blocks: ["future"] })
  })

  it("the site engineer drafts nothing; the drafter withdraws their own; another QS cannot", async () => {
    seedProject()
    await expect(draftAddendum(db, site, "p1", { uid: "se1", name: null }, { next: { ...original, paymentDays: 45 }, reason: "client" })).rejects.toBeInstanceOf(PmAccessError)
    await draftAddendum(db, qs, "p1", qsA, { next: { ...original, paymentDays: 45 }, reason: "client" })
    const qs2 = ctx("pm.cost", "qs", "qs2")
    await expect(withdrawAddendum(db, qs2, "p1", { uid: "qs2", name: null }, 1, { reason: "refused" })).rejects.toBeInstanceOf(PmAccessError)
    await withdrawAddendum(db, qs, "p1", qsA, 1, { reason: "other", reasonText: "Client asked to wait" })
    expect(addendum(1)).toMatchObject({ status: "void", voidText: "Client asked to wait" })
  })

  it("nothing before start, nothing on an archived project — the owner included (AMD-03, RL-04)", async () => {
    seedProject({ lifecycle: "plan", original: null })
    await expect(draftAddendum(db, pm, "p1", pmA, { next: { ...original, paymentDays: 45 }, reason: "client" })).rejects.toBeInstanceOf(PmAddendumError)
    seedProject({ lifecycle: "closed" })
    const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
    await expect(draftAddendum(db, owner, "p1", { uid: "o", name: null }, { next: { ...original, paymentDays: 45 }, reason: "client" })).rejects.toMatchObject({ code: "archived" })
  })
})

/**
 * PM 1.0 — the Contract group at prototype parity: the BOQ view's figures,
 * filters, grouping and import validation; pricing an unpriced line once;
 * variations dated as asked and decided, with value at risk; the programme's
 * curve shape; the contract record across the three doors; the terms in cash;
 * an addendum drafted and signed in one step; the file's narrow edit and the
 * org's recorded self-approval.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import {
  boqTotals,
  crmMismatch,
  filterLines,
  groupLines,
  lineBleeding,
  lineMarginPct,
  lineUnbilled,
  parseBoqPaste,
  priceBlocks,
  unpricedNote,
  viewCounts,
  type PmBoqLine,
} from "@/lib/pm/boq"
import { importBoq, PmBoqError, priceItem } from "@/lib/pm/boq-writes"
import { contractEvents, termsCash } from "@/lib/pm/contract-record"
import { draftAddendum } from "@/lib/pm/addendum-writes"
import { curveK, planF, programmeK } from "@/lib/pm/programme"
import { decisionDateBlocks, logBlocks, valueAtRisk } from "@/lib/pm/variation"
import { approveVariation, logVariation, PmVariationError, priceVariation, submitVariation } from "@/lib/pm/variation-writes"
import { setSelfApproval, updatePmInfo } from "@/lib/pm/info-writes"
import { defaultTerms } from "@/lib/pm/terms"
import { todayDay } from "@/lib/pm/format"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const owner: PmContext = { ceiling: pmCeiling({ owner: true, permissions: [] }), seat: null, archived: false }
const pmA = { uid: "pm1", name: "Abdullah" }

const line = (o: Partial<PmBoqLine>): PmBoqLine => ({ id: "b", code: "03-01-01", description: "Concrete", unit: "m3", division: "03", quantity: 100, rate: 500, estCost: 400, executed: 0, billed: 0, actual: null, ...o })

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", budget: 1_000_000, pm: { no: "PJ-2026/003", lifecycle: "live", terms: defaultTerms(), original: defaultTerms(), durationDays: 300 } })
})

describe("BOQ view (C-01…C-08)", () => {
  const lines = [
    line({ id: "a", executed: 50, billed: 10, actual: 22_000 }),
    line({ id: "b", code: "04-01-01", division: "04", executed: 100, billed: 100, actual: 38_000 }),
    line({ id: "c", code: "04-02-01", division: "04", rate: 0, quantity: 30, executed: 5 }),
  ]

  it("figures: unbilled, bleeding over 2%, margin on booked cost", () => {
    expect(lineUnbilled(lines[0])).toBe(20_000)
    expect(lineBleeding(lines[0])).toBe(true)
    expect(lineBleeding(lines[1])).toBe(false)
    expect(Math.round(lineMarginPct(lines[0]))).toBe(12)
  })

  it("views, search, grouping and totals", () => {
    expect(viewCounts(lines)).toEqual({ all: 3, leak: 1, ub: 1, ns: 0, done: 1 })
    expect(filterLines(lines, "all", "04-02").map((b) => b.id)).toEqual(["c"])
    expect(groupLines(lines, true).map((g) => [g.division, g.lines.length])).toEqual([["03", 1], ["04", 2]])
    const t = boqTotals(lines)
    expect(t).toMatchObject({ contract: 100_000, earned: 75_000, unbilled: 20_000 })
    expect(t.estimated).toBe(true)
    expect(t.costed).toBe(true)
    // Nothing costed (no estimate, no booked cost): cost and margin read «—», not the earned value.
    expect(boqTotals(lines.map((b) => ({ ...b, estCost: 0, actual: null }))).costed).toBe(false)
  })

  it("the unpriced note counts executed unpriced lines and their unweighted share", () => {
    expect(unpricedNote(lines)).toEqual({ count: 1, executed: 1, unweighted: (30 / 230) * 100 })
  })

  it("import: every row judged; CRM value mismatch over 0.5%", () => {
    const r = parseBoqPaste("02-01-01\tExcavation\tm3\t18400\t24\t18.5\n02-01-01\tDup\tm3\t1\n9x\t\tm2\t-1\tabc", ["22-01-01"])
    expect(r.ok).toHaveLength(1)
    expect(r.bad.map((b) => b.problems)).toEqual([["duplicate"], ["code_format", "no_description", "bad_qty", "bad_rate"]])
    expect(parseBoqPaste("٠٢-٠١-٠١|x|m|١٠").ok[0]).toBeUndefined()
    expect(parseBoqPaste("02-01-01|x|m|١٠").ok[0].quantity).toBe(10)
    expect(crmMismatch(r.ok, 441_600)).toBeNull()
    expect(crmMismatch(r.ok, 500_000)).toMatchObject({ under: true, diff: 58_400 })
  })

  it("pricing: once, agreed rate, prep|approve with money", async () => {
    expect(priceBlocks({ archived: false, currentRate: 10, rate: 0, cost: -1 })).toEqual(["already_priced", "bad_rate", "bad_cost"])
    seed("projects/p1/boqItems/x", { itemNo: "04-02-01", unitPrice: "", quantity: 30, executedQuantity: 5 })
    await expect(priceItem(db, site, "p1", { uid: "se1", name: "S" }, "x", { rate: 60, cost: 45 })).rejects.toBeInstanceOf(PmAccessError)
    await priceItem(db, pm, "p1", pmA, "x", { rate: 60, cost: 45 })
    expect(readDoc("projects/p1/boqItems/x")).toMatchObject({ unitPrice: 60, estCost: 45, pricedBy: "pm1" })
    await expect(priceItem(db, pm, "p1", pmA, "x", { rate: 70, cost: 0 })).rejects.toBeInstanceOf(PmBoqError)
  })

  it("import writes into an empty BOQ only", async () => {
    const rows = parseBoqPaste("02-01-01\tExcavation\tm3\t100\t24\t18").ok
    await importBoq(db, pm, "p1", rows)
    expect(listCollection("projects/p1/boqItems")).toHaveLength(1)
    await expect(importBoq(db, pm, "p1", rows)).rejects.toMatchObject({ code: "has_items" })
  })
})

describe("variations (C-16…C-20)", () => {
  it("dated as asked, with items and days; decided on a dated paper", async () => {
    expect(logBlocks({ archived: false, title: "x", source: "law", value: 0, cost: 0, executedPct: 0, requestedOn: "2099-01-01", days: 1.5, today: "2026-09-28" })).toEqual(["bad_day", "bad_days"])
    expect(decisionDateBlocks({ on: "2026-08-01", requestedOn: "2026-08-10", today: "2026-09-28" })).toEqual(["before_request"])
    const seq = await logVariation(db, pm, "p1", pmA, { title: "Pool", source: "dwg", value: 0, cost: 0, executedPct: 0, requestedOn: "2026-09-01", itemIds: ["a"], days: 14, files: [{ url: "u", name: "si.pdf" }] })
    expect(readDoc("projects/p1/pmVariations/01")).toMatchObject({ day: "2026-09-01", loggedOn: todayDay(), itemIds: ["a"], days: 14, files: [{ name: "si.pdf" }] })
    await priceVariation(db, pm, "p1", seq, { value: 100_000, cost: 80_000 })
    await submitVariation(db, pm, "p1", seq)
    await expect(approveVariation(db, pm, "p1", pmA, seq, "L-1", { on: "2026-08-01" })).rejects.toBeInstanceOf(PmVariationError)
    await approveVariation(db, pm, "p1", pmA, seq, "L-1", { on: "2026-09-10", files: [{ url: "v", name: "ok.pdf" }] })
    expect(readDoc("projects/p1/pmVariations/01")).toMatchObject({ status: "appr", decision: { on: "2026-09-10", ref: "L-1", files: [{ name: "ok.pdf" }] } })
  })

  it("value at risk counts rejected and undecided work", () => {
    expect(valueAtRisk([{ status: "wait", value: 100, executedPct: 0.3 }, { status: "rej", value: 50, executedPct: 1 }, { status: "appr", value: 999, executedPct: 1 }])).toBe(80)
  })
})

describe("programme (C-27)", () => {
  it("the curve's shape is calibrated from the activities, else linear", () => {
    expect(planF(0.5, 1)).toBe(50)
    expect(planF(0.5, 2)).toBe(75)
    expect(curveK(75, 0.5)).toBeCloseTo(2)
    expect(curveK(0, 0.5)).toBe(1)
    const items = [{ id: "a", quantity: 10, rate: 100 }]
    expect(programmeK({ acts: [], items, startOn: "2026-01-01", durationDays: 100, today: "2026-02-20" })).toBe(1)
    const k = programmeK({ acts: [{ from: "2026-01-01", to: "2026-01-21", itemIds: ["a"] }], items, startOn: "2026-01-01", durationDays: 100, today: "2026-01-11" })
    expect(k).toBeGreaterThan(1)
  })
})

describe("contract record and cash (C-11, C-12)", () => {
  it("the three doors in one record, newest first", () => {
    const ev = contractEvents({
      startOn: "2026-01-01",
      originalValue: 1e6,
      durationDays: 300,
      variations: [{ seq: 1, status: "appr", title: "Pool", value: 5e4, day: "2026-02-01", decision: { on: "2026-03-01", by: "x" } }],
      claims: [{ seq: 1, status: "appr", cause: "Late site", eventOn: "2026-01-05", response: { on: "2026-04-01", by: "x", days: 45, amount: 0 } }],
      addenda: [],
    })
    expect(ev.map((e) => e.kind)).toEqual(["eot", "vo", "orig"])
  })

  it("cash: held until handover, upfront, worst damages, the gap", () => {
    const t = { ...defaultTerms(), advance: 0.1, retention: 0.1, retentionCap: 0.05, damages: { on: true, weeklyRate: 0.005, cap: 0.1 } }
    expect(termsCash(t, 1e6)).toEqual({ value: 1e6, heldUntilHandover: 5e4, upfront: 1e5, worstDamages: 1e5, gap: 0 })
    expect(termsCash({ ...t, payer: "none" }, 1e6).gap).toBe(0)
  })
})

describe("addendum signed in one step (C-14)", () => {
  it("approve records it drafted and signed together", async () => {
    const next = { ...defaultTerms(), paymentDays: 45 }
    const seq = await draftAddendum(db, pm, "p1", pmA, { next, reason: "client", signNow: { signedOn: todayDay(), signatory: "Eng. F" }, files: [{ url: "u", name: "a.pdf" }] })
    expect(readDoc(`projects/p1/pmAddenda/0${seq}`)).toMatchObject({ status: "signed", signedSeq: 1, signatory: "Eng. F", files: [{ name: "a.pdf" }] })
    expect(readDoc<{ pm: { signedCount: number } }>("projects/p1")?.pm.signedCount).toBe(1)
  })
})

describe("the file (C-02, C-32)", () => {
  it("only location and consultant, by approve", async () => {
    await expect(updatePmInfo(db, site, "p1", { location: "Riyadh", consultant: "X" })).rejects.toBeInstanceOf(PmAccessError)
    await updatePmInfo(db, pm, "p1", { location: " Riyadh ", consultant: "" })
    expect(readDoc("projects/p1")).toMatchObject({ location: "Riyadh", consultant: null, budget: 1_000_000 })
  })

  it("self-approval is the owner's, recorded", async () => {
    await expect(setSelfApproval(db, pm, "org", pmA, true)).rejects.toBeInstanceOf(PmAccessError)
    await setSelfApproval(db, owner, "org", { uid: "own", name: "Owner" }, true)
    expect(readDoc("pmSettings/org")).toMatchObject({ selfApproval: true, selfApprovalBy: "own" })
  })
})

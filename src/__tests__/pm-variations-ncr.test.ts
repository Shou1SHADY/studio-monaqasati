/**
 * PM 1.0 — variations (VO-01…03, INV-01) and non-conformance (NCR-01), and
 * both in the one close gate (ARC-01): a priced variation left undecided and an
 * open NCR block closing.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { closeBlocks, closeoutRows } from "@/lib/pm/closeout"
import { isOpenNcr, ncrBlocks, type PmNcr } from "@/lib/pm/ncr"
import { acceptNcr, PmNcrError, raiseNcr, submitNcrPlan } from "@/lib/pm/ncr-writes"
import { approvedValue, logBlocks, pricedPending, stepBlocks, variationsEarned, workBeforeApproval, type PmVariation } from "@/lib/pm/variation"
import { approveVariation, logVariation, PmVariationError, priceVariation, recordVariationProgress, rejectVariation, submitVariation } from "@/lib/pm/variation-writes"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const qs: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.cost"] }), seat: { uid: "qs1", role: "qs" }, archived: false }
const site: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: { uid: "se1", role: "site" }, archived: false }
const qsA = { uid: "qs1", name: "Mona" }
const pmA = { uid: "pm1", name: "Abdullah" }
const seA = { uid: "se1", name: "Omar" }
const vo = (n: string) => readDoc<PmVariation>(`projects/p1/pmVariations/${n}`) as PmVariation
const ncr = (n: string) => readDoc<PmNcr>(`projects/p1/pmNcrs/${n}`) as PmNcr

beforeEach(() => {
  resetFakeDb()
  seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", status: "working", budget: 1_000_000, pm: { no: "PJ-2026/003", lifecycle: "live" } })
  seed("projects/p1/boqItems/i1", { itemNo: "03-01", quantity: 100, unitPrice: 1000 })
})

describe("variations — the one door the contract value changes through", () => {
  it("logging is not approval: only an approved variation enters the value (VO-02, INV-01)", () => {
    const rows = [
      { status: "draft" as const, value: 50_000, executedPct: 0.2 },
      { status: "wait" as const, value: 30_000, executedPct: 0 },
      { status: "appr" as const, value: 20_000, executedPct: 0.5 },
      { status: "rej" as const, value: 9_000, executedPct: 0 },
    ]
    expect(approvedValue(rows)).toBe(20_000)
    expect(variationsEarned(rows)).toBe(10_000)
    expect(workBeforeApproval(rows)).toHaveLength(1)
    expect(pricedPending(rows)).toHaveLength(2)
  })

  it("'other' is stated, a submission is priced, a rejection has its reason (RSN-01, VO-01)", () => {
    expect(logBlocks({ archived: false, title: " ", source: "oth", sourceText: "", value: -1, cost: 0, executedPct: 2 })).toEqual(["no_title", "source_text", "bad_value", "bad_pct"])
    expect(stepBlocks({ archived: false, status: "draft", step: "submit", value: 0 })).toEqual(["unpriced"])
    expect(stepBlocks({ archived: false, status: "wait", step: "reject", reason: " " })).toEqual(["no_reason"])
    expect(stepBlocks({ archived: false, status: "wait", step: "reprice" })).toEqual(["price_locked"])
  })

  it("logged by vo, priced as a draft, submitted, approved by approve", async () => {
    const seq = await logVariation(db, qs, "p1", qsA, { title: "Extra canopy", source: "cons", instructionNo: "SI-4", value: 0, cost: 0, executedPct: 0 })
    expect(vo("01")).toMatchObject({ status: "draft", source: "cons", instructionNo: "SI-4" })
    expect(readDoc<{ pm: { voCount: number } }>("projects/p1")!.pm.voCount).toBe(1)
    await expect(submitVariation(db, qs, "p1", seq)).rejects.toBeInstanceOf(PmVariationError)
    await priceVariation(db, qs, "p1", seq, { value: 30_000, cost: 22_000 })
    await submitVariation(db, qs, "p1", seq)
    await expect(priceVariation(db, qs, "p1", seq, { value: 1, cost: 1 })).rejects.toBeInstanceOf(PmVariationError)
    await expect(approveVariation(db, qs, "p1", qsA, seq)).rejects.toBeInstanceOf(PmAccessError)
    await approveVariation(db, pm, "p1", pmA, seq, "Letter 12")
    expect(vo("01")).toMatchObject({ status: "appr", value: 30_000, decision: { by: "pm1", ref: "Letter 12" } })
    await recordVariationProgress(db, qs, "p1", seq, 0.4)
    expect(vo("01").executedPct).toBe(0.4)
  })

  it("a rejection keeps the record, with its reason", async () => {
    const seq = await logVariation(db, qs, "p1", qsA, { title: "Marble upgrade", source: "client", value: 80_000, cost: 60_000, executedPct: 0 })
    await submitVariation(db, qs, "p1", seq)
    await expect(rejectVariation(db, pm, "p1", pmA, seq, "")).rejects.toBeInstanceOf(PmVariationError)
    await rejectVariation(db, pm, "p1", pmA, seq, "Over budget")
    expect(vo("01")).toMatchObject({ status: "rej", decision: { reason: "Over budget" } })
  })

  it("the site engineer logs none (no vo duty)", async () => {
    await expect(logVariation(db, site, "p1", seA, { title: "x", source: "site", value: 0, cost: 0, executedPct: 0 })).rejects.toBeInstanceOf(PmAccessError)
  })
})

describe("non-conformance", () => {
  it("needs the item and the root cause; open → plan → closed on acceptance (NCR-01)", async () => {
    expect(ncrBlocks({ archived: false, itemId: null, root: " ", cost: -1 })).toEqual(["no_item", "no_root", "bad_cost"])
    const seq = await raiseNcr(db, site, "p1", seA, { itemId: "i1", severity: "a", root: "Cover to rebar under spec", cost: 4_500 })
    expect(ncr("01")).toMatchObject({ status: "open", code: "03-01", severity: "a" })
    await expect(acceptNcr(db, site, "p1", seA, seq)).rejects.toBeInstanceOf(PmNcrError)
    await expect(submitNcrPlan(db, site, "p1", seA, seq, " ")).rejects.toBeInstanceOf(PmNcrError)
    await submitNcrPlan(db, site, "p1", seA, seq, "Break out and recast")
    await acceptNcr(db, site, "p1", seA, seq)
    expect(ncr("01")).toMatchObject({ status: "done", plan: { text: "Break out and recast" } })
    expect(isOpenNcr(ncr("01"))).toBe(false)
  })

  it("is quality's — the QS office raises none", async () => {
    await expect(raiseNcr(db, qs, "p1", qsA, { itemId: "i1", severity: "b", root: "x", cost: 0 })).rejects.toBeInstanceOf(PmAccessError)
  })
})

describe("both join the one close gate (ARC-01)", () => {
  const base = {
    hasClient: true,
    acceptances: { prov: { on: "2026-01-01", by: "pm1" }, final: { on: "2027-01-01", by: "pm1" } },
    punch: [],
    items: [],
    cutPool: 0,
    certificates: [],
    retentionHeld: 0,
    retentionReleased: true,
    today: "2027-02-01",
  } as unknown as Parameters<typeof closeoutRows>[0]

  it("an open NCR and a priced variation still undecided block closing", () => {
    expect(closeBlocks(closeoutRows(base))).toEqual([])
    const blocked = closeBlocks(closeoutRows({ ...base, ncrs: [{ status: "plan" }], variations: [{ status: "wait", value: 10_000 }, { status: "rej", value: 5_000 }] }))
    expect(blocked.map((r) => [r.key, r.n])).toEqual([
      ["ncr", 1],
      ["vo_pending", 1],
    ])
  })
})

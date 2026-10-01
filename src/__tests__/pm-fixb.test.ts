/**
 * PM 1.0 prototype parity — contract, money and file/settings fixes: the
 * project store ledger in the closeout gate and the section switch; plant on
 * site blocks `eqp`; census rows for claims, programme, weekly plans, plant;
 * the archive snapshot's cost and margin; material lost; replacing the PM in
 * one step; approval limits; an advance changed after Finance has it; the
 * consultant's cut reasons; re-claimable cuts; half-released retention; the
 * defects period left.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { pmCeiling, type PmContext } from "@/lib/pm/access"
import { defectsLeft } from "@/lib/pm/acceptance"
import { BOUNDARY_CONFLICTS, eventStats } from "@/lib/pm/boundary"
import { certifyBlocks, collectionFigures, isCutReason, unreclaimedCuts } from "@/lib/pm/certificate"
import { archiveSnapshot, materialLost, storeHoldings, storeItemOf } from "@/lib/pm/closeout"
import { closeAndArchive } from "@/lib/pm/closeout-writes"
import { PM_EVENTS } from "@/lib/pm/events"
import { advanceChangedAfterFinance, savePlanTerms } from "@/lib/pm/project-writes"
import { readSectionFacts, SECTION_LOSS, sectionCensus, switchOffBlockers, switchSections } from "@/lib/pm/sections-governance"
import { storeLineOf, type StoreMove } from "@/lib/pm/store"
import { approvalLimitOf, assignBlocks, replacedManager } from "@/lib/pm/team"
import { defaultTerms } from "@/lib/pm/terms"

const db = fakeFirestore as unknown as Firestore
const pm: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: { uid: "pm1", role: "pm" }, archived: false }
const mv = (t: StoreMove["t"], q: number, st?: StoreMove["st"]): StoreMove => ({ t, q, on: "2026-06-01", by: "se1", st: st ?? null })
const item = { id: "i1", code: "03-01-01", description: "", unit: "m3", quantity: 100, executed: 0 }

beforeEach(() => resetFakeDb())

describe("the project store is the PM ledger (closeout C-37, sections C-42)", () => {
  const line = storeLineOf("m1", { key: "cement|bag", name: "Cement", unit: "bag", rates: {}, moves: [mv("rc", 50), mv("loss", 5, "ok"), mv("loss", 3, "wait")] })
  const empty = storeLineOf("m2", { key: "steel|t", name: "Steel", unit: "t", rates: {}, moves: [mv("rc", 10), mv("ret", 10)] })

  it("counts lines with a balance and values them at the known cost", () => {
    expect(storeHoldings([line, empty], [item], (x) => (x.name === "Cement" ? 20 : null))).toEqual({ lines: 1, value: 900 })
    expect(storeHoldings([empty], [item]).lines).toBe(0)
  })

  it("material lost = approved losses at cost, pending ones excluded", () => {
    expect(materialLost([line, empty], () => 20)).toBe(100)
  })

  it("a stored BOQ line reads as a store item", () => {
    expect(storeItemOf("i1", { itemNo: "03-01-01", unit: "m3", quantity: "1,200", executedQuantity: 30 })).toMatchObject({ id: "i1", code: "03-01-01", quantity: 1200, executed: 30 })
  })

  it("readSectionFacts reads pmStore (not a warehouse), plant on site, claims, activities, weeks", async () => {
    seed("projects/p1", { organizationId: "org", warehouseId: "w1", pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed("warehouses/w1/inventoryItems/x", { quantity: 99, unitCost: 5 })
    seed("projects/p1/boqItems/i1", { itemNo: "03-01-01", unit: "m3", quantity: 100, executedQuantity: 0 })
    seed("projects/p1/pmStore/m1", { key: "cement|bag", name: "Cement", unit: "bag", rates: {}, moves: [mv("rc", 50)] })
    seed("priceHistory/h1", { organizationId: "org", materialKey: "cement|bag", name: "Cement", unit: "bag", price: 20, day: "2026-05-01", kind: "po" })
    seed("projects/p1/pmPlant/01", { seq: 1, status: "use", dayRate: 1000, category: "heavy", qty: 1, days: { "2026-06-01": "work" } })
    seed("projects/p1/pmPlant/02", { seq: 2, status: "back", days: {} })
    seed("projects/p1/pmPlantRequests/01", { status: "go" })
    seed("projects/p1/pmPlantRequests/02", { status: "rej" })
    seed("projects/p1/pmClaims/01", { status: "notice" })
    seed("projects/p1/pmClaims/02", { status: "appr" })
    seed("projects/p1/pmActivities/01", { name: "Pour" })
    seed("projects/p1/pmWeeks/2026-06-01", { status: "open" })
    const f = await readSectionFacts(db, "p1", "w1")
    expect(f).toMatchObject({ storeLines: 1, plantOnSite: 1, plantCharged: 1000, plantRequestsOpen: 1, claimsOpen: 1, activities: 1, weeks: 1 })
  })
})

describe("sections: plant blocks `eqp`, census and loss text (C-41, C-42)", () => {
  const facts = { storeLines: 0, uncollected: 0, plantOnSite: 2, plantCharged: 4500, plantRequestsOpen: 1, claimsOpen: 3, activities: 7, weeks: 4 }

  it("plant still on site blocks switching eqp off; nothing else does", () => {
    expect(switchOffBlockers(["eqp"], facts)).toEqual(["plant_on_site"])
    expect(switchOffBlockers(["eqp"], { ...facts, plantOnSite: 0 })).toEqual([])
  })

  it("census rows for claims, programme, weekly plans and plant", () => {
    expect(sectionCensus("claim", facts)).toEqual([{ key: "claims_open", value: 3, money: false, level: "w" }])
    expect(sectionCensus("progress", facts)).toEqual([{ key: "activities", value: 7, money: false, level: "" }])
    expect(sectionCensus("wwp", facts)).toEqual([{ key: "weeks", value: 4, money: false, level: "" }])
    expect(sectionCensus("eqp", facts).map((r) => [r.key, r.level, r.money])).toEqual([
      ["plant_on_site", "r", false],
      ["plant_charged", "", true],
      ["plant_requests", "w", false],
    ])
    expect(["claim", "wwp", "eqp"].every((k) => SECTION_LOSS.has(k as "claim"))).toBe(true)
  })

  it("the switch reads the facts itself and refuses eqp off with plant on site", async () => {
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", enabledSections: ["contract", "procure", "eqp"], pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed("projects/p1/pmPlant/01", { seq: 1, status: "req", days: {} })
    await expect(switchSections(db, pm, "p1", { uid: "pm1", name: null }, { next: ["contract", "procure"], reason: "scope" })).rejects.toMatchObject({ blocks: ["plant_on_site"] })
  })

  it("the switch refuses store off while the ledger holds a balance", async () => {
    seed("projects/p1", { organizationId: "org", projectManagerId: "pm1", enabledSections: ["contract", "procure", "store", "receive"], pm: { no: "PJ-2026/001", lifecycle: "live" } })
    seed("projects/p1/pmStore/m1", { key: "k", name: "Cement", unit: "bag", rates: {}, moves: [mv("rc", 5)] })
    await expect(switchSections(db, pm, "p1", { uid: "pm1", name: null }, { next: ["contract", "procure", "receive"], reason: "scope" })).rejects.toMatchObject({ blocks: ["store_stock"] })
  })
})

describe("closing reads the ledger and freezes cost and margin (C-37, C-38)", () => {
  const terms = { ...defaultTerms(), payer: "none" as const }
  const acceptances = { prov: { on: "2026-06-01", by: "pm1" }, final: { on: "2026-09-01", by: "pm1" } }
  const seedDone = () => {
    seed("projects/p1", { organizationId: "org", budget: 1000, projectManagerId: "pm1", status: "remaining_payment", enabledSections: ["contract", "procure", "store"], pm: { no: "PJ-2026/005", lifecycle: "done", terms, original: terms, acceptances, durationDays: 100, startedAt: "2026-01-01" } })
    seed("projects/p1/boqItems/i1", { itemNo: "01", unit: "m3", quantity: 10, unitPrice: 100, executedQuantity: 10 })
  }

  it("a balance in pmStore blocks — a warehouse's stock does not", async () => {
    seedDone()
    seed("projects/p1/pmStore/m1", { key: "k", name: "Cement", unit: "bag", rates: {}, moves: [mv("rc", 3)] })
    await expect(closeAndArchive(db, pm, "p1", { uid: "pm1", name: null })).rejects.toMatchObject({ code: "blocked", blocks: ["store"] })
  })

  it("the snapshot carries actual cost and realised margin from the cost roll-up", async () => {
    seedDone()
    seed("projects/p1/pmStore/m1", { key: "k", name: "Cement", unit: "bag", rates: {}, moves: [mv("rc", 3), mv("ret", 3)] })
    await closeAndArchive(db, pm, "p1", { uid: "pm1", name: null }, { actual: 820, earned: 1000 })
    expect(readDoc<{ pm: { fin: Record<string, unknown> } }>("projects/p1")!.pm.fin).toMatchObject({ actualCost: 820, margin: 180, marginPct: 18 })
  })

  it("without the roll-up the snapshot freezes no cost — never an invented one", () => {
    const f = archiveSnapshot({ contractValue: 1000, items: [], certificates: [], retentionHeld: 0, advanceRecovered: 0, durationDays: null, startedAt: null, finalOn: null, today: "2026-09-29" })
    expect(f).toMatchObject({ actualCost: null, margin: null, marginPct: null })
  })
})

describe("team: one-step PM replacement and approval limits", () => {
  it("names the outgoing manager only when someone else takes the pm role", () => {
    expect(replacedManager({ uid: "pm2", role: "pm", projectManagerId: "pm1" })).toBe("pm1")
    expect(replacedManager({ uid: "pm1", role: "pm", projectManagerId: "pm1" })).toBeNull()
    expect(replacedManager({ uid: "pm2", role: "site", projectManagerId: "pm1" })).toBeNull()
  })

  it("a first day in the future is refused", () => {
    expect(assignBlocks({ uid: "u", role: "site", current: null, projectManagerId: "pm1", admin: false, from: "2026-10-01", today: "2026-09-29" })).toEqual(["future_from"])
  })

  it("the owner has no limit, po.approve holds the manager's, anyone else approves nothing", () => {
    expect(approvalLimitOf({ owner: true, permissions: [] }, 150_000)).toBe("any")
    expect(approvalLimitOf({ owner: false, permissions: ["*"] }, 150_000)).toBe("any")
    expect(approvalLimitOf({ owner: false, permissions: ["po.approve"] }, 150_000)).toBe(150_000)
    expect(approvalLimitOf({ owner: false, permissions: ["pm.manage"] }, 150_000)).toBeNull()
  })
})

describe("an advance changed before start after Finance received it (termsMain advLog)", () => {
  const terms = { ...defaultTerms(), advance: 0.1 }
  const seedPlan = () => seed("projects/p1", { organizationId: "org", budget: 1_000_000, projectManagerId: "pm1", status: "planning", pm: { no: "PJ-2026/007", lifecycle: "plan", terms } })

  it("only a real change of an advance Finance holds counts", () => {
    expect(advanceChangedAfterFinance(terms, { advance: 0.15 }, true)).toBe(true)
    expect(advanceChangedAfterFinance(terms, { advance: 0.1 }, true)).toBe(false)
    expect(advanceChangedAfterFinance(terms, { advance: 0.15 }, false)).toBe(false)
  })

  it("logs the change and warns — Finance gets no second event (the prototype) — and records who completed the terms", async () => {
    seedPlan()
    // An event sent before the outbox id carried the organisation: still found, by its key within the organisation.
    seed(`${PM_EVENTS}/prj:ADV:PJ-2026_007`, { key: "prj:ADV:PJ-2026/007", kind: "ADV", organizationId: "org" })
    const r = await savePlanTerms(db, pm, "p1", { ...terms, advance: 0.15 }, { uid: "pm1", name: "Abdullah" })
    expect(r.advanceChanged).toBe(true)
    const block = readDoc<{ pm: Record<string, unknown> }>("projects/p1")!.pm
    expect(block).toMatchObject({ termsBy: "pm1", termsByName: "Abdullah", advLog: [{ from: 0.1, to: 0.15, by: "pm1" }] })
    const events = listCollection<Record<string, unknown>>(PM_EVENTS)
    expect(events.map((e) => e.key)).toEqual(["prj:ADV:PJ-2026/007"])
  })

  it("no ADV sent — no log and no event", async () => {
    seedPlan()
    const r = await savePlanTerms(db, pm, "p1", { ...terms, advance: 0.15 }, { uid: "pm1", name: null })
    expect(r.advanceChanged).toBe(false)
    expect(listCollection(PM_EVENTS)).toHaveLength(0)
    expect(readDoc<{ pm: Record<string, unknown> }>("projects/p1")!.pm.advLog).toBeUndefined()
  })
})

describe("money: cut reasons, re-claimable cuts, half-released retention", () => {
  it("a deduction states one of the four coded reasons", () => {
    expect(certifyBlocks({ status: "sub", gross: 100, certified: 90, reason: "Partial" })).toEqual(["cut_reason"])
    expect(certifyBlocks({ status: "sub", gross: 100, certified: 90, reason: "rate" })).toEqual([])
    expect(isCutReason("oth")).toBe(true)
    expect(isCutReason("other")).toBe(false)
  })

  it("a later certificate that re-claimed cuts takes every earlier cut with it", () => {
    const certs = [
      { seq: 1, status: "appr" as const, cut: 500 },
      { seq: 2, status: "appr" as const, cut: 0, cutsIncluded: 500 },
      { seq: 3, status: "appr" as const, cut: 200 },
      { seq: 4, status: "void" as const, cut: 0, cutsIncluded: 200 },
    ]
    expect(unreclaimedCuts(certs).map((c) => c.seq)).toEqual([3])
  })

  it("retention held halves once Finance received the first half", () => {
    const base = { certs: [{ seq: 1, status: "appr" as const, gross: 1000, recovery: 0, retention: 100, vat: 150, net: 1050, collected: 0, prepOn: "2026-09-01" }], today: "2026-09-29", contractValue: 10_000, advance: 0, started: true, retentionReleased: false }
    expect(collectionFigures(base).retentionHeld).toBe(100)
    expect(collectionFigures({ ...base, retentionHalfReleased: true }).retentionHeld).toBe(50)
    expect(collectionFigures({ ...base, retentionReleased: true, retentionHalfReleased: true }).retentionHeld).toBe(0)
  })
})

describe("handover: the defects period left or elapsed", () => {
  it("counts days to its end; negative once it ended", () => {
    expect(defectsLeft("2026-10-09", "2026-09-29")).toBe(10)
    expect(defectsLeft("2026-09-19", "2026-09-29")).toBe(-10)
  })
})

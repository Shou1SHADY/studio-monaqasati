/**
 * PM fix wave A (portfolio, head & Pulse, page gating and badges): supply,
 * store, equipment, re-measurement and budget decisions; decisions that live in
 * a section; the prototype's presets and the tab gate by section generation;
 * the sub-tab badges; the tab fallback and group order; the archive's money
 * gate; the manual project; and the waiting rows Accounting-off / store returns.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, listCollection, readDoc, resetFakeDb } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { PmAccessError, pmCeiling, type PmContext } from "@/lib/pm/access"
import { projectDecisions, type DecisionFacts } from "@/lib/pm/decisions"
import { PM_EVENTS } from "@/lib/pm/events"
import { manualEnd, manualProjectBlocks, manualTerms, type ManualProjectDraft } from "@/lib/pm/manual-project"
import { createManualProject } from "@/lib/pm/manual-project-writes"
import { groupOf, groupTabs, visibleTab } from "@/lib/pm/project-tabs"
import { financeWaitRows, requestWaitRows, storeWaitRows } from "@/lib/pm/pulse"
import { pmTabVisible, sectionsForKind } from "@/lib/pm/sections"
import { storeLineOf } from "@/lib/pm/store"
import type { PmMaterialRequest } from "@/lib/pm/supply"
import { tabBadges } from "@/lib/pm/tab-badges"
import { defaultTerms } from "@/lib/pm/terms"

const TODAY = "2026-09-27"
const base: DecisionFacts = {
  lifecycle: "live",
  managerless: false,
  startOn: "2026-01-01",
  plannedStart: "2026-01-01",
  durationDays: 300,
  baseValue: 1_000_000,
  terms: defaultTerms(),
  acceptances: {},
  items: [{ id: "i1", code: "03-01", quantity: 100, rate: 10_000, executed: 90, billed: 90 }],
  sheets: [],
  addenda: [],
  certificates: [],
  punch: [],
  variations: [],
  claims: [],
  eac: { on: "2026-09-20" },
  today: TODAY,
}
const run = (f: Partial<DecisionFacts>) => projectDecisions({ ...base, ...f })
const find = (f: Partial<DecisionFacts>, k: string) => run(f).find((d) => d.kind === k)
const viewer = (keys: string[], uid = "u1", owner = false) => ({ uid, has: (k: string) => keys.includes(k), owner })

const request = (over: Partial<PmMaterialRequest>): PmMaterialRequest => ({
  id: "r1",
  title: "Cement",
  status: "pending",
  requestedByUserId: "se1",
  day: "2026-09-20",
  lines: [{ itemId: "i1", code: "03-01", key: "cement|bag", name: "Cement", unit: "bag", qty: 10 }],
  ...over,
})

describe("supply decisions (G-12)", () => {
  it("a request awaiting approval is red when needed within 7 days, blue otherwise", () => {
    expect(find({ requests: [request({ needBy: "2026-10-01" })] }, "req_waiting")).toMatchObject({ severity: "red", count: 1, tab: "pmReq" })
    expect(find({ requests: [request({ needBy: "2026-12-01" })] }, "req_waiting")?.severity).toBe("blue")
  })

  it("an ordered line is on its way to the site engineer, never to the owner", () => {
    const r = request({ status: "approved", poId: "po1" })
    expect(find({ requests: [r], viewer: viewer(["req"]) }, "req_incoming")).toMatchObject({ severity: "blue", count: 1 })
    expect(find({ requests: [r], viewer: viewer(["req", "approve", "admin"], "o", true) }, "req_incoming")).toBeUndefined()
  })

  it("stop what has not arrived once the item is complete", () => {
    const r = request({ status: "approved", poId: "po1" })
    const items = [{ id: "i1", code: "03-01", quantity: 100, rate: 10_000, executed: 100, billed: 90 }]
    expect(find({ requests: [r], items, viewer: viewer(["approve"]) }, "req_stop")).toMatchObject({ severity: "amber", count: 1 })
  })

  it("a change held after approval, and a change the client's rejected variation left unbilled", () => {
    const held = request({ status: "approved", lines: [{ itemId: "i1", code: "03-01", key: "k", name: "Steel", unit: "t", qty: 2, chg: { st: "wait" } }] })
    expect(find({ requests: [held], viewer: viewer(["approve"]) }, "change_held")?.count).toBe(1)
    const own = request({ status: "approved", lines: [{ itemId: "i1", code: "03-01", key: "k", name: "Steel", unit: "t", qty: 2, chg: { st: "own", voSeq: 3 } }] })
    const d = find({ requests: [own], variations: [{ seq: 3, status: "rej", value: 1000, executedPct: 0, day: "2026-09-01" }], viewer: viewer(["approve"]) }, "change_rejected")
    expect(d).toMatchObject({ severity: "red", count: 1 })
    expect(find({ requests: [own], variations: [{ seq: 3, status: "rej", value: 1000, executedPct: 0, day: "2026-09-01" }], viewer: viewer(["measure"]) }, "change_rejected")).toBeUndefined()
  })

  it("shortages reach everyone but the owner", () => {
    expect(find({ shortages: 2, viewer: viewer(["measure"]) }, "need_short")?.count).toBe(2)
    expect(find({ shortages: 2, viewer: viewer(["approve", "admin"], "o", true) }, "need_short")).toBeUndefined()
  })

  it("store: a move to approve (never your own) and a line used beyond what was received", () => {
    const line = storeLineOf("s1", {
      key: "cement|bag",
      name: "Cement",
      unit: "bag",
      rates: { i1: { r: 1, w: 0, ex0: 0, src: "rate" } },
      moves: [
        { t: "rc", q: 5, on: "2026-09-01", by: "se1" },
        { t: "loss", q: 1, on: "2026-09-20", by: "se1", st: "wait", why: "dmg" },
      ],
    })
    expect(find({ stores: [line], viewer: viewer(["approve"], "pm1") }, "store_move")).toMatchObject({ count: 1, tab: "pmStore" })
    expect(find({ stores: [line], viewer: viewer(["approve"], "se1") }, "store_move")).toBeUndefined()
    expect(find({ stores: [line], viewer: viewer(["measure"]) }, "store_negative")).toBeDefined()
    expect(find({ stores: [line], sections: ["contract", "procure", "vo"], viewer: viewer(["approve"], "pm1") }, "store_move")).toBeUndefined()
  })

  it("equipment: waiting approval, idle and charging, past its return", () => {
    const days: Record<string, "idle"> = { "2026-09-22": "idle", "2026-09-23": "idle", "2026-09-24": "idle", "2026-09-25": "idle", "2026-09-26": "idle" }
    const plant = [{ status: "use" as const, to: "2026-09-20", days, dayRate: 900, category: "heavy" as const, qty: 1, licenceTo: null, offOk: null }]
    const ks = run({ plant, plantRequests: [{ status: "wait", rep: null, got: null, day: "2026-09-25", from: "2026-10-01" }], viewer: viewer(["approve"]) }).map((d) => d.kind)
    expect(ks).toEqual(expect.arrayContaining(["eqp_waiting", "eqp_idle", "eqp_overdue"]))
    expect(find({ plant }, "eqp_idle")).toMatchObject({ severity: "red", amount: 3000 })
    expect(find({ plant, sections: ["contract", "procure", "vo"] }, "eqp_idle")).toBeUndefined()
    expect(find({ plantRequests: [{ status: "go", rep: { k: "none", on: TODAY, by: "x" }, got: null, day: TODAY, from: TODAY }], viewer: viewer(["approve"]) }, "eqp_hire")).toBeDefined()
  })

  it("a referred budget overrun waits on the approver (R-25)", () => {
    expect(find({ budgetReferrals: [{ askedAt: "2026-09-20", over: 1200 }], viewer: viewer(["approve"]) }, "po_budget")).toMatchObject({ severity: "amber", amount: 1200, age: 7, tab: "pmPo" })
    expect(find({ budgetReferrals: [{ askedAt: "2026-09-20", over: 1200 }], viewer: viewer(["measure"]) }, "po_budget")).toBeUndefined()
  })
})

describe("re-measurement, damages, manager and sections (G-10, G-11)", () => {
  it("executed beyond the BOQ by more than 25% on a re-measurement contract", () => {
    const items = [{ id: "i1", quantity: 100, rate: 50, executed: 130, billed: 0 }]
    expect(find({ items, viewer: viewer(["client"]) }, "rerate")).toMatchObject({ count: 1, amount: 1500, tab: "boq" })
    expect(find({ items, terms: { ...defaultTerms(), basis: "lump" } }, "rerate")).toBeUndefined()
    expect(find({ items: [{ id: "i1", quantity: 100, rate: 50, executed: 120 }] }, "rerate")).toBeUndefined()
  })

  it("damages turn red above the realised margin", () => {
    const late: Partial<DecisionFacts> = { terms: { ...defaultTerms(), damages: { on: true, weeklyRate: 0.005, cap: 0.1 } }, items: [{ quantity: 100, rate: 10_000, executed: 10 }] }
    expect(find({ ...late, margin: 1_000_000 }, "damages")?.severity).toBe("amber")
    expect(find({ ...late, margin: 10 }, "damages")?.severity).toBe("red")
  })

  it("no manager is not raised on a technically complete project", () => {
    expect(find({ managerless: true }, "no_pm")).toBeDefined()
    expect(find({ managerless: true, lifecycle: "done" }, "no_pm")).toBeUndefined()
  })

  it("claims, samples, inspections and the reconciliation follow their sections", () => {
    const failed = { items: [{ quantity: 100, rate: 10_000, executed: 90, billed: 90, gate: { pmInspect: true, pmWir: "fail" } }] }
    expect(find({ ...failed, sections: ["contract", "procure", "subm"] }, "wir_failed")).toBeUndefined()
    expect(find({ ...failed, sections: ["contract", "procure", "qa"] }, "wir_failed")).toBeDefined()
    expect(find({ ...failed, sections: ["contract", "procure", "ipc"] }, "wir_failed")).toBeDefined()
    expect(find({ eac: null, sections: ["contract", "procure", "subm"] }, "cvr_stale")).toBeUndefined()
    expect(find({ eac: null, sections: ["contract", "procure", "cvr"] }, "cvr_stale")).toBeDefined()
  })
})

describe("sections: the prototype's presets and the gate by generation", () => {
  it("a building project starts with submittals, direct purchase, prices, reconciliation, match, letters and closeout", () => {
    expect(sectionsForKind("bld")).toEqual(expect.arrayContaining(["subm", "petty", "price", "cvr", "match", "corr", "close", "qa", "sched", "progress", "wwp", "eqp", "claim"]))
    expect(sectionsForKind("infra")).not.toContain("petty")
    expect(sectionsForKind("own")).not.toContain("ipc")
  })

  it("a project that chose sections of a generation is gated by them; an older one keeps the tab", () => {
    expect(pmTabVisible(["contract", "procure", "vo"], "subm", 0)).toBe(true)
    expect(pmTabVisible(["contract", "procure", "cvr"], "subm", 0)).toBe(false)
    expect(pmTabVisible(["contract", "procure", "cvr"], "subm", 2)).toBe(true)
    expect(pmTabVisible(["contract", "procure", "cvr"], "vo", 0)).toBe(false)
    expect(pmTabVisible(["contract", "procure"], "docs", 0)).toBe(false)
  })
})

describe("the page: groups, order, fallback", () => {
  it("Money opens on the certificates; closeout sits in File", () => {
    expect(groupOf("pmClose")).toBe("file")
    const g = groupTabs([{ key: "pmCost" }, { key: "pmCvr" }, { key: "ipc" }, { key: "pmClose" }, { key: "info" }])
    expect(g.find((x) => x.group === "money")?.tabs.map((t) => t.key)).toEqual(["ipc", "pmCost", "pmCvr"])
    expect(g.find((x) => x.group === "file")?.tabs.map((t) => t.key)).toEqual(["info", "pmClose"])
  })

  it("a link to a tab the viewer lacks lands on its group's first tab, else the first of all", () => {
    expect(visibleTab("ipc", ["pmToday", "boq", "pmCost"])).toBe("pmCost")
    expect(visibleTab("pmCvr", ["pmToday", "boq"])).toBe("pmToday")
    expect(visibleTab("boq", ["pmToday", "boq"])).toBe("boq")
  })
})

describe("sub-tab badges (SEGS)", () => {
  it("supply, money and settings counts with the prototype's tones", () => {
    const b = tabBadges({
      today: TODAY,
      hasManager: true,
      liveSeats: 3,
      requestsWaiting: 2,
      storeAct: 1,
      storeNegative: true,
      samples: [{ pmSub: "sub" }, { pmSub: "rej" }, { pmSub: "appA" }],
      certificatesOpen: 1,
      certificateOverdue: true,
      matchOver: 2,
      cvrStale: true,
      closeoutOpen: 4,
    })
    expect(b.pmReq).toEqual({ n: 2, tone: "warn" })
    expect(b.pmStore).toEqual({ n: 1, tone: "bad" })
    expect(b.pmSubm).toEqual({ n: 2, tone: "bad" })
    expect(b.ipc).toEqual({ n: 1, tone: "bad" })
    expect(b.pmMatch).toEqual({ n: 2, tone: "bad" })
    expect(b.pmCvr).toEqual({ n: "!", tone: "warn" })
    expect(b.pmClose).toEqual({ n: 4, tone: "warn" })
    expect(b.team).toEqual({ n: 3, tone: "warn" })
    expect(tabBadges({ today: TODAY, hasManager: false, liveSeats: 3 }).team).toEqual({ n: "!", tone: "bad" })
  })
})

describe("waiting on other modules", () => {
  it("a return to the main store waits on Inventory; a request needed within 3 days is late", () => {
    const line = storeLineOf("s1", { key: "k", name: "Cement", unit: "bag", rates: {}, moves: [{ t: "ret", q: 4, on: "2026-09-26", by: "se1", st: "wait", warehouseName: "Main" }] })
    expect(storeWaitRows([line], "p1", TODAY)[0]).toMatchObject({ module: "inv", kind: "store_return", params: { name: "Cement", q: 4 }, late: false, tab: "pmStore" })
    const r = { id: "r1", title: "Cement", status: "approved", approvedOn: TODAY, needBy: "2026-09-29", lines: [{}] }
    expect(requestWaitRows([r], "p1", TODAY)[0].late).toBe(true)
    expect(requestWaitRows([{ ...r, needBy: "2026-10-30" }], "p1", TODAY)[0].late).toBe(false)
  })

  it("with Accounting off, a certified certificate waits while it is collectable, and says so", () => {
    const ev = { key: "prj:IPC:PJ-1:01", kind: "IPC", projectId: "p1", amount: 100, params: { certificate: 1, net: 100 }, at: "2026-09-01" }
    const open = financeWaitRows({ events: [ev], posted: new Set(), released: new Set(), open: new Set(["p1:1"]), booksOff: true, today: TODAY })
    expect(open[0].sub.kind).toBe("books_off")
    expect(financeWaitRows({ events: [ev], posted: new Set(), released: new Set(), open: new Set(), booksOff: true, today: TODAY })).toHaveLength(0)
  })
})

describe("a project created by hand (formPrj without a file)", () => {
  const draft: ManualProjectDraft = { name: "Warehouse", client: "Al-Sanad", kind: "ind", region: "Riyadh", location: "", startOn: "2026-10-01", duration: "", value: "500000", advance: 0.1, retention: 0.05 }
  it("name, client and a manager are required; the end follows the duration", () => {
    expect(manualProjectBlocks({ ...draft, name: " ", client: "" }, null)).toEqual(["no_name", "no_client", "no_manager"])
    expect(manualProjectBlocks(draft, "pm1")).toEqual([])
    expect(manualProjectBlocks({ ...draft, duration: "-3" }, "pm1")).toEqual(["bad_duration"])
    expect(manualEnd("2026-10-01", 30)).toBe("2026-10-31")
    expect(manualTerms({ kind: "own", advance: 0.1, retention: 0.05 }).payer).toBe("none")
  })

  const db = fakeFirestore as unknown as Firestore
  const pmCtx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.manage"] }), seat: null, archived: false }
  const siteCtx: PmContext = { ceiling: pmCeiling({ owner: false, permissions: ["pm.site"] }), seat: null, archived: false }
  beforeEach(() => resetFakeDb())

  it("is born a PM 1.0 project — number, not started, terms, the advance event, seats", async () => {
    const { projectId, projectNo } = await createManualProject(db, pmCtx, { uid: "pm1", name: "Abdullah" }, {
      organizationId: "org",
      draft,
      enabledSections: ["contract", "procure"],
      manager: { uid: "pm1", name: "Abdullah", groupId: "g-pm" },
      siteEngineer: { uid: "se1", name: "Omar", groupId: "g-site" },
    })
    const p = readDoc<Record<string, unknown> & { pm: Record<string, unknown> }>(`projects/${projectId}`)
    expect(p).toMatchObject({ name: "Warehouse", clientName: "Al-Sanad", region: "Riyadh", budget: 500000, projectManagerId: "pm1", contractorId: "pm1" })
    expect(p?.pm).toMatchObject({ no: projectNo, lifecycle: "plan", manual: true, durationDays: 365, startOn: "2026-10-01", terms: { advance: 0.1, retention: 0.05 } })
    expect(readDoc(`projects/${projectId}/members/pm1`)).toMatchObject({ pmRole: "pm", viaManual: true })
    expect(readDoc(`projects/${projectId}/members/se1`)).toMatchObject({ pmRole: "site", viaManual: true })
    expect(listCollection(PM_EVENTS)).toHaveLength(1)
  })

  it("a site engineer has no create key", async () => {
    await expect(createManualProject(db, siteCtx, { uid: "se1", name: "Omar" }, { organizationId: "org", draft, enabledSections: [], manager: { uid: "se1", name: "Omar", groupId: null } })).rejects.toBeInstanceOf(PmAccessError)
    expect(listCollection("projects")).toHaveLength(0)
  })
})

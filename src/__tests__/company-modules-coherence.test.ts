/**
 * A switched-off component leaves the rest working on its own (8 Oct 2026): satellite pages go with
 * their module, links into it are recognised, the approval gates Projects owned stand down, the admin is
 * told what is still in flight, and a write reads the switch inside its transaction.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, resetFakeDb, seed } from "@/test-utils/fake-firestore"
import { runTransaction, type Firestore } from "firebase/firestore"
import { applyModuleSwitches, moduleOffFor, offModuleOwning, SATELLITE_PAGES } from "@/lib/company-modules"
import { readModulesOff } from "@/lib/company-modules-reads"
import { readPending, warningsFor, PENDING_KEYS } from "@/lib/company-modules-pending"
import { approvalGateBlocks } from "@/lib/procurement/policy-enforce"
import { CONTRACTOR_COMPONENTS } from "@/lib/portal-components"

type Gate = Parameters<typeof approvalGateBlocks>[0]

const hrefsOf = (components: ReturnType<typeof applyModuleSwitches>) =>
  components.flatMap((c) => c.sections.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.children?.map((ch) => ch.href) ?? [])])))

describe("pages that live inside another component but belong to a switchable one", () => {
  it("leave the menu with their module and stay for the others", () => {
    const hrOff = hrefsOf(applyModuleSwitches(CONTRACTOR_COMPONENTS, new Set(["hr"]), "contractor"))
    for (const page of SATELLITE_PAGES.hr("contractor")) expect(hrOff).not.toContain(page)
    const allOn = hrefsOf(CONTRACTOR_COMPONENTS)
    const mfgOff = hrefsOf(applyModuleSwitches(CONTRACTOR_COMPONENTS, new Set(["manufacturing"]), "contractor"))
    for (const page of SATELLITE_PAGES.manufacturing("contractor")) expect(mfgOff).not.toContain(page)
    for (const page of SATELLITE_PAGES.hr("contractor")) if (allOn.some((h) => h.split("?")[0] === page)) expect(mfgOff.some((h) => h.split("?")[0] === page)).toBe(true)
  })

  it("show the notice of the module they belong to, not a blank page", () => {
    expect(offModuleOwning("/contractor/accounting/hr-desk", CONTRACTOR_COMPONENTS, new Set(["hr"]), "contractor")).toBe("hr")
    expect(offModuleOwning("/contractor/warehouses/delivery-notes", CONTRACTOR_COMPONENTS, new Set(["manufacturing"]), "contractor")).toBe("manufacturing")
    expect(offModuleOwning("/contractor/accounting/hr-desk", CONTRACTOR_COMPONENTS, new Set(["manufacturing"]), "contractor")).toBeNull()
    expect(offModuleOwning("/contractor/warehouses", CONTRACTOR_COMPONENTS, new Set(["hr", "manufacturing", "project-management"]), "contractor")).toBeNull()
  })
})

describe("a link, a bell entry or a queue item pointing into a module", () => {
  const off = new Set(["manufacturing"])
  it("is recognised with its query string, and ignored when nothing is off or it leaves the app", () => {
    expect(moduleOffFor("/contractor/manufacturing?order=abc", CONTRACTOR_COMPONENTS, off, "contractor")).toBe("manufacturing")
    expect(moduleOffFor("/contractor/rfqs?tab=open", CONTRACTOR_COMPONENTS, off, "contractor")).toBeNull()
    expect(moduleOffFor("/contractor/manufacturing", CONTRACTOR_COMPONENTS, new Set(), "contractor")).toBeNull()
    expect(moduleOffFor("https://example.com/contractor/manufacturing", CONTRACTOR_COMPONENTS, off, "contractor")).toBeNull()
    expect(moduleOffFor(null, CONTRACTOR_COMPONENTS, off, "contractor")).toBeNull()
    expect(moduleOffFor("/contractor/manufacturing", CONTRACTOR_COMPONENTS, off, null)).toBeNull()
  })
})

describe("the approval gates Projects owns", () => {
  const po = {
    id: "po1",
    status: "awaiting_approval",
    projectId: "p1",
    lines: [{ id: "l1", name: "x", unit: "u", quantity: 1, unitPrice: 1, boqItemId: "b1" }],
    pmBudget: { state: "pending", over: 500 },
  } as unknown as Gate
  const items = [{ id: "b1", pmSample: true, pmSub: "sub", description: "tile" }]

  it("block while Project Management is on, and stand down when it is off", () => {
    expect(approvalGateBlocks(po, items, []).map((b) => b.code).sort()).toEqual(["pm_budget_pending", "sample_pending"])
    expect(approvalGateBlocks(po, items, [], true)).toEqual([])
  })
})

describe("what the admin is told before switching a component off", () => {
  it("reads only known keys with positive whole counts", () => {
    const data = {
      hr: [{ key: "exits", count: 2 }, { key: "advances", count: 0 }, { key: "bogus", count: 5 }, { key: "payroll", count: "3" }],
      manufacturing: [{ key: "notes", count: 4.9 }],
      "project-management": "nope",
      other: [{ key: "plant", count: 1 }],
    }
    expect(readPending(data)).toEqual({ hr: [{ key: "exits", count: 2 }], manufacturing: [{ key: "notes", count: 4 }] })
    expect(readPending(null)).toEqual({})
    expect(readPending("x")).toEqual({})
  })

  it("warns only for components this save switches off", () => {
    const pending = readPending({ hr: [{ key: "exits", count: 2 }], manufacturing: [{ key: "requests", count: 1 }] })
    expect(warningsFor(new Set(), new Set(["hr"]), pending)).toEqual([{ module: "hr", items: [{ key: "exits", count: 2 }] }])
    expect(warningsFor(new Set(["hr"]), new Set(["hr"]), pending)).toEqual([])
    expect(warningsFor(new Set(["hr"]), new Set(), pending)).toEqual([])
    expect(warningsFor(new Set(), new Set(["project-management"]), pending)).toEqual([])
  })

  it("has a message for every key it can send", () => {
    const en = jest.requireActual<{ Portal: { AdminModules: Record<string, string> } }>("../../messages/en.json").Portal.AdminModules
    const ar = jest.requireActual<{ Portal: { AdminModules: Record<string, string> } }>("../../messages/ar.json").Portal.AdminModules
    for (const keys of Object.values(PENDING_KEYS)) for (const key of keys) expect([en[`pending_${key}`], ar[`pending_${key}`]].every(Boolean)).toBe(true)
  })
})

describe("a write reads the switch inside its own transaction", () => {
  const db = fakeFirestore as unknown as Firestore
  beforeEach(() => resetFakeDb())

  it("sees what the admin switched off, as the contractor portal's switches only", async () => {
    seed("companyModules/org1", { organizationId: "org1", off: ["project-management", "hr"] })
    const off = await runTransaction(db, (tx) => readModulesOff(tx, db, "org1"))
    expect([...off].sort()).toEqual(["hr", "project-management"])
  })

  it("is everything on for a company nobody switched anything for, or no company", async () => {
    expect((await runTransaction(db, (tx) => readModulesOff(tx, db, "org2"))).size).toBe(0)
    expect((await runTransaction(db, (tx) => readModulesOff(tx, db, null))).size).toBe(0)
  })
})

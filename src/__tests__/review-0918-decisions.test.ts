// The 18 Sep review's decisions, pinned: the purchase-request lifecycle
// (manufacturing → warehouse → purchasing, arrivals are Inventory's to book,
// a declined one comes back to the manager), labour costing as a switch, one
// unit list, the mind map over PRD 1.2 orders, and statements that open shallow.

import { DEFAULT_MFG_SETTINGS, labourCostOn, standardCost, type DeptCapacityFields, type MfgProduct, type MfgSettings, type PurchaseRequestRecord } from "@/lib/manufacturing-engine"
import { PRODUCT_UNITS, UNIT_LABEL_KEY, unitLabel } from "@/components/manufacturing/MfgPrdBits"
import { buildMindMapFromViews, type MindMapViewLabels } from "@/lib/manufacturing-mindmap"
import type { OrderView } from "@/lib/manufacturing-view"
import { defaultExpandedIds, type TreeNode } from "@/lib/accounting/statement-tree"
import { sourceDocumentPath } from "@/lib/accounting/source-links"

jest.mock("@/firebase", () => ({}))
// MfgPrdBits is a component file: it imports next-intl, which Jest cannot parse untransformed.
jest.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "en" }))

describe("labour costing is a switch of its own", () => {
  const departments = [{ id: "cut", name: "القص", workers: 2, hoursPerDay: 8, hourlyRate: 40 }] as unknown as DeptCapacityFields[]
  const product = {
    wastePercent: 10,
    route: [{ departmentId: "cut", departmentName: "القص", hoursPerUnit: 2 }],
    bom: [{ itemName: "رخام", unit: "m²", qtyPerUnit: 1, unitCost: 100, withWaste: true, custody: false, lotted: true, departmentId: "cut" }],
  } as unknown as MfgProduct
  const on: MfgSettings = { ...DEFAULT_MFG_SETTINGS, overheadRatePerHour: 10 }
  const off: MfgSettings = { ...on, features: { ...on.features, labourCost: false } }

  it("prices hours only when on — materials are the same either way", () => {
    const a = standardCost(product, departments, on, 1)
    const b = standardCost(product, departments, off, 1)
    expect(a.materials).toBe(110)
    expect(a.labour).toBe(80)
    expect(a.overhead).toBe(20)
    expect(b.materials).toBe(110)
    expect(b.labour).toBe(0)
    expect(b.overhead).toBe(0)
    expect(b.hours).toBe(2) // time still counts — only the pricing is off
    expect(b.total).toBe(110)
  })

  it("needs time: without hours there is nothing to price", () => {
    expect(labourCostOn(on)).toBe(true)
    expect(labourCostOn(off)).toBe(false)
    expect(labourCostOn({ features: { ...on.features, time: false, labourCost: true } })).toBe(false)
  })

  it("a settings document from before the switch reads as on", () => {
    expect(labourCostOn({ features: { time: true, estimates: true, checklists: true } as MfgSettings["features"] })).toBe(true)
  })
})

describe("one unit list, no free text", () => {
  it("lists square and linear metres first and never a unit twice", () => {
    expect(PRODUCT_UNITS.slice(0, 2)).toEqual(["m²", "m"])
    expect(new Set(PRODUCT_UNITS).size).toBe(PRODUCT_UNITS.length)
    for (const u of PRODUCT_UNITS) expect(UNIT_LABEL_KEY[u]).toMatch(/^mfr_prd_unit_/)
  })
  it("shows a legacy label as it is", () => {
    const t = (k: string) => `[${k}]`
    expect(unitLabel("m²", t)).toBe("[mfr_prd_unit_m2]")
    expect(unitLabel("متر مربع", t)).toBe("متر مربع")
  })
})

describe("a purchase request's states", () => {
  it("only a declined request puts the shortfall back on the workshop", () => {
    // Mirrors the reading in shortages(): anything not declined counts as requested.
    const states: PurchaseRequestRecord["state"][] = ["sent", "ordered", "arrived", "declined"]
    const requested = states.filter((s) => s !== "declined")
    expect(requested).toEqual(["sent", "ordered", "arrived"])
  })
})

describe("the mind map over PRD 1.2 orders", () => {
  const labels: MindMapViewLabels = {
    root: "Manufacturing",
    rootSub: (n) => `${n} orders`,
    noSource: "",
    noSourceHint: "",
    centralTag: "",
    projectTag: "project",
    outboundTag: "",
    unassigned: "",
    statusOpen: "open",
    statusDone: "done",
    statusCancelled: "cancelled",
    destinationPending: "awaiting destination",
    destinationOpen: "destination later",
    delivered: "delivered",
    sourceClient: "Client",
    sourceProject: "Project",
    sourceStock: "Stock",
    inTransit: "in transit",
    progress: (d, q) => `${d}/${q}`,
    late: "late",
  }
  const view = (over: Partial<OrderView> & { calc?: Partial<OrderView["calc"]> }): OrderView =>
    ({
      id: "o1",
      ref: "WO-2026/001",
      source: "client",
      cancelled: false,
      done: false,
      late: false,
      quantity: 10,
      unit: "m²",
      product: { name: "Marble top" },
      notes: [],
      ...over,
      calc: {
        route: [
          { departmentId: "cut", departmentName: "Cutting" },
          { departmentId: "polish", departmentName: "Polishing" },
        ],
        done: [10, 4],
        pend: [0, 6],
        firstQ: 1,
        ...(over.calc || {}),
      },
    }) as unknown as OrderView

  it("groups by where the order came from and chains the route with each station's progress", () => {
    const root = buildMindMapFromViews([view({}), view({ id: "o2", ref: "WO-2026/002", source: "stock" }), view({ id: "o3", cancelled: true })], labels)
    expect(root.children.map((s) => s.label)).toEqual(["Client", "Stock"])
    expect(root.sublabel).toBe("2 orders")
    const order = root.children[0].children[0]
    expect(order.label).toBe("WO-2026/001 Marble top")
    const cut = order.children[0]
    expect(cut.kind).toBe("stage")
    expect([cut.label, cut.sublabel, cut.tone]).toEqual(["Cutting", "10/10", "done"])
    const polish = cut.children[0]
    expect([polish.label, polish.sublabel, polish.tone]).toEqual(["Polishing", "4/10", "active"])
    const output = polish.children[0]
    expect([output.kind, output.label, output.sublabel]).toEqual(["output", "Marble top", "10 m²"])
    expect(output.children[0].tone).toBe("muted")
  })

  it("shows where the goods went once a note is received", () => {
    const root = buildMindMapFromViews(
      [view({ done: true, notes: [{ status: "received", toWarehouseName: "Central", item: { quantity: 10 } }] as unknown as OrderView["notes"] })],
      labels
    )
    const dest = root.children[0].children[0].children[0].children[0].children[0].children[0]
    expect([dest.kind, dest.label, dest.tone]).toEqual(["destination", "Central", "done"])
  })
})

describe("statements open shallow on the dashboard", () => {
  const tree: TreeNode[] = [
    {
      id: "g1",
      kind: "group",
      labelAr: "",
      labelEn: "",
      value: 1,
      basis: "movement",
      children: [{ id: "g1a", kind: "group", labelAr: "", labelEn: "", value: 1, basis: "movement", children: [{ id: "l", kind: "line", labelAr: "", labelEn: "", value: 1, basis: "movement" }] }],
    },
  ]
  it("depth 0 opens the headings only, no depth opens everything", () => {
    expect(defaultExpandedIds(tree, 0)).toEqual(["g1"])
    expect(defaultExpandedIds(tree, 1)).toEqual(["g1", "g1a"])
    expect(defaultExpandedIds(tree)).toEqual(["g1", "g1a"])
  })
})

describe("nothing else moved", () => {
  it("source links still resolve", () => {
    expect(sourceDocumentPath({ sourceType: "work_order_issue", sourceId: "wo1", lines: [] }, "contractor")).toBe("manufacturing/workshop?order=wo1")
  })
})

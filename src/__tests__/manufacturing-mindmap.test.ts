import {
  buildManufacturingMindMap,
  layoutMindMap,
  DEFAULT_MINDMAP_LAYOUT,
  type MindMapLabels,
  type MindMapNode,
  type MindMapWarehouse,
} from "@/lib/manufacturing-mindmap"
import type { WorkOrder, WorkOrderStage } from "@/lib/manufacturing"

const labels: MindMapLabels = {
  root: "التصنيع",
  rootSub: (count) => `أوامر التشغيل: ${count}`,
  noSource: "بدون مصدر",
  noSourceHint: "من عرض سعر",
  centralTag: "مركزي",
  projectTag: "مشروع",
  outboundTag: "توزيع",
  unassigned: "غير مُسند",
  statusOpen: "قيد التصنيع",
  statusDone: "مكتمل",
  statusCancelled: "ملغي",
  destinationPending: "بانتظار الوجهة",
  destinationOpen: "بعد الاكتمال",
  delivered: "تم التسليم",
  inTransit: "بانتظار تأكيد الاستلام",
}

const warehouses: MindMapWarehouse[] = [
  { id: "central", name: "المستودع المركزي", isCentral: true },
  { id: "site", name: "مستودع الموقع", projectId: "p1" },
]

function stage(name: string, status: WorkOrderStage["status"], assignee: string | null = null): WorkOrderStage {
  return {
    departmentId: name,
    departmentName: name,
    assigneeUserId: assignee ? `u-${assignee}` : null,
    assigneeName: assignee,
    status,
    startedAt: null,
    completedAt: null,
    note: null,
  }
}

function order(overrides: Partial<WorkOrder> & { id: string; orderNumber: number }): WorkOrder {
  return {
    organizationId: "org",
    title: `طلب ${overrides.orderNumber}`,
    items: [],
    source: { kind: "manual" },
    status: "open",
    currentStageIndex: 0,
    stages: [stage("التصميم", "in_progress", "أحمد"), stage("القص", "pending")],
    createdByUserId: "u",
    createdByUserName: "u",
    output: { name: "باب حديد", quantity: 4, unit: "قطعة" },
    ...overrides,
  }
}

function chain(node: MindMapNode): MindMapNode[] {
  const out: MindMapNode[] = []
  let cur: MindMapNode | undefined = node
  while (cur) {
    out.push(cur)
    cur = cur.children[0]
  }
  return out
}

describe("buildManufacturingMindMap", () => {
  const orders: WorkOrder[] = [
    order({ id: "a", orderNumber: 3, sourceWarehouseId: "site" }),
    order({ id: "b", orderNumber: 2, sourceWarehouseId: "central" }),
    order({ id: "c", orderNumber: 1, source: { kind: "quotation", quotationNumber: "Q-1" } }),
  ]
  const root = buildManufacturingMindMap(orders, warehouses, labels)

  it("groups orders under their source warehouse, centrals first and stock-less orders last", () => {
    expect(root.kind).toBe("root")
    expect(root.sublabel).toBe("أوامر التشغيل: 3")
    expect(root.children.map((s) => s.label)).toEqual(["المستودع المركزي", "مستودع الموقع", "بدون مصدر"])
    expect(root.children[0].sublabel).toBe("مركزي")
    expect(root.children[1].sublabel).toBe("مشروع")
    expect(root.children[2].tone).toBe("warning")
    expect(root.children[2].children[0].label).toBe("#1 طلب 1")
  })

  it("draws each order as a straight chain: stages → output → destination", () => {
    const orderNode = root.children[0].children[0]
    expect(orderNode.kind).toBe("order")
    expect(orderNode.orderId).toBe("b")
    const kinds = chain(orderNode).map((n) => n.kind)
    expect(kinds).toEqual(["order", "stage", "stage", "output", "destination"])
    const [, design, cut, output, destination] = chain(orderNode)
    expect(design.tone).toBe("active")
    expect(design.sublabel).toBe("أحمد")
    expect(cut.tone).toBe("pending")
    expect(cut.sublabel).toBe("غير مُسند")
    expect(output.label).toBe("باب حديد")
    expect(output.sublabel).toBe("4 قطعة")
    expect(destination.label).toBe("بعد الاكتمال")
    expect(destination.tone).toBe("muted")
    // Every node in the chain opens the same order.
    expect(chain(orderNode).every((n) => n.orderId === "b")).toBe(true)
  })

  it("flags a finished order that has not been delivered anywhere yet", () => {
    const done = order({
      id: "d",
      orderNumber: 5,
      status: "done",
      sourceWarehouseId: "central",
      stages: [stage("التصميم", "done", "أحمد")],
    })
    const tree = buildManufacturingMindMap([done], warehouses, labels)
    const nodes = chain(tree.children[0].children[0])
    expect(nodes[nodes.length - 1]).toMatchObject({ kind: "destination", tone: "warning", label: "بانتظار الوجهة" })
    expect(nodes[nodes.length - 2].tone).toBe("done")
  })

  it("shows where a delivered order landed", () => {
    const delivered = order({
      id: "e",
      orderNumber: 6,
      status: "done",
      sourceWarehouseId: "central",
      stages: [stage("التصميم", "done", "أحمد")],
      deliveredTo: { warehouseId: "out", warehouseName: "مستودع التوزيع", kind: "outbound" },
    })
    const tree = buildManufacturingMindMap([delivered], warehouses, labels)
    const nodes = chain(tree.children[0].children[0])
    expect(nodes[nodes.length - 1]).toMatchObject({ label: "مستودع التوزيع", sublabel: "تم التسليم · توزيع", tone: "done" })
  })

  it("shows a handover the receiving warehouse has not signed for as in transit", () => {
    const handedOver = order({
      id: "g",
      orderNumber: 8,
      status: "done",
      sourceWarehouseId: "central",
      stages: [stage("التصميم", "done", "أحمد")],
      deliveredTo: { warehouseId: "site", warehouseName: "مستودع الموقع", kind: "project" },
      deliveryNoteId: "dn-1",
    })
    const inTransit = chain(buildManufacturingMindMap([handedOver], warehouses, labels).children[0].children[0]).pop()
    expect(inTransit).toMatchObject({ label: "مستودع الموقع", sublabel: "بانتظار تأكيد الاستلام", tone: "pending" })

    const signed = chain(buildManufacturingMindMap([{ ...handedOver, receivedAt: "2026-09-06" }], warehouses, labels).children[0].children[0]).pop()
    expect(signed).toMatchObject({ sublabel: "تم التسليم · مشروع", tone: "done" })
  })

  it("stops a cancelled order at its own node", () => {
    const cancelled = order({ id: "f", orderNumber: 7, status: "cancelled", sourceWarehouseId: "central" })
    const tree = buildManufacturingMindMap([cancelled], warehouses, labels)
    const node = tree.children[0].children[0]
    expect(node.children).toHaveLength(0)
    expect(node.tone).toBe("muted")
    expect(node.sublabel).toBe("ملغي")
  })

  it("renders an empty root when there are no orders", () => {
    const tree = buildManufacturingMindMap([], warehouses, labels)
    expect(tree.children).toHaveLength(0)
    expect(tree.sublabel).toBe("أوامر التشغيل: 0")
  })
})

describe("layoutMindMap", () => {
  const orders: WorkOrder[] = [
    order({ id: "a", orderNumber: 1, sourceWarehouseId: "central" }),
    order({ id: "b", orderNumber: 2, sourceWarehouseId: "central", stages: [stage("x", "in_progress"), stage("y", "pending"), stage("z", "pending")] }),
    order({ id: "c", orderNumber: 3, sourceWarehouseId: "site" }),
  ]
  const layout = layoutMindMap(buildManufacturingMindMap(orders, warehouses, labels))

  it("connects every node except the root to exactly one parent", () => {
    expect(layout.edges).toHaveLength(layout.nodes.length - 1)
    const ids = new Set(layout.nodes.map((n) => n.node.id))
    for (const e of layout.edges) {
      expect(ids.has(e.from)).toBe(true)
      expect(ids.has(e.to)).toBe(true)
    }
  })

  it("never overlaps two nodes in the same column", () => {
    const byDepth = new Map<number, number[]>()
    for (const n of layout.nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) || []), n.y])
    for (const ys of byDepth.values()) {
      const sorted = [...ys].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(DEFAULT_MINDMAP_LAYOUT.nodeHeight + DEFAULT_MINDMAP_LAYOUT.vGap)
      }
    }
  })

  it("centres a parent on its children and grows to the right by depth", () => {
    const byId = new Map(layout.nodes.map((n) => [n.node.id, n]))
    const central = byId.get("source:central")!
    const kids = layout.nodes.filter((n) => n.parentId === "source:central").sort((a, b) => a.y - b.y)
    expect(kids).toHaveLength(2)
    expect(central.y).toBeCloseTo((kids[0].y + kids[1].y) / 2)
    expect(kids[0].x).toBeGreaterThan(central.x)
    // The longest chain (3 stages) sets the total width.
    const deepest = Math.max(...layout.nodes.map((n) => n.depth))
    expect(deepest).toBe(1 + 1 + 3 + 1 + 1)
    const last = layout.nodes.find((n) => n.depth === deepest)!
    expect(layout.width).toBe(last.x + last.width)
    expect(layout.height).toBeGreaterThan(0)
  })

  it("lays out a lone root without dividing by zero", () => {
    const solo = layoutMindMap(buildManufacturingMindMap([], warehouses, labels))
    expect(solo.nodes).toHaveLength(1)
    expect(solo.edges).toHaveLength(0)
    expect(solo.width).toBe(DEFAULT_MINDMAP_LAYOUT.widthFor("root"))
    expect(solo.height).toBe(DEFAULT_MINDMAP_LAYOUT.nodeHeight)
  })
})

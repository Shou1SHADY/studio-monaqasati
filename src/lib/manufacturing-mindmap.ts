// Mind-map projection of the manufacturing workflow — the journey agreed with
// the client drawn as one tree:
//
//   inventory source → work order → department stages → finished output → destination
//
// Pure: no Firestore, no React. The tree builder turns work orders into nodes
// and the layout assigns coordinates, so both are unit-testable and the
// renderer only draws. Coordinates are LTR; the renderer mirrors for RTL.

import { effectiveOutput, type WorkOrder } from "./manufacturing"
import type { OrderView } from "./manufacturing-view"

export type MindMapNodeKind = "root" | "source" | "order" | "stage" | "output" | "destination"

/** Visual state of a node — the renderer maps tones to colours. */
export type MindMapTone = "default" | "done" | "active" | "pending" | "warning" | "muted"

export interface MindMapNode {
  id: string
  kind: MindMapNodeKind
  label: string
  sublabel: string | null
  tone: MindMapTone
  /** The work order this node belongs to — clicking any node of a chain opens the order. */
  orderId: string | null
  children: MindMapNode[]
}

export interface MindMapWarehouse {
  id: string
  name: string
  projectId?: string | null
  isCentral?: boolean
  isOutbound?: boolean
}

/** Localised copy the tree needs. Kept as plain strings so the lib never imports next-intl. */
export interface MindMapLabels {
  root: string
  rootSub: (count: number) => string
  noSource: string
  noSourceHint: string
  centralTag: string
  projectTag: string
  outboundTag: string
  unassigned: string
  statusOpen: string
  statusDone: string
  statusCancelled: string
  destinationPending: string
  destinationOpen: string
  delivered: string
}

const NO_SOURCE = "__none__"

function sourceRank(wh: MindMapWarehouse | undefined, key: string): number {
  if (key === NO_SOURCE) return 3
  if (wh?.isCentral) return 0
  if (wh?.projectId) return 1
  return 2
}

function orderTone(status: WorkOrder["status"]): MindMapTone {
  return status === "done" ? "done" : status === "cancelled" ? "muted" : "active"
}

function stageTone(status: WorkOrder["stages"][number]["status"]): MindMapTone {
  return status === "done" ? "done" : status === "in_progress" ? "active" : "pending"
}

/** One order's chain: stages in sequence, then the output, then where it went. */
function buildOrderChain(order: WorkOrder, labels: MindMapLabels): MindMapNode | null {
  if (order.status === "cancelled") return null

  const out = effectiveOutput(order)
  const destination: MindMapNode = order.deliveredTo
    ? {
        id: `${order.id}:destination`,
        kind: "destination",
        label: order.deliveredTo.warehouseName,
        sublabel: `${labels.delivered} · ${
          order.deliveredTo.kind === "project"
            ? labels.projectTag
            : order.deliveredTo.kind === "outbound"
              ? labels.outboundTag
              : labels.centralTag
        }`,
        tone: "done",
        orderId: order.id,
        children: [],
      }
    : {
        id: `${order.id}:destination`,
        kind: "destination",
        label: order.status === "done" ? labels.destinationPending : labels.destinationOpen,
        sublabel: null,
        tone: order.status === "done" ? "warning" : "muted",
        orderId: order.id,
        children: [],
      }

  const output: MindMapNode = {
    id: `${order.id}:output`,
    kind: "output",
    label: out.name,
    sublabel: `${out.quantity} ${out.unit}`.trim(),
    tone: order.status === "done" ? "done" : "pending",
    orderId: order.id,
    children: [destination],
  }

  // Stages nest one inside the next so the layout draws them as a straight
  // line — a chain, not a fan.
  let head: MindMapNode = output
  for (let i = order.stages.length - 1; i >= 0; i--) {
    const stage = order.stages[i]
    head = {
      id: `${order.id}:stage:${i}`,
      kind: "stage",
      label: stage.departmentName,
      sublabel: stage.assigneeName || labels.unassigned,
      tone: stageTone(stage.status),
      orderId: order.id,
      children: [head],
    }
  }
  return head
}

export function buildManufacturingMindMap(
  orders: WorkOrder[],
  warehouses: MindMapWarehouse[],
  labels: MindMapLabels
): MindMapNode {
  const byId = new Map(warehouses.map((w) => [w.id, w]))
  const groups = new Map<string, WorkOrder[]>()
  for (const order of orders) {
    const key = order.sourceWarehouseId || NO_SOURCE
    const list = groups.get(key)
    if (list) list.push(order)
    else groups.set(key, [order])
  }

  const sources: MindMapNode[] = [...groups.entries()]
    .sort(([a], [b]) => {
      const diff = sourceRank(byId.get(a), a) - sourceRank(byId.get(b), b)
      return diff !== 0 ? diff : a.localeCompare(b)
    })
    .map(([key, list]) => {
      const wh = byId.get(key)
      const isNone = key === NO_SOURCE
      const name = isNone ? labels.noSource : wh?.name || list[0]?.sourceWarehouseName || key
      const tag = isNone
        ? labels.noSourceHint
        : wh?.isCentral
          ? labels.centralTag
          : wh?.projectId
            ? labels.projectTag
            : null
      return {
        id: `source:${key}`,
        kind: "source" as const,
        label: name,
        sublabel: tag,
        tone: isNone ? ("warning" as const) : ("default" as const),
        orderId: null,
        children: list.map((order) => {
          const chain = buildOrderChain(order, labels)
          return {
            id: `order:${order.id}`,
            kind: "order" as const,
            label: `#${order.orderNumber} ${order.title}`,
            sublabel:
              order.status === "done"
                ? labels.statusDone
                : order.status === "cancelled"
                  ? labels.statusCancelled
                  : labels.statusOpen,
            tone: orderTone(order.status),
            orderId: order.id,
            children: chain ? [chain] : [],
          }
        }),
      }
    })

  return {
    id: "root",
    kind: "root",
    label: labels.root,
    sublabel: labels.rootSub(orders.length),
    tone: "default",
    orderId: null,
    children: sources,
  }
}

/** Copy the view-based tree needs beyond `MindMapLabels`. */
export interface MindMapViewLabels extends MindMapLabels {
  sourceClient: string
  sourceProject: string
  sourceStock: string
  inTransit: string
  /** "{done} of {qty}" for a station row. */
  progress: (done: number, qty: number) => string
  late: string
}

/**
 * The same tree over PRD 1.2 orders (product-born, route derived by the
 * engine): source = where the order came from (client · project · stock),
 * order, one node per station of its route with what that station has done,
 * the product, and where the notes went. Cancelled orders are left out.
 */
export function buildMindMapFromViews(views: OrderView[], labels: MindMapViewLabels): MindMapNode {
  const groups = new Map<OrderView["source"], OrderView[]>()
  for (const v of views) {
    if (v.cancelled) continue
    const list = groups.get(v.source)
    if (list) list.push(v)
    else groups.set(v.source, [v])
  }
  const order: OrderView["source"][] = ["client", "project", "stock"]
  const sources: MindMapNode[] = order
    .filter((k) => groups.has(k))
    .map((k) => {
      const list = groups.get(k)!
      return {
        id: `source:${k}`,
        kind: "source" as const,
        label: k === "client" ? labels.sourceClient : k === "project" ? labels.sourceProject : labels.sourceStock,
        sublabel: labels.rootSub(list.length),
        tone: "default" as const,
        orderId: null,
        children: list.map((v) => ({
          id: `order:${v.id}`,
          kind: "order" as const,
          label: `${v.ref} ${v.product.name}`,
          sublabel: v.done ? labels.statusDone : v.late ? labels.late : labels.statusOpen,
          tone: v.done ? ("done" as const) : v.late ? ("warning" as const) : ("active" as const),
          orderId: v.id,
          children: [viewChain(v, labels)],
        })),
      }
    })
  return { id: "root", kind: "root", label: labels.root, sublabel: labels.rootSub(views.filter((v) => !v.cancelled).length), tone: "default", orderId: null, children: sources }
}

function viewChain(v: OrderView, labels: MindMapViewLabels): MindMapNode {
  const received = v.notes.filter((n) => n.status === "received")
  const inTransit = v.notes.some((n) => n.status === "in_transit")
  const destination: MindMapNode = received.length
    ? {
        id: `${v.id}:destination`,
        kind: "destination",
        label: received[received.length - 1].toWarehouseName,
        sublabel: `${labels.delivered} · ${received.reduce((a, n) => a + n.item.quantity, 0)} ${v.unit}`.trim(),
        tone: "done",
        orderId: v.id,
        children: [],
      }
    : inTransit
      ? { id: `${v.id}:destination`, kind: "destination", label: labels.inTransit, sublabel: null, tone: "active", orderId: v.id, children: [] }
      : {
          id: `${v.id}:destination`,
          kind: "destination",
          label: v.done ? labels.destinationPending : labels.destinationOpen,
          sublabel: null,
          tone: v.done ? "warning" : "muted",
          orderId: v.id,
          children: [],
        }
  const output: MindMapNode = {
    id: `${v.id}:output`,
    kind: "output",
    label: v.product.name,
    sublabel: `${v.quantity} ${v.unit}`.trim(),
    tone: v.done ? "done" : "pending",
    orderId: v.id,
    children: [destination],
  }
  let head: MindMapNode = output
  const c = v.calc
  for (let i = c.route.length - 1; i >= 0; i--) {
    const step = c.route[i]
    const done = c.done[i] || 0
    const pend = c.pend[i] || 0
    const tone: MindMapTone = pend <= 0 && done > 0 ? "done" : done > 0 || i === c.firstQ ? "active" : "pending"
    head = {
      id: `${v.id}:stage:${i}`,
      kind: "stage",
      label: step.departmentName,
      sublabel: labels.progress(done, v.quantity),
      tone,
      orderId: v.id,
      children: [head],
    }
  }
  return head
}

// ---------------------------------------------------------------------------
// Layout — a left-to-right tidy tree. Each depth is a column as wide as its
// widest node; leaves take consecutive rows and every parent sits centred on
// its children, so sibling subtrees never overlap.
// ---------------------------------------------------------------------------

export interface MindMapLayoutOptions {
  widthFor: (kind: MindMapNodeKind) => number
  nodeHeight: number
  /** Horizontal gap between columns. */
  hGap: number
  /** Vertical gap between rows. */
  vGap: number
}

export interface PositionedNode {
  node: MindMapNode
  depth: number
  x: number
  y: number
  width: number
  height: number
  parentId: string | null
}

export interface MindMapEdge {
  from: string
  to: string
}

export interface MindMapLayout {
  nodes: PositionedNode[]
  edges: MindMapEdge[]
  width: number
  height: number
}

const NODE_WIDTHS: Record<MindMapNodeKind, number> = {
  root: 176,
  source: 196,
  order: 224,
  stage: 164,
  output: 184,
  destination: 196,
}

export const DEFAULT_MINDMAP_LAYOUT: MindMapLayoutOptions = {
  widthFor: (kind) => NODE_WIDTHS[kind],
  nodeHeight: 56,
  hGap: 56,
  vGap: 16,
}

export function layoutMindMap(root: MindMapNode, opts: MindMapLayoutOptions = DEFAULT_MINDMAP_LAYOUT): MindMapLayout {
  const columnWidth: number[] = []
  const measure = (node: MindMapNode, depth: number) => {
    columnWidth[depth] = Math.max(columnWidth[depth] || 0, opts.widthFor(node.kind))
    node.children.forEach((child) => measure(child, depth + 1))
  }
  measure(root, 0)

  const columnX: number[] = []
  let cursorX = 0
  columnWidth.forEach((w, depth) => {
    columnX[depth] = cursorX
    cursorX += w + opts.hGap
  })
  const width = cursorX - opts.hGap

  const nodes: PositionedNode[] = []
  const edges: MindMapEdge[] = []
  let cursorY = 0
  const place = (node: MindMapNode, depth: number, parentId: string | null): number => {
    let y: number
    if (node.children.length === 0) {
      y = cursorY
      cursorY += opts.nodeHeight + opts.vGap
    } else {
      const ys = node.children.map((child) => place(child, depth + 1, node.id))
      y = (ys[0] + ys[ys.length - 1]) / 2
    }
    nodes.push({
      node,
      depth,
      x: columnX[depth],
      y,
      width: opts.widthFor(node.kind),
      height: opts.nodeHeight,
      parentId,
    })
    if (parentId) edges.push({ from: parentId, to: node.id })
    return y
  }
  place(root, 0, null)

  return { nodes, edges, width, height: Math.max(cursorY - opts.vGap, opts.nodeHeight) }
}

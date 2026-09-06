// Mind-map projection of the manufacturing workflow — the journey agreed with
// the client drawn as one tree:
//
//   inventory source → work order → department stages → finished output → destination
//
// Pure: no Firestore, no React. The tree builder turns work orders into nodes
// and the layout assigns coordinates, so both are unit-testable and the
// renderer only draws. Coordinates are LTR; the renderer mirrors for RTL.

import { effectiveOutput, type WorkOrder } from "./manufacturing"

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
  /** Handed over on a delivery note the receiving warehouse has not signed yet. */
  inTransit: string
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
  // Orders delivered before delivery notes existed landed directly, so only a
  // note without a receipt reads as "in transit".
  const inTransit = !!order.deliveredTo && !!order.deliveryNoteId && !order.receivedAt
  const destination: MindMapNode = order.deliveredTo
    ? {
        id: `${order.id}:destination`,
        kind: "destination",
        label: order.deliveredTo.warehouseName,
        sublabel: inTransit
          ? labels.inTransit
          : `${labels.delivered} · ${
              order.deliveredTo.kind === "project"
                ? labels.projectTag
                : order.deliveredTo.kind === "outbound"
                  ? labels.outboundTag
                  : labels.centralTag
            }`,
        tone: inTransit ? "pending" : "done",
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

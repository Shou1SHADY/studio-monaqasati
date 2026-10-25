// «قادمة» (Procurement 2.0, INC-06): what will reach Incoming soon, read before it arrives — for preparing, never for buying
// (nothing is published before a request's technical approval). Two sources exist in the product:
//   · a project's request still awaiting the project manager's technical approval (`pm` request, status `pending`) — it reaches
//     Incoming the moment it is approved;
//   · a stock item close above its minimum — it becomes a stock need when it reaches the minimum.
// Each can be watched («نبّهني حين يصل»): the server tells the watcher when it lands (`upcoming-watch-server.ts`). Pure.

import { requestOf } from "../pm/supply"
import { pmMrKey } from "./incoming-state"
import { gapQuantity, type ProjectRequestDoc, type StockGapRow } from "./needs"

/** An item is «upcoming» when its stock is within this share above its minimum. */
export const UPCOMING_STOCK_MARGIN = 0.25

export type UpcomingKind = "approval" | "stock"

export interface UpcomingItem {
  /** The key a watch is kept under: the request's own (`pm:{project}:{request}`) or the stock item's (`stock:{warehouse}:{item}`). */
  key: string
  kind: UpcomingKind
  /** «MR 05» for a project's request; null for a stock item. */
  ref: string | null
  /** The project or the warehouse. */
  place: string
  by: string | null
  /** The day it was asked (a request) — «بانتظار الاعتماد منذ …». */
  since: string | null
  lines: Array<{ name: string; unit: string; qty: number }>
  needBy: string | null
  stock: { onHand: number; min: number } | null
}

export const stockWatchKey = (warehouseId: string, itemId: string) => `stock:${warehouseId}:${itemId}`

const WATCH_KEY = /^(pm:[^:\s]{1,128}:[^:\s]{1,128}|stock:[^:\s]{1,128}:[^:\s]{1,128})$/
export const isWatchKey = (key: string): boolean => WATCH_KEY.test(key)

export function upcomingFromProjects(sources: ReadonlyArray<{ project: { id: string; name: string }; requests: ReadonlyArray<ProjectRequestDoc> }>): UpcomingItem[] {
  const out: UpcomingItem[] = []
  for (const { project, requests } of sources) {
    for (const raw of requests) {
      const r = requestOf(raw as unknown as Parameters<typeof requestOf>[0])
      if (!r.pm || r.status !== "pending" || r.withdrawn) continue
      const lines = r.lines.filter((l) => l.name && l.qty > 0).map((l) => ({ name: l.name, unit: l.unit, qty: l.qty }))
      if (!lines.length) continue
      out.push({
        key: pmMrKey(project.id, r.id),
        kind: "approval",
        ref: `MR ${r.id}`,
        place: project.name,
        by: r.requestedByUserName ?? null,
        since: r.day ?? null,
        lines,
        needBy: r.needBy ?? null,
        stock: null,
      })
    }
  }
  return out
}

export function upcomingFromStock(rows: ReadonlyArray<StockGapRow>): UpcomingItem[] {
  const out: UpcomingItem[] = []
  for (const r of rows) {
    const min = r.minStockLevel
    if (typeof min !== "number" || !(min > 0) || !r.name.trim()) continue
    if (!(r.quantity > min) || r.quantity > min * (1 + UPCOMING_STOCK_MARGIN)) continue
    out.push({
      key: stockWatchKey(r.warehouseId, r.id),
      kind: "stock",
      ref: null,
      place: r.warehouseName,
      by: null,
      since: null,
      lines: [{ name: r.name.trim(), unit: r.unit, qty: gapQuantity(r.quantity, min) }],
      needBy: null,
      stock: { onHand: r.quantity, min },
    })
  }
  return out
}

/** Requests awaiting approval first, nearest need date first; then the stock items, the closest to their minimum first. */
export function sortUpcoming(items: ReadonlyArray<UpcomingItem>): UpcomingItem[] {
  const closeness = (i: UpcomingItem) => (i.stock ? (i.stock.onHand - i.stock.min) / i.stock.min : 0)
  return [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "approval" ? -1 : 1) || (a.needBy || "9999").localeCompare(b.needBy || "9999") || closeness(a) - closeness(b))
}

// «قادمة» (Procurement 2.0, INC-06): what will reach Incoming soon, read before it arrives — for preparing, never for buying
// (nothing is published before a request's technical approval). The sources in the product:
//   · a project's request still awaiting the project manager's technical approval (`pm` request, status `pending`) — it reaches
//     Incoming the moment it is approved;
//   · a team «طلب مواد» awaiting approval before Procurement (the optional policy, `team-approval.ts`);
//   · a planned work order whose materials the stores cannot cover (`upcoming-mfg.ts`, with Manufacturing);
//   · a stock item close above its minimum, or whose stock lasts only days at the current issue rate («الرصيد يكفي N أيام») —
//     it becomes a stock need when it reaches the minimum, and is expected within those days.
// Each can be watched («نبّهني حين يصل»): the server tells the watcher when it lands (`upcoming-watch-server.ts`). Pure.

import { requestOf } from "../pm/supply"
import { pmMrKey } from "./incoming-state"
import { gapQuantity, type ProjectRequestDoc, type StockGapRow } from "./needs"

/** An item is «upcoming» when its stock is within this share above its minimum. */
export const UPCOMING_STOCK_MARGIN = 0.25
/** …or when its stock lasts this many days or fewer at the current issue rate. */
export const UPCOMING_COVER_DAYS = 14

export type UpcomingKind = "approval" | "team" | "workorder" | "stock"

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
  /** Days until it is expected to reach Incoming («يُتوقع وصوله خلال N أيام») — a stock item's days of cover. */
  etaDays?: number | null
  /** A stock item: the issue rate per day it was read with. */
  perDay?: number | null
  /** A planned work order: its number and product. */
  workOrder?: { no: string; product: string } | null
  /** A team request awaiting approval: who may approve it. */
  approvers?: string[]
}

export const stockWatchKey = (warehouseId: string, itemId: string) => `stock:${warehouseId}:${itemId}`

export const workOrderWatchKey = (workOrderId: string) => `wo:${workOrderId}`

const WATCH_KEY = /^(pm:[^:\s]{1,128}:[^:\s]{1,128}|stock:[^:\s]{1,128}:[^:\s]{1,128}|wo:[^:\s]{1,128}|team:[^:\s]{1,128})$/
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

/** Whole days the stock above its minimum lasts at `perDay`; null when nothing is being issued. */
export function daysOfCover(onHand: number, min: number, perDay: number | null | undefined): number | null {
  if (!perDay || !(perDay > 0)) return null
  return Math.max(0, Math.floor((onHand - min) / perDay))
}

/** `rateOf(warehouseId, name)` — the item's issue rate per day (`issue-rate.ts`), when it is known. */
export function upcomingFromStock(rows: ReadonlyArray<StockGapRow>, rateOf?: (warehouseId: string, name: string) => number | null): UpcomingItem[] {
  const out: UpcomingItem[] = []
  for (const r of rows) {
    const min = r.minStockLevel
    if (typeof min !== "number" || !(min > 0) || !r.name.trim()) continue
    if (!(r.quantity > min)) continue
    const perDay = rateOf ? rateOf(r.warehouseId, r.name) : null
    const cover = daysOfCover(r.quantity, min, perDay)
    const near = r.quantity <= min * (1 + UPCOMING_STOCK_MARGIN)
    if (!near && !(cover != null && cover <= UPCOMING_COVER_DAYS)) continue
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
      etaDays: cover,
      perDay: perDay ?? null,
    })
  }
  return out
}

const KIND_ORDER: Record<UpcomingKind, number> = { approval: 0, team: 0, workorder: 1, stock: 2 }

/** Requests awaiting approval first, then planned work orders, nearest need date first; then the stock items, the soonest
 * expected (fewest days of cover) and the closest to their minimum first. */
export function sortUpcoming(items: ReadonlyArray<UpcomingItem>): UpcomingItem[] {
  const closeness = (i: UpcomingItem) => (i.stock ? (i.stock.onHand - i.stock.min) / i.stock.min : 0)
  return [...items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.needBy || "9999").localeCompare(b.needBy || "9999") || (a.etaDays ?? 9999) - (b.etaDays ?? 9999) || closeness(a) - closeness(b))
}

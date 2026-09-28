// Inventory's side of the PM project boundary (prototype: "Inventory issues
// what it has from its main stores; Procurement buys the rest" and "the store
// receives the return, and it is free again"). Two acts, both the keeper's:
//
//   · a return from a project store (`projects/{id}/pmStore` move t=ret, st=wait)
//     is confirmed back in the main warehouse it names — the move closes and the
//     quantity lands on that warehouse's matching stock row, in one transaction;
//   · a line of an approved PM material request is answered: issued from a main
//     store (all of what is still owed), partly (the rest is bought), or not at
//     all — with the reason. Only `lines[i].inv` is written; the line stays
//     Procurement's to buy whatever is not issued.
//
// Pure: no Firestore, no React.

import { materialKey } from "../procurement/prices"
import { itemMergeKey } from "../warehouse-transfer"
import { r2, type PmStoreLine, type StoreMove } from "../pm/store"
import { daysBetween, lineOut, type PmMaterialRequest, type ReqInventoryReply, type ReqLine } from "../pm/supply"

export interface DeskProject {
  id: string
  name: string
  no: string | null
}

/** A closed (archived) PM project takes no change from anyone. */
export const projectArchived = (p: { pm?: { lifecycle?: string | null } | null }) => p.pm?.lifecycle === "closed"

// ── Returns ──────────────────────────────────────────────────────────────────

export interface ReturnRow {
  key: string
  projectId: string
  projectName: string
  projectNo: string | null
  storeId: string
  index: number
  material: string
  unit: string
  qty: number
  warehouseId: string | null
  warehouseName: string | null
  on: string
  byName: string | null
  note: string | null
  age: number
}

export const isReturnWaiting = (m: Pick<StoreMove, "t" | "st">) => m.t === "ret" && m.st === "wait"

/** Every return waiting on Inventory across the given projects, oldest first. */
export function pendingReturns(projects: DeskProject[], stores: Record<string, PmStoreLine[]>, today: string): ReturnRow[] {
  const out: ReturnRow[] = []
  for (const p of projects) {
    for (const line of stores[p.id] || []) {
      line.moves.forEach((m, index) => {
        if (!isReturnWaiting(m)) return
        out.push({
          key: `${p.id}:${line.id}:${index}`,
          projectId: p.id,
          projectName: p.name,
          projectNo: p.no,
          storeId: line.id,
          index,
          material: line.name,
          unit: line.unit,
          qty: m.q,
          warehouseId: m.warehouseId ?? null,
          warehouseName: m.warehouseName ?? null,
          on: m.on,
          byName: m.byName ?? null,
          note: m.note ?? null,
          age: Math.max(0, daysBetween(m.on, today)),
        })
      })
    }
  }
  return out.sort((a, b) => b.age - a.age || a.projectName.localeCompare(b.projectName))
}

/** Returns Inventory already confirmed, the latest first. */
export function doneReturns(projects: DeskProject[], stores: Record<string, PmStoreLine[]>, limit: number): Array<ReturnRow & { invOn: string; invByName: string | null }> {
  const out: Array<ReturnRow & { invOn: string; invByName: string | null }> = []
  for (const p of projects) {
    for (const line of stores[p.id] || []) {
      line.moves.forEach((m, index) => {
        if (m.t !== "ret" || m.st !== "done" || !m.invOn) return
        out.push({ key: `${p.id}:${line.id}:${index}`, projectId: p.id, projectName: p.name, projectNo: p.no, storeId: line.id, index, material: line.name, unit: line.unit, qty: m.q, warehouseId: m.warehouseId ?? null, warehouseName: m.warehouseName ?? null, on: m.on, byName: m.byName ?? null, note: m.note ?? null, age: 0, invOn: m.invOn, invByName: m.invByName ?? null })
      })
    }
  }
  return out.sort((a, b) => b.invOn.localeCompare(a.invOn)).slice(0, limit)
}

export interface StockRow {
  id: string
  name?: string | null
  unit?: string | null
  quantity?: number | null
  trackingMode?: string | null
  lot?: string | null
  remnant?: boolean | null
}

const plainRow = (r: StockRow) => Boolean(r.name && r.unit) && r.trackingMode !== "unit" && !r.lot && !r.remnant

/** The warehouse row a material lands on: the same name + unit (Inventory's own
 * merge key), else the same material once Arabic spelling is folded (the key
 * Procurement files prices under). Never a block, a remnant or a unit-tracked
 * row. Null = a new row is opened. */
export function landingRow(rows: StockRow[], name: string, unit: string): StockRow | null {
  const plain = rows.filter(plainRow)
  const exact = itemMergeKey({ name, unit })
  const hit = plain.find((r) => itemMergeKey({ name: r.name as string, unit: r.unit as string }) === exact)
  if (hit) return hit
  const folded = materialKey(name, unit)
  return plain.find((r) => materialKey(r.name, r.unit) === folded) ?? null
}

/** What is on hand of a material in one warehouse (null when it has no row). */
export function onHandOf(rows: StockRow[], name: string, unit: string): number | null {
  const row = landingRow(rows, name, unit)
  return row ? Math.max(0, Number(row.quantity) || 0) : null
}

export type ReturnBlock = "no_permission" | "archived" | "not_waiting" | "no_warehouse" | "other_org"

export function returnBlocks(input: { allowed: boolean; archived: boolean; move: Pick<StoreMove, "t" | "st" | "warehouseId"> | null; warehouseOrg: string | null; projectOrg: string | null }): ReturnBlock[] {
  const out: ReturnBlock[] = []
  if (!input.allowed) out.push("no_permission")
  if (input.archived) out.push("archived")
  if (!input.move || !isReturnWaiting(input.move)) out.push("not_waiting")
  else if (!input.move.warehouseId || input.warehouseOrg === null) out.push("no_warehouse")
  else if (input.warehouseOrg !== input.projectOrg) out.push("other_org")
  return out
}

// ── Inventory's reply on a request line ─────────────────────────────────────

/** Why a quantity is not issued (prototype INVWHY): committed to another
 * project · no stock in the main stores · a direct-supply material, never stocked. */
export const INV_WHY = ["linked", "none", "dir"] as const
export type InvWhy = (typeof INV_WHY)[number]
export type ReplyKind = "issue" | "part" | "none"

/** A line Inventory still has to answer: an approved PM request not yet on an
 * order, the line neither closed, held as a change nor refused, still owed,
 * and not answered before. */
export function awaitingReply(r: Pick<PmMaterialRequest, "pm" | "status" | "withdrawn" | "poId">, l: ReqLine): boolean {
  if (!r.pm || r.status !== "approved" || r.withdrawn || r.poId) return false
  if (l.inv || l.cl || l.chg?.st === "wait" || l.chg?.st === "no") return false
  return lineOut(l) > 0
}

export interface ReplyRow {
  key: string
  projectId: string
  projectName: string
  projectNo: string | null
  requestId: string
  seq: number | null
  index: number
  line: ReqLine
  owed: number
  needBy: string | null
  approvedOn: string | null
  requestedBy: string | null
}

/** Lines waiting on Inventory's reply, the most urgent need-by first. */
export function replyRows(projects: DeskProject[], requests: Record<string, PmMaterialRequest[]>): ReplyRow[] {
  const out: ReplyRow[] = []
  for (const p of projects) {
    for (const r of requests[p.id] || []) {
      r.lines.forEach((l, index) => {
        if (!awaitingReply(r, l)) return
        out.push({
          key: `${p.id}:${r.id}:${index}`,
          projectId: p.id,
          projectName: p.name,
          projectNo: p.no,
          requestId: r.id,
          seq: r.seq ?? null,
          index,
          line: l,
          owed: lineOut(l),
          needBy: r.needBy ?? null,
          approvedOn: r.approvedOn ?? null,
          requestedBy: r.requestedByUserName ?? null,
        })
      })
    }
  }
  return out.sort((a, b) => (a.needBy ?? "9999").localeCompare(b.needBy ?? "9999") || (a.approvedOn ?? "").localeCompare(b.approvedOn ?? ""))
}

export interface ReplyInput {
  kind: ReplyKind
  /** issue: ignored (the whole owed quantity) · part: what is issued · none: ignored. */
  q: number
  why: InvWhy | null
  warehouseId: string | null
  /** Known on-hand of the material in the chosen warehouse; null = not checked. */
  onHand: number | null
}

export type ReplyBlock = "no_permission" | "archived" | "not_waiting" | "bad_qty" | "over_stock" | "no_warehouse" | "no_reason"

/** The quantity issued by a reply. */
export function issuedQty(kind: ReplyKind, q: number, owed: number): number {
  if (kind === "none") return 0
  if (kind === "issue") return owed
  return Number.isFinite(q) ? r2(q) : NaN
}

export function replyBlocks(input: ReplyInput & { allowed: boolean; archived: boolean; request: Pick<PmMaterialRequest, "pm" | "status" | "withdrawn" | "poId">; line: ReqLine | null }): ReplyBlock[] {
  const out: ReplyBlock[] = []
  if (!input.allowed) out.push("no_permission")
  if (input.archived) out.push("archived")
  if (!input.line || !awaitingReply(input.request, input.line)) {
    out.push("not_waiting")
    return out
  }
  const owed = lineOut(input.line)
  const gave = issuedQty(input.kind, input.q, owed)
  if (input.kind === "part" && !(gave > 0 && gave < owed)) out.push("bad_qty")
  if (gave > 0 && !input.warehouseId) out.push("no_warehouse")
  if (gave > 0 && input.onHand !== null && gave > input.onHand + 1e-9) out.push("over_stock")
  if (input.kind !== "issue" && !input.why) out.push("no_reason")
  return out
}

/** The reply as stored on the line. `k` stays issue | none (what the project's
 * screens read); a partial issue is `issue` with `kept` > 0. `why` carries the
 * reason rendered in the keeper's language, `whyK` its code. */
export function buildReply(input: { kind: ReplyKind; q: number; owed: number; why: InvWhy | null; whyText: string | null; warehouseId: string | null; warehouseName: string | null; note: string | null; on: string; by: string; byName: string | null }): ReqInventoryReply {
  const gave = issuedQty(input.kind, input.q, input.owed)
  const kept = r2(Math.max(0, input.owed - gave))
  return {
    k: gave > 0 ? "issue" : "none",
    q: gave,
    kept,
    why: kept > 0 ? input.whyText : null,
    whyK: kept > 0 ? input.why : null,
    warehouseId: gave > 0 ? input.warehouseId : null,
    warehouseName: gave > 0 ? input.warehouseName : null,
    note: input.note?.trim() || null,
    on: input.on,
    by: input.by,
    byName: input.byName,
  }
}

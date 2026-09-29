// PM 1.0 — the module boundary (PRD §11, prototype fileBound). The module
// requests and reads state; it never acts for another module nor mediates
// between two. What it sends Finance is a keyed event in the `pmEvents` outbox
// — resending never posts twice — and this project's sent events are counted
// here, per kind, with the last one's date. Pure: no I/O.

import type { PmEvent, PmEventKind } from "./events"

/** Finance's integration contract, in the order the prototype lists it, plus
 * the signed addendum (AMD-08) the module also sends. */
export const FIN_EVENTS: ReadonlyArray<{ kind: PmEventKind; key: string }> = [
  { kind: "IPC", key: "prj:IPC:<project>:<ipc>" },
  { kind: "SC", key: "prj:SC:<project>:<no>" },
  { kind: "ADV", key: "prj:ADV:<project>" },
  { kind: "BUD", key: "prj:BUD:<project>" },
  { kind: "HND", key: "prj:HND:<project>:<type>" },
  { kind: "AMD", key: "prj:AMD:<project>:<no>" },
]

/** Conflicts with existing modules (prototype XCONF): gaps between what this
 * module sends or owns and what the other modules are built to receive. They
 * need unifying in governance — not ours to fix here. */
export const BOUNDARY_CONFLICTS: ReadonlyArray<{ key: string; module: "payments" | "crm" | "procurement" | "warehouses" | "manufacturing" | "sales" }> = [
  { key: "amd", module: "payments" },
  { key: "ipc_books", module: "payments" },
  { key: "sub_commit", module: "payments" },
  { key: "loss_move", module: "payments" },
  { key: "hnd_units", module: "payments" },
  { key: "crm_creates", module: "crm" },
  { key: "crm_months", module: "crm" },
  { key: "store_twice", module: "warehouses" },
  { key: "prefix", module: "manufacturing" },
]

export interface EventStat {
  kind: PmEventKind
  key: string
  sent: number
  last: string | null
}

export function eventStats(events: Array<Pick<PmEvent, "kind" | "at">>): EventStat[] {
  return FIN_EVENTS.map(({ kind, key }) => {
    const mine = events.filter((e) => e.kind === kind)
    const last = mine.reduce<string | null>((a, e) => (e.at && (!a || e.at > a) ? e.at : a), null)
    return { kind, key, sent: mine.length, last }
  })
}

/** The boundary log: newest first (prototype: 14). */
export const boundaryLog = <T extends Pick<PmEvent, "at">>(events: T[], limit = 14): T[] => [...events].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, limit)

export type InModule = "procurement" | "payments" | "warehouses"
export type InKind = "po" | "collection" | "retention" | "inv_reply" | "return_in"

/** What other modules did for this project, as their own records say — read,
 * never written here: Procurement's orders, Finance's collections and retention
 * releases, Inventory's answers to material requests and returns it took back. */
export interface InEntry {
  id: string
  module: InModule
  kind: InKind
  at: string
  params: Record<string, string | number>
  amount?: number
}

export function incomingEntries(input: {
  pos?: Array<{ id: string; docNumber: string; supplierName: string; status: string; createdAt: string; approvedAt?: string | null; sentAt?: string | null; totalExVat?: number }>
  certificates?: Array<{ seq: number; collections?: Array<{ on: string; amount: number }> | null }>
  /** Finance's retention-release entries, and this project's HND event doc ids they answer. */
  releases?: Array<{ sourceId: string; date: string }>
  hndDocIds?: ReadonlySet<string>
  requests?: Array<{ id: string; seq?: number; title: string; lines: Array<{ name: string; inv?: { k: string; on: string } | null }> }>
  stores?: Array<{ id: string; name: string; unit: string; moves: Array<{ t: string; q: number; invOn?: string | null; warehouseName?: string | null }> }>
}): InEntry[] {
  const out: InEntry[] = []
  for (const po of input.pos ?? []) {
    if (po.status === "awaiting_approval") continue
    out.push({ id: `po:${po.id}`, module: "procurement", kind: "po", at: po.sentAt || po.approvedAt || po.createdAt, params: { no: po.docNumber, supplier: po.supplierName }, amount: po.totalExVat })
  }
  for (const c of input.certificates ?? [])
    (c.collections ?? []).forEach((x, i) => out.push({ id: `col:${c.seq}:${i}`, module: "payments", kind: "collection", at: x.on, params: { no: String(c.seq).padStart(2, "0") }, amount: x.amount }))
  for (const r of input.releases ?? [])
    if (input.hndDocIds?.has(r.sourceId)) out.push({ id: `ret:${r.sourceId}`, module: "payments", kind: "retention", at: r.date, params: { stage: r.sourceId.endsWith("final") ? "final" : "prov" } })
  for (const r of input.requests ?? [])
    r.lines.forEach((l, i) => {
      if (l.inv?.on) out.push({ id: `inv:${r.id}:${i}`, module: "warehouses", kind: "inv_reply", at: l.inv.on, params: { name: l.name, reply: l.inv.k === "issue" ? "issue" : "none" } })
    })
  for (const x of input.stores ?? [])
    x.moves.forEach((m, i) => {
      if (m.t === "ret" && m.invOn) out.push({ id: `rin:${x.id}:${i}`, module: "warehouses", kind: "return_in", at: m.invOn, params: { name: x.name, q: m.q, unit: x.unit, wh: m.warehouseName || "—" } })
    })
  return out
}

export type BoundaryRow = { dir: "out"; at: string; event: PmEvent } | { dir: "in"; at: string; entry: InEntry }

/** Both directions in one log, newest first (prototype: 14). */
export function boundaryRows(events: PmEvent[], incoming: InEntry[], limit = 14): BoundaryRow[] {
  const rows: BoundaryRow[] = [...events.map((event): BoundaryRow => ({ dir: "out", at: event.at ?? "", event })), ...incoming.map((entry): BoundaryRow => ({ dir: "in", at: entry.at ?? "", entry }))]
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

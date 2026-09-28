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
  { kind: "ADVCHG", key: "prj:ADVCHG:<project>:<n>" },
]

/** Conflicts with existing modules (prototype XCONF): gaps between what this
 * module sends or owns and what the other modules are built to receive. They
 * need unifying in governance — not ours to fix here. */
export const BOUNDARY_CONFLICTS: ReadonlyArray<{ key: string; module: "payments" | "crm" | "procurement" | "warehouses" | "manufacturing" | "sales" }> = [
  { key: "amd", module: "payments" },
  { key: "advchg", module: "payments" },
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

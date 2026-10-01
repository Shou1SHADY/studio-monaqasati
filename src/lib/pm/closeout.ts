// PM 1.0 — closeout: one gate, one snapshot (PRD ARC-01, CST-04, CON-04,
// INV-10, INV-21, WF-26). "Close and archive" and "Archive" pass the SAME gate
// — the closeout list plus the open money — and freeze the same final
// snapshot, never recomputed; the project then leaves every live figure and
// accepts no change from anyone. (The first door once skipped the money and
// froze nothing.) Every row blocks — the prototype's closeRows are the archive
// gate (archBlock). Open NCRs, priced variations still undecided, stock left in
// the project store, subcontractor dues (SC-04: any amount certified and not
// paid, or a sub certificate still awaiting approval) and letters with no reply
// all join the list. The store and subcontractor rows appear only when the
// caller passes their facts (the section is on, or something is there). Pure.

import type { Acceptances } from "./acceptance"
import type { CertificateStatus } from "./certificate"
import { isLetterOpen } from "./correspondence"
import { isOpenNcr, ncrCost, type NcrStatus } from "./ncr"
import { isOpenPunch, type PunchStatus } from "./punch"
import { storeBalance, storeLineOf, type PmStoreLine, type StoreItem } from "./store"
import { awaitingSubCertificates, subSummaries, type PmSubcontract, type SubCertStatus } from "./subcontract"
import { pricedPending, type VoStatus } from "./variation"

export type CloseRowKey = "punch" | "ncr" | "store" | "plant" | "prov" | "final" | "unpriced" | "unbilled" | "in_progress" | "overdue" | "retention" | "vo_pending" | "subs" | "corr"

export interface CloseRow {
  key: CloseRowKey
  ok: boolean
  /** A count or an amount for the sentence. */
  n?: number
  /** subs: sub certificates still awaiting approval. */
  m?: number
}

/** The screen that settles each row — the row opens it (prototype `go`). */
export const CLOSE_ROW_TAB: Record<CloseRowKey, string> = {
  punch: "pmQa",
  ncr: "pmQa",
  store: "pmStore",
  plant: "pmSite",
  prov: "pmClose",
  final: "pmClose",
  unpriced: "boq",
  unbilled: "ipc",
  in_progress: "ipc",
  overdue: "ipc",
  retention: "ipc",
  vo_pending: "pmVo",
  subs: "pmSubs",
  corr: "pmCorr",
}

export interface CloseInput {
  hasClient: boolean
  acceptances: Acceptances
  punch: Array<{ status: PunchStatus }>
  /** Non-conformance reports — an open one blocks closing (NCR-01). */
  ncrs?: Array<{ status: NcrStatus }>
  /** Variations — a priced one still undecided is open money (ARC-01). */
  variations?: Array<{ status: VoStatus; value: number; executedPct?: number; billedPct?: number }>
  items: Array<{ rate: number; executed: number; billed: number }>
  cutPool: number
  certificates: Array<{ status: CertificateStatus; net: number; dueOn?: string | null; collected?: number | null }>
  retentionHeld: number
  /** Set by Finance when the retention has been released to us. */
  retentionReleased: boolean
  /** Lines with stock left in the project store; null = the store is not in play. */
  storeLines?: number | null
  /** Plant still on site — not handed back. An archived project accepts no change, so a
   * unit left on it could never be handed back; null = no plant was ever received. */
  plantOnSite?: number | null
  /** Subcontractor dues; null = no subcontracts and the section is off. */
  subs?: { due: number; pending: number } | null
  /** Formal letters — one still open (sent or received, no reply) blocks. */
  letters?: Array<{ status: "out" | "in" | "rep" | "done" }> | null
  today: string
}

const r2 = (n: number) => Math.round(n * 100) / 100
const days = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

/** The closeout list (WF-26): every row must hold for the project to close. */
export function closeoutRows(input: CloseInput): CloseRow[] {
  const open = input.punch.filter(isOpenPunch).length
  const unpricedExecuted = input.items.filter((i) => !(i.rate > 0) && i.executed > 0).length
  const openNcr = (input.ncrs ?? []).filter(isOpenNcr).length
  const rows: CloseRow[] = [
    { key: "punch", ok: open === 0, n: open },
    { key: "ncr", ok: openNcr === 0, n: openNcr },
  ]
  if (input.storeLines != null) rows.push({ key: "store", ok: input.storeLines === 0, n: input.storeLines })
  if (input.plantOnSite != null) rows.push({ key: "plant", ok: input.plantOnSite === 0, n: input.plantOnSite })
  rows.push(
    { key: "prov", ok: Boolean(input.acceptances.prov) },
    { key: "final", ok: Boolean(input.acceptances.final) },
    // Executed but unpriced: closing means giving it up — decided, not slipped past (CON-04).
    { key: "unpriced", ok: unpricedExecuted === 0, n: unpricedExecuted }
  )
  if (input.hasClient) {
    const voUnbilled = (input.variations ?? [])
      .filter((v) => v.status === "appr")
      .reduce((a, v) => a + Math.max(0, (v.executedPct ?? 0) - (v.billedPct ?? 0)) * v.value, 0)
    const unbilled = r2(input.items.reduce((a, i) => a + (i.rate > 0 ? Math.max(0, i.executed - i.billed) * i.rate : 0), 0) + voUnbilled + input.cutPool)
    const inProgress = input.certificates.filter((c) => c.status === "int" || c.status === "sub").length
    const overdue = r2(
      input.certificates
        .filter((c) => (c.status === "appr" || c.status === "part") && c.dueOn && c.dueOn < input.today)
        .reduce((a, c) => a + c.net * (1 - Math.min(1, Math.max(0, c.collected ?? 0))), 0)
    )
    rows.push(
      { key: "unbilled", ok: unbilled <= 1, n: unbilled },
      { key: "in_progress", ok: inProgress === 0, n: inProgress },
      { key: "overdue", ok: overdue <= 1, n: overdue },
      { key: "retention", ok: input.retentionHeld <= 1 || input.retentionReleased, n: input.retentionHeld }
    )
    const pending = pricedPending(input.variations ?? [])
    rows.push({ key: "vo_pending", ok: pending.length === 0, n: pending.length })
  }
  if (input.subs) {
    const due = r2(Math.max(0, input.subs.due))
    rows.push({ key: "subs", ok: due <= 0.5 && input.subs.pending === 0, n: due, m: input.subs.pending })
  }
  if (input.letters) {
    const openLetters = input.letters.filter(isLetterOpen).length
    rows.push({ key: "corr", ok: openLetters === 0, n: openLetters })
  }
  return rows
}

/** SC-04: what is still owed to subcontractors — certified and not paid (each
 * party above half a riyal) — and their certificates still awaiting approval. */
export function subDues(contracts: PmSubcontract[], certificates: Array<{ status: SubCertStatus }>): { due: number; pending: number } {
  const due = subSummaries(contracts).reduce((a, s) => a + (s.due > 0.5 ? s.due : 0), 0)
  return { due: r2(due), pending: awaitingSubCertificates(certificates).length }
}

/** What the project taught, in numbers not opinions — they feed the next bid.
 * Material lost is read from the project-store ledger (`materialLost`). */
export interface Lessons {
  rework: number
  ncrs: number
  obstaclesClosed: number
  /** Average days from opening to closing a closed obstacle; null when none closed. */
  avgResponseDays: number | null
  team: number
}

export function projectLessons(input: {
  /** Each report's cost as it stands: actual at closing, else the plan's, else the first estimate (ncr.ts `ncrCost`). */
  ncrs: Array<Parameters<typeof ncrCost>[0]>
  obstacles: Array<{ openOn: string; closeOn?: string | null }>
  seats: number
}): Lessons {
  const closed = input.obstacles.filter((o) => o.closeOn)
  const spans = closed.map((o) => Math.max(0, days(o.openOn, o.closeOn as string)))
  return {
    rework: r2(input.ncrs.reduce((a, n) => a + ncrCost(n), 0)),
    ncrs: input.ncrs.length,
    obstaclesClosed: closed.length,
    avgResponseDays: spans.length ? Math.round(spans.reduce((a, d) => a + d, 0) / spans.length) : null,
    team: input.seats,
  }
}

export const closeBlocks = (rows: CloseRow[]) => rows.filter((r) => !r.ok)

/** What the project store still holds (prototype `plOf(p).filter(plBal>0.005)`):
 * the PM ledger `projects/{id}/pmStore`, never a company warehouse. The value
 * counts only lines with a known cost. */
export function storeHoldings(lines: PmStoreLine[], items: StoreItem[], costOf?: (x: PmStoreLine) => number | null): { lines: number; value: number } {
  let n = 0
  let value = 0
  for (const x of lines) {
    const bal = storeBalance(x, items)
    if (bal <= 0.005) continue
    n++
    const c = costOf?.(x) ?? null
    if (c != null && c > 0) value += bal * c
  }
  return { lines: n, value: r2(value) }
}

/** Material written off as lost, damaged or stolen and approved, at cost (lessons «ما فُقد من المواد»). */
export function materialLost(lines: PmStoreLine[], costOf: (x: PmStoreLine) => number | null): number {
  return r2(lines.reduce((a, x) => a + x.moves.filter((m) => m.t === "loss" && m.st === "ok").reduce((c, m) => c + m.q * (costOf(x) ?? 0), 0), 0))
}

const numOf = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** A stored BOQ line as the store ledger reads it. */
export const storeItemOf = (id: string, d: Record<string, unknown>): StoreItem => ({
  id,
  code: typeof d.itemNo === "string" ? d.itemNo : "",
  description: "",
  unit: typeof d.unit === "string" ? d.unit : "",
  quantity: numOf(d.quantity),
  executed: numOf(d.executedQuantity),
})

/** A stored store line (`pmStore/{id}`) with its lists defaulted. */
export const storeDocOf = (id: string, d: Record<string, unknown>): PmStoreLine => storeLineOf(id, d as Partial<Omit<PmStoreLine, "id">>)

/** The cost section's roll-up at closing (cost.ts `projectCost`): actual cost to
 * date and what was earned, variations included. */
export interface ClosingCost {
  actual: number
  earned: number
}

/** The final figures, frozen at archive and never recomputed (CST-04). Actual
 * cost and the realised margin (earned − actual, prototype pMargin) come from
 * the cost section; without it they stay null — never an invented number (S-13). */
export interface ArchiveSnapshot {
  contractValue: number
  earned: number
  certified: number
  actualCost?: number | null
  margin?: number | null
  /** Margin ÷ final contract value, in % to one decimal. */
  marginPct?: number | null
  retentionHeld: number
  advanceRecovered: number
  contractDays: number | null
  actualDays: number | null
  delayDays: number | null
  closedOn: string
}


export function archiveSnapshot(input: {
  contractValue: number
  items: Array<{ rate: number; executed: number }>
  certificates: Array<{ status: CertificateStatus; gross: number }>
  retentionHeld: number
  advanceRecovered: number
  durationDays: number | null
  startedAt: string | null
  /** The provisional handover: where the works' duration ends (the defects period after it is not delay). */
  provisionalOn?: string | null
  finalOn: string | null
  today: string
  cost?: ClosingCost | null
}): ArchiveSnapshot {
  const c = input.cost
  // Earned = approved executed × rate (§8), unpriced items earning nothing — and
  // the variations earned with them: the cost section's figure when it is there,
  // so "earned", the margin and what was certified are one and the same base.
  const earned = c ? r2(c.earned) : r2(input.items.reduce((a, i) => a + (i.rate > 0 ? i.executed * i.rate : 0), 0))
  const certified = r2(input.certificates.filter((c) => c.status === "appr" || c.status === "part" || c.status === "paid").reduce((a, c) => a + c.gross, 0))
  // Start → the provisional handover (the prototype's archiveNow). The final
  // acceptance cannot come before the defects period ends, so measuring to it
  // froze every project a year "late".
  const actualDays = input.startedAt ? days(input.startedAt, input.provisionalOn ?? input.finalOn ?? input.today) : null
  const contractDays = input.durationDays ?? null
  const margin = c ? r2(c.earned - c.actual) : null
  return {
    contractValue: input.contractValue,
    earned,
    certified,
    actualCost: c ? r2(c.actual) : null,
    margin,
    marginPct: margin !== null && input.contractValue > 0 ? Math.round((margin / input.contractValue) * 1000) / 10 : null,
    retentionHeld: input.retentionHeld,
    advanceRecovered: input.advanceRecovered,
    contractDays,
    actualDays,
    delayDays: actualDays !== null && contractDays !== null ? Math.max(0, actualDays - contractDays) : null,
    closedOn: input.today,
  }
}

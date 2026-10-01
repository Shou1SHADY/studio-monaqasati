// PM 1.0 — subcontractors (PRD WF-11, WF-12, SC-01…04, STK-03/04). A
// subcontract is owned by the project because its life (progress · certificate
// · retention) happens inside it; its commercial record and bank details stay
// in Finance. Its scope is BOQ lines with his quantity and rate, and a
// certificate never certifies a line beyond what WE measured on it.
//
// Custody: material issued to a subcontractor stays ours until his measured
// work consumes it. book = issued − returned − (theoretical use + allowed
// waste); a count below the book is his waste, recovered from his next
// certificate — never a variation. The gap belongs to the COUNT: the book as of
// that count less what was counted, less what was already recovered against it
// — what is issued or returned afterwards changes what he holds, not his waste.
// A certificate takes recoveries only up to what it can bear (work − retention);
// the rest waits for his next one. Issues, returns and counts are moves on the
// project store ledger (`pmStore`, iss/back/cnt with his party key); his
// theoretical use comes from the store's own rate on each item of his contract.
// Projects that recorded custody before the ledger keep their `pmSubCustody`
// lines, read as they are. Pure: no I/O.

import type { PmKey } from "./access"
import type { PmAttachment } from "./attachments"
import type { PmEvent } from "./events"
import { itemCalc, ratedOn, storeBalance, storeCodes, type PmStoreLine, type StoreItem, type StoreMove } from "./store"

export const PM_SUBCONTRACTS = "pmSubcontracts"
export const PM_SUB_CERTIFICATES = "pmSubCertificates"
export const PM_SUB_CUSTODY = "pmSubCustody"

/** The PRD's default riyal limits (§13): owner unlimited · project manager
 * 75,000 · everyone else none. Settings & Governance will own them. */
export const PM_DEFAULT_APPROVAL_LIMIT = 75000
export const DEFAULT_SUB_RETENTION = 10
export const MAX_SUB_RETENTION = 20
/** Recovery at our supply price; some contracts double it — a per-recovery choice. */
export const RECOVERY_RATE = 1

export const r2 = (n: number) => Math.round(n * 100) / 100
export const subcontractNo = (seq: number) => String(seq).padStart(2, "0")
export const subCertificateNo = (seq: number) => String(seq).padStart(2, "0")
export const custodyNo = (seq: number) => String(seq).padStart(2, "0")

/** The riyal limit that applies to registering a subcontract and approving its certificates. */
export function pmApprovalLimit(ceiling: ReadonlySet<PmKey>): number {
  if (ceiling.has("admin")) return Number.POSITIVE_INFINITY
  if (ceiling.has("approve")) return PM_DEFAULT_APPROVAL_LIMIT
  return 0
}

export interface SubParty {
  name: string
  /** A supplier account on the portal (`users/{id}`, role Supplier), when linked. */
  supplierId?: string | null
}

/** One subcontractor across his contracts: the linked account, else his name as typed. */
export function partyKey(p: SubParty): string {
  if (p.supplierId) return `s:${p.supplierId}`
  return `n:${p.name.trim().replace(/\s+/g, " ").toLowerCase()}`
}

export interface SubcontractLine {
  itemId: string
  code: string | null
  description: string | null
  unit: string | null
  qty: number
  rate: number
  value: number
  /** Certified so far, as a fraction of this line — moves only when a certificate is approved. */
  certified: number
}

export interface PmSubcontract {
  id: string
  seq: number
  party: SubParty
  partyKey: string
  /** Fraction (0.1 = 10%). */
  retention: number
  startOn: string
  endOn: string | null
  note: string | null
  lines: SubcontractLine[]
  value: number
  /** Paid to him — Finance's figure, read here, never written by the project. */
  paid?: number
  /** The signed contract. */
  files?: PmAttachment[]
  by: string
  byName?: string | null
  on: string
}

// ---------------------------------------------------------------------------
// Registration (SC-01)
// ---------------------------------------------------------------------------

/** The quantity of a BOQ line already let to subcontractors. */
export function letQty(contracts: Array<Pick<PmSubcontract, "lines">>, itemId: string): number {
  return r2(contracts.reduce((a, c) => a + c.lines.filter((l) => l.itemId === itemId).reduce((b, l) => b + l.qty, 0), 0))
}

/** What is still free to let on a line (never negative). */
export const freeQty = (itemQty: number, let_: number) => r2(Math.max(0, itemQty - let_))

export type SubcontractBlock = "archived" | "no_party" | "no_lines" | "bad_line" | "over_free" | "bad_retention" | "bad_dates" | "over_limit"

export interface LetLineInput {
  itemId: string
  qty: number
  rate: number
  /** Quantity still free on the BOQ line; null when the line has no quantity. */
  free: number | null
}

export function subcontractBlocks(input: {
  archived: boolean
  partyName: string
  lines: LetLineInput[]
  retentionPct: number
  startOn: string
  endOn: string | null
  limit: number
}): SubcontractBlock[] {
  const out: SubcontractBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.partyName.trim()) out.push("no_party")
  const valid = input.lines.filter((l) => l.qty > 0 && l.rate > 0)
  if (!valid.length) out.push("no_lines")
  if (input.lines.some((l) => !(Number.isFinite(l.qty) && Number.isFinite(l.rate) && l.qty >= 0 && l.rate >= 0))) out.push("bad_line")
  if (input.lines.some((l) => l.free !== null && l.qty > l.free + 0.0005)) out.push("over_free")
  if (!(Number.isFinite(input.retentionPct) && input.retentionPct >= 0 && input.retentionPct <= MAX_SUB_RETENTION)) out.push("bad_retention")
  if (!input.startOn || (input.endOn && input.endOn < input.startOn)) out.push("bad_dates")
  if (subcontractValue(valid) > input.limit) out.push("over_limit")
  return out
}

export const subcontractValue = (lines: Array<{ qty: number; rate: number }>) => r2(lines.reduce((a, l) => a + l.qty * l.rate, 0))

/** His rate against our estimated unit cost for the item, % (positive = above); null without an estimate. */
export const rateVsEstimate = (rate: number, estCost: number) => (estCost > 0 && rate > 0 ? ((rate - estCost) / estCost) * 100 : null)

/** The scope let at his rates against our estimate for the same scope (lines with
 * an estimate only). A positive `diff` eats into the margin; negative adds to it. */
export function subEstimate(lines: Array<{ qty: number; rate: number; estCost: number }>): { estimate: number; value: number; diff: number; known: number } {
  const withEst = lines.filter((l) => l.estCost > 0 && l.qty > 0 && l.rate > 0)
  const estimate = r2(withEst.reduce((a, l) => a + l.qty * l.estCost, 0))
  const value = r2(withEst.reduce((a, l) => a + l.qty * l.rate, 0))
  return { estimate, value, diff: r2(value - estimate), known: withEst.length }
}

// ---------------------------------------------------------------------------
// Certificates (SC-02, SC-03)
// ---------------------------------------------------------------------------

/** The ceiling for a sub's line: what we measured on the BOQ line, over the
 * quantity let to subcontractors on it — never certify a sub beyond our own
 * measurement. A fraction of his line, at most 1. */
export function lineCap(input: { executed: number; itemQty: number; letQty: number }): number {
  const base = Math.max(input.letQty, input.itemQty * 0.01)
  if (!(base > 0)) return 0
  return Math.max(0, Math.min(1, input.executed / base))
}

export const lineKey = (subcontractSeq: number, index: number) => `${subcontractSeq}:${index}`

export interface SubCertLine {
  subcontractSeq: number
  index: number
  itemId: string
  code: string | null
  from: number
  to: number
  lineValue: number
  amount: number
  retentionRate: number
}

export interface SubCertAmounts {
  gross: number
  retention: number
  recovery: number
  net: number
}

export type SubCertBlock = "archived" | "zero" | "over_measured" | "below_certified" | "pending"

export interface PreparedLines {
  lines: SubCertLine[]
  over: string[]
  below: string[]
}

/** The period's lines from the cumulative % typed per line (blank = unchanged). */
export function subCertificateLines(
  contracts: Array<Pick<PmSubcontract, "seq" | "lines" | "retention">>,
  percents: Record<string, number | null | undefined>,
  caps: Record<string, number>
): PreparedLines {
  const out: PreparedLines = { lines: [], over: [], below: [] }
  for (const c of contracts) {
    c.lines.forEach((l, index) => {
      const key = lineKey(c.seq, index)
      const pct = percents[key]
      if (pct === null || pct === undefined || !Number.isFinite(pct)) return
      const to = pct / 100
      if (to > (caps[key] ?? 0) + 0.000005) out.over.push(key)
      if (to < l.certified - 0.000005) out.below.push(key)
      if (to <= l.certified + 0.000005) return
      out.lines.push({
        subcontractSeq: c.seq,
        index,
        itemId: l.itemId,
        code: l.code,
        from: l.certified,
        to,
        lineValue: l.value,
        amount: r2((to - l.certified) * l.value),
        retentionRate: c.retention,
      })
    })
  }
  return out
}

type AmountLine = Pick<SubCertLine, "amount" | "retentionRate">
const grossOf = (lines: AmountLine[]) => r2(lines.reduce((a, l) => a + l.amount, 0))
const retentionOf = (lines: AmountLine[]) => r2(lines.reduce((a, l) => a + l.amount * l.retentionRate, 0))

/** What a certificate can bear in recoveries: its work less its retention, never
 * below zero. Beyond it the net would turn negative — a sum Finance cannot pay,
 * so the certificate would never settle and his dues would never clear (SC-04). */
export const recoveryRoom = (lines: AmountLine[]) => r2(Math.max(0, grossOf(lines) - retentionOf(lines)))

/** Work value this period − retention (each line at its contract's rate) −
 * material recovery (no more than it can bear) = due before VAT, never negative. */
export function subCertificateAmounts(lines: AmountLine[], recovery: number): SubCertAmounts {
  const gross = grossOf(lines)
  const retention = retentionOf(lines)
  const rec = r2(Math.min(Math.max(0, recovery), recoveryRoom(lines)))
  return { gross, retention, recovery: rec, net: r2(gross - retention - rec) }
}

export function subCertBlocks(input: { archived: boolean; gross: number; over: number; below: number; pending: boolean }): SubCertBlock[] {
  const out: SubCertBlock[] = []
  if (input.archived) out.push("archived")
  if (input.pending) out.push("pending")
  if (input.over > 0) out.push("over_measured")
  if (input.below > 0) out.push("below_certified")
  if (!(input.gross > 0)) out.push("zero")
  return out
}

/** int = prepared, awaiting approval · ok = approved, with Finance · void =
 * withdrawn before approval (terminal; its number is never reused). */
export const SUB_CERT_STATUSES = ["int", "ok", "void"] as const
export type SubCertStatus = (typeof SUB_CERT_STATUSES)[number]

export interface SubCertRecovery {
  /** The legacy custody line (`pmSubCustody`); 0 for a recovery on the store ledger. */
  custodySeq: number
  /** The store ledger line the recovery is kept on. */
  storeId?: string
  index: number
  /** What THIS certificate deducts of it — the entry's stamped amount. */
  amount: number
}

/** A recovery as a certificate takes it: `rest` is the part that does not fit
 * and stays awaiting deduction (0 = taken whole). */
export type FittedRecovery = SubCertRecovery & { rest: number }

/** Fit the recoveries awaiting deduction into what the certificate can bear, in
 * the order given: whole while they fit, the one that straddles the room cut in
 * two, everything after it left for his next certificate. */
export function fitRecoveries(due: SubCertRecovery[], room: number): { taken: FittedRecovery[]; carried: number } {
  const taken: FittedRecovery[] = []
  let left = r2(Math.max(0, room))
  let carried = 0
  for (const d of due) {
    const take = r2(Math.min(d.amount, left))
    if (take > 0.005) taken.push({ ...d, amount: take, rest: r2(d.amount - take) })
    left = r2(left - take)
    carried += d.amount - take
  }
  return { taken, carried: r2(carried) }
}

type StampedEntry = { q: number; amount: number; certSeq: number | null }
const q3 = (n: number) => Math.round(n * 1000) / 1000

/** Mark what a certificate took on one custody line's recoveries. An entry cut
 * in two keeps its place with the part taken (stamped) and the remainder is
 * appended, still awaiting — so the indices earlier certificates recorded hold. */
export function stampRecoveries<R extends StampedEntry>(list: R[], picks: Array<Pick<FittedRecovery, "index" | "amount" | "rest">>, certSeq: number): R[] {
  const out = list.slice()
  for (const p of picks) {
    const r = list[p.index]
    if (!r || r.certSeq !== null) continue
    if (p.rest > 0.005) {
      const q = r.amount > 0 ? q3((r.q * p.amount) / r.amount) : 0
      out[p.index] = { ...r, q, amount: p.amount, certSeq }
      out.push({ ...r, q: q3(r.q - q), amount: p.rest, certSeq: null })
    } else out[p.index] = { ...r, certSeq }
  }
  return out
}

/** A withdrawn certificate gives back what it took: available again, as it was. */
export const unstampRecoveries = <R extends StampedEntry>(list: R[], certSeq: number): R[] => list.map((r) => (r.certSeq === certSeq ? { ...r, certSeq: null } : r))

export interface PmSubCertificate extends SubCertAmounts {
  id: string
  seq: number
  party: SubParty
  partyKey: string
  lines: SubCertLine[]
  recoveries: SubCertRecovery[]
  status: SubCertStatus
  prep: string
  prepName?: string | null
  prepOn: string
  appr?: string | null
  apprName?: string | null
  apprOn?: string | null
  /** Approved by its preparer under the company's recorded self-approval. */
  selfApp?: boolean
  voidBy?: string | null
  voidByName?: string | null
  voidOn?: string | null
}

export type SubApproveRefusal = "archived" | "no_duty" | "self_approval" | "over_limit"

/** Why this person may not approve it (null = may): `ipcOk`, within their limit,
 * and not its preparer — unless the company records self-approval (a firm of
 * one, `pmSettings.selfApproval`), the same setting owner certificates use. */
export function subApproveRefusal(input: { archived: boolean; ipcOk: boolean; actorUid: string; prep: string; amount: number; limit: number; selfApproval?: boolean }): SubApproveRefusal | null {
  if (input.archived) return "archived"
  if (!input.ipcOk) return "no_duty"
  if (input.actorUid === input.prep && !input.selfApproval) return "self_approval"
  if (input.amount > input.limit) return "over_limit"
  return null
}

export type SubWithdrawRefusal = "archived" | "no_duty" | "wrong_state"

/** Why this person may not withdraw it (null = may): only before approval, by
 * its preparer (still holding `sub`) or by whoever approves certificates. */
export function subWithdrawRefusal(input: { archived: boolean; status: SubCertStatus; actorUid: string; prep: string; sub: boolean; ipcOk: boolean }): SubWithdrawRefusal | null {
  if (input.archived) return "archived"
  if (!(input.ipcOk || (input.actorUid === input.prep && input.sub))) return "no_duty"
  if (input.status !== "int") return "wrong_state"
  return null
}

/** What Finance receives when a sub certificate is approved (prj:SC). Finance
 * pays it and handles VAT; the project reads the payment back. */
export function subCertificateEvent(input: {
  organizationId: string
  projectId: string
  projectNo: string
  cert: Pick<PmSubCertificate, "seq" | "party" | "gross" | "retention" | "recovery" | "net" | "lines">
  by: string
  at: string
}): PmEvent {
  const no = subCertificateNo(input.cert.seq)
  return {
    key: `prj:SC:${input.projectNo}:${no}`,
    kind: "SC",
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectNo: input.projectNo,
    amount: input.cert.gross,
    params: {
      certificate: no,
      subcontractor: input.cert.party.name,
      supplierId: input.cert.party.supplierId ?? "",
      contracts: [...new Set(input.cert.lines.map((l) => subcontractNo(l.subcontractSeq)))].join(","),
      gross: input.cert.gross,
      retention: input.cert.retention,
      recovery: input.cert.recovery,
      net: input.cert.net,
    },
    by: input.by,
    at: input.at,
  }
}

// ---------------------------------------------------------------------------
// The summary table (per subcontractor, across his contracts)
// ---------------------------------------------------------------------------

export interface SubSummary {
  partyKey: string
  party: SubParty
  value: number
  certified: number
  paid: number
  due: number
  retention: number
  progress: number
  itemIds: string[]
  contracts: number[]
}

export function subSummaries(contracts: PmSubcontract[]): SubSummary[] {
  const by = new Map<string, SubSummary>()
  for (const c of contracts) {
    const s = by.get(c.partyKey) ?? { partyKey: c.partyKey, party: c.party, value: 0, certified: 0, paid: 0, due: 0, retention: 0, progress: 0, itemIds: [], contracts: [] }
    const cert = c.lines.reduce((a, l) => a + l.certified * l.value, 0)
    s.value += c.value
    s.certified += cert
    s.paid += c.paid ?? 0
    s.retention += cert * c.retention
    c.lines.forEach((l) => s.itemIds.push(l.itemId))
    s.contracts.push(c.seq)
    by.set(c.partyKey, s)
  }
  return [...by.values()]
    .map((s) => ({ ...s, value: r2(s.value), certified: r2(s.certified), paid: r2(s.paid), retention: r2(s.retention), due: r2(s.certified - s.paid), progress: s.value > 0 ? s.certified / s.value : 0 }))
    .sort((a, b) => b.value - a.value)
}

export function subTotals(rows: SubSummary[]): { value: number; certified: number; retention: number; share: number } {
  const value = r2(rows.reduce((a, s) => a + s.value, 0))
  const certified = r2(rows.reduce((a, s) => a + s.certified, 0))
  return { value, certified, retention: r2(rows.reduce((a, s) => a + s.retention, 0)), share: value > 0 ? certified / value : 0 }
}

// ---------------------------------------------------------------------------
// Custody and reconciliation (STK-03/04, SC-03)
// ---------------------------------------------------------------------------

export type CustodyMoveKind = "iss" | "back" | "cnt"

export interface CustodyMove {
  t: CustodyMoveKind
  q: number
  day: string
  by: string
  byName?: string | null
  note?: string | null
  /** A return booked by a recovery — an accounting return, not material coming back. */
  recovery?: boolean
}

export interface CustodyRecovery {
  q: number
  rate: number
  double: boolean
  amount: number
  day: string
  by: string
  byName?: string | null
  note?: string | null
  /** The sub certificate it was deducted from; null = awaiting deduction. */
  certSeq: number | null
}

export interface PmSubCustody {
  id: string
  seq: number
  subcontractSeq: number
  party: SubParty
  partyKey: string
  itemId: string
  code: string | null
  material: string
  unit: string
  /** Our supply cost per unit of the material — the recovery rate. */
  unitCost: number
  /** Material per unit of the BOQ line (e.g. 12.5 blocks per m²). */
  perUnit: number
  /** Allowed waste, percent. */
  waste: number
  /** The line's executed quantity when tracking began — earlier work drew no issue from here. */
  executedAtStart: number
  moves: CustodyMove[]
  recoveries: CustodyRecovery[]
  by: string
  on: string
}

export interface CustodyFigures {
  issued: number
  theoretical: number
  allowed: number
  book: number
  count: CustodyMove | null
  gap: number | null
  gapValue: number
}

const sumMoves = (c: Pick<PmSubCustody, "moves">, t: CustodyMoveKind) => r2(c.moves.filter((m) => m.t === t).reduce((a, m) => a + m.q, 0))

/** One custody move in the terms the count needs, whichever book it is kept in. */
type CountedMove = { t: string; q: number; day: string; recovery?: boolean | null }

/** The count the gap is measured from: the latest by date, the later entry on a tie. */
function lastCountAt(moves: CountedMove[]): number {
  let at = -1
  moves.forEach((m, i) => {
    if (m.t === "cnt" && (at < 0 || m.day >= moves[at].day)) at = i
  })
  return at
}

/** What the count found short, still open: his issues less his returns AS OF the
 * count, less what his work entitles him to, less the count — less what was
 * already recovered against it. A move dated after the count (or entered after
 * it on its day) is no part of it: a later issue is material he now holds, not
 * waste, and a recovery booked since has already been charged. His entitlement
 * (`cap`) is today's: the ledger keeps no measurement as of the count. */
function openGap(moves: CountedMove[], cap: number): number | null {
  const at = lastCountAt(moves)
  if (at < 0) return null
  const count = moves[at]
  let issuedThen = 0
  let recovered = 0
  moves.forEach((m, i) => {
    const after = m.day > count.day || (m.day === count.day && i > at)
    if (!after) issuedThen += m.t === "iss" ? m.q : m.t === "back" ? -m.q : 0
    else if (m.t === "back" && m.recovery) recovered += m.q
  })
  return r2(issuedThen - cap - count.q - recovered)
}

/** Issued − returned; theoretical from measured work; allowed waste; the book;
 * the latest count and the open gap to it (positive = short = his waste). */
export function custodyFigures(c: Pick<PmSubCustody, "moves" | "perUnit" | "waste" | "executedAtStart" | "unitCost">, executedNow: number): CustodyFigures {
  const issued = r2(sumMoves(c, "iss") - sumMoves(c, "back"))
  const theoretical = r2(Math.max(0, executedNow - c.executedAtStart) * c.perUnit)
  const allowed = r2((theoretical * c.waste) / 100)
  const book = r2(issued - theoretical - allowed)
  const at = lastCountAt(c.moves)
  const gap = openGap(c.moves, r2(theoretical + allowed))
  const gapValue = gap !== null && gap > 0.005 ? r2(gap * c.unitCost * RECOVERY_RATE) : 0
  return { issued, theoretical, allowed, book, count: at < 0 ? null : c.moves[at], gap, gapValue }
}

export const recoveryAmount = (q: number, rate: number, double: boolean) => r2(q * rate * (double ? 2 : 1))

/** Recoveries recorded against this subcontractor and not yet deducted from a certificate. */
export function recoveryDue(custody: Array<Pick<PmSubCustody, "partyKey" | "recoveries">>, key: string): number {
  return r2(custody.filter((c) => c.partyKey === key).reduce((a, c) => a + c.recoveries.filter((r) => r.certSeq === null).reduce((b, r) => b + r.amount, 0), 0))
}

export type CustodyBlock = "archived" | "no_contract" | "no_item" | "no_material" | "no_unit" | "bad_rate" | "bad_cost" | "bad_waste"

export function custodyBlocks(input: { archived: boolean; contract: boolean; itemInContract: boolean; material: string; unit: string; perUnit: number; unitCost: number; waste: number }): CustodyBlock[] {
  const out: CustodyBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.contract) out.push("no_contract")
  else if (!input.itemInContract) out.push("no_item")
  if (!input.material.trim()) out.push("no_material")
  if (!input.unit.trim()) out.push("no_unit")
  if (!(Number.isFinite(input.perUnit) && input.perUnit > 0)) out.push("bad_rate")
  if (!(Number.isFinite(input.unitCost) && input.unitCost >= 0)) out.push("bad_cost")
  if (!(Number.isFinite(input.waste) && input.waste >= 0 && input.waste <= 100)) out.push("bad_waste")
  return out
}

export type MoveBlock = "archived" | "bad_qty" | "over_return" | "future" | "older_count"

/** A count dated before the one on record would be passed over in silence (the
 * gap is read from the latest) — so it is refused, with the reason. */
const olderCount = (kind: CustodyMoveKind, day: string, lastCount?: string | null) => kind === "cnt" && Boolean(day) && Boolean(lastCount) && day < (lastCount as string)

/** Issue > 0; a return no more than he holds as issued; a count ≥ 0 and not
 * dated before the last count; never dated ahead. */
export function moveBlocks(input: { archived: boolean; kind: CustodyMoveKind; q: number; issued: number; day: string; today: string; lastCount?: string | null }): MoveBlock[] {
  const out: MoveBlock[] = []
  if (input.archived) out.push("archived")
  const okQ = Number.isFinite(input.q) && (input.kind === "cnt" ? input.q >= 0 : input.q > 0)
  if (!okQ) out.push("bad_qty")
  if (okQ && input.kind === "back" && input.q > input.issued + 0.005) out.push("over_return")
  if (!input.day || input.day > input.today) out.push("future")
  else if (olderCount(input.kind, input.day, input.lastCount)) out.push("older_count")
  return out
}

export type RecoveryBlock = "archived" | "bad_qty" | "bad_rate" | "over_gap"

/** A recovery charges him for what a count found short — so never more than the
 * gap still open on that count (`gap`; null = never counted), and never twice. */
export function recoveryBlocks(input: { archived: boolean; q: number; rate: number; gap: number | null }): RecoveryBlock[] {
  const out: RecoveryBlock[] = []
  if (input.archived) out.push("archived")
  const okQ = Number.isFinite(input.q) && input.q > 0
  if (!okQ) out.push("bad_qty")
  if (!(Number.isFinite(input.rate) && input.rate > 0)) out.push("bad_rate")
  if (okQ && input.q > Math.max(0, input.gap ?? 0) + 0.005) out.push("over_gap")
  return out
}

/** Sub certificates awaiting approval — the source of the «…بانتظار اعتمادك» decision. */
export const awaitingSubCertificates = <T extends Pick<PmSubCertificate, "status">>(certs: T[]) => certs.filter((c) => c.status === "int")

// ---------------------------------------------------------------------------
// Custody on the project store ledger (STK-03/04, E-25)
// ---------------------------------------------------------------------------

type ContractScope = Pick<PmSubcontract, "partyKey" | "lines">

/** His share of an item's work: his quantity over everything let on it — the
 * item's executed quantity is split between the subcontractors who hold it. */
export function subShare(contracts: ContractScope[], key: string, itemId: string): number {
  const mine = contracts.filter((c) => c.partyKey === key).reduce((a, c) => a + c.lines.filter((l) => l.itemId === itemId).reduce((b, l) => b + l.qty, 0), 0)
  if (!(mine > 0)) return 0
  const all = letQty(contracts, itemId)
  return all > 0 ? Math.min(1, mine / all) : 0
}

const subMoves = (x: Pick<PmStoreLine, "moves">, t: StoreMove["t"], key: string) => x.moves.filter((m) => m.t === t && m.sub === key)
const subSum = (x: Pick<PmStoreLine, "moves">, t: StoreMove["t"], key: string) => r2(subMoves(x, t, key).reduce((a, m) => a + m.q, 0))

/** The subcontractors this material was ever issued to. */
export const ledgerSubs = (x: Pick<PmStoreLine, "moves">) => [...new Set(x.moves.filter((m) => m.t === "iss" && m.sub).map((m) => m.sub as string))]

export interface LedgerCustody {
  issued: number
  theoretical: number
  allowed: number
  /** theoretical + allowed: what his measured work entitles him to draw so far. */
  cap: number
  book: number
  count: StoreMove | null
  gap: number | null
}

/** One subcontractor's custody of one material: issued − returned against his
 * theoretical use (the store's rate × his share of each item's executed work
 * since tracking began) and its allowed waste; the latest count and the gap
 * still open on it (see `openGap`). */
export function ledgerCustody(x: Pick<PmStoreLine, "moves" | "rates">, items: StoreItem[], contracts: ContractScope[], key: string): LedgerCustody {
  const issued = r2(subSum(x, "iss", key) - subSum(x, "back", key))
  let theoretical = 0
  let allowed = 0
  for (const id of storeCodes(x, items)) {
    const share = subShare(contracts, key, id)
    const rate = ratedOn(x, id)
    if (!share || !rate) continue
    const calc = itemCalc(x, items.find((i) => i.id === id)) * share
    theoretical += calc
    allowed += (calc * rate.w) / 100
  }
  theoretical = r2(theoretical)
  allowed = r2(allowed)
  const cap = r2(theoretical + allowed)
  const book = r2(issued - cap)
  const mine = x.moves.filter((m) => m.sub === key)
  const counted = mine.map((m) => ({ t: m.t, q: m.q, day: m.on, recovery: m.recovery }))
  const at = lastCountAt(counted)
  return { issued, theoretical, allowed, cap, book, count: at < 0 ? null : mine[at], gap: openGap(counted, cap) }
}

/** What the project's engineer holds: the balance less what is in subcontractors' custody. */
export const engineerHold = (x: PmStoreLine, items: StoreItem[], contracts: ContractScope[]) =>
  r2(storeBalance(x, items) - ledgerSubs(x).reduce((a, k) => a + Math.max(0, ledgerCustody(x, items, contracts, k).book), 0))

export interface LedgerCustodyRow extends LedgerCustody {
  storeId: string
  line: PmStoreLine
  partyKey: string
  name: string
  gapValue: number
}

/** The reconciliation rows: every material × subcontractor with an issue or a theoretical use. */
export function ledgerCustodyRows(lines: PmStoreLine[], items: StoreItem[], contracts: Array<ContractScope & Pick<PmSubcontract, "party">>, costOf: (x: PmStoreLine) => number | null): LedgerCustodyRow[] {
  const names = new Map<string, string>()
  for (const c of contracts) names.set(c.partyKey, c.party.name)
  const out: LedgerCustodyRow[] = []
  for (const x of lines) {
    const keys = new Set<string>([...ledgerSubs(x), ...contracts.map((c) => c.partyKey)])
    for (const key of keys) {
      const f = ledgerCustody(x, items, contracts, key)
      if (!f.issued && !f.theoretical && !subMoves(x, "iss", key).length) continue
      const cost = costOf(x) ?? 0
      const name = names.get(key) ?? x.moves.find((m) => m.sub === key && m.subName)?.subName ?? key
      out.push({ ...f, storeId: x.id, line: x, partyKey: key, name, gapValue: f.gap !== null && f.gap > 0.005 ? r2(f.gap * cost * RECOVERY_RATE) : 0 })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.line.name.localeCompare(b.line.name))
}

/** Recoveries on the ledger against this subcontractor, not yet deducted. */
export function ledgerRecoveryDue(lines: Array<Pick<PmStoreLine, "recoveries">>, key: string): number {
  return r2(lines.reduce((a, x) => a + (x.recoveries ?? []).filter((r) => r.sub === key && r.certSeq === null).reduce((b, r) => b + r.amount, 0), 0))
}

export type SubStoreBlock = "archived" | "no_sub" | "bad_qty" | "over_hold" | "over_return" | "over_cap_reason" | "future" | "older_count"

/** An issue: from what the engineer holds, over his entitlement only with a
 * reason (not blocked — the excess is on him); a return: no more than he holds;
 * a count: ≥ 0, not dated before his last count; never dated ahead. */
export function subStoreBlocks(input: {
  archived: boolean
  t: "iss" | "back" | "cnt"
  hasSub: boolean
  q: number
  hold: number
  custody: Pick<LedgerCustody, "issued" | "cap">
  note: string | null
  day: string
  today: string
  /** The day of his latest count on this material, when there is one. */
  lastCount?: string | null
}): SubStoreBlock[] {
  const out: SubStoreBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.hasSub) out.push("no_sub")
  const okQ = Number.isFinite(input.q) && (input.t === "cnt" ? input.q >= 0 : input.q > 0)
  if (!okQ) out.push("bad_qty")
  else if (input.t === "iss") {
    if (input.q > input.hold + 0.005) out.push("over_hold")
    else if (input.q > subIssueLeft(input.custody) + 0.005 && !input.note?.trim()) out.push("over_cap_reason")
  } else if (input.t === "back" && input.q > input.custody.issued + 0.005) out.push("over_return")
  if (!input.day || input.day > input.today) out.push("future")
  else if (olderCount(input.t, input.day, input.lastCount)) out.push("older_count")
  return out
}

/** What he may still draw before exceeding his entitlement. */
export const subIssueLeft = (c: Pick<LedgerCustody, "issued" | "cap">) => r2(c.cap - c.issued)


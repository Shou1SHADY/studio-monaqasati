// PM 1.0 — closeout: one gate, one snapshot (PRD ARC-01, CST-04, CON-04,
// INV-10, INV-21, WF-26). "Close and archive" and "Archive" pass the SAME gate
// — the closeout list plus the open money — and freeze the same final
// snapshot, never recomputed; the project then leaves every live figure and
// accepts no change from anyone. (The first door once skipped the money and
// froze nothing.) Money and custody block; paperwork warns (S-08). Rows the
// module cannot see yet — variations, the project store, subcontractors,
// NCRs — join the list when those sections are built. Pure: no I/O.

import type { Acceptances } from "./acceptance"
import type { CertificateStatus } from "./certificate"
import { isOpenPunch, type PunchStatus } from "./punch"

export type CloseRowKey = "punch" | "prov" | "final" | "unpriced" | "unbilled" | "in_progress" | "overdue" | "retention"

export interface CloseRow {
  key: CloseRowKey
  ok: boolean
  /** A count or an amount for the sentence. */
  n?: number
}

export interface CloseInput {
  hasClient: boolean
  acceptances: Acceptances
  punch: Array<{ status: PunchStatus }>
  items: Array<{ rate: number; executed: number; billed: number }>
  cutPool: number
  certificates: Array<{ status: CertificateStatus; net: number; dueOn?: string | null; collected?: number | null }>
  retentionHeld: number
  /** Set by Finance when the retention has been released to us. */
  retentionReleased: boolean
  today: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** The closeout list (WF-26): every row must hold for the project to close. */
export function closeoutRows(input: CloseInput): CloseRow[] {
  const open = input.punch.filter(isOpenPunch).length
  const unpricedExecuted = input.items.filter((i) => !(i.rate > 0) && i.executed > 0).length
  const rows: CloseRow[] = [
    { key: "punch", ok: open === 0, n: open },
    { key: "prov", ok: Boolean(input.acceptances.prov) },
    { key: "final", ok: Boolean(input.acceptances.final) },
    // Executed but unpriced: closing means giving it up — decided, not slipped past (CON-04).
    { key: "unpriced", ok: unpricedExecuted === 0, n: unpricedExecuted },
  ]
  if (input.hasClient) {
    const unbilled = r2(input.items.reduce((a, i) => a + (i.rate > 0 ? Math.max(0, i.executed - i.billed) * i.rate : 0), 0) + input.cutPool)
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
  }
  return rows
}

export const closeBlocks = (rows: CloseRow[]) => rows.filter((r) => !r.ok)

/** The final figures, frozen at archive and never recomputed (CST-04). Cost and
 * margin wait for the cost section — never an invented number (S-13). */
export interface ArchiveSnapshot {
  contractValue: number
  earned: number
  certified: number
  retentionHeld: number
  advanceRecovered: number
  contractDays: number | null
  actualDays: number | null
  delayDays: number | null
  closedOn: string
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

export function archiveSnapshot(input: {
  contractValue: number
  items: Array<{ rate: number; executed: number }>
  certificates: Array<{ status: CertificateStatus; gross: number }>
  retentionHeld: number
  advanceRecovered: number
  durationDays: number | null
  startedAt: string | null
  finalOn: string | null
  today: string
}): ArchiveSnapshot {
  // Earned = approved executed × rate (§8); unpriced items earn nothing.
  const earned = r2(input.items.reduce((a, i) => a + (i.rate > 0 ? i.executed * i.rate : 0), 0))
  const certified = r2(input.certificates.filter((c) => c.status === "appr" || c.status === "part" || c.status === "paid").reduce((a, c) => a + c.gross, 0))
  const actualDays = input.startedAt ? days(input.startedAt, input.finalOn ?? input.today) : null
  const contractDays = input.durationDays ?? null
  return {
    contractValue: input.contractValue,
    earned,
    certified,
    retentionHeld: input.retentionHeld,
    advanceRecovered: input.advanceRecovered,
    contractDays,
    actualDays,
    delayDays: actualDays !== null && contractDays !== null ? Math.max(0, actualDays - contractDays) : null,
    closedOn: input.today,
  }
}

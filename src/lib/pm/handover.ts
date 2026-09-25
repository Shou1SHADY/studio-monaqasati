// PM 1.0 — the handover from CRM (PRD §9 HO-01…05, WF-01; conflicts 3, 4, 9).
// A signed deal arrives as a FILE in "New projects", addressed to one manager.
// It never creates a project by itself: the project is born when that manager
// accepts it through the three-step wizard. The manager may instead return it
// for completion (naming what is missing out of six) or reassign it with a
// reason. Duration is in days — one unit across modules. Pure: no I/O.

export const PM_HANDOVERS = "pmHandovers"

export const HANDOVER_STATUSES = ["wait", "acc", "ret"] as const
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number]

export const PROJECT_KINDS = ["bld", "infra", "road", "ind", "mep", "mnt", "own"] as const
export type ProjectKind = (typeof PROJECT_KINDS)[number]

/** What a returned file lacks, out of six (HO-03). */
export const HANDOVER_MISSING = ["boq", "dwg", "ctr", "pay", "site", "spec"] as const
export type HandoverMissing = (typeof HANDOVER_MISSING)[number]

/** Why a manager passes a handover on (HO-04); "other" must be stated (S-12). */
export const REASSIGN_REASONS = ["load", "spec", "geo", "clash", "other"] as const
export type ReassignReason = (typeof REASSIGN_REASONS)[number]

export interface HandoverReassign {
  from: string
  to: string
  reason: ReassignReason
  reasonText: string | null
  by: string
  at: string
}

export interface PmHandover {
  id: string
  organizationId: string
  status: HandoverStatus
  /** The manager it is addressed to — the only one who may answer it. */
  to: string
  toName: string | null
  opportunityId: string
  contactId: string | null
  title: string
  clientName: string | null
  clientType: string | null
  kind: ProjectKind | null
  location: string | null
  contractNumber: string | null
  /** Awarded value, SAR excluding VAT; 0 when not fixed. */
  value: number
  /** Contract duration in days; 0 when not fixed. */
  durationDays: number
  /** `YYYY-MM-DD`, or null when the contract is not signed yet. */
  signedOn: string | null
  /** `YYYY-MM-DD` — the contract start. */
  startOn: string | null
  /** Fractions (0.10 = 10%). */
  advance: number | null
  retention: number | null
  note: string | null
  requestedBy: string
  requestedByName: string | null
  createdAt: string
  reassigns?: HandoverReassign[]
  returned?: { missing: HandoverMissing[]; note: string | null; by: string; at: string } | null
  projectId?: string | null
  acceptedAt?: string | null
}

export type AcceptBlock = "no_value" | "no_duration" | "not_signed" | "not_waiting"

/** Accepting a file without a value or a duration means an invented number in
 * every report after it — so those block; everything else is completed later. */
export function acceptBlocks(h: Pick<PmHandover, "value" | "durationDays" | "signedOn" | "status">): AcceptBlock[] {
  const out: AcceptBlock[] = []
  if (h.status !== "wait") out.push("not_waiting")
  if (!(h.value > 0)) out.push("no_value")
  if (!(h.durationDays > 0)) out.push("no_duration")
  if (!h.signedOn) out.push("not_signed")
  return out
}

const dayMs = 86_400_000
const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / dayMs

/** Days a handover has waited, from its creation to `today` (`YYYY-MM-DD`). */
export const handoverAge = (h: Pick<PmHandover, "createdAt">, today: string) => Math.max(0, Math.floor(dayNum(today) - dayNum(h.createdAt)))

/** HO-05: a KPI when the contract starts within three weeks or the file is
 * incomplete; the decision's severity rises with age (red after a week). */
export function handoverFlags(h: PmHandover, today: string): { rush: boolean; incomplete: boolean; severity: "amber" | "red" } {
  const rush = Boolean(h.startOn) && dayNum(h.startOn as string) - dayNum(today) <= 21
  const incomplete = acceptBlocks({ ...h, status: "wait" }).length > 0
  return { rush, incomplete, severity: handoverAge(h, today) > 7 ? "red" : "amber" }
}

export type ReassignBlock = "same_manager" | "reason_text"

export function reassignBlocks(h: Pick<PmHandover, "to">, to: string, reason: ReassignReason, reasonText: string | null | undefined): ReassignBlock[] {
  const out: ReassignBlock[] = []
  if (!to || to === h.to) out.push("same_manager")
  if (reason === "other" && !reasonText?.trim()) out.push("reason_text")
  return out
}

/** A return must name at least one missing item. */
export const returnBlocks = (missing: HandoverMissing[]) => (missing.length ? [] : (["nothing_missing"] as const))

/** Which kinds are internal work — nobody pays, so no certificates (TRM-01). */
export const isSelfDevelopment = (kind: ProjectKind | null) => kind === "own"

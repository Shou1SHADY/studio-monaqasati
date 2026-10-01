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
  /** The stated reason for "other", or the optional note for the next manager. */
  reasonText: string | null
  by: string
  at: string
}

/** A priced line of the winning bid, when CRM attaches it to the file. */
export interface HandoverBoqLine {
  code: string
  descriptionAr: string
  descriptionEn?: string | null
  unit: string
  quantity: number
  rate: number
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
  /** The winning bid's priced BOQ, transferred as it is on acceptance. */
  boq?: HandoverBoqLine[] | null
  projectId?: string | null
  acceptedAt?: string | null
  acceptedBy?: string | null
  acceptNote?: string | null
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
 * incomplete; the decision is red after a week, or when the contract starts within three weeks. */
export function handoverFlags(h: PmHandover, today: string): { rush: boolean; incomplete: boolean; severity: "amber" | "red" } {
  const rush = Boolean(h.startOn) && dayNum(h.startOn as string) - dayNum(today) <= 21
  const incomplete = acceptBlocks({ ...h, status: "wait" }).length > 0
  return { rush, incomplete, severity: handoverAge(h, today) > 7 || rush ? "red" : "amber" }
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

/** The addressed manager answers a file; the owner may act on any of them. */
export const mayActOnHandover = (actor: { uid: string; owner: boolean }, h: Pick<PmHandover, "to">) => actor.owner || h.to === actor.uid

export const handoverBoqCount = (h: Pick<PmHandover, "boq">) => (h.boq ?? []).filter((l) => l.quantity > 0).length

/** What the system already sees missing from a file — offered first when returning it. */
export const detectedGaps = (h: Pick<PmHandover, "value" | "durationDays" | "signedOn">) => acceptBlocks({ ...h, status: "wait" })

/** Returned files still waiting on CRM: a file CRM has sent again (same deal,
 * created later) is no longer "returned" — the new one speaks for it. */
export function openReturns<H extends Pick<PmHandover, "id" | "status" | "opportunityId" | "createdAt">>(files: H[]): H[] {
  return files.filter((h) => h.status === "ret" && !files.some((x) => x.id !== h.id && x.opportunityId === h.opportunityId && x.createdAt > h.createdAt))
}

export interface InboxKpis {
  waiting: number
  oldest: number
  rush: number
  incomplete: number
}

export function inboxKpis(files: PmHandover[], today: string): InboxKpis {
  return {
    waiting: files.length,
    oldest: files.reduce((a, h) => Math.max(a, handoverAge(h, today)), 0),
    rush: files.filter((h) => handoverFlags(h, today).rush).length,
    incomplete: files.filter((h) => handoverFlags(h, today).incomplete).length,
  }
}

/** Where the new project's BOQ comes from (the wizard's third step). */
export const BOQ_SOURCES = ["crm", "xl", "man", "later"] as const
export type BoqSource = (typeof BOQ_SOURCES)[number]

export const boqSourcesFor = (h: Pick<PmHandover, "boq">): BoqSource[] => (handoverBoqCount(h) > 0 ? ["crm", "xl", "man", "later"] : ["xl", "man", "later"])

export type AcceptStepBlock = "no_boq_source" | "no_manager" | "no_boq_file" | "boq_bad_rows" | "boq_nothing_read" | "boq_no_lines"

/** Saving waits for a named manager and a chosen BOQ source; an Excel source needs its
 * file. The lines are edited in the wizard, so a row with an error is corrected there —
 * never saved in part (the contract value and every progress % would sit on what was left). */
export function acceptStepBlocks(input: { source: BoqSource | null; managerUid: string | null; xlItems: number; xlBad?: number; xlLoaded?: boolean }): AcceptStepBlock[] {
  const out: AcceptStepBlock[] = []
  if (!input.managerUid) out.push("no_manager")
  if (!input.source) out.push("no_boq_source")
  if (input.source === "xl") {
    if ((input.xlBad ?? 0) > 0) out.push("boq_bad_rows")
    else if (input.xlItems === 0) out.push(input.xlLoaded ? "boq_nothing_read" : "no_boq_file")
  } else if (input.source === "crm" || input.source === "man") {
    if ((input.xlBad ?? 0) > 0) out.push("boq_bad_rows")
    else if (input.xlItems === 0) out.push("boq_no_lines")
  }
  return out
}

/** A candidate for a handover: someone who may approve (a project manager or the
 * owner), with the live projects they already manage — the load a reassignment weighs. */
export interface HandoverCandidate {
  uid: string
  name: string
  seat: "owner" | "pm"
  limit: number
  live: number
}

export function handoverCandidates(
  members: Array<{ uid: string; name: string; approves: boolean; owner: boolean; limit: number }>,
  projects: Array<{ managerId: string | null; lifecycle: string }>,
  exclude?: string | null
): HandoverCandidate[] {
  return members
    .filter((m) => m.approves && m.uid !== exclude)
    .map((m) => ({ uid: m.uid, name: m.name, seat: m.owner ? ("owner" as const) : ("pm" as const), limit: m.limit, live: projects.filter((p) => p.managerId === m.uid && p.lifecycle === "live").length }))
    .sort((a, b) => a.live - b.live || a.name.localeCompare(b.name))
}

/** Which kinds are internal work — nobody pays, so no certificates (TRM-01). */
export const isSelfDevelopment = (kind: ProjectKind | null) => kind === "own"

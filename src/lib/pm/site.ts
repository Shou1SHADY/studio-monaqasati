// PM 1.0 — the site (WF-19 DLY-01 · OBS-01, WF-20 HSE-01): the daily report,
// obstacles and RFIs with the time their answer takes, and safety (incidents
// and work permits). The site record is what a dispute falls back on, so none
// of it is ever deleted: a daily report is one per day and never rewritten, an
// obstacle is closed not removed, and every chase is dated and signed — the
// evidence a claim later cites. RFIs and other obstacles are numbered apart
// (RFI-07 · مع-02), as the prototype numbers them. PM 1.1: a daily report's
// obstacle becomes an obstacle record (DLY-01); an RFI names who owes the answer
// and answer times are averaged per party (OBS-01); permits have a kind, close
// early, and an activity needs one of its kind valid on its start day (HSE-01).
// Pure: no I/O.

/** `projects/{id}/pmDaily/{YYYY-MM-DD}` — the day is the id: one report a day. */
export const PM_DAILY = "pmDaily"
/** `projects/{id}/pmObstacles/{rfi|obs}-{NN}`, numbered by `pm.rfiCount` / `pm.obstacleCount`. */
export const PM_OBSTACLES = "pmObstacles"
/** `projects/{id}/pmIncidents/{NN}`, numbered by `pm.incidentCount`. */
export const PM_INCIDENTS = "pmIncidents"
/** `projects/{id}/pmPermits/{NN}`, numbered by `pm.permitCount`. */
export const PM_PERMITS = "pmPermits"

export interface SiteFile {
  url: string
  name: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Whole days from `from` to `to` (both `YYYY-MM-DD`), never negative. */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000))
}

const count = (n: number) => Number.isInteger(n) && n >= 0

// ---------------------------------------------------------------------------
// The daily report (DLY-01): labour · plant · done · obstacle · files (optional).
// ---------------------------------------------------------------------------

export interface PmDaily {
  id: string
  day: string
  labour: number
  plant: number
  done: string
  /** What stopped work today, in the engineer's words — empty when nothing did. */
  obstacle?: string | null
  /** DLY-01 (1.1): the obstacle record that text became (`pmObstacles/obs-NN`), when it was logged. */
  obsId?: string | null
  files?: SiteFile[]
  by: string
  byName?: string | null
}

export type DailyBlock = "archived" | "no_done" | "bad_count" | "already_filed"

export function dailyBlocks(input: { archived: boolean; done: string; labour: number; plant: number; filed: boolean }): DailyBlock[] {
  const out: DailyBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.done.trim()) out.push("no_done")
  if (!count(input.labour) || !count(input.plant)) out.push("bad_count")
  if (input.filed) out.push("already_filed")
  return out
}

/** Newest first. */
export const sortDaily = <T extends Pick<PmDaily, "day">>(reports: T[]) => reports.slice().sort((a, b) => b.day.localeCompare(a.day))

/** The average workforce over the reports shown, rounded; null with none. */
export function averageLabour(reports: Pick<PmDaily, "labour">[]): number | null {
  if (!reports.length) return null
  return Math.round(reports.reduce((a, r) => a + (r.labour || 0), 0) / reports.length)
}

// ---------------------------------------------------------------------------
// Obstacles and RFIs (OBS-01): to whom · which items they block · impact;
// the response time runs from opening to closing.
// ---------------------------------------------------------------------------

export const OBSTACLE_TYPES = ["rfi", "obs"] as const
export type ObstacleType = (typeof OBSTACLE_TYPES)[number]

/** Who owes the answer. `none` = nobody (a power cut): no one to claim against. */
export const OBSTACLE_PARTIES = ["consultant", "client", "authority", "other", "none"] as const
export type ObstacleParty = (typeof OBSTACLE_PARTIES)[number]

export interface ObstacleChase {
  on: string
  by: string
  byName?: string | null
}

export interface PmObstacle {
  id: string
  type: ObstacleType
  seq: number
  title: string
  party: ObstacleParty
  /** The party's name (the consultant's office…) — required for `other`. */
  partyName?: string | null
  /** BOQ lines it stops, with their codes as they read when it was opened. */
  itemIds: string[]
  codes?: string[]
  impact: string
  openOn: string
  closeOn?: string | null
  answer?: string | null
  closedBy?: string | null
  closedByName?: string | null
  chases?: ObstacleChase[]
  /** Photos or a letter at opening, and the answer's document at closing — optional (1.1 OBS-01). */
  files?: SiteFile[]
  closeFiles?: SiteFile[]
  /** Logged from a daily report (DLY-01): the report's day. */
  src?: { daily: string } | null
  by: string
  byName?: string | null
}

export const COUNTER_OF: Record<ObstacleType, "rfiCount" | "obstacleCount"> = { rfi: "rfiCount", obs: "obstacleCount" }

export const obstacleSeq = (seq: number) => String(seq).padStart(2, "0")
/** The document id: `rfi-07`, `obs-02`. */
export const obstacleId = (type: ObstacleType, seq: number) => `${type}-${obstacleSeq(seq)}`

export const isOpenObstacle = (o: Pick<PmObstacle, "closeOn">) => !o.closeOn

/** Days open so far, or the days it took when closed (OBS-01's response time). */
export const obstacleDays = (o: Pick<PmObstacle, "openOn" | "closeOn">, today: string) => daysBetween(o.openOn, o.closeOn || today)

/** The prototype's colour: closed = ok, open more than 10 days = red, else waiting. */
export const obstacleTone = (o: Pick<PmObstacle, "openOn" | "closeOn">, today: string): "ok" | "late" | "wait" =>
  o.closeOn ? "ok" : obstacleDays(o, today) > 10 ? "late" : "wait"

/** A claim needs someone to claim against. */
export const claimable = (o: Pick<PmObstacle, "party" | "closeOn">) => !o.closeOn && o.party !== "none"

/** Open first (oldest first — the longest wait on top), then closed, newest first. */
export function sortObstacles<T extends Pick<PmObstacle, "openOn" | "closeOn">>(list: T[]): T[] {
  return list.slice().sort((a, b) => Number(Boolean(a.closeOn)) - Number(Boolean(b.closeOn)) || (a.closeOn ? (b.closeOn ?? "").localeCompare(a.closeOn) : a.openOn.localeCompare(b.openOn)))
}

export type ObstacleBlock = "archived" | "no_type" | "no_title" | "no_impact" | "no_party" | "no_party_name" | "rfi_party" | "open_date" | "bad_item"

export function obstacleBlocks(input: {
  archived: boolean
  type: unknown
  title: string
  party: unknown
  partyName: string
  impact: string
  openOn: string
  itemIds: string[]
  knownItems: ReadonlySet<string>
  today: string
}): ObstacleBlock[] {
  const out: ObstacleBlock[] = []
  if (input.archived) out.push("archived")
  if (!(OBSTACLE_TYPES as readonly unknown[]).includes(input.type)) out.push("no_type")
  if (!input.title.trim()) out.push("no_title")
  if (!input.impact.trim()) out.push("no_impact")
  if (!(OBSTACLE_PARTIES as readonly unknown[]).includes(input.party)) out.push("no_party")
  else if (input.party === "other" && !input.partyName.trim()) out.push("no_party_name")
  // OBS-01 (1.1): an RFI is a question put to someone — it always names who owes the answer.
  else if (input.type === "rfi" && input.party === "none") out.push("rfi_party")
  if (!DAY.test(input.openOn) || input.openOn > input.today) out.push("open_date")
  if (input.itemIds.some((id) => !input.knownItems.has(id))) out.push("bad_item")
  return out
}

export type ObstacleStepBlock = "archived" | "closed" | "close_date"

export function chaseBlocks(input: { archived: boolean; closeOn?: string | null }): ObstacleStepBlock[] {
  const out: ObstacleStepBlock[] = []
  if (input.archived) out.push("archived")
  if (input.closeOn) out.push("closed")
  return out
}

/** Closed on the day the answer came — not before it was opened, never in the future. */
export function closeObstacleBlocks(input: { archived: boolean; openOn: string; closeOn?: string | null; on: string; today: string }): ObstacleStepBlock[] {
  const out: ObstacleStepBlock[] = []
  if (input.archived) out.push("archived")
  if (input.closeOn) out.push("closed")
  if (!DAY.test(input.on) || input.on < input.openOn || input.on > input.today) out.push("close_date")
  return out
}

/** The obstacle a daily report's text becomes (DLY-01, 1.1): an obstacle (not an
 * RFI) opened on the report's day, owed by nobody until someone says otherwise,
 * stopping no line — the engineer's words as its subject. */
export function obstacleFromDaily(text: string, day: string): Pick<PmObstacle, "type" | "title" | "party" | "partyName" | "itemIds" | "codes" | "impact" | "openOn" | "src"> {
  return { type: "obs", title: text.trim(), party: "none", partyName: null, itemIds: [], codes: [], impact: "—", openOn: day, src: { daily: day } }
}

export interface ReplyStat {
  party: ObstacleParty
  partyName: string | null
  n: number
  avg: number
}

/** OBS-01 / CST-04 (1.1): how long answers take — the average days from opening
 * to closing over the closed obstacles and RFIs that were put to someone (one owed
 * by nobody has no "reply"), overall and per party (an "other" party by its name).
 * Kept to one decimal; null overall when none is closed. */
export function replyStats(list: Array<Pick<PmObstacle, "party" | "partyName" | "openOn" | "closeOn">>): { avg: number | null; n: number; byParty: ReplyStat[] } {
  const done = list.filter((o) => o.closeOn && o.party !== "none")
  const r1 = (n: number) => Math.round(n * 10) / 10
  const groups = new Map<string, { party: ObstacleParty; partyName: string | null; n: number; sum: number }>()
  for (const o of done) {
    const name = o.party === "other" ? o.partyName?.trim() || null : null
    const key = `${o.party}|${name ?? ""}`
    const g = groups.get(key) ?? { party: o.party, partyName: name, n: 0, sum: 0 }
    g.n += 1
    g.sum += daysBetween(o.openOn, o.closeOn as string)
    groups.set(key, g)
  }
  const total = [...groups.values()].reduce((a, g) => a + g.sum, 0)
  return {
    avg: done.length ? r1(total / done.length) : null,
    n: done.length,
    byParty: [...groups.values()].map((g) => ({ party: g.party, partyName: g.partyName, n: g.n, avg: r1(g.sum / g.n) })).sort((a, b) => b.avg - a.avg),
  }
}

/** Open obstacles that stop at least one BOQ line — a decision (the prototype's `rfi`). */
export const blockingObstacles = <T extends Pick<PmObstacle, "closeOn" | "itemIds">>(list: T[]) => list.filter((o) => !o.closeOn && o.itemIds.length > 0)

/** An RFI that has stopped a line for 10 days or more with no claim linked to it
 * (the prototype's `clm` decision 13): the notice period is running. */
export function unprotectedObstacles<T extends Pick<PmObstacle, "id" | "type" | "closeOn" | "itemIds" | "openOn">>(list: T[], claims: Array<{ obstacleId?: string | null }>, today: string): T[] {
  const covered = new Set(claims.map((c) => c.obstacleId).filter(Boolean))
  return list.filter((o) => o.type === "rfi" && !o.closeOn && o.itemIds.length > 0 && daysBetween(o.openOn, today) >= 10 && !covered.has(o.id))
}

export interface ClaimSeed {
  obstacleId: string
  cause: string
  eventOn: string
  causedBy: "client" | "consultant" | "other"
}

/** What a claim drafted from an obstacle starts with (the prototype's `clmobs`). */
export function claimSeed(o: Pick<PmObstacle, "id" | "title" | "openOn" | "party">): ClaimSeed {
  return { obstacleId: o.id, cause: o.title, eventOn: o.openOn, causedBy: o.party === "client" ? "client" : o.party === "consultant" ? "consultant" : "other" }
}

// ---------------------------------------------------------------------------
// Safety (HSE-01): incidents with their type, lost days and action; permits
// with their periods. An expired permit is worse than none: someone thinks it
// is valid.
// ---------------------------------------------------------------------------

export const INCIDENT_TYPES = ["near", "fa", "lti", "prop"] as const
export type IncidentType = (typeof INCIDENT_TYPES)[number]

export interface PmIncident {
  id: string
  seq: number
  type: IncidentType
  what: string
  action: string
  day: string
  /** Lost work days — only a lost-time injury has them. */
  lostDays: number
  files?: SiteFile[]
  by: string
  byName?: string | null
}

export const incidentNo = (seq: number) => String(seq).padStart(2, "0")

export type IncidentBlock = "archived" | "no_type" | "no_what" | "no_action" | "bad_date" | "bad_days"

export function incidentBlocks(input: { archived: boolean; type: unknown; what: string; action: string; day: string; lostDays: number; today: string }): IncidentBlock[] {
  const out: IncidentBlock[] = []
  if (input.archived) out.push("archived")
  if (!(INCIDENT_TYPES as readonly unknown[]).includes(input.type)) out.push("no_type")
  if (!input.what.trim()) out.push("no_what")
  if (!input.action.trim()) out.push("no_action")
  if (!DAY.test(input.day) || input.day > input.today) out.push("bad_date")
  if (!count(input.lostDays) || (input.type !== "lti" && input.lostDays > 0)) out.push("bad_days")
  return out
}

/** Newest first. */
export const sortIncidents = <T extends Pick<PmIncident, "day" | "seq">>(list: T[]) => list.slice().sort((a, b) => b.day.localeCompare(a.day) || b.seq - a.seq)

/** Days since the last lost-time injury; with none, since the project started
 * (`fromLti` false), or null before it has. */
export function daysSinceLti(incidents: Pick<PmIncident, "type" | "day">[], startOn: string | null, today: string): { days: number; fromLti: boolean } | null {
  const last = incidents.filter((i) => i.type === "lti").reduce<string | null>((m, i) => (!m || i.day > m ? i.day : m), null)
  if (last) return { days: daysBetween(last, today), fromLti: true }
  return startOn ? { days: daysBetween(startOn, today), fromLti: false } : null
}

/** Lost work days: they count in the delay and nobody reimburses them. */
export const lostDays = (incidents: Pick<PmIncident, "lostDays">[]) => incidents.reduce((a, i) => a + (i.lostDays || 0), 0)

/** HSE-01 (1.1): what kind of work the permit allows — an activity that needs a
 * kind is ready only with a permit of THAT kind. "oth" is stated (RSN-01). */
export const PERMIT_TYPES = ["hot", "height", "exc", "conf", "elec", "lift", "oth"] as const
export type PermitType = (typeof PERMIT_TYPES)[number]
export const isPermitType = (v: unknown): v is PermitType => (PERMIT_TYPES as readonly unknown[]).includes(v)

export interface PmPermit {
  id: string
  seq: number
  /** The kind of work (1.1). A permit issued before kinds existed has none. */
  k?: PermitType | null
  /** The kind in words when it is "oth". */
  kText?: string | null
  title: string
  /** Where on site (optional). */
  where?: string | null
  /** Who works under it: our crew, a subcontractor. */
  who: string
  from: string
  to: string
  /** Closed early (HSE-01): from this day no activity relies on it. Written by the server (`/api/pm/permit-close`). */
  closedOn?: string | null
  closedBy?: string | null
  closedByName?: string | null
  files?: SiteFile[]
  by: string
  byName?: string | null
}

export const permitNo = (seq: number) => String(seq).padStart(2, "0")

export type PermitBlock = "archived" | "no_type" | "type_text" | "no_work" | "no_who" | "bad_period"

export function permitBlocks(input: { archived: boolean; type: unknown; typeText?: string | null; title: string; who: string; from: string; to: string }): PermitBlock[] {
  const out: PermitBlock[] = []
  if (input.archived) out.push("archived")
  if (!isPermitType(input.type)) out.push("no_type")
  else if (input.type === "oth" && !input.typeText?.trim()) out.push("type_text")
  if (!input.title.trim()) out.push("no_work")
  if (!input.who.trim()) out.push("no_who")
  if (!DAY.test(input.from) || !DAY.test(input.to) || input.to < input.from) out.push("bad_period")
  return out
}

/** Closed on or before `day`: it covers nothing from its closing day on. */
const closedBy = (p: Pick<PmPermit, "closedOn">, day: string) => Boolean(p.closedOn) && (p.closedOn as string) <= day

/** Valid through its last day, unless closed early. The safety tile counts these. */
export const livePermits = <T extends Pick<PmPermit, "to" | "closedOn">>(list: T[], today: string) => list.filter((p) => p.to >= today && !closedBy(p, today))
export const expiredPermits = <T extends Pick<PmPermit, "to" | "closedOn">>(list: T[], today: string) => list.filter((p) => p.to < today || closedBy(p, today))

/** HSE-01 / WWP-01 (1.1): a permit of the kind needed, valid on `day` — issued for a
 * period that covers it and not closed by then. `true` (an activity flagged before
 * kinds existed) accepts a permit of any kind. */
export function permitValidOn(list: Array<Pick<PmPermit, "k" | "from" | "to" | "closedOn">>, kind: PermitType | true, day: string): boolean {
  return list.some((p) => (kind === true || p.k === kind) && p.from <= day && p.to >= day && !closedBy(p, day))
}

/** closed · expired · ends today · ends tomorrow (warn) · valid. */
export function permitState(p: Pick<PmPermit, "to" | "closedOn">, today: string): "closed" | "expired" | "today" | "soon" | "valid" {
  if (p.closedOn && p.closedOn <= today && p.to >= p.closedOn) return "closed"
  if (p.to < today) return "expired"
  if (p.to === today) return "today"
  return daysBetween(today, p.to) <= 1 ? "soon" : "valid"
}

export type PermitCloseBlock = "archived" | "closed" | "expired"

/** Closing early (HSE-01): a permit still running (or not yet begun), closed today. */
export function closePermitBlocks(input: { archived: boolean; to: string; closedOn?: string | null; today: string }): PermitCloseBlock[] {
  const out: PermitCloseBlock[] = []
  if (input.archived) out.push("archived")
  if (input.closedOn) out.push("closed")
  else if (input.to < input.today) out.push("expired")
  return out
}

/** Live ones first (soonest to end on top), then expired or closed, most recent first. */
export function sortPermits<T extends Pick<PmPermit, "to" | "closedOn">>(list: T[], today: string): T[] {
  const live = livePermits(list, today).sort((a, b) => a.to.localeCompare(b.to))
  const dead = expiredPermits(list, today).sort((a, b) => (b.closedOn ?? b.to).localeCompare(a.closedOn ?? a.to))
  return [...live, ...dead]
}

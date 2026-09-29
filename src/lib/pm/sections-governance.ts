// PM 1.0 — switching a project's sections (PRD WF-23, SEC-01…05, INV-17, SC-04).
// Switching a section off is not hiding a tab: its decisions, alerts and gate
// go silent while the work on site carries on. So, before it goes: a census of
// what it holds now (count and riyals), what the system will stop telling you,
// and the blockers — money and custody block (stock in the project's own store
// `pmStore`, plant still on site, an uncollected certificate, a subcontractor
// still owed or awaiting approval),
// open paperwork only warns. A reason is mandatory ("other" stated) and every
// switch is logged with who, what, when and why. Nothing is deleted: switching
// back restores it. Switching on is immediate, with its dependencies. Core
// sections never switch off. By `approve`, never on an archived project.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, type Firestore } from "firebase/firestore"
import { assertPm, type PmContext } from "./access"
import { PM_CERTIFICATES } from "./certificate"
import type { PmCertificate } from "./certificate-writes"
import { openClaims, PM_CLAIMS, type ClaimStatus } from "./claim"
import { storeDocOf, storeHoldings, storeItemOf, subDues } from "./closeout"
import { PM_DOCS } from "./documents"
import { PM_INSPECTIONS } from "./inspection"
import { PM_UNITS } from "./units"
import { onSite, plantCost, PM_PLANT, type PmPlant } from "./plant"
import { PM_ACTIVITIES } from "./programme"
import { PM_STORE } from "./store"
import { PM_PLANT as PM_PLANT_REQUESTS } from "./supply"
import { PM_WEEKS } from "./weekly-plan"
import { lastPaid, PRICE_HISTORY, type PriceHistoryEntry } from "../procurement/prices"
import { withFreshState } from "./project-writes"
import { isOpenPunch, PM_PUNCH, type PunchStatus } from "./punch"
import { PM_DAILY, PM_INCIDENTS, PM_OBSTACLES, PM_PERMITS } from "./site"
import { PM_SUB_CERTIFICATES, PM_SUBCONTRACTS, type PmSubCertificate, type PmSubcontract } from "./subcontract"
import { PM_VARIATIONS, type VoStatus } from "./variation"
import { SECTION_IDS, SECTION_REGISTRY, type SectionId } from "../project-sections"

/** The prototype's reasons (SECWHY): outside the contract · another module
 * handles it · too small to need it · later · other, stated. */
export const SECTION_OFF_REASONS = ["scope", "module", "small", "later", "other"] as const
export type SectionOffReason = (typeof SECTION_OFF_REASONS)[number]
/** Reasons written before the list was aligned — still read in the log. */
export const LEGACY_OFF_REASONS = ["not_in_contract", "client_scope", "subcontracted"] as const

export type SectionBlocker = "store_stock" | "plant_on_site" | "uncollected" | "sub_dues"

export interface SectionFacts {
  /** Lines with stock left in the project's own store. */
  storeLines: number
  storeValue?: number
  /** Certified certificates Finance has not collected in full. */
  uncollected: number
  uncollectedAmount?: number
  certificates?: number
  subcontracts?: number
  /** SC-04: certified and not paid, per party above half a riyal. */
  subDue?: number
  /** Sub certificates still awaiting approval. */
  subPending?: number
  docs?: number
  daily?: number
  obstaclesOpen?: number
  incidents?: number
  permits?: number
  variations?: number
  voWaiting?: number
  voApproved?: number
  wirOpen?: number
  punchOpen?: number
  claimsOpen?: number
  activities?: number
  weeks?: number
  units?: number
  /** Plant still on site in the project's custody — it blocks switching `eqp` off. */
  plantOnSite?: number
  plantCharged?: number
  plantRequestsOpen?: number
}

export const NO_FACTS: SectionFacts = { storeLines: 0, uncollected: 0 }

const subOwed = (f: SectionFacts) => (f.subDue ?? 0) > 0.5 || (f.subPending ?? 0) > 0

/** SEC-03: only money and custody block. */
export function switchOffBlockers(turnedOff: SectionId[], facts: SectionFacts): SectionBlocker[] {
  const out: SectionBlocker[] = []
  if (turnedOff.includes("store") && facts.storeLines > 0) out.push("store_stock")
  if (turnedOff.includes("eqp") && (facts.plantOnSite ?? 0) > 0) out.push("plant_on_site")
  if ((turnedOff.includes("ipc") || turnedOff.includes("collect")) && facts.uncollected > 0) out.push("uncollected")
  if (turnedOff.includes("subs") && subOwed(facts)) out.push("sub_dues")
  return out
}

export type SwitchBlock = SectionBlocker | "archived" | "core" | "no_reason" | "reason_text" | "no_change"

export function switchBlocks(input: { archived: boolean; turnedOn: SectionId[]; turnedOff: SectionId[]; reason: SectionOffReason | null; reasonText?: string | null; facts: SectionFacts }): SwitchBlock[] {
  const out: SwitchBlock[] = []
  if (input.archived) out.push("archived")
  if (!input.turnedOn.length && !input.turnedOff.length) out.push("no_change")
  if (input.turnedOff.some((id) => SECTION_REGISTRY[id]?.required)) out.push("core")
  if (input.turnedOff.length) {
    if (!input.reason || !(SECTION_OFF_REASONS as readonly string[]).includes(input.reason)) out.push("no_reason")
    else if (input.reason === "other" && !input.reasonText?.trim()) out.push("reason_text")
    out.push(...switchOffBlockers(input.turnedOff, input.facts))
  }
  return out
}

/** One sentence per blocker, with its count or amount (formSEC «لا يُطفأ الآن»). */
export interface BlockerDetail {
  key: SectionBlocker
  section: SectionId
  n: number
  amount: number | null
}

export function blockerDetails(turnedOff: SectionId[], f: SectionFacts): BlockerDetail[] {
  const out: BlockerDetail[] = []
  if (turnedOff.includes("store") && f.storeLines > 0) out.push({ key: "store_stock", section: "store", n: f.storeLines, amount: f.storeValue ?? null })
  if (turnedOff.includes("eqp") && (f.plantOnSite ?? 0) > 0) out.push({ key: "plant_on_site", section: "eqp", n: f.plantOnSite ?? 0, amount: null })
  const money = turnedOff.find((id) => id === "ipc" || id === "collect")
  if (money && f.uncollected > 0) out.push({ key: "uncollected", section: money, n: f.uncollected, amount: f.uncollectedAmount ?? null })
  if (turnedOff.includes("subs") && subOwed(f)) out.push({ key: "sub_dues", section: "subs", n: f.subPending ?? 0, amount: f.subDue ?? 0 })
  return out
}

/** A line of the census: `r` money or custody (blocks), `w` open paperwork (warns). */
export interface CensusRow {
  key: string
  value: number
  money: boolean
  level: "" | "w" | "r"
}

/** What a section holds right now (prototype secCensus), mapped onto our sections. */
export function sectionCensus(id: SectionId, f: SectionFacts): CensusRow[] {
  const out: CensusRow[] = []
  const add = (key: string, value: number | undefined, level: CensusRow["level"] = "", money = false) => {
    if (value && value > 0) out.push({ key, value, money, level })
  }
  if (id === "store") {
    add("stock_lines", f.storeLines, "r")
    add("stock_value", f.storeValue, "r", true)
  }
  if (id === "ipc") {
    add("certificates", f.certificates, "r")
    if ((f.uncollectedAmount ?? 0) > 1) add("uncollected", f.uncollectedAmount, "r", true)
  }
  if (id === "collect" && (f.uncollectedAmount ?? 0) > 1) add("uncollected", f.uncollectedAmount, "r", true)
  if (id === "subs") {
    add("subcontracts", f.subcontracts, "r")
    add("sub_due", f.subDue, "r", true)
    add("sub_pending", f.subPending, "w")
  }
  if (id === "vo") {
    add("variations", f.variations)
    add("vo_waiting", f.voWaiting, "w")
    add("vo_approved", f.voApproved, "", true)
  }
  if (id === "qa") {
    add("wir_open", f.wirOpen, "w")
    add("punch_open", f.punchOpen, "w")
  }
  if (id === "hse") {
    add("incidents", f.incidents)
    add("permits", f.permits)
  }
  if (id === "daily") add("daily", f.daily)
  if (id === "rfi") add("obstacles_open", f.obstaclesOpen, "w")
  if (id === "claim") add("claims_open", f.claimsOpen, "w")
  if (id === "progress") add("activities", f.activities)
  if (id === "wwp") add("weeks", f.weeks)
  if (id === "zone") add("units", f.units)
  if (id === "eqp") {
    add("plant_on_site", f.plantOnSite, "r")
    add("plant_charged", f.plantCharged, "", true)
    add("plant_requests", f.plantRequestsOpen, "w")
  }
  if (id === "docs") add("docs", f.docs)
  return out
}

/** Sections with their own "what goes silent" sentence (SECLOSS); the rest say
 * their screen and decisions disappear. */
export const SECTION_LOSS: ReadonlySet<SectionId> = new Set<SectionId>(["docs", "store", "ipc", "collect", "daily", "rfi", "hse", "subs", "vo", "qa", "progress", "receive", "claim", "wwp", "eqp", "zone"])

/** Sections another module owns: we only read them here (the prototype's «يُقرأ من»). */
export type SectionOwner = "procurement" | "finance" | "manufacturing"
export const SECTION_OWNER: Partial<Record<SectionId, SectionOwner>> = {
  procure: "procurement",
  collect: "finance",
  invoice: "finance",
  pay: "finance",
  mfg: "manufacturing",
}

export interface SectionLogEntry {
  on: string[]
  off: string[]
  reason?: string | null
  reasonText?: string | null
  by: string
  byName?: string | null
  at: string
}

export interface SectionLogRow {
  id: string
  on: boolean
  at: string
  by: string
  byName: string | null
  reason: string | null
  reasonText: string | null
}

/** The section log, one row per section switched, newest first (prototype: 8). */
export function sectionLogRows(log: SectionLogEntry[] | null | undefined, limit = 8): SectionLogRow[] {
  const rows: SectionLogRow[] = []
  for (const e of [...(log ?? [])].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))) {
    const base = { at: e.at, by: e.by, byName: e.byName ?? null }
    for (const id of e.off ?? []) rows.push({ ...base, id, on: false, reason: e.reason ?? null, reasonText: e.reasonText ?? null })
    for (const id of e.on ?? []) rows.push({ ...base, id, on: true, reason: null, reasonText: null })
  }
  return rows.slice(0, limit)
}

/** Built sections are the toggles; the rest are listed once, "not built yet". */
export const builtSections = () => SECTION_IDS.filter((id) => SECTION_REGISTRY[id].status === "built")
export const unbuiltSections = () => SECTION_IDS.filter((id) => SECTION_REGISTRY[id].status !== "built")

export class PmSectionsError extends Error {
  constructor(readonly code: "missing" | "not_pm_project" | "blocked", readonly blocks: string[] = []) {
    super(code)
    this.name = "PmSectionsError"
  }
}

/** What the census and the blockers need, read now. A collection this reader
 * may not see counts as empty in the census; the write reads again. The store
 * is the project's own ledger (`pmStore`, balances from the BOQ's progress) — a
 * company warehouse is not the project's custody, so the third argument (the
 * project's warehouse, from before the ledger) is ignored. */
export async function readSectionFacts(firestore: Firestore, projectId: string, _warehouseId?: string | null): Promise<SectionFacts> {
  const col = (name: string) => getDocs(collection(firestore, "projects", projectId, name)).catch(() => null)
  const pSnap = await getDoc(doc(firestore, "projects", projectId)).catch(() => null)
  const orgId = (pSnap?.exists() ? (pSnap.data() as { organizationId?: string }).organizationId : null) ?? null
  const [certs, store, boq, history, subs, subCerts, docs, daily, obstacles, incidents, permits, vos, wirs, punch, claims, acts, weeks, plant, plantReqs, zones] = await Promise.all([
    col(PM_CERTIFICATES),
    col(PM_STORE),
    col("boqItems"),
    orgId ? getDocs(query(collection(firestore, PRICE_HISTORY), where("organizationId", "==", orgId))).catch(() => null) : Promise.resolve(null),
    col(PM_SUBCONTRACTS),
    col(PM_SUB_CERTIFICATES),
    col(PM_DOCS),
    col(PM_DAILY),
    col(PM_OBSTACLES),
    col(PM_INCIDENTS),
    col(PM_PERMITS),
    col(PM_VARIATIONS),
    col(PM_INSPECTIONS),
    col(PM_PUNCH),
    col(PM_CLAIMS),
    col(PM_ACTIVITIES),
    col(PM_WEEKS),
    col(PM_PLANT),
    col(PM_PLANT_REQUESTS),
    col(PM_UNITS),
  ])
  const certList = (certs?.docs ?? []).map((d) => d.data() as PmCertificate & { collected?: number | null })
  const open = certList.filter((c) => (c.status === "appr" || c.status === "part") && (c.collected ?? 0) < 1)
  const priceRows = (history?.docs ?? []).map((d) => d.data() as PriceHistoryEntry)
  const held = storeHoldings(
    (store?.docs ?? []).map((d) => storeDocOf(d.id, d.data() as Record<string, unknown>)),
    (boq?.docs ?? []).map((d) => storeItemOf(d.id, d.data() as Record<string, unknown>)),
    (x) => lastPaid(priceRows, x.name, x.unit)?.price ?? null
  )
  const units = (plant?.docs ?? []).map((d) => d.data() as PmPlant)
  const contracts = (subs?.docs ?? []).map((d) => ({ ...(d.data() as PmSubcontract), id: d.id }))
  const dues = subDues(contracts, (subCerts?.docs ?? []).map((d) => d.data() as PmSubCertificate))
  const voList = (vos?.docs ?? []).map((d) => d.data() as { status: VoStatus; value?: number })
  return {
    storeLines: held.lines,
    storeValue: Math.round(held.value),
    uncollected: open.length,
    uncollectedAmount: Math.round(open.reduce((a, c) => a + (c.net ?? 0) * (1 - Math.min(1, Math.max(0, c.collected ?? 0))), 0)),
    certificates: certList.filter((c) => c.status !== "void").length,
    subcontracts: contracts.length,
    subDue: dues.due,
    subPending: dues.pending,
    docs: docs?.size ?? 0,
    daily: daily?.size ?? 0,
    obstaclesOpen: (obstacles?.docs ?? []).filter((d) => !(d.data() as { closeOn?: string | null }).closeOn).length,
    incidents: incidents?.size ?? 0,
    permits: permits?.size ?? 0,
    variations: voList.length,
    voWaiting: voList.filter((v) => v.status === "wait").length,
    voApproved: Math.round(voList.filter((v) => v.status === "appr").reduce((a, v) => a + (v.value ?? 0), 0)),
    wirOpen: (wirs?.docs ?? []).filter((d) => (d.data() as { status?: string }).status === "open").length,
    punchOpen: (punch?.docs ?? []).filter((d) => isOpenPunch(d.data() as { status: PunchStatus })).length,
    claimsOpen: openClaims((claims?.docs ?? []).map((d) => d.data() as { status: ClaimStatus })).length,
    activities: acts?.size ?? 0,
    weeks: weeks?.size ?? 0,
    units: zones?.size ?? 0,
    plantOnSite: onSite(units).length,
    plantCharged: Math.round(units.reduce((a, p) => a + (p.dayRate ? plantCost(p) : 0), 0)),
    plantRequestsOpen: (plantReqs?.docs ?? []).filter((d) => {
      const r = d.data() as { status?: string; got?: unknown }
      return r.status !== "rej" && !r.got
    }).length,
  }
}

export interface SectionActor {
  uid: string
  name: string | null
}

/** Switch sections. Without `facts` the blockers are read now, right before the
 * transaction — the confirmation's figures are never trusted for the gate. */
export async function switchSections(
  firestore: Firestore,
  ctx: PmContext,
  projectId: string,
  actor: SectionActor,
  input: { next: SectionId[]; reason: SectionOffReason | null; reasonText?: string | null; facts?: SectionFacts }
): Promise<void> {
  let facts = input.facts
  if (!facts) {
    facts = await readSectionFacts(firestore, projectId)
  }
  const gateFacts = facts
  await runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, "projects", projectId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PmSectionsError("missing")
    const project = snap.data() as { status?: string; projectManagerId?: string | null; enabledSections?: string[]; pm?: Record<string, unknown> & { secLog?: unknown[] } }
    if (!project.pm) throw new PmSectionsError("not_pm_project")
    const fresh = withFreshState(ctx, project)
    assertPm(fresh, "sections.manage")
    const before = new Set((project.enabledSections ?? []) as SectionId[])
    const after = new Set(input.next)
    const turnedOn = input.next.filter((id) => !before.has(id))
    const turnedOff = [...before].filter((id) => !after.has(id))
    const blocks = switchBlocks({ archived: fresh.archived, turnedOn, turnedOff, reason: input.reason, reasonText: input.reasonText, facts: gateFacts })
    if (blocks.length) throw new PmSectionsError("blocked", blocks)
    const entry = {
      on: turnedOn,
      off: turnedOff,
      reason: turnedOff.length ? input.reason : null,
      reasonText: turnedOff.length && input.reason === "other" ? input.reasonText?.trim() ?? null : null,
      by: actor.uid,
      byName: actor.name,
      at: new Date().toISOString(),
    }
    tx.update(ref, { enabledSections: input.next, pm: { ...project.pm, secLog: [...(project.pm.secLog ?? []), entry].slice(-200) }, updatedAt: serverTimestamp() })
  })
}

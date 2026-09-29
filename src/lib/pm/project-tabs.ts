// A project's screens grouped as the PM 1.0 prototype groups them (§5): seven
// tabs — Pulse · Contract · Execution · Supply · Money · File · Settings — each
// with its own sub-tabs. The page still addresses a screen by its key
// (`?tab=`), so every existing link keeps working; this only says which group
// a key belongs to and in which order they read. Pure: no I/O.

export const PROJECT_GROUPS = ["pulse", "contract", "exec", "supply", "money", "file", "settings"] as const
export type ProjectGroup = (typeof PROJECT_GROUPS)[number]

/** Every screen key the project page knows, by its group. Unknown keys go to File. */
export const GROUP_OF: Record<string, ProjectGroup> = {
  pmToday: "pulse",
  boq: "contract",
  pmTerms: "contract",
  pmVo: "contract",
  vo: "contract",
  pmClaims: "contract",
  pmProgramme: "contract",
  pmUnits: "exec",
  pmMeasure: "exec",
  pmSite: "exec",
  pmWir: "exec",
  pmQa: "exec",
  pmPunch: "exec",
  pmSubs: "exec",
  pmClose: "file",
  mfg: "exec",
  daily: "exec",
  progress: "exec",
  qa: "exec",
  hse: "exec",
  rfi: "exec",
  rfqs: "supply",
  purchaseRequests: "supply",
  pmReq: "supply",
  pmStore: "supply",
  pmSubm: "supply",
  pmPetty: "supply",
  pmPo: "supply",
  procure: "supply",
  receive: "supply",
  store: "supply",
  mats: "supply",
  subs: "supply",
  ipc: "money",
  pmCost: "money",
  pmMatch: "money",
  pmCvr: "money",
  collect: "money",
  invoice: "money",
  pay: "money",
  cost: "money",
  info: "file",
  pmDocs: "file",
  pmCorr: "file",
  docs: "file",
  contract: "file",
  team: "settings",
  pmSections: "settings",
  pmBoundary: "settings",
}

export const groupOf = (key: string): ProjectGroup => GROUP_OF[key] ?? "file"

export interface GroupedTabs<T extends { key: string }> {
  group: ProjectGroup
  tabs: T[]
}

// Where the prototype's SEGS put a screen first: the certificates lead Money,
// the contract data leads File. Unranked screens keep the order they were given.
const LEAD: Record<string, number> = { ipc: 0, pmCost: 1, pmMatch: 2, pmCvr: 3, info: 0, pmDocs: 1, pmCorr: 2, pmClose: 3 }

/** The groups that have at least one screen, in the prototype's order, each
 * with its screens in the prototype's order. */
export function groupTabs<T extends { key: string }>(tabs: T[]): GroupedTabs<T>[] {
  return PROJECT_GROUPS.map((group) => ({
    group,
    tabs: tabs
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => groupOf(t.key) === group)
      .sort((a, b) => (LEAD[a.t.key] ?? 100) - (LEAD[b.t.key] ?? 100) || a.i - b.i)
      .map(({ t }) => t),
  })).filter((g) => g.tabs.length > 0)
}

/** The screen to show for a requested key: itself when the viewer has it, else
 * the first screen of its group, else the first screen of all (the prototype's
 * shell() never renders a tab that is not in the rail). */
export function visibleTab(requested: string, keys: readonly string[]): string {
  if (keys.includes(requested)) return requested
  const group = groupOf(requested)
  return keys.find((k) => groupOf(k) === group) ?? keys[0] ?? requested
}

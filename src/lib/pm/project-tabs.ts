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
  pmMeasure: "exec",
  pmWir: "exec",
  pmPunch: "exec",
  pmClose: "exec",
  mfg: "exec",
  daily: "exec",
  progress: "exec",
  qa: "exec",
  hse: "exec",
  rfi: "exec",
  rfqs: "supply",
  purchaseRequests: "supply",
  procure: "supply",
  receive: "supply",
  store: "supply",
  mats: "supply",
  subs: "supply",
  ipc: "money",
  collect: "money",
  invoice: "money",
  pay: "money",
  cost: "money",
  info: "file",
  docs: "file",
  contract: "file",
  team: "settings",
}

export const groupOf = (key: string): ProjectGroup => GROUP_OF[key] ?? "file"

export interface GroupedTabs<T extends { key: string }> {
  group: ProjectGroup
  tabs: T[]
}

/** The groups that have at least one screen, in the prototype's order, each
 * keeping the screens in the order they were given. */
export function groupTabs<T extends { key: string }>(tabs: T[]): GroupedTabs<T>[] {
  return PROJECT_GROUPS.map((group) => ({ group, tabs: tabs.filter((t) => groupOf(t.key) === group) })).filter((g) => g.tabs.length > 0)
}

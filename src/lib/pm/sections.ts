// PM 1.0 — section presets by project type (PRD §13 "7 presets"; the
// prototype's PRESET). One question instead of twenty-three: the project type
// picks the sections, and the manager may still change them in the wizard.
// Mapped onto our section registry, and only sections that are built — a
// "coming soon" tab switched on by a preset is noise.

import { SECTION_IDS, SECTION_REGISTRY, type SectionId } from "../project-sections"
import type { ProjectKind } from "./handover"

// The prototype's section keys → ours (several of theirs fold into one of ours:
// req/po into procurement, wir/punch/qa into quality, base into the programme).
const MAP: Record<string, SectionId> = {
  boq: "contract",
  req: "procure",
  po: "procure",
  price: "price",
  subm: "subm",
  petty: "petty",
  stock: "store",
  cost: "cost",
  ipc: "ipc",
  coll: "collect",
  cvr: "cvr",
  match: "match",
  docs: "docs",
  corr: "corr",
  close: "close",
  daily: "daily",
  vo: "vo",
  sub: "subs",
  wir: "qa",
  punch: "qa",
  qa: "qa",
  hse: "hse",
  rfi: "rfi",
  base: "progress",
  sched: "sched",
  wwp: "wwp",
  zone: "zone",
  claim: "claim",
  eqp: "eqp",
}

// The prototype's PRESET, verbatim (v21).
const PRESET: Record<ProjectKind, string[]> = {
  bld: ["boq", "vo", "base", "sched", "wwp", "eqp", "claim", "subm", "meas", "wir", "qa", "hse", "daily", "sub", "rfi", "punch", "req", "po", "price", "petty", "stock", "cost", "cvr", "match", "ipc", "coll", "team", "docs", "corr", "close"],
  infra: ["boq", "vo", "subm", "meas", "wir", "daily", "sub", "rfi", "punch", "req", "po", "stock", "cost", "cvr", "ipc", "coll", "team", "docs"],
  road: ["boq", "vo", "base", "claim", "subm", "meas", "wir", "daily", "sub", "rfi", "req", "po", "stock", "cost", "cvr", "ipc", "coll", "team", "docs"],
  ind: ["boq", "vo", "base", "sched", "wwp", "eqp", "claim", "subm", "meas", "wir", "hse", "daily", "sub", "rfi", "punch", "req", "po", "price", "stock", "cost", "cvr", "match", "ipc", "coll", "team", "docs", "corr", "close"],
  mep: ["boq", "vo", "base", "claim", "subm", "meas", "wir", "daily", "sub", "rfi", "punch", "req", "po", "stock", "cost", "cvr", "ipc", "coll", "team", "docs"],
  mnt: ["boq", "claim", "meas", "daily", "req", "po", "petty", "stock", "cost", "cvr", "ipc", "coll", "team", "docs", "corr", "close"],
  // Self-development: nobody pays, so no certificates and no collection.
  own: ["boq", "base", "subm", "meas", "wir", "daily", "sub", "punch", "zone", "req", "po", "stock", "cost", "cvr", "team", "docs"],
}

/** The built sections a project of this type starts with, required ones always
 * included; dependencies follow (the store needs receiving). */
export function sectionsForKind(kind: ProjectKind): SectionId[] {
  const out = new Set<SectionId>(SECTION_IDS.filter((id) => SECTION_REGISTRY[id].required))
  for (const key of PRESET[kind]) {
    const id = MAP[key]
    if (id && SECTION_REGISTRY[id].status === "built") out.add(id)
  }
  if (out.has("store")) out.add("receive")
  if (out.has("collect")) out.add("ipc")
  if (out.has("sched")) out.add("progress")
  return SECTION_IDS.filter((id) => out.has(id))
}

// Sections arrived in generations. A project whose sections were chosen before a
// generation existed never names any of its ids (they were not offered), so a
// tab of that generation stays on there; a project that names one of them — or
// a later one — chose, and its choice gates the tab.
const GENERATIONS: SectionId[][] = [
  ["vo", "claim", "progress", "wwp", "eqp"],
  ["subm", "petty", "price", "cvr", "match", "corr", "close", "qa", "sched"],
]

/** C-47 and the fix wave: a gated PM tab shows when its section is on, while the
 * project holds its records, or on a project whose sections predate the gate. */
export function pmTabVisible(enabled: readonly SectionId[], id: SectionId, records: number | undefined): boolean {
  const gen = GENERATIONS.findIndex((g) => g.includes(id))
  const chose = gen < 0 || GENERATIONS.slice(gen).some((g) => g.some((m) => enabled.includes(m)))
  return !chose || enabled.includes(id) || (records ?? 0) > 0
}

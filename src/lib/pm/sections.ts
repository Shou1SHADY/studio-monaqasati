// PM 1.0 — section presets by project type (PRD §13 "7 presets"; the
// prototype's PRESET). One question instead of twenty-three: the project type
// picks the sections, and the manager may still change them in the wizard.
// Mapped onto our section registry, and only sections that are built — a
// "coming soon" tab switched on by a preset is noise.

import { SECTION_IDS, SECTION_REGISTRY, type SectionId } from "../project-sections"
import type { ProjectKind } from "./handover"

// The prototype's section keys → ours (several of theirs fold into one of ours).
const MAP: Record<string, SectionId> = {
  boq: "contract",
  req: "procure",
  po: "procure",
  price: "procure",
  stock: "store",
  cost: "cost",
  ipc: "ipc",
  coll: "collect",
  docs: "docs",
  daily: "daily",
  vo: "vo",
  sub: "subs",
  wir: "qa",
  punch: "qa",
  qa: "qa",
  hse: "hse",
  rfi: "rfi",
  base: "progress",
  sched: "progress",
  match: "invoice",
}

const PRESET: Record<ProjectKind, string[]> = {
  bld: ["boq", "vo", "base", "sched", "subm", "meas", "wir", "qa", "hse", "daily", "sub", "rfi", "punch", "req", "po", "price", "stock", "cost", "match", "ipc", "coll", "docs"],
  infra: ["boq", "vo", "meas", "wir", "daily", "sub", "rfi", "punch", "req", "po", "stock", "cost", "ipc", "coll", "docs"],
  road: ["boq", "vo", "base", "meas", "wir", "daily", "sub", "rfi", "req", "po", "stock", "cost", "ipc", "coll", "docs"],
  ind: ["boq", "vo", "base", "sched", "meas", "wir", "hse", "daily", "sub", "rfi", "punch", "req", "po", "price", "stock", "cost", "match", "ipc", "coll", "docs"],
  mep: ["boq", "vo", "base", "meas", "wir", "daily", "sub", "rfi", "punch", "req", "po", "stock", "cost", "ipc", "coll", "docs"],
  mnt: ["boq", "meas", "daily", "req", "po", "stock", "cost", "ipc", "coll", "docs"],
  // Self-development: nobody pays, so no certificates and no collection.
  own: ["boq", "base", "meas", "wir", "daily", "sub", "punch", "req", "po", "stock", "cost", "docs"],
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
  return SECTION_IDS.filter((id) => out.has(id))
}

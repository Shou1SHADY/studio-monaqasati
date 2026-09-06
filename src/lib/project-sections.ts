// Project "sections" catalog (أقسام المشروع) — single source of truth for the 19
// toggleable project features shown as tabs on the project detail page. Mirrors
// src/lib/permissions.ts's catalog pattern, but this is NOT a permission system:
// it controls which tabs/UI surfaces are visible on a project, not who can act
// inside them (permissions.ts is orthogonal and still applies within any tab).

export const SECTION_GROUPS = ["foundation", "materials", "money", "execution", "governance"] as const
export type SectionGroup = (typeof SECTION_GROUPS)[number]

export const PIPELINE_STAGES = [
  "budget", "priced", "commit", "recv", "inv", "paid",
  "claim", "coll",
] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export type SectionSourceKind = "auto" | "mix" | "man"
export type SectionStatus = "built" | "ghost"

export interface SectionDef {
  id: string
  group: SectionGroup
  required: boolean
  dependsOn: string[]
  stages: PipelineStage[]
  reconciliationId: string | null
  source: SectionSourceKind
  status: SectionStatus
  tabRoute: string | null
}

export const SECTION_IDS = [
  "contract", "procure", "docs",
  "receive", "store", "mats",
  "invoice", "pay", "cost", "ipc", "collect",
  "mfg", "daily", "progress", "vo", "subs",
  "qa", "hse", "rfi",
] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const SECTION_REGISTRY: Record<SectionId, SectionDef> = {
  contract: { id: "contract", group: "foundation", required: true, dependsOn: [], stages: ["budget"], reconciliationId: null, source: "auto", status: "built", tabRoute: null },
  procure: { id: "procure", group: "foundation", required: true, dependsOn: [], stages: ["priced", "commit"], reconciliationId: "r1", source: "auto", status: "built", tabRoute: null },
  docs: { id: "docs", group: "foundation", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "mix", status: "ghost", tabRoute: "docs" },

  receive: { id: "receive", group: "materials", required: false, dependsOn: [], stages: ["recv"], reconciliationId: "r2", source: "auto", status: "built", tabRoute: null },
  store: { id: "store", group: "materials", required: false, dependsOn: ["receive"], stages: [], reconciliationId: "r3", source: "man", status: "built", tabRoute: "warehouse" },
  mats: { id: "mats", group: "materials", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "auto", status: "ghost", tabRoute: "materials" },

  invoice: { id: "invoice", group: "money", required: false, dependsOn: ["receive"], stages: ["inv"], reconciliationId: "r4", source: "auto", status: "ghost", tabRoute: "invoices" },
  pay: { id: "pay", group: "money", required: false, dependsOn: ["invoice"], stages: ["paid"], reconciliationId: "r7", source: "auto", status: "ghost", tabRoute: "payments" },
  cost: { id: "cost", group: "money", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "auto", status: "ghost", tabRoute: "cost" },
  ipc: { id: "ipc", group: "money", required: false, dependsOn: ["progress"], stages: ["claim"], reconciliationId: "r5", source: "mix", status: "built", tabRoute: "ipc" },
  collect: { id: "collect", group: "money", required: false, dependsOn: ["ipc"], stages: ["coll"], reconciliationId: "r6", source: "mix", status: "built", tabRoute: "ipc" },

  mfg: { id: "mfg", group: "execution", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "man", status: "built", tabRoute: "mfg" },
  daily: { id: "daily", group: "execution", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "man", status: "ghost", tabRoute: "daily" },
  progress: { id: "progress", group: "execution", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "man", status: "ghost", tabRoute: "progress" },
  vo: { id: "vo", group: "execution", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "mix", status: "ghost", tabRoute: "vo" },
  subs: { id: "subs", group: "execution", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "mix", status: "ghost", tabRoute: "subs" },

  qa: { id: "qa", group: "governance", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "man", status: "ghost", tabRoute: "qa" },
  hse: { id: "hse", group: "governance", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "man", status: "ghost", tabRoute: "hse" },
  rfi: { id: "rfi", group: "governance", required: false, dependsOn: [], stages: [], reconciliationId: null, source: "man", status: "ghost", tabRoute: "rfi" },
}

export function sectionLabelKey(id: SectionId): string {
  return `sec_${id}_title`
}
export function sectionDescKey(id: SectionId): string {
  return `sec_${id}_desc`
}

/** Returns the new enabled-set after turning `id` ON, auto-enabling all transitive deps. */
export function cascadeEnable(enabled: Set<SectionId>, id: SectionId): Set<SectionId> {
  const next = new Set(enabled)
  const stack: SectionId[] = [id]
  while (stack.length) {
    const cur = stack.pop() as SectionId
    if (next.has(cur)) continue
    next.add(cur)
    SECTION_REGISTRY[cur].dependsOn.forEach((dep) => stack.push(dep as SectionId))
  }
  return next
}

/**
 * Returns the new enabled-set after turning `id` OFF, cascading off to anything
 * that depends on it (transitively), but refusing to remove `required` sections.
 */
export function cascadeDisable(enabled: Set<SectionId>, id: SectionId): Set<SectionId> {
  if (SECTION_REGISTRY[id].required) return enabled
  const next = new Set(enabled)
  next.delete(id)
  let changed = true
  while (changed) {
    changed = false
    for (const secId of Array.from(next)) {
      const def = SECTION_REGISTRY[secId]
      if (!def.required && def.dependsOn.some((dep) => !next.has(dep as SectionId))) {
        next.delete(secId)
        changed = true
      }
    }
  }
  return next
}

/** Default set for a brand-new project in the wizard (all `required` sections on). */
export function defaultEnabledSections(): Set<SectionId> {
  return new Set(SECTION_IDS.filter((id) => SECTION_REGISTRY[id].required))
}

/** Legacy fallback for projects created before enabledSections existed. */
export const LEGACY_DEFAULT_SECTIONS: SectionId[] = ["contract", "procure", "docs"]

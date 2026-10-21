// Putting the Procurement 2.0 materials package onto the tree the database already holds (`categories`).
// The package is a list of text changes keyed by node id (data/materials-2.0/diff-report.json, written by
// scripts/apply-materials-2.0.mjs). A change is applied only where the live text is still the OLD text: what
// the platform team renamed in Admin → Materials, or a unit it re-picked, is left as it is and reported.
// Nodes the team added and nodes it hid are never touched — the changes name existing Watad nodes only.

import type { MaterialNode, MaterialSaleUnit } from "./types"

export interface MaterialChange {
  id: string
  /** Where in the node: "ar", "units.0.key", "specs.3.options.5.ar", "brands.1.en"… */
  at: string
  from: string
  to: string
}

export interface MaterialsPackageReport {
  changes: MaterialChange[]
  saleUnits: Array<{ id: string; saleUnits: MaterialSaleUnit[] }>
}

export interface MergeConflict {
  id: string
  at: string
  from: string
  to: string
  live: string
}

export interface MergeOutcome {
  roots: MaterialNode[]
  changedRootIds: string[]
  applied: number
  alreadyDone: number
  conflicts: MergeConflict[]
  /** Ids the package names that no live root holds. */
  missing: string[]
  saleUnitsSet: number
  saleUnitsKept: number
}

type Cursor = Record<string, unknown> | unknown[]

function parent(node: MaterialNode, at: string): { holder: Cursor; key: string } | null {
  const parts = at.split(".")
  let cur: unknown = node
  for (const p of parts.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return null
    cur = (cur as Record<string, unknown>)[p]
  }
  if (cur === null || typeof cur !== "object") return null
  return { holder: cur as Cursor, key: parts[parts.length - 1] }
}

export function mergeMaterialsPackage(liveRoots: MaterialNode[], report: MaterialsPackageReport): MergeOutcome {
  const roots = JSON.parse(JSON.stringify(liveRoots)) as MaterialNode[]
  const byId = new Map<string, { node: MaterialNode; rootId: string }>()
  const walk = (n: MaterialNode, rootId: string) => {
    byId.set(n.id, { node: n, rootId })
    n.children.forEach((c) => walk(c, rootId))
  }
  roots.forEach((r) => walk(r, r.id))

  const changed = new Set<string>()
  const missing = new Set<string>()
  const conflicts: MergeConflict[] = []
  let applied = 0
  let alreadyDone = 0

  for (const c of report.changes) {
    const hit = byId.get(c.id)
    if (!hit) {
      missing.add(c.id)
      continue
    }
    const at = parent(hit.node, c.at)
    const live = at ? (at.holder as Record<string, unknown>)[at.key] : undefined
    if (live === c.to) alreadyDone++
    else if (at && live === c.from) {
      ;(at.holder as Record<string, unknown>)[at.key] = c.to
      changed.add(hit.rootId)
      applied++
    } else conflicts.push({ ...c, live: live === undefined ? "(absent)" : String(live) })
  }

  let saleUnitsSet = 0
  let saleUnitsKept = 0
  for (const s of report.saleUnits) {
    const hit = byId.get(s.id)
    if (!hit) {
      missing.add(s.id)
      continue
    }
    if (hit.node.saleUnits?.length) saleUnitsKept++
    else {
      hit.node.saleUnits = s.saleUnits
      changed.add(hit.rootId)
      saleUnitsSet++
    }
  }

  return { roots, changedRootIds: [...changed], applied, alreadyDone, conflicts, missing: [...missing], saleUnitsSet, saleUnitsKept }
}

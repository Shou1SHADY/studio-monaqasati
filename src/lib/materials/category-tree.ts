// The material tree read the way the old two-level category list was: a category name → what sits under it.
// `categoryRoot` (buyer scope, platform reach) resolves a supplier's field to a top-level category through it,
// so those readers need no list of their own. A key under a category is a sub-category id, a sub-category name
// or a material name; `specialtyKeys` (subs.ts) turns a supplier's older names into the sub-category ids the tree spells.

import { specialtyKeys } from "./subs"
import type { MaterialIndex } from "./tree"

export function categoryTree(index: MaterialIndex | null): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!index) return out
  for (const root of index.roots) {
    const keys = new Set<string>()
    const walk = (n: typeof root) => {
      keys.add(n.id)
      keys.add(n.ar)
      n.children.forEach(walk)
    }
    root.children.forEach(walk)
    out[root.ar] = [...keys]
  }
  return out
}

/** A supplier read against the tree: his field becomes sub-category ids (older names the tree spells are translated). */
export function treeSupplier<T extends { categories: string[]; subIds?: string[] }>(supplier: T, index: MaterialIndex | null): T {
  return { ...supplier, categories: specialtyKeys(index, supplier.subIds || [], supplier.categories) }
}

/**
 * A buyer's categories as the tree knows them. Names saved before the tree name no tree category: a buyer who has only
 * those is read as having none (everything), since a hidden need is a site that stops.
 */
export function treeScope(index: MaterialIndex | null, categories: string[] | null | undefined): string[] | null {
  if (!categories || !categories.length || !index) return categories?.length ? categories : null
  const roots = new Set(index.roots.map((r) => r.ar))
  const known = categories.filter((c) => roots.has(c))
  return known.length ? known : null
}

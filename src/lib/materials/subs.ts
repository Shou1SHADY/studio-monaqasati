// The one list of sub-categories every picker and filter reads (PUR-04). A key is a tree
// sub-category id; documents written before the tree carry the old category NAME instead,
// and that name stays a key of its own so they still match and filter.

import { foldSearchText } from "@/lib/search-text"
import { label, pathOf, type MaterialIndex } from "./tree"
import type { MaterialNode } from "./types"

export interface SubOption {
  value: string
  /** «الحديد › حديد التسليح» (a first-level leaf is just its own name). */
  label: string
  root: string
}

export function subOptions(index: MaterialIndex | null, locale: string): SubOption[] {
  if (!index) return []
  return index.subs.map((s) => {
    const path = pathOf(index, s.id)
    return { value: s.id, label: path.map((p) => label(p, locale)).join(" › "), root: path[0] ? label(path[0], locale) : "" }
  })
}

/** A sub-category's name in the reader's language, with its category before it. */
export function subLabel(index: MaterialIndex | null, id: string, locale: string, withRoot = true): string {
  const node = index?.byId.get(id)
  if (!index || !node) return ""
  const path = pathOf(index, id)
  return (withRoot ? path : path.slice(-1)).map((p) => label(p, locale)).join(" › ")
}

/** The sub-categories an old category or sub-category NAME stands for: those whose name (or whose category's) it spells exactly. */
export function legacyNameToSubIds(index: MaterialIndex | null, name: string): string[] {
  const want = foldSearchText(name)
  if (!index || !want) return []
  const out: string[] = []
  for (const s of index.subs) {
    const path = pathOf(index, s.id)
    if (path.some((p: MaterialNode) => foldSearchText(p.ar) === want || foldSearchText(p.en) === want)) out.push(s.id)
  }
  return out
}

/**
 * What a supplier is filtered and counted by: the sub-categories he chose from the tree, plus the old
 * category names he still carries that name no tree sub-category (those stay as they were written).
 */
export function specialtyKeys(index: MaterialIndex | null, subIds: string[], legacyNames: string[]): string[] {
  const keys = new Set<string>(subIds)
  for (const name of legacyNames) {
    const hits = legacyNameToSubIds(index, name)
    if (hits.length) hits.forEach((h) => keys.add(h))
    else keys.add(name)
  }
  return [...keys]
}

/** A key's words: the tree's sub-category when it is one, else the old category through `legacy`. */
export function keyLabel(index: MaterialIndex | null, key: string, locale: string, legacy: (name: string, locale: string) => string, withRoot = false): string {
  return index?.byId.has(key) ? subLabel(index, key, locale, withRoot) : legacy(key, locale)
}

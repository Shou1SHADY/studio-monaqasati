// Editing the material tree in Admin → Materials (PUR-04). Pure: each edit returns a new
// root; the page writes the root's document. Nodes are never deleted — a material that
// documents already name is HIDDEN from the pickers, and those documents keep reading it.

import type { MaterialNode, MaterialSuggestion, MaterialText, MaterialUnit } from "./types"

const mapNode = (n: MaterialNode, id: string, f: (x: MaterialNode) => MaterialNode): MaterialNode =>
  n.id === id ? f(n) : { ...n, children: n.children.map((c) => mapNode(c, id, f)) }

export const findIn = (n: MaterialNode, id: string): MaterialNode | null => (n.id === id ? n : n.children.reduce<MaterialNode | null>((hit, c) => hit || findIn(c, id), null))

export function renameNode(root: MaterialNode, id: string, text: MaterialText): MaterialNode {
  const ar = text.ar.trim()
  const en = text.en.trim() || ar
  if (!ar) return root
  return mapNode(root, id, (n) => ({ ...n, ar, en }))
}

export const setHidden = (root: MaterialNode, id: string, hidden: boolean): MaterialNode => mapNode(root, id, (n) => ({ ...n, hidden: hidden || undefined }))

export function setUnits(root: MaterialNode, id: string, units: MaterialUnit[]): MaterialNode {
  return mapNode(root, id, (n) => ({ ...n, units }))
}

/** A new node under `parentId` — a level below it (never past the third). */
export function addChild(root: MaterialNode, parentId: string, text: MaterialText, newId: string): MaterialNode {
  const parent = findIn(root, parentId)
  if (!parent || parent.level >= 3 || !text.ar.trim()) return root
  const child: MaterialNode = { id: newId, ar: text.ar.trim(), en: text.en.trim() || text.ar.trim(), level: (parent.level + 1) as 2 | 3, units: [], specs: [], brands: [], keywords: [], installation: false, children: [] }
  return mapNode(root, parentId, (n) => ({ ...n, children: [...n.children, child] }))
}

/** One more mention of a material typed outside the list; the same words under the same sub-category count once each time. */
export function addSuggestion(list: MaterialSuggestion[], s: { name: string; subId: string; sub: string }, at: string): MaterialSuggestion[] {
  const name = s.name.trim().replace(/\s+/g, " ").slice(0, 120)
  if (!name || !s.subId) return list
  const i = list.findIndex((x) => x.subId === s.subId && x.name === name)
  if (i >= 0) return list.map((x, j) => (j === i ? { ...x, count: x.count + 1, lastAt: at } : x))
  return [...list, { name, subId: s.subId, sub: s.sub.slice(0, 120), count: 1, firstAt: at, lastAt: at }].slice(-500)
}

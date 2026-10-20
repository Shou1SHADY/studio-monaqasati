// The material tree on the server (Admin SDK): the admin's copy in `categories`, else
// the shipped file. Read once per instance — the tree changes rarely, and a stale copy
// only means a just-added sub-category is refused for a few minutes.

import type { Firestore } from "firebase-admin/firestore"
import shippedFile from "../../../public/data/material-tree.json"
import { indexTree, type MaterialIndex } from "./tree"
import { MATERIAL_TREE, type MaterialRootDoc, type MaterialTreeFile } from "./types"

const TTL_MS = 5 * 60_000
let cached: { at: number; index: MaterialIndex } | null = null

export async function serverMaterialTree(db: Firestore): Promise<MaterialIndex> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index
  let index: MaterialIndex | null = null
  try {
    const snap = await db.collection(MATERIAL_TREE).get()
    const docs = snap.docs.map((d) => d.data() as MaterialRootDoc).filter((d) => d && d.root && Array.isArray(d.root.children))
    if (docs.length) index = indexTree(docs.sort((a, b) => a.order - b.order).map((d) => d.root))
  } catch {
    /* fall back to the shipped list */
  }
  index ||= indexTree((shippedFile as unknown as MaterialTreeFile).roots)
  cached = { at: Date.now(), index }
  return index
}

export const shippedMaterialTree = (): MaterialTreeFile => shippedFile as unknown as MaterialTreeFile

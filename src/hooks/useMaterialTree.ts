"use client"

// The material tree, loaded once per session (PUR-04): Firestore `categories` (the
// admin's copy), else the shipped `/data/material-tree.json` while that is empty. Every
// picker shares the one promise; Admin → Materials calls `reloadMaterialTree` after an edit.

import { useEffect, useState } from "react"
import { collection, getDocs, type Firestore } from "firebase/firestore"
import { useFirestore } from "@/firebase"
import { indexTree, type MaterialIndex } from "@/lib/materials/tree"
import { MATERIAL_TREE, type MaterialRootDoc, type MaterialTreeFile } from "@/lib/materials/types"

export const MATERIAL_TREE_URL = "/data/material-tree.json"

let pending: Promise<MaterialIndex> | null = null
let ready: MaterialIndex | null = null
const listeners = new Set<(i: MaterialIndex) => void>()

async function shipped(): Promise<MaterialIndex> {
  const res = await fetch(MATERIAL_TREE_URL)
  const file = (await res.json()) as MaterialTreeFile
  return indexTree(file.roots)
}

async function load(db: Firestore | null): Promise<MaterialIndex> {
  if (db) {
    try {
      const snap = await getDocs(collection(db, MATERIAL_TREE))
      const docs = snap.docs.map((d) => d.data() as MaterialRootDoc).filter((d) => d && d.root && Array.isArray(d.root.children))
      if (docs.length) return indexTree(docs.sort((a, b) => a.order - b.order).map((d) => d.root))
    } catch {
      /* not readable yet — the shipped tree is the same list */
    }
  }
  return shipped()
}

export function reloadMaterialTree(db: Firestore | null): Promise<MaterialIndex> {
  pending = load(db).then((i) => {
    ready = i
    listeners.forEach((l) => l(i))
    return i
  })
  return pending
}

/** The tree's index, or null while it loads (and if it cannot load at all). */
export function useMaterialTree(): { index: MaterialIndex | null; failed: boolean } {
  const db = useFirestore()
  const [index, setIndex] = useState<MaterialIndex | null>(ready)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    listeners.add(setIndex)
    if (!ready) {
      if (!pending) void reloadMaterialTree(db).catch(() => { pending = null })
      pending?.then(setIndex).catch(() => setFailed(true))
    }
    return () => {
      listeners.delete(setIndex)
    }
  }, [db])
  return { index, failed }
}

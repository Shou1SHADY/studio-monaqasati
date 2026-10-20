#!/usr/bin/env node
// Builds public/data/material-tree.json from data/watad-catalog.json (Watad's public
// /api/category, attached to Contractor-Procurement-Changes 1.5). The tree is taken as
// it is (PUR-04) — only whitespace is collapsed, duplicate options dropped, and options
// that are all "<number> <unit>" sorted by number. Run: node scripts/build-material-tree.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const src = JSON.parse(readFileSync(new URL("../data/watad-catalog.json", import.meta.url), "utf8"))
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim()
const text = (o) => ({ ar: clean(o.ar), en: clean(o.en) || clean(o.ar) })
const leadNum = (s) => {
  const m = /^(\d+(?:\.\d+)?)/.exec(s)
  return m ? Number(m[1]) : null
}

function options(list) {
  const seen = new Set()
  const out = []
  for (const o of list || []) {
    const t = text(o)
    const k = t.ar.replace(/\s+/g, "")
    if (!t.ar || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  if (out.length > 1 && out.every((o) => leadNum(o.ar) != null)) out.sort((a, b) => leadNum(a.ar) - leadNum(b.ar))
  return out
}

function node(n) {
  return {
    id: n.id,
    ...text(n),
    level: n.level,
    units: (n.units || []).map((u) => ({ key: u.key, ...text(u) })),
    specs: (n.specs || []).map((s) => ({ ...text(s), mandatory: Boolean(s.mandatory), options: options(s.options) })),
    brands: (n.brands || []).map(text).filter((b) => b.ar),
    keywords: (n.keywords || []).map(clean).filter(Boolean),
    installation: Boolean(n.installation),
    children: (n.children || []).map(node),
  }
}

const out = { source: src.source, fetched: src.fetched, roots: src.tree.map(node) }
mkdirSync(new URL("../public/data/", import.meta.url), { recursive: true })
writeFileSync(new URL("../public/data/material-tree.json", import.meta.url), JSON.stringify(out))
let count = 0
const walk = (n) => { count++; n.children.forEach(walk) }
out.roots.forEach(walk)
console.log(`material-tree.json: ${out.roots.length} roots, ${count} nodes`)

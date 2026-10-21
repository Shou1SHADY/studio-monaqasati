#!/usr/bin/env node
// Builds public/data/material-tree.json from data/watad-catalog.json (Watad's public
// /api/category, attached to Contractor-Procurement-Changes 1.5). The tree is taken as
// it is (PUR-04) — only whitespace is collapsed. Every option is kept, in the source order.
// Run: node scripts/build-material-tree.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const src = JSON.parse(readFileSync(new URL("../data/watad-catalog.json", import.meta.url), "utf8"))
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim()
const text = (o) => ({ ar: clean(o.ar), en: clean(o.en) || clean(o.ar) })
const options = (list) => (list || []).map(text).filter((o) => o.ar)

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
// The server's copy lives OUTSIDE public/: a server import of a public/ file makes Next's file tracing
// pre-create public/ in the standalone output with that one file, and the App Hosting adapter then
// skipped the rest — every logo, icon and image 404'd on UAT (20 Oct 2026).
writeFileSync(new URL("../src/lib/materials/shipped-tree.json", import.meta.url), JSON.stringify(out))
let count = 0
const walk = (n) => { count++; n.children.forEach(walk) }
out.roots.forEach(walk)
console.log(`material-tree.json: ${out.roots.length} roots, ${count} nodes`)

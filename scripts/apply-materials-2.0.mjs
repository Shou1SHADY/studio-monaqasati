#!/usr/bin/env node
// Applies the Procurement 2.0 materials package (the Watad tree after its six cleaning rules, plus the sale
// units) onto our shipped tree. The package numbers its 294 nodes in depth-first order and our tree is the same
// tree in the same order, so node i of one is node i of the other: the script checks the shape (levels, children,
// units, specs, options, brands) and the English names, then replaces only the Arabic/English TEXT of nodes,
// units, specs, options and brands. Ids, unit keys, `mandatory`, keywords and `installation` stay.
// The changes are also written to data/materials-2.0/diff-report.json — the live `categories` migration
// (scripts/migrate-materials-2.0.ts) applies exactly those, node by node, to what the database holds.
// Run: node scripts/apply-materials-2.0.mjs [--check]   (--check writes nothing and fails if the files would change)
import { readFileSync, writeFileSync } from "node:fs"

const root = new URL("../", import.meta.url)
const PACKAGE = new URL("data/materials-2.0/watad-materials-2.0.json", root)
const SALE_CSV = new URL("data/materials-2.0/sale-units-2.0.csv", root)
const SHIPPED = new URL("src/lib/materials/shipped-tree.json", root)
const PUBLIC = new URL("public/data/material-tree.json", root)
const REPORT = new URL("data/materials-2.0/diff-report.json", root)
const check = process.argv.includes("--check")

const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"))
const base = JSON.parse(readFileSync(SHIPPED, "utf8"))

const flat = []
const walk = (n) => {
  flat.push(n)
  n.children.forEach(walk)
}
base.roots.forEach(walk)

if (flat.length !== pkg.nodes.length) throw new Error(`nodes: ours ${flat.length}, package ${pkg.nodes.length}`)

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim()
const changes = []
const note = (i, at, from, to) => from !== to && changes.push({ id: flat[i].id, at, from, to })
const kindOf = (at) =>
  at === "ar" || at === "en"
    ? "node"
    : /^units\.\d+\.key$/.test(at)
      ? "unit-key"
      : at.startsWith("units.")
        ? "unit"
        : at.startsWith("brands.")
          ? "brand"
          : /options\.\d+\.ar$/.test(at)
            ? "option"
            : /options\.\d+\.en$/.test(at)
              ? "option-en"
              : /^specs\.\d+\.ar$/.test(at)
                ? "spec"
                : "spec-en"
const fail = (i, what) => {
  throw new Error(`node ${i} (${flat[i].ar}) does not line up with the package: ${what}`)
}

const saleUnitsReport = []
const merged = flat.map((n, i) => {
  const p = pkg.nodes[i]
  if (n.level !== p.level) fail(i, `level ${n.level} vs ${p.level}`)
  if (n.children.length !== p.children.length) fail(i, "children")
  if (n.units.length !== p.units.length) fail(i, "units")
  if (n.specs.length !== p.specs.length) fail(i, "specs")
  if (n.brands.length !== p.brands.length) fail(i, "brands")
  if (clean(n.en) !== clean(p.name_en)) fail(i, `English name «${n.en}» vs «${p.name_en}»`)
  n.specs.forEach((s, j) => {
    if (s.options.length !== p.specs[j].options.length) fail(i, `options of spec ${j}`)
  })

  note(i, "ar", n.ar, p.name_ar)
  note(i, "en", n.en, p.name_en)
  const units = n.units.map((u, j) => {
    const pu = p.units[j]
    const key = u.ar === "حبة" && pu.ar === "كيس" ? "bag" : u.key
    note(i, `units.${j}.ar`, u.ar, pu.ar)
    note(i, `units.${j}.en`, u.en, pu.en)
    note(i, `units.${j}.key`, u.key, key)
    return { key, ar: pu.ar, en: pu.en }
  })
  const specs = n.specs.map((s, j) => {
    const ps = p.specs[j]
    note(i, `specs.${j}.ar`, s.ar, ps.ar)
    note(i, `specs.${j}.en`, s.en, ps.en)
    const options = s.options.map((o, k) => {
      const po = ps.options[k]
      note(i, `specs.${j}.options.${k}.ar`, o.ar, po.ar)
      note(i, `specs.${j}.options.${k}.en`, o.en, po.en)
      return { ar: po.ar, en: po.en }
    })
    return { ar: ps.ar, en: ps.en, mandatory: s.mandatory, options }
  })
  const brands = n.brands.map((b, j) => {
    note(i, `brands.${j}.ar`, b.ar, p.brands[j].ar)
    note(i, `brands.${j}.en`, b.en, p.brands[j].en)
    return { ar: p.brands[j].ar, en: p.brands[j].en }
  })
  const saleUnits = (p.sale_units || []).map((u) => ({ ar: u.name_ar, en: u.name_en, lengthM: u.length_m, from: u.from }))
  if (saleUnits.length) saleUnitsReport.push({ id: n.id, saleUnits })
  return { ...n, ar: p.name_ar, en: p.name_en, units, specs, brands, ...(saleUnits.length ? { saleUnits } : {}) }
})

const csv = readFileSync(SALE_CSV, "utf8")
  .replace(/^﻿/, "")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(","))
  .map(([id, , , ar, en, len]) => `${id}|${ar}|${en}|${len}`)
const fromJson = pkg.nodes.flatMap((p) => p.sale_units.map((u) => `${p.id}|${u.name_ar}|${u.name_en}|${u.length_m}`))
if (JSON.stringify(csv) !== JSON.stringify(fromJson)) throw new Error("sale-units-2.0.csv and the JSON's sale units differ")

// rebuild the nested tree from the flat list, in the same order
let cursor = 0
const rebuild = () => {
  const m = merged[cursor++]
  const children = m.children.map(() => rebuild())
  return { ...m, children }
}
const roots = base.roots.map(() => rebuild())

const out = { source: base.source, fetched: base.fetched, package: "Procurement 2.0 materials · 20 Oct 2026", roots }
const text = JSON.stringify(out)

const counts = changes.reduce((a, c) => ({ ...a, [kindOf(c.at)]: (a[kindOf(c.at)] || 0) + 1 }), {})
const bag = changes.filter((c) => c.at.endsWith(".key") && c.to === "bag").length
console.log("changes by kind", counts, "| units now bags:", bag, "| sale-unit materials:", merged.filter((m) => m.saleUnits).length)

if (check) {
  const same = readFileSync(SHIPPED, "utf8") === text && readFileSync(PUBLIC, "utf8") === text
  console.log(same ? "files are up to date" : "files would change")
  process.exit(same ? 0 : 1)
}
writeFileSync(SHIPPED, text)
writeFileSync(PUBLIC, text)
if (changes.length) writeFileSync(REPORT, JSON.stringify({ counts, changes, saleUnits: saleUnitsReport }))
console.log(`wrote ${new URL(PUBLIC).pathname} and ${new URL(SHIPPED).pathname} (${text.length} chars); report ${changes.length} changes`)

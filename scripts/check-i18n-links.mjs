#!/usr/bin/env node
// Two checks a reader cannot do reliably by eye, over the whole of src/:
//
//  1. TRANSLATIONS — every literal key passed to a next-intl translator must
//     exist in BOTH messages/ar.json and messages/en.json, under the namespace
//     that translator was created with (`useTranslations("Portal.Shared")`,
//     `getTranslations(...)`, or a prop typed `useTranslations<"Portal.X">`).
//     A translator whose namespace cannot be read statically is checked
//     against every namespace. Keys built at runtime (template literals) are
//     skipped. Also reports keys present in one language file only.
//
//  2. LINKS — every portal path written as a literal ("/contractor/…",
//     "/supplier/…", `/${portal}/…`, `${base}/…` is not resolvable and is
//     skipped) must match a route folder under src/app/[locale]/(contractor)
//     or (supplier). Dynamic segments ([id]) match anything.
//
//   node scripts/check-i18n-links.mjs            → prints findings, exit 1 if any
//   node scripts/check-i18n-links.mjs --json     → machine-readable

import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const SRC = path.join(ROOT, "src")
const json = process.argv.includes("--json")

const ar = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/ar.json"), "utf8"))
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "messages/en.json"), "utf8"))

function get(obj, dotted) {
  let node = obj
  for (const part of dotted.split(".")) {
    if (node == null || typeof node !== "object" || !(part in node)) return undefined
    node = node[part]
  }
  return node
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name === "lol") continue
      walk(full, out)
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(full)
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. Translations
// ---------------------------------------------------------------------------

const namespaces = new Set()
;(function collect(obj, trail) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      namespaces.add([...trail, k].join("."))
      collect(v, [...trail, k])
    }
  }
})(en, [])

const missing = []
const files = walk(SRC)
for (const file of files) {
  const src = fs.readFileSync(file, "utf8")
  // name → namespace ("" = root, null = unknown)
  const translators = new Map()
  const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g
  for (const m of src.matchAll(decl)) translators.set(m[1], m[2] ?? "")
  const objDecl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?getTranslations\(\s*\{[^}]*namespace:\s*["'`]([^"'`]+)["'`]/g
  for (const m of src.matchAll(objDecl)) translators.set(m[1], m[2])
  const typed = /\b(\w+)\s*:\s*ReturnType<typeof useTranslations<["'`]([^"'`]+)["'`]>>/g
  for (const m of src.matchAll(typed)) translators.set(m[1], m[2])
  // A bare `t` handed in as a prop or argument with no readable namespace.
  if (!translators.has("t") && /\bt\s*\(\s*["']/.test(src)) translators.set("t", null)

  for (const [name, ns] of translators) {
    const call = new RegExp(`(?<![\\w.])${name}(?:\\.rich|\\.markup|\\.raw|\\.has)?\\(\\s*(["'])([^"'\\n]+?)\\1`, "g")
    for (const m of src.matchAll(call)) {
      const key = m[2]
      if (/\s/.test(key) || key.includes("${")) continue
      if (m[0].includes(".has(")) continue // t.has() asks — absence is legitimate
      const line = src.slice(0, m.index).split("\n").length
      const where = `${path.relative(ROOT, file)}:${line}`
      if (ns === null) {
        const anywhere = [...namespaces].some((n) => get(en, `${n}.${key}`) !== undefined && get(ar, `${n}.${key}`) !== undefined) || (get(en, key) !== undefined && get(ar, key) !== undefined)
        if (!anywhere) missing.push({ where, key, ns: "(any)", en: false, ar: false })
        continue
      }
      const full = ns ? `${ns}.${key}` : key
      const inEn = get(en, full) !== undefined
      const inAr = get(ar, full) !== undefined
      if (!inEn || !inAr) missing.push({ where, key: full, ns, en: inEn, ar: inAr })
    }
  }
}

const parity = []
;(function diff(a, b, trail, label) {
  for (const [k, v] of Object.entries(a)) {
    const here = [...trail, k]
    if (!(k in b)) parity.push({ key: here.join("."), only: label })
    else if (v && typeof v === "object" && b[k] && typeof b[k] === "object") diff(v, b[k], here, label)
  }
})(en, ar, [], "en")
;(function diff(a, b, trail, label) {
  for (const [k, v] of Object.entries(a)) {
    const here = [...trail, k]
    if (!(k in b)) parity.push({ key: here.join("."), only: label })
    else if (v && typeof v === "object" && b[k] && typeof b[k] === "object") diff(v, b[k], here, label)
  }
})(ar, en, [], "ar")

// ---------------------------------------------------------------------------
// 2. Links
// ---------------------------------------------------------------------------

function routesOf(portal) {
  const base = path.join(SRC, "app", "[locale]", `(${portal})`, portal)
  const out = []
  ;(function scan(dir, segs) {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const seg = e.name.startsWith("(") ? null : e.name
      const next = seg === null ? segs : [...segs, seg]
      if (fs.existsSync(path.join(dir, e.name, "page.tsx"))) out.push(next)
      scan(path.join(dir, e.name), next)
    }
  })(base, [])
  if (fs.existsSync(path.join(base, "page.tsx"))) out.push([])
  return out
}
const ROUTES = { contractor: routesOf("contractor"), supplier: routesOf("supplier") }

function routeExists(portal, segs) {
  return ROUTES[portal].some(
    (r) => r.length === segs.length && r.every((s, i) => s.startsWith("[") || segs[i] === "*" || s === segs[i])
  )
}

// Links that exist only for one portal and are unreachable on the other, each
// with the reason. Keep this list short and argued; anything else is a bug.
const UNREACHABLE = [
  // A work order carries a projectId only for a contractor's project; the
  // supplier portal has no Projects module and its orders never name one.
  { link: "/supplier/projects/*", where: "src/lib/mfg-events.ts (mfgLinks)" },
]

const deadLinks = []
const linkRe = /(["'`])\/(contractor|supplier|\$\{portal\})((?:\/[^"'`?#\s]*)?)(?:[?#][^"'`]*)?\1/g
for (const file of files) {
  const src = fs.readFileSync(file, "utf8")
  for (const m of src.matchAll(linkRe)) {
    const portals = m[2] === "${portal}" ? ["contractor", "supplier"] : [m[2]]
    const rest = m[3] || ""
    if (rest.includes("${") && !/^(\/[^$]*|\/\$\{[^}]+\}[^$]*)+$/.test(rest)) continue
    const segs = rest
      .split("/")
      .filter(Boolean)
      .map((s) => (s.includes("${") ? "*" : s))
    const line = src.slice(0, m.index).split("\n").length
    // A path inside a comment is prose, not a link.
    const lineText = src.split("\n")[line - 1].trim()
    if (lineText.startsWith("//") || lineText.startsWith("*") || lineText.startsWith("/*")) continue
    for (const portal of portals) {
      if (!routeExists(portal, segs)) deadLinks.push({ where: `${path.relative(ROOT, file)}:${line}`, link: `/${portal}/${segs.join("/")}`, raw: m[0] })
    }
  }
}

// mfg-events' relative links ("sales/orders?open=…") are resolved against both portals.
const eventsFile = path.join(SRC, "lib", "mfg-events.ts")
if (fs.existsSync(eventsFile)) {
  const src = fs.readFileSync(eventsFile, "utf8")
  // The object ends at the first line that is just "}" — not at a `${…}` inside it.
  const start = src.indexOf("export const mfgLinks")
  const block = src.slice(start, src.indexOf("\n}\n", start) + 3)
  for (const m of block.matchAll(/=>\s*(?:\([^)]*\)\s*\?\s*)?[`"]([a-z][^`"?]*)/g)) {
    const segs = m[1].split("/").filter(Boolean).map((s) => (s.includes("${") ? "*" : s))
    for (const portal of ["contractor", "supplier"]) {
      if (!routeExists(portal, segs)) deadLinks.push({ where: "src/lib/mfg-events.ts (mfgLinks)", link: `/${portal}/${segs.join("/")}`, raw: m[1] })
    }
  }
}

// ---------------------------------------------------------------------------

for (let i = deadLinks.length - 1; i >= 0; i--) {
  if (UNREACHABLE.some((u) => u.link === deadLinks[i].link && u.where === deadLinks[i].where)) deadLinks.splice(i, 1)
}

if (json) {
  console.log(JSON.stringify({ missing, parity, deadLinks }, null, 2))
} else {
  console.log(`translation keys used but missing: ${missing.length}`)
  for (const m of missing) console.log(`  ${m.where}  ${m.key}  ${m.ns === "(any)" ? "(in no namespace)" : `[en:${m.en ? "✓" : "✗"} ar:${m.ar ? "✓" : "✗"}]`}`)
  console.log(`\nkeys in one language file only: ${parity.length}`)
  for (const p of parity.slice(0, 200)) console.log(`  only in ${p.only}: ${p.key}`)
  console.log(`\nportal links to no route: ${deadLinks.length}`)
  for (const d of deadLinks) console.log(`  ${d.where}  ${d.link}`)
}
process.exit(missing.length || parity.length || deadLinks.length ? 1 : 0)

import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g
const NS_RE = /useTranslations\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null
  if (!base) return null
  for (const ext of EXTS) {
    const candidate = base + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.tsx?$/.test(candidate)) return candidate
  }
  return null
}

export function translationNamespacesReachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const namespaces = new Set<string>()
  const stack = [path.resolve(ROOT, entry)]
  while (stack.length) {
    const file = stack.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const source = fs.readFileSync(file, "utf8")
    for (const m of source.matchAll(NS_RE)) namespaces.add(m[1])
    for (const m of source.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1] || m[2] || m[3])
      if (target) stack.push(target)
    }
  }
  return namespaces
}

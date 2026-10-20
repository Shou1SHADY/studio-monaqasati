/**
 * Server code never reads a file out of public/ (20 Oct 2026). A server import of
 * public/data/material-tree.json made Next's file tracing pre-create public/ in the
 * standalone output holding only that file, and the App Hosting adapter then skipped the
 * rest: every logo, icon, font and image on UAT returned 404. The server's copy of the
 * tree is src/lib/materials/shipped-tree.json, written by the same script.
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : []
  })

describe("public/ is the browser's, never the server's", () => {
  it("no source file imports or reads from public/", () => {
    const bad = walk(join(process.cwd(), "src")).filter((p) => {
      const s = readFileSync(p, "utf8")
      return /from\s+["'](\.\.\/)+public\//.test(s) || /require\(\s*["'](\.\.\/)+public\//.test(s) || /readFileSync\([^)]*["'`]public\//.test(s)
    })
    expect(bad).toEqual([])
  })
  it("the server's tree is the same file the browser fetches", () => {
    expect(readFileSync(join(process.cwd(), "src/lib/materials/shipped-tree.json"), "utf8")).toBe(readFileSync(join(process.cwd(), "public/data/material-tree.json"), "utf8"))
  })
})

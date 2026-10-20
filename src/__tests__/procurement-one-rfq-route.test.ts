/**
 * Procurement 1.5, PUR-09 #5: ONE page per RFQ — `/contractor/rfqs/{id}/offers` — with or without
 * a project. The project-scoped tender address only redirects to it (old links, bookmarks).
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })

describe("one RFQ page", () => {
  it("no screen links an RFQ through the project's tender route", () => {
    const offenders = walk(join(process.cwd(), "src")).filter((p) => /tenders\/\$\{[^}]+\}(\/offers|`)/.test(readFileSync(p, "utf8")))
    expect(offenders).toEqual([])
  })
  it("the tender addresses forward to the RFQ page, keeping the tab", () => {
    const base = join(process.cwd(), "src/app/[locale]/(contractor)/contractor/projects/[id]/tenders/[tenderId]")
    expect(readFileSync(join(base, "page.tsx"), "utf8")).toContain("/contractor/rfqs/${tenderId}/offers")
    const offers = readFileSync(join(base, "offers/page.tsx"), "utf8")
    expect(offers).toContain("/contractor/rfqs/${tenderId}/offers")
    expect(offers).toContain("?tab=")
  })
})

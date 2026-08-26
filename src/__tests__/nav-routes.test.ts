import fs from "fs"
import path from "path"

/**
 * Navigation link guard.
 *
 * `portal-components.ts` stores hrefs as plain strings. Nothing resolves them:
 * TypeScript sees a `string`, and the build never visits them, so a link to a
 * page that was planned and never built ships silently and 404s the first time
 * someone clicks it. That is exactly how `/contractor/inventory` — the
 * Inventory component's own home — reached production.
 */

const ROOT = path.join(__dirname, "..", "..")
const APP_DIR = path.join(ROOT, "src", "app", "[locale]")

/** URL path of every App Router page under `src/app/[locale]`. */
function collectRoutes(): string[] {
  const routes: string[] = []
  const walk = (dir: string, urlParts: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // `(group)` and `@slot` segments organise files without appearing in
        // the URL, so they must not consume a path segment here.
        const isInvisible = entry.name.startsWith("(") || entry.name.startsWith("@")
        walk(full, isInvisible ? urlParts : [...urlParts, entry.name])
      } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
        routes.push("/" + urlParts.join("/"))
      }
    }
  }
  walk(APP_DIR, [])
  return routes
}

const ROUTES = collectRoutes()

/** True when `href` matches a route, letting `[dynamic]` segments match anything. */
function resolves(href: string): boolean {
  // Query strings and hashes are not part of the route.
  const clean = href.split("?")[0].split("#")[0]
  const wanted = clean.split("/").filter(Boolean)
  return ROUTES.some((route) => {
    const parts = route.split("/").filter(Boolean)
    if (parts.length !== wanted.length) return false
    return parts.every((part, i) => (part.startsWith("[") && part.endsWith("]")) || part === wanted[i])
  })
}

const source = fs.readFileSync(path.join(ROOT, "src", "lib", "portal-components.ts"), "utf8")

const itemHrefs = [...new Set([...source.matchAll(/\bhref\s*:\s*"([^"]+)"/g)].map((m) => m[1]))]
const homeHrefs = [...new Set([...source.matchAll(/\bhomeHref\s*:\s*"([^"]+)"/g)].map((m) => m[1]))]

describe("portal navigation links resolve to real routes", () => {
  it("discovers the app's routes", () => {
    expect(ROUTES.length).toBeGreaterThan(50)
    expect(ROUTES).toContain("/contractor/warehouses")
  })

  it("finds nav links to check", () => {
    expect(itemHrefs.length).toBeGreaterThan(20)
    expect(homeHrefs.length).toBeGreaterThan(5)
  })

  it("has no sidebar item pointing at a missing page", () => {
    const broken = itemHrefs.filter((h) => h.startsWith("/") && !resolves(h))
    expect(broken).toEqual([])
  })

  // A broken homeHref is the worst version of this bug: it breaks the whole
  // component's entry point in the app switcher, not one sidebar row.
  it("has no component home pointing at a missing page", () => {
    const broken = homeHrefs.filter((h) => h.startsWith("/") && !resolves(h))
    expect(broken).toEqual([])
  })

  it("matches dynamic segments and ignores query strings", () => {
    // Guards the resolver itself, so a future bug cannot hide behind it
    // silently passing everything.
    expect(resolves("/contractor/profile?tab=legal")).toBe(true)
    expect(resolves("/contractor/warehouses/anything-at-all")).toBe(true)
    expect(resolves("/contractor/definitely-not-a-page")).toBe(false)
  })
})

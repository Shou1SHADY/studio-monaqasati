import {
  CONTRACTOR_COMPONENTS,
  SUPPLIER_COMPONENTS,
  hrefPathname,
  resolveNavTrail,
} from "@/lib/portal-components"

/**
 * Guards `resolveNavTrail`, which feeds the portal breadcrumb bar.
 *
 * The bar is the only in-page way out of a section, so a trail that resolves
 * to the wrong item sends people somewhere they did not come from — quietly,
 * and on every page of that module.
 */

const contractorTrail = (pathname: string) => resolveNavTrail(CONTRACTOR_COMPONENTS, pathname)

/**
 * What the bar actually renders after the portal root: the module's home,
 * then the crumbs. `resolveNavTrail` drops a crumb that merely repeats the
 * module home, so a route's own page can be represented by either one.
 */
const trailPaths = (pathname: string) => {
  const { component, crumbs } = contractorTrail(pathname)
  return [hrefPathname(component.homeHref), ...crumbs.map((c) => hrefPathname(c.href))]
}

describe("resolveNavTrail", () => {
  it("names the module that owns the route", () => {
    expect(contractorTrail("/contractor/warehouses").component.id).toBe("warehouses")
    expect(contractorTrail("/contractor/crm/leads").component.id).toBe("crm")
    // Project Management is the catch-all: its home is the bare portal root.
    expect(contractorTrail("/contractor/projects").component.id).toBe("project-management")
  })

  it("resolves a list route to its own nav item", () => {
    expect(trailPaths("/contractor/projects")).toContain("/contractor/projects")
    expect(trailPaths("/contractor/warehouses")).toContain("/contractor/warehouses")
  })

  it("resolves a detail route to its parent list, not to the record", () => {
    const paths = trailPaths("/contractor/projects/abc123")
    expect(paths).toContain("/contractor/projects")
    // The registry has no name for a record id, so nothing may claim to be one.
    expect(paths.some((p) => p.includes("abc123"))).toBe(false)
  })

  // The dashboard item's href prefixes every route in the portal, so without
  // an explicit guard it matches them all and duplicates the root crumb.
  it("never emits the portal root as a crumb", () => {
    for (const pathname of [
      "/contractor/not-a-real-section",
      "/contractor/projects/abc123",
      "/contractor/crm/leads",
      "/contractor/warehouses/requests",
    ]) {
      const paths = contractorTrail(pathname).crumbs.map((c) => hrefPathname(c.href))
      expect(paths).not.toContain("/contractor")
    }
    const supplierPaths = resolveNavTrail(SUPPLIER_COMPONENTS, "/supplier/orders/xyz")
      .crumbs.map((c) => hrefPathname(c.href))
    expect(supplierPaths).not.toContain("/supplier")
  })

  it("prefers the longest matching item, not the first", () => {
    // `/contractor/warehouses/requests` sits under the Warehouses prefix too;
    // the deeper item has to win or the crumb points at the wrong page.
    const { crumbs } = contractorTrail("/contractor/warehouses/requests")
    expect(hrefPathname(crumbs[crumbs.length - 1].href)).toBe("/contractor/warehouses/requests")
  })

  it("never repeats the module home as a crumb", () => {
    for (const components of [CONTRACTOR_COMPONENTS, SUPPLIER_COMPONENTS]) {
      for (const component of components) {
        for (const section of component.sections) {
          for (const item of section.items) {
            const path = hrefPathname(item.href)
            const { crumbs } = resolveNavTrail(components, path)
            const homes = crumbs.filter((c) => hrefPathname(c.href) === hrefPathname(component.homeHref))
            expect(homes).toEqual([])
          }
        }
      }
    }
  })

  it("falls back to the module home for a route the registry does not know", () => {
    const { component, crumbs } = contractorTrail("/contractor/not-a-real-section")
    expect(crumbs).toEqual([])
    // Still a real destination, so the bar is never a dead end.
    expect(component.homeHref).toBeTruthy()
  })

  it("puts a matched child under its parent", () => {
    const withChildren = CONTRACTOR_COMPONENTS.flatMap((c) =>
      c.sections.flatMap((s) => s.items.filter((i) => i.children?.length))
    )
    // Only meaningful while the registry actually nests something.
    if (withChildren.length === 0) return
    const parent = withChildren[0]
    const child = parent.children![0]
    const { crumbs } = contractorTrail(hrefPathname(child.href))
    const keys = crumbs.map((c) => c.titleKey)
    expect(keys).toContain(child.titleKey)
    if (hrefPathname(parent.href) !== hrefPathname(child.href)) {
      expect(keys.indexOf(parent.titleKey)).toBeLessThan(keys.indexOf(child.titleKey))
    }
  })
})

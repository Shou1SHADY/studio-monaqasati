/**
 * My to-dos and Documents are components of their own (Odoo-style apps): a tile on the home grid, an entry in the
 * app switcher and launcher, for every member of both portals, and no longer a loose link in the shared sidebar section.
 */

import {
  CONTRACTOR_COMMUNICATION_SECTION,
  CONTRACTOR_COMPONENTS,
  SUPPLIER_COMMUNICATION_SECTION,
  SUPPLIER_COMPONENTS,
  resolveActiveContractorComponent,
  resolveActiveSupplierComponent,
  visibleComponents,
} from "@/lib/portal-components"

const nobody = () => false
const ids = (list: { id: string }[]) => list.map((c) => c.id)

describe.each([
  ["contractor", CONTRACTOR_COMPONENTS, CONTRACTOR_COMMUNICATION_SECTION, resolveActiveContractorComponent],
  ["supplier", SUPPLIER_COMPONENTS, SUPPLIER_COMMUNICATION_SECTION, resolveActiveSupplierComponent],
] as const)("%s portal", (portal, components, communication, resolve) => {
  it("shows both as tiles to a member who holds no permission at all", () => {
    expect(ids(visibleComponents([...components], nobody))).toEqual(expect.arrayContaining(["activities", "documents"]))
  })

  it("sorts them after the business modules", () => {
    const order = visibleComponents([...components], nobody).map((c) => c.displayOrder)
    const own = (id: string) => components.find((c) => c.id === id)!.displayOrder
    expect(Math.min(own("activities"), own("documents"))).toBeGreaterThan(Math.max(...order.filter((o) => o !== own("activities") && o !== own("documents"))))
    expect(new Set(components.map((c) => c.displayOrder)).size).toBe(components.length)
  })

  it("owns its own page, so the sidebar and the breadcrumb are the component's", () => {
    expect(resolve(`/${portal}/activities`).id).toBe("activities")
    expect(resolve(`/${portal}/documents`).id).toBe("documents")
    expect(resolve(`/${portal}`).id).toBe("project-management")
  })

  it("is one tile each: the home page of the component is the page itself", () => {
    expect(components.find((c) => c.id === "activities")?.homeHref).toBe(`/${portal}/activities`)
    expect(components.find((c) => c.id === "documents")?.homeHref).toBe(`/${portal}/documents`)
  })

  it("no longer repeats them in the shared communication section", () => {
    const hrefs = communication.items.map((i) => i.href)
    expect(hrefs).not.toContain(`/${portal}/activities`)
    expect(hrefs).not.toContain(`/${portal}/documents`)
    expect(hrefs).toEqual(expect.arrayContaining([`/${portal}/chats`, `/${portal}/team-chat`, `/${portal}/notifications`]))
  })

  it("has its own label and description in both languages", () => {
    const en = jest.requireActual<{ Portal: { Sidebar: Record<string, string> } }>("../../messages/en.json").Portal.Sidebar
    const ar = jest.requireActual<{ Portal: { Sidebar: Record<string, string> } }>("../../messages/ar.json").Portal.Sidebar
    for (const id of ["activities", "documents"]) {
      const c = components.find((x) => x.id === id)!
      for (const key of [c.labelKey, c.descKey]) expect([en[key], ar[key]].every((v) => typeof v === "string" && v.length > 0)).toBe(true)
    }
  })
})

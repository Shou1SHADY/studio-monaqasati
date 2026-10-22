/** @jest-environment node */
/**
 * Procurement 2.0 — the requester's («طالب مواد») way in (REQ-01): a member who holds none of Procurement's permissions sees one
 * entry, «طلباتي», in the sidebar and in the rail; whoever holds any of them does not see it, and the buyers' eight pages stay
 * as they were.
 */

import { CONTRACTOR_COMPONENTS, itemIsVisible, visibleItems } from "@/lib/portal-components"
import { PROC_TABS, visibleProcTabs } from "@/lib/procurement/shell"
import { PROC_MINE_HREF, PROC_SECTION_PERMISSIONS } from "@/lib/procurement/tab-gates"
import type { PermissionId } from "@/lib/permissions"

const holds = (...ps: PermissionId[]) => (p: PermissionId) => ps.includes(p)
const procurement = CONTRACTOR_COMPONENTS.find((c) => c.id === "procurement")!
const items = procurement.sections[0].items

describe("«طلباتي» for the requester", () => {
  it("a member with no Procurement permission sees exactly that entry in the Procurement sidebar, and the module is worth opening", () => {
    const can = holds("projects.view" as PermissionId)
    expect(visibleItems(items, can).map((i) => [i.titleKey, i.href])).toEqual([["contractor_my_requests", PROC_MINE_HREF]])
    expect(procurement.sections.some((s) => visibleItems(s.items, can).length > 0)).toBe(true)
  })

  it("whoever holds any Procurement permission does not see it, and the owner does not either", () => {
    for (const p of PROC_SECTION_PERMISSIONS) {
      expect({ p, mine: visibleItems(items, holds(p)).some((i) => i.href === PROC_MINE_HREF) }).toEqual({ p, mine: false })
    }
    expect(itemIsVisible(items.find((i) => i.href === PROC_MINE_HREF)!, () => true)).toBe(false)
  })

  it("the rail carries the same single tab for him; the buyers' eight pages are unchanged for everyone else", () => {
    expect(visibleProcTabs(holds()).map((t) => [t.id, t.href, t.railKey])).toEqual([["mine", PROC_MINE_HREF, "proc_tab_mine"]])
    expect(visibleProcTabs(holds("rfq.manage")).map((t) => t.id)).toContain("requests")
    expect(visibleProcTabs(holds("rfq.manage")).some((t) => t.id === "mine")).toBe(false)
    expect(PROC_TABS).toHaveLength(8)
  })
})

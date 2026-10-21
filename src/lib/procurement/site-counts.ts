// Delivery sites read across Procurement (PUR-10, Project Management out of the package): which site an
// order serves, what the reports and the orders list group by, and how many requests are open at each site
// («مواقع التسليم» in the settings). Pure.

import { projectSiteId, type DeliverySite } from "./delivery-sites"
import type { Need } from "./needs"
import type { PurchaseOrder } from "./types"

type RfqProducts = { id: string; products?: Array<{ deliverySiteId?: string | null } | null | undefined> | null }

/** The sites an order's lines deliver to: the site its RFQ line named, else the order's project's site. */
export function orderSiteIds(po: Pick<PurchaseOrder, "projectId" | "rfqId" | "lines">, rfqs: RfqProducts[]): string[] {
  const rfq = po.rfqId ? rfqs.find((r) => r.id === po.rfqId) : undefined
  const ids = new Set<string>()
  for (const l of po.lines) {
    const id = l.rfqProductIndex != null ? rfq?.products?.[l.rfqProductIndex]?.deliverySiteId : null
    if (id) ids.add(id)
  }
  if (!ids.size && po.projectId) ids.add(projectSiteId(po.projectId))
  return [...ids]
}

export const NO_SITE = "__no_site__"

/** "all" passes everything; NO_SITE the orders that name no site; otherwise the order must deliver to that site on a line. */
export const inSiteFilter = (siteIds: string[], filter: string): boolean => filter === "all" || (filter === NO_SITE ? siteIds.length === 0 : siteIds.includes(filter))

/** The request still open at a site: a need Procurement has not finished (`done` is finished) that names the site, or its project's. */
export function openRequestsBySite(needs: Array<Pick<Need, "state" | "siteId" | "projectId">>, sites: Array<Pick<DeliverySite, "id" | "projectId">>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of sites) {
    out[s.id] = needs.filter((n) => n.state !== "done" && (n.siteId === s.id || (!!s.projectId && n.projectId === s.projectId))).length
  }
  return out
}

/**
 * Features that are built but deliberately not released yet.
 *
 * A flag here is the SINGLE switch for a feature: it dims the nav entry,
 * blocks the routes, and hides every in-app link that would otherwise lead
 * there. Flip one boolean to release — never disable a feature by deleting
 * its nav item, because that leaves the routes reachable by URL and the
 * inbound links pointing at a live page.
 */

/**
 * The delivery-receipt REGISTER at `/contractor/receipts` — the searchable
 * finance-side list. That page is new and has never shipped, so holding it
 * back takes nothing away.
 *
 * Scope is deliberately narrow. The printable receipt at
 * `/contractor/receipts/[id]` is NOT gated: it has been live all along,
 * reached from Goods Received and the RFQ offers view, and disabling it
 * would break a working flow. Never widen this flag to cover a route that
 * already shipped.
 *
 * Set to `false` to release the register. That re-enables both the page and
 * the Finance → سندات الاستلام sidebar entry (see portal-components.ts).
 */
export const RECEIPTS_COMING_SOON = true

/**
 * سوق المواد — the quick materials catalog at `/contractor/catalog`.
 *
 * Held back pending a decision on whether it earns its place: the premise is
 * to surface frequently repeated materials, but cement, rebar and ceramic
 * recur on essentially every project, so the shortlist adds little over the
 * normal RFQ flow. The likely salvage is to point it at material requests
 * rather than RFQs.
 *
 * Dimmed rather than deleted, so the feature is one boolean away from either
 * outcome. `upsertCatalogItems` in RfqForm deliberately KEEPS writing
 * `contractorCatalog` while this is on — the recurring-item history is what
 * makes the page worth anything on the day it ships, and it costs nothing to
 * accrue in the meantime.
 *
 * Set to `false` to release, or delete this flag together with the route,
 * `ContractorCatalog.tsx`, the nav entry and the `catalog_*` message keys.
 */
export const CATALOG_COMING_SOON = true

// Who opens each Procurement tab — ONE list, read by the rail
// (`./shell.ts`) and by the sidebar (`src/lib/portal-components.ts`), so the
// two navigations can never disagree. The prototype's TABS(): everyone but
// the expediter sees the incoming requests and the RFQs (the manager and the
// buyer source); every role sees orders, receipts, suppliers, reports and the
// boundaries. The owner passes every check. Type-only imports: the sidebar
// bundle pulls nothing else in.

import { PERMISSION_SECTIONS, type PermissionId } from "../permissions"

export type ProcTabId = "today" | "rfqs" | "requests" | "orders" | "receipts" | "suppliers" | "reports" | "settings" | "mine"

/** Every permission of the Procurement section — holding any one opens Today. */
export const PROC_ANY_PERMISSION: PermissionId[] = ["rfq.create", "rfq.manage", "offers.view", "offers.accept", "po.approve", "po.expedite", "suppliers.manage", "deliveries.confirm"]

/** The manager (po.approve) and the buyer (offers.accept, or rfq.manage/rfq.create) source. */
const SOURCING: PermissionId[] = ["rfq.manage", "rfq.create", "offers.accept", "po.approve"]
/** Whoever sees prices, plus the expediter (dates and quantities only). */
const ORDER_ROLES: PermissionId[] = ["offers.view", "offers.accept", "po.approve", "po.expedite"]

/** Every permission of the Procurement section. A member who holds none of them is a requester («طالب مواد»): his one entry is «طلباتي». */
export const PROC_SECTION_PERMISSIONS: PermissionId[] = PERMISSION_SECTIONS.find((s) => s.key === "procurement")?.permissions ?? []

export const PROC_MINE_HREF = "/contractor/rfqs/my-requests"

export const PROC_TAB_GATES: Record<ProcTabId, PermissionId[]> = {
  mine: [],
  today: PROC_ANY_PERMISSION,
  requests: SOURCING,
  rfqs: SOURCING,
  orders: ORDER_ROLES,
  receipts: ["deliveries.confirm", ...ORDER_ROLES],
  suppliers: ["suppliers.manage", ...ORDER_ROLES],
  reports: ORDER_ROLES,
  settings: ORDER_ROLES,
}

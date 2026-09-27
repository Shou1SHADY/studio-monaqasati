// HR 1.0 — the module's Firestore collections, in one place.

/** The employee record (non-pay facts). Kept under its historical name. */
export const HR_EMPLOYEES = "employees"
/** Pay and bank, readable by money roles and the employee himself (RL-03). */
export const HR_PAY = "employeePay"
/** Workplaces: project sites, workshop, warehouse, fleet, showroom, department, head office. */
export const HR_SITES = "hrSites"
/** Month attendance per workplace (`{siteId}__{YYYY-MM}`). */
export const HR_ATTENDANCE = "hrAttendance"
/** Every request: leave, advance, letter, data update, violation, pay change, exit… */
export const HR_REQUESTS = "hrRequests"
/** Payrolls (`{orgId}__{YYYY-MM}` or `…-D`). */
export const HR_PAYROLLS = "hrPayrolls"
/** HR → Finance outbox; the doc id is the idempotency key. */
export const HR_EVENTS = "hrEvents"
export const HR_VIOLATIONS = "hrViolations"
export const HR_EXITS = "hrExits"
export const HR_SETTLEMENTS = "hrSettlements"

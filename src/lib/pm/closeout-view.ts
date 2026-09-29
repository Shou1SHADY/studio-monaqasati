// Which closeout rows a viewer sees — one rule for the Closeout panel and the
// sub-tab's badge, so the count on the tab is the count on the screen. The
// client-money rows are shown to holders of money who also see the client side
// (the prototype's closeRows `CAN('client')`); the gate itself counts them for
// everyone. A certificate in progress, overdue collection and a priced variation
// still undecided are not checklist rows: they are the open money under it
// (prototype closePanel «ويمنع الإغلاق مال مفتوح»), still part of the gate. Pure.

import type { CloseRow } from "./closeout"

export const CLIENT_MONEY_ROWS: ReadonlySet<CloseRow["key"]> = new Set<CloseRow["key"]>(["unbilled", "in_progress", "overdue", "retention", "vo_pending"])

export const OPEN_MONEY_ROWS: ReadonlySet<CloseRow["key"]> = new Set<CloseRow["key"]>(["in_progress", "overdue", "vo_pending"])

export const shownCloseRows = <R extends Pick<CloseRow, "key" | "ok">>(rows: R[], clientMoney: boolean): R[] =>
  rows.filter((r) => !OPEN_MONEY_ROWS.has(r.key) && (clientMoney || !CLIENT_MONEY_ROWS.has(r.key)))

/** The open money that also blocks closing — for whoever sees the client side's money. */
export const openMoneyRows = <R extends Pick<CloseRow, "key" | "ok">>(rows: R[], clientMoney: boolean): R[] => (clientMoney ? rows.filter((r) => OPEN_MONEY_ROWS.has(r.key) && !r.ok) : [])

export const openCloseRows = (rows: Array<Pick<CloseRow, "key" | "ok">>, clientMoney: boolean): number => shownCloseRows(rows, clientMoney).filter((r) => !r.ok).length

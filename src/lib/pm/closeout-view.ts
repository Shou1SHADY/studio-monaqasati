// Which closeout rows a viewer sees — one rule for the Closeout panel and the
// sub-tab's badge, so the count on the tab is the count on the screen. The
// client-money rows are shown to holders of money who also see the client side
// (the prototype's closeRows `CAN('client')`); the gate itself counts them for
// everyone. Pure: no I/O.

import type { CloseRow } from "./closeout"

export const CLIENT_MONEY_ROWS: ReadonlySet<CloseRow["key"]> = new Set<CloseRow["key"]>(["unbilled", "in_progress", "overdue", "retention"])

export const shownCloseRows = <R extends Pick<CloseRow, "key" | "ok">>(rows: R[], clientMoney: boolean): R[] => (clientMoney ? rows : rows.filter((r) => !CLIENT_MONEY_ROWS.has(r.key)))

export const openCloseRows = (rows: Array<Pick<CloseRow, "key" | "ok">>, clientMoney: boolean): number => shownCloseRows(rows, clientMoney).filter((r) => !r.ok).length

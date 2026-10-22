// What «ألغِ الأمر» does with the order's materials once the order is cancelled (WF-25, R-11). The cancel route records the buyer's
// choice on the order (`cancelChoice: { why, then, version, resolved: false }`) in the transaction that cancels it, then calls this:
// `reaward` → the RFQ returns to the comparison without his offer, the other orders' lines stay locked; `back` → the lines are let go
// and return to «الواردة»; `none` → nothing (refused by the route when a request points at the order). The mechanics are in `reaward-server`.

import { onCancelChoiceImpl } from "./reaward-server"
import type { OnCancel } from "./po-server"

export const onCancelChoice: OnCancel = onCancelChoiceImpl

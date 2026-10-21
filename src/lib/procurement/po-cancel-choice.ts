// What «ألغِ الأمر» does with the order's materials once the order is cancelled (WF-25, R-11) — wave C's seam.
//
// The cancel route records the buyer's choice on the order itself (`cancelChoice: { why, then, version, resolved: false }`) and the
// new version, in the same transaction that cancels it, then calls this. Until the award route lands it is a no-op: an unresolved
// choice stays on the order for wave C to pick up (`reaward` → the RFQ returns to the comparison without his offer, the other
// orders' lines stay locked; `back` → the request lines return to «الواردة»; `none` → nothing, refused when a request points at it).
// Wave C replaces the body; the route and its tests do not change.

import type { OnCancel } from "./po-server"

export const onCancelChoice: OnCancel = async () => {}

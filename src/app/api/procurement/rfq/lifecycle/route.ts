import { lifecycleSchema, runLifecycle } from "@/lib/procurement/rfq-server/lifecycle"
import { rfqRoute } from "../publish-kit"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// An RFQ's life after it is published: extend or reopen it with a later date, cancel it with a reason (its lines go back to
// «الواردة»), remind those who have not quoted (RFQ-13, RFQ-14, RFQ-15, WF-26, R-12).
export async function POST(req: Request) {
  return rfqRoute(req, "rfq lifecycle", (raw) => lifecycleSchema.safeParse(raw), (db, caller, input) => runLifecycle(db, caller, input))
}

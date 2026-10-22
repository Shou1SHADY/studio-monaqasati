import { publishRfq, publishSchema } from "@/lib/procurement/rfq-server/publish"
import { rfqRoute } from "../publish-kit"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// «انشر»: the editor's rows become ONE RFQ here (ED-01, ED-05..08, WF-06, WF-28) — the rows, the city of every place, the deadline
// (today or later, Riyadh), the audience and the supplier it may be sent to are checked where they cannot be skipped; the number is
// drawn in the same transaction; the lines it took are linked to their requests (one line, one place); the visitor link is made
// only for «عام» or when asked. A direct award is an OPEN private RFQ to one supplier, estimated from the last prices.
export async function POST(req: Request) {
  return rfqRoute(req, "rfq publish", (raw) => publishSchema.safeParse(raw), (db, caller, input) => publishRfq(db, caller, input))
}

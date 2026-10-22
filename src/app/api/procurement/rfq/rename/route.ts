import { renameRfq, renameSchema } from "@/lib/procurement/rfq-server/lifecycle"
import { rfqRoute } from "../publish-kit"

export const dynamic = "force-dynamic"

// «✎» on the RFQ page: the name suppliers read in the request and on the visitor link (ED-05, RFQ-14).
export async function POST(req: Request) {
  return rfqRoute(req, "rfq rename", (raw) => renameSchema.safeParse(raw), (db, caller, input) => renameRfq(db, caller, input))
}

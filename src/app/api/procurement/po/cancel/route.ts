import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { CANCEL_THEN, CANCEL_WHY, cancelOrder } from "@/lib/procurement/po-server"
import { onCancelChoice } from "@/lib/procurement/po-cancel-choice"

// «ألغِ {no}»: one of five reasons ("other" with its words) and what happens to its materials — re-award from the RFQ's offers, back to
// «الواردة», or nothing. The order is cancelled as a new version and the choice is recorded on it; the mechanics are wave C's hook.
const body = z.object({ poId, why: z.enum(CANCEL_WHY), note: z.string().trim().max(500).nullish(), then: z.enum(CANCEL_THEN), locale: localeField })

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po cancel", body, async (ctx, input) => orderOut(await cancelOrder(ctx, input, onCancelChoice)))
}

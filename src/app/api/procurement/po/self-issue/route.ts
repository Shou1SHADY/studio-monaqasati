import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { approveOrder } from "@/lib/procurement/po-server"

// «أصدر أمري» — a buyer issues his OWN direct order at or under the company's self-issue limit (R-32): no approver, flagged on the
// order and in the exceptions report. The limit is read from the company's policies here, never from the screen.
const body = z.object({ poId, locale: localeField })

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po self-issue", body, async (ctx, input) => orderOut(await approveOrder(ctx, { poId: input.poId, selfIssue: true })))
}

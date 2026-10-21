import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { approveOrder } from "@/lib/procurement/po-server"

// «اعتمده» — the limit INCLUDING VAT, never the preparer's own order (the owner excepted), the owner alone above the limit and for a
// direct award above the cap. `asOwner` is the award window's «اعتمده الآن بصفتك المالك».
const body = z.object({ poId, asOwner: z.boolean().optional(), locale: localeField })

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po approve", body, async (ctx, input) => orderOut(await approveOrder(ctx, input)))
}

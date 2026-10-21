import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { approveAdvance } from "@/lib/procurement/po-server"

// PO-14: an advance to a supplier with no supply record is approved by the OWNER before Finance is asked for it.
const body = z.object({ poId, locale: localeField })

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po advance approve", body, async (ctx, input) => orderOut(await approveAdvance(ctx, input)))
}

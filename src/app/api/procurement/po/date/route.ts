import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { changeDate } from "@/lib/procurement/po-server"

// A new delivery date after the order was sent is a new VERSION of the order; the supplier accepts it.
const body = z.object({ poId, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(500).nullish(), locale: localeField })

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po date", body, async (ctx, input) => orderOut(await changeDate(ctx, input)))
}

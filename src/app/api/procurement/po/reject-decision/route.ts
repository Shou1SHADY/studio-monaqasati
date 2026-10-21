import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { decideRejected } from "@/lib/procurement/po-server"

const body = z.object({
  poId,
  lineId: z.string().trim().min(1).max(64),
  decision: z.enum(["replace", "discount", "reduce"]),
  note: z.string().trim().max(500).nullish(),
  replaceBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  discountPrice: z.number().finite().positive().max(1e9).nullish(),
  locale: localeField,
})

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po reject decision", body, async (ctx, input) => orderOut(await decideRejected(ctx, input)))
}

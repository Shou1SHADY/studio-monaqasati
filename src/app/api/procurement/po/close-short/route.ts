import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { closeShort } from "@/lib/procurement/po-server"

const body = z.object({ poId, reason: z.string().trim().min(1).max(500), locale: localeField })

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po close short", body, async (ctx, input) => orderOut(await closeShort(ctx, input)))
}

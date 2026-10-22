import { NextRequest } from "next/server"
import { z } from "zod"
import { linkAct } from "@/lib/procurement/po-link-route"
import { linkReportDelivery, reloadOrder } from "@/lib/procurement/po-link-server"

// G-08: a day (today, tomorrow, the day after) and a note — `.strict()` refuses a quantity, a driver, a plate, a paper.
const body = z.object({ offset: z.union([z.literal(0), z.literal(1), z.literal(2)]), note: z.string().trim().max(500).nullish() }).strict()

export const POST = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) =>
  linkAct(req, ctx, "order link report", body, async (db, r, input) => {
    await linkReportDelivery(db, r, input)
    return reloadOrder(db, r.poId)
  })

import { NextRequest } from "next/server"
import { z } from "zod"
import { linkAct, localeField } from "@/lib/procurement/po-link-route"
import { linkPost, reloadOrder } from "@/lib/procurement/po-link-server"

const body = z
  .object({
    text: z.string().trim().max(2000).nullish(),
    file: z.object({ name: z.string().trim().min(1).max(120), url: z.string().url().max(2000) }).nullish(),
    locale: localeField,
  })
  .strict()

export const POST = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) =>
  linkAct(req, ctx, "order link reply", body, async (db, r, input) => {
    await linkPost(db, r, input)
    return reloadOrder(db, r.poId)
  })

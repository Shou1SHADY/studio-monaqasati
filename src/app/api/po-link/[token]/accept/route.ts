import { NextRequest } from "next/server"
import { z } from "zod"
import { linkAct, localeField } from "@/lib/procurement/po-link-route"
import { linkAccept } from "@/lib/procurement/po-link-server"

const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), locale: localeField }).strict()

export const POST = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => linkAct(req, ctx, "order link accept", body, (db, r, input) => linkAccept(db, r, input))

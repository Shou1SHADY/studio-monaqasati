import { NextRequest } from "next/server"
import { z } from "zod"
import { linkAct, localeField } from "@/lib/procurement/po-link-route"
import { linkRequestChange } from "@/lib/procurement/po-link-server"

const body = z.object({ text: z.string().trim().min(3).max(1000), locale: localeField }).strict()

export const POST = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => linkAct(req, ctx, "order link change request", body, (db, r, input) => linkRequestChange(db, r, input))

import { NextRequest } from "next/server"
import { z } from "zod"
import { linkAct } from "@/lib/procurement/po-link-route"
import { linkAcceptVersion } from "@/lib/procurement/po-link-server"

const body = z.object({ version: z.number().int().min(2).max(999) }).strict()

export const POST = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => linkAct(req, ctx, "order link version", body, (db, r, input) => linkAcceptVersion(db, r, input))

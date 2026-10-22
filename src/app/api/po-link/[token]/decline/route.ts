import { NextRequest } from "next/server"
import { z } from "zod"
import { POL_DECLINE_REASONS } from "@/lib/po-link"
import { linkAct, localeField } from "@/lib/procurement/po-link-route"
import { linkDecline } from "@/lib/procurement/po-link-server"

const body = z.object({ reason: z.enum(POL_DECLINE_REASONS), note: z.string().trim().max(500).nullish(), locale: localeField }).strict()

export const POST = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => linkAct(req, ctx, "order link decline", body, (db, r, input) => linkDecline(db, r, input))

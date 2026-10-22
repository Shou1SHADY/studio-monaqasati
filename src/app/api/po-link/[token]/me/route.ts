import { NextRequest } from "next/server"
import { z } from "zod"
import { linkAct } from "@/lib/procurement/po-link-route"
import { linkRead } from "@/lib/procurement/po-link-server"

// The supplier opened the conversation: it marks what the buyer wrote as read and answers the order as it stands.
export const POST = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => linkAct(req, ctx, "order link me", z.object({}).strict(), (db, r) => linkRead(db, r))

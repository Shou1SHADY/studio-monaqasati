import { NextRequest } from "next/server"
import { linkRead } from "@/lib/procurement/po-link-route"

// The order a supplier outside the platform opens from the message the buyer sent him: one purchase order, as he may see it.
export const GET = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => linkRead(req, ctx)

import { NextRequest } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { localeField, orderOut, poId, supplierRoute } from "@/lib/procurement/po-route"
import { asPoAct } from "@/lib/procurement/po-message-route"
import { postAsCaller } from "@/lib/procurement/po-messages-server"

// One message in the order's conversation, from either side: the buyer's team, or the registered supplier in his portal.
// The side is read from the caller and the order, never from the request.
const body = z
  .object({
    poId,
    text: z.string().trim().max(2000).nullish(),
    file: z.object({ name: z.string().trim().min(1).max(120), url: z.string().url().max(2000) }).nullish(),
    channel: z.enum(["portal", "whatsapp"]).optional(),
    locale: localeField,
  })
  .strict()

export async function POST(req: NextRequest) {
  return supplierRoute(req, "po message", body, async (caller, input) => {
    const { message, po } = await asPoAct(() => postAsCaller(getAdminFirestore(), caller, input))
    return orderOut(po, { seq: message.seq })
  })
}

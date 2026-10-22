import { NextRequest } from "next/server"
import { z } from "zod"
import { buyerRoute, localeField, orderOut, poId } from "@/lib/procurement/po-route"
import { sendOrder } from "@/lib/procurement/po-server"
import { mintOrderLink } from "@/lib/procurement/po-link-server"

// Sending: a registered supplier gets the order in his portal; an off-platform one gets the order LINK in a message the buyer sends
// from his own device (WhatsApp or e-mail — nothing is sent from here). `link` is the order link (only its hash is kept), minted here for WhatsApp and e-mail.
const body = z.object({
  poId,
  channel: z.enum(["portal", "whatsapp", "email", "outside"]),
  contact: z.object({ phone: z.string().trim().max(32).nullish(), email: z.string().trim().max(160).nullish() }).nullish(),
  locale: localeField,
})

export async function POST(req: NextRequest) {
  return buyerRoute(req, "po send", body, async (ctx, input) => {
    const sent = await sendOrder({ ...ctx, mintOrderLink }, input)
    return orderOut(sent.po, { link: sent.link })
  })
}

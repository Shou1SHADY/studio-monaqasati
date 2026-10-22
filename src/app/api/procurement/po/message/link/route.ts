import { NextRequest } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { PoActError } from "@/lib/procurement/po-server"
import { poId, supplierRoute } from "@/lib/procurement/po-route"
import { mintOrderLink } from "@/lib/procurement/po-link-server"
import { mayTalkToSupplier } from "@/lib/procurement/po-messages-server"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"

// The order link again, for the message the buyer is about to send from his own phone (or to look at the page as the supplier
// does). Only hashes are stored, so each call hands back a fresh address; the ones already sent keep working. Never for an order
// that has not been sent, and never to anyone but the order's own company.
const body = z.object({ poId }).strict()

export async function POST(req: NextRequest) {
  return supplierRoute(req, "po message link", body, async (caller, input) => {
    const db = getAdminFirestore()
    const snap = await db.collection(PURCHASE_ORDERS).doc(input.poId).get()
    const po = snap.exists ? ({ ...(snap.data() as Omit<PurchaseOrder, "id">), id: snap.id } as PurchaseOrder) : null
    if (!po || po.organizationId !== caller.orgId) throw new PoActError("order_missing")
    if (!mayTalkToSupplier(caller)) throw new PoActError("no_permission")
    if (!po.sentAt || po.status === "cancelled") throw new PoActError("wrong_state")
    return { poId: po.id, link: await mintOrderLink(db, po) }
  })
}

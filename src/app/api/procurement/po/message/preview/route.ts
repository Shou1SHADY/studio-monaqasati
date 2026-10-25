import { NextRequest } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { PoActError } from "@/lib/procurement/po-server"
import { poId, supplierRoute } from "@/lib/procurement/po-route"
import { previewOrderLink } from "@/lib/procurement/po-link-server"
import { mayTalkToSupplier } from "@/lib/procurement/po-messages-server"

// «رابط الأمر كما يراه» (PO-02): the order link's page as the off-platform supplier reads it, for the buyer to LOOK at. Strictly
// read-only — no token is minted, nothing is marked read for the supplier, no act is offered; the same checks as minting the link
// (the order's own company, someone who may talk to the supplier, an order that was sent and is not cancelled).
const body = z.object({ poId }).strict()

export async function POST(req: NextRequest) {
  return supplierRoute(req, "po link preview", body, async (caller, input) => {
    if (!mayTalkToSupplier(caller)) throw new PoActError("no_permission")
    return { view: await previewOrderLink(getAdminFirestore(), caller.orgId, input.poId) }
  })
}

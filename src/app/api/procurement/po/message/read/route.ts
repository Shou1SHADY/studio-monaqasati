import { NextRequest } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { orderOut, poId, supplierRoute } from "@/lib/procurement/po-route"
import { asPoAct } from "@/lib/procurement/po-message-route"
import { markReadAsCaller } from "@/lib/procurement/po-messages-server"

// The conversation was opened: what the other side wrote is read.
const body = z.object({ poId }).strict()

export async function POST(req: NextRequest) {
  return supplierRoute(req, "po message read", body, async (caller, input) => {
    const po = await asPoAct(() => markReadAsCaller(getAdminFirestore(), caller, input.poId))
    return orderOut(po)
  })
}

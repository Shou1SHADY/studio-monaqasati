import { NextRequest } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebaseAdmin"
import { orderOut, poId, supplierRoute } from "@/lib/procurement/po-route"
import { acceptVersion } from "@/lib/procurement/po-server"

// The supplier accepts the version of the order the buyer changed (`proc:PO:<no>:V<n>:ACC`). The order link does the same from wave C.
const body = z.object({ poId, version: z.number().int().min(2).max(999) })

export async function POST(req: NextRequest) {
  return supplierRoute(req, "po accept version", body, async (caller, input) =>
    orderOut(await acceptVersion(getAdminFirestore(), { uid: caller.uid, name: caller.name, orgId: caller.orgId }, input))
  )
}

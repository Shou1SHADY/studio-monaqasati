import { NextRequest } from "next/server"
import { createDirectOrder, directBody } from "@/lib/procurement/po-direct-server"
import { raiseRoute } from "@/lib/procurement/po-direct-route"

// «اطلب مباشرة» / the order on a live price agreement — raised on the server: the lines, the agreement, the supplier and the project are
// re-checked, the direct-purchase cap asks its reason and the owner's hand, and the approver class is stored by the server (G-16).
export async function POST(req: NextRequest) {
  return raiseRoute(req, "po direct", directBody, (ctx, input) => createDirectOrder(ctx, input).then((o) => ({ ...o })))
}

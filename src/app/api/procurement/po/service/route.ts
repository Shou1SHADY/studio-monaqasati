import { NextRequest } from "next/server"
import { createServiceOrder, serviceBody } from "@/lib/procurement/po-direct-server"
import { raiseRoute } from "@/lib/procurement/po-direct-route"

// «أمر مباشر لخدمة أو مقطوعية» — one lump-sum line; above the direct-purchase cap it carries its reason and goes to the owner.
export async function POST(req: NextRequest) {
  return raiseRoute(req, "po service", serviceBody, (ctx, input) => createServiceOrder(ctx, input).then((o) => ({ ...o })))
}

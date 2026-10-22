import { NextRequest } from "next/server"
import { createRetroactiveOrder, retroactiveBody } from "@/lib/procurement/po-direct-server"
import { raiseRoute } from "@/lib/procurement/po-direct-route"

// An order raised AFTER the goods arrived: the owner's alone, with its reason, and the receipt it regularises gets the order's number.
export async function POST(req: NextRequest) {
  return raiseRoute(req, "po retroactive", retroactiveBody, (ctx, input) => createRetroactiveOrder(ctx, input).then((o) => ({ ...o })))
}

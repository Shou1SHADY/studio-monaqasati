// The browser's side of the routes that raise an order without an RFQ (`/api/procurement/po/{direct,service,retroactive}`): one call
// with the signed-in user's token. A refusal comes back as a `ProcWriteError`, whose code the screens already translate
// (`Portal.Procurement.err_*`).

import { getAuth } from "firebase/auth"
import type { DirectBody, RetroactiveBody, ServiceBody } from "./po-direct-server"
import { ProcWriteError, type ProcWriteErrorCode } from "./writes"

export interface RaisedOrderOut {
  id: string
  docNumber: string
  approverKind: "manager" | "owner"
  deliveryLinked?: boolean
}

async function raise(path: "direct" | "service" | "retroactive", body: unknown): Promise<RaisedOrderOut> {
  const user = getAuth().currentUser
  if (!user) throw new ProcWriteError("no_permission")
  const res = await fetch(`/api/procurement/po/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: RaisedOrderOut; reason?: string; params?: Record<string, string | number> } | null
  if (res.ok && json?.success && json.data) return json.data
  throw new ProcWriteError((json?.reason || "wrong_state") as ProcWriteErrorCode, json?.params || {})
}

export const placeDirectOrder = (body: DirectBody): Promise<RaisedOrderOut> => raise("direct", body)
export const placeServiceOrder = (body: ServiceBody): Promise<RaisedOrderOut> => raise("service", body)
export const placeRetroactiveOrder = (body: RetroactiveBody): Promise<RaisedOrderOut> => raise("retroactive", body)

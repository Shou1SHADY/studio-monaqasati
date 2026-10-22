// The routes of the order's conversation (`/api/procurement/po/message/*`) answer in the shape of the other purchase-order routes;
// a refusal of the conversation becomes the `err_*` reason the screens already translate.

import { PoActError, type PoActReason } from "./po-server"
import { MessageRefusal, type MessageRefusalCode } from "./po-messages-server"

const REASON: Record<MessageRefusalCode, PoActReason> = {
  order_missing: "order_missing",
  not_yours: "not_your_order",
  not_sent: "wrong_state",
  cancelled: "wrong_state",
  empty: "reason_required",
  file_type: "wrong_state",
  file_big: "wrong_state",
}

export async function asPoAct<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof MessageRefusal) throw new PoActError(REASON[err.code], { code: err.code })
    throw err
  }
}

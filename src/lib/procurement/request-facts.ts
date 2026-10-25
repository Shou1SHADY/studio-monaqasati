// What the Incoming card and the request's panel decide about a request, kept apart from the screens so a test can read it. Pure.

import type { PillTone } from "@/components/module-ui/StatusPill"
import type { RequestCard, RequestState } from "./incoming-requests"

/** One tone per request state — the card, the panel head and the read-only panel alike. */
export const REQUEST_TONE: Record<RequestState, PillTone> = {
  new: "module",
  prepared: "info",
  partial: "violet",
  rfq: "violet",
  order: "info",
  done: "ok",
  failed: "bad",
  withdrawn: "mute",
}
export const requestTone = (s: RequestState): PillTone => REQUEST_TONE[s]

/** Ended requests are drawn faded on the list (the prototype's `.rq.dim`). */
export const requestEnded = (s: RequestState): boolean => s === "done" || s === "failed" || s === "withdrawn"

/**
 * Which panel a press on the request opens: the editor (step 1 «الطلب», then publish and review) while something is still to be
 * published, or the request read only. A PREPARED request whose draft is saved opens read only with «افتح المسودة» — the editor's
 * «جهّزه» would start a second draft beside the saved one (the prototype's `reqTodo` leaves `prep` out).
 */
export function requestPanelMode(card: Pick<RequestCard, "state" | "draftId">): "editor" | "read" {
  if (card.state === "prepared") return card.draftId ? "read" : "editor"
  return card.state === "new" || card.state === "partial" ? "editor" : "read"
}

/** «تعذّر الشراء» is offered on a stored request that still has something to buy, to whoever starts RFQs. */
export const canFailRequest = (card: Pick<RequestCard, "buyLines"> & { need: { incoming?: unknown } }, canStartRfq: boolean): boolean => Boolean(card.need.incoming) && canStartRfq && card.buyLines > 0

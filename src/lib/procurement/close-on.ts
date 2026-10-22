// How an order ends (Procurement 2.0, NFR-08): decided when it is approved, from the package at that moment, and stored on the
// order — never read off today's package. `receipt`: the order ends when the goods are received and counted. `payment`: it ends
// when Finance has paid it. A package change restamps only the orders not yet closed (`package-migration-server.ts`); an order
// approved before this field existed has none and keeps the rule it always had (`financeOn`). Pure.

import { CONNECTOR_SWITCH } from "./package"

export type CloseOn = "receipt" | "payment"

export interface CloseOnFields {
  closeOn?: CloseOn | null
}

/** The rule a new approval takes: with Finance in the package the order waits for its payment, without it receipt is the end. */
export const closeOnFor = (off: readonly string[] | null | undefined): CloseOn => ((off || []).includes(CONNECTOR_SWITCH.fin) ? "receipt" : "payment")

/** True when this order is closed by Finance's payment. The stamp wins; an order without one follows the company's package as it did. */
export const endsOnPayment = (po: CloseOnFields, financeOn: boolean): boolean => (po.closeOn ? po.closeOn === "payment" : financeOn)

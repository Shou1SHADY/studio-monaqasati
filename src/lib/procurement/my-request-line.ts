// The one sentence «طلباتي» shows under a request (Procurement 2.0, the prototype's `teamStatus`): in an RFQ «في عروض RFQ-… · يُغلق …»,
// in an order «في أمر ط.ش-… · موعد المورد …», on its way «في الطريق — يصل …». Quantities and dates only — never a price, never a
// supplier. Pure: it names a `Portal.ProcMyRequests` key and its values.

import type { MyRequest } from "./incoming-state"

export interface RequesterLine {
  key: string
  values: Record<string, string>
}

export function requesterLine(r: Pick<MyRequest, "step" | "failed" | "rfqNumber" | "poNumber" | "promisedDate" | "rfqDeadline" | "transitDate">, fmt: (day: string) => string, po: (n: string) => string = (n) => n): RequesterLine {
  switch (r.step) {
    case "failed":
      return r.failed?.alt ? { key: "line_failed_alt", values: { why: r.failed.why, alt: r.failed.alt } } : r.failed?.why ? { key: "line_failed", values: { why: r.failed.why } } : { key: "line_failed_check", values: {} }
    case "withdrawn":
      return { key: "line_withdrawn", values: {} }
    case "rfq":
      return r.rfqNumber ? { key: r.rfqDeadline ? "line_rfq_ref_date" : "line_rfq_ref", values: { rfq: r.rfqNumber, date: r.rfqDeadline ? fmt(r.rfqDeadline) : "" } } : { key: "line_rfq", values: {} }
    case "order":
      if (r.transitDate) return { key: "line_transit", values: { date: fmt(r.transitDate) } }
      if (r.poNumber) return { key: r.promisedDate ? "line_order_ref_date" : "line_order_ref", values: { po: po(r.poNumber), date: r.promisedDate ? fmt(r.promisedDate) : "" } }
      return r.promisedDate ? { key: "line_order_date", values: { date: fmt(r.promisedDate) } } : { key: "line_order", values: {} }
    default:
      return { key: `line_${r.step}`, values: {} }
  }
}

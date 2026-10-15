// The free supplier's world (Supplier 1.0 PRD). One `Deal` is everything a supplier
// has with one contractor request: the request, his quote and its versions, the
// order laid over it, the goods receipts the CONTRACTOR recorded, the invoice and
// the transfers. A deal is derived from the live collections (`derive.ts`); nothing
// here is stored as a deal, so a figure can never disagree with its source.

export type DealChannel = "public" | "invite" | "link"
export type PricingMode = "item" | "total"
export type SupplierCategory = "blocks" | "cement" | "steel" | "insulation" | "doors" | "plumbing" | "electric" | "finishes"

export type OfferStatus = "review" | "reduce" | "sample" | "sampleSent" | "won" | "lost" | "noaward" | "withdrawn" | "noquote"
export type OutcomeWhy = "price" | "time" | "spec" | "cancelled" | "need" | "reissue" | "incomplete" | "docs" | "other"

export interface DealItem {
  id: string
  name: string
  unit: string
  qty: number
  spec: string
}

export interface DealFile {
  n: string
  s: string
  url?: string
}

export interface DealQuestion {
  q: string
  a: string | null
  at: string
}

export interface QuoteVersion {
  at: string
  /** Unit price per item id; `null` = "not supplied". Empty on a total-priced request. */
  prices: Record<string, number | null>
  total?: number
  arrive: string
  valid: string
  note: string
  file?: string | null
}

export interface DealOffer {
  status: OfferStatus
  v: QuoteVersion[]
  reduce?: { at: string; target: number; by: string; note: string; reply?: { at: string; kind: "lowered" | "final"; note?: string } }
  sample?: { at: string; what: string; place: string; by: string; sentAt?: string; receivedBy?: string; note?: string }
  out?: { at: string; why?: OutcomeWhy }
  wonAt?: string
}

export interface PoLineFact {
  it: string
  qty: number
  /** Unit price before VAT; `null` on a lump-sum order. */
  price: number | null
  /** Accepted at the gate, from the receipts. */
  got: number
  /** Not accepted at the gate (returns to "left" unless the contractor cancels it). */
  rej: number
  /** Cancelled from the order by the contractor. */
  can: number
  held?: number
}

export interface PaymentTerm {
  pct: number
  days: number
}

export interface DealPo {
  no: string
  at: string
  lines: PoLineFact[]
  need: string
  acc: { at: string; date: string } | null
  site: string
  rcv: string
  terms: PaymentTerm[]
  /** The order's total before VAT when it carries no unit prices. */
  lump?: number | null
  cancelNote?: string
  decl?: { at: string; why: DeclineReason; note?: string }
}

export type DeclineReason = "stock" | "price" | "date" | "other"

/** A goods receipt the contractor recorded. The supplier only reads it. */
export interface DealReceipt {
  st: "ok"
  grn: string
  date: string
  okAt: string
  t: string
  by: string
  items: Record<string, number>
  got: Record<string, number>
  why?: Record<string, string>
  chk?: string[]
  note?: string
  files?: DealFile[]
}

/** "I delivered" — a date and a note, no quantity, number, driver or plate. */
export interface DealReport {
  st: "wait"
  at: string
  date: string
  note?: string
  /** Days of the reminders the supplier sent while it waited. */
  reminders?: string[]
}

export type DealShip = DealReceipt | DealReport

export interface DealInvoice {
  no: string
  date: string
  /** Before VAT. */
  amt: number
  file: string
  fileUrl?: string
  /** The receipts this invoice covers (one per receipt, decision 1). */
  grns?: string[]
  id?: string
  /** The VAT rate the invoice carried; absent = the supplier's own (15% when he is VAT-registered). */
  vat?: number
}

export type TransferState = "sent" | "ok" | "miss"

export interface DealTransfer {
  at: string
  amt: number
  bank: string
  ref: string
  st: TransferState
  okAt?: string
  note?: string
  id?: string
}

export interface DealWarranty {
  it: string
  until: string
  file: string
  at: string
  st: "wait" | "ok"
  okAt?: string
}

export interface DealMessage {
  f: "s" | "c"
  at: string
  x: string
  u?: 0 | 1
}

export interface DealLogEntry {
  at: string
  k: string
  u?: 0 | 1
  x?: Record<string, string | number>
}

export type ClosedKind = "paid" | "declined" | "cancelled" | OfferStatus

export interface Deal {
  id: string
  rfq: string
  c: string
  title: string
  city: string
  cat: string
  channel: DealChannel
  posted: string
  deadline: string
  needBy: string
  pricing: PricingMode
  items: DealItem[]
  files: DealFile[]
  qa: DealQuestion[]
  offer: DealOffer | null
  po: DealPo | null
  ship: DealShip[]
  /** One invoice per receipt (decision 1): oldest first. */
  invs: DealInvoice[]
  pays: DealTransfer[]
  war?: DealWarranty | null
  closed?: { k: ClosedKind; at: string }
  msgs: DealMessage[]
  log: DealLogEntry[]
  /** The contractor's payment terms shown before quoting. */
  terms?: PaymentTerm[]
  /** The conversation of the deal: its last message and what the supplier has not read. */
  chat?: { last: string; lastAt: string; unread: number; chatId: string }
  /** Stars the supplier gave the contractor after full payment. */
  rated?: { stars: number; text: string; at: string }
}

export interface ContractorRef {
  name: string
  city: string
  phone: string
  /** The date the supplier and this contractor connected; `null` = not connected. */
  conn: string | null
  verified: boolean
}

export interface ConnectionInvite {
  id?: string
  c: string
  at: string
  note: string
  u: 0 | 1
}

export interface ConnectionRequest {
  c: string
  at: string
}

export interface World {
  deals: Deal[]
  contractors: Record<string, ContractorRef>
  invites: ConnectionInvite[]
  /** Connection requests the supplier sent and the contractor has not answered. */
  requests: ConnectionRequest[]
  /** Requests the supplier archived ("not for me"). */
  arch: Record<string, 1>
  /** Deals the supplier has opened — clears "new". */
  seen: Record<string, 1>
}

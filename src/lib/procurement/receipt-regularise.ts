// Regularising a receipt that came with no order (PRD 3.0 §6.1-11, prototype
// `regul`) — ONE choice, three answers: tie it to an order already open for
// the same material (the receipt counts against it, nothing new is committed),
// raise a retroactive order (the owner alone approves it), or — for a receipt
// Procurement typed by hand — send it to Finance as a cash expense.
//
// An open order comes FIRST when one exists, because raising a retroactive
// order beside it commits the same quantity twice. Pure: no I/O.

import { dayOf, lineToArrive, poStatus, round2 } from "./po"
import { agreementFor, lastPaid, materialKey, type PriceAgreement, type PriceHistoryEntry } from "./prices"
import type { DeliveryLine, PurchaseOrder } from "./types"

export type RegulariseChoice = { kind: "link"; poId: string } | { kind: "new" } | { kind: "expense" }

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const qtyOf = (l: DeliveryLine) => num(l.accepted ?? l.counted)

/**
 * The receipt's lines laid onto this order's lines, matched by material (name
 * and unit, Arabic-folded as the price history does). Null unless EVERY line
 * finds a line of the order with at least that much still to arrive — half a
 * receipt against an order is not a regularisation.
 */
export function matchReceiptToOrder(lines: DeliveryLine[], po: PurchaseOrder): DeliveryLine[] | null {
  if (!lines.length) return null
  const used = new Map<string, number>()
  const out: DeliveryLine[] = []
  for (const l of lines) {
    const key = materialKey(l.name, l.unit)
    const q = qtyOf(l)
    if (!(q > 0)) return null
    const line = po.lines.find((pl) => materialKey(pl.name, pl.unit) === key && lineToArrive(pl) - (used.get(pl.id) || 0) + 1e-9 >= q)
    if (!line) return null
    used.set(line.id, (used.get(line.id) || 0) + q)
    out.push({ poLineId: line.id, name: line.name, unit: line.unit, noticeQuantity: 0, counted: q, rejected: 0, held: 0, accepted: q })
  }
  return out
}

/** Orders open for the same material (in delivery or part received), for the
 * same project when the receipt names one — the ones the receipt could count against. */
export function openOrdersForReceipt(orders: PurchaseOrder[], lines: DeliveryLine[], projectId: string | null | undefined): PurchaseOrder[] {
  return orders.filter((po) => {
    const st = poStatus(po)
    if (st !== "in_delivery" && st !== "part_received") return false
    if ((po.projectId || null) !== (projectId || null)) return false
    return matchReceiptToOrder(lines, po) != null
  })
}

/** The choice the dialog opens on: the first open order, else a retroactive one. */
export function defaultChoice(open: PurchaseOrder[]): RegulariseChoice {
  return open.length ? { kind: "link", poId: open[0].id } : { kind: "new" }
}

export const choiceKey = (c: RegulariseChoice): string => (c.kind === "link" ? `link:${c.poId}` : c.kind)
export function parseChoice(key: string): RegulariseChoice {
  if (key.startsWith("link:")) return { kind: "link", poId: key.slice(5) }
  return key === "expense" ? { kind: "expense" } : { kind: "new" }
}

// ---------------------------------------------------------------------------
// Suppliers and prices for a retroactive order
// ---------------------------------------------------------------------------

export interface RegisteredSupplier {
  orgId: string
  userId: string | null
  name: string
}

/** The platform suppliers we have ordered from — the ones a retroactive order
 * can name with an account (a guest is typed as written instead). */
export function registeredSuppliers(orders: PurchaseOrder[]): RegisteredSupplier[] {
  const seen = new Map<string, RegisteredSupplier>()
  for (const o of orders) {
    if (o.isGuestSupplier || !o.supplierOrgId || o.supplierOrgId === "guest") continue
    if (!seen.has(o.supplierOrgId)) seen.set(o.supplierOrgId, { orgId: o.supplierOrgId, userId: o.supplierUserId, name: o.supplierName })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export type PriceReference = { kind: "agreement"; price: number; docNumber: string; supplierName: string } | { kind: "last"; price: number; supplierName: string; day: string }

/** What this material should cost: a live agreement's price, else the last
 * price we committed to. Null when we have never bought it. */
export function priceReference(agreements: PriceAgreement[], history: PriceHistoryEntry[], name: string, unit: string, today: string): PriceReference | null {
  const ag = agreementFor(agreements, name, unit, today)
  if (ag) return { kind: "agreement", price: ag.price, docNumber: ag.agreement.docNumber, supplierName: ag.agreement.supplierName }
  const last = lastPaid(history, name, unit)
  return last ? { kind: "last", price: last.price, supplierName: last.supplierName, day: dayOf(last.day) } : null
}

/** The keyed price is above the reference by more than the 2% the prototype
 * tolerates — the owner sees it when approving. */
export const REGULARISE_PRICE_TOLERANCE = 0.02
export function priceAboveReference(price: number | null | undefined, ref: PriceReference | null): boolean {
  if (!ref || price == null || !(Number(price) > 0)) return false
  return Number(price) > round2(ref.price * (1 + REGULARISE_PRICE_TOLERANCE)) + 1e-9
}

/** What blocks the chosen answer, if anything. */
export type RegulariseProblem = "supplier" | "price"
export function regulariseProblem(choice: RegulariseChoice, input: { supplierName: string; prices: Array<number | null> }): RegulariseProblem | null {
  if (choice.kind !== "new") return null
  if (!input.supplierName.trim()) return "supplier"
  if (!input.prices.length || input.prices.some((p) => p == null || !(p > 0))) return "price"
  return null
}

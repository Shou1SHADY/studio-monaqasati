/**
 * Procurement PRD 3.0 / 2.0 — three governance rules.
 *
 * RFQ-03 (2.0) NO SEAL: the §5.1-4 seal is gone. The policy, its switch and every reader were deleted, so a buyer sees each
 * offer's price the moment it arrives and may award before the deadline. (This file once tested the seal; it now guards its absence.)
 *
 * §5.3 idempotency: every cross-module event is supposed to carry a key so a
 * resend never doubles its effect. Notifications were written at fresh
 * auto-ids, so a retry delivered the same thing twice.
 *
 * §9 exceptions: two facts already stored on a receipt — a truck that arrived
 * with nothing announcing it, and a no-order receipt pushed to Finance as an
 * expense — never reached the report the owner reads.
 */

import { resolvePolicies } from "@/lib/procurement/policies"
import { newOfferNotice } from "@/lib/procurement/offer-announce"
import { procEventKey } from "@/lib/procurement/events"
import { exceptions, EXCEPTION_KINDS } from "@/lib/procurement/reports"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"
import type { ProcEventKind } from "@/lib/procurement/events"
import type { ProcWorld } from "@/lib/procurement/today"
import type { ReceiptFact } from "@/lib/procurement/types"

describe("prices are never hidden from the buyer (RFQ-03)", () => {
  it("the policy no longer exists — not in the defaults, not when a stored document still carries it", () => {
    expect("sealOffersUntilDeadline" in DEFAULT_POLICIES).toBe(false)
    expect("sealOffersUntilDeadline" in resolvePolicies({ sealOffersUntilDeadline: true } as never)).toBe(false)
  })

  it("the new-offer notice names the amount whatever the deadline", () => {
    const n = newOfferNotice({ supplier: "مصنع الجودة", rfqTitle: "حديد", price: 8700 })
    expect(n.i18n.message).toBe("pn_new_offer")
    expect(n.smsText).toContain("٨٬٧٠٠")
  })
})

describe("the idempotency key on an order's events", () => {
  const once: ProcEventKind[] = ["po_approved", "po_expected_arrival", "po_sent", "po_supplier_accepted", "po_closed", "po_cancelled", "po_rated"]
  const repeatable: ProcEventKind[] = ["po_reminder", "po_date_updated", "po_receipt_recorded", "po_rejects_decided", "po_returned", "po_awaiting_approval", "po_remainder_cancelled", "po_hold_decided"]

  it.each(once)("%s is keyed on the order — a resend addresses the same document", (kind) => {
    expect(procEventKey({ kind, poId: "po1" })).toBe(`${kind}__po1`)
  })

  it.each(repeatable)("%s carries no key — a second one is a real event", (kind) => {
    // Keying a reminder would silently drop the second one, and keying a
    // receipt would drop every receipt after the first.
    expect(procEventKey({ kind, poId: "po1" })).toBeNull()
  })

  it("two orders never collide", () => {
    expect(procEventKey({ kind: "po_sent", poId: "po1" })).not.toBe(procEventKey({ kind: "po_sent", poId: "po2" }))
  })

  it("two kinds on one order never collide", () => {
    expect(procEventKey({ kind: "po_sent", poId: "po1" })).not.toBe(procEventKey({ kind: "po_closed", poId: "po1" }))
  })

  it("refuses an id that would address somewhere else", () => {
    // A slash would walk into a subcollection and a leading dot is not a legal
    // id; either way an auto-id is the safe answer.
    expect(procEventKey({ kind: "po_sent", poId: "po1/notifications/x" })).toBeNull()
    expect(procEventKey({ kind: "po_sent", poId: "." })).toBeNull()
    expect(procEventKey({ kind: "po_sent", poId: "" })).toBeNull()
    expect(procEventKey({ kind: "po_sent", poId: "  " })).toBeNull()
  })
})

describe("the exceptions report, on facts the receipt already carried", () => {
  const receipt = (over: Partial<ReceiptFact>): ReceiptFact => ({
    id: "d1",
    status: "confirmed",
    supplierName: "Al Rajhi",
    deliveryDate: "2026-09-20",
    confirmedAt: "2026-09-20T08:00:00.000Z",
    lines: [],
    ...over,
  }) as ReceiptFact

  const world = (receipts: ReceiptFact[]): ProcWorld => ({ orders: [], receipts, rfqs: [], offers: [], policies: DEFAULT_POLICIES, suppliers: [] }) as unknown as ProcWorld

  const kindsOf = (r: ReceiptFact) => exceptions(world([r])).map((e) => e.kind)

  it("reports a truck that arrived with no notice", () => {
    expect(kindsOf(receipt({ noNotice: true }))).toContain("no_notice")
  })

  it("reports a no-order receipt booked as a cash expense", () => {
    expect(kindsOf(receipt({ source: "manual", regularisation: "expense" }))).toContain("cash_expense")
  })

  it("reports both on one no-order receipt; once expensed it is no longer 'not regularised' (prototype: open → no-PO, expensed → cash expense)", () => {
    const kinds = kindsOf(receipt({ source: "manual", noNotice: true, regularisation: "expense" }))
    expect(kinds).toEqual(expect.arrayContaining(["no_notice", "cash_expense"]))
    expect(kinds).not.toContain("no_po")
    expect(kindsOf(receipt({ source: "manual", noNotice: true }))).toEqual(expect.arrayContaining(["no_po", "no_notice"]))
  })

  it("says nothing about an ordinary receipt", () => {
    expect(kindsOf(receipt({ poId: "po1" }))).toEqual([])
  })

  it("ignores a receipt nobody confirmed", () => {
    expect(kindsOf(receipt({ status: "pending_confirmation", noNotice: true }))).toEqual([])
  })

  it("keeps every kind declared, so a row can always be labelled", () => {
    expect(EXCEPTION_KINDS).toContain("no_notice")
    expect(EXCEPTION_KINDS).toContain("cash_expense")
  })
})

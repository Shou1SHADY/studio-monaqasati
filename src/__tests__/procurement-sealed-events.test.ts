/**
 * Procurement PRD 3.0 — three governance rules that had no teeth.
 *
 * §5.1-4 sealed prices: the policy was stored and had a labelled switch in
 * settings, and nothing read it — the offers screen showed every price as it
 * landed. A buyer who watches prices arrive can tell the next supplier what to
 * beat, which is the whole point of a sealed round.
 *
 * §5.3 idempotency: every cross-module event is supposed to carry a key so a
 * resend never doubles its effect. Notifications were written at fresh
 * auto-ids, so a retry delivered the same thing twice.
 *
 * §9 exceptions: two facts already stored on a receipt — a truck that arrived
 * with nothing announcing it, and a no-order receipt pushed to Finance as an
 * expense — never reached the report the owner reads.
 */

import { offersSealed } from "@/lib/procurement/award"
import { procEventKey } from "@/lib/procurement/events"
import { exceptions, EXCEPTION_KINDS } from "@/lib/procurement/reports"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"
import type { ProcEventKind } from "@/lib/procurement/events"
import type { ProcWorld } from "@/lib/procurement/today"
import type { ReceiptFact } from "@/lib/procurement/types"

const SEALING = { ...DEFAULT_POLICIES, sealOffersUntilDeadline: true }
// Riyadh is UTC+3, so a Date at 09:00 local is still the 22nd everywhere we care.
const NOW = new Date("2026-09-22T09:00:00+03:00")

describe("sealed prices until the deadline", () => {
  it("seals while the deadline is still ahead", () => {
    expect(offersSealed({ deadline: "2026-09-25" }, SEALING, NOW)).toBe(true)
  })

  it("still seals ON the deadline day — a supplier may quote until it ends", () => {
    expect(offersSealed({ deadline: "2026-09-22" }, SEALING, NOW)).toBe(true)
  })

  it("opens the day after", () => {
    expect(offersSealed({ deadline: "2026-09-21" }, SEALING, NOW)).toBe(false)
  })

  it("does nothing while the policy is off — which is how it ships", () => {
    expect(DEFAULT_POLICIES.sealOffersUntilDeadline).toBe(false)
    expect(offersSealed({ deadline: "2026-09-25" }, DEFAULT_POLICIES, NOW)).toBe(false)
  })

  it("opens an RFQ with no deadline rather than sealing it for ever", () => {
    // There is no moment to open at; sealing here would hide the prices with no
    // way back, which is worse than not sealing.
    expect(offersSealed({ deadline: null }, SEALING, NOW)).toBe(false)
    expect(offersSealed({}, SEALING, NOW)).toBe(false)
    expect(offersSealed(null, SEALING, NOW)).toBe(false)
  })

  it("opens once the award is made — the record is not hidden after the fact", () => {
    expect(offersSealed({ deadline: "2026-09-25", status: "Awarded" }, SEALING, NOW)).toBe(false)
  })

  it("reads an ISO deadline by its day, not by a midnight nobody stored", () => {
    expect(offersSealed({ deadline: "2026-09-22T23:59:59.000Z" }, SEALING, NOW)).toBe(true)
    expect(offersSealed({ deadline: "2026-09-20T23:59:59.000Z" }, SEALING, NOW)).toBe(false)
  })
})

describe("the idempotency key on an order's events", () => {
  const once: ProcEventKind[] = ["po_approved", "po_expected_arrival", "po_sent", "po_supplier_accepted", "po_remainder_cancelled", "po_closed", "po_cancelled", "po_rated"]
  const repeatable: ProcEventKind[] = ["po_reminder", "po_date_updated", "po_receipt_recorded", "po_rejects_decided", "po_returned", "po_awaiting_approval"]

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

  it("reports both, and the no-PO kind, on one receipt that is all three", () => {
    const kinds = kindsOf(receipt({ source: "manual", noNotice: true, regularisation: "expense" }))
    expect(kinds).toEqual(expect.arrayContaining(["no_po", "no_notice", "cash_expense"]))
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

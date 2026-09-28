/**
 * Procurement PRD 3.0 §6.4 / §7.2 tab 8 — the four operating policies resolve
 * with their reference values and never break an older document; each policy
 * names the module that owns it; the boundary log is read back from the orders'
 * own logs and the receipts, newest first.
 */

import { boundaryLog } from "@/lib/procurement/boundary"
import { DEFAULT_OPERATING_POLICIES, operatingPolicies, POLICY_OWNER, resolvePolicies } from "@/lib/procurement/policies"
import { DEFAULT_POLICIES, type PurchaseOrder, type ReceiptFact } from "@/lib/procurement/types"

describe("operating policies", () => {
  it("an absent document gives the PRD's reference values, the old ones untouched", () => {
    const p = resolvePolicies(null)
    expect(p).toEqual({ ...DEFAULT_POLICIES, noticeRouting: "procurement", buyerReceives: false, buyerSelfIssueLimit: 2000, replyWindowDays: 1 })
    expect(operatingPolicies(DEFAULT_POLICIES)).toEqual(DEFAULT_OPERATING_POLICIES)
  })

  it("reads what is stored, and falls back on nonsense", () => {
    const p = resolvePolicies({ noticeRouting: "both", buyerReceives: true, buyerSelfIssueLimit: 3500, replyWindowDays: 2.6, managerApprovalLimit: 90000 })
    expect([p.noticeRouting, p.buyerReceives, p.buyerSelfIssueLimit, p.replyWindowDays, p.managerApprovalLimit]).toEqual(["both", true, 3500, 3, 90000])
    const bad = resolvePolicies({ noticeRouting: "fax" as never, buyerReceives: "yes" as never, buyerSelfIssueLimit: -1, replyWindowDays: "x" as never })
    expect([bad.noticeRouting, bad.buyerReceives, bad.buyerSelfIssueLimit, bad.replyWindowDays]).toEqual(["procurement", false, 2000, 1])
  })

  it("every policy carries its owner: Finance's approval limit, Inventory's tolerance, the rest Governance's", () => {
    expect(POLICY_OWNER.managerApprovalLimit).toBe("fin")
    expect(POLICY_OWNER.overReceiptTolerancePercent).toBe("inv")
    expect(Object.keys(POLICY_OWNER).sort()).toEqual(Object.keys(resolvePolicies(null)).sort())
  })
})

describe("the boundary log", () => {
  const po = (over: Partial<PurchaseOrder>): PurchaseOrder =>
    ({ id: "po1", docNumber: "PO-2026/014", supplierName: "Al-Hadid", promisedDate: "2026-09-30", log: [], lines: [], ...over }) as PurchaseOrder

  it("approved → Finance, sent / accepted / new date with the supplier, a remainder cancelled → Inventory, receipts in from Inventory", () => {
    const orders = [
      po({
        log: [
          { at: "2026-09-10T08:00:00Z", byId: "u", byName: "U", action: "created" },
          { at: "2026-09-11T08:00:00Z", byId: "u", byName: "U", action: "approved" },
          { at: "2026-09-12T08:00:00Z", byId: "u", byName: "U", action: "sent", params: { channel: "portal" } },
          { at: "2026-09-13T08:00:00Z", byId: "u", byName: "U", action: "supplier_accepted", params: { date: "2026-09-28" } },
          { at: "2026-09-20T08:00:00Z", byId: "u", byName: "U", action: "remainder_cancelled", params: { line: "Rebar", qty: 5, unit: "t" } },
        ],
      }),
    ]
    const receipts = [
      { id: "d1", status: "confirmed", poId: "po1", docNumber: "GR-2026/031", confirmedAt: "2026-09-18T06:00:00Z" },
      { id: "d2", status: "confirmed", poId: null, docNumber: "GR-2026/032", confirmedAt: "2026-09-19T06:00:00Z" },
      { id: "d3", status: "pending_confirmation", poId: "po1" },
    ] as ReceiptFact[]
    const log = boundaryLog(orders, receipts)
    expect(log.map((e) => [e.kind, e.dir, e.party, e.key])).toEqual([
      ["remainder_cancelled", "out", "inv", "proc:CXL:PO-2026/014"],
      ["receipt_no_po", "in", "inv", "inv:GRN:GR-2026/032"],
      ["receipt", "in", "inv", "inv:GRN:GR-2026/031"],
      ["supplier_accepted", "in", "sup", "sup:ACC:PO-2026/014"],
      ["po_sent", "out", "sup", "proc:PO:PO-2026/014"],
      ["po_approved", "out", "fin", "proc:PO:PO-2026/014"],
    ])
    expect(log[0].params).toMatchObject({ line: "Rebar", qty: 5, unit: "t" })
    expect(log[3].params.date).toBe("2026-09-28")
    expect(log[2].params).toMatchObject({ grn: "GR-2026/031", doc: "PO-2026/014" })
  })
})

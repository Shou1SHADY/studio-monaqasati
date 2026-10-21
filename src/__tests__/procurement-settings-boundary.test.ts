/**
 * Procurement PRD 3.0 §6.4 / §7.2 tab 8 — the four operating policies resolve
 * with their reference values and never break an older document; each policy
 * names the module that owns it.
 */

import { DEFAULT_OPERATING_POLICIES, operatingPolicies, POLICY_OWNER, resolvePolicies } from "@/lib/procurement/policies"
import { DEFAULT_POLICIES } from "@/lib/procurement/types"

describe("operating policies", () => {
  it("an absent document gives the PRD's reference values, the old ones untouched", () => {
    const p = resolvePolicies(null)
    expect(p).toEqual({ ...DEFAULT_POLICIES, noticeRouting: "procurement", buyerReceives: false, buyerSelfIssueLimit: 2000, replyWindowDays: 1, ownerStepsBack: false })
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

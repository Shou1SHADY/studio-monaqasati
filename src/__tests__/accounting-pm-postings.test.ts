/**
 * What Finance posts for Project Management's outbox: a certified certificate
 * is revenue (as a legacy مستخلص), its collections settle the receivable one
 * entry each, and a released retention moves to the client's receivable —
 * every entry keyed on the event, so a second post lands on the same one.
 */

import { ACC } from "@/lib/accounting/accounts"
import { collectedAfter, outstandingOf, pmCertificatePosting, pmCollectionPosting, pmRetentionReleasePosting } from "@/lib/accounting/pm-postings"
import type { PmEvent } from "@/lib/pm/events"

const ipc: PmEvent = {
  key: "prj:IPC:PJ-2026/009:01",
  kind: "IPC",
  organizationId: "org",
  projectId: "p1",
  projectNo: "PJ-2026/009",
  amount: 180000,
  params: { certificate: "01", gross: 180000, recovery: 18000, retention: 9000, vat: 24300, net: 177300, due: "2026-10-30" },
  by: "u1",
  at: "2026-09-28T10:00:00.000Z",
}

const sum = (lines: Array<{ debit?: number; credit?: number }>, k: "debit" | "credit") => lines.reduce((a, l) => a + (l[k] ?? 0), 0)

describe("a certified PM certificate", () => {
  it("posts revenue, retention, the recovered advance and VAT, balanced, keyed on the event", () => {
    const r = pmCertificatePosting(ipc, "Villas")
    expect(r).not.toBeNull()
    expect(r?.sourceType).toBe("ipc_claim")
    expect(r?.sourceId).toBe("prj:IPC:PJ-2026_009:01")
    expect(r?.date).toBe("2026-09-28")
    const lines = r?.lines ?? []
    expect(sum(lines, "debit")).toBeCloseTo(sum(lines, "credit"), 2)
    expect(lines.find((l) => l.account === ACC.contractRevenue)?.credit).toBe(180000)
    expect(lines.find((l) => l.account === ACC.retentionReceivable)?.debit).toBe(9000)
    expect(lines.every((l) => l.project === "p1")).toBe(true)
  })
  it("posts nothing for another kind of event", () => {
    expect(pmCertificatePosting({ ...ipc, kind: "ADV" }, "Villas")).toBeNull()
  })
})

describe("a collection", () => {
  it("is its own entry each time, settling the client's receivable", () => {
    const first = pmCollectionPosting(ipc, { amount: 100000, date: "2026-10-05", n: 1 })
    const second = pmCollectionPosting(ipc, { amount: 77300, date: "2026-10-20", n: 2 })
    expect(first.sourceId).not.toBe(second.sourceId)
    expect(first.lines.find((l) => l.account === ACC.clientsReceivable)?.credit).toBe(100000)
  })
  it("moves the collected share up to one, never past it", () => {
    expect(collectedAfter(177300, 0, 100000)).toBeCloseTo(0.564, 3)
    // The share is exact now (not rounded to four decimals): the remainder of 100,000 on 177,300 is 77,300.
    expect(collectedAfter(177300, 100000 / 177300, 77300)).toBe(1)
    expect(collectedAfter(177300, 100000 / 177300, 77000)).toBeLessThan(1)
    expect(collectedAfter(177300, 0.9, 50000)).toBe(1)
    expect(outstandingOf(177300, 0.5)).toBe(88650)
    expect(outstandingOf(177300, 1)).toBe(0)
  })
})

describe("released retention", () => {
  const hnd: PmEvent = { ...ipc, key: "prj:HND:PJ-2026/009:final", kind: "HND", amount: 45000, params: { stage: "final", on: "2027-03-01" } }
  it("moves from retention receivable to the client's receivable", () => {
    const r = pmRetentionReleasePosting(hnd, { date: "2027-03-02" })
    expect(r?.sourceType).toBe("retention_release")
    expect(r?.sourceId).toBe("prj:HND:PJ-2026_009:final")
    expect(r?.lines).toEqual([
      expect.objectContaining({ account: ACC.clientsReceivable, debit: 45000 }),
      expect.objectContaining({ account: ACC.retentionReceivable, credit: 45000 }),
    ])
  })
  it("is empty when nothing was made claimable", () => {
    expect(pmRetentionReleasePosting({ ...hnd, amount: 0 }, { date: "2027-03-02" })?.empty).toBe(true)
  })
})

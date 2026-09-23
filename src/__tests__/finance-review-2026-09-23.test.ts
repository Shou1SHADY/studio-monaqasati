// Finance review, 23 Sep 2026 — withholding tax, the zakat base and its flow into
// the three statements, the cash projection, the Manual/Automatic journal split
// and the Export-to engine. One scenario, the finance prototype's own example
// (120,000 consulting to a non-resident at 5 %), walked end to end.

import assert from "node:assert/strict"
import { buildEntry, isManualEntry, type JournalEntry, type JournalLine, type SourceType } from "@/lib/accounting/journal"
import { whtLine, whtRegister, whtRate, computeWht, whtDueDate } from "@/lib/accounting/withholding"
import { validateManualEntry } from "@/lib/accounting/manual-entry"
import { zakatComputation, zakatProvisionLines } from "@/lib/accounting/zakat"
import { cashProjection, projectionBuckets } from "@/lib/accounting/cash-projection"
import { periodWindows } from "@/lib/accounting/balances"
import { cashFlowStatement, incomeStatement, balanceSheet } from "@/lib/accounting/statements"
import { cashFlowTree } from "@/lib/accounting/statement-tree"
import { exportAoa, exportXbrl, exportHtml } from "@/lib/accounting/export"
import { incomeFacts, balanceFacts, cashFlowFacts, statementExportDoc, journalExportDoc, trialBalanceExportDoc } from "@/lib/accounting/export-docs"
import { incomeStatementTree } from "@/lib/accounting/statement-tree"
import { trialBalance } from "@/lib/accounting/balances"
import { normalizeAccountingSettings } from "@/lib/accounting/settings"

describe("finance review 2026-09-23", () => {
  it("withholds, provides zakat, projects cash and exports", () => {
    let n = 0
    const E = (date: string, kind: "auto" | "manual", sourceType: SourceType, lines: Array<Partial<JournalLine> & { account: string }>): JournalEntry => {
      n += 1
      return { id: `e${n}`, ...buildEntry({ organizationId: "o", date, kind, sourceType, sourceId: `s${n}`, description: `d${n}`, lines, entryNumber: n, userId: "u", userName: "Khaled", defaultCostCenter: "C3" }) }
    }

    // WHT helpers
    assert.equal(whtRate("technical_services"), 0.05)
    assert.equal(whtRate("management_fees"), 0.2)
    assert.equal(whtRate("royalties"), 0.15)
    assert.equal(whtRate("rent", { rent: 0.07 }), 0.07)
    assert.equal(computeWht(120000, 0.05), 6000)
    assert.equal(whtDueDate("2026-06-18"), "2026-07-10")
    assert.equal(whtDueDate("2026-12-03"), "2027-01-10")

    // The form's lines with the WHT component validate and balance
    const form = validateManualEntry({
      date: "2026-06-18", description: "consultant",
      lines: [
        { account: "520104", debit: "120000", credit: "" },
        { account: "110102", debit: "", credit: "114000" },
        whtLine({ type: "technical_services", rate: 0.05, base: 120000, partyName: "Foreign LLP" }),
      ],
    })
    assert.equal(form.ok, true, JSON.stringify(form))
    assert.equal(form.lines[2].wht?.base, 120000)

    const entries = [
      E("2026-01-01", "manual", "manual_voucher", [{ account: "110102", debit: 1_000_000 }, { account: "310101", credit: 1_000_000 }]),
      E("2026-02-01", "manual", "manual_voucher", [{ account: "110102", debit: 300_000 }, { account: "220101", credit: 300_000 }]),
      E("2026-03-01", "auto", "expense", [{ account: "120101", debit: 400_000 }, { account: "110102", credit: 400_000 }]),
      E("2026-06-18", "manual", "manual_voucher", form.lines),
      E("2026-08-01", "auto", "sales_invoice", [{ account: "110201", debit: 500_000, partyName: "Client A" }, { account: "410101", credit: 500_000 }]),
      E("2026-09-01", "auto", "goods_receipt", [{ account: "510101", debit: 200_000 }, { account: "210101", credit: 200_000, partyName: "Supplier S" }]),
    ]

    // Register before remittance
    let reg = whtRegister(entries, "2026-12-31")
    assert.equal(reg.withheld, 6000); assert.equal(reg.outstanding, 6000); assert.equal(reg.rows[0].status, "outstanding")
    assert.equal(reg.rows[0].type, "technical_services"); assert.equal(reg.byMonth[0].dueDate, "2026-07-10")

    // Income statement: full 120,000 cost. Cash flow: +6,000 in working capital, expandable to 210302.
    const w = periodWindows(entries, "2026-01-01", "2026-12-31")
    const is = incomeStatement(w.movement)
    assert.equal(is.totals.opex, 120000)
    const cfTree = cashFlowTree(w)
    const flat = JSON.stringify(cfTree.nodes)
    assert.ok(flat.includes('"accountCode":"210302"') && flat.includes('"value":6000'), "cash flow shows WHT payable +6000")
    assert.equal(cashFlowStatement(w).difference, 0)

    // Partial remittance
    const withRemit = [...entries, E("2026-07-08", "manual", "wht_remittance", [{ account: "210302", debit: 4000 }, { account: "110102", credit: 4000 }])]
    reg = whtRegister(withRemit, "2026-12-31")
    assert.equal(reg.outstanding, 2000); assert.equal(reg.rows[0].status, "partial"); assert.equal(reg.remitted, 4000)
    assert.equal(isManualEntry(withRemit[withRemit.length - 1]), true)
    assert.equal(isManualEntry(entries[2]), false)

    // Zakat
    const fy = { from: "2026-01-01", to: "2026-12-31" }
    let z = zakatComputation(entries, fy, null)
    // equity 1,000,000; profit before zakat 500k-200k-120k = 180,000; loans 300,000; nca 400,000
    assert.equal(z.components.find((c) => c.key === "equity")!.system, 1_000_000)
    assert.equal(z.components.find((c) => c.key === "profit")!.system, 180_000)
    assert.equal(z.components.find((c) => c.key === "loans")!.system, 300_000)
    assert.equal(z.components.find((c) => c.key === "nonCurrentAssets")!.system, 400_000)
    assert.equal(z.base, 1_080_000); assert.equal(z.zakat, 27_000); assert.equal(z.toBook, 27_000)
    // Overrides and adjustments
    z = zakatComputation(entries, fy, { rateBasis: "gregorian", overrides: { equity: { value: 900_000 } }, adjustments: [{ id: "a", label: "investments", amount: -50_000 }] })
    assert.equal(z.base, 930_000); assert.equal(z.zakat, Math.round(930_000 * 0.025776 * 100) / 100)
    // The floor: base never below adjusted profit
    z = zakatComputation(entries, fy, { rateBasis: "hijri", overrides: {}, adjustments: [{ id: "b", label: "x", amount: -5_000_000 }] })
    assert.equal(z.floorApplied, true); assert.equal(z.base, 180_000)
    // Booking flows to all three statements
    const booked = [...entries, E("2026-12-31", "manual", "zakat_provision", zakatProvisionLines(27_000, "n"))]
    const w2 = periodWindows(booked, "2026-01-01", "2026-12-31")
    assert.equal(incomeStatement(w2.movement).totals.zakat, 27_000)
    assert.equal(incomeStatement(w2.movement).totals.netProfit, 153_000)
    const bs = balanceSheet(w2.closing)
    assert.equal(bs.difference, 0)
    assert.ok(bs.currentLiabilities.rows.find((r) => r.code === "2103")!.value === 33_000, "2103 = 6000 WHT + 27000 zakat")
    assert.ok(JSON.stringify(cashFlowTree(w2).nodes).includes('"accountCode":"210303"'))
    assert.equal(zakatComputation(booked, fy, null).toBook, 0)
    assert.equal(zakatComputation(booked, fy, null).booked, 27_000)
    // Release lines
    assert.deepEqual(zakatProvisionLines(-100, "n").map((l) => [l.account, l.debit, l.credit]), [["210303", 100, 0], ["540101", 0, 100]])

    // Projection
    const b = projectionBuckets("2026-09-23", "weeks"); assert.equal(b.length, 13); assert.equal(b[0].from, "2026-09-24"); assert.equal(b[12].to, "2026-12-23")
    const m = projectionBuckets("2026-09-23", "months"); assert.equal(m.length, 6); assert.equal(m[0].to, "2026-09-30"); assert.equal(m[1].from, "2026-10-01"); assert.equal(m[5].to, "2027-02-28")
    const p = cashProjection(booked, { asOf: "2026-09-23", horizon: "weeks", customerTermDays: 30, supplierTermDays: 30, fiscalYearStartMonth: 1 })
    // cash at 2026-09-23: 1,000,000 + 300,000 − 400,000 − 114,000 = 786,000 (the zakat provision is dated later)
    assert.equal(p.opening, 786_000)
    // Client A invoice 2026-08-01 + 30 = 2026-08-31 → overdue → first week; supplier 2026-09-01+30 = 10-01 → week 2; WHT 6000 due 07-10 → overdue, week 1
    assert.equal(p.buckets[0].receipts, 500_000)
    assert.equal(p.buckets[0].payments, 6_000)
    assert.equal(p.buckets[1].payments, 200_000)
    assert.equal(p.overdue.receipts, 500_000)
    assert.equal(p.closing, 786_000 + 500_000 - 6_000 - 200_000)
    assert.equal(p.history.length, 9); assert.equal(p.history[8].balance, 786_000)
    assert.equal(p.locked, 500_000)
    const pm = cashProjection(booked, { asOf: "2026-09-23", horizon: "months", customerTermDays: 30, supplierTermDays: 30, fiscalYearStartMonth: 1, historyCount: 6 })
    assert.equal(pm.history.length, 7); assert.equal(pm.history[5].date, "2026-08-31")

    // Exports
    const t = (k: string) => k
    const base = { title: "IS", subtitle: "FY", locale: "ar", organizationId: "o&1", period: fy, fileName: "IS/2026" }
    const isDoc = statementExportDoc(base, incomeStatementTree(w2.movement).nodes, incomeFacts(w2.movement), t)
    const aoa = exportAoa(isDoc)
    assert.ok(aoa.length > 10)
    const x = exportXbrl(isDoc)!
    assert.ok(x.startsWith('<?xml version="1.0"'))
    assert.ok(x.includes('<ifrs-full:Revenue contextRef="D" unitRef="SAR" decimals="2">500000.00</ifrs-full:Revenue>'))
    assert.ok(x.includes('<ifrs-full:IncomeTaxExpenseContinuingOperations contextRef="D" unitRef="SAR" decimals="2">27000.00</ifrs-full:IncomeTaxExpenseContinuingOperations>'))
    assert.ok(x.includes("o&amp;1"), "entity id escaped")
    // balanced open/close tags
    function wellFormed(xml: string) {
      const stack: string[] = []
      for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
        const [, close, name, , self] = m
        if (self) continue
        if (close) assert.equal(stack.pop(), name, `closing ${name}`)
        else stack.push(name)
      }
      assert.equal(stack.length, 0, "all tags closed")
      // No raw ampersand outside an entity.
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(xml))
    }
    wellFormed(x)
    const bsX = exportXbrl(statementExportDoc(base, [], balanceFacts(w2.closing), t))!
    assert.ok(bsX.includes("ifrs-full:EquityAndLiabilities"))
    const cfX = exportXbrl(statementExportDoc(base, [], cashFlowFacts(w2), t))!
    assert.ok(cfX.includes('contextRef="I0"') && cfX.includes("<xbrli:instant>2025-12-31</xbrli:instant>"))
    const jd = journalExportDoc(base, booked, t)
    const gl = exportXbrl(jd)!
    assert.ok(gl.includes("<gl-cor:accountMainID contextRef=\"now\">210302</gl-cor:accountMainID>"))
    assert.equal((gl.match(/<gl-cor:entryHeader>/g) || []).length, booked.length)
    wellFormed(gl)
    wellFormed(bsX)
    wellFormed(cfX)
    assert.equal(jd.sections[0].rows.length, booked.reduce((s, e) => s + e.lines.length, 0))
    assert.equal(trialBalanceExportDoc(base, trialBalance(w2), t).xbrl, undefined)
    assert.ok(exportHtml(isDoc).includes("<table>"))
    // Settings default: per-project financials off
    assert.equal(normalizeAccountingSettings(null).projectReports, false)
  })
})

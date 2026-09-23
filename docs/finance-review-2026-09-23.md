# Finance & Accounting review — 23 Sep 2026

Attendees: Shady, Abdullah, Marco, Salman. Abdullah compared the module with the
finance prototype (`مدماك_وحدة_المحاسبة_والمالية_v3.html`). This file records
what each point became in the code, and what is still open.

| # | Point | Status | Where |
|---|---|---|---|
| 1 | Withholding tax (WHT) | Built | `lib/accounting/withholding.ts`, Tax → Withholding tax, New journal entry → WHT component |
| 2 | Zakat base, flowing to the three statements, manually adjustable | Built | `lib/accounting/zakat.ts`, Tax → Zakat, `accounting_zakat` collection |
| 3 | Per-branch / per-project financials only as customisation | Built (switch) | Settings → Reports → "Financial statements by project" (off by default) |
| 4 | Cash projection (actual vs projected) | Built | `lib/accounting/cash-projection.ts`, dashboard card |
| 5 | Searchable dropdowns | Built | every Accounting dropdown now uses `SearchableSelect` |
| 6 | "Manual" journal filter returns nothing | Explained + fixed UX | see below |
| 7 | Saudi hosting for ZATCA | **Open — not code** | see below |
| 8 | Export to Excel / PDF / XBRL | Built | `lib/accounting/export.ts`, `export-docs.ts`, "Export to" menu |
| — | Sheet close (X) covering the title | Fixed | `components/ui/sheet.tsx` |

## 1. Withholding tax

- The WHT component in **New journal entry** covers the case where a contractor pays a non-resident. The accountant picks the payment type (its rate is pre-filled from the org's table), confirms the gross base (by default, the expense debits), and the form adds a locked credit line to **210302 Withholding tax payable**. That line stores the type, base and rate. The bank or supplier line then carries the net amount.
- The prototype example is 120,000 of consulting fees at 5%:
  - Dr 520104 Professional fees: 120,000. The full cost goes to the income statement.
  - Cr 210302 WHT payable: 6,000.
  - Cr bank: 114,000.
- The **cash flow statement** shows the 6,000 as a positive working-capital movement until it is remitted. Expand "change in working capital" to see account 210302.
- **Tax → Withholding tax** has:
  - the register, with remittance status. Remittances clear the oldest withholdings first.
  - monthly remittance, due on the 10th of the following month, with a "Record remittance" button. It posts Dr 210302 / Cr bank as a `manual` entry with `sourceType: wht_remittance`.
  - the rate table. The finance lead (`accounting.close`) may override any rate per org, stored in `accounting_settings.whtRates`.
- The reference rates come from the Income Tax Law schedule:
  - 5% for rent, technical/consulting services, air tickets and freight, international telecom, dividends, loan returns, and insurance premiums.
  - 20% for management fees.
  - 15% for royalties, services paid to head office or a related party, and other payments.
- **Confirm with Abdullah** which category he meant by 15% (the meeting audio was unclear). A wrong rate needs no code change: edit it in the rate table.

## 2. Zakat base

- **Tax → Zakat** works per fiscal year and proposes each component from the books:
  - equity: capital, retained earnings, and prior years' unclosed results
  - plus the year's profit before zakat, taken from the income statement
  - plus long-term loans (2201)
  - plus the end-of-service provision (2202)
  - less net non-current assets (12)
- The accountant can override any figure, with a reason. They can also add their own adjustments (investments, dividends, assessment differences), where a negative amount deducts.
- The base is never below the adjusted profit, which is the regulatory floor.
- The rate is 2.5% for a Hijri year or 2.5776% for a Gregorian year.
- The working paper is saved in `accounting_zakat/{orgId}__{fy}`. It never touches the ledger.
- **Book zakat provision** posts the difference between the zakat due and what is already booked: Dr 540101 / Cr 210303, dated inside the fiscal year. If too much is booked, it releases the excess. This is what reaches all three statements:
  - income statement: "Zakat", below profit before zakat
  - balance sheet: tax & zakat liabilities
  - cash flow: working capital
- **Record zakat payment** posts Dr 210303 / Cr bank.
- Both entries are `manual`, so they need `accounting.post`, and they appear under the Manual filter.

## 3. Per-project / per-branch financials

The app never had per-branch statements; only the prototype did. The project filter on the statements, and the dashboard's project results, now appear only when **Settings → Reports → Financial statements by project** is on. It is off by default, per client. Journal lines still carry their project, so job costing in Projects is unaffected. Per-region, per-branch or per-company reporting remains a customisation, as agreed (Marco / Abdullah to log it).

## 4. Cash projection

The dashboard card offers a 13-week or 6-month view. The top panel is the cash balance: a solid line for actual weeks, a dashed line for projected ones, joined at today. The bottom panel shows expected receipts and payments per bucket. KPIs: cash today, locked cash, lowest projected balance (and when it occurs), and the balance at the end of the horizon. **Details** opens the bucket table, and each bucket drills down to its items.

Sources, all from open ledger balances:

- **Receipts:** client invoices (110201, oldest items first) at their booking date plus the client term; unbilled work (110301) a month later plus the client term.
- **Payments:** supplier bills (210101) at their booking date plus the supplier term; VAT due at the end of the following month; WHT on the 10th of the following month; employee accruals on the 1st of next month; zakat 120 days after year end.
- **Overdue** amounts land in the first bucket and are counted separately.
- **Retention** on either side is released by an event, not a date, so it is shown beyond the horizon.

Client and supplier terms are set in Settings (default 30 days).

**Not projected:** payroll and rent not yet in the books, and loan instalments. Abdullah is to send the written spec (dimensions and KPIs); compare it with this card when it arrives.

## 6. "Manual shows nothing"

The filter was correct: `kind === "manual"`. The test data had no manual entries, and with the filter set to Manual the page showed the generic "No entries yet — entries are posted automatically…" message, which read as if manual entries had vanished. Changes:

- A filter-aware empty state explains what manual entries are and links to New journal entry.
- Each option shows its count: "Manual (0)".
- Every row is badged Manual or Automatic, and shows who captured it.
- `isManualEntry()` also counts opening balances as manual, since they are always typed in by hand.

**Follow-up:** verify on UAT once real vouchers exist.

## 7. Hosting and ZATCA — mostly answered

ZATCA's own e-invoicing FAQ ("Is there any data residency or data center legal requirement?", zatca.gov.sa/en/E-Invoicing/Introduction/FAQ/Pages/FAQ_029.aspx) answers it. Under Article 66 of the VAT Implementing Regulations, a cloud e-invoicing solution or data centre **outside** the Kingdom is allowed, provided an extension of, or access to, the data is available from the branch in the Kingdom, with access to all related records. Hosting outside KSA is therefore not prohibited by ZATCA. The taxpayer must still keep electronic copies of every invoice issued.

The same FAQ notes that non-tax regulations may apply: the National Cybersecurity Authority (NCA) controls and the National Data Management Office (NDMO) / PDPL rules. Still to check:

- whether any client is subject to NCA or government-sector controls that require hosting in KSA
- the PDPL's cross-border transfer rules for client personal data
- the current monthly hosting cost, before any migration

Current setup: the site is on Vercel and Firebase is outside KSA.

## 8. Export to

Every statement, accounting-tool, tax and zakat screen has **Export to** in its header. Figures are always exported in exact riyals, never in the on-screen scale.

- **Excel:** `xlsx` (SheetJS, already a dependency), right-to-left in Arabic.
- **PDF:** the print window. The browser's "Save as PDF" produces the file.
- **XBRL**, by screen:
  - **Income statement, balance sheet, cash flow, equity:** an instance using **IFRS taxonomy** (2024) concepts. Zakat is reported as `IncomeTaxExpenseContinuingOperations`, as Saudi filers do.
  - **Journal, ledger, account statement:** **XBRL GL** (`gl-cor`).
  - **VAT, WHT, zakat:** facts in the platform's own namespace (`mdmak:`). There is no public taxonomy for these schedules.
  - **Trial balance, chart of accounts:** Excel and PDF only.

**Open:** the instances are well-formed and use real element names, but have not been validated against the Ministry of Commerce's **Qawaem** filing rules. Qawaem uses its own IFRS-based templates and may require specific entry points or extensions. Get a sample filing or the Ministry's taxonomy package before telling clients these files can be filed as-is.

## Deploy notes

- `firestore.rules` adds `accounting_zakat`: read by org members, write with `accounting.post`, id must be `{orgId}__{fy}`. Deploy to UAT first (`node scripts/deploy-rules.js uat`), then prod, with approval.
- New settings fields (`projectReports`, `customerTermDays`, `supplierTermDays`, `whtRates`) default safely when absent. No migration is needed.
- Orgs that used the statements' project filter lose it until an owner switches **Financial statements by project** on.

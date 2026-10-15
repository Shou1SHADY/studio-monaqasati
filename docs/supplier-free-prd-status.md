# Supplier 1.0 — free account: status against the delivery package (15 Oct 2026)

Package: `Delivery-Supplier-1.0` (PRD 1.0 — 97 requirements, 22 workflows, G-01…G-12, B-01…B-12; Prototype-Supplier-v13;
QA packs; Supplier-Pipeline contracts). Open decisions 1–4 follow the PRD's recommendations:
invoice per receipt · receipt-window reminder at 2 days, escalation at 5 · a rejected quantity is replaced or deducted · one date per order.

First build: `4f36812`, `80462da` (morning of 15 Oct). Audited the same day requirement by requirement against the PRD and the
prototype; about 50 gaps were fixed in three packages (quotes & contractor inputs · orders & money · frame, UI & messages)
plus a rules hotfix, merged at `2e79aeb` / `9a58a96`.

## What is built

| Area | Where | Notes |
|---|---|---|
| Plan switch | `companyPlans/{orgId}` · `src/lib/supplier-plan.ts` · `PlanSwitch` · `SupplierPlanFrame` | No document = free. Admin sets it in Components. `scripts/set-supplier-plans.ts` puts existing supplier companies on `full`. The plan reaches `PlanSwitch` through context (no splash on navigation) |
| Deal model | `src/lib/supplier-free/{types,deal-logic,world-logic,derive}.ts` | One deal per RFQ, derived from live documents; pure over `today`; days are Riyadh days (`riyadhDayOf`). Invariants G-01…G-12 are jest over the prototype's 144-deal fixture |
| Eight screens | `src/components/supplier-free/` | Today · Quote requests · My quotes · Orders & delivery · Invoices & transfers · Contractors · Messages · Company account (+ search, notifications). Rows stack into three-line blocks under `md`; one sidebar breakpoint (768); the world waits for `ready` before a deep link opens |
| Server acts (NFR-08) | `/api/supplier-free/act` → `server-quote-acts.ts` (quotes) · `server-acts.ts` (orders, money, warranty, rating) | Every blocking rule is re-run on the server; every act appends to the PO log (NFR-06) |
| Quotes | `quote-rules.ts` · `server-quote-acts.ts` · `QuoteDialog` | New / version (legacy v1 kept) / cut reply / final / withdraw (`مسحوب`, excluded from comparison and award) / sample sent (with note) / decline invitation (no offer left behind). The winner stays "awaiting" until his PO is sent; losers carry the award's loss reason; no-award reasons follow `cancellation.code` |
| Contractor inputs | `RfqTermsPicker` · round dialog (reply-by + total target) · sample-request dialog · award loss reason | What the supplier reads: `paymentTermsList`, `targetPrice`/`reductionAt`/`reductionBy`, `sampleWhat`/`samplePlace`/`sampleBy`, `outcome` |
| Numbers | `RFQ-yyyy/NNN` in `mfgCounters` · `bareNumber` | Supplier sees «طلب 2026/031» · «أمر 2026/041» · «سند 2026/007»; notices to a supplier carry no PO-/GR- code |
| Order acts | `po.accept` (date ≥ today) · decline (reason) · report (date + note) · remind (also posted in the conversation) | The contractor's receipt closes the report; the receivers get the report and a Procurement Today row |
| Invoices | `invoice-rules.ts` · `invoice-server.ts` · `/api/supplier-free/invoice` | Per receipt, one transaction with a lock per receipt and per invoice number; the invoice's own VAT drives every gross; a short invoice no longer leaves the task open |
| Money | `money-writes.ts` · `server-acts.ts` | Finance's recorded payment tells the supplier (`supplierTransfers`; failure is shown); answers are append-only (`answers[]`); amounts are formatted per reader; lateness per instalment (`payLateness`) |
| Receipt window (decision 2) | `receipt-window.ts` · `/api/cron/receipt-window` (vercel.json, 05:30) | Reminder to receivers at 2 days, escalation to `po.approve` + owner at 5; stamped once each |
| Warranty, rating | `po.warranty` · `po.rate` · `reviews.ts` | Warranty only for warranty materials with an accepted receipt line; rating only when fully paid, one per order; Company account → Ratings shows delivery-tied reviews with the material |
| Mobile-code account | `/api/supplier-free/phone/{code,verify,change}` · `PhoneSignInDialog` | New number → Supplier owning a company, free. Sign-in (new or existing) claims that number's verified guest quotes and seeds empty specialties/cities from them. Security tab changes the mobile (code to the new number) or the CR (code to the current mobile; the CR certificate is removed so "Verified" waits for the new one) |
| Visitor link | `rfq/[token]` · `/api/rfq-share/[token]/offer` | Three required fields: prices, company name, Saudi mobile; validity pre-filled deadline + 14; duplicates found by phone; contractor terms shown |
| Full portal after upgrade | `OrderInvoicesSection` on `/supplier/invoices` | Free-account invoices, transfers (confirm) and warranties stay visible |
| Rules | `firestore.rules` | 147,167 stripped characters (was 147,603). Offers refuse buyer-owned keys from a supplier; `termsList` frozen; supplier connection requests only to `pending`; reviews need `reviewerId == uid`. Hotfix `9a58a96`: six `request.is*Org()` calls from `80462da` denied silently on prod |

## Open

- **Owner actions:** run `scripts/set-supplier-plans.ts <uat|prod>` (dry run, then `--apply`) if not done — without it existing suppliers see the free journey; run `scripts/backfill-rfq-numbers.ts <uat|prod>` (dry run, then `--apply`); the receipt-window cron uses the existing `CRON_SECRET`; deploy rules UAT then prod with the code.
- `displayDocNumber` maps two-letter codes only, so a contractor screen shows `RFQ-2026/031` in Latin (the supplier sees the word). `sales-numbering.ts` is mirrored to mobile.
- Admin-created RFQs (`mdmak-contractor.ts`) stay unnumbered until the backfill (the admin cannot draw from the company's counter).
- The contractor's `users` doc (with the mobile) is readable by any signed-in user; the free UI drops the phone for contractors with no invitation/order/connection, but B-04 is not enforced by rules.
- Drawer tables in `DealSections` (request, offer, PO, payments) still scroll sideways at 390px.
- Connection notices from `/api/invitations/*` have hard-coded Arabic titles and no contractor id.
- "Did not arrive" cannot be answered from the full portal's invoices section (confirm only).
- Mobile app mirrors to recopy: `src/lib/procurement/types.ts`, `po.ts` (new log actions), `src/lib/mfg-events.ts` (`sar:` params) — then `check-mirrors`.
- PRD decisions 5–12 remain open (second free user, visitor-link rules, validity expiry, ±3% tolerance, non-VAT supplier, question visibility, numbering code, discount on total).

## Checks

`npx tsc --noEmit` · `npx jest` (311 suites / 4,873 tests on 15 Oct) · `node scripts/check-i18n-links.mjs` · `npx next build` ·
`RULES_FILE=firestore.rules node_modules/.bin/tsx scripts/rules-sim/supplier-free.ts`

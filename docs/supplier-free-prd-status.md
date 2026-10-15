# Supplier 1.0 — free account: status against the delivery package (15 Oct 2026)

Package: `Delivery-Supplier-1.0` (PRD, Prototype-Supplier-v13, QA packs, contracts). Open decisions 1–4 follow the PRD's recommendations:
invoice per receipt · receipt-window reminders at 2 days, escalation at 5 · a rejected quantity is replaced or deducted · one date per order.

## What is built

| Area | Where | Notes |
|---|---|---|
| Plan switch | `companyPlans/{orgId}` · `src/lib/supplier-plan.ts` · `PlanSwitch` · `SupplierPlanFrame` | No document = free. Admin sets it in Components. `scripts/set-supplier-plans.ts` puts today's supplier companies on `full` so nothing changes for them |
| Deal model | `src/lib/supplier-free/{types,deal-logic,world-logic,derive}.ts` | One deal per RFQ, derived from live documents; pure over `today`. PRD invariants G-01…G-12 are jest over the prototype's 144-deal fixture |
| Eight screens | `src/components/supplier-free/` | Today · Quote requests · My quotes · Orders & delivery · Invoices & transfers · Contractors · Messages · Company account (+ search, notifications) |
| Quote, final price, sample, withdraw, no-quote | `quote-rules.ts` (pure) · `server-quote-acts.ts` via `/api/supplier-free/act` · `quote-writes.ts` (client) | Blocking rules run in the form and again on the server (NFR-08): open request, deadline (end of the day, Riyadh; a cut reply runs on its reply-by), reaches him, `quoteBlocks`. The offers rules refuse a supplier who writes a key the buying side owns (`buyerOfferKeys`). A withdrawal is `مسحوب`: out of the comparison and the award. A declined invitation is no quote |
| Order acts | `po-writes.ts` | Accept (note), decline (reason), report delivery (date + note), remind about the receipt. The contractor's receipt closes the report |
| Invoices | `invoice-rules.ts` · `/api/supplier-free/invoice` | Per receipt. Client cannot create `supplierInvoices`; the route re-runs every rule |
| Money | `money-writes.ts` · `supplier-acts-writes.ts` | Finance's recorded payment also tells the supplier (`supplierTransfers`); he confirms or says it did not arrive; warranty registered by him, accepted by the buyer |
| Contractor side | `PoSupplierSection` in the order drawer · `SupplierConnectionRequests` on Suppliers | Delivery reports, decline reason, supplier invoices, transfers, warranty; accept/decline a supplier's connection request |
| Frozen terms | `terms-freeze.ts` · `RfqTermsPicker` | The RFQ carries `paymentTermsList` (picker, 100% at 30 days by default; shown to the supplier and the visitor); at award EVERY order freezes `termsList`: RFQ › offer advance/credit › 100% at 30 days |
| RFQ numbers | `numbering.ts` `drawRfqNumber` · `rfq-writes.ts` `createRfqWithNumber`/`updateRfqNumbered` | `RFQ-yyyy/NNN` in `mfgCounters` at creation (RFQ form, project tenders; a draft from before is numbered on its next save). Older RFQs: `scripts/backfill-rfq-numbers.ts <uat|prod>` (dry run; `--apply`) — not run yet |
| Award results | `awardRfq` (`lossReason`) · `RfqAwardDialog` | Each losing quote gets `outcome {k: lost, why}` in the award write; the winner waits (not "lost") until his order is sent |
| Mobile-code account | `/api/supplier-free/phone/{code,verify}` · `PhoneSignInDialog` · `JoinFreeButton` | Our OTP stack (`supplier_phone`): 1 code a minute, 5 an hour per number, 5 guesses, one use. A new number gives a Supplier who owns a company, free. Earlier verified guest offers of that number (and their orders) become his — on every sign-in, an existing account's too — and the requests they answered seed empty specialties/cities. The visitor is asked for prices, a company name and a Saudi mobile only (validity pre-filled deadline + 14; duplicates found by mobile). Entry points: the guest offer page, the guest RFQ page, the login page |
| Invitations | `/api/supplier-free/invitations` | Addressed by e-mail OR mobile |
| Notices | `Portal.Shared.pn_*` | New event kinds go through `emitProcEvent` (contractor) / `notifyNamed` (server); the Arabic table equals the Arabic messages (tested) |
| Rules | `firestore.rules` | `companyPlans`, `supplierInvoices` (server-only), `supplierTransfers`, `supplierWarranties`, `supplierWorkspace`, `poSupplierActs`. Conformance: `scripts/rules-sim/supplier-free.ts` (UAT read-only) |

## Not built yet

- A verified-mobile sign-in for suppliers who already have an e-mail account (a mobile only enters accounts made with a mobile).
- The mobile app's mirror of `portal-components` and the new procurement files (needs its own go-ahead).
- SMS provider: Twilio stays until a provider is chosen (Unifonic + 4jawaly compared).

## Checks

`npx tsc --noEmit` · `npx jest` · `node scripts/check-i18n-links.mjs` · `RULES_FILE=firestore.rules node_modules/.bin/tsx scripts/rules-sim/supplier-free.ts`

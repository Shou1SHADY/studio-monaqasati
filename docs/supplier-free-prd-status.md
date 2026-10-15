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
| Rules | `firestore.rules` | 147,562 stripped characters (147,603 released on 15 Oct morning; keep under ~147,600). Offers refuse buyer-owned keys from a supplier; `termsList` frozen; supplier connection requests only to `pending`; reviews need `reviewerId == uid`. Hotfix `9a58a96`: six `request.is*Org()` calls from `80462da` denied silently on prod |

## Second pass (15 Oct afternoon) — the rest of the package

Checked the Supplier-Pipeline contracts and its ten settled conflicts, the live-system review SUP-01…14, the R1-start
templates, all 55 QA-pack checks, and a correctness review of the morning's merge. Fixed (`25cd597`, `728c13c`, `ee43098`, `47319a6`):

| Finding | Fix |
|---|---|
| B-01: a supplier could create or edit a "confirmed" delivery (the invoice cap reads them) | Rules `supNoticeOnly()`; the invoice server counts only receipts confirmed by the buying company (`issuedByBuyer`) |
| Company account lost list items (works, certificates, files) after the second add | `FreeWorldProvider` signs the WHOLE profile (`profileSignature`) |
| A free winner's order could not be approved (unverified, no VAT) | Verified = `isVerified` OR the documents rule; no VAT number is a warning (`poWarnings`) |
| Al-Kharj missing from the city lists | Added |
| Contractor's `daysLate` ignored an on-time delivery report (conflict 2, SUP-05) | `deliveryReportedInTime` — both sides agree (tested) |
| Supplier declines the order → nothing could be awarded again | «أعد الترسية» in the order drawer → server act `award.reopen` |
| `rfq_outcome` never sent | `rfq-outcome.ts`: losers on award, every live quote on cancel; the winner hears through `po_sent` |
| RFQ terms stored always → the offer's advance never frozen; retro orders without terms | `rfqTermsToStore` (only when set); every order kind freezes terms |
| Acts used the caller's own user doc (VAT 0 for a team member, wrong company for a secondary one) | `supplierCompanyOf` |
| Quote 15% vs invoice 0% for a non-VAT supplier | One rule: VAT number → 15%, else 0, stored on each version (decision 9's recommendation) |
| Supplier could still change a price directly after the deadline | Offers rule: price/status fields only while the RFQ is `New` |
| Supplier could self-connect (`active` on create) | Supplier creates only `pending`; accepting an invitation goes through `/api/supplier-free/invitations` |
| Double submit → two live quotes | The one-quote check runs inside the transaction |
| A fully rejected receipt kept "paid in full" from ever being true | Receipts with nothing accepted are not billable |
| Cut reply skipping an item kept the old batch total | Revised on its total |
| Receipt window counted from the supplier's chosen date | From the later of that and the day reported |
| A receipt with no number showed a document-id fragment | «—» |
| "Remind about payment" and questions were client writes; all inquiries readable by anyone signed in | Server acts `po.payremind`, `quote.ask`; questions served by `/api/supplier-free/questions`; inquiries readable by the asker's and the RFQ's company |
| RFQ number year and guest-link deadline in UTC | Riyadh year; end of the Riyadh day |
| «تحصيلك» in the subscription card | Reworded |

## Open

- **Owner actions:** run `scripts/set-supplier-plans.ts <uat|prod>` (dry run, then `--apply`) if not done — without it existing suppliers see the free journey; run `scripts/backfill-rfq-numbers.ts <uat|prod>` (dry run, then `--apply`); the receipt-window cron uses the existing `CRON_SECRET`; deploy rules UAT then prod with the code.
- `displayDocNumber` maps two-letter codes only, so a contractor screen shows `RFQ-2026/031` in Latin (the supplier sees the word). `sales-numbering.ts` is mirrored to mobile.
- Admin-created RFQs (`mdmak-contractor.ts`) stay unnumbered until the backfill (the admin cannot draw from the company's counter).
- The contractor's `users` doc (with the mobile) is readable by any signed-in user; the free UI drops the phone for contractors with no invitation/order/connection, but B-04 is not enforced by rules.
- Drawer tables in `DealSections` (request, offer, PO, payments) still scroll sideways at 390px.
- Connection notices from `/api/invitations/*` have hard-coded Arabic titles and no contractor id.
- "Did not arrive" cannot be answered from the full portal's invoices section (confirm only).
- Mobile app mirrors to recopy: `src/lib/procurement/types.ts` (log actions incl. `payment_reminded`), `po.ts` (log actions, `deliveryReportedInTime`, warnings), `src/lib/mfg-events.ts` (`sar:` params) — then `check-mirrors`. Mobile writes questions and connection acceptances straight to Firestore: questions still save (nobody is notified); a supplier's direct `active` link is now refused.
- Review-day items not built: Finance has no consumer for supplier invoices (no three-way match, no payables entry); the payment notice carries no payment number; PO versions; cancelling a chosen quantity (only the whole remainder); the supplier does not see the contractor's reject decision (replace/deduct/discount); receipts show checklist chips, not openable files; the free account stores no IBAN number or English name; no CSV import for the R1 templates (onboard by mobile code on UAT, or a script).
- The manager's `verifyRefusal` still refuses to vouch for a supplier without VAT; a directory supplier recorded `verified:false` stays blocked.
- Contract decisions built ahead of review day (confirm or reverse): 1–4 (PRD recommendations), 6 (code before the visitor's offer when SMS is configured), 9 (no VAT without a number), 11 (`RFQ-` series).
- QA-pack checks that differ on purpose: invoice per receipt (decision 1) vs "after full receipt" in G-07/G-11/WF-12; notes for decline/final/sample/missing transfer go as notifications, not chat (WF-22); specialties apply at once (PRD ACC-02) where the pack expects review.
- PRD decisions 5–12 remain open (second free user, visitor-link rules, validity expiry, ±3% tolerance, non-VAT supplier, question visibility, numbering code, discount on total).

## UI and prototype audit (15 Oct 2026, evening)

Three independent read-only audits (design tokens, the prototype's screens against the code, the QA pack against the code) and a live check of UAT in Chrome.

**Colours, fonts, shapes — decision.** The prototype's own palette (brand #0a89c1, bg #f5f7fa, IBM Plex Sans Arabic, 15 px cards, 11 px buttons) is mapped onto the application's tokens, never copied: brand → `cta` through `data-accent="cta"` (`bg-module`/`text-module`), ink/ink2/ink3 → `foreground`/`secondary`/`muted-foreground`, line → `border`, navy → `primary`/`sidebar`, red/amber/green → `destructive`/`warning`/`success`, 15 px → `rounded-xl`/`rounded-2xl`, font → `font-body` (Noto Sans Arabic / Inter; Plex is not imported). Shared pieces: `StatusPill`, `DrawerSection`, `EmptyState`, `Callout`, `NativeSelect`; page header and KPI cards now match `ModuleHeader`.

**Fixed:** the whole card/row opens its deal (`useRowGo`); request cards carry the stage top edge; Enter submits a dialog; destructive dialogs are red; withdraw takes a note for the conversation and "sample sent" posts its message; notices carry a kind icon and tone; drawer section summaries; archive on Today's request cards; `slate-*` on the navy frame replaced by sidebar tokens; opaque frame background. **Render sweep** (`supplier-free-render-sweep.test.tsx`, the package's qa_sweep): nine screens x two languages over the prototype's 144 deals, no `undefined`/`NaN`/`{var}`/old codes, no unnamed button.

**Also fixed in the second pass:** filter chips are the shared `Chip` look; the hero carries the prototype's brick wall, glow and gradient; Cancel on Company account → Basic, a file on "Add certificate", the work year defaults to the current year, a count on the Ratings tab, Close on the subscription and receipt dialogs, a search icon and a blue "awaiting" group on My quotes, the Sent column from `lg`.

**Still different (low impact):** hand-styled `h-8` action buttons instead of `Button` (same look, one size smaller than `Button sm`); raw inputs with the shared class string instead of `ui/input`; the Contractors request dialog uses a select where the prototype has a radio list; the archive toast says "Archived N" without the counted noun.

**QA pack:** decision 3 is now read by the supplier — a replacement is late only after its own date (`rejectReplaceBy`), a quantity kept at a discount waits for the release and is not his to deliver, a released discount is billable as a receipt of its own at the discounted price (`discount-receipts.ts`, read the same by derive and by the invoice route); goods on the contractor's hold never make an order late. **Open:** B-04 — the contractor's phone is hidden in the client only (the contractor's `users` document is readable by every signed-in user, a platform-wide rule); the G-01…G-12 invariants run on the prototype's fixture, not on `deriveWorld` output. A delivery report dated before the promise stops the lateness clock: that is the package's own rule (conflict 2), not a gap.

## Checks

`npx tsc --noEmit` · `npx jest` (316 suites / 4,929 tests on 15 Oct, second pass) · `node scripts/check-i18n-links.mjs` · `npx next build` ·
`RULES_FILE=firestore.rules node_modules/.bin/tsx scripts/rules-sim/supplier-free.ts`

# Mdmak Tech — Studio Monaqasati

**B2B Smart Procurement & RFQ Platform** connecting contractors with suppliers in Saudi Arabia.
**Site:** https://mdmaktech.sa | **Locales:** Arabic (default, RTL) · English (LTR)

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js **15.5.26** (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + tailwindcss-animate |
| Components | shadcn/ui (Radix UI primitives) |
| Animations | Framer Motion 12 |
| i18n | next-intl 4 — locales: `ar` (default), `en` |
| Auth/DB | Firebase 11 (Firestore, Auth, Storage) |
| AI | Genkit + Google GenAI |
| Forms | react-hook-form + zod |
| Testing | Jest (unit) + Playwright (e2e) |
| Charts | Recharts |
| Maps | Leaflet + react-leaflet |

## Commands

```bash
# Dev
npm run dev          # Next.js dev on port 9002 (Turbopack)
npm run genkit:dev   # Genkit AI dev server
npm run genkit:watch # Genkit with file watching

# Quality
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src (ts,tsx)
npm run ci           # typecheck + lint + build + test

# Tests
npm run test         # Jest unit tests
npm run test:watch   # Jest watch mode
npm run test:coverage # Jest with coverage
npm run e2e          # Playwright e2e
npm run e2e:ui       # Playwright interactive UI

# Custom check scripts (PowerShell)
npm run check        # All checks (Node runner)
npm run check:quick  # Quick sanity (PowerShell)
npm run check:code   # Code quality
npm run check:tests  # Test suite
npm run check:security # Security scan
npm run check:ui     # UI/UX checks
npm run check:arch   # Architecture checks
npm run check:all    # Full suite (PowerShell)
npm run validate         # Full validation script
npm run validate:quick   # Quick validation
npm run validate:full    # Full validation
```

> ⚠️ `next-dev-loop` and `next-cache-components-optimizer` skills require Next.js **16.3+** and Turbopack.
> Currently on 15.5.26 — those skills will refuse. Upgrade when ready: `npx next upgrade`

## Directory Map

```
src/
  app/
    [locale]/           # All public pages (ar/en)
      (admin)/          # Admin portal (route group)
      (contractor)/     # Contractor portal — dashboard tile grid at /contractor,
                        #   modules: projects (BOQ, tenders), rfqs, crm/{leads,
                        #   opportunities,rfqs}, inventory/warehouses, invoices/
                        #   guarantees + accounting (ONE "Finance & Accounting"
                        #   component, id `payments`; pages keep separate
                        #   permissions), sales (Today, requests & quotations, orders,
                        #   delivery, payments, reports, price list, settings & boundary
                        #   — NOT part of finance; see docs/sales-prd-status.md),
                        #   manufacturing (work orders), employees (HR), profile/team
      (supplier)/       # Supplier portal (mirrors contractor structure incl. crm/)
      offer/[token]/    # Guest supplier offer page (no account needed)
      rfq/[token]/      # Guest RFQ share page
      about/ contact/ pricing/ privacy/ terms/
      layout.tsx        # Root layout — fonts, metadata, providers
      page.tsx          # Landing page (imports content.tsx)
      content.tsx       # Heavy landing page content — ~48KB
    api/                # Next.js API routes (invitations, rfq-share, guest-offer, ...)
    globals.css         # CSS vars + Tailwind base + RTL rules
  components/
    ui/                 # shadcn/ui primitives (DO NOT touch unless fixing)
    layout/             # Navbar, Footer, Sidebar, portal-layout, app-switcher
    contractor/         # Contractor-specific components (RfqForm, RfqOffersView, ...)
    supplier/           # Supplier-specific components
    crm/                # CRM views/dialogs shared by both portals (CrmShell, ...)
    StructuredData.tsx  # JSON-LD structured data (SEO)
  firebase/             # Firebase client/server configs
  hooks/                # Custom React hooks (useXxx)
  i18n/
    routing.ts          # Locale routing config
    request.ts          # next-intl server request config
  lib/                  # Utility functions
  ai/                   # Genkit AI flows
  utils/                # Shared utilities
messages/               # Translation JSON files (ar.json, en.json)
public/                 # Static assets — favicons, OG image, manifest
scripts/                # Ops scripts (demo seed, data repair, migrations,
                        #   cleanup-seed-demo.js — dry-run-first removal of what
                        #   /admin/seed wrote; that page is OFF in production)
docs/                   # sales-prd-status.md, procurement-prd-status.md, customer-review-2026-09-17.md,
                        #   customer-review-2026-09-18.md, procurement-review-2026-09-19.md
```

## Key Utilities

| File | Purpose |
|---|---|
| `src/lib/seo.ts` | `alternatesForPath()` + `buildPageMetadata()` — use for all page metadata & hreflang |
| `src/lib/utils.ts` | `cn()` class merger — always use instead of `clsx` |
| `src/i18n/routing.ts` | `Link`, `useRouter`, `redirect` — locale-aware navigation |
| `src/lib/portal-components.ts` | Registry of portal modules (tiles/sidebar/launcher) + `visibleComponents`/`isComponentVisible` permission gating |
| `src/lib/permissions.ts` | Team permission model — `can()`, `TeamGroup`, seeded groups, `crm.close` etc. Mirrored by firestore.rules helpers |
| `src/hooks/usePermissions.ts` | Client hook resolving the current member's `can()` (project-level group overrides default) |
| `src/lib/org-identity.ts` / `org-identity-admin.ts` / `identity-fields.ts` | Multi-company identity resolution — a secondary company's identity lives on `organizations/{id}`, never merge with naive spread (use `stripIdentityFields`) |
| `src/hooks/useResolvedProfile.ts` | The active company's resolved profile (waits for the identity overlay — never returns a half-merged profile) |
| `src/hooks/useWorkQueue.ts` | Cross-module "needs your action" queue + org stats feeding the contractor dashboard |
| `src/lib/mfg-events.ts` | Manufacturing's boundary events (NT-01): `emitMfgEvent` resolves recipients by role/station/project and writes notifications carrying i18n keys (each reader renders its own language) plus text rendered by the sender for push and the mobile app — use it for any act that crosses into or out of Manufacturing |
| `src/lib/crm.ts` / `crm-writes.ts` | CRM domain types, tracks/gates/value ladder, deal→project handover writes |
| `src/lib/sales-quotes.ts` | The quotation's lifecycle (Sales PRD §5): draft → issued → sent → accepted/rejected; "expired" and "superseded" are DERIVED (`quoteLifecycle`), never stored. `issueBlocks`/`convertBlocks` are the blocking rules the composer shows live and the write runs again; revisions, CRM activity log, rep scoping (`inSalesScope`) |
| `src/lib/sales-numbering.ts` | Yearly Sales sequences drawn inside the write (`QT-2026/NNN`, revisions `-2`/`-3`) in `mfgCounters`; `displayDocNumber` shows the Arabic prefix (ع.س) — the stored number stays Latin |
| `src/lib/sales-today.ts` / `sales-reports.ts` + `src/hooks/useSalesWorld.ts` | Today's KPIs, flow strip and decision queue, and the three report families — pure, over one scoped "world"; sales count on SIGNED delivery; cost only for the owner / `sales.approve` |
| `src/lib/riyal.ts` + `public/fonts/saudi-riyal.otf` | The official Saudi Riyal symbol, **U+20C1** — a one-glyph font (`scripts/build-riyal-font.js`, registered in globals.css with `unicode-range`) so it works inside strings. `sarLtr`/`sarRtl`/`withSarSign` put it LEFT of the figure in both scripts (SAMA's rule). Never U+FDFC ﷼ (a test guards it); never in CSV, e-mail, push text or the self-written print windows — no font there |
| `src/lib/search-text.ts` | `matchesSearch`/`foldSearchText` — every-word, Arabic-folded (أ/ا, ة/ه, ى/ي, diacritics, ٠-٩) matching; use it for any search box. A search must look across state filters, not inside the active chip |
| `src/components/contractor/SearchableSelect.tsx` | The dropdown with a search box (groups, `ariaLabel`, `className` for toolbar sizing). Every Accounting dropdown uses it — the finance team asked for type-to-filter everywhere |
| `src/lib/accounting/withholding.ts` / `zakat.ts` / `cash-projection.ts` (finance review 23 Sep 2026, see docs/finance-review-2026-09-23.md) | WHT rate table + register (a WHT line carries `wht {type, rate, base}` on its 210302 credit); the zakat base (system components + the accountant's overrides/adjustments in `accounting_zakat/{orgId}__{fy}`, floor = adjusted profit) — its provision/payment and WHT remittances are `manual` entries (`zakat_provision`/`zakat_payment`/`wht_remittance`); the dashboard's 13-week/6-month projection from open balances |
| `src/lib/accounting/export.ts` + `export-docs.ts` + `ExportMenu` | "Export to" Excel/PDF/XBRL: a screen passes `exportDoc` to `AccountingShell`; XBRL is IFRS facts (statements), XBRL GL (journal/ledger/account statement) or the platform `mdmak:` namespace (tax/zakat). Always exact riyals |
| `src/lib/accounting/source-links.ts` + `src/components/accounting/JournalEntrySheet.tsx` | The document behind a journal entry (`sourceType`+`sourceId` → screen) and the side panel every ledger / statement / breakdown row opens |
| `src/lib/manufacturing-mindmap.ts` + `ManufacturingMindMap.tsx` | The optional mind-map view (Workshop → view: Mind map): `buildMindMapFromViews` over PRD 1.2 order views; the legacy builder stays for old orders |
| `src/components/contractor/PurchaseRequestsInbox.tsx` | Procurement's desk for Manufacturing's shortfalls (`/contractor/rfqs/requests`) — answers requests (start RFQ → `ordered`, arrived, declined with a reason), never raises one |
| `src/lib/procurement/` (Procurement PRD 3.0, see docs/procurement-prd-status.md) | `types.ts` the contract · `po.ts` DERIVED order state (`poStatus` in_delivery/part_received/received, `poLate`, `poBlocks`, `approvalRefusal`, `requiredApprover`, `supplierScore`) · `receipts.ts` blind-count maths (`acceptedOf` = counted − rejected − held, `overReceiptRefusal` +5 %) · `today.ts` the decision queue / waits / KPIs · `reports.ts` the 7 reports · `writes.ts` every order transition as ONE transaction that re-runs the rule and appends a log entry (`ProcWriteError.code` → `Portal.Procurement.err_*`) · `receipt-writes.ts` `recordReceipt` (GR number, PO lines, stock, books, Manufacturing closure, notifications — each post-commit effect best-effort) · `events.ts` `emitProcEvent` (recipients by permission, i18n + rendered text) · `numbering.ts` `PO-yyyy/NNN` (ط.ش) and `GR-yyyy/NNN` (ا.س) in `mfgCounters` |
| `src/hooks/useProcurementWorld.ts` + `useProcActor.ts` | The org's procurement world (orders, deliveries, rfqs, offers, policies, supplier facts) and who is looking (`seesPrices`: owner / offers.view / offers.accept / po.approve — an expediter sees dates and quantities, never an amount) |
| `module` colour token (tailwind.config.ts + globals.css) | The ACTIVE module's colour: `data-accent` is set on the portal frame from the registry's `accentToken`, so `bg-module/10 text-module` inside any screen is that module's colour. Every module has its own token (Sales indigo, HR violet) |
| `src/components/contractor/ProcurementHeader.tsx` | The head of every Procurement page: module tile, title, actions, and the tab rail (RFQs · purchase requests · suppliers · goods received), permission-gated like the sidebar |
| `scripts/check-i18n-links.mjs` | Every translation key used in `src/` must exist in both message files under its namespace; every portal link must hit a route. Run before committing |
| `src/lib/app-env.ts` / `feature-flags.ts` | Environment detection (prod vs UAT) and feature flags |
| `src/lib/sms.ts` + `src/lib/otp.ts` | SMS through Twilio. `isSmsConfigured` needs a real AC… SID, the token, and a sender: an E.164 number, a registered alpha sender ID such as `MdmakTech`, or `TWILIO_MESSAGING_SERVICE_SID`. One-time codes (login, receipt sign-off) go through **Twilio Verify** when `TWILIO_VERIFY_SERVICE_SID` is set; our resend/guess/expiry/one-use rules still apply. UAT without Twilio shows the code on screen |
| `src/lib/sentry-options.ts` + `src/instrumentation*.ts` + `src/app/global-error.tsx` | Sentry (org `mdmak`, EU, project `studio-monaqasati`). Deployed builds only, tagged production/uat. NO user info, cookies, headers, bodies or query strings; guest-link tokens (`/receive`, `/offer`, `/rfq` + their APIs) are masked. Keep it that way when adding options |
| `src/components/StructuredData.tsx` | JSON-LD structured data injected in root layout |
| `src/app/[locale]/content.tsx` | Landing page heavy content (~48KB) — **avoid SSR blocking here** |

## Firestore Collections (top-level)

`users` (+ `notifications`, `2fa` subcolls) · `organizations` (secondary companies) ·
`teamGroups` (permission groups) · `invitations` · `accessRequests` (member asks owner
for a module) · `projects` (+ `boqItems`, `boqGroups`, `members`, `ipcClaims`,
`wasteRecords`) · `rfqs` (+ `inquiries`) · `offers` · `deliveries` · `guarantees` ·
`warehouses` (+ `inventoryItems`, `transfers`, `wasteRecords`) · `crmContacts` ·
`crmOpportunities` · `crmQuotations` (also the Sales pipeline: phase, payment schedule
— an instalment flagged `beforeProduction` is the advance — payments, `createdByUser*`,
`requestId`, `revision`/`revisionOf`/`supersededById`, `lostReason`; status moves one step
at a time and the rules lock figures once issued and the document once sent) · `crmActivities` · `crmOrgProfile` (doc id = orgId) · `salesPriceItems` ·
`manufacturingDepartments` (the station registry: capacity workers × hoursPerDay,
hourlyRate, `leadUserId` — the station's recorder, `qcStation` — QC & packing, only
Quality records it, `gate` — an order-level step drawing|slab, checklist template) ·
`workOrders` (legacy stage-flow orders AND product-born orders — PRD 1.2 "marble line":
a product-born order carries `productId`, `quantity`, `docNumber` WO-yyyy/nnn,
`sourceKind` client|project|stock (+ `salesOrderId` or project refs), per-station
`progress` {done, rejected, rework, hours, back}, `survey` (a document with sketch),
`drawing` (we submit; Projects or Sales record A/B/C), `slabApproval` (block + signed
form), `materials` (per-station withdrawals: requested → issued by Inventory → received),
`rejects` (typed NCRs), `scrapRecords` (pending → approved/returned, re-make decision),
`qcReleases`, `closures` + `frozenCost` (production close is a decision), `remnants`,
`purchaseRequests` (sent → ordered [RFQ linked] → arrived [Inventory books it] | declined [back to
the manager with a reason]; only a declined one re-surfaces as a shortage; the rules let
Purchasing/Inventory CHANGE entries, never add one), `overrides`, `changeRequest` (from the order's owner),
`cancellation`, `varianceReviews`, `log`; stage, WIP, ready, next step and lateness are
DERIVED by `src/lib/manufacturing-engine.ts` — never stored) · `mfgProducts` (بطاقة
المنتج — the product's own route with standard time that starts EMPTY, BOM with waste
and station-custody flags, blocking flags; no prices) · `mfgCostEstimates` (cost
statements: cost, lead time, validity — no price; the cost controller sends, Sales
records quoted/won/lost) · `manufacturingSettings` (doc id = orgId — `features` are the
workshop manager's: `time`, `labourCost` (needs time; off = an order's cost is materials only,
`labourCostOn()`), `estimates`, `checklists`; the policies overhead rate, scrap limit, answer window, note
escalation, validity, remnant % are Finance's, edited in Accounting settings) ·
`mfgStops` (hours lost today per station — they move dates) · `mfgBlockNotices` (a
defective stone block; Inventory quarantines, Procurement claims) · `mfgCounters`
(`{orgId}__{type}__{year}` yearly document sequences — Manufacturing's and Sales' `QT`) · `fleetVehicles` (HR's drivers and
vehicles a delivery note picks from) · `deliveryNotes` (manufacturing → warehouse
handovers, signed by the receiver; v2 adds partial quantities, transit breakage,
driver/crates) · `salesOrders` (أوامر البيع — the backbone between
quotation and cash; delivered/invoiced are DERIVED from notes and invoices, never
stored; carries `paymentSchedule` inherited from the quotation, `promiseDate`, a `log`
trail, `payment.advanceInstallmentId`) · `salesDeliveryNotes` (customer deliveries —
a three-step handshake: Sales `requested` → Inventory `authorized` → the client signs
`delivered` with `signerName`; stock leaves at the signature, at the quantity actually
received, which REPLACES `lines[].quantity` (`requestedQuantity` kept beside it);
`held` is Finance's, with `heldFrom` to return to) ·
`salesInvoices` (built on delivered notes; deposits recovered pro-rata) ·
`salesReturns` (the sales manager approves with a `disposition` stock|scrap, Finance
issues the credit note; never on an unsigned shipment) ·
`salesTransferNotices` (إشعار حوالة — the seller reports a client's transfer,
only Finance answers "confirmed"/"not found"; a confirmed deposit releases the
gated sales order; instalment states are DERIVED from quotation payments +
notices) · `salesQuoteRequests` (طلب تقديم العرض — CRM asks Sales for a quote;
Sales prices it into the composer or declines with one of five factual
reasons; no direct requests in Sales) ·
`manufacturingRequests` (طلب تصنيع — Sales asks, the plant accepts into a work
order or rejects with a reason) · `accounting_journal` (the general journal —
append-only, entry id is `{orgId}__{sourceType}__{sourceId}`) ·
`accounting_accounts` · `accounting_periods` (month locks) ·
(what posts: sales, manufacturing, IPC claims, settlements, manual vouchers, supplier GOODS
RECEIPTS — Inventory + input VAT / Suppliers payable, offer prices read EXCLUDING VAT — and
project MATERIAL ISSUES at snapshotted cost; not automated: VAT settlement, expenses, payroll,
guarantee margins) ·
`accounting_settings` (doc id = orgId; the module is OFF until `enabled: true`;
`fiscalYearStartMonth` 1–12 defines Q1/H1/FY on every screen, `displayScale`
units|thousands|millions is the default presentation; `projectReports` — statements
by project, OFF by default, a per-client customisation; `customerTermDays`/
`supplierTermDays` time the cash projection; `whtRates` overrides the WHT table) ·
`accounting_zakat` (`{orgId}__{fy}` — the zakat working paper: overrides,
adjustments, Hijri/Gregorian rate; never the ledger) ·
`invoices` · `rfqShareLinks` · `guestOfferLinks`
(server-only) · `purchaseOrders` (Procurement PRD 3.0 — the order laid OVER an
accepted offer: awarding still writes the offer `مقبول` + RFQ `Awarded` exactly as
before, then `createPurchaseOrderFromAward` adds the order and `poId`/`poNumber`
on the offer; a legacy award has no order and every screen keeps working without
one. Stored states: awaiting_approval → approved → sent → accepted → closed |
cancelled ("returned" = awaiting_approval + `returnedReason`); in delivery / part
received / received are DERIVED from `lines[].accepted/rejected/held/cancelled`.
Nobody approves an order they prepared (the org owner excepted — flagged), above
`managerApprovalLimit` or retroactive → owner only; the supplier may only move
sent → accepted with a `promisedDate`) · `procurementSettings` (doc id = orgId —
the §6.4 policies; absent = PRD reference values) · `deliveries` now also carries
optional PO fields (`poId`, `docNumber` GR-…, `lines[]` with notice/counted/
rejected/held/accepted, checklist, vehicle, `selfReceived`, `noNotice`,
`regularisation`) — a delivery without them is a legacy one and confirms as it
always did

Permission notes: org **owner** passes every check; members get their group's
permissions (`teamGroups.permissions`, `'*'` = all). An account with NO
`organizationRole` field is a legacy solo account and IS an owner — the rules say so
(`isOrgOwner()`), and the client must read it the same way: use `legacyAwareRole` /
`usePermissions().isOrgOwner`, never `profile.organizationRole === "owner"`. Closing/handing over a CRM deal
needs `crm.close`. Sales reads `crmQuotations`: marking one accepted needs `sales.approve`
(or `crm.close`) — that notifies Finance of the deposit and opens the work order; recording
a customer payment (`payments`/`paidAt`) needs `sales.approve` or `invoices.manage`; a
`post_manufacturing` quotation never spawns a work order. Sellers never record
payments themselves: they file a transfer notice (`sales.manage` →
`salesTransferNotices`), and answering it needs
`invoices.manage`/`accounting.post`/`sales.approve` — a confirmed answer records
the advance on the quotation and may release the deposit-gated order through the
scoped `confirmsSalesOrderDeposit()` rule (awaiting_deposit → running, payment
flag only). Quotation issue enforces the discount policy in the shared form
hook: below standard cost is blocked for everyone; discounts off the list price
are capped 3% (seller) / 8% (`sales.approve`) / uncapped (owner). A finished work order hands
over on a `deliveryNotes` doc and its stock lands only when the destination confirms
(`warehouses.receive`/`warehouses.manage`, or `projects.edit` for project custody); a
legacy handover to the virtual distribution warehouse is received on the spot.
Manufacturing has five roles and nothing else (PRD 1.2, D9 — it requests and reads,
never acts for another module): `manufacturing.manage` is the workshop manager (answers
requests, releases, rushes, closes production, issues notes, applies incoming changes,
creates stock orders, approves scrap up to Finance's limit, edits stations/products);
`manufacturing.work` is a station lead (records the station's output, requests and
receives its materials, reports stops — a station with a `leadUserId` belongs to that
lead only — except the org OWNER, who may stand in at any non-QC station (`Actor.owner`):
the lock is client-side only, and with the lead away issued materials would sit "not
received" with nobody able to move the order); `manufacturing.qc` is Quality (reject decisions, the quality release at QC &
packing — nothing closes before it — slab sign-off, block notices); `manufacturing.cost`
approves any scrap, sends cost statements, reviews variance and the WIP reconciliation;
`manufacturing.view` is management (read-only in SAR). A client order waits for the
down payment (read from the sales order; no release before it). Other modules act in
their own screens and the rules scope their work-order fields: Inventory issues
withdrawals, receives remnants and warehouse notes (Warehouses → Manufacturing desk,
Delivery notes); Projects records drawing results, receives notes into custody and
requests changes (project page); Sales records the client's drawing result (the workshop
manager may record it too, from the order drawer — the customer's flow is that an order
need not travel back to Sales before it is finished), requests
changes and records cost-statement quote status; Procurement routes project needs to
make and marks purchase requests arrived; Finance owns the manufacturing policies.
The down payment: Sales reports it (`payment.depositReportedAt`), Finance confirms it
from Sales → Payments — `invoices.manage` may move a sales order only from
`awaiting_deposit` to `running` with the payment flag (Sales approvers still may too).
A work order belongs to the sales order it names — or, naming none, to the one born of
the same quotation (`belongsToSalesOrder`): the gate, release, Sales' screens, coverage
and the "advance confirmed" notice all ask that one function. Reporting the advance
sends the production request while the order still waits, so the plant PLANS: its answer
clock does not run before Finance confirms (`awaitsDownPayment`). Acceptance opens NO
work order in a product-card workshop — production is asked for by a request.
In Sales: the owner and `sales.approve` see cost and margin, set the price list and
approve returns; a rep (`sales.manage`) sees only his own clients (by the client's CRM
owner) and never a cost. A shipment hold and its release are Finance's
(`invoices.manage`, from Finance → Sales desk); the seller only requests the release.
Stock the workshop holds for released orders (`workshopHolds` in manufacturing-view)
is shown on the Inventory desk and subtracted from what Sales coverage offers; a sales
order reads its product-born work orders' survey and drawing instead of its own flags.
Procurement (PRD 3.0): `offers.accept` prepares an order (award); `po.approve`
approves/returns it up to `managerApprovalLimit` (seeded into `finance`), the owner
above it; `po.expedite` (seeded into `supply_chain`, implied by offers.accept /
po.approve / owner) sends it, records the supplier's acceptance and date, reminds;
`deliveries.confirm` records the receipt (blind count — the counted quantity is never
prefilled; a receipt is never edited afterwards); line decisions (cancel the remainder,
reject decision, close short, cancel) need offers.accept / po.approve / owner.
Existing `teamGroups` are NOT re-seeded: `scripts/migrate-po-permissions.js <env>`
(dry run; `--apply`) adds the two ids to groups holding offers.accept / rfq.manage.
Accounting splits three ways:
`accounting.view` reads the books, `accounting.post` writes manual vouchers and
reverses entries, `accounting.close` locks a period. Auto entries are written by
whoever performed the business action — the engineer certifying a مستخلص is not
an accountant, so the rules require only org membership and a balanced entry for
those; `manual` vouchers need `accounting.post`. Permission ids are grouped per
component in `PERMISSION_SECTIONS` for the team page. A deal handover may create a project + seat its PM without
`projects.edit`. BOQ lines lock while drawn into a tender (`isEditable:false`) —
only draw bookkeeping may change on a locked line.

## Environments

- **Prod:** mdmaktech.sa — the SITE runs on **Vercel** (project owned by a teammate's
  Vercel account; server env vars live there, in Vercel → Settings → Environment
  Variables). Data/auth is Firebase project `studio-2889504658-6ee2a`. The
  apphosting.yaml files are for a planned App Hosting setup — no backend exists yet.
- **UAT:** `mdmaktech-uat` App Hosting backend, `uat` branch — noindex ribbon,
  relaxed profile-completion, config derived from `FIREBASE_WEBAPP_CONFIG`.
  Environment detection lives in `src/lib/app-env.ts`.
  **Auto-rollout is ON**: pushing to `uat` builds and deploys on its own. Do not
  trigger builds by hand — a manual one just duplicates the automatic one.

### When UAT looks stale, read the build list before concluding anything

A failed App Hosting build is silent: the rollout fails, the site keeps serving
the last good build, and nothing announces it. That looks identical to
"auto-rollout is disabled", and it has been misdiagnosed that way once already —
four consecutive auto builds failed between Sep 2–6 2026 because two secrets
named in `apphosting.yaml` (`TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`) did not
exist in the UAT project and `TWILIO_ACCOUNT_SID` had an empty IAM policy. Every
build died at the `preparer` step before compiling a line, and UAT sat ten days
behind `uat` while appearing to have deployments switched off.

So when UAT is behind, list the builds and look at their STATE — don't infer the
backend's configuration from the newest *successful* rollout, and don't page
just one or two (`pageSize=100`, sort by `createTime`):

```
GET https://firebaseapphosting.googleapis.com/v1/projects/mdmaktech-uat/locations/us-east4/backends/studio-monaqasati/builds?pageSize=100
GET .../rollouts?pageSize=100
```

with `Authorization: Bearer $(gcloud auth print-access-token)` and the
`x-goog-user-project: mdmaktech-uat` header. A FAILED build's `buildLogsUri`
points at Cloud Build; the useful detail is in the failing step's log, readable
via `logging.googleapis.com/v2/entries:list` filtered on
`resource.type="build" AND resource.labels.build_id="<id>"`.

**Every secret listed in `apphosting.yaml` must exist in the UAT project AND
grant access to both service accounts**, or the build fails before compiling:

```bash
gcloud secrets add-iam-policy-binding <NAME> --project=mdmaktech-uat \
  --member="serviceAccount:firebase-app-hosting-compute@mdmaktech-uat.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
# plus roles/secretmanager.viewer for the same account, and
# roles/secretmanager.secretVersionManager for
# service-265884033669@gcp-sa-firebaseapphosting.iam.gserviceaccount.com
```

Adding a secret to `apphosting.yaml` without doing this breaks every subsequent
UAT deploy, including other people's.


### The mobile app's web build calls this API cross-origin

The Expo companion app (`~/mdak/mdmak-mob`) shares this Firebase project and
calls a few routes here that must run server-side: `/api/invitations/lookup`
and `/api/invitations/accept` (registration is invitation-only),
`/api/rfq-published/notify-favorites` and `/api/rag/ask`. Native builds are
not subject to CORS; the PWA export (`mdmak-mobile-uat.web.app`) is, so
`src/middleware.ts` answers preflights and stamps CORS headers on `/api/*`
responses for the origins allow-listed in `src/lib/cors.ts` (plus
`CORS_EXTRA_ORIGINS`, comma-separated, for a new hosting site without a code
change). Unlisted origins get nothing, as before. Credentials are never
allowed — the app sends a Bearer ID token.

## Design System

**Colors (Tailwind tokens — use these, never arbitrary hex):**
- `primary` (#0F172A) — dark navy, main brand
- `accent` (#20CBD5) — teal/cyan, CTAs & highlights
- `cta` (#0369A1) — blue, action buttons
- `success` (#12A063) — green, confirmations
- `secondary` (#334155) — slate, secondary text
- `muted` / `muted-foreground` — subtle backgrounds/text
- `destructive` — errors

**Typography:**
- Arabic (RTL): `Noto_Sans_Arabic` via `--font-body`
- English (LTR): `Inter` via `--font-inter`
- CSS class: `font-body` for all body text

**Special CSS utilities:**
- `.glass-card` — glassmorphism card (bg-background/80 + blur)
- `.rtl-flip` — mirror icons for RTL
- `.tracking-latin` — allow letter-spacing on latin in RTL
- `.animate-grid-drift` — animated grid background

## RTL / Bilingual Rules

1. ALL text must exist in both `messages/ar.json` and `messages/en.json`
2. Use `useTranslations('namespace')` from next-intl — never hardcode strings
3. Arabic heading line-height MUST be ≥ 1.6 (enforced by globals.css)
4. NEVER add `letter-spacing` to Arabic text — breaks cursive connections
5. Use `dir="auto"` or check `locale === 'ar'` for directional logic
6. Use `<Link>` from `@/i18n/routing` — NOT from `next/link`

## Firebase Conventions

- Client-side Firebase is in `@/firebase/` — wrap in `FirebaseClientProvider`
- Firestore rules are in `firestore.rules` — always update rules when adding collections
- Never expose Firebase Admin SDK to client components
- Auth: use `useAuth()` hook — server components can use `getServerSession()`

## Component Conventions

- **PascalCase** filenames and component names
- One component per file (except co-located sub-components)
- Use `cn()` from `@/lib/utils` for class merging — never `clsx` directly
- shadcn/ui components live in `src/components/ui/` — import from `@/components/ui/`
- Custom hooks: `use` prefix, live in `src/hooks/`
- No `any` types — use proper TypeScript types

## Do NOT

- Edit `src/components/ui/` files directly (shadcn managed)
- Use `next/link` — use the one from `@/i18n/routing`
- Hardcode Arabic/English strings — always use `useTranslations`
- Add `letter-spacing` to Arabic text
- Use inline styles when Tailwind tokens exist
- Import from `src/lol/` — deprecated/experimental code

## Branches & Environments

| Branch | Deploys to | Firebase project | URL |
|---|---|---|---|
| `main` | **Production** — Vercel, auto-deploys on push | `studio-2889504658-6ee2a` | https://mdmaktech.sa |
| `uat` | **UAT** — Firebase App Hosting backend `studio-monaqasati` (us-east4, env name `uat`), auto-deploys on push | `mdmaktech-uat` | https://studio-monaqasati--mdmaktech-uat.us-east4.hosted.app |

The two projects share nothing — separate Auth, Firestore, Storage. UAT is
seeded with demo accounts (`scripts/seed-demo-workflow.ts --env .env.uat`);
their passwords are in `..\uat-seed-accounts-*.txt`, outside the repo.

**Rules that keep the branches honest:**

1. **`uat` must never be behind `main`.** Work lands on `main` directly (team
   habit). After *every* push to `main`, merge it into `uat` and push:
   `git checkout uat && git merge main && git push origin uat`. Claude does the
   merge locally on request; the push follows the approval rule below.
2. **Never rewrite `uat`.** No `git branch -f uat`, no force-push once `uat`
   has its own commits — merge in both directions instead. If the same fix is
   needed on both branches, commit it once and merge; do not cherry-pick the
   same patch onto both (it makes the graph lie about what was tested).
3. **Something to try on UAT before prod?** Commit on `uat`, push `uat`, test,
   then merge `uat → main` (PR or `git merge uat` on `main`). That is the only
   time `uat` should be ahead of `main`.
4. **Per-environment config lives in exactly three places:**
   `apphosting.uat.yaml` (UAT build/runtime vars), Vercel's dashboard (prod
   vars), and the switch in `src/lib/app-env.ts`. `apphosting.yaml` is shared
   by every App Hosting backend — never put environment-specific values in it.
   A secret referenced in either yaml must already exist in that project's
   Secret Manager, or the build fails.
5. **`NEXT_PUBLIC_*` must be read as a literal `process.env.NEXT_PUBLIC_X`.**
   Reading through `process.env[name]` compiles to `undefined` in the browser
   (this broke UAT login once). The Firebase web config comes from App
   Hosting's `FIREBASE_WEBAPP_CONFIG` via `next.config.ts`; a UAT build
   refuses to fall back to production values by design.
6. **Firestore rules and indexes are files, not console clicks.** Edit
   `firestore.rules` / `firestore.indexes.json`, deploy to UAT first
   (`--project uat`), then to prod (`--project prod`, with approval). An index
   created only in the console is invisible to UAT and to the next project.
7. **Scripts that touch Firestore** default to production (`.env.local`).
   Pass `--env .env.uat` to target UAT, and say which project a script is
   about to hit before running it.

Open decision: prod is on Vercel and UAT on App Hosting. For a true mirror,
either move UAT to a Vercel branch deployment of `uat` or move prod to App
Hosting — see the session notes from 2026-08-27.

## Deploying & Pushing — ASK FIRST

**NEVER push to production without asking the owner first.** This is absolute and
applies to every session, no exceptions, no "it's a small change".

Requires explicit approval each time — approval for one push never carries over
to the next:

- `git push` to `origin/main` (or any remote branch)
- `firebase deploy` — hosting, functions, `firestore.rules`, `storage.rules`
- Any command that publishes, releases, or otherwise makes changes live

Committing locally is fine when asked. Stop at the commit, report what's ready,
and wait for a clear go-ahead before anything leaves the machine.

## Pull Before Commit/Push — ALWAYS

Multiple sessions work on this repo concurrently. Before ANY commit or push:
`git fetch origin` and check `HEAD..origin/main` — merge first if origin is ahead.
This matters most for **firestore.rules**: deploying a stale local copy silently
wipes the other session's rules from production. After pulling, verify live rules
still match git before touching them.

## Deploying firestore.rules (CLI doesn't work here)

`firebase deploy` fails in this environment. Use the script — from the project
root, so `node_modules` resolve:

```bash
node scripts/deploy-rules.js prod --check   # READ-ONLY: what is live, and which commit it is
node scripts/deploy-rules.js prod           # service-account creds from .env.local
node scripts/deploy-rules.js uat --check
node scripts/deploy-rules.js uat            # gcloud token if gcloud is installed, else the
                                            # service account in .env.uat (no gcloud on the WSL box)
node scripts/deploy-indexes.js prod --check # composite indexes of firestore.indexes.json the
node scripts/deploy-indexes.js prod         # project lacks — creates only those, deletes nothing
```

It POSTs a ruleset to `firebaserules.googleapis.com`, PATCHes
`releases/cloud.firestore` to point at it, then reads the live ruleset back and
prints whether it matches the file byte-for-byte. **Always `git fetch` and diff
`firestore.rules` against `origin/main` first** — deploying a stale local copy
silently wipes another session's rules. Then run `--check`: it names the commit
the live rules came from, or says they match no commit — in which case someone
deployed uncommitted rules and they must be compared before being overwritten.
(A service-account token must NOT send `x-goog-user-project`; only a gcloud
user token needs that header — the script handles it.)

## How we work — every session (read before acting)

This is the standing workflow. It applies to every request unless the owner says otherwise.

**1. Start**
- Read memory (`MEMORY.md`). For status questions, check the open Jira issues (see Connectors).
- `git fetch origin` and check `HEAD..origin/main` before touching anything. Other sessions push here.

**2. Change**
- Follow the rules above (RTL/i18n, `cn()`, no `any`, zod at boundaries, rules for new collections).
- Every user-visible string goes in both `messages/ar.json` and `messages/en.json`.
- Every fix gets a test that fails without it. A bug seen in the UI is re-checked in the UI, on UAT when possible.
- Some files are mirrored verbatim into the mobile app (`~/Downloads/_Projects/mdmak-mob/artifacts/mobile`; the list is in `scripts/check-mirrors.mjs` there): procurement `types.ts`/`po.ts`/`supplier.ts`/`receipts.ts`, `mfg-events.ts`, `sales-numbering.ts`, accounting, and others. After changing one, re-copy it whole into mobile and run `node scripts/check-mirrors.mjs <webDir>`. After reviewing any REVIEW items, run it again with `--update-lock`. Then run mobile `npx tsc --noEmit` and `npx jest`.

**3. Check before committing** (all must pass)
- `npx tsc --noEmit`. The only accepted errors are the existing ones in `src/__tests__/lib-seo.test.ts` and `src/ai/generate.ts`.
- `npx jest` (full suite).
- `node scripts/check-i18n-links.mjs`: 0 missing keys, 0 one-language keys, 0 dead links.
- `npx eslint <changed files>`: no new warnings.
- The pre-commit hook also runs the production build (several minutes per commit), so batch commits sensibly.

**4. Commit and push**
- Commit in logical chunks, with the attribution trailer the session asks for.
- **Every push needs the owner's explicit yes, every time.** After pushing `main`, run `git checkout uat && git merge main && git push origin uat` so uat never falls behind, then go back to `main`. The mobile repo is pushed separately and needs its own yes.
- Never commit the owner's local `.claude/settings.json` edits unless asked. It is shared team config.
- After a push to `uat`, confirm the App Hosting build reaches READY (build list API in "When UAT looks stale").

**5. Track**
- Jira DEV: open an issue for each finding or piece of work, and close it with the commit hash once pushed.

**6. Testing on UAT**
- Claude never types passwords or submits sign-in forms. The owner signs in (the Claude browser pane for one role, Chrome for the other). Test accounts are in `..\uat-seed-accounts-*.txt`; never print or commit them.
- Irreversible test actions (saving a receipt, accepting an order, sending a notice) need the owner's OK first.
- When a memo depends on a React Hook Form array, use `useWatch`, not `watch()`. `watch` returns an array it mutates in place, so the memo never recomputes.

## Connectors & external services

| Service | What / where | Notes |
|---|---|---|
| **Jira** (Atlassian connector) | https://marcokhouzam.atlassian.net, project **DEV** (service desk), cloudId `f31eee5b-9ca0-495e-9a94-582c48d8c899` | Task: transition 61 "Mark as done". Bug / New Feature: 2 Assign → 3 Start work → 9 Resolved. Labels: `shipped`, `uat-YYYY-MM-DD`. Confluence on this site returned "temporarily unavailable" (24 Sep 2026) |
| **Sentry** (connector) | https://mdmak.sentry.io, org `mdmak` (region `https://de.sentry.io`), project `studio-monaqasati` | Uptime monitors: prod 2289683, UAT 2289684 (every 5 min, alert after 3 failures). Readable stack traces need `SENTRY_AUTH_TOKEN` in Vercel (DEV-21) |
| **Twilio** (docs connector) | Searches and reads Twilio's docs only; it cannot send messages or change the account | KSA: the alpha sender ID `MdmakTech` needs NOC registration (DEV-1). Codes via Verify (DEV-2). Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_VERIFY_SERVICE_SID` |
| **Vercel** | Production site. Env vars live in its dashboard (a teammate's account) | Not connected yet. Claude cannot see production deploys or logs until it is |
| **Figma**, **Gmail** | Connected | Send email only when the owner asks (his address: marcokhouzam@gmail.com) |

**Security & performance tooling**
- **Baseline today:** `npm audit --omit=dev`. On 25 Sep 2026 it reported 2 critical and 16 high. The top one, `next` 15.5.9, was upgraded to **15.5.26** the same day (bc2d016). What remains is 1 critical (`websocket-driver`, transitive) and the highs, mostly through Genkit and OpenTelemetry. Tracked in DEV-22.
- **SonarQube** (code quality + security): official `SonarSource/sonarqube-mcp-server`; the Claude Code quickstart is in the Sonar docs. Needs a SonarQube Cloud or Server token.
- **Black Duck SCA** (dependency risk / SBOM): official `blackducksoftware/sca-mcp` (pip `blackduck-sca-mcp`). Needs a Black Duck instance URL and an API token (enterprise license). Use a read-only token, because a write token lets the assistant change remediation status.
- **Snyk** (free-tier alternative): the Snyk CLI ≥ 1.1298 includes an MCP server (`snyk mcp`). Needs a Snyk account.
- **Performance:** Grafana `grafana/mcp-k6` for load tests (needs the k6 binary). Sentry performance tracing (10% of requests) is already on. Lighthouse runs without a connector (`npx lighthouse <url>`).
- **Adding a tool:** `claude mcp add …` in an interactive terminal, with the token supplied by the owner. Claude never pastes tokens into forms.

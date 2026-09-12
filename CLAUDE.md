# Mdmak Tech — Studio Monaqasati

**B2B Smart Procurement & RFQ Platform** connecting contractors with suppliers in Saudi Arabia.
**Site:** https://mdmaktech.sa | **Locales:** Arabic (default, RTL) · English (LTR)

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js **15.5.9** (App Router, Turbopack) |
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
> Currently on 15.5.9 — those skills will refuse. Upgrade when ready: `npx next upgrade`

## Directory Map

```
src/
  app/
    [locale]/           # All public pages (ar/en)
      (admin)/          # Admin portal (route group)
      (contractor)/     # Contractor portal — dashboard tile grid at /contractor,
                        #   modules: projects (BOQ, tenders), rfqs, crm/{leads,
                        #   opportunities,rfqs}, inventory/warehouses, invoices/
                        #   guarantees (finance), sales (quotations before/after
                        #   manufacturing + customer payments — NOT part of finance),
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
scripts/                # Ops scripts (demo seed, data repair, migrations)
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
| `src/lib/crm.ts` / `crm-writes.ts` | CRM domain types, tracks/gates/value ladder, deal→project handover writes |
| `src/lib/app-env.ts` / `feature-flags.ts` | Environment detection (prod vs UAT) and feature flags |
| `src/components/StructuredData.tsx` | JSON-LD structured data injected in root layout |
| `src/app/[locale]/content.tsx` | Landing page heavy content (~48KB) — **avoid SSR blocking here** |

## Firestore Collections (top-level)

`users` (+ `notifications`, `2fa` subcolls) · `organizations` (secondary companies) ·
`teamGroups` (permission groups) · `invitations` · `accessRequests` (member asks owner
for a module) · `projects` (+ `boqItems`, `boqGroups`, `members`, `ipcClaims`,
`wasteRecords`) · `rfqs` (+ `inquiries`) · `offers` · `deliveries` · `guarantees` ·
`warehouses` (+ `inventoryItems`, `transfers`, `wasteRecords`) · `crmContacts` ·
`crmOpportunities` · `crmQuotations` (also the Sales pipeline: phase, payment schedule,
payments) · `crmActivities` · `crmOrgProfile` (doc id = orgId) · `salesPriceItems` ·
`manufacturingDepartments` (+ capacity: workers × hoursPerDay, hourlyRate, onSite flag,
checklist template) · `workOrders` (legacy stage-flow orders AND v2 product-born orders —
a v2 order carries `productId`, `quantity`, per-department `progress` {done, rejected,
rework, hours}, gate facts (measurement, drawingApprovalStatus, slabApproval with block),
`materials` (per-station withdrawals: requested → released → received), `scrapRecords`,
`checklists`; delivered/ready/WIP are DERIVED by `src/lib/manufacturing-engine.ts`,
never stored) · `mfgProducts` (بطاقة المنتج — route + BOM + standard time + planned
waste + blocking flags; the basis of every date, cost and material request) ·
`mfgCostEstimates` (تقدير التكلفة — the workshop issues cost and lead time, sales set
the price, the award creates work orders) · `manufacturingSettings` (doc id = orgId —
feature switches time/estimates/checklists + Finance policies: overhead rate, margin
floor, scrap approval limit, answer window) · `deliveryNotes` (manufacturing → warehouse
handovers, signed by the receiver; v2 adds partial quantities, transit breakage,
driver/crates) · `salesOrders` (أوامر البيع — the backbone between
quotation and cash; delivered/invoiced are DERIVED from notes and invoices, never
stored) · `salesDeliveryNotes` (customer deliveries; stock leaves at confirm) ·
`salesInvoices` (built on delivered notes; deposits recovered pro-rata) ·
`salesReturns` (Sales decides, Finance issues the credit note) ·
`manufacturingRequests` (طلب تصنيع — Sales asks, the plant accepts into a work
order or rejects with a reason) · `accounting_journal` (the general journal —
append-only, entry id is `{orgId}__{sourceType}__{sourceId}`) ·
`accounting_accounts` · `accounting_periods` (month locks) ·
`accounting_settings` (doc id = orgId; the module is OFF until `enabled: true`) ·
`invoices` · `rfqShareLinks` · `guestOfferLinks`
(server-only)

Permission notes: org **owner** passes every check; members get their group's
permissions (`teamGroups.permissions`, `'*'` = all). Closing/handing over a CRM deal
needs `crm.close`. Sales reads `crmQuotations`: marking one accepted needs `sales.approve`
(or `crm.close`) — that notifies Finance of the deposit and opens the work order; recording
a customer payment (`payments`/`paidAt`) needs `sales.approve` or `invoices.manage`; a
`post_manufacturing` quotation never spawns a work order. A finished work order hands
over on a `deliveryNotes` doc and its stock lands only when someone with
`warehouses.receive` (or `warehouses.manage`) confirms; the virtual distribution
warehouse is received on the spot. Manufacturing splits four ways: `manufacturing.manage` is the workshop manager
(answers requests, creates/releases orders, approves scrap up to the org's limit,
edits departments and product cards); `manufacturing.work` is a department hand
(reports output and hands over, requests/receives materials, ticks checklists);
`manufacturing.qc` decides rework-or-scrap, records the client's slab sign-off and
breakage decisions; `manufacturing.cost` sees cost and margin, approves ANY scrap,
and may risk-release a blocked order with a documented reason. Plain org members
keep the legacy stage/handover field set on workOrders (stage assignees need it).
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
node scripts/deploy-rules.js prod   # service-account creds from .env.local
node scripts/deploy-rules.js uat    # gcloud auth print-access-token
```

It POSTs a ruleset to `firebaserules.googleapis.com`, PATCHes
`releases/cloud.firestore` to point at it, then reads the live ruleset back and
prints whether it matches the file byte-for-byte. **Always `git fetch` and diff
`firestore.rules` against `origin/main` first** — deploying a stale local copy
silently wipes another session's rules. The same API (GET release → GET ruleset
source) is how to diff live rules against git.

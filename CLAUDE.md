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
      (contractor)/     # Contractor portal (route group)
      (supplier)/       # Supplier portal (route group)
      about/ contact/ pricing/ privacy/ terms/
      layout.tsx        # Root layout — fonts, metadata, providers
      page.tsx          # Landing page (imports content.tsx)
      content.tsx       # Heavy landing page content — ~48KB
    api/                # Next.js API routes
    globals.css         # CSS vars + Tailwind base + RTL rules
  components/
    ui/                 # shadcn/ui primitives (DO NOT touch unless fixing)
    layout/             # Navbar, Footer, Sidebar shared layout
    supplier/           # Supplier-specific components
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
```

## Key Utilities

| File | Purpose |
|---|---|
| `src/lib/seo.ts` | `alternatesForPath()` + `buildPageMetadata()` — use for all page metadata & hreflang |
| `src/lib/utils.ts` | `cn()` class merger — always use instead of `clsx` |
| `src/i18n/routing.ts` | `Link`, `useRouter`, `redirect` — locale-aware navigation |
| `src/components/StructuredData.tsx` | JSON-LD structured data injected in root layout |
| `src/app/[locale]/content.tsx` | Landing page heavy content (~48KB) — **avoid SSR blocking here** |


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

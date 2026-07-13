# مدماك تيك — Studio Monaqasati

**B2B Smart Procurement & RFQ Platform** — connects contractors with suppliers in Saudi Arabia.

**Live:** https://mdmaktech.sa | **Locales:** Arabic (default, RTL) · English (LTR)

---

## Quick Start

```bash
npm install
cp .env.example .env.local        # fill in Firebase credentials
npm run dev                        # http://localhost:9002
```

---

## Roles

| Role | What they do |
|---|---|
| **Contractor** | Create projects, post RFQs/Tenders, review offers, manage BOQ, track deliveries, browse quick catalog |
| **Supplier** | Browse RFQs, submit price offers, manage supplier connections, track orders |
| **Admin** | Manage users, view platform stats, oversee RFQs |

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5.9 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + tailwindcss-animate |
| Components | shadcn/ui (Radix UI primitives) |
| Animations | Framer Motion 12 |
| i18n | next-intl 4 — `ar` (default, RTL), `en` (LTR) |
| Auth / DB | Firebase 11 (Firestore, Auth, Storage) |
| AI | Genkit + Google GenAI (Gemini) |
| Forms | react-hook-form + zod |
| Testing | Jest (unit) + Playwright (e2e) |
| Charts | Recharts |
| Maps | Leaflet + react-leaflet |

---

## Commands

```bash
# Development
npm run dev              # Next.js on port 9002 (Turbopack)
npm run genkit:dev       # Genkit AI dev server
npm run genkit:watch     # Genkit with file watching

# Quality
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint src/**/*.{ts,tsx}
npm run ci               # typecheck + lint + build + test

# Tests
npm run test             # Jest unit tests (src/__tests__ only)
npm run test:watch       # Jest watch mode
npm run test:coverage    # Jest with coverage
npm run e2e              # Playwright e2e
npm run e2e:ui           # Playwright interactive UI

# Firebase
firebase deploy --only firestore:rules --project <project-id>
firebase deploy --only firestore:indexes --project <project-id>
```

---

## Environment Variables

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

GOOGLE_GENAI_API_KEY=
```

---

## Directory Map

```
src/
  app/
    [locale]/
      (admin)/admin/            # Admin portal
      (contractor)/contractor/  # Contractor portal
      (supplier)/supplier/      # Supplier portal
      about/ contact/ pricing/ privacy/ terms/
      layout.tsx                # Root layout — fonts, metadata, providers
      page.tsx + content.tsx    # Landing page (content split for perf)
    api/
      rag/ask/                  # AI RAG assistant endpoint
      landing-chat/             # Landing page chat endpoint
      login-hint/               # Auth login hint
      sms/                      # SMS verification
    globals.css
  components/
    ui/                         # shadcn/ui primitives (DO NOT edit)
    layout/                     # Navbar, Footer, RoleSidebar, PortalLayout
    contractor/                 # Contractor-specific components
    supplier/                   # Supplier-specific components
    rag/                        # AI assistant widget
    StructuredData.tsx          # JSON-LD for SEO
  firebase/                    # Firebase client/server configs + hooks
  hooks/                       # Custom React hooks (useXxx)
  i18n/routing.ts              # next-intl locale routing
  lib/
    constants.ts                # PREDEFINED_CATEGORIES, cities, units, etc.
    catalog-utils.ts            # contractorCatalog upsert logic
    seo.ts                      # buildPageMetadata(), alternatesForPath()
    utils.ts                    # cn() class merger
  ai/
    flows/                      # Genkit AI flows
    genkit.ts                   # Genkit instance
    generate.ts                 # aiGenerate() wrapper
messages/
  ar.json                       # Arabic translations (primary)
  en.json                       # English translations
firestore.rules                 # Firestore security rules
firestore.indexes.json          # Composite indexes
```

---

## Documentation

| Doc | Contents |
|---|---|
| [docs/frontend/ARCHITECTURE.md](docs/frontend/ARCHITECTURE.md) | Pages, components, design system, i18n, RTL |
| [docs/backend/ARCHITECTURE.md](docs/backend/ARCHITECTURE.md) | Firestore schema, security rules, AI flows |
| [docs/api/API.md](docs/api/API.md) | API routes, Firebase hook patterns |
| [CLAUDE.md](CLAUDE.md) | AI assistant context (stack, rules, conventions) |

---

## Key Conventions

- **i18n**: every user-visible string must exist in both `messages/ar.json` and `messages/en.json`. Use `useTranslations()` — never hardcode strings.
- **Navigation**: use `Link` and `useRouter` from `@/i18n/routing`, not `next/link`.
- **Class merging**: always use `cn()` from `@/lib/utils`, never `clsx` directly.
- **No `any` types** — TypeScript strict mode throughout.
- **RTL first**: design Arabic layout first, verify English second.
- **Firebase Admin SDK**: server-only — never import in client components.
- **Firestore rules**: update `firestore.rules` whenever a collection is added, then deploy.

# Frontend Architecture — مدماك تيك

## Overview

Next.js 15.5.9 App Router application with TypeScript 5, Tailwind CSS 3, shadcn/ui, and Firebase 11. Arabic (RTL) is the primary locale; English (LTR) is secondary. All pages live under `src/app/[locale]/`.

---

## Route Structure

### Contractor Portal — `/contractor/*`

| Route | Description |
|---|---|
| `/contractor` | Dashboard |
| `/contractor/projects` | Project list |
| `/contractor/projects/new` | Create project |
| `/contractor/projects/[id]` | Project detail + BOQ management |
| `/contractor/projects/[id]/tenders` | Tenders linked to a project |
| `/contractor/projects/[id]/tenders/new` | Create tender from BOQ items |
| `/contractor/projects/[id]/tenders/[tenderId]` | Tender detail |
| `/contractor/projects/[id]/tenders/[tenderId]/offers` | Offers on a tender |
| `/contractor/rfqs` | All RFQs list |
| `/contractor/rfqs/new` | Create RFQ (accepts `?catalog=id1,id2` to pre-fill) |
| `/contractor/rfqs/[id]` | RFQ detail |
| `/contractor/rfqs/[id]/offers` | Offers on an RFQ |
| `/contractor/catalog` | Quick materials catalog |
| `/contractor/suppliers` | Browse & connect with suppliers |
| `/contractor/supplier/profile/[id]` | Supplier public profile |
| `/contractor/goods-received` | Delivery receipts log |
| `/contractor/chats` | Chat list |
| `/contractor/chat/[chatId]` | Chat thread |
| `/contractor/notifications` | Notifications |
| `/contractor/team` | Team member management |
| `/contractor/profile` | Profile & documents |

### Supplier Portal — `/supplier/*`

| Route | Description |
|---|---|
| `/supplier` | Dashboard |
| `/supplier/rfqs` | Browse available RFQs |
| `/supplier/offers` | My submitted offers + status |
| `/supplier/orders` | Active orders |
| `/supplier/connections` | Contractor connection requests |
| `/supplier/chats` | Chat list |
| `/supplier/chat/[chatId]` | Chat thread |
| `/supplier/notifications` | Notifications |
| `/supplier/team` | Team management |
| `/supplier/profile` | Profile, specializations & documents |

### Admin Portal — `/admin/*`

| Route | Description |
|---|---|
| `/admin` | Dashboard + platform stats |
| `/admin/rfqs` | All platform RFQs |
| `/admin/rfqs/[id]` | RFQ detail |
| `/admin/suppliers` | Supplier list & verification |
| `/admin/contractors` | Contractor list |
| `/admin/notifications` | Notification center |
| `/admin/stats` | Analytics charts |
| `/admin/settings` | Platform settings |
| `/admin/seed` | Data seeding tool (dev only) |

### Public Pages

`/` (landing), `/about`, `/contact`, `/pricing`, `/privacy`, `/terms`, `/login`, `/register`, `/verify-email`, `/chat/[chatId]`

---

## Component Architecture

### Layout (`src/components/layout/`)

| Component | Purpose |
|---|---|
| `role-sidebar.tsx` | Sidebar nav — role-specific sections. Contractor sections: Workspace (Dashboard, Projects+children, Catalog, Suppliers, Goods Received), Communication (Chats, Notifications), Settings (Team, Profile). Supplier and Admin have equivalent sections. |
| `portal-layout.tsx` | Page wrapper used by all portal pages — provides consistent padding and sidebar context |
| `Navbar.tsx` | Top navigation bar for public (landing) pages |
| `Footer.tsx` | Public footer |

### Contractor (`src/components/contractor/`)

| Component | Purpose |
|---|---|
| `RfqForm.tsx` | Create/edit RFQ with products table, multi-category, deadline, file attachments. Reads `?catalog=id1,id2` on mount to pre-fill products from catalog. After publish (status=New) calls `upsertCatalogItems()` fire-and-forget. |
| `ContractorCatalog.tsx` | Quick materials catalog — search input, category filter chips, multi-select card grid, floating action bar that navigates to `/contractor/rfqs/new?catalog=...` |
| `ProjectForm.tsx` | Create/edit project with region, type, client type, BOQ upload |
| `BoqTable.tsx` | Bill of Quantities — editable rows per project, push items to tenders |
| `OfferCard.tsx` | Displays a supplier's price offer with accept/reject actions |

### Supplier (`src/components/supplier/`)

| Component | Purpose |
|---|---|
| `SupplierRfqCard.tsx` | RFQ card in browse view — shows category, deadline, offers count |
| `OfferForm.tsx` | Submit a price offer on an RFQ with price, delivery date, notes |
| `SupplierProfile.tsx` | Public-facing supplier profile card shown to contractors |

### AI Assistant (`src/components/rag/`)

| Component | Purpose |
|---|---|
| `AiAssistant.tsx` | Floating chat widget present in all portal pages |
| `AiMessageBubble.tsx` | Renders messages with inline action buttons and nav links |
| `AiActionConfirm.tsx` | Confirms pending actions before executing (submitOffer, createRFQ, openCatalog, etc.) |

### Shared

| Component | Purpose |
|---|---|
| `StructuredData.tsx` | JSON-LD structured data injected in root layout for SEO |
| `FirebaseErrorListener.tsx` | Global error boundary for Firebase errors |
| `ReviewDialog.tsx` | Post-delivery supplier review dialog |
| `team-management.tsx` | Shared team member invite/manage UI (contractor + supplier) |

---

## Design System

### Color Tokens (Tailwind — never use arbitrary hex)

| Token | Usage |
|---|---|
| `primary` (#0F172A) | Dark navy — main brand, headings, sidebar background |
| `accent` (#20CBD5) | Teal/cyan — CTAs, highlights, active states, selection indicators |
| `cta` (#0369A1) | Blue — action buttons |
| `success` (#12A063) | Green — confirmations, verified badges |
| `secondary` (#334155) | Slate — secondary text |
| `muted` / `muted-foreground` | Subtle backgrounds and placeholder text |
| `destructive` | Errors, delete confirmations |

### Typography

| Context | Font | Apply via |
|---|---|---|
| Arabic RTL | Noto Sans Arabic | `font-body` class (auto via `--font-body`) |
| English LTR | Inter | `font-body` class (switches automatically by locale) |

**Rules:**
- Arabic headings: `line-height` ≥ 1.6 (enforced globally in `globals.css` — do not override lower)
- Never add `letter-spacing` to Arabic text — breaks cursive letter connections
- Use `.tracking-latin` for Latin text embedded inside RTL layouts

### Special CSS Classes (`globals.css`)

| Class | Effect |
|---|---|
| `.glass-card` | `bg-background/80 backdrop-blur-md` glassmorphism |
| `.rtl-flip` | Mirrors icons for RTL with `scaleX(-1)` |
| `.tracking-latin` | Enables letter-spacing on Latin inside RTL |
| `.animate-grid-drift` | Animated CSS grid background (landing hero) |
| `.font-headline` | Display/headline font weight variant |

### Spacing & Radius

- Spacing: multiples of 4px — `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`
- `rounded-sm` = 8px · `rounded-md` = 10px · `rounded-lg` = 12px · `rounded-xl` = 16px · `rounded-2xl` = 20px

---

## i18n & RTL

### Locale Routing

- Default locale: `ar` (no URL prefix — `/contractor/rfqs`)
- English: `/en` prefix — `/en/contractor/rfqs`
- Configured in `src/i18n/routing.ts` with `localePrefix: 'as-needed'`

### Usage Pattern

```tsx
// Server Component
import { getTranslations } from 'next-intl/server';
const t = await getTranslations('Namespace');

// Client Component
import { useTranslations } from 'next-intl';
const t = useTranslations('Namespace');

// Locale in client components
import { useLocale } from 'next-intl';
const locale = useLocale(); // 'ar' | 'en'
const isRTL = locale === 'ar';
```

### Navigation (always use routing wrappers)

```tsx
import { Link, useRouter, redirect } from '@/i18n/routing';
// NOT from 'next/link' or 'next/navigation'
```

### Translation Namespaces (`messages/ar.json` + `messages/en.json`)

| Namespace | Contents |
|---|---|
| `Portal.Sidebar` | Sidebar nav labels (contractor_catalog, contractor_rfqs, etc.) |
| `Portal.Contractor` | All contractor portal strings (prefixed: `rfq_*`, `catalog_*`, `project_*`, `boq_*`) |
| `Portal.Supplier` | Supplier portal strings |
| `Portal.Admin` | Admin portal strings |
| `Landing` | Landing page content sections |
| `Auth` | Login, register, verify-email |
| `Common` | Shared — save, cancel, loading, error, etc. |

### RTL Layout Rules

1. Use `ms-*` / `me-*` instead of `ml-*` / `mr-*` for inline margins
2. Use `dir="auto"` on dynamic text containers
3. Flip directional icons with `.rtl-flip`
4. Always test both `dir="rtl"` and `dir="ltr"` before marking complete

---

## Firebase Data Layer

### Hooks (`src/firebase/`)

| Hook | Returns | Description |
|---|---|---|
| `useUser()` | `{ user, isUserLoading }` | Current authenticated user |
| `useFirestore()` | Firestore instance | Use to build refs/queries |
| `useDoc(ref)` | `{ data, isLoading, error }` | Real-time single doc subscription |
| `useCollection(query)` | `{ data[], isLoading, error }` | Real-time collection/query subscription |
| `useMemoFirebase(fn, deps)` | stable ref/query | Memoize refs to prevent re-subscribe loops |

### Standard Data Fetch Pattern

```tsx
const firestore = useFirestore()
const { user, isUserLoading } = useUser()

// Memoize query — prevents re-subscribing on every render
const rfqsQuery = useMemoFirebase(() => {
  if (!firestore || !user) return null
  return query(
    collection(firestore, 'rfqs'),
    where('organizationId', '==', orgId),
    orderBy('createdAt', 'desc')
  )
}, [firestore, user, orgId])

const { data: rfqs, isLoading } = useCollection(rfqsQuery)
```

---

## Forms

All forms: **react-hook-form** + **zod resolver**

```tsx
const schema = z.object({
  title: z.string().min(3),
  deadline: z.string(),
})

const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
  defaultValues: { title: '', deadline: '' },
})
```

- Inline errors on blur/submit — not on every keystroke
- Submit button disabled while `isSubmitting`
- `toast()` from `@/components/ui/use-toast` for success/error feedback

---

## Animations (Framer Motion 12)

```tsx
// Card entrance
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95 }}
/>

// Floating bar (spring)
<motion.div
  initial={{ y: 100, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  exit={{ y: 100, opacity: 0 }}
  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
/>

// List stagger
<AnimatePresence>
  {items.map((item, i) => (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.08 }}
    />
  ))}
</AnimatePresence>
```

- Enter: 0.3–0.5s · Exit: 0.2–0.3s
- `viewport={{ once: true }}` for scroll-triggered animations
- Never animate `opacity`/`transform` simultaneously with layout shift

---

## SEO

- `src/lib/seo.ts` — `buildPageMetadata()` for every page, `alternatesForPath()` for `hreflang`
- `src/components/StructuredData.tsx` — JSON-LD (`Organization`, `WebSite`, `Service`) in root layout
- `sitemap.xml` generated at build time from static routes
- Every `page.tsx` exports `generateMetadata`

---

## Quick Materials Catalog

**Purpose:** contractors can build a recurring-items catalog automatically populated from their RFQs, then create new RFQs from it in 2 clicks.

**Key files:**
- `src/lib/catalog-utils.ts` — `CatalogItem` interface + `upsertCatalogItems()` function
- `src/components/contractor/ContractorCatalog.tsx` — full catalog UI
- `src/app/[locale]/(contractor)/contractor/catalog/page.tsx` — server wrapper + metadata

**UX flow:**
1. Contractor publishes RFQ → `upsertCatalogItems()` runs fire-and-forget after redirect
2. Each product upserted to `contractorCatalog` (match: category + subCategory + unit → increment `usageCount`, or create new)
3. `/contractor/catalog` — search bar + category filter chips + card grid sorted by `usageCount`
4. Multi-select cards → floating action bar → "Create RFQ for N items"
5. Navigates to `/contractor/rfqs/new?catalog=id1,id2,...`
6. `RfqForm` reads `?catalog` param, fetches docs, pre-fills products table, shows toast

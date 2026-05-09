# Frontend Architecture - مدماك تيك

## Overview

The frontend is a **Next.js 15** (App Router) application with **React 19**, **TypeScript**, and **Tailwind CSS**. It uses a component-based architecture with the Shadcn/ui design system and Firebase for backend services.

## Tech Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | Next.js | 15.5.9 |
| UI Library | React | 19.2.1 |
| Styling | Tailwind CSS | 3.4.1 |
| Components | Shadcn/ui + Radix UI | Latest |
| State | React Hook Form + Zod | 7.54.2 / 3.24.2 |
| Charts | Recharts | 2.15.1 |
| Maps | React Leaflet | 5.0.0 |
| Icons | Lucide React | 0.475.0 |
| Auth | Firebase Auth | 11.9.1 |
| Database | Firebase Firestore | 11.9.1 |
| Testing | Jest + Playwright | 30.3.0 / 1.59.1 |
| AI | Genkit | 1.28.0 |

## Project Structure

```
src/
├── app/                          # Next.js App Router pages
│   ├── (admin)/                  # Admin route group
│   │   └── admin/
│   │       ├── page.tsx          # Admin dashboard
│   │       ├── rfqs/page.tsx     # All RFQs view
│   │       ├── suppliers/page.tsx # Supplier management
│   │       ├── notifications/page.tsx
│   │       ├── stats/page.tsx
│   │       ├── settings/page.tsx
│   │       └── seed/page.tsx     # Data seeding
│   ├── (contractor)/            # Contractor route group
│   │   └── contractor/
│   │       ├── page.tsx         # Dashboard
│   │       ├── rfqs/
│   │       │   ├── page.tsx     # RFQ list with filters
│   │       │   ├── new/page.tsx  # Create RFQ
│   │       │   └── [id]/offers/page.tsx # Offers for RFQ
│   │       ├── suppliers/page.tsx
│   │       ├── profile/page.tsx
│   │       ├── chats/page.tsx
│   │       └── notifications/page.tsx
│   ├── (supplier)/              # Supplier route group
│   │   └── supplier/
│   │       ├── page.tsx         # Dashboard with quick offer
│   │       ├── rfqs/page.tsx    # Browse RFQs
│   │       ├── offers/page.tsx  # My submitted offers
│   │       ├── orders/page.tsx
│   │       ├── profile/page.tsx
│   │       ├── chats/page.tsx
│   │       └── notifications/page.tsx
│   ├── chat/
│   │   └── [chatId]/page.tsx    # Chat page
│   ├── login/page.tsx           # Login page
│   ├── register/page.tsx        # Registration page
│   ├── layout.tsx               # Root layout with Firebase provider
│   └── page.tsx                 # Landing page
├── components/
│   ├── ui/                      # Shadcn/ui components (Accordion, Alert, etc.)
│   ├── layout/
│   │   └── portal-layout.tsx    # Shared portal layout with sidebar
│   ├── FirebaseErrorListener.tsx
│   └── chats-list-page.tsx
├── firebase/                    # Firebase configuration & hooks
│   ├── index.ts                 # Firebase initialization
│   ├── config.ts                 # Firebase config object
│   ├── provider.tsx             # React context provider
│   ├── client-provider.tsx       # Client-side provider wrapper
│   ├── firestore/
│   │   ├── use-collection.tsx    # Hook for querying collections
│   │   ├── use-doc.tsx           # Hook for single document
│   │   └── use-collection-paginated.tsx # Paginated collection query
│   ├── errors.ts                # Error types
│   ├── error-emitter.ts         # Global error handling
│   ├── on-blocking-updates.tsx
│   └── on-blocking-login.tsx
├── hooks/
│   ├── use-toast.ts             # Toast notification hook
│   └── use-mobile.tsx           # Mobile detection hook
├── lib/
│   ├── utils.ts                 # cn() helper
│   ├── constants.ts             # PREDEFINED_CATEGORIES, SAUDI_CITIES
│   └── placeholder-images.ts
├── ai/                          # Genkit AI flows
│   ├── flows/
│   │   ├── draft-rfq-description-flow.ts
│   │   ├── recommend-suppliers-for-rfq-flow.ts
│   │   ├── suggest-supplier-specializations-flow.ts
│   │   └── recommend-rfq-for-supplier-flow.ts
│   ├── genkit.ts               # Genkit configuration
│   ├── cache.ts                # AI response caching
│   └── dev.ts                  # Dev server entry
└── utils/
    ├── rfq-products.ts         # Product management for RFQs
    ├── rfq-filters.ts          # RFQ filtering and sorting
    ├── offer-utils.ts          # Offer calculations
    └── inquiry-utils.ts        # Inquiry helpers
```

## Route Structure

### Public Routes
- `/` - Landing page
- `/login` - Login page
- `/register` - Registration page

### Role-Based Routes (Protected)
- `/admin/*` - Admin dashboard (requires Admin role)
- `/contractor/*` - Contractor portal (requires Contractor role)
- `/supplier/*` - Supplier portal (requires Supplier role)

### Shared Routes
- `/chat/[chatId]` - Chat functionality (all roles)

## Authentication Flow

1. **Registration** (`/register`):
   - User selects role (Contractor or Supplier)
   - Creates Firebase Auth account with email/password
   - Creates user document in Firestore
   - Redirects to respective portal

2. **Login** (`/login`):
   - User enters credentials
   - Firebase Auth validates
   - Fetches user document from Firestore
   - Routes based on role

3. **Auth State Management**:
   - `FirebaseClientProvider` initializes Firebase
   - `FirebaseProvider` wraps app with auth context
   - `useFirebase` hook provides auth, firestore, user

## Component Patterns

### PortalLayout
Provides consistent layout with sidebar navigation:
```tsx
<PortalLayout>
  {/* Page content */}
</PortalLayout>
```

### Data Fetching
```tsx
const query = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  return query(collection(firestore, "collection"))
}, [firestore, user, isUserLoading])

const { data, isLoading } = useCollection(query)
```

### Form Submission
```tsx
const submitOffer = async () => {
  try {
    await addDoc(collection(firestore, "offers"), offerData)
    toast({ title: "Success!" })
  } catch (error) {
    toast({ title: "Error", variant: "destructive" })
  }
}
```

## UI/UX Guidelines

### Design Tokens

```css
--primary: #2874D4;        /* Trust & professionalism */
--primary-hover: #1E5BA8;
--background: #ECF2F9;     /* Soft blue-grey */
--accent: #20CBD5;         /* Vivid cyan */
--sidebar: #0B1F3A;        /* Dark navy */
--card: #FFFFFF;
--card-border: #E2E8F0;
--success: #12A063;
--destructive: #DC2626;
--warning: #F59E0B;
```

### Layout Principles

1. **RTL-First**: All content flows right-to-left (`dir="rtl"`)
2. **Sidebar Navigation**: Persistent dark navy sidebar
3. **Card-Based Content**: Clean white cards with subtle borders
4. **Responsive**: Mobile-first with breakpoints at 640px, 768px, 1024px, 1280px

### Design System Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | #2874D4 | Buttons, links, key highlights |
| Primary Hover | #1E5BA8 | Button hover states |
| Background | #ECF2F9 | Page background |
| Accent | #20CBD5 | Secondary actions |
| Sidebar | #0B1F3A | Navigation background |
| Success | #12A063 | Positive statuses |
| Destructive | #DC2626 | Error states |
| Warning | #F59E0B | Warning states |

## State Management

### Client State
- React Hook Form for form state
- React Context for auth state
- Local state for UI state

### Server State
- Firestore real-time subscriptions via custom hooks
- Optimistic updates for better UX

### Form Validation
- Zod schemas for validation
- Server-side validation via Firestore security rules

## Testing

### Unit Tests (Jest)
- Location: `src/__tests__/*.test.ts`
- Run: `npm run test`

### E2E Tests (Playwright)
- Location: `e2e/*.spec.ts`
- Run: `npm run e2e`

## Available Scripts

```bash
# Development
npm run dev              # Start dev server on port 9002

# Build
npm run build            # Production build
npm run start            # Start production server
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript check

# Testing
npm run test             # Run Jest tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npm run e2e              # Run Playwright tests
npm run e2e:ui           # Playwright UI mode

# AI Development
npm run genkit:dev       # Start Genkit dev server
npm run genkit:watch     # Watch mode for AI flows

# Validation
npm run validate         # Full validation
npm run validate:quick   # Quick check
```

## Troubleshooting

### Common Issues

1. **Build Errors**: Run `npm run typecheck` to see type errors
2. **Firestore Issues**: Check `firestore.rules` and ensure proper permissions
3. **Auth Issues**: Verify Firebase Auth configuration in console
4. **UI Issues**: Check Tailwind configuration and CSS imports

### Debug Mode

Add to `.env.local`:
```env
NEXT_PUBLIC_DEBUG=true
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/app/layout.tsx` | Root layout with Firebase provider |
| `src/firebase/provider.tsx` | Auth context and Firebase hooks |
| `src/components/layout/portal-layout.tsx` | Shared portal layout |
| `src/lib/constants.ts` | Predefined categories and cities |
| `src/app/(contractor)/contractor/rfqs/page.tsx` | RFQ management for contractors |
| `src/app/(supplier)/supplier/page.tsx` | Supplier dashboard |
| `src/app/(admin)/admin/page.tsx` | Admin dashboard |
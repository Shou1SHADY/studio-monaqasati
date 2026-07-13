# مدماك تيك — Documentation Index

Last updated: 2026-07-14 | Next.js 15.5.9 · Firebase 11 · TypeScript 5

---

## Quick Links

| Document | Contents |
|---|---|
| [../README.md](../README.md) | Project overview, quick start, commands, env vars |
| [frontend/ARCHITECTURE.md](frontend/ARCHITECTURE.md) | Routes, components, design system, i18n, RTL, animations |
| [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) | Firestore schema, security rules, AI flows, auth |
| [api/API.md](api/API.md) | API routes, Firebase hook patterns, error formats |
| [../CLAUDE.md](../CLAUDE.md) | AI assistant context — stack rules and conventions |
| [../firestore.rules](../firestore.rules) | Live Firestore security rules |

---

## Platform Overview

**مدماك تيك** (Mdmak Tech) is a B2B smart procurement platform connecting contractors with suppliers in Saudi Arabia. Arabic (RTL) is the default and primary locale.

### Roles

| Role | Core Actions |
|---|---|
| **Contractor** | Create projects → manage BOQ → post RFQs/Tenders → review offers → confirm deliveries → browse quick catalog |
| **Supplier** | Browse RFQs → submit price offers → manage orders → connect with contractors |
| **Admin** | Verify users, oversee RFQs, view platform stats |

### Feature Map

| Feature | Route | Key Files |
|---|---|---|
| Contractor dashboard | `/contractor` | `app/[locale]/(contractor)/contractor/page.tsx` |
| Project management + BOQ | `/contractor/projects/*` | `components/contractor/ProjectForm.tsx`, `BoqTable.tsx` |
| RFQ creation + offers | `/contractor/rfqs/*` | `components/contractor/RfqForm.tsx` |
| Quick materials catalog | `/contractor/catalog` | `components/contractor/ContractorCatalog.tsx`, `lib/catalog-utils.ts` |
| Supplier browsing | `/contractor/suppliers` | `components/contractor/` |
| Delivery receipts | `/contractor/goods-received` | `components/contractor/` |
| Portal AI assistant | All portals | `components/rag/`, `ai/flows/rag-ask-flow.ts`, `api/rag/ask/` |
| Supplier RFQ browse | `/supplier/rfqs` | `components/supplier/SupplierRfqCard.tsx` |
| Offer management | `/supplier/offers` | `components/supplier/` |
| Supplier connections | `/supplier/connections` | `components/supplier/` |
| Chat / messaging | `*/chats`, `*/chat/[chatId]` | `components/chat-page-content.tsx` |
| Landing page | `/` | `app/[locale]/page.tsx`, `content.tsx` |
| Landing chatbot | `/` | `ai/flows/landing-chat-flow.ts`, `api/landing-chat/` |

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `users` | All user profiles (Contractor, Supplier, Admin) |
| `users/{uid}/notifications` | Per-user in-app notifications |
| `users/{uid}/2fa` | OTP codes for 2FA |
| `rfqs` | Request for Quotation documents |
| `rfqs/{id}/inquiries` | Supplier questions on an RFQ |
| `offers` | Supplier price offers |
| `projects` | Contractor project records |
| `projects/{id}/boqItems` | Bill of Quantities line items |
| `projects/{id}/boqGroups` | BOQ sections/groups |
| `contractorCatalog` | Recurring materials catalog (auto-populated from RFQs) |
| `chats` | Chat threads between contractor and supplier |
| `chats/{id}/messages` | Chat messages |
| `messages` | Top-level messages (mobile app) |
| `deliveries` | Delivery receipts |
| `invitations` | Team + connection invites |
| `contractorSupplierLinks` | Bi-directional contractor↔supplier connections |
| `reviews` | Post-delivery reviews |
| `procurementMaterials` | Admin-managed material catalog |
| `categories` | Construction category reference data |
| `cities` | Saudi city reference data |
| `notification_queue` | System notification dispatch |

---

## AI Flows

| Flow | Endpoint | Purpose |
|---|---|---|
| `rag-ask-flow.ts` | `POST /api/rag/ask` | Portal AI assistant with user data context |
| `landing-chat-flow.ts` | `POST /api/landing-chat` | Public landing page chatbot |
| `draft-rfq-description-flow.ts` | Internal | Generates Arabic RFQ description from product list |

---

## Tech Stack at a Glance

```
Next.js 15.5.9  (App Router, Turbopack)
TypeScript 5    (strict mode, no any)
Tailwind CSS 3  (design tokens, RTL-first)
shadcn/ui       (Radix UI primitives — src/components/ui/ is managed, do not edit)
Framer Motion 12
next-intl 4     (ar default, en secondary — localePrefix: 'as-needed')
Firebase 11     (Firestore, Auth, Storage)
Genkit 1.x      (Google GenAI / Gemini)
react-hook-form + zod
Jest + Playwright
```

---

## Key Conventions (quick reference)

- Every string → `messages/ar.json` + `messages/en.json` → `useTranslations()`
- Navigation → `Link`, `useRouter` from `@/i18n/routing` (not `next/link`)
- Class merging → `cn()` from `@/lib/utils` (not `clsx`)
- Firestore rules → update `firestore.rules` + deploy before going live
- Firebase Admin SDK → server-only, never in client components
- New collection → add to `firestore.rules` + `firestore.indexes.json`
- Components → PascalCase, one per file, in matching `src/components/` subfolder

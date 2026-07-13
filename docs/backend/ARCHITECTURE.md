# Backend Architecture — مدماك تيك

## Overview

Serverless architecture built on Firebase (Firestore, Auth, Storage) with Genkit + Google GenAI for AI capabilities. All business logic runs either client-side via the Firebase SDK or in Next.js API routes (`src/app/api/`).

---

## Firebase Services

| Service | Purpose | Config files |
|---|---|---|
| **Firestore** | Primary database — all application data | `firestore.rules`, `firestore.indexes.json` |
| **Authentication** | Email/password + Google OAuth | Firebase Console |
| **Storage** | File uploads (blueprints, documents, attachments) | `storage.rules` |
| **Hosting** | Static Next.js output | `firebase.json` |

Firebase client is initialized in `src/firebase/` — use `FirebaseClientProvider` context to access in components.

---

## Firestore Collections

### `users/{uid}`

User profiles for all roles.

```typescript
interface UserProfile {
  id: string                    // Firebase UID
  role: 'Admin' | 'Contractor' | 'Supplier'
  name: string
  email: string
  phone?: string
  crNumber?: string             // Commercial Registration number
  vatNumber?: string
  companyName?: string
  city?: string
  organizationId: string        // org grouping for team accounts
  organizationRole?: 'owner' | 'member'
  isVerified: boolean
  profileCompleted: boolean
  specializations?: string[]    // Supplier only — from PREDEFINED_CATEGORIES
  serviceAreas?: string[]       // Supplier only — cities covered
  coverageCities?: string[]
  joinedAt: Timestamp
  updatedAt?: Timestamp
}
```

**Subcollections:**
- `users/{uid}/notifications/{notificationId}` — in-app notifications
- `users/{uid}/2fa/{docId}` — OTP codes (owner-only)

---

### `rfqs/{rfqId}`

Request for Quotation documents (standalone + project-linked tenders).

```typescript
interface RFQ {
  id: string
  title: string
  description?: string
  status: 'New' | 'Active' | 'Closed' | 'Cancelled'
  contractorId: string
  organizationId: string
  projectId?: string            // Set when RFQ is a project tender
  products: RFQProduct[]
  deadline?: string             // ISO date
  city?: string
  district?: string
  offersCount: number           // Incremented by suppliers on offer submit
  attachments?: string[]        // Storage URLs
  createdAt: Timestamp
  updatedAt?: Timestamp
}

interface RFQProduct {
  id: string
  description: string
  quantity: string
  unit: string
  category: string
  subCategory?: string
}
```

**Subcollection:** `rfqs/{rfqId}/inquiries/{inquiryId}` — questions from suppliers

---

### `offers/{offerId}`

Price offers submitted by suppliers on RFQs.

```typescript
interface Offer {
  id: string
  rfqId: string
  rfqTitle?: string
  supplierId: string
  supplierName?: string
  supplierOrgId?: string
  contractorId: string
  contractorOrgId: string
  organizationId: string        // contractor's org
  price: number                 // SAR
  currency: 'SAR'
  deliveryDays?: number
  notes?: string
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
  createdAt: Timestamp
  updatedAt?: Timestamp
}
```

---

### `projects/{projectId}`

Contractor project management — BOQ tracking, tender grouping.

```typescript
interface Project {
  id: string
  name: string
  description?: string
  status: 'planning' | 'active' | 'completed' | 'cancelled'
  organizationId: string
  contractorId: string
  region: string                // Saudi region
  projectType: string           // proj_type_* key
  clientType: string            // proj_client_* key
  budget?: number
  blueprintUrl?: string
  rfqIds: string[]              // linked RFQ/tender IDs
  createdAt: Timestamp
  updatedAt?: Timestamp
}
```

**Subcollections:**
- `projects/{projectId}/boqItems/{itemId}` — Bill of Quantities line items
- `projects/{projectId}/boqGroups/{groupId}` — BOQ sections/groups

```typescript
interface BOQItem {
  id: string
  groupId?: string
  description: string
  quantity: number
  unit: string
  unitPrice?: number
  category: string
  subCategory?: string
  isEditable: boolean           // false when pushed to a tender (hard-locked)
  tenderId?: string             // set when pushed to tender
  createdAt: Timestamp
  updatedAt?: Timestamp
}
```

---

### `contractorCatalog/{itemId}`

Recurring materials catalog — auto-populated from RFQ products. Used by the Quick Materials Catalog feature.

```typescript
interface CatalogItem {
  id: string
  contractorId: string
  organizationId: string
  name: string                  // product description
  category: string
  subCategory: string
  unit: string
  usageCount: number            // incremented on each RFQ that includes this item
  lastQuantity: number
  lastUsedAt: Timestamp | null
  createdAt: Timestamp | null
}
```

Upsert logic (`src/lib/catalog-utils.ts`):
- Match by `(category + subCategory + unit)` within the org
- If found: increment `usageCount`, update `lastQuantity` and `lastUsedAt`
- If not found: `addDoc` with `usageCount: 1`
- Runs fire-and-forget after RFQ publish — never blocks the user flow

---

### `chats/{chatId}`

Messaging threads between a contractor and supplier.

```typescript
interface Chat {
  id: string
  contractorId: string
  supplierId: string
  contractorOrgId: string
  supplierOrgId: string
  rfqId?: string
  lastMessage?: string
  lastMessageAt?: Timestamp
  createdAt: Timestamp
}
```

**Subcollection:** `chats/{chatId}/messages/{messageId}`

---

### `messages/{messageId}` (top-level)

Used by the mobile app for direct messaging (parallel to `chats/` subcollection).

---

### `deliveries/{deliveryId}`

Delivery receipts — created by supplier (notice) or contractor (manual log).

```typescript
interface Delivery {
  id: string
  contractorId: string
  contractorOrgId: string
  supplierId?: string           // absent for manually logged deliveries
  supplierOrgId?: string
  offerId?: string
  rfqId?: string
  status: 'pending_confirmation' | 'confirmed'
  confirmedByUserId?: string
  items: DeliveryItem[]
  notes?: string
  createdAt: Timestamp
  updatedAt?: Timestamp
}
```

---

### `invitations/{invitationId}`

Team invitations and supplier-contractor connection invites.

---

### `contractorSupplierLinks/{linkId}`

Bi-directional connection records between contractor org and supplier org.

```typescript
interface ContractorSupplierLink {
  contractorOrgId: string
  supplierOrgId: string
  requestedBy: 'supplier' | 'contractor'
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  createdAt: Timestamp
}
```

---

### `reviews/{reviewId}`

Post-delivery supplier reviews from contractors.

---

### `procurementMaterials/{materialId}`

Admin-managed catalog of standard procurement materials. Read-only for contractors.

---

### `categories/{categoryId}` / `cities/{cityId}`

Reference data — managed by admin, read by all signed-in users.

---

### `notification_queue/{queueEntryId}`

Admin/system notification dispatch queue.

---

## Firestore Security Rules

Rules file: `firestore.rules` — must be deployed after any change:

```bash
firebase deploy --only firestore:rules --project <project-id>
```

### Helper Functions

```
isSignedIn()         — request.auth != null
getUserData()        — reads /users/{uid} doc
getOrganizationId()  — getUserData().organizationId
hasRole(role)        — getUserData().role == role
isAdmin()            — hasRole('Admin')
isContractor()       — hasRole('Contractor')
isSupplier()         — hasRole('Supplier')
isOwner(userId)      — request.auth.uid == userId
isOrgMember(orgId)   — getOrganizationId() == orgId
```

### Access Pattern Summary

| Collection | Read | Write |
|---|---|---|
| `users` | signed-in (list), owner/org/admin (get) | owner on create, owner/admin/org-owner on update |
| `rfqs` | signed-in (all — app `where` clause filters) | org member on create/update; org or creator on delete |
| `offers` | signed-in (list); supplier/contractor/org on get | supplier or org member on create; supplier/contractor/org on update |
| `projects` | signed-in (list); org/admin on get | contractor-org on create/update/delete |
| `boqItems` | org member (via project lookup) | org member; locked items only allow unlock transition |
| `contractorCatalog` | signed-in (all) | contractor (org-scoped) on create; org member on update; org/admin on delete |
| `chats` | signed-in (list); parties on get/update | signed-in on create |
| `deliveries` | signed-in (list); parties on get | supplier (notice) or contractor (manual) on create; parties on update |
| `procurementMaterials` | signed-in | admin only |
| `categories` / `cities` | signed-in | admin only |

**Pattern used for `list` operations:** `allow read: if isSignedIn()` + client-side `where` clause for data isolation (same as `rfqs`, `offers`, `chats`). Firestore `resource` is `null` in list context so per-document field checks cannot be applied.

---

## Composite Indexes (`firestore.indexes.json`)

Key indexes required:
- `rfqs`: `organizationId ASC + createdAt DESC`
- `rfqs`: `status ASC + deadline ASC`
- `offers`: `rfqId ASC + createdAt DESC`
- `offers`: `supplierId ASC + createdAt DESC`
- `offers`: `organizationId ASC + status ASC`
- `contractorCatalog`: `organizationId ASC + usageCount DESC`
- `projects`: `organizationId ASC + createdAt DESC`
- `deliveries`: `contractorOrgId ASC + createdAt DESC`

Deploy indexes: `firebase deploy --only firestore:indexes --project <project-id>`

---

## AI Flows (`src/ai/flows/`)

### Architecture

```
src/ai/
  genkit.ts          — Genkit instance (googleAI plugin, Gemini model)
  generate.ts        — aiGenerate() wrapper with structured output
  flows/
    rag-ask-flow.ts           — Portal AI assistant (RAG)
    landing-chat-flow.ts      — Landing page chatbot
    draft-rfq-description-flow.ts — AI-generated RFQ descriptions
```

### `rag-ask-flow.ts` — Portal AI Assistant

**Endpoint:** `POST /api/rag/ask`

**Input:**
```typescript
{
  question: string
  locale: 'ar' | 'en'
  userRole: 'Contractor' | 'Supplier' | 'Admin'
  context: {
    profile?: Record<string, any>
    rfqs?: Record<string, any>[]
    offers?: Record<string, any>[]
    suppliers?: Record<string, any>[]
    projects?: Record<string, any>[]
    catalogItems?: Record<string, any>[]
  }
}
```

**Output:**
```typescript
{
  answer: string          // AI response in locale language
  pendingAction: {        // null for info-only questions
    type: 'submitOffer' | 'createInquiry' | 'favoriteSupplier' | 'createRFQ'
         | 'createProject' | 'viewProject' | 'viewBoq' | 'openCatalog'
    params: {
      rfqId?, rfqTitle?, price?, notes?, question?,
      supplierId?, supplierName?, title?, category?,
      description?, projectId?, projectName?,
      region?, projectType?, clientType?,
      catalogIds?,        // for openCatalog
    }
    label: string         // short button label in user's language
    description: string   // one sentence describing what will happen
  } | null
  navLinks: {             // direct deep links to mentioned items
    label: string
    path: string          // e.g. /contractor/rfqs/abc123
  }[] | null
}
```

**Known action triggers (Arabic):**
- Price mention / "قدّم عرض" → `submitOffer`
- "اسأل" / "استفسر" → `createInquiry`
- "أضف للمفضلة" → `favoriteSupplier`
- "أنشئ طلب عروض" → `createRFQ`
- "أنشئ مشروع" → `createProject`
- "اعرض مشروع" → `viewProject`
- "جدول الكميات" / "BOQ" → `viewBoq`
- "سوق المواد" / "المواد المتكررة" / "فتح الكتالوج" → `openCatalog`

### `landing-chat-flow.ts` — Landing Chatbot

Stateless chatbot for the public landing page. Knows platform features, pricing, and how to direct users to sign up. Does not access user data.

### `draft-rfq-description-flow.ts` — RFQ Description Generator

Given a product list, generates a professional Arabic RFQ description. Called from `RfqForm.tsx` via the "Generate Description" button.

---

## Next.js API Routes (`src/app/api/`)

| Route | Method | Purpose |
|---|---|---|
| `/api/rag/ask` | POST | Portal AI assistant — calls `ragAsk()` |
| `/api/landing-chat` | POST | Landing page chatbot — calls Genkit flow |
| `/api/login-hint` | GET | Returns auth login hint for email pre-fill |
| `/api/sms` | POST | SMS OTP dispatch (via external provider) |

All routes:
- Validate input with zod at the top
- Return `{ success: true, data: {...} }` on success
- Return `{ error: true, message: '...', code: '...' }` on failure
- Use `NextResponse.json()` with explicit HTTP status codes
- Never expose Firebase Admin credentials or stack traces

---

## Authentication Flow

1. **Register**: `createUserWithEmailAndPassword` → create `users/{uid}` doc with role
2. **Login**: `signInWithEmailAndPassword` or Google OAuth
3. **Session**: Firebase Auth handles tokens; `useUser()` hook provides current user client-side
4. **Server-side**: `getServerSession()` in API routes / Server Components
5. **Role check**: read `users/{uid}.role` from Firestore

---

## Organization / Team Model

- Every user has an `organizationId` field
- Solo users: `organizationId === uid`
- Team accounts: all members share the same `organizationId`; one member has `organizationRole: 'owner'`
- All Firestore queries filter by `organizationId` for data isolation
- Security rules use `getOrganizationId()` helper to enforce this at the database level

---

## Constants (`src/lib/constants.ts`)

| Export | Contents |
|---|---|
| `PREDEFINED_CATEGORIES` | Array of `{ id, name_ar, name_en, subcategories[] }` — 10 construction material categories |
| `SAUDI_CITIES` | Array of Saudi city names |
| `UNITS` | Array of measurement units (طن، متر مكعب، لتر، etc.) |
| `PROJECT_TYPES` | `proj_type_*` keys with AR/EN labels |
| `CLIENT_TYPES` | `proj_client_*` keys with AR/EN labels |
| `displayCategory(category, locale)` | Returns localized category name |

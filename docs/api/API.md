# API Reference — مدماك تيك

## Overview

Most data operations are client-side via the Firebase SDK through custom hooks. Server-side logic lives in Next.js API routes (`src/app/api/`) and Genkit AI flows. There is no traditional REST backend.

---

## Next.js API Routes

### `POST /api/rag/ask`

Portal AI assistant — answers questions using the user's live Firestore data as context.

**Request body:**
```json
{
  "question": "كم عدد طلبات العروض المفتوحة؟",
  "locale": "ar",
  "userRole": "Contractor",
  "context": {
    "profile": { "name": "...", "organizationId": "..." },
    "rfqs": [ { "id": "...", "title": "...", "status": "New" } ],
    "offers": [],
    "suppliers": [],
    "projects": [],
    "catalogItems": []
  }
}
```

**Response:**
```json
{
  "answer": "لديك 3 طلبات عروض مفتوحة...",
  "pendingAction": {
    "type": "createRFQ",
    "params": { "title": "حديد مسلح", "category": "حديد ومعادن" },
    "label": "إنشاء طلب عروض",
    "description": "سيتم فتح نموذج إنشاء طلب عروض جديد"
  },
  "navLinks": [
    { "label": "كل طلبات العروض", "path": "/contractor/rfqs" }
  ]
}
```

`pendingAction` is `null` for informational questions. `navLinks` is `null` when no specific items are referenced.

**pendingAction types:**

| type | Required params | Effect in UI |
|---|---|---|
| `submitOffer` | `rfqId` | Opens offer form pre-filled |
| `createInquiry` | `rfqId` | Opens inquiry dialog |
| `favoriteSupplier` | `supplierId` | Adds supplier to favorites |
| `createRFQ` | — | Navigates to `/contractor/rfqs/new` |
| `createProject` | — | Navigates to `/contractor/projects/new` |
| `viewProject` | `projectId` | Navigates to `/contractor/projects/{id}` |
| `viewBoq` | `projectId` | Navigates to project BOQ tab |
| `openCatalog` | `catalogIds?` | Navigates to `/contractor/catalog` (pre-selects items if catalogIds provided) |

---

### `POST /api/landing-chat`

Landing page chatbot for unauthenticated visitors.

**Request:**
```json
{ "message": "What is Mdmak Tech?", "locale": "en" }
```

**Response:**
```json
{ "reply": "Mdmak Tech is a B2B procurement platform..." }
```

---

### `GET /api/login-hint`

Returns the last used email for auth form pre-fill.

**Response:**
```json
{ "hint": "user@example.com" }
```

---

### `POST /api/sms`

Dispatches an SMS OTP via external provider.

**Request:**
```json
{ "phone": "+966501234567", "code": "123456" }
```

**Response:**
```json
{ "success": true }
```

---

## Firebase SDK Patterns

### Hooks (from `@/firebase`)

```tsx
import { useFirestore, useUser, useDoc, useCollection, useMemoFirebase } from '@/firebase'

const firestore = useFirestore()
const { user, isUserLoading } = useUser()
```

### Read a Single Document

```tsx
const userRef = useMemoFirebase(() => {
  if (!firestore || !user) return null
  return doc(firestore, 'users', user.uid)
}, [firestore, user])

const { data: profile, isLoading } = useDoc(userRef)
```

### Real-Time Collection Query

```tsx
const rfqsQuery = useMemoFirebase(() => {
  if (!firestore || !orgId) return null
  return query(
    collection(firestore, 'rfqs'),
    where('organizationId', '==', orgId),
    orderBy('createdAt', 'desc'),
    limit(50)
  )
}, [firestore, orgId])

const { data: rfqs, isLoading } = useCollection(rfqsQuery)
```

### Create a Document

```tsx
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'

const rfqRef = await addDoc(collection(firestore, 'rfqs'), {
  title,
  organizationId: orgId,
  contractorId: user.uid,
  status: 'New',
  products,
  createdAt: serverTimestamp(),
  offersCount: 0,
})
```

### Update a Document

```tsx
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore'

await updateDoc(doc(firestore, 'rfqs', rfqId), {
  status: 'Closed',
  updatedAt: serverTimestamp(),
})
```

### Atomic Increment

```tsx
import { increment } from 'firebase/firestore'

await updateDoc(doc(firestore, 'rfqs', rfqId), {
  offersCount: increment(1),
})
```

---

## Catalog Upsert API (`src/lib/catalog-utils.ts`)

Used internally by `RfqForm` after RFQ publish. Not exposed as an HTTP endpoint.

```typescript
import { upsertCatalogItems } from '@/lib/catalog-utils'

// Called fire-and-forget — never awaited on the critical path
upsertCatalogItems(firestore, user.uid, organizationId, products).catch(console.error)
```

**Logic:**
1. Fetch all existing `contractorCatalog` docs for the org
2. For each product in the new RFQ:
   - Find matching doc by `(category + subCategory + unit)`
   - If found → `updateDoc` with `increment(1)` on `usageCount`, update `lastQuantity` and `lastUsedAt`
   - If not found → `addDoc` with `usageCount: 1`

---

## Error Response Format

All API routes return consistent error shapes:

```json
{ "error": true, "message": "Human-readable message", "code": "ERROR_CODE" }
```

Common codes: `INVALID_INPUT`, `UNAUTHORIZED`, `NOT_FOUND`, `AI_ERROR`, `FIREBASE_ERROR`

## Success Response Format

```json
{ "success": true, "data": { ... } }
```

---

## Input Validation

All API routes validate input with zod at the top of the handler:

```typescript
import { z } from 'zod'
import { NextResponse } from 'next/server'

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  locale: z.enum(['ar', 'en']),
  userRole: z.enum(['Contractor', 'Supplier', 'Admin']),
})

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: true, message: 'Invalid input', code: 'INVALID_INPUT' },
      { status: 400 }
    )
  }
  // ...
}
```

---

## Firestore Security — Key Rules

All Firestore access is controlled by `firestore.rules`. The security model:

- **List queries**: `allow read: if isSignedIn()` — data isolation is enforced by client-side `where` clauses (same pattern as `rfqs`, `offers`, `chats`, `contractorCatalog`)
- **Get (single doc)**: field-level checks using `resource.data` to verify ownership/org membership
- **Create**: verify `request.resource.data.organizationId == getOrganizationId()`
- **Update**: verify caller is org member or document owner
- **Delete**: typically org member or admin

After any change to `firestore.rules`:
```bash
firebase deploy --only firestore:rules --project <project-id>
```

# Backend Architecture - مدماك تيك

## Overview

The backend is built on **Firebase** (Firestore, Authentication, Cloud Functions, Hosting) with **Genkit** for AI capabilities. This is a serverless architecture where most backend logic is handled by Firebase services.

## Firebase Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Firestore** | NoSQL database for all application data | `firestore.rules`, `firestore.indexes.json` |
| **Authentication** | User auth with email/password | Firebase Console |
| **Hosting** | Static hosting for Next.js app | `firebase.json` |
| **Cloud Functions** | Server-side logic & AI processing (future) | `functions/` directory |

## Data Model

### Entities

#### UserProfile
```typescript
interface UserProfile {
  id: string;                    // Firebase UID
  role: 'Admin' | 'Contractor' | 'Supplier';
  name: string;
  email: string;
  phone: string;
  crNumber?: string;             // Commercial Registration (optional)
  city?: string;
  specializations?: string[];     // Suppliers only (from PREDEFINED_CATEGORIES)
  isVerified: boolean;            // Default: false
  profileCompleted: boolean;      // Default: false
  coverageCities?: string[];     // Suppliers - service areas
  joinedAt: string;               // ISO date string
}
```

#### RFQ (RequestForQuotation)
```typescript
interface RFQ {
  id: string;
  contractorId: string;
  title: string;
  category: string;                // From PREDEFINED_CATEGORIES
  subCategory?: string;
  quantity?: number;
  unitOfMeasure?: string;
  deadline: string;               // ISO date string
  city: string;
  district?: string;
  paymentTerms?: string;
  isQualityCertificateRequired?: boolean;
  notes?: string;
  products?: Product[];          // Array of products for detailed RFQs
  status: 'Draft' | 'New' | 'Awarded' | 'cancelled';
  createdAt: string;              // ISO date string
  publishedAt?: string;          // ISO date string when status changed to New
}

interface Product {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  description?: string;
}
```

#### Offer
```typescript
interface Offer {
  id: string;
  rfqId: string;
  supplierId: string;
  rfqTitle: string;
  price: string;
  deliveryLocation: string;
  deliveryMethod: string;
  deliveryFrequency?: string;
  deliveryBatches: DeliveryBatch[];
  totalBatchesPrice: number;
  status: 'قيد المراجعة' | 'مقبول' | 'مرفوض' | 'New' | 'Accepted' | 'Rejected';
  createdAt: string;
}

interface DeliveryBatch {
  id: string;
  quantity: string;
  deliveryDate: string;
  price: string;
}
```

#### InAppNotification
```typescript
interface InAppNotification {
  id: string;
  userId: string;
  message: string;
  type: 'new_rfq' | 'offer_submitted' | 'offer_accepted' | 'offer_rejected' | 'system';
  isRead: boolean;
  sentAt: string;
}
```

## Firestore Structure

```
/users/{userId}
  - User profile data
  - Role-based access control
  - Specializations for suppliers

/rfqs/{rfqId}
  - RFQ documents
  - contractorId for authorization
  - status: Draft, New, Awarded

/offers/{offerId}
  - Offer documents
  - rfqId and supplierId for queries
  - Delivery batches

/users/{userId}/notifications/{notificationId}
  - User-specific notifications (subcollection)

/cities/{cityId} (optional)
  - Predefined cities for dropdowns
```

## Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
    
    match /rfqs/{rfqId} {
      allow read: if request.auth != null;
      allow create: if request.auth.uid == request.resource.data.contractorId;
      allow update, delete: if request.auth.uid == resource.data.contractorId;
    }
    
    match /offers/{offerId} {
      allow read: if request.auth != null;
      allow create: if request.auth.uid == request.resource.data.supplierId;
      allow update: if request.auth.uid in [resource.data.supplierId, resource.data.contractorId];
    }
    
    match /users/{userId}/notifications/{notificationId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

## Authentication Flow

1. User visits `/login` or `/register`
2. Firebase Auth handles email/password authentication
3. On successful auth, user document is fetched from Firestore
4. Role-based routing occurs:
   - `Admin` → `/admin`
   - `Contractor` → `/contractor`
   - `Supplier` → `/supplier`
5. Auth state is maintained via `onAuthStateChanged` listener

## API Reference

All API operations are performed client-side using Firebase SDK:

### Authentication
```typescript
// Register
createUserWithEmailAndPassword(auth, email, password)
updateProfile(user, { displayName: name })
setDoc(doc(firestore, "users", user.uid), userData)

// Login
signInWithEmailAndPassword(auth, email, password)
getDoc(doc(firestore, "users", user.uid))
```

### RFQ Operations
```typescript
// Create RFQ
addDoc(collection(firestore, "rfqs"), rfqData)

// List RFQs
const q = query(
  collection(firestore, "rfqs"),
  where("contractorId", "==", user.uid),
  orderBy("createdAt", "desc")
)

// Update RFQ status
updateDoc(doc(firestore, "rfqs", rfqId), { status: "New" })
```

### Offer Operations
```typescript
// Submit Offer
addDoc(collection(firestore, "offers"), offerData)

// List Offers (Supplier)
query(
  collection(firestore, "offers"),
  where("supplierId", "==", user.uid)
)

// List Offers (RFQ - Contractor)
query(
  collection(firestore, "offers"),
  where("rfqId", "==", rfqId)
)
```

## Indexes

Required composite indexes in Firestore (defined in `firestore.indexes.json`):

```json
[
  {
    "collectionGroup": "offers",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "supplierId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "rfqs",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "contractorId", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "rfqs",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "category", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  }
]
```

## AI Flows (Genkit)

### Available Flows

| Flow | Purpose | Input | Output |
|------|---------|-------|--------|
| `recommendRFQForSupplier` | Match RFQs to supplier's specializations | supplierId | RFQ[] |
| `recommendSuppliersForRFQ` | Match suppliers to RFQ's category | rfqId | Supplier[] |
| `suggestSupplierSpecializations` | AI categorize supplier based on profile | supplierId | Category[] |
| `draftRFQDescription` | AI-assisted RFQ description generation | rawText | description |

### Running AI Flows

```bash
# Start Genkit dev server
npm run genkit:dev

# Watch mode for development
npm run genkit:watch
```

## Deployment

### Firebase Deployment
```bash
# Deploy hosting
firebase deploy --only hosting

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy indexes
firebase deploy --only firestore:indexes

# Full deploy
firebase deploy
```

### Environment Variables

Required in `.env.local`:
```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_GEMINI_API_KEY=
```

## Best Practices

1. **Data Denormalization**: Store `contractorId` in RFQ documents for direct access checks
2. **Real-time Listeners**: Use Firestore `onSnapshot` for live data updates
3. **Optimistic Updates**: Update UI immediately, then sync with server
4. **Error Handling**: Wrap all Firestore operations in try-catch blocks
5. **Loading States**: Always show loading indicators while fetching data

## Troubleshooting

### Common Issues

1. **Permission Denied**: Check Firestore rules and ensure user is authenticated
2. **Slow Queries**: Review index usage in Firebase Console
3. **Auth State Issues**: Verify Firebase Auth configuration
4. **Build Errors**: Run `npm run typecheck` to identify type errors

### Debug Mode

Add to `.env.local`:
```env
NEXT_PUBLIC_DEBUG=true
```

Check browser console for Firebase logs.
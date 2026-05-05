# Backend Architecture - مدماك تيك

## Overview

The backend is built on **Firebase** (Firestore, Authentication, Cloud Functions, Hosting) with **Genkit** for AI capabilities.

## Firebase Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **Firestore** | NoSQL database for all application data | `firestore.rules`, `firestore.indexes.json` |
| **Authentication** | User auth with email/password & phone | Firebase Console |
| **Hosting** | Static hosting for Next.js app | `firebase.json` |
| **Cloud Functions** | Server-side logic & AI processing | `functions/` directory |

## Data Model

### Entities

#### UserProfile
```typescript
interface UserProfile {
  id: string;                    // Firebase UID
  role: 'admin' | 'contractor' | 'supplier';
  name: string;
  phoneNumber: string;
  email: string;
  city: string;
  commercialRegistrationNumber?: string;  // Suppliers only
  isVerified?: boolean;                   // Suppliers only
  commitmentScore?: number;               // Contractors only
  specializationCategoryIds?: string[];   // Suppliers only
  serviceAreas?: string[];                 // Suppliers only
  joinedAt: Date;
}
```

#### Category
```typescript
interface Category {
  id: string;
  name: string;        // e.g., 'حديد ومعادن'
  description?: string;
}
```

#### RequestForQuotation (RFQ)
```typescript
interface RequestForQuotation {
  id: string;
  contractorId: string;
  title: string;
  categoryId: string;
  quantity: number;
  unitOfMeasure: string;    // 'طن', 'متر', 'قطعة'
  deadline: Date;
  location: string;         // e.g., 'Riyadh'
  area: string;
  paymentTerms: 'cash' | 'net-30' | 'net-60' | 'LC';
  isQualityCertificateRequired: boolean;
  notes?: string;
  status: 'new' | 'awarded' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: Date;
}
```

#### Offer
```typescript
interface Offer {
  id: string;
  requestForQuotationId: string;
  contractorId: string;      // Denormalized from RFQ
  supplierId: string;
  pricePerUnit: number;
  estimatedDeliveryDays: number;
  supplierNotes?: string;
  canProvideQualityCertificate: boolean;
  status: 'pending' | 'accepted' | 'rejected';
  submittedAt: Date;
}
```

#### InAppNotification
```typescript
interface InAppNotification {
  id: string;
  userId: string;
  message: string;
  isRead: boolean;
  type: 'new_rfq' | 'offer_submitted' | 'offer_accepted' | 'offer_rejected' | 'system';
  sentAt: Date;
}
```

## Firestore Structure

```
/users/{userId}
  - User profile data
  - Role-based access

/categories/{categoryId}
  - Predefined categories (public read)

/rfqs/{rfqId}
  - RFQ documents
  - Authorization via contractorId

/offers/{offerId}
  - Offer documents
  - Denormalized contractorId for authorization

/users/{userId}/notifications/{notificationId}
  - User-specific notifications

/notification_queue/{queueEntryId}
  - External notification queue (SMS/Email)

/ai-cache/{cacheId}
  - AI recommendation cache (read-only client)
```

## Security Rules

### Authorization Principles

1. **Authorization Independence**: Denormalize user IDs for direct access checks
2. **Role-Based Access**: Use custom claims for role verification
3. **Ownership Verification**: Always verify resource ownership

### Key Rules

```firestore
// Users - own profile only
match /users/{userId} {
  allow read, write: if request.auth.uid == userId;
}

// RFQs - owner + matching suppliers
match /rfqs/{rfqId} {
  allow create: if request.auth.uid == request.resource.data.contractorId;
  allow read, update, delete: if request.auth.uid == resource.data.contractorId;
  allow read: if request.auth.token.role == 'supplier' && request.auth.token.verified;
}

// Offers - participants only
match /offers/{offerId} {
  allow create: if request.auth.uid == request.resource.data.supplierId;
  allow read: if request.auth.uid in [resource.data.supplierId, resource.data.contractorId];
}
```

## Cloud Functions

### Triggers

1. **onCreate User**: Initialize user profile
2. **onCreate RFQ**: Notify matching suppliers
3. **onCreate Offer**: Notify contractor
4. **onUpdate Offer**: Update RFQ status

### AI Flows (Genkit)

| Flow | Purpose | Input | Output |
|------|---------|-------|--------|
| `recommendRFQForSupplier` | Match RFQs to supplier | supplierId | RFQ[] |
| `recommendSuppliersForRFQ` | Match suppliers to RFQ | rfqId | Supplier[] |
| `suggestSupplierSpecializations` | AI categorization | supplierId | Category[] |
| `draftRFQDescription` | AI-assisted RFQ creation | rawText | description |

## API Reference

### REST Endpoints (via Cloud Functions)

```
POST /createUserProfile
  Input: { uid, role, name, phoneNumber, email, city }
  Output: { success, profileId }

POST /createRFQ
  Input: { contractorId, title, categoryId, quantity, ... }
  Output: { success, rfqId }

POST /submitOffer
  Input: { rfqId, supplierId, pricePerUnit, ... }
  Output: { success, offerId }

POST /acceptOffer
  Input: { offerId }
  Output: { success }

POST /rejectOffer
  Input: { offerId }
  Output: { success }
```

### Real-time Subscriptions

```
/users/{userId}          - Profile changes
/rfqs                    - New RFQs (filtered by role)
/rfqs/{rfqId}/offers    - Offer updates
/users/{userId}/notifications - Notification changes
```

## Indexes

Custom indexes in `firestore.indexes.json`:

```json
{
  "collectionGroup": "offers",
  "queryScope": "collection",
  "fields": [
    { "fieldPath": "contractorId", "order": "ascending" },
    { "fieldPath": "status", "order": "ascending" }
  ]
}
```

## Firestore Emulator

For local development:
```bash
firebase emulators:start
```

Set environment:
```bash
export FIRESTORE_EMULATOR_HOST="localhost:8080"
```

## Best Practices

### Data Modeling
1. Denormalize for authorization independence
2. Use subcollections for user-specific data
3. Index frequently queried fields

### Security
1. Never trust client-side role checks
2. Validate all inputs in security rules
3. Use custom claims for role verification

### Performance
1. Limit document size to 1MB
2. Use batch writes for bulk operations
3. Implement pagination for large collections

### Backup & Recovery
1. Configure automated daily backups
2. Test restore procedures quarterly

## Deployment

### Firestore Deployment
```bash
firebase deploy --only firestore
```

### Functions Deployment
```bash
firebase deploy --only functions
```

### Full Deployment
```bash
firebase deploy
```

## Monitoring

### Console Monitoring
- Firebase Console → Firestore → Usage
- Firebase Console → Functions → Logs

### Alerts
- Configure error rate alerts
- Monitor cold starts
- Track quota usage

## Troubleshooting

### Common Issues

1. **Permission Denied**: Check security rules and auth state
2. **Slow Queries**: Review index usage in console
3. **Quota Exceeded**: Optimize queries and batch operations
4. **Function Timeout**: Increase timeout or optimize logic

### Debug Mode
```bash
firebase functions:log
firebase emulators:exec "npm test"
```
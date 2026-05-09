# API Reference - مدماك تيك

## Overview

This application uses **Firebase Firestore** for all data operations. All operations are performed client-side using the Firebase SDK through custom hooks (`useCollection`, `useDoc`, etc.).

## Firebase SDK Usage

All API operations are performed using Firebase SDK methods:

```typescript
import { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where, orderBy } from 'firebase/firestore'
import { useFirebase } from '@/firebase'
```

## Authentication API

### Register New User

```typescript
// Registration flow in /register page
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'

const handleRegister = async (formData: RegisterFormData) => {
  const { auth, firestore } = useFirebase()
  
  // 1. Create Firebase Auth user
  const userCredential = await createUserWithEmailAndPassword(
    auth, 
    formData.email, 
    formData.password
  )
  
  // 2. Update display name
  await updateProfile(userCredential.user, { 
    displayName: formData.name 
  })
  
  // 3. Create user document in Firestore
  await setDoc(doc(firestore, "users", userCredential.user.uid), {
    id: userCredential.user.uid,
    name: formData.name,
    email: formData.email,
    phone: formData.phone,
    crNumber: formData.crNumber,
    city: formData.city,
    role: formData.role, // "Contractor" or "Supplier"
    specializations: formData.role === "Supplier" ? formData.specializations : [],
    isVerified: false,
    profileCompleted: false,
    joinedAt: new Date().toISOString()
  })
}
```

### Login

```typescript
// Login flow in /login page
import { signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'

const handleLogin = async (email: string, password: string) => {
  const { auth, firestore } = useFirebase()
  
  // 1. Sign in with Firebase Auth
  const userCredential = await signInWithEmailAndPassword(auth, email, password)
  
  // 2. Fetch user document from Firestore
  const userDoc = await getDoc(doc(firestore, "users", userCredential.user.uid))
  
  if (!userDoc.exists()) {
    throw new Error("بيانات المستخدم غير موجودة في النظام")
  }
  
  const userData = userDoc.data()
  const role = userData.role
  
  // 3. Route based on role
  if (role === "Admin") router.push("/admin")
  else if (role === "Contractor") router.push("/contractor")
  else if (role === "Supplier") router.push("/supplier")
  
  return { user, role, profile: userData }
}
```

### Get Current User

```typescript
// Using useFirebase hook
const { user, isUserLoading } = useFirebase()

// User object contains Firebase User with uid, email, etc.
```

---

## User Profile API

### Get User Profile

```typescript
import { useDoc } from '@/firebase'
import { doc } from 'firebase/firestore'

const userDocRef = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  return doc(firestore, "users", user.uid)
}, [firestore, user, isUserLoading])

const { data: userData } = useDoc(userDocRef)
```

### Get All Users (Admin)

```typescript
import { useCollection } from '@/firebase'
import { collection, query } from 'firebase/firestore'

const usersQuery = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  return query(collection(firestore, "users"))
}, [firestore, user, isUserLoading])

const { data: users } = useCollection(usersQuery)
```

### Update User Profile

```typescript
import { doc, updateDoc } from 'firebase/firestore'

const updateProfile = async (userId: string, updates: Partial<UserProfile>) => {
  await updateDoc(doc(firestore, "users", userId), updates)
}
```

---

## RFQ API

### Create RFQ (Contractor)

```typescript
import { collection, addDoc } from 'firebase/firestore'

const createRFQ = async (rfqData: RFQData) => {
  const { user, firestore } = useFirebase()
  
  await addDoc(collection(firestore, "rfqs"), {
    contractorId: user.uid,
    title: rfqData.title,
    category: rfqData.category,
    subCategory: rfqData.subCategory,
    quantity: rfqData.quantity,
    unitOfMeasure: rfqData.unitOfMeasure,
    deadline: rfqData.deadline,
    city: rfqData.city,
    district: rfqData.district,
    paymentTerms: rfqData.paymentTerms,
    isQualityCertificateRequired: rfqData.isQualityCertificateRequired,
    notes: rfqData.notes,
    products: rfqData.products,
    status: rfqData.status || "Draft",
    createdAt: new Date().toISOString()
  })
}
```

### List RFQs (Contractor - Own)

```typescript
import { query, where, orderBy } from 'firebase/firestore'

const rfqsQuery = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  
  return query(
    collection(firestore, "rfqs"),
    where("contractorId", "==", user.uid),
    orderBy("createdAt", "desc")
  )
}, [firestore, user, isUserLoading])

const { data: rfqs } = useCollection(rfqsQuery)
```

### List RFQs (Supplier - Active)

```typescript
const supplierRfqsQuery = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  
  // Filter by supplier's specializations
  const specializations = userData?.specializations || []
  if (specializations.length > 0) {
    return query(
      collection(firestore, "rfqs"),
      where("status", "==", "New"),
      where("category", "in", specializations.slice(0, 30))
    )
  }
  
  return query(
    collection(firestore, "rfqs"),
    where("status", "==", "New")
  )
}, [firestore, user, isUserLoading, userData])

const { data: rfqs } = useCollection(supplierRfqsQuery)
```

### Update RFQ Status (Publish)

```typescript
import { doc, updateDoc } from 'firebase/firestore'

const publishRFQ = async (rfqId: string) => {
  await updateDoc(doc(firestore, "rfqs", rfqId), {
    status: "New",
    publishedAt: new Date().toISOString()
  })
}
```

### Get RFQ Offers (Contractor)

```typescript
const offersQuery = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  return query(
    collection(firestore, "offers"),
    where("rfqId", "==", rfqId),
    orderBy("createdAt", "desc")
  )
}, [firestore, user, isUserLoading, rfqId])

const { data: offers } = useCollection(offersQuery)
```

---

## Offer API

### Submit Offer (Supplier)

```typescript
import { collection, addDoc } from 'firebase/firestore'

const submitOffer = async (offerData: OfferData) => {
  const { user, firestore } = useFirebase()
  
  await addDoc(collection(firestore, "offers"), {
    supplierId: user.uid,
    rfqId: offerData.rfqId,
    rfqTitle: offerData.rfqTitle,
    price: offerData.price,
    deliveryLocation: offerData.deliveryLocation,
    deliveryMethod: offerData.deliveryMethod,
    deliveryFrequency: offerData.deliveryFrequency,
    deliveryBatches: offerData.deliveryBatches,
    totalBatchesPrice: offerData.totalBatchesPrice,
    status: "قيد المراجعة", // or "New"
    createdAt: new Date().toISOString()
  })
}
```

### List Supplier Offers

```typescript
const offersQuery = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  return query(
    collection(firestore, "offers"),
    where("supplierId", "==", user.uid)
  )
}, [firestore, user, isUserLoading])

const { data: offers } = useCollection(offersQuery)
```

### Accept/Reject Offer (Contractor)

```typescript
import { doc, updateDoc } from 'firebase/firestore'

const acceptOffer = async (offerId: string) => {
  await updateDoc(doc(firestore, "offers", offerId), {
    status: "مقبول" // or "Accepted"
  })
  
  // Optionally update RFQ status
  await updateDoc(doc(firestore, "rfqs", rfqId), {
    status: "Awarded"
  })
}

const rejectOffer = async (offerId: string) => {
  await updateDoc(doc(firestore, "offers", offerId), {
    status: "مرفوض" // or "Rejected"
  })
}
```

---

## Notification API

### Get User Notifications

```typescript
import { collection, query, orderBy, limit } from 'firebase/firestore'

const notificationsQuery = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  return query(
    collection(firestore, "users", user.uid, "notifications"),
    orderBy("sentAt", "desc"),
    limit(50)
  )
}, [firestore, user, isUserLoading])

const { data: notifications } = useCollection(notificationsQuery)
```

### Mark Notification as Read

```typescript
import { doc, updateDoc } from 'firebase/firestore'

const markAsRead = async (notificationId: string) => {
  await updateDoc(
    doc(firestore, "users", user.uid, "notifications", notificationId),
    { isRead: true }
  )
}
```

---

## Category API

### Get Categories

Categories are predefined in `src/lib/constants.ts`:

```typescript
import { PREDEFINED_CATEGORIES } from '@/lib/constants'

// Available categories:
export const PREDEFINED_CATEGORIES = [
  "حديد ومعادن",
  "أسمنت وخرسانة",
  "طوب وبلوك",
  "خشب وبنの約",
  "دهانات وتشطيبات",
  "كهرباء وإضاءة",
  "صحية وسباكة",
  "تكييف وتهوية",
  "أدوات يدوية",
  "معدات ثقيلة",
  "نجارةحدادة",
  "زجاج وإضاءة",
  "توريدات عامة",
  "أمن وحماية",
  "تشطيبات داخلية",
  "مواد عزل",
  "Landscaping"
]
```

---

## Chat API

### Get User Chats

```typescript
import { collection, query, where } from 'firebase/firestore'

const chatsQuery = useMemoFirebase(() => {
  if (isUserLoading || !user || !firestore) return null
  return query(
    collection(firestore, "chats"),
    where("participants", "array-contains", user.uid)
  )
}, [firestore, user, isUserLoading])
```

---

## Error Handling

All Firestore operations should be wrapped in try-catch blocks:

```typescript
try {
  await addDoc(collection(firestore, "collection"), data)
  toast({ title: "تم بنجاح", description: "تم إنشاء العنصر" })
} catch (error: any) {
  console.error("Error:", error)
  toast({ 
    title: "خطأ", 
    description: error.message || "حدث خطأ غير متوقع",
    variant: "destructive" 
  })
}
```

### Common Error Codes

| Code | Message |
|------|---------|
| `auth/email-already-in-use` | البريد الإلكتروني مسجل مسبقاً |
| `auth/weak-password` | كلمة المرور ضعيفة جداً |
| `auth/invalid-credential` | البريد الإلكتروني أو كلمة المرور غير صحيحة |
| `auth/user-not-found` | المستخدم غير موجود |
| `auth/operation-not-allowed` | العمليات غير مسموحة |

---

## Rate Limits

Firebase has built-in rate limiting. For intensive operations:

1. Implement pagination using `useCollectionPaginated`
2. Use batch operations for bulk writes
3. Cache AI responses with `src/ai/cache.ts`

---

## Webhooks (Future)

Future cloud functions may trigger webhooks for:

```typescript
// Offer status changed
{
  type: "offer_status_changed",
  offerId: "...",
  rfqId: "...",
  status: "accepted" | "rejected",
  timestamp: "..."
}

// RFQ status changed
{
  type: "rfq_status_changed",
  rfqId: "...",
  status: "awarded" | "completed" | "cancelled",
  timestamp: "..."
}
```

---

## Pagination

For paginated queries:

```typescript
import { useCollectionPaginated } from '@/firebase'

const { data, isLoading, hasMore, loadMore } = useCollectionPaginated(query)
```

Returns:
- `data`: Array of documents
- `isLoading`: Loading state
- `hasMore`: Whether more pages exist
- `loadMore()`: Function to load next page
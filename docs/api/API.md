# API Reference - مناقصتي

## Authentication API

### Register
```
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "********",
  "name": "Company Name",
  "phoneNumber": "+966501234567",
  "city": "Riyadh",
  "role": "contractor" | "supplier"
}
```

Response:
```json
{
  "success": true,
  "user": { "uid": "...", "email": "..." },
  "profileId": "..."
}
```

### Login
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "********"
}
```

Response:
```json
{
  "success": true,
  "user": { "uid": "...", "role": "contractor" }
}
```

### Get Current User
```
GET /api/auth/me
Authorization: Bearer <token>
```

Response:
```json
{
  "uid": "...",
  "email": "user@example.com",
  "role": "contractor",
  "profile": { ... }
}
```

---

## User Profile API

### Get Profile
```
GET /api/users/{userId}
Authorization: Bearer <token>
```

### Update Profile
```
PUT /api/users/{userId}
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "phoneNumber": "+966501234567",
  "city": "Jeddah"
}
```

### Verify Supplier (Admin only)
```
POST /api/admin/suppliers/{userId}/verify
Authorization: Bearer <admin_token>
```

---

## RFQ API

### List RFQs (Contractor - Own)
```
GET /api/rfqs
Authorization: Bearer <token>

Query params:
- status?: string
- page?: number
- limit?: number
```

### Get RFQ
```
GET /api/rfqs/{rfqId}
Authorization: Bearer <token>
```

### Create RFQ (Contractor)
```
POST /api/rfqs
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "طلب شراء حديد",
  "categoryId": "category_123",
  "quantity": 100,
  "unitOfMeasure": "طن",
  "deadline": "2024-12-31T23:59:59Z",
  "location": "Riyadh",
  "area": "North",
  "paymentTerms": "net-30",
  "isQualityCertificateRequired": true,
  "notes": "مطلوب حديد كمر"
}
```

### Update RFQ
```
PUT /api/rfqs/{rfqId}
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "cancelled"
}
```

### Get Matching RFQs (Supplier)
```
GET /api/rfqs/matching
Authorization: Bearer <supplier_token>
```

---

## Offer API

### List Offers (RFQ)
```
GET /api/rfqs/{rfqId}/offers
Authorization: Bearer <token>
```

### Create Offer (Supplier)
```
POST /api/rfqs/{rfqId}/offers
Authorization: Bearer <supplier_token>
Content-Type: application/json

{
  "pricePerUnit": 2500,
  "estimatedDeliveryDays": 7,
  "supplierNotes": "السعر شامل الضريبة",
  "canProvideQualityCertificate": true
}
```

### Accept Offer (Contractor)
```
POST /api/offers/{offerId}/accept
Authorization: Bearer <contractor_token>
```

### Reject Offer (Contractor)
```
POST /api/offers/{offerId}/reject
Authorization: Bearer <contractor_token>
```

---

## Notification API

### List Notifications
```
GET /api/notifications
Authorization: Bearer <token>
```

### Mark as Read
```
POST /api/notifications/{notificationId}/read
Authorization: Bearer <token>
```

### Mark All as Read
```
POST /api/notifications/read-all
Authorization: Bearer <token>
```

---

## Category API

### List Categories
```
GET /api/categories
```

Response:
```json
{
  "categories": [
    { "id": "1", "name": "حديد ومعادن", "description": "..." },
    { "id": "2", "name": "بناء وتشييد", "description": "..." }
  ]
}
```

---

## Chat API

### List Chats
```
GET /api/chats
Authorization: Bearer <token>
```

### Get Chat
```
GET /api/chats/{chatId}
Authorization: Bearer <token>
```

### Send Message
```
POST /api/chats/{chatId}/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "text": "مرحبا",
  "type": "text"
}
```

---

## AI API

### Recommend RFQs for Supplier
```
POST /api/ai/recommend-rfqs
Authorization: Bearer <supplier_token>

{
  "supplierId": "..."
}
```

### Recommend Suppliers for RFQ
```
POST /api/ai/recommend-suppliers
Authorization: Bearer <token>

{
  "rfqId": "..."
}
```

---

## Error Responses

All endpoints may return:

### 400 Bad Request
```json
{
  "error": "validation_error",
  "message": "Invalid input data",
  "details": [...]
}
```

### 401 Unauthorized
```json
{
  "error": "unauthorized",
  "message": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "error": "forbidden",
  "message": "Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "error": "not_found",
  "message": "Resource not found"
}
```

### 500 Server Error
```json
{
  "error": "internal_error",
  "message": "An unexpected error occurred"
}
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Auth endpoints | 10/minute |
| RFQ endpoints | 60/minute |
| Offer endpoints | 30/minute |
| AI endpoints | 10/minute |

---

## Webhooks

### Offer Status Changed
```json
{
  "type": "offer_status_changed",
  "offerId": "...",
  "rfqId": "...",
  "status": "accepted" | "rejected",
  "timestamp": "..."
}
```

### RFQ Status Changed
```json
{
  "type": "rfq_status_changed",
  "rfqId": "...",
  "status": "awarded" | "completed" | "cancelled",
  "timestamp": "..."
}
```
# Manual Testing Guide - Monaqasati RFQ Features

## Test Environment
- Frontend: http://localhost:9002 (run with `npm run dev`)
- Backend: Firebase Firestore (requires authentication)

## Pre-requisites
1. Firebase project configured with test data
2. Two test accounts:
   - Contractor account
   - Supplier account

---

## Feature 1: Contractor Creates RFQ with Multiple Products

### Test Steps:
1. **Navigate to RFQ creation** → `/contractor/rfqs/new`
2. **Fill Basic Info**:
   - Title: "توريد مواد بناء لمشروع"
   - Category: "حديد ومعادن" → "حديد تسليح"
3. **Add Products** (Step 1):
   - Click "إضافة منتج" button
   - Fill Product 1: Name="حديد تسليح", Quantity="100", Unit="طن", Description="حديد سابك"
   - Click "إضافة منتج" again
   - Fill Product 2: Name="شبك حديد", Quantity="50", Unit="متر", Description="مش"
4. **Add Notes**: Type some notes in the notes field
5. **Upload PDF**: Click upload area, select a PDF file
6. **Continue to Step 2**: Fill city, district, map location, deadline
7. **Continue to Step 3**: Choose visibility (public/favorites), toggle certificate if needed
8. **Submit**: Click "نشر المناقصة الآن"
9. **Verify**: New RFQ appears in `/contractor/rfqs`

### Expected Results:
- ✅ Multiple products shown in RFQ details
- ✅ PDF icon appears on RFQ cards
- ✅ Notes visible on first page before submission

---

## Feature 2: Supplier Views RFQs with Working Filters

### Test Steps:
1. **Login as Supplier**
2. **Navigate to RFQs** → `/supplier/rfqs`
3. **Test Filters**:
   - **Category Filter**: Select "حديد ومعادن" → RFQs should filter
   - **City Filter**: Select "الرياض" → RFQs should filter
   - **Deadline Filter**: 
     - Select "خلال أسبوع" → Shows RFQs with deadlines within 7 days
     - Select "خلال شهر" → Shows RFQs with deadlines within 30 days
     - Select "تاريخ محدد" → Date picker appears
4. **Search**: Type in search box to filter by title/category/city
5. **Verify**: Cards update in real-time with filters

### Expected Results:
- ✅ All filters work with real Firestore data
- ✅ Filters can be combined (category + city + deadline)
- ✅ "كل المدن" shows all cities
- ✅ "كل التصنيفات" shows all categories

---

## Feature 3: RFQ Details with Q&A Inquiries

### Test Steps:
1. **Navigate to RFQ listing** → `/supplier/rfqs`
2. **Click on an RFQ card** → Details dialog opens
3. **View Details**:
   - Products list shown
   - PDF download button (if attached)
   - Location and deadline info
   - Notes from contractor
4. **Test Inquiries**:
   - Click "الاستفسارات والأسئلة" to expand
   - Type question: "ما هو موعد التسليم النهائي؟"
   - Click send button
   - Question appears in list (marked as "مورد")
5. **Logout** → **Login as Contractor**
6. **View RFQ** → `/contractor/rfqs/[id]/offers`
7. **Reply to Question** (needs backend implementation):
   - Question shows in a dedicated inquiries section
   - Contractor can type reply
   - Reply visible to all suppliers

### Expected Results:
- ✅ Details dialog shows all product info
- ✅ PDF can be downloaded
- ✅ Questions can be submitted
- ✅ Supplier names hidden from other suppliers
- ✅ Contractor can see all questions and reply

---

## Feature 4: Supplier Submits Offer with Toggles

### Test Steps:
1. **Navigate to RFQ** → `/supplier/rfqs`
2. **Click RFQ card** → Details dialog opens
3. **Click "تقديم عرض سعر"** → Offer dialog opens
4. **Fill Offer**:
   - Select Delivery Method: "شاحنات خاصة"
   - Select Delivery Frequency: "دفعة واحدة"
   - Add Delivery Batch:
     - Select location on map
     - Set date
     - Set price
5. **Test Toggles**:
   - Check "توصيل مجاني"
   - Check "توفير عينة (Sample)"
6. **Submit**: Click confirmation button

### Expected Results:
- ✅ Free shipping toggle saves with offer
- ✅ Sample toggle saves with offer
- ✅ Both shown as badges in contractor's offer view

---

## Feature 5: Contractor Views Offers Comparison

### Test Steps:
1. **Login as Contractor**
2. **Navigate to RFQ offers** → `/contractor/rfqs/[id]/offers`
3. **View List Tab**: Shows all offers with status
4. **Click "مقارنة العروض" Tab**
5. **Verify Table Columns**:
   - ✅ السعر المقترح (actual price)
   - ✅ طريقة التسليم (from offer data)
   - ✅ وتيرة التسليم (from offer data)
   - ✅ توصيل مجاني (shows ✓ or —)
   - ✅ يتضمن عينة (shows ✓ or —)
   - ✅ عدد المنتجات (from RFQ)
   - ✅ تاريخ التقديم
   - ✅ القرار

### Expected Results:
- ✅ Comparison table uses real offer data
- ✅ Not hardcoded values
- ✅ Multiple offers can be compared

---

## Feature 6: Chat Functionality

### Test Steps:
1. **Contractor accepts an offer**:
   - Go to offers page
   - Click "قبول العرض" on an offer
   - Chat is auto-created
2. **Open Chats**:
   - Contractor: `/contractor/chats`
   - Supplier: `/supplier/chats`
3. **Send Messages**:
   - Type message in input
   - Press Enter or click send
   - Message appears in chat
4. **Real-time**: Open same chat in two browsers

### Expected Results:
- ✅ Chat created when offer accepted
- ✅ Messages persist in Firestore
- ✅ Real-time updates work

---

## Feature 7: Supplier Profile - Coverage Cities

### Test Steps:
1. **Navigate to profile** → `/supplier/profile`
2. **Find "مدن التغطية الإضافية" section**
3. **Add cities**:
   - Type city name + Enter
   - OR click dropdown → select city
4. **Remove cities**: Click X on city badge
5. **Save**: Click "حفظ البيانات الأساسية"

### Expected Results:
- ✅ Dropdown shows all Saudi cities
- ✅ Multiple cities can be added
- ✅ Cities persist after save

---

## Test Checklist

| Feature | Test Case | Status |
|---------|-----------|--------|
| Multiple Products | Add 2+ products in RFQ | ☐ |
| PDF Attachment | Upload PDF on RFQ creation | ☐ |
| Notes on Page 1 | Notes field visible on step 1 | ☐ |
| RFQ Filters | Category, City, Deadline filters | ☐ |
| Q&A Inquiries | Submit question, view all | ☐ |
| Offer Toggles | Free shipping & Sample | ☐ |
| Comparison Table | Real data in columns | ☐ |
| Chat | Send/receive messages | ☐ |
| Coverage Cities | Add/remove cities | ☐ |

---

## Running Automated Tests

```bash
# Run unit tests
npm test

# Run E2E tests (requires dev server running)
npm run e2e

# Run with coverage
npm run test:coverage

# Type check
npm run typecheck
```

## Test Results Summary

- **Unit Tests**: 53 passing
- **E2E Tests**: 15 test cases
- **TypeScript**: ✅ Pass
- **Build**: ✅ Pass
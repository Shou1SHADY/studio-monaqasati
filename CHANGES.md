# Changes Summary

## 1. Register Page — Remove Fields
**File:** `src/app/[locale]/register/page.tsx`

- Removed `crNumber`, `taxNumber`, and `city` fields from formData state
- Removed corresponding JSX input fields (السجل التجاري, الرقم الضريبي, المدينة)
- Removed these fields from Firestore writes in both `handleRegister` and `handleGoogleRegister`

## 2. Register Page — Specializations Search
**File:** `src/app/[locale]/register/page.tsx`  
**Translations:** `messages/ar.json`, `messages/en.json`

- Added a search input inside the تخصصات التوريد dropdown
- Typing filters the category list by displayed name (locale-aware)
- Shows "لا توجد تخصصات مطابقة" / "No matching specializations" when no results
- Search resets when dropdown closes
- Added `Search` icon import from lucide-react

## 3. Register Page — Dropdown Click-Outside
**File:** `src/app/[locale]/register/page.tsx`

- Added `useRef` + `useEffect` to close the specializations dropdown when clicking outside
- Added `specDropdownRef` on the dropdown container div
- Closing also clears the search term

## 4. Button Hover Color Fixes
**File:** `src/components/ui/button.tsx`  
**File:** `src/app/[locale]/(contractor)/contractor/rfqs/new/page.tsx`

- Changed outline variant `hover:text-white` → `hover:text-cta-foreground` (uses CSS variable)
- Removed conflicting `hover:bg-primary/5` from "Save as Draft" button className
- Added `hover:text-slate-700` to "Previous" (السابق) button

## 5. Supplier Profile Dialog — Previous Works Section
**File:** `src/app/[locale]/(contractor)/contractor/suppliers/page.tsx`  
**Translations:** `messages/ar.json`, `messages/en.json`

- Added "الأعمال السابقة" / "Previous Works" section to the supplier profile dialog
- Displays project name, description, and image thumbnails (clickable to full-size)
- Uses `selectedSupplier.projects` from Firestore
- Shows empty state message when no projects exist
- Added `FolderOpen` icon import

## 6. Price Reduction Dialog — Show Contractor's Suggested Price
**File:** `src/app/[locale]/(supplier)/supplier/offers/page.tsx`  
**Translations:** `messages/ar.json`, `messages/en.json`

- Added amber-highlighted box displaying `targetPrice` (السعر المقترح من المقاول)
- Appears between "Previous Price" and "New Price" in the Update Price dialog
- Only shown when `targetPrice != null` on the offer document
- Properly handles edge case of price being `0`

## 7. Tender Completion — RFQ Status Updated to "Awarded"
**File:** `src/app/[locale]/(contractor)/contractor/rfqs/[id]/offers/page.tsx`

- **On offer acceptance** (`handleDecision`): RFQ status updated to `"Awarded"` with `awardedAt` timestamp (Step 2b, non-critical)
- **On supply completion** (`handleMarkAsCompleted`): RFQ status updated to `"Awarded"` with `completedAt` timestamp
- Completed tenders now:
  - Disappear from supplier's available tenders (filtered for `status == "New"`)
  - Appear under "مكتملة" (Awarded) tab in contractor's مناقصاتي

## 8. Edit & Delete Tenders for Contractors
**Files:** 
- `src/app/[locale]/(contractor)/contractor/rfqs/page.tsx` — UI buttons + handlers
- `src/app/[locale]/(contractor)/contractor/rfqs/new/page.tsx` — Edit mode support  
**Translations:** `messages/ar.json`, `messages/en.json`

### Edit
- "Edit Tender" (Pencil icon) button on each tender card
- Links to `/contractor/rfqs/new?edit={rfqId}`
- Edit mode loads existing RFQ data from Firestore, pre-fills all form fields
- Correctly maps `unitOfMeasure` (Firestore) ↔ `unit` (form field)
- Uses `updateDoc` instead of creating a new document
- Page title and description change in edit mode

### Delete
- "Delete Tender" (Trash2 icon) button on each tender card
- Opens `AlertDialog` confirmation with tender title
- Deletes RFQ document from Firestore
- Success/failure toast notifications

### Condition
- Both edit and delete only shown when `rfq.status !== "Awarded"` (no accepted offer)

## 9. Contractor Team Page — Column Alignment
**File:** `src/components/team-management.tsx`

- Added `dir={locale === 'ar' ? 'rtl' : 'ltr'}` to table container
- Added locale-aware `text-right`/`text-left` classes to all `TableHead` and `TableCell` elements
- Columns now align correctly in both Arabic (RTL) and English (LTR)

## 10. Expired Tenders — Hide from Suppliers
**Files:**
- `src/app/[locale]/(supplier)/supplier/rfqs/page.tsx` — always excludes expired from `filteredRfqs`
- `src/app/[locale]/(supplier)/supplier/page.tsx` — `activeRfqs` filter, `recommendedRfqs` uses it
- `src/app/[locale]/(supplier)/supplier/notifications/page.tsx` — `rfqsList` filter

- Expired filter: `deadline < new Date()` (midnight-normalized)
- Applied before any search/filter criteria in all 3 supplier views

## 11. Re-Publish Button for Expired Tenders
**File:** `src/app/[locale]/(contractor)/contractor/rfqs/page.tsx`  
**Translations:** `messages/ar.json`, `messages/en.json`

- Detects expired tenders: `status === "New"` + deadline in the past
- "Re-publish" (RotateCw icon) amber-outlined button on expired tender cards
- Opens `Dialog` to pick a new deadline date (min: today)
- On confirm: updates deadline, resets status to `"New"`, and updates `publishedAt`
- Only shown for expired (non-Awarded) tenders — does not appear alongside edit/delete

## Translation Keys Added

### Portal.Contractor
| Key | Arabic | English |
|-----|--------|---------|
| `rfq_edit_tender` | تعديل المناقصة | Edit Tender |
| `rfq_delete_tender` | حذف المناقصة | Delete Tender |
| `rfq_delete_confirm_title` | تأكيد الحذف | Confirm Deletion |
| `rfq_delete_confirm_desc` | هل أنت متأكد من حذف... | Are you sure you want to delete... |
| `rfq_delete_success` | تم حذف المناقصة بنجاح | Tender deleted successfully |
| `rfq_delete_failed` | فشل حذف المناقصة | Failed to delete tender |
| `rfq_republish` | إعادة نشر المناقصة | Re-publish Tender |
| `rfq_republish_title` | إعادة نشر المناقصة | Re-publish Tender |
| `rfq_republish_desc` | قم بتعيين موعد نهائي... | Set a new deadline... |
| `rfq_republish_deadline_label` | الموعد النهائي الجديد | New Deadline |
| `rfq_republish_confirm` | إعادة النشر | Re-publish |
| `rfq_republish_success` | تم إعادة نشر المناقصة بنجاح | Tender re-published successfully |
| `rfq_republish_failed` | فشل إعادة نشر المناقصة | Failed to re-publish tender |
| `newrfq_toast_updated` | تم التحديث! | Updated! |
| `newrfq_toast_updated_desc` | تم تعديل المناقصة بنجاح | The tender has been updated successfully |
| `newrfq_toast_update_failed` | فشل تحديث المناقصة | Failed to update tender |
| `newrfq_edit_title` | تعديل المناقصة | Edit Tender |
| `newrfq_edit_desc` | عدل بيانات المناقصة... | Modify the existing tender... |
| `suppliers_projects` | الأعمال السابقة | Previous Works |
| `suppliers_no_projects` | لم يقم المورد بإضافة... | The supplier has not added... |

### Portal.Supplier
| Key | Arabic | English |
|-----|--------|---------|
| `contractor_suggested_price` | السعر المقترح من المقاول | Contractor's Suggested Price |

### Auth.Register
| Key | Arabic | English |
|-----|--------|---------|
| `search_specializations` | ابحث عن تخصص... | Search specializations... |
| `no_specializations_found` | لا توجد تخصصات مطابقة | No matching specializations |

## Files Changed

| File | Changes |
|------|---------|
| `src/app/[locale]/register/page.tsx` | Remove 3 fields, add search + click-outside to specializations |
| `src/components/ui/button.tsx` | Fix outline variant hover text color |
| `src/app/[locale]/(contractor)/contractor/rfqs/new/page.tsx` | Edit mode + previous button hover fix |
| `src/app/[locale]/(contractor)/contractor/rfqs/[id]/offers/page.tsx` | RFQ status to Awarded on accept/complete + targetPrice in dialog |
| `src/app/[locale]/(contractor)/contractor/rfqs/page.tsx` | Edit/delete/re-publish buttons + handlers |
| `src/app/[locale]/(contractor)/contractor/suppliers/page.tsx` | Previous works section in profile dialog |
| `src/app/[locale]/(supplier)/supplier/offers/page.tsx` | Contractor's suggested price display |
| `src/app/[locale]/(supplier)/supplier/rfqs/page.tsx` | Expired tender filter |
| `src/app/[locale]/(supplier)/supplier/page.tsx` | Expired tender filter (dashboard) |
| `src/app/[locale]/(supplier)/supplier/notifications/page.tsx` | Expired tender filter (notifications) |
| `src/components/team-management.tsx` | RTL/LTR column alignment |
| `messages/ar.json` | All Arabic translations |
| `messages/en.json` | All English translations |

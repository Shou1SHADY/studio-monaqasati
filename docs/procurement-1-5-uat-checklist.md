# Procurement 1.5 — what to try on UAT

UAT: https://studio-monaqasati--mdmaktech-uat.us-east4.hosted.app — sign in with the seeded
contractor owner and a buyer (passwords in `..\uat-seed-accounts-*.txt`). Arabic first, then `/en`.
Irreversible steps (a receipt, an order sent, a notice) are marked ⚠ — they write UAT data.

| # | Where | Try | Expect |
|---|---|---|---|
| 1 | Landing, login, sidebar | Look at the logo, the favicon, the landing images | All show (they 404'd on UAT until 1f1b747) |
| 2 | المشتريات → الرئيسية | Sidebar order | اليوم · طلبات الشراء الواردة · طلبات العروض · أوامر الشراء · سندات الاستلام · الموردون · التقارير · الإعدادات — same names as the tabs |
| 3 | طلبات العروض → جديد | Type «اسياخ», pick a hit; paste rows from Excel; two delivery sites | Material, specs and unit come from the tree; one RFQ, two places; the review says «سيصل الطلب إلى X» |
| 4 | Same, publish ⚠ | Publish, then open it from a project's tenders tab | ONE page `/contractor/rfqs/{id}/offers`; the old tender link redirects there |
| 5 | Edit | Edit a draft; try to edit an RFQ that has an offer | The draft keeps its project and author; with an offer the editor refuses and opens the RFQ |
| 6 | طلبات الشراء الواردة | A PM request «ط.م 03» | One card per request; «انشره» opens the panel; «جهّزه» opens the editor with it |
| 7 | الموردون → الدعوات | Invite by mobile ⚠ | States أُرسلت · فُتحت · انضم; resend / cancel |
| 8 | A supplier notice ⚠ | «حوّل للمستلم» to a member, then to a person by mobile | Member confirms by his login; a person by the SMS code; photos upload (big phone photos too) |
| 9 | أمر الشراء | Open an order in delivery | «الخطوة التالية» says whom it waits on; sections fold |
| 10 | الإعدادات → مواقع التسليم | Add a site, then edit it, then retire it | Every save works (the second save failed before 9b5a40f) |
| 11 | Admin → Components | Switch the contractor's **Finance off** | The order shows «الدفع» (status chips, advance, invoice file, «أرسلها للمحاسب»); orders page shows «صدّر للمحاسبة»; Today's second tile «بانتظار دفعة مقدّمة» |
| 12 | Same | Switch **Project Management off** | «طلب مواد» on the incoming page; «طلباتي» shows its state; Procurement can decline it with a reason; texts no longer mention projects |
| 13 | `/en/...` | Repeat 11/12 in English | The switches apply in English too (they did not before 9b5a40f) |
| 14 | Admin → Materials | Browse the tree, ask suppliers to fill their specialties | Supplier sees the specialties prompt |

Restore the switches (Finance and Project Management on) when done.

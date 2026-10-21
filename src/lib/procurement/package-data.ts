// Procurement 2.0 — the pipeline: six stages of the base package and the 36 events that cross its boundary
// (Pipeline 2.0 §3, prototype v5 `STAGES` / `EVTS`). One registry for the admin's «المسار والعقود», the contract tests and
// `event-keys.ts`. Each text is the prototype's [Arabic, English] pair. Pure data.

export type PipelineUnit = "core" | "inv" | "pm" | "fin" | "mfg"
export type StageId = "need" | "check" | "rfq" | "po" | "rcv" | "close"
export type Bilingual = readonly [ar: string, en: string]

export interface PipelineStage {
  id: StageId
  name: Bilingual
  core: Bilingual
}

export const STAGES: readonly PipelineStage[] = [
  { id: "need", name: ["الاحتياج", "Need"], core: ["«طلب مواد» من الفريق (بلا المشاريع) · «سطر احتياج» من المخزون · طلب عروض جديد", "Team material request (without Projects) · Inventory need line · a new RFQ"] },
  { id: "check", name: ["قبل الشراء", "Before buying"], core: ["فحص المخزون لكل مادة · «آخر يوم للطلب» · الفئة الفرعية", "Inventory check per material · last day to order · subcategory"] },
  { id: "rfq", name: ["طلب العروض", "RFQ"], core: ["النشر عام/خاص/إسناد مباشر · رابط الزوار · العروض فور وصولها · الاستفسارات · المقارنة", "Publish public/private/direct · visitor link · offers as they arrive · inquiries · comparison"] },
  { id: "po", name: ["الترسية وأمر الشراء", "Award & PO"], core: ["الترسية متى شئت بسببها · أمر لكل مورد · الاعتماد · الإرسال وقبول المورد · محادثة الأمر", "Award any time, with its reason · one PO per supplier · approval · sending and acceptance · order conversation"] },
  { id: "rcv", name: ["التسليم والاستلام", "Delivery & receipt"], core: ["إشعار المورد بتاريخ وملاحظة · التحويل للمستلم · السند للمستلم · الرصيد في المستودع", "Supplier notice (date + note) · forward to receiver · receipt by receiver · stock in warehouse"] },
  { id: "close", name: ["الدفع والإقفال", "Payment & close"], core: ["«الخطوة التالية» حتى الإقفال · حالة دفع اختيارية وتصدير للمحاسب", "Next step until closing · optional payment status and accountant export"] },
]

export const EVENT_IDS = [
  "rfq_offer",
  "rfq_publish",
  "rfq_ask",
  "rfq_answer",
  "rfq_cut",
  "rfq_outcome",
  "po_message",
  "po_message_supplier",
  "po_version",
  "po_accept",
  "po_report",
  "po_forward",
  "po_decline",
  "po_reject",
  "po_escalate",
  "inv_need",
  "inv_issue",
  "inv_check",
  "po_inbound",
  "inv_receipt",
  "receipt_manual",
  "pm_request",
  "pm_cancel",
  "pm_status",
  "pm_receipt",
  "fin_commitment",
  "fin_advance_request",
  "fin_variance",
  "fin_advance_paid",
  "fin_payment",
  "fin_paid",
  "fin_hold",
  "mfg_shortage",
  "mfg_ask",
  "mfg_reply",
  "mfg_status",
] as const
export type ProcEventId = (typeof EVENT_IDS)[number]

export interface PipelineEvent {
  n: number
  id: ProcEventId
  unit: PipelineUnit
  stage: StageId
  /** `in` reaches Procurement, `out` leaves it. */
  dir: "in" | "out"
  /** The idempotency key template — ids that never repeat, `V<n>` for what changes, a sequence for what repeats. */
  key: string
  title: Bilingual
  carries: Bilingual
  late: Bilingual
  without: Bilingual
  isNew: boolean
}

export const EVENTS: readonly PipelineEvent[] = [
  { n: 1, id: "rfq_offer", unit: "core", stage: "rfq", dir: "in", key: "proc:RFQ:<rfq_no>:<supplier_id>:V<n>", title: ["عرض سعر (بوابة المورد أو رابط الزوار)", "Quote (supplier portal or visitor link)"], carries: ["الأسعار · المدة · الصلاحية · العرض الرسمي", "prices · lead time · validity · official quote"], late: ["نشتري ممن قدّم، ويُسجَّل «منافسة ناقصة»", "We buy from who quoted; thin competition logged"], without: ["أساس", "Core"], isNew: false },
  { n: 2, id: "rfq_publish", unit: "core", stage: "rfq", dir: "out", key: "proc:RFQ:<rfq_no>:V<n>", title: ["نشر طلب العروض، وكل تعديل عليه بإصدار: تمديد · إعادة فتح · إلغاء", "RFQ published, and every change as a version: extend · reopen · cancel"], carries: ["المواد ووحدات بيعها · المدينة والحي فقط · الموعد · خيارات التسليم · الشروط", "materials and sale units · city and district only · deadline · delivery options · terms"], late: ["لا عروض", "No offers"], without: ["أساس", "Core"], isNew: true },
  { n: 3, id: "rfq_ask", unit: "core", stage: "rfq", dir: "in", key: "proc:RFQ:<rfq_no>:ASK<n>", title: ["استفسار مورّد من بوابته أو من الرابط (قد يكون بلا اسم)", "Supplier inquiry from the portal or the link (may be anonymous)"], carries: ["السؤال · المادة · السائل", "question · material · asker"], late: ["يسعّر على تخمين", "He prices on a guess"], without: ["أساس", "Core"], isNew: true },
  { n: 4, id: "rfq_answer", unit: "core", stage: "rfq", dir: "out", key: "proc:RFQ:<rfq_no>:Q<n>", title: ["جواب «للجميع» أو «للسائل»، أو توضيح لكل المدعوّين", "Answer to all or to the asker, or a clarification to all invited"], carries: ["النص · لمن · بلا اسم السائل في «للجميع»", "text · audience · no asker name when to all"], late: ["يبقى السؤال في «اليوم»", "The question stays in Today"], without: ["أساس", "Core"], isNew: true },
  { n: 5, id: "rfq_cut", unit: "core", stage: "rfq", dir: "out", key: "proc:RFQ:<rfq_no>:<supplier_id>:CUT", title: ["طلب سعر أفضل — جولة واحدة لكل عرض", "Better-price request — one round per offer"], carries: ["موعد الردّ · ملاحظة · بلا أسعار غيره ولا أسمائهم", "reply-by · note · never other prices or names"], late: ["يبقى عرضه الأول", "His first offer stands"], without: ["أساس", "Core"], isNew: true },
  { n: 6, id: "rfq_outcome", unit: "core", stage: "po", dir: "out", key: "proc:RFQ:<rfq_no>:<supplier_id>:OUT:R<n>", title: ["نتيجة الطلب لكل مقدّم، والإغلاق المبكر، وجولة جديدة إن أُعيدت الترسية بعد إلغاء أمر", "Result to every bidder, the early close, and a new round when re-awarded after a cancelled order"], carries: ["رُسّي عليك برقم الأمر · رُسّي على غيرك · أُغلق الطلب", "won with the PO number · lost · RFQ closed"], late: ["يبقى العرض معلّقاً عند المورّد", "The quote hangs on the supplier side"], without: ["أساس", "Core"], isNew: true },
  { n: 7, id: "po_message", unit: "core", stage: "po", dir: "out", key: "proc:PO:<po_no>:MSG<n>", title: ["رسالة في محادثة الأمر — ولمن خارج المنصة على واتساب مع رابط الأمر", "A message in the order conversation — WhatsApp with the order link for off-platform suppliers"], carries: ["النص · ملف", "text · file"], late: ["—", "—"], without: ["أساس", "Core"], isNew: true },
  { n: 8, id: "po_message_supplier", unit: "core", stage: "po", dir: "in", key: "proc:PO:<po_no>:MSG<n>:SUP", title: ["ردّ المورّد في محادثة الأمر (من بوابته أو من رابط الأمر)", "Supplier reply in the order conversation (portal or order link)"], carries: ["النص · ملف", "text · file"], late: ["يُفقد في الهاتف", "Lost on the phone"], without: ["أساس", "Core"], isNew: true },
  { n: 9, id: "po_version", unit: "core", stage: "po", dir: "out", key: "proc:PO:<po_no>:V<n>", title: ["إرسال الأمر للمورد، وكل إصدار بعده (إلغاء · موعد جديد · إقفال ناقص)", "PO sent to the supplier, and each later version (cancel · new date · close short)"], carries: ["نسخة الأمر ورابطها · رسالة", "PO copy and link · message"], late: ["لا يبدأ عدّ القبول", "Acceptance count does not start"], without: ["أساس", "Core"], isNew: false },
  { n: 10, id: "po_accept", unit: "core", stage: "po", dir: "in", key: "proc:PO:<po_no>:V<n>:ACC", title: ["قبول المورد لإصدار الأمر وموعده", "Supplier acceptance of the PO version, and its date"], carries: ["تاريخ القبول · الموعد", "acceptance date · due date"], late: ["يصير «لم يقبل المورد» قراراً في «اليوم»", "Becomes “not accepted” in Today"], without: ["أساس", "Core"], isNew: false },
  { n: 11, id: "po_report", unit: "core", stage: "rcv", dir: "in", key: "proc:PO:<po_no>:REP<n>", title: ["إشعار تسليم: تاريخ وملاحظة فقط — بتسلسل، فشاحنتان في يوم إشعاران", "Delivery notice: date and note only — sequenced, so two trucks a day are two notices"], carries: ["التاريخ · ملاحظة", "date · note"], late: ["يُسجَّل السند ويُوسم «وصلت بلا إشعار»", "Receipt logged, tagged “no notice”"], without: ["أساس", "Core"], isNew: false },
  { n: 12, id: "po_forward", unit: "core", stage: "rcv", dir: "out", key: "proc:PO:<po_no>:REP<n>:FWD<m>", title: ["تحويل الإشعار إلى المستلم (حسابه أو رابط ورمز)", "Forward the notice to the receiver"], carries: ["الشحنة · المستلم · الرمز · ملاحظة", "shipment · receiver · code · note"], late: ["تحويل تلقائي موسوم قبل يوم من التسليم", "Tagged auto-forward a day before"], without: ["أساس", "Core"], isNew: false },
  { n: 13, id: "po_decline", unit: "core", stage: "po", dir: "in", key: "proc:PO:<po_no>:V<n>:DEC", title: ["اعتذار المورد عن الأمر بسببه", "Supplier declines the PO, with reason"], carries: ["السبب · التاريخ", "reason · date"], late: ["يبقى الأمر «لم يقبل» حتى المهلة", "The PO stays “not accepted” until the window"], without: ["أساس", "Core"], isNew: true },
  { n: 14, id: "po_reject", unit: "core", stage: "rcv", dir: "out", key: "proc:PO:<po_no>:REJ<n>", title: ["قرارنا في الكمية المرفوضة: استبدال · خصم · إرجاع", "Our decision on rejected quantity: replace · discount · return"], carries: ["السطر · الكمية · القرار · السبب", "line · qty · decision · reason"], late: ["يبقى المرفوض بلا قرار", "The rejected quantity hangs"], without: ["أساس", "Core"], isNew: true },
  { n: 15, id: "po_escalate", unit: "core", stage: "rcv", dir: "out", key: "proc:PO:<po_no>:REP<n>:ESC", title: ["تصعيد تسليم لم يُعدّ بعد مهلته", "Escalate a delivery left uncounted past its window"], carries: ["المستلم · منذ متى · إلى مدير المشروع أو المالك", "receiver · since when · to the project manager or owner"], late: ["يبقى الأمر مفتوحاً بلا عدّ", "The PO stays open uncounted"], without: ["إلى المالك", "To the owner"], isNew: true },
  { n: 16, id: "inv_need", unit: "inv", stage: "need", dir: "in", key: "inv:NEED:<need_id>", title: ["«سطر احتياج»: صنف تحت حدّ الأمان", "“Need line”: item below safety level"], carries: ["الصنف · الكمية · المستودع · «مطلوب قبل»", "item · qty · warehouse · needed before"], late: ["يُكتشف النقص يوم الحاجة", "The shortage is found on the day"], without: ["في الباقة الأساسية دائماً", "Always in the base package"], isNew: true },
  { n: 17, id: "inv_issue", unit: "inv", stage: "check", dir: "out", key: "proc:ISS:<mr_id>:<line_no>", title: ["طلب صرف من المخزون قبل الشراء", "Issue request to Inventory before buying"], carries: ["المادة · الكمية · المشروع أو الجهة", "material · qty · project or party"], late: ["—", "—"], without: ["في الباقة الأساسية دائماً", "Always in the base package"], isNew: true },
  { n: 18, id: "inv_check", unit: "inv", stage: "check", dir: "in", key: "inv:CHK:<mr_id>:<line_no>:V<n>", title: ["ردّ المخزون: يصرف · مرتبط بغرض آخر · لا رصيد", "Inventory reply: issues · tied · no stock"], carries: ["ما يُصرف ومن أي مستودع · وما يبقى للشراء وسببه", "issued and from where · what remains to buy and why"], late: ["تفشل مفتوحةً: بعد يوم نمضي بشراء الكل", "Fails open: after a day we buy it all"], without: ["في الباقة الأساسية دائماً", "Always in the base package"], isNew: false },
  { n: 19, id: "po_inbound", unit: "inv", stage: "po", dir: "out", key: "proc:PO:<po_no>:V<n>:INV", title: ["أمر معتمد «في الطريق إليك» للمستودع أو الموقع", "Approved PO “on its way” for warehouse or site"], carries: ["الوجهة · البنود · الموعد · المورد", "destination · lines · date · supplier"], late: ["المستلم لا يعرف ما ينتظره", "The receiver doesn’t know what is coming"], without: ["في الباقة الأساسية دائماً", "Always in the base package"], isNew: false },
  { n: 20, id: "inv_receipt", unit: "inv", stage: "rcv", dir: "in", key: "inv:GRN:<grn_no>", title: ["سند استلام في مستودع رئيسي (يدخل رصيده)", "Receipt at a main warehouse (enters stock)"], carries: ["المعدود · المقبول · المرفوض وسببه · المستلم", "counted · accepted · rejected · receiver"], late: ["الأمر لا يُقفل", "The PO does not close"], without: ["في الباقة الأساسية دائماً", "Always in the base package"], isNew: false },
  { n: 21, id: "receipt_manual", unit: "inv", stage: "rcv", dir: "out", key: "proc:GRN:<grn_no>:MAN", title: ["سند يدوي لشراء خارج المنصة في مستودع رئيسي: مسودة يؤكدها أمين المستودع", "Manual receipt for an off-platform purchase at a main warehouse: a draft the storekeeper confirms"], carries: ["المورّد · البنود · الكميات · المرفقات · من سجّله", "supplier · lines · quantities · files · logged by"], late: ["رصيد يدخل بلا تأكيد أمين المستودع", "Stock enters without the storekeeper’s confirmation"], without: ["في الباقة الأساسية دائماً", "Always in the base package"], isNew: true },
  { n: 22, id: "pm_request", unit: "pm", stage: "need", dir: "in", key: "prj:MR:<mr_id>", title: ["طلب مواد معتمد فنياً، كاملاً غير مقسوم", "A technically approved material request, whole"], carries: ["معرّف عالمي (رقم «ط.م 03» يتكرر بين المشاريع) · مادة · كمية · موعد · وجهة · بند · طالب", "global id (“MR 03” repeats across projects) · material · qty · date · destination · BOQ item · requester"], late: ["لا شراء بلا حاجة؛ السطر لا يوجد", "No purchase without a need"], without: ["«طلب مواد» من الفريق في المشتريات", "Team “Material request” inside Procurement"], isNew: false },
  { n: 23, id: "pm_cancel", unit: "pm", stage: "need", dir: "in", key: "prj:MR:<mr_id>:CAN:<line_no>", title: ["«أوقِفوا ما لم يصل» أو سحب الطلب", "“Stop what hasn’t arrived” or request withdrawn"], carries: ["السطر · السبب", "line · reason"], late: ["يبقى المتبقي مفتوحاً على المورد بلا داعٍ", "The rest stays open with the supplier"], without: ["يُسحب «طلب المواد» من شاشته نفسها", "Withdrawn on the material request itself"], isNew: false },
  { n: 24, id: "pm_status", unit: "pm", stage: "rfq", dir: "out", key: "proc:ST:<mr_id>:<line_no>:V<n>", title: ["حالة المادة تعود إلى المشروع", "Material status back to the project"], carries: ["في عروض · في أمر · وصلت · تعذّر الشراء وسببه — لكل سطر، وكل تغيّر إصدار", "in RFQ · in PO · arrived · could not buy and why — per line, each change a version"], late: ["المهندس يسأل المشتريات هاتفياً", "The engineer phones Procurement"], without: ["تظهر لصاحب «طلب المواد» في «مهامي»", "Shown to the requester in My tasks"], isNew: true },
  { n: 25, id: "pm_receipt", unit: "pm", stage: "rcv", dir: "in", key: "prj:GRN:<grn_no>", title: ["سند استلام في موقع المشروع", "Receipt at a project site"], carries: ["المعدود · المقبول · المرفوض وسببه · المستلم", "counted · accepted · rejected and why · receiver"], late: ["الأمر لا يُقفل", "The PO does not close"], without: ["المستلم يسجّل السند برابط ورمز أو من حسابه، ويُحفظ في المشتريات", "The receiver records it by link and code or account"], isNew: false },
  { n: 26, id: "fin_commitment", unit: "fin", stage: "po", dir: "out", key: "proc:PO:<po_no>:V<n>:FIN", title: ["أمر شراء معتمد: التزام وضلع أول للمطابقة", "Approved PO: commitment and first match leg"], carries: ["المورد · البنود والأسعار أو المبلغ الإجمالي · الضريبة بحسب تسجيله · الشروط · المشروع والبند · سبب غير الأقل · المنافسة الناقصة · الإصدار (إلغاء · موعد · إقفال ناقص)", "supplier · lines and prices or lump sum · VAT by registration · terms · project and item · not-lowest reason · low competition · version (cancel · date · close short)"], late: ["فاتورته تُوقف «بلا أمر شراء»", "Its invoice is held “no PO”"], without: ["يدخل ملف «صدّر للمحاسبة» للفترة", "Goes into the period’s accounting export"], isNew: false },
  { n: 27, id: "fin_advance_request", unit: "fin", stage: "po", dir: "out", key: "proc:ADV:<adv_no>", title: ["طلب دفعة مقدّمة", "Advance payment request"], carries: ["النسبة · المبلغ · شرط الضمان · اعتماد المالك لمورّد بلا سجل", "percent · amount · guarantee · owner approval for a supplier with no record"], late: ["لا تبدأ مدة المورد", "The supplier’s clock does not start"], without: ["«علّمها مدفوعة» في الأمر", "“Mark it paid” in the PO"], isNew: false },
  { n: 28, id: "fin_variance", unit: "fin", stage: "close", dir: "out", key: "proc:VAR:<invoice_no>", title: ["قرارنا في فرق السعر", "Our price-variance decision"], carries: ["قبول/رفض · السعر المعتمد · السبب", "accept/reject · approved price · reason"], late: ["تبقى الفاتورة موقوفة", "The invoice stays held"], without: ["لا يوجد: الفاتورة تذهب للمحاسب كما هي", "None: the invoice goes to the accountant as is"], isNew: false },
  { n: 29, id: "fin_advance_paid", unit: "fin", stage: "close", dir: "in", key: "fin:ADV:<adv_no>", title: ["دُفعت الدفعة المقدّمة", "Advance paid"], carries: ["التاريخ · المبلغ", "date · amount"], late: ["يتأخر الموعد الصادق", "The honest date slips"], without: ["«علّمها مدفوعة»", "“Mark it paid”"], isNew: false },
  { n: 30, id: "fin_payment", unit: "fin", stage: "close", dir: "in", key: "fin:PAY:<payment_no>", title: ["دفعة مسدّدة (سند صرف)", "Payment made (voucher)"], carries: ["المبلغ · تاريخ القيمة · المرجع البنكي", "amount · value date · bank ref"], late: ["يطالب المورد ونحن بلا جواب", "The supplier chases, we have no answer"], without: ["حالة الدفع اختيارية يعلّمها المشتري", "Optional payment status marked by the buyer"], isNew: false },
  { n: 31, id: "fin_paid", unit: "fin", stage: "close", dir: "in", key: "fin:PAID:<po_no>", title: ["سُدّد الأمر كاملاً فيُقفل", "PO fully paid, so it closes"], carries: ["التاريخ", "date"], late: ["لا يُقفل الأمر", "The PO does not close"], without: ["الأمر يُقفل باكتمال الاستلام", "The PO closes on full receipt"], isNew: false },
  { n: 32, id: "fin_hold", unit: "fin", stage: "close", dir: "out", key: "proc:HOLD:<invoice_no>", title: ["«أوقف صرف فاتورة» بسببه", "“Hold an invoice”, with reason"], carries: ["الفاتورة · السبب · حتى متى", "invoice · reason · until when"], late: ["تُصرف فاتورة فيها خلاف", "A disputed invoice gets paid"], without: ["لا يوجد: الفاتورة للمحاسب", "None: the invoice goes to the accountant"], isNew: true },
  { n: 33, id: "mfg_shortage", unit: "mfg", stage: "need", dir: "in", key: "mfg:PRQ:<prq_id>", title: ["طلب شراء الناقص على أمر تشغيل", "Shortage purchase request on a work order"], carries: ["مادة · كمية · «مطلوب قبل» · القسم", "material · qty · needed before · department"], late: ["لا شيء يصلنا فلا شراء", "Nothing reaches us"], without: ["لا مصدر للورشة", "No workshop source"], isNew: false },
  { n: 34, id: "mfg_ask", unit: "mfg", stage: "check", dir: "out", key: "proc:MK:<mr_id>:<line_no>", title: ["«اسأل الورشة»: إحالة مادة للتصنيع", "“Ask the workshop”: refer a material"], carries: ["المادة · الكمية · الموعد · سعر الشراء المرجعي", "material · qty · date · reference price"], late: ["لا يُفتح أمر تشغيل", "No work order opens"], without: ["لا «اسأل الورشة»", "No “Ask the workshop”"], isNew: false },
  { n: 35, id: "mfg_reply", unit: "mfg", stage: "check", dir: "in", key: "mfg:MK:<mr_id>:<line_no>:V<n>", title: ["ردّ «نصنّع أم نشتري»", "“Make or buy” reply"], carries: ["يصنّع كلياً/جزئياً برقم أمر التشغيل · أو يُشترى بسبب", "make all/part with a WO number · or buy, with reason"], late: ["تفشل مفتوحةً: بعد يوم يعود القرار إلينا", "Fails open: after a day the decision returns to us"], without: ["—", "—"], isNew: false },
  { n: 36, id: "mfg_status", unit: "mfg", stage: "rfq", dir: "out", key: "proc:ST:<prq_id>:<line_no>:V<n>", title: ["حالة المادة تعود إلى أمر التشغيل", "Material status back to the work order"], carries: ["في عروض · في أمر · وصلت", "in RFQ · in PO · arrived"], late: ["الورشة لا تعرف موعد بدء القسم", "The workshop can’t plan the department"], without: ["—", "—"], isNew: true },
]

export const EIGHT_RULES: readonly Bilingual[] = [
  ["الباقة الأساسية (المشتريات + المخزون) تعمل وحدها كاملة، وكل موصل يُضاف عند مراحل محددة ولا يغيّر غيرها.", "The base package (Procurement + Inventory) works fully alone; each connector plugs in at defined stages and changes nothing else."],
  ["المفتاح في الخادم: اشتراك المقاول يحمل sub.pm و sub.fin و sub.mfg، والخادم يرسل الأحداث أو يوقفها، والواجهة تقرأ المفتاح نفسه — لا إخفاء بالواجهة وحدها.", "The switch lives on the server: the subscription carries sub.pm, sub.fin and sub.mfg; the server sends or stops events, and the UI reads the same switch — never hiding in the UI alone."],
  ["لكل موصل بديل في الأساس حين يغيب، مكتوب في عمود «لو لم يكن في الاشتراك» — فلا تنكسر شاشة.", "Each connector has a core fallback, written in the “if not subscribed” column — so no screen breaks."],
  ["كل حدث بمفتاح تفرّد، ويُسجَّل في EVT؛ وإعادة الإرسال لا تكرّر الأثر.", "Every event has a unique key and is logged in EVT; resending never duplicates the effect."],
  ["كل انتظار لوحدة أخرى له مهلة ويفشل مفتوحاً: ردّ المخزون والورشة يوم واحد ثم نمضي.", "Every wait on another module has a window and fails open: Inventory and workshop replies get one day, then we proceed."],
  ["الوحدة لا تنفّذ فعلاً لوحدة أخرى: تطلب وتقرأ الحالة.", "A module never performs another module’s action: it requests and reads the status."],
  ["فتح موصل لمقاول قائم لا يعيد كتابة بياناته: القديم يكمل بمصدره، والجديد يصل من الموصل. وإغلاقه يترك ما في الطريق يكمل بحالته.", "Opening a connector for an existing contractor rewrites nothing: old items continue with their source; new ones come from the connector. Closing lets in-flight items finish as they are."],
  ["إعدادات العميل تعرض اشتراكه قراءةً فقط؛ يُضبط من بوابة الإدارة وحدها.", "Customer settings show the subscription read-only; only the admin portal changes it."],
]

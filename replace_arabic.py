import re
file_path = r'd:\studio-monaqasati\src\app\[locale]\(supplier)\supplier\profile\page.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

replacements = {
    '"تم الحفظ"': 't("save_success")',
    '"تم الحفظ بنجاح، يرجى تعبئة الحقول الإلزامية (*) لتفعيل حسابك بالكامل"': 't("save_success_incomplete")',
    '"تم تحديث بيانات الملف الشخصي بنجاح."': 't("save_success_complete")',
    '"تنبيه"': 't("verification_notice")',
    '"لقد قمت بالطلب مسبقاً أو أنك موثق بالفعل"': 't("verification_notice_desc")',
    '"بيانات ناقصة"': 't("incomplete_data")',
    '"يجب رفع السجل التجاري وشهادة ضريبة القيمة المضافة مع تواريخ الانتهاء للتوثيق"': 't("incomplete_data_desc")',
    '"تم إرسال الطلب"': 't("verification_requested")',
    '"سيتم مراجعة وثائقك من قبل الإدارة"': 't("verification_requested_desc")',
    '"وصف مفقود"': 't("missing_description")',
    '"يرجى كتابة وصف عملك ليتمكن الذكاء الاصطناعي من اقتراح التخصصات."': 't("missing_description_desc")',
    '"اقتراحات ناجحة"': 't("ai_success")',
    '"تم تحديث تخصصاتك بناءً على وصف العمل الخاص بك وحفظها."': 't("ai_success_desc")',
    '"فشل الحصول على اقتراحات من الذكاء الاصطناعي."': 't("ai_failed_desc")',
    '"يرجى تعبئة الحقول المطلوبة"': 't("required_fields")',
    '"تمت إضافة الشهادة وحفظها بنجاح"': 't("cert_added_desc")',
    '"تم الرفع"': 't("cert_uploaded")',
    '"تم إرفاق مستند الشهادة بنجاح"': 't("cert_uploaded_desc")',
    '"فشل رفع الملف"': 't("cert_upload_failed")',
    '"تم الحذف"': 't("cert_deleted")',
    '"تم حذف الشهادة وحفظ التغييرات"': 't("cert_deleted_desc")',
    '"يرجى كتابة اسم المشروع"': 't("project_required")',
    '"تمت إضافة المشروع وحفظه بنجاح"': 't("project_added_desc")',
    '"فشل رفع الصورة"': 't("image_upload_failed")',
    '"تم حذف المشروع وحفظ التغييرات"': 't("project_deleted_desc")',
    '"تم رفع الملف وحفظه بنجاح."': 't("file_saved_desc")',
    '"تم حذف الملف وحفظ التغييرات"': 't("file_deleted_desc")',
    '"جاري الرفع..."': 't("legal_uploading")',
    '"يتم رفع المستند الآن"': 't("legal_uploading_desc")',
    '"تم تحديث المستند وحفظه بنجاح"': 't("legal_updated_desc")',
    '"فشل رفع المستند القانوني"': 't("legal_upload_failed")',
    '"خطأ"': 't("save_error")',
}

# Apply all exact replacements inside toasts
for old, new in replacements.items():
    content = content.replace(f'title: {old}', f'title: {new}')
    content = content.replace(f'description: {old}', f'description: {new}')
    content = content.replace(f'title: {old}', f'title: {new}')

# Wait, the Security Tab has JSX strings:
content = content.replace('>حالة تفعيل البريد الإلكتروني<', '>{t("email_verification")}<')
content = content.replace('>مفعل ونشط<', '>{t("verified_active")}<')
content = content.replace('>غير مفعل<', '>{t("not_verified_label")}<')
content = content.replace('>إرسال رابط تفعيل جديد<', '>{t("send_verification")}<')
content = content.replace('>التحقق بخطوتين (2-Step Verification)<', '>{t("two_step")}<')
content = content.replace('>تغيير كلمة المرور<', '>{t("change_password")}<')
content = content.replace('>جوال SMS<', '>{t("sms_badge")}<')
content = content.replace('"رقم جوال مطلوب"', 't("phone_required_title")')
content = content.replace('"يرجى إضافة رقم جوال معتمد وحفظه في البيانات الأساسية أولاً لتتمكن من تفعيل ميزة التحقق بخطوتين."', 't("phone_required_desc")')
content = content.replace('"تم إرسال رابط التفعيل"', 't("verification_link_sent")')
content = content.replace('"تم إرسال رابط التفعيل إلى بريدك الإلكتروني بنجاح. يرجى مراجعة البريد الوارد."', 't("verification_link_sent_desc")')
content = content.replace('"فشل إرسال الرابط"', 't("verification_link_failed")')

# The long paragraphs
content = content.replace('>قم بتحديث كلمة المرور الخاصة بحسابك بشكل دوري لضمان أمان حسابك.<', '>{t("change_password_desc")}<')

# regex replace for the long 2-step description
content = re.sub(r'عند تفعيل هذه الميزة، سيطلب منك النظام.*?لتأمين حسابك\.', r'{t("two_step_desc", { phone: profile.phone || t("phone_required") })}', content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Replaced Arabic strings in page.tsx")

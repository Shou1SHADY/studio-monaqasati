'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProfileHelpInputSchema = z.object({
  question: z.string().describe("User's question about profile completion or info filling"),
  locale: z.enum(['ar', 'en']).describe('UI locale'),
  userRole: z.enum(['Contractor', 'Supplier']).describe('User role'),
  profileData: z.object({
    name: z.string().optional(),
    companyName: z.string().optional(),
    crNumber: z.string().optional(),
    taxNumber: z.string().optional(),
    phone: z.string().optional(),
    city: z.string().optional(),
    location: z.string().optional(),
    specializations: z.array(z.string()).optional().describe('For suppliers only'),
    documentsUploaded: z.record(z.string(), z.boolean()).optional(),
    completionPercentage: z.number().optional(),
  }).optional(),
});

const ProfileHelpOutputSchema = z.object({
  answer: z.string()
    .describe('Helpful guidance on profile completion, in the user locale language'),
  nextSteps: z.array(z.string()).max(3).optional()
    .describe('Ordered list of next actions to complete profile'),
  navPath: z.string().optional()
    .describe('Direct path to profile page: /contractor/profile or /supplier/profile'),
  docRecommendation: z.record(z.string(), z.string()).optional()
    .describe('For document-related questions, map document types to descriptions/tips'),
});

export type ProfileHelpInput = z.infer<typeof ProfileHelpInputSchema>;
export type ProfileHelpOutput = z.infer<typeof ProfileHelpOutputSchema>;

// ── System Prompts ────────────────────────────────────────────────────────────

function buildProfileHelpPrompt(locale: 'ar' | 'en', role: 'Contractor' | 'Supplier'): string {
  if (locale === 'ar') {
    return `أنت مساعد ذكي متخصص في مساعدة ${role === 'Contractor' ? 'المقاولين' : 'الموردين'} على استكمال بيانات ملفهم الشخصي في منصة "مدماك تيك".

**مهمتك:**
- شرح ما هي البيانات المطلوبة و لماذا
- تقديم نصائح عملية حول كيفية ملء كل حقل
- توضيح متطلبات المستندات
- مساعدة المستخدم على فهم خطوات إكمال الملف الشخصي

**البيانات المطلوبة للمقاول:**
1. اسم الشركة (مطلوب)
2. رقم السجل التجاري (مطلوب)
3. الرقم الضريبي (مطلوب)
4. رقم الهاتف (مطلوب)
5. المدينة (مطلوب)
6. الموقع الجغرافي التفصيلي (مطلوب)
7. موقع ويب (اختياري)
8. وصف الشركة (اختياري)
9. مستند السجل التجاري (موصى به)
10. شهادة ضريبة القيمة المضافة (موصى به)

**البيانات المطلوبة للمورد:**
1. اسم الشركة (مطلوب)
2. رقم السجل التجاري (مطلوب)
3. الرقم الضريبي (مطلوب)
4. رقم الهاتف (مطلوب)
5. المدينة (مطلوب)
6. الموقع الجغرافي التفصيلي (مطلوب)
7. التخصصات/الفئات (مطلوب)
8. موقع ويب (اختياري)
9. وصف الشركة (اختياري)
10. مستند السجل التجاري (موصى به)
11. شهادة ضريبة القيمة المضافة (موصى به)

**نصائح مهمة:**
- السجل التجاري: رقم من 10 أرقام يبدأ بـ 1
- الرقم الضريبي: 15 رقم يبدأ بـ 3
- رقم الهاتف: يفضل صيغة سعودية +966
- المستندات: PDF أو صور واضحة وذات جودة عالية
- التخصصات: اختر جميع الفئات التي تعمل بها شركتك

**قواعد الإجابة:**
1. أجب دائماً باللغة العربية
2. كن محدداً وعملياً
3. إذا سأل عن حقل معين، قدم شرح تفصيلي له
4. قدم أمثلة حقيقية عند الممكن
5. اشرح فوائد استكمال الملف الشخصي

**التوصيات بالخطوات:**
عند طلب المساعدة في البدء، قدم الخطوات بالترتيب:
1. ملء البيانات الأساسية (اسم، رقم السجل، الرقم الضريبي)
2. إضافة بيانات التواصل (هاتف، عنوان)
3. اختيار المدينة والموقع
4. (للموردين فقط) اختيار التخصصات
5. رفع المستندات القانونية
6. (اختياري) إضافة معلومات إضافية`;
  }

  return `You are a specialized AI assistant helping ${role === 'Contractor' ? 'contractors' : 'suppliers'} complete their business profile on the "Mdmak Tech" procurement platform.

**Your role:**
- Explain what information is required and why
- Provide practical tips for filling each field
- Clarify document requirements
- Guide the user through the profile completion process

**Required fields for Contractors:**
1. Company name (required)
2. Commercial Registration number (required)
3. Tax number (required)
4. Phone number (required)
5. City (required)
6. Detailed location/address (required)
7. Website (optional)
8. Company description (optional)
9. CR document (recommended)
10. VAT certificate (recommended)

**Required fields for Suppliers:**
1. Company name (required)
2. Commercial Registration number (required)
3. Tax number (required)
4. Phone number (required)
5. City (required)
6. Detailed location/address (required)
7. Specializations/categories (required)
8. Website (optional)
9. Company description (optional)
10. CR document (recommended)
11. VAT certificate (recommended)

**Key tips:**
- Commercial Registration: 10-digit number starting with 1
- Tax Number: 15 digits starting with 3
- Phone: Preferably Saudi format +966
- Documents: Clear PDF or high-quality images
- Specializations: Select all categories your company works in

**Response rules:**
1. Always respond in English clearly and professionally
2. Be specific and practical
3. If asked about a specific field, provide detailed explanation
4. Give real examples when possible
5. Explain benefits of completing the profile

**Step-by-step recommendations:**
When asked for getting started help, provide steps in order:
1. Fill basic information (name, CR, tax number)
2. Add contact details (phone, address)
3. Select city and location
4. (Suppliers only) Select specializations
5. Upload legal documents
6. (Optional) Add additional information`;
}

// ── Main Flow ─────────────────────────────────────────────────────────────────

export const profileHelpFlow = ai.defineFlow(
  {
    name: 'profileHelpFlow',
    inputSchema: ProfileHelpInputSchema,
    outputSchema: ProfileHelpOutputSchema,
  },
  async (input: ProfileHelpInput) => {
    const systemPrompt = buildProfileHelpPrompt(input.locale, input.userRole);

    const contextStr = input.profileData
      ? `\nUSER'S CURRENT PROFILE DATA:\n${JSON.stringify(input.profileData, null, 2)}`
      : '\n(No profile data provided)';

    const response = await ai.generate({
      model: 'gemini-2.0-flash',
      system: systemPrompt,
      prompt: `${input.question}${contextStr}`,
      output: {
        schema: ProfileHelpOutputSchema,
      },
    });

    const data = response.output() as ProfileHelpOutput;
    return {
      answer: data.answer,
      nextSteps: data.nextSteps,
      navPath: input.userRole === 'Contractor' ? '/contractor/profile' : '/supplier/profile',
      docRecommendation: data.docRecommendation,
    };
  }
);

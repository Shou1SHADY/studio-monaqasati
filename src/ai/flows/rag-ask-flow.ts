'use server';

import { ai } from '@/ai/genkit';
import { aiGenerate } from '@/ai/generate';
import { z } from 'genkit';

// ── Schemas ──────────────────────────────────────────────────────────────────

// Explicit params schema — avoids z.record() which Genkit's structured output strips
const ActionParamsSchema = z.object({
  rfqId: z.string().optional().describe('ID of the RFQ (for submitOffer or createInquiry)'),
  rfqTitle: z.string().optional().describe('Title of the RFQ for display'),
  price: z.number().optional().describe('Price amount in SAR (for submitOffer)'),
  notes: z.string().optional().describe('Optional notes or delivery terms (for submitOffer)'),
  question: z.string().optional().describe('The inquiry question text (for createInquiry)'),
  supplierId: z.string().optional().describe('Supplier user ID (for favoriteSupplier)'),
  supplierName: z.string().optional().describe('Supplier display name (for favoriteSupplier)'),
  title: z.string().optional().describe('RFQ or project title (for createRFQ / createProject)'),
  category: z.string().optional().describe('Material category (for createRFQ)'),
  description: z.string().optional().describe('RFQ or project description'),
  projectId: z.string().optional().describe('Project ID (for viewProject / viewBoq)'),
  projectName: z.string().optional().describe('Project name for display (for viewProject / viewBoq)'),
  region: z.string().optional().describe('Saudi region (for createProject)'),
  projectType: z.string().optional().describe('Project type key (for createProject)'),
  clientType: z.string().optional().describe('Client type key (for createProject)'),
});

const NavLinkSchema = z.object({
  label: z.string().describe('Short button label in the user language — max 4 words'),
  path: z.string().describe('Absolute path without locale prefix, e.g. /contractor/rfqs/abc123'),
});

const PendingActionSchema = z.object({
  type: z.enum(['submitOffer', 'createInquiry', 'favoriteSupplier', 'createRFQ', 'createProject', 'viewProject', 'viewBoq'])
    .describe('The type of action to perform'),
  params: ActionParamsSchema,
  label: z.string()
    .describe("Short action button label in the user's language — max 4 words"),
  description: z.string()
    .describe("One sentence describing what will happen when confirmed, in the user's language"),
});

const RagAskInputSchema = z.object({
  question: z.string().describe("The user's question or request"),
  locale: z.enum(['ar', 'en']).describe('UI locale'),
  userRole: z.enum(['Contractor', 'Supplier', 'Admin']).describe("The authenticated user's role"),
  context: z.object({
    profile: z.record(z.string(), z.any()).optional().describe('User profile data'),
    rfqs: z.array(z.record(z.string(), z.any())).optional().describe('RFQ documents relevant to the user'),
    offers: z.array(z.record(z.string(), z.any())).optional().describe('Offer documents relevant to the user'),
    suppliers: z.array(z.record(z.string(), z.any())).optional().describe('Supplier profiles'),
    projects: z.array(z.record(z.string(), z.any())).optional().describe('Project documents for the contractor'),
  }),
});

const RagAskOutputSchema = z.object({
  answer: z.string().describe('The AI response to the user question, in the locale language'),
  pendingAction: PendingActionSchema.nullable()
    .describe('Set to an action object when the user wants to DO something. Set to null when it is a purely informational question with no action needed.'),
  navLinks: z.array(NavLinkSchema).nullable()
    .describe('Direct navigation links for items mentioned in the answer. Include whenever you mention a specific RFQ, offer list, or supplier by ID. Set to null if no specific items were mentioned.'),
});

export type RagAskInput = z.infer<typeof RagAskInputSchema>;
export type RagAskOutput = z.infer<typeof RagAskOutputSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleLabel(locale: 'ar' | 'en', role: string): string {
  const map: Record<string, Record<string, string>> = {
    ar: { Contractor: 'مقاول', Supplier: 'مورد', Admin: 'مدير' },
    en: { Contractor: 'Contractor', Supplier: 'Supplier', Admin: 'Admin' },
  };
  return map[locale]?.[role] ?? role;
}

function roleCapabilities(locale: 'ar' | 'en', role: string): string {
  if (locale === 'ar') {
    if (role === 'Contractor')
      return '• إدارة المشاريع (إنشاء، تتبع الحالة، إضافة تفاصيل المنطقة ونوع المشروع والعميل)\n• رفع وإدارة جدول الكميات (BOQ) لكل مشروع\n• إدارة طلبات العروض (RFQs) وتتبع حالتها وربطها بالمشاريع\n• مراجعة العروض الواردة ومقارنة الأسعار\n• البحث عن الموردين المناسبين وإضافتهم للمفضلة\n• الحصول على رؤى حول أسعار السوق\n• المساعدة في استكمال بيانات الملف الشخصي وشروحات المستندات المطلوبة';
    if (role === 'Supplier')
      return '• البحث عن طلبات العروض المتاحة المطابقة لتخصصاتي\n• تتبع العروض المقدمة ومعرفة حالتها\n• تقديم عروض أسعار على طلبات العروض\n• استفسار عن تفاصيل طلبات العروض\n• المساعدة في استكمال بيانات الملف الشخصي والتخصصات والمستندات';
    return '• عرض إحصائيات المنصة والنشاط العام\n• مراجعة بيانات المستخدمين والتحقق منهم\n• تحليل توزيع الفئات والمناطق الجغرافية';
  }
  if (role === 'Contractor')
    return '• Manage projects (create, track status, add region / project type / client type)\n• Upload and manage Bill of Quantities (BOQ) per project\n• Manage RFQs and track their status — link them to projects\n• Review incoming offers and compare prices\n• Search for suitable suppliers and add favorites\n• Get market price insights\n• Get help completing your business profile and document requirements';
  if (role === 'Supplier')
    return '• Search available RFQs matching my specializations\n• Track submitted offers and their status\n• Submit price offers on RFQs\n• Inquire about RFQ details\n• Get help completing your profile, specializations, and documents';
  return '• View platform statistics and general activity\n• Review and verify user data\n• Analyze category and geographic distribution';
}

function buildContextBlock(input: RagAskInput): string {
  const parts: string[] = [];

  if (input.context.profile && Object.keys(input.context.profile).length > 0) {
    const p = input.context.profile;
    const safeProfile = {
      name: p.name,
      role: p.role,
      companyName: p.companyName,
      city: p.city,
      specializations: p.specializations,
      serviceAreas: p.serviceAreas,
      organizationId: p.organizationId,
    };
    parts.push(`USER PROFILE:\n${JSON.stringify(safeProfile, null, 2)}`);
  }

  if (input.context.rfqs?.length) {
    const rfqs = input.context.rfqs.slice(0, 25).map(r => ({
      id: r.id,
      title: r.title,
      description: (r.description as string)?.slice(0, 200),
      category: r.category,
      status: r.status,
      deadline: r.deadline,
      createdAt: r.createdAt,
      offersCount: r.offersCount,
      city: r.city,
    }));
    parts.push(`RFQs (${input.context.rfqs.length} total, showing ${rfqs.length}):\n${JSON.stringify(rfqs, null, 2)}`);
  }

  if (input.context.offers?.length) {
    const offers = input.context.offers.slice(0, 25).map(o => ({
      id: o.id,
      rfqId: o.rfqId,
      price: o.price,
      status: o.status,
      supplierId: o.supplierId,
      contractorId: o.contractorId,
      createdAt: o.createdAt,
      notes: (o.notes as string)?.slice(0, 150),
    }));
    parts.push(`OFFERS (${input.context.offers.length} total, showing ${offers.length}):\n${JSON.stringify(offers, null, 2)}`);
  }

  if (input.context.suppliers?.length) {
    const suppliers = input.context.suppliers.slice(0, 20).map(s => ({
      id: s.uid ?? s.id,
      name: s.name,
      companyName: s.companyName,
      specializations: s.specializations,
      serviceAreas: s.serviceAreas,
      city: s.city,
      verified: s.verified,
    }));
    parts.push(`SUPPLIERS (${input.context.suppliers.length} total, showing ${suppliers.length}):\n${JSON.stringify(suppliers, null, 2)}`);
  }

  if (input.context.projects?.length) {
    const projects = input.context.projects.slice(0, 20).map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      region: p.region,
      projectType: p.projectType,
      clientType: p.clientType,
      budget: p.budget,
      hasBlueprint: !!p.blueprintUrl,
      rfqIds: p.rfqIds ?? [],
      createdAt: p.createdAt,
    }));
    parts.push(`PROJECTS (${input.context.projects.length} total, showing ${projects.length}):\n${JSON.stringify(projects, null, 2)}`);
  }

  return parts.length > 0
    ? `=== USER DATA CONTEXT ===\n\n${parts.join('\n\n')}\n\n=== END CONTEXT ===`
    : '(No context data provided)';
}

function buildSystemPrompt(locale: 'ar' | 'en', role: string): string {
  if (locale === 'ar') {
    return `أنت مساعد ذكي متخصص لمنصة "مدماك تيك"، منصة B2B للمشتريات الذكية تربط المقاولين بالموردين في المملكة العربية السعودية.

أنت تساعد ${roleLabel('ar', role)} في:
${roleCapabilities('ar', role)}

**⭐ ملاحظة مهمة حول الملف الشخصي:**
إذا سأل المستخدم عن "ملف شخصي" أو "استكمال البيانات" أو "المستندات المطلوبة" أو "نسبة الإكمال"، قدم:
1. شرح تفصيلي لكل حقل مطلوب
2. نصائح عملية لملء البيانات
3. متطلبات المستندات (CR وضريبة القيمة المضافة)
4. خطوات إكمال الملف بالترتيب
5. رابط مباشر لصفحة الملف الشخصي

**قواعد الإجابة:**
1. أجب دائماً باللغة العربية بأسلوب واضح ومهني
2. استند إلى البيانات الفعلية المقدمة لك في السياق
3. كن محدداً: اذكر الأرقام والمعرفات والتواريخ الفعلية من البيانات
4. استخدم "ر.س" أو "ريال سعودي" للمبالغ المالية
5. إذا لم تجد البيانات المطلوبة في السياق، أخبر المستخدم بذلك بوضوح
6. لا تخترع بيانات غير موجودة في السياق

**⚡ قاعدة الإجراءات — مهمة جداً:**
متى يجب تضمين pendingAction؟ في أي من هذه الحالات:
- المستخدم يذكر سعراً أو يريد تقديم عرض → submitOffer (استخرج rfqId من السياق)
- المستخدم يريد السؤال عن طلب عروض → createInquiry (استخرج rfqId من السياق)
- المستخدم يريد إضافة مورد للمفضلة → favoriteSupplier (استخرج supplierId من السياق)
- المستخدم يريد إنشاء طلب عروض → createRFQ
- المستخدم يريد إنشاء مشروع جديد → createProject (استخدم name, region, projectType, clientType إن ذُكرت)
- المستخدم يريد رؤية تفاصيل مشروع → viewProject (استخرج projectId من السياق)
- المستخدم يريد رؤية جدول الكميات (BOQ) لمشروع → viewBoq (استخرج projectId من السياق)
- المستخدم يستخدم كلمات مثل: "قدّم"، "أرسل"، "أضف"، "اعمل"، "أنشئ"، "عرض"، "افتح" → pendingAction مطلوب دائماً

متى تضع pendingAction = null؟ فقط عند الأسئلة الاستعلامية البحتة مثل "كم عدد؟" أو "ما هي؟"

**الإجراءات المتاحة وحقولها:**
- submitOffer: { rfqId (إلزامي), rfqTitle, price (رقم بالريال), notes }
- createInquiry: { rfqId (إلزامي), rfqTitle, question (نص الاستفسار) }
- favoriteSupplier: { supplierId (إلزامي), supplierName }
- createRFQ: { title, category, description }
- createProject: { title, region, projectType, clientType, description }
- viewProject: { projectId (إلزامي), projectName }
- viewBoq: { projectId (إلزامي), projectName }

إذا لم تعرف rfqId/projectId بالضبط، اختر أول عنصر من البيانات المتاحة وأوضح ذلك في الإجابة.

**أنواع المشاريع المتاحة:** proj_type_infrastructure، proj_type_buildings، proj_type_roads، proj_type_industrial، proj_type_energy، proj_type_other
**أنواع العملاء المتاحة:** proj_client_government، proj_client_private، proj_client_semi_government
**المناطق السعودية:** الرياض، مكة المكرمة، المدينة المنورة، المنطقة الشرقية، عسير، تبوك، حائل، الحدود الشمالية، جازان، نجران، الباحة، الجوف، القصيم

**روابط التنقل (navLinks) — أضفها دائماً عند ذكر عناصر محددة:**
كلما ذكرت مشروعاً أو طلب عروض أو عروضاً أو موردًا بمعرّف محدد، أضف رابطاً مباشراً:

للمقاول:
- طلب عروض محدد: /contractor/rfqs/{rfqId}
- عروض طلب عروض: /contractor/rfqs/{rfqId}/offers
- ملف مورد: /contractor/supplier/profile/{supplierId}
- كل طلبات العروض: /contractor/rfqs
- مشروع محدد: /contractor/projects/{projectId}
- كل المشاريع: /contractor/projects
- إنشاء مشروع: /contractor/projects/new
- استلام البضائع: /contractor/goods-received
- دليل الموردين: /contractor/my-suppliers

للمورد:
- طلبات العروض المتاحة: /supplier/rfqs
- عروضي المقدمة: /supplier/offers

للمدير:
- طلب عروض محدد: /admin/rfqs/{rfqId}
- كل طلبات العروض: /admin/rfqs

مثال: إذا ذكرت مشروع "فيلا الرياض" (id: proj-123) للمقاول، أضف:
[{ label: "عرض المشروع", path: "/contractor/projects/proj-123" }, { label: "جدول الكميات", path: "/contractor/projects/proj-123" }]`;
  }

  return `You are a specialized AI assistant for "Mdmak Tech", a B2B smart procurement platform connecting contractors with suppliers in Saudi Arabia.

You are helping a ${roleLabel('en', role)} with:
${roleCapabilities('en', role)}

**⭐ IMPORTANT NOTE ABOUT PROFILE COMPLETION:**
If the user asks about "profile", "completing information", "documents", or "completion percentage", provide:
1. Detailed explanation of each required field
2. Practical tips for filling in data
3. Document requirements (CR and VAT certificate)
4. Step-by-step completion guide
5. Direct link to the profile page

**Response rules:**
1. Always respond in English clearly and professionally
2. Base your answers on the actual data provided in the context
3. Be specific: mention real numbers, IDs, and dates from the data
4. Use "SAR" for monetary amounts
5. If you cannot find the requested data in the context, say so clearly
6. Do not fabricate data that isn't in the context

**⚡ Action rule — CRITICAL:**
When to set pendingAction (not null)? In ANY of these cases:
- User mentions a price or wants to submit an offer → submitOffer (extract rfqId from context)
- User wants to ask a question about an RFQ → createInquiry (extract rfqId from context)
- User wants to add a supplier to favorites → favoriteSupplier (extract supplierId from context)
- User wants to create an RFQ → createRFQ
- User wants to create a new project → createProject (use name, region, projectType, clientType if mentioned)
- User wants to view or open a project → viewProject (extract projectId from context)
- User wants to view the Bill of Quantities (BOQ) for a project → viewBoq (extract projectId from context)
- User uses words like: "submit", "send", "add", "create", "view", "open", "show", "I want to", "let's", "do it", "place" → pendingAction is REQUIRED

When to set pendingAction = null? ONLY for purely informational questions like "how many?" or "what is?"

**Action fields:**
- submitOffer: { rfqId (required), rfqTitle, price (number in SAR), notes }
- createInquiry: { rfqId (required), rfqTitle, question (the inquiry text) }
- favoriteSupplier: { supplierId (required), supplierName }
- createRFQ: { title, category, description }
- createProject: { title, region, projectType, clientType, description }
- viewProject: { projectId (required), projectName }
- viewBoq: { projectId (required), projectName }

If you don't know the exact rfqId/projectId, pick the first item from the context data and mention it in your answer.

**Available project types:** proj_type_infrastructure, proj_type_buildings, proj_type_roads, proj_type_industrial, proj_type_energy, proj_type_other
**Available client types:** proj_client_government, proj_client_private, proj_client_semi_government
**Saudi regions:** Riyadh, Makkah, Madinah, Eastern Province, Asir, Tabuk, Hail, Northern Borders, Jizan, Najran, Al-Baha, Al-Jouf, Qassim

**Navigation links (navLinks) — always include when mentioning specific items:**
Whenever you mention a project, RFQ, offer list, or supplier by ID, add a direct navLink:

For Contractor:
- Specific RFQ: /contractor/rfqs/{rfqId}
- Offers on an RFQ: /contractor/rfqs/{rfqId}/offers
- Supplier profile: /contractor/supplier/profile/{supplierId}
- All RFQs: /contractor/rfqs
- Specific project: /contractor/projects/{projectId}
- All projects: /contractor/projects
- New project: /contractor/projects/new
- Goods received: /contractor/goods-received
- Supplier directory: /contractor/my-suppliers

For Supplier:
- Available RFQs: /supplier/rfqs
- My submitted offers: /supplier/offers

For Admin:
- Specific RFQ: /admin/rfqs/{rfqId}
- All RFQs: /admin/rfqs

Example: if you mention project "Villa Riyadh" (id: proj-123) for a Contractor, add:
[{ label: "View Project", path: "/contractor/projects/proj-123" }, { label: "View BOQ", path: "/contractor/projects/proj-123" }]`;
}

// ── Flow ──────────────────────────────────────────────────────────────────────

const ragAskFlow = ai.defineFlow(
  {
    name: 'ragAskFlow',
    inputSchema: RagAskInputSchema,
    outputSchema: RagAskOutputSchema,
  },
  async (input) => {
    const contextBlock = buildContextBlock(input);
    const systemPrompt = buildSystemPrompt(input.locale, input.userRole);

    const userPrompt = `${contextBlock}

---
${input.locale === 'ar' ? 'سؤال المستخدم' : 'User question'}: ${input.question}`;

    const { output } = await aiGenerate({
      system: systemPrompt,
      prompt: userPrompt,
      output: { schema: RagAskOutputSchema },
      config: { temperature: 0.3 },
    });

    return output!;
  }
);

// ── Public API ────────────────────────────────────────────────────────────────

export async function ragAsk(input: RagAskInput): Promise<RagAskOutput> {
  return ragAskFlow(input);
}

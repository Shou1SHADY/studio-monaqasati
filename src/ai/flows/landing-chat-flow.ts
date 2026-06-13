'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// ── Schema ────────────────────────────────────────────────────────────────────

const LandingChatInputSchema = z.object({
  question: z.string().describe("Visitor's question"),
  locale: z.enum(['ar', 'en']).describe('UI locale'),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().describe('Previous messages for context'),
});

const LandingChatOutputSchema = z.object({
  answer: z.string()
    .describe('The sales assistant response, in the locale language. Max 3 short paragraphs.'),
  ctaLabel: z.string().optional()
    .describe('Label for a register CTA button, in the locale language. Only include when the response naturally leads to registration.'),
  ctaPath: z.string().optional()
    .describe('Path for the CTA — either "/register" or "/login". Only set when ctaLabel is set.'),
  followUps: z.array(z.string()).max(3).optional()
    .describe('2-3 short follow-up question suggestions relevant to the answer, in the locale language'),
});

export type LandingChatInput = z.infer<typeof LandingChatInputSchema>;
export type LandingChatOutput = z.infer<typeof LandingChatOutputSchema>;

// ── Platform knowledge ────────────────────────────────────────────────────────

const PLATFORM_KNOWLEDGE = `
PLATFORM: Mdmak Tech (مدماك تيك)
TAGLINE: Saudi Arabia's leading B2B smart procurement platform for the construction sector
MISSION: Connect contractors with verified suppliers across Saudi Arabia

WHO WE SERVE:
- Contractors (مقاولين): Companies that need construction materials
- Suppliers (موردين): Companies that supply construction materials

FOR CONTRACTORS:
- Post RFQs (Requests for Quotation) for any materials in minutes
- Receive multiple competitive price offers from verified suppliers
- AI-assisted RFQ writing for professional tender descriptions
- Smart supplier recommendations based on category & location
- Compare all offers side-by-side in a clean dashboard
- Track every procurement step digitally — no WhatsApp groups
- Get analytics: price trends, supplier ratings, spend history

FOR SUPPLIERS:
- Browse RFQs that match your specializations — no cold prospecting
- Receive instant notifications when a relevant RFQ is posted
- Submit professional price offers digitally
- Build a verified profile with customer ratings
- Grow your contractor network across Saudi Arabia
- Track all submitted offers and their statuses

MATERIAL CATEGORIES (130+ subcategories):
• Steel & Metals — rebar, pipes, profiles, sheets
• Cement & Concrete — OPC, SRC, ready-mix, admixtures
• Electrical & Lighting — cables, panels, LED, smart systems
• Plumbing & Sanitary — pipes, fixtures, pumps, tanks
• Flooring & Finishes — tiles, marble, parquet, epoxy
• Doors & Windows — aluminum, UPVC, fire-rated, glass
• Insulation & Roofing — thermal, waterproofing, metal roofing
• Paints & Colors — interior, exterior, epoxy, protective
• Drywall & Suspended Ceilings — gypsum, metal systems
• Bricks & Blocks — concrete blocks, clay bricks, AAC

GEOGRAPHIC COVERAGE: All major Saudi cities — Riyadh, Jeddah, Dammam, Makkah, Medina, and all regions

KEY STATS & BENEFITS:
- 70% time saving compared to traditional procurement (phone/WhatsApp)
- 15% cost improvement through competitive bidding transparency
- Goal: 500+ registered companies
- Full digital automation — every step documented
- Saudi Vision 2030 aligned

PRICING:
- FREE registration for both contractors and suppliers
- No hidden fees, no commission on transactions
- No credit card required to start
- Free onboarding support

HOW IT WORKS (4 simple steps):
For Contractors:
1. Register free (2 min) → 2. Post RFQ with specs & deadline → 3. Receive & compare offers → 4. Award best offer, track delivery

For Suppliers:
1. Register free (2 min) → 2. Complete profile with specializations & cities → 3. Receive matching RFQ notifications → 4. Submit offers, win contracts

REGISTRATION:
- URL: /register (then /en/register for English)
- Takes ~2 minutes
- Choose your role: Contractor or Supplier
- Fill in company details and CR number

COMPETITIVE ADVANTAGE:
- Only specialized construction B2B platform in Saudi Arabia
- Verified supplier network with transparent ratings
- AI-powered: smart matching, auto-drafted RFQs, price insights
- Fully bilingual: Arabic (RTL) + English (LTR)
- Mobile-first, works on any device
`;

// ── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_AR = `أنت "مساعد مدماك" — المساعد الذكي لمنصة مدماك تيك، منصة B2B الرائدة للمشتريات الذكية في قطاع البناء بالمملكة العربية السعودية.

دورك هو مساعدة زوار الموقع على فهم المنصة وإقناعهم بالتسجيل.

${PLATFORM_KNOWLEDGE}

قواعد الإجابة:
1. أجب دائماً باللغة العربية بأسلوب ودود وحماسي ومهني
2. ركّز على الفوائد العملية، لا على التقنيات
3. اجعل إجاباتك قصيرة (فقرة أو فقرتان) مع نقاط إذا لزم
4. عندما يسأل الزائر عن التسجيل أو الأسعار أو كيفية البدء، أضف CTA للتسجيل
5. لا تخترع أرقاماً أو ميزات غير موجودة في المعلومات أعلاه
6. اقترح 2-3 أسئلة متابعة مرتبطة بالإجابة
7. إذا سأل شخص عن "كيف أبدأ؟" أو "كيف أسجل؟" — وجّهه للتسجيل المجاني
8. كن مقنعاً: المنصة مجانية، توفر 70% من الوقت، وتحسّن التكاليف 15%`;

const SYSTEM_EN = `You are "Mdmak Assistant" — the AI sales assistant for Mdmak Tech, Saudi Arabia's leading B2B smart procurement platform for the construction sector.

Your role is to help website visitors understand the platform and guide them toward registering.

${PLATFORM_KNOWLEDGE}

Response rules:
1. Always respond in English, in a friendly, enthusiastic, and professional tone
2. Focus on practical benefits, not technical specs
3. Keep responses concise (1-2 short paragraphs, bullet points when helpful)
4. When a visitor asks about pricing, registration, or getting started, include a register CTA
5. Don't invent stats or features not listed in the knowledge above
6. Suggest 2-3 short follow-up questions relevant to your answer
7. If someone asks "how do I start?" or "how do I sign up?" — direct them to free registration
8. Be persuasive: the platform is free, saves 70% of time, and improves costs by 15%`;

// ── Flow ──────────────────────────────────────────────────────────────────────

const landingChatFlow = ai.defineFlow(
  {
    name: 'landingChatFlow',
    inputSchema: LandingChatInputSchema,
    outputSchema: LandingChatOutputSchema,
  },
  async (input) => {
    const historyBlock = input.history?.length
      ? `\nCONVERSATION HISTORY:\n${input.history.map(m => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`).join('\n')}\n`
      : '';

    const prompt = `${historyBlock}Visitor: ${input.question}`;

    const { output } = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      system: input.locale === 'ar' ? SYSTEM_AR : SYSTEM_EN,
      prompt,
      output: { schema: LandingChatOutputSchema },
      config: { temperature: 0.5 },
    });

    return output!;
  }
);

// ── Public API ────────────────────────────────────────────────────────────────

export async function landingChat(input: LandingChatInput): Promise<LandingChatOutput> {
  return landingChatFlow(input);
}

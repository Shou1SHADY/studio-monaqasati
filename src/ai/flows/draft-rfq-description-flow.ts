'use server';
/**
 * @fileOverview A Genkit flow for generating a comprehensive RFQ title and description
 * based on contractor input.
 *
 * - draftRfqDescription - A function that handles the RFQ title and description generation process.
 * - DraftRfqDescriptionInput - The input type for the draftRfqDescription function.
 * - DraftRfqDescriptionOutput - The return type for the draftRfqDescription function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { getCachedAIResponse, setCachedAIResponse, generatePromptHash } from '@/ai/cache';

const DraftRfqDescriptionInputSchema = z.object({
  keywords: z.string().describe('Keywords or main points for the RFQ. (e.g., مواد بناء للمشروع السكني الجديد)'),
  category: z.string().describe('The category of the required product or service. (e.g., حديد ومعادن)'),
  quantity: z.number().describe('The required quantity of the product.'),
  unit: z.string().describe('The unit of measurement for the quantity. (e.g., طن, متر مربع, عدد)'),
  notes: z.string().optional().describe('Any additional notes or specific requirements for the RFQ. (e.g., جودة عالية مطلوبة)'),
});
export type DraftRfqDescriptionInput = z.infer<typeof DraftRfqDescriptionInputSchema>;

const DraftRfqDescriptionOutputSchema = z.object({
  title: z.string().describe('A suggested comprehensive and professional title for the RFQ in Arabic.'),
  description: z.string().describe('A suggested detailed and comprehensive description for the RFQ in Arabic, suitable for a professional procurement platform.'),
});
export type DraftRfqDescriptionOutput = z.infer<typeof DraftRfqDescriptionOutputSchema>;

export async function draftRfqDescription(input: DraftRfqDescriptionInput): Promise<DraftRfqDescriptionOutput> {
  return draftRfqDescriptionFlow(input);
}

const draftRfqDescriptionPrompt = ai.definePrompt({
  name: 'draftRfqDescriptionPrompt',
  input: {schema: DraftRfqDescriptionInputSchema},
  output: {schema: DraftRfqDescriptionOutputSchema},
  prompt: `أنت مساعد خبير في مجال المشتريات والتعاقدات الإنشائية في اللغة العربية.
مهمتك هي صياغة عنوان ووصف شامل ومفصل لطلب مناقصة (RFQ) بناءً على المعلومات المقدمة.

الهدف هو مساعدة المقاولين على نشر طلباتهم بسرعة ودقة على منصة "مدماك تيك".

الكلمات المفتاحية: {{{keywords}}}
الفئة: {{{category}}}
الكمية: {{{quantity}}}
الوحدة: {{{unit}}}
ملاحظات إضافية: {{{notes}}}

يرجى تقديم عنوان احترافي باللغة العربية ووصف تفصيلي ودقيق للمناقصة، مع الأخذ في الاعتبار أن الوصف يجب أن يكون شاملاً ويغطي جميع الجوانب الأساسية لطلب الشراء، ويساعد الموردين على فهم المتطلبات بوضوح. يجب أن تكون اللغة رسمية ومناسبة لمنصة B2B.
`,
});

const draftRfqDescriptionFlow = ai.defineFlow(
  {
    name: 'draftRfqDescriptionFlow',
    inputSchema: DraftRfqDescriptionInputSchema,
    outputSchema: DraftRfqDescriptionOutputSchema,
  },
  async (input) => {
    // Check cache first
    const promptHash = generatePromptHash(input);
    const cached = getCachedAIResponse(promptHash);
    if (cached) {
      console.log('AI Cache hit for draftRfqDescription');
      return cached;
    }
    
    const {output} = await draftRfqDescriptionPrompt(input);
    if (!output) {
      throw new Error('Failed to generate RFQ description and title.');
    }
    
    // Cache the response
    setCachedAIResponse(promptHash, output);
    return output;
  }
);

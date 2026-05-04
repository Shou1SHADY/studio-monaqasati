'use server';
/**
 * @fileOverview A Genkit flow for recommending relevant RFQs to a supplier.
 *
 * - recommendRfqForSupplier - A function that handles the RFQ recommendation process.
 * - RecommendRfqForSupplierInput - The input type for the recommendRfqForSupplier function.
 * - RecommendRfqForSupplierOutput - The return type for the recommendRfqForSupplier function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { getCachedAIResponse, setCachedAIResponse, generatePromptHash } from '@/ai/cache';

// Input Schema
const RecommendRfqForSupplierInputSchema = z.object({
  supplierSpecializationCategories: z.array(z.string()).describe('List of specialization categories the supplier is registered for, e.g., "حديد ومعادن", "أسمنت وخرسانة".'),
  supplierServiceAreas: z.array(z.string()).describe('List of geographic service areas where the supplier operates, e.g., "الرياض", "جدة".'),
  availableRfqs: z.array(
    z.object({
      id: z.string().describe('Unique identifier of the RFQ.'),
      title: z.string().describe('Title or brief description of the RFQ.'),
      category: z.string().describe('The main category of the RFQ, e.g., "حديد ومعادن".'),
      area: z.string().describe('The geographic area where the RFQ is located, e.g., "الرياض".'),
    })
  ).describe('A list of currently available RFQs, each with an ID, title, category, and area.'),
});
export type RecommendRfqForSupplierInput = z.infer<typeof RecommendRfqForSupplierInputSchema>;

// Output Schema
const RecommendRfqForSupplierOutputSchema = z.object({
  recommendedRfqIds: z.array(z.string()).describe('An array of IDs of the RFQs that match the supplier\'s specializations and service areas.'),
});
export type RecommendRfqForSupplierOutput = z.infer<typeof RecommendRfqForSupplierOutputSchema>;

// Wrapper function to call the flow
export async function recommendRfqForSupplier(input: RecommendRfqForSupplierInput): Promise<RecommendRfqForSupplierOutput> {
  return recommendRfqForSupplierFlow(input);
}

// Prompt definition
const recommendRfqPrompt = ai.definePrompt({
  name: 'recommendRfqPrompt',
  input: { schema: RecommendRfqForSupplierInputSchema },
  output: { schema: RecommendRfqForSupplierOutputSchema },
  prompt: `أنت مساعد ذكي متخصص في مطابقة المناقصات للموردين.\nمهمتك هي مراجعة قائمة المناقصات المتاحة وتحديد المناقصات التي تتطابق بدقة مع تخصصات المورد ومناطق الخدمة الخاصة به.\n\nمعلومات المورد:\nتخصصات المورد: {{{supplierSpecializationCategories}}}\nمناطق خدمة المورد: {{{supplierServiceAreas}}}\n\nقائمة المناقصات المتاحة (بصيغة JSON):\n{{{JSON.stringify availableRfqs}}}\n\nتعليمات المطابقة:\n1.  يجب أن يكون تصنيف المناقصة (category) موجودًا ضمن تخصصات المورد (supplierSpecializationCategories).\n2.  يجب أن تكون منطقة المناقصة (area) موجودة ضمن مناطق خدمة المورد (supplierServiceAreas).\n3.  الرجاء إخراج قائمة بمعرفات المناقصات الموصى بها فقط (recommendedRfqIds) التي تستوفي جميع الشروط.\n`,
});

// Flow definition
const recommendRfqForSupplierFlow = ai.defineFlow(
  {
    name: 'recommendRfqForSupplierFlow',
    inputSchema: RecommendRfqForSupplierInputSchema,
    outputSchema: RecommendRfqForSupplierOutputSchema,
  },
  async (input) => {
    // Check cache first
    const promptHash = generatePromptHash(input);
    const cached = getCachedAIResponse(promptHash);
    if (cached) {
      console.log('AI Cache hit for recommendRfqForSupplier');
      return cached;
    }
    
    const { output } = await recommendRfqPrompt(input);
    if (!output) {
      throw new Error('Failed to get a recommendation from the AI model.');
    }
    
    // Cache the response
    setCachedAIResponse(promptHash, output);
    return output;
  }
);

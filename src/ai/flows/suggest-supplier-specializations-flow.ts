'use server';
/**
 * @fileOverview An AI agent that suggests relevant specialization categories for a supplier based on their business description.
 *
 * - suggestSupplierSpecializations - A function that handles the specialization suggestion process.
 * - SuggestSupplierSpecializationsInput - The input type for the suggestSupplierSpecializations function.
 * - SuggestSupplierSpecializationsOutput - The return type for the suggestSupplierSpecializations function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestSupplierSpecializationsInputSchema = z.object({
  businessDescription: z.string().describe('A free-text description of the supplier\'s business.'),
  predefinedCategories: z.array(z.string()).describe('A list of predefined specialization categories available on the platform.'),
});
export type SuggestSupplierSpecializationsInput = z.infer<typeof SuggestSupplierSpecializationsInputSchema>;

const SuggestSupplierSpecializationsOutputSchema = z.object({
  suggestedCategories: z.array(z.string()).describe('A list of suggested specialization categories from the predefined list that are most relevant to the business description.'),
});
export type SuggestSupplierSpecializationsOutput = z.infer<typeof SuggestSupplierSpecializationsOutputSchema>;

export async function suggestSupplierSpecializations(input: SuggestSupplierSpecializationsInput): Promise<SuggestSupplierSpecializationsOutput> {
  return suggestSupplierSpecializationsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestSupplierSpecializationsPrompt',
  input: {schema: SuggestSupplierSpecializationsInputSchema},
  output: {schema: SuggestSupplierSpecializationsOutputSchema},
  prompt: `أنت خبير في تصنيف الأعمال لمنصة مناقصات البناء. مهمتك هي قراءة وصف العمل المقدم واختيار التصنيفات الأكثر صلة من قائمة التصنيفات المحددة مسبقًا.

وصف العمل: {{{businessDescription}}}

قائمة التصنيفات المحددة مسبقًا:
{{#each predefinedCategories}}- {{{this}}}
{{/each}}

بناءً على وصف العمل، يرجى تقديم قائمة بالتصنيفات الأكثر صلة من القائمة المحددة مسبقًا. يجب أن يكون الإخراج عبارة عن مصفوفة JSON من السلاسل النصية.
`,
});

const suggestSupplierSpecializationsFlow = ai.defineFlow(
  {
    name: 'suggestSupplierSpecializationsFlow',
    inputSchema: SuggestSupplierSpecializationsInputSchema,
    outputSchema: SuggestSupplierSpecializationsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

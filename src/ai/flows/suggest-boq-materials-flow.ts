'use server';
/**
 * @fileOverview Suggests which warehouse materials (and roughly how much of
 * each) would likely be used to fulfill a BOQ line item — handles both a
 * direct match to an existing warehouse item, and a composite/mixed item
 * (e.g. "reinforced concrete works") that draws on several raw materials
 * already stocked in the warehouse.
 *
 * - suggestBoqMaterials - resolves one BOQ line into a materials suggestion.
 * - SuggestBoqMaterialsInput / SuggestBoqMaterialsOutput - I/O types.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { getCachedAIResponse, setCachedAIResponse, generatePromptHash } from '@/ai/cache';

const WarehouseItemSchema = z.object({
  name: z.string(),
  unit: z.string(),
  availableQuantity: z.number(),
});

const SuggestBoqMaterialsInputSchema = z.object({
  boqItemDescription: z.string().describe('The BOQ line item description (Arabic or English).'),
  boqQuantity: z.number().describe('The quantity of the BOQ line item itself.'),
  boqUnit: z.string().describe('The unit of measure for the BOQ line item.'),
  warehouseItems: z.array(WarehouseItemSchema).describe('The materials currently stocked in the linked warehouse, with their unit and available quantity.'),
});
export type SuggestBoqMaterialsInput = z.infer<typeof SuggestBoqMaterialsInputSchema>;

const SuggestedLineSchema = z.object({
  warehouseItemName: z.string().nullable().describe('The exact name of a matching item from the provided warehouse list (copied verbatim), or null if this ingredient is not currently stocked there.'),
  notFoundSuggestedName: z.string().nullable().describe('Only when warehouseItemName is null: a short name describing the needed material, for the user\'s reference.'),
  estimatedQuantity: z.number().describe('Estimated quantity of this material needed to fulfill the given BOQ quantity.'),
  unit: z.string().describe('Unit of measure for estimatedQuantity.'),
  reasoning: z.string().describe('One short sentence explaining this estimate.'),
});

const SuggestBoqMaterialsOutputSchema = z.object({
  matchType: z.enum(['direct', 'composite', 'not_found']).describe(
    'direct = exactly one warehouse item matches this BOQ item as-is. composite = this BOQ item is a mix/assembly built from several materials. not_found = nothing in the warehouse plausibly matches and it is not clearly a composite of stocked items either.'
  ),
  suggestions: z.array(SuggestedLineSchema),
});
export type SuggestBoqMaterialsOutput = z.infer<typeof SuggestBoqMaterialsOutputSchema>;

export async function suggestBoqMaterials(input: SuggestBoqMaterialsInput): Promise<SuggestBoqMaterialsOutput> {
  return suggestBoqMaterialsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestBoqMaterialsPrompt',
  input: {schema: SuggestBoqMaterialsInputSchema},
  output: {schema: SuggestBoqMaterialsOutputSchema},
  prompt: `أنت خبير مقايسات ومواد بناء في السعودية. لديك بند من جدول الكميات، وقائمة المواد المتوفرة حالياً في مستودع المقاول.

بند جدول الكميات: {{{boqItemDescription}}}
الكمية: {{{boqQuantity}}} {{{boqUnit}}}

المواد المتوفرة في المستودع:
{{#each warehouseItems}}- {{{this.name}}} (المتاح: {{{this.availableQuantity}}} {{{this.unit}}})
{{/each}}

مهمتك:
1. إذا طابق البند مادة واحدة من القائمة مباشرة، صنّفه "direct" واقترح تلك المادة بكمية تعادل كمية البند (حوّل الوحدة عند الحاجة).
2. إذا كان البند عملاً مركّباً يستخدم عدة مواد (مثل "أعمال الخرسانة المسلحة" التي تحتاج حديد تسليح وخرسانة جاهزة)، صنّفه "composite" واقترح قائمة المواد التقديرية اللازمة بناءً على معدلات شائعة في صناعة البناء، محسوبة بما يتناسب مع كمية البند، مستخدماً المواد الموجودة في القائمة كلما أمكن.
3. إذا لم توجد أي مادة مطابقة أو قريبة في القائمة إطلاقاً، صنّفه "not_found" واقترح اسم المادة المطلوبة دون ربطها بعنصر من القائمة (اجعل warehouseItemName فارغاً/null).
استخدم فقط الأسماء الموجودة حرفياً في قائمة المستودع أعلاه عند تعبئة warehouseItemName — لا تخترع أسماء غير موجودة فيها.
`,
});

const suggestBoqMaterialsFlow = ai.defineFlow(
  {
    name: 'suggestBoqMaterialsFlow',
    inputSchema: SuggestBoqMaterialsInputSchema,
    outputSchema: SuggestBoqMaterialsOutputSchema,
  },
  async input => {
    const promptHash = generatePromptHash(input);
    const cached = getCachedAIResponse(promptHash);
    if (cached) {
      console.log('AI Cache hit for suggestBoqMaterials');
      return cached;
    }

    const {output} = await prompt(input);

    setCachedAIResponse(promptHash, output!);
    return output!;
  }
);

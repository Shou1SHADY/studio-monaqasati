'use server';
/**
 * @fileOverview An AI agent that suggests a typical waste percentage for a construction
 * material, based on its name and unit of measure — used as a starting point when
 * recording how much material was actually used vs. taken from the warehouse.
 *
 * - suggestWastePercent - A function that handles the waste-percentage suggestion.
 * - SuggestWastePercentInput - The input type for the suggestWastePercent function.
 * - SuggestWastePercentOutput - The return type for the suggestWastePercent function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { getCachedAIResponse, setCachedAIResponse, generatePromptHash } from '@/ai/cache';

const SuggestWastePercentInputSchema = z.object({
  itemName: z.string().describe('The name of the construction material being consumed (e.g. "رخام كرارة", "بلاط بورسلين").'),
  unit: z.string().describe('The unit of measure for the material (e.g. م², طن, لوح).'),
});
export type SuggestWastePercentInput = z.infer<typeof SuggestWastePercentInputSchema>;

const SuggestWastePercentOutputSchema = z.object({
  suggestedWastePercent: z.number().describe('A realistic estimated waste percentage for this material in typical construction use, as a number between 0 and 100.'),
  reasoning: z.string().describe('A one-sentence explanation of why this waste percentage is typical for this material (e.g. cutting waste, breakage, offcuts).'),
});
export type SuggestWastePercentOutput = z.infer<typeof SuggestWastePercentOutputSchema>;

export async function suggestWastePercent(input: SuggestWastePercentInput): Promise<SuggestWastePercentOutput> {
  return suggestWastePercentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestWastePercentPrompt',
  input: {schema: SuggestWastePercentInputSchema},
  output: {schema: SuggestWastePercentOutputSchema},
  prompt: `أنت خبير في تقدير نسب الهدر (الفاقد) لمواد البناء في مواقع التنفيذ بالسعودية.

اسم الصنف: {{{itemName}}}
وحدة القياس: {{{unit}}}

بناءً على خبرتك في هذا النوع من المواد (هدر القص، الكسر، العيوب، القطع المتبقية...)، قدّر نسبة هدر واقعية متوقعة لهذا الصنف كنسبة مئوية بين 0 و100، مع جملة واحدة توضح السبب.
`,
});

const suggestWastePercentFlow = ai.defineFlow(
  {
    name: 'suggestWastePercentFlow',
    inputSchema: SuggestWastePercentInputSchema,
    outputSchema: SuggestWastePercentOutputSchema,
  },
  async input => {
    const promptHash = generatePromptHash(input);
    const cached = getCachedAIResponse(promptHash);
    if (cached) {
      console.log('AI Cache hit for suggestWastePercent');
      return cached;
    }

    const {output} = await prompt(input);

    setCachedAIResponse(promptHash, output!);
    return output!;
  }
);

'use server';
/**
 * @fileOverview A Genkit flow for recommending suppliers to contractors based on RFQ details.
 *
 * - recommendSuppliersForRfq - A function that handles the supplier recommendation process for a given RFQ.
 * - RecommendSuppliersForRfqInput - The input type for the recommendSuppliersForRfq function.
 * - RecommendedSuppliersOutput - The return type for the recommendSuppliersForRfq function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

/**
 * Represents the input required for recommending suppliers for an RFQ.
 */
const RecommendSuppliersForRfqInputSchema = z.object({
  rfqId: z.string().describe('The ID of the RFQ for which to recommend suppliers.'),
  rfqCategory: z.string().describe('The category of the RFQ, e.g., "حديد ومعادن".'),
  rfqArea: z.string().describe('The service area required for the RFQ, e.g., "الرياض".'),
  rfqQualityCertificateRequired: z.boolean().describe('Whether a quality certificate is required for this RFQ.'),
});
export type RecommendSuppliersForRfqInput = z.infer<typeof RecommendSuppliersForRfqInputSchema>;

/**
 * Represents the structure of supplier data required by the prompt.
 */
const SupplierForPromptSchema = z.object({
  id: z.string().describe('The unique ID of the supplier.'),
  name: z.string().describe('The name of the supplier.'),
  specializationCategories: z.array(z.string()).describe('List of categories the supplier specializes in.'),
  serviceAreas: z.array(z.string()).describe('List of service areas the supplier covers.'),
  verified: z.boolean().describe('Whether the supplier is verified on the platform.'),
});

/**
 * Represents the combined input for the Genkit prompt, including RFQ details and all available suppliers.
 */
const PromptInputSchema = z.object({
  rfqCategory: z.string().describe('The category of the RFQ, e.g., "حديد ومعادن".'),
  rfqArea: z.string().describe('The service area required for the RFQ, e.g., "الرياض".'),
  rfqQualityCertificateRequired: z.boolean().describe('Whether a quality certificate is required for this RFQ.'),
  allSuppliers: z.array(SupplierForPromptSchema).describe('A list of all available suppliers with their relevant details.'),
});

/**
 * Represents the output of the supplier recommendation, a list of recommended supplier IDs.
 */
const RecommendedSuppliersOutputSchema = z.object({
  recommendedSupplierIds: z.array(z.string()).describe('A list of IDs of suppliers recommended for this RFQ.'),
});
export type RecommendedSuppliersOutput = z.infer<typeof RecommendedSuppliersOutputSchema>;

/**
 * The Genkit prompt definition for recommending suppliers.
 */
const recommendSuppliersPrompt = ai.definePrompt({
  name: 'recommendSuppliersPrompt',
  input: { schema: PromptInputSchema },
  output: { schema: RecommendedSuppliersOutputSchema },
  prompt: `You are an AI assistant specialized in matching construction RFQs with suitable suppliers. Your task is to recommend suppliers based on the RFQ's category, required service area, and whether a quality certificate is needed.

**Matching Criteria:**
1.  **Specialization:** The supplier's `specializationCategories` must include the `rfqCategory`.
2.  **Service Area:** The supplier's `serviceAreas` must include the `rfqArea`.
3.  **Verification:** Always prioritize `verified` suppliers. If `rfqQualityCertificateRequired` is true, *strictly* recommend only `verified` suppliers.

**RFQ Details:**
- Category: {{{rfqCategory}}}
- Area: {{{rfqArea}}}
- Quality Certificate Required: {{{rfqQualityCertificateRequired}}}

**Available Suppliers (JSON Array):**
{{{json allSuppliers}}}

Please provide only the JSON output, with no additional text or explanations.`,
});

/**
 * The main Genkit flow for recommending suppliers for an RFQ.
 * It fetches all suppliers and then uses an AI model to select the most suitable ones.
 */
const recommendSuppliersForRfqFlow = ai.defineFlow(
  {
    name: 'recommendSuppliersForRfqFlow',
    inputSchema: RecommendSuppliersForRfqInputSchema,
    outputSchema: RecommendedSuppliersOutputSchema,
  },
  async (input) => {
    // In a real application, this would involve fetching data from Firestore.
    // For this example, we use mock supplier data.
    const allSuppliers = [
      { id: 'sup-101', name: 'المورد المتكامل', specializationCategories: ['حديد ومعادن', 'أسمنت وخرسانة'], serviceAreas: ['الرياض', 'جدة'], verified: true },
      { id: 'sup-102', name: 'الشركة المتحدة للمقاولات', specializationCategories: ['أرضيات وتشطيبات', 'كهرباء وإنارة'], serviceAreas: ['جدة', 'الدمام'], verified: true },
      { id: 'sup-103', name: 'مواد البناء الحديثة', specializationCategories: ['حديد ومعادن', 'عزل وأسقف'], serviceAreas: ['الرياض'], verified: false }, // Not verified
      { id: 'sup-104', name: 'توريدات الشرق الأوسط', specializationCategories: ['حديد ومعادن', 'كهرباء وإنارة'], serviceAreas: ['الرياض', 'مكة'], verified: true },
      { id: 'sup-105', name: 'الموردون المميزون', specializationCategories: ['أدوات صحية وسباكة'], serviceAreas: ['الرياض', 'القصيم'], verified: true },
      { id: 'sup-106', name: 'مؤسسة البناء السريع', specializationCategories: ['أسمنت وخرسانة'], serviceAreas: ['جدة'], verified: false }, // Not verified, different area
    ];

    const promptInput = {
      rfqCategory: input.rfqCategory,
      rfqArea: input.rfqArea,
      rfqQualityCertificateRequired: input.rfqQualityCertificateRequired,
      allSuppliers: allSuppliers,
    };

    const { output } = await recommendSuppliersPrompt(promptInput);

    return output!;
  }
);

/**
 * Recommends suitable suppliers for a given RFQ based on category, location, and certification requirements.
 * @param input - The RFQ details for which to recommend suppliers.
 * @returns A promise that resolves to an object containing a list of recommended supplier IDs.
 */
export async function recommendSuppliersForRfq(input: RecommendSuppliersForRfqInput): Promise<RecommendedSuppliersOutput> {
  return recommendSuppliersForRfqFlow(input);
}
